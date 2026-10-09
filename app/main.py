"""Tradealert scaffold API: signup, login, me, verify. Mounted under /api."""
import logging
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path

import jwt
import psycopg2
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import email as emailer
from app import security
from app import (account, admin, alerts, billing, discover, dossier, lab, lab_regression,
                 lab_release, oauth, product, reporting, scope)
from app.db import _load_env, get_conn

_load_env()

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tradealert")

app = FastAPI(title="tradealert.me", docs_url="/api/docs",
              openapi_url="/api/openapi.json")
app.include_router(account.router)
app.include_router(alerts.router)
app.include_router(admin.router)
app.include_router(billing.router)
app.include_router(discover.router)
app.include_router(lab.router)
app.include_router(lab_regression.router)
app.include_router(lab_release.router)
app.include_router(oauth.router)
app.include_router(product.router)
app.include_router(reporting.router)
bearer = HTTPBearer(auto_error=False)

_ROOT = Path(__file__).resolve().parent.parent
_STATIC = _ROOT / "static"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# per-IP fixed-window rate limits; in-memory is fine for a single uvicorn
# worker and resets on restart. Behind nginx the client IP comes from
# X-Forwarded-For, which only nginx can set (the app port binds to localhost).
_RATE_LIMITS = {"signup": (5, 3600), "login": (10, 60)}
_hits = defaultdict(deque)


def _rate_limited(route, ip):
    if not ip:
        return False
    limit, window = _RATE_LIMITS[route]
    now = time.time()
    if len(_hits) > 10_000:
        # bound memory on a busy or abusively-proxied box: drop every bucket
        # whose newest hit is already past its window
        for key in [k for k, q in _hits.items()
                    if not q or now - q[0] > _RATE_LIMITS[k[0]][1]]:
            del _hits[key]
    q = _hits[(route, ip)]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def _client_ip(request):
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


class SignupIn(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)


class LoginIn(BaseModel):
    email: str
    password: str


def _user_payload(row):
    uid, email, _h, verified, is_admin, created_at, name, provider, provider_id = row
    return {"email": email, "verified": bool(verified),
            "is_admin": bool(is_admin), "name": name,
            "provider": provider, "provider_id": provider_id,
            "username": provider_id if provider else None,
            "created_at": created_at.isoformat()}


def _user_from_token(creds):
    if creds is None:
        raise HTTPException(401, "missing bearer token")
    try:
        payload = security.decode_token(creds.credentials, purpose="session")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(401, "invalid or expired token")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(401, "invalid token payload")
    conn = get_conn()
    try:
        row = _get_by(conn, "id", user_id)
    finally:
        conn.close()
    if not row:
        raise HTTPException(401, "user no longer exists")
    return row


def _provision_free(conn, user_id):
    """Give every signup the Free tier and default settings if not present
    (Free exists as a seed row; a missing tier just means seed.sql has not run)."""
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tiers WHERE key = 'free'")
        tier = cur.fetchone()
        if tier:
            cur.execute(
                "INSERT INTO subscriptions (user_id, tier_id) VALUES (%s, %s) "
                "ON CONFLICT (user_id) DO NOTHING",
                (user_id, tier[0]),
            )
        cur.execute(
            "INSERT INTO user_settings (user_id) VALUES (%s) "
            "ON CONFLICT (user_id) DO NOTHING",
            (user_id,),
        )


def _tier_for_user(conn, user_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT t.key, t.label, t.price_monthly_cents, t.industries_limit, "
            "t.names_shown_limit, t.picks_limit, t.alerts_limit, t.channels "
            "FROM subscriptions s JOIN tiers t ON t.id = s.tier_id "
            "WHERE s.user_id = %s AND s.status = 'active'",
            (user_id,),
        )
        return cur.fetchone()


def _account_payload(row, conn):
    uid, email, _h, verified, is_admin, created_at, name, provider, provider_id = row
    payload = _user_payload(row)
    _provision_free(conn, uid)
    tier = _tier_for_user(conn, uid)
    if tier:
        payload["tier"] = {
            "key": tier[0], "label": tier[1],
            "price_monthly_cents": tier[2],
            "industries_limit": tier[3], "names_shown_limit": tier[4],
            "picks_limit": tier[5], "alerts_limit": tier[6],
            "channels": tier[7],
        }
    with conn.cursor() as cur:
        cur.execute("SELECT timezone FROM user_settings WHERE user_id = %s", (uid,))
        tz = cur.fetchone()
        payload["settings"] = {"timezone": tz[0]} if tz else {"timezone": "America/New_York"}
        cur.execute("SELECT COUNT(*) FROM user_industries WHERE user_id = %s", (uid,))
        payload["industries_following_count"] = cur.fetchone()[0]
    return payload


def _get_by(conn, column, value):
    if column not in {"email", "id"}:
        raise ValueError(f"unexpected column {column!r}")
    cur = conn.cursor()
    cur.execute(f"SELECT id, email, password_hash, verified, is_admin, "
                f"created_at, name, provider, provider_id "
                f"FROM users WHERE {column} = %s", (value,))
    return cur.fetchone()


def _send_verification(email, user_id):
    token = security.make_token(user_id, purpose="verify", expires_days=1)
    base = os.environ.get("APP_BASE_URL", "http://localhost:8000")
    link = f"{base}/api/verify?token={token}"
    try:
        status = emailer.send_email(
            email,
            "Verify your tradealert.me account",
            "Confirm your email address to finish signing up.\n\n"
            f"Open this link: {link}\n\n"
            "This link expires in 24 hours. If you did not create an account, "
            "ignore this email.",
        )
        if status == "skipped":
            # dev mode: the console is the only delivery mechanism
            log.info("verification link for %s: %s", email, link)
        else:
            log.info("verification email sent to %s (token %s...)", email, token[:8])
    except Exception as e:  # never fail signup over email delivery
        log.warning("verification email to %s failed: %s", email, e)


@app.post("/api/signup")
def signup(body: SignupIn, request: Request):
    if _rate_limited("signup", _client_ip(request)):
        raise HTTPException(429, "too many signups from this address, try later")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "enter a valid email address")
    if not 8 <= len(body.password) <= 72 or len(body.password.encode("utf-8")) > 72:
        raise HTTPException(422, "password must be 8-72 bytes")
    hashed = security.hash_password(body.password)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO users (email, password_hash) VALUES (%s, %s) "
                    "RETURNING id, created_at",
                    (email, hashed),
                )
                uid, created_at = cur.fetchone()
                _provision_free(conn, uid)
                conn.commit()
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                raise HTTPException(409, "that email is already registered")
    finally:
        conn.close()
    _send_verification(email, uid)
    return {"token": security.make_token(uid),
            "user": {"email": email, "verified": False,
                     "created_at": created_at.isoformat()}}


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    if _rate_limited("login", _client_ip(request)):
        raise HTTPException(429, "too many attempts, try later")
    email = body.email.strip().lower()
    conn = get_conn()
    try:
        row = _get_by(conn, "email", email)
    finally:
        conn.close()
    if not row or not security.check_password(body.password, row[2]):
        raise HTTPException(401, "invalid email or password")
    return {"token": security.make_token(row[0]), "user": _user_payload(row)}


@app.get("/api/me")
def me(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _user_from_token(creds)
    conn = get_conn()
    try:
        return _account_payload(row, conn)
    finally:
        conn.close()


@app.get("/api/verify")
def verify(token: str):
    try:
        payload = security.decode_token(token, purpose="verify")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(400, "invalid or expired verification link")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "invalid verification link")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET verified = TRUE WHERE id = %s "
                "RETURNING email, verified",
                (user_id,),
            )
            row = cur.fetchone()
            conn.commit()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "user not found")
    log.info("verified email %s", row[0])
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Email verified</title></head>'
        '<body style="font-family:sans-serif;line-height:1.6;max-width:30em;'
        'margin:4em auto;padding:0 1em;text-align:center">'
        '<h1>Email verified</h1>'
        '<p>Your tradealert.me account is active.</p>'
        '<p><a href="/login">Log in now</a></p>'
        '</body></html>')

@app.get("/api/unsubscribe")
def unsubscribe(token: str, channel: str = "email"):
    from app.jobs import unsubscribe as run_unsubscribe
    ok = run_unsubscribe(token, channel)
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Unsubscribed</title></head>'
        '<body style="font-family:sans-serif;line-height:1.6;max-width:30em;'
        'margin:4em auto;padding:0 1em;text-align:center">'
        '<h1>' + ("Unsubscribed" if ok else "Link invalid or already used") + '</h1>'
        '<p>' + ("You will stop receiving these emails." if ok else
                 "Contact support if you think this is a mistake.") + '</p>'
        '<p><a href="/">Back to the board</a></p>'
        '</body></html>')

@app.get("/api/strategies")
def strategies():
    """Public list: what the screen is called and whether it is calibrated.
    Only the name and track record leave the server; the inputs and cutoffs
    stay internal."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT key, label, monogram, calibrated, calibrated_at, "
                "resolved_outcomes_count "
                "FROM strategies ORDER BY sort_order",
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"strategies": [
        {"key": r[0], "label": r[1], "monogram": r[2], "calibrated": bool(r[3]),
         "calibrated_at": r[4].isoformat() if r[4] else None,
         "resolved_outcomes_count": r[5]} for r in rows
    ]}


@app.get("/api/industries")
def industries():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT key, label, benchmark_etf, description, sort_order, "
                "(SELECT COUNT(*) FROM instruments i JOIN tickers t ON t.id = i.ticker_id "
                " WHERE i.industry_id = industries.id) "
                "FROM industries ORDER BY sort_order",
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"industries": [
        {"key": r[0], "label": r[1], "benchmark_etf": r[2],
         "description": r[3], "universe_count": r[5]} for r in rows
    ]}


def _latest_run(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, as_of, completed_at, status FROM runs "
            "WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1",
        )
        return cur.fetchone()


@app.get("/api/runs/latest")
def runs_latest():
    conn = get_conn()
    try:
        run = _latest_run(conn)
        if not run:
            raise HTTPException(404, "not found")
        run_id, as_of, completed_at, status = run
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sc.band, COUNT(*) FROM scores sc WHERE sc.run_id = %s "
                "GROUP BY sc.band",
                (run_id,),
            )
            counts = {b: c for b, c in cur.fetchall()}
            cur.execute(
                "SELECT COUNT(*) FROM instruments WHERE active",
            )
            universe = cur.fetchone()[0]
    finally:
        conn.close()
    return {"run_id": run_id, "as_of": as_of.isoformat(),
            "completed_at": completed_at.isoformat() if completed_at else None,
            "status": status, "bands": counts, "universe_active": universe}


def _strategy_by_key(conn, key):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, key, label, monogram, calibrated, resolved_outcomes_count "
            "FROM strategies WHERE key = %s",
            (key,),
        )
        return cur.fetchone()


def _strategy_payload(strat):
    return {"key": strat[1], "label": strat[2], "monogram": strat[3],
            "calibrated": bool(strat[4]), "resolved_outcomes_count": strat[5]}


@app.get("/api/board")
def board(band: str = "", strategy: str = "fast_mover",
          creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    conn = get_conn()
    try:
        row = _user_from_token(creds)
        user_id = row[0]
        run = _latest_run(conn)
        if not run:
            raise HTTPException(404, "not found")
        run_id = run[0]
        # an unknown strategy key is indistinguishable from an empty board:
        # the strategy list is public, so nothing leaks either way
        strat = _strategy_by_key(conn, (strategy or "fast_mover").strip().lower())
        if not strat:
            raise HTTPException(404, "not found")
        industries_limit, names_shown_limit = 1, 5
        _provision_free(conn, user_id)
        tier = _tier_for_user(conn, user_id)
        if tier:
            industries_limit, names_shown_limit = tier[3], tier[4]
        allowed_keys, scope_label, picks = scope.user_scope(
            conn, user_id, industries_limit)
        vis, vis_params = scope.visible_sql_and_params(allowed_keys, picks, "i")
        with conn.cursor() as cur:
            params = [run_id, strat[0]]
            sql = (
                "SELECT s.symbol, i.theme, i.instrument_group, "
                "ind.key, ind.label, ind.benchmark_etf, sc.value, sc.band, "
                "sc.components_present, sc.components_total, sc.delta_1d, "
                f"i.lane, ind.id, {discover._hf_pass()} AS hf_pass, "
                "px.last_close, px.c30, px.closes, "
                "(CASE WHEN e.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' "
                " THEN substr(e.value, 1, 10)::date - CURRENT_DATE END) AS earnings_in, "
                "i.hook "
                "FROM scores sc "
                "JOIN instruments i ON i.id = sc.instrument_id "
                "JOIN tickers s ON s.id = i.ticker_id "
                "JOIN industries ind ON ind.id = i.industry_id "
                f"{discover.price_lateral('s')} "
                "LEFT JOIN LATERAL (SELECT value FROM snapshots sn WHERE sn.ticker_id = s.id "
                "  AND sn.field = 'earnings' ORDER BY sn.as_of DESC LIMIT 1) e ON TRUE "
                "WHERE sc.run_id = %s AND sc.strategy_id = %s "
                "AND sc.value IS NOT NULL "
            )
            if band:
                params.append(band)
                sql += "AND sc.band = %s "
            params += vis_params
            sql += (
                f"AND {vis} "
                "ORDER BY sc.value DESC, s.symbol "
                "LIMIT %s"
            )
            params.append(names_shown_limit + 1)
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
            bench = discover.benchmarks(cur, [r[12] for r in rows])
    finally:
        conn.close()
    truncated = len(rows) > names_shown_limit
    rows = rows[:names_shown_limit]

    def _price(r):
        chg = discover._pct(r[14], r[15])
        b = bench.get(r[12]) or {}
        rel = (round(chg - b["chg_30d"], 2)
               if chg is not None and b.get("chg_30d") is not None else None)
        return {"last_close": float(r[14]) if r[14] is not None else None,
                "chg_30d": chg, "rel_30d": rel, "benchmark": b.get("symbol"),
                "closes": discover._spark(r[16])}
    return {
        "as_of": run[1].isoformat(),
        "run_id": run_id,
        "strategy": _strategy_payload(strat),
        "rows": [
            {"rank": i + 1, "symbol": r[0], "theme": r[1], "group": r[2],
             "industry": {"key": r[3], "label": r[4], "benchmark_etf": r[5]},
             "value": float(r[6]), "band": r[7],
             "components_present": r[8], "components_total": r[9],
             "delta_1d": float(r[10]) if r[10] is not None else None,
             "lane": r[11] or "", "hf_pass": r[13], "price": _price(r),
             "earnings_in": r[17], "hook": r[18] or ""}
            for i, r in enumerate(rows)
        ],
        "meta": {"shown": len(rows), "truncated": truncated,
                 "scope": scope_label, "industries": allowed_keys,
                 "band_filter": band},
    }


_SNAPSHOT_FIELDS = {
    "px": "px", "cap_usd_m": "cap_usd_m", "so_m": "so_m",
    "run3m_pct": "run3m_pct", "off_high_pct": "off_high_pct",
    "volx20d": "volx20d", "day_pct": "day_pct",
    "earnings": "earnings", "earnings_conf": "earnings_conf",
    "si_pct_float": "si_pct_float", "si_shares_m": "si_shares_m", "dtc": "dtc",
    "float_m": "float_m", "fee_pct": "fee_pct", "borrow_avail": "borrow_avail",
    "growth_pct": "growth_pct", "avgvol20": "avgvol20", "hi52": "hi52", "lo52": "lo52",
}


@app.get("/api/stock/{symbol}")
def stock(symbol: str, strategy: str = "fast_mover",
          creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    sym = symbol.strip().upper()
    if not re.match(r"^[A-Z0-9.\-]{1,12}$", sym):
        raise HTTPException(404, "not found")
    conn = get_conn()
    try:
        run = _latest_run(conn)
        if not run:
            raise HTTPException(404, "not found")
        run_id = run[0]
        user_row = _user_from_token(creds)
        user_id = user_row[0]
        _provision_free(conn, user_id)
        tier = _tier_for_user(conn, user_id)
        industries_limit = tier[3] if tier else 1
        keys, _scope_label, picks = scope.user_scope(conn, user_id, industries_limit)
        vis, vis_params = scope.visible_sql_and_params(keys, picks, "i")
        strat = _strategy_by_key(conn, (strategy or "fast_mover").strip().lower())
        if not strat:
            raise HTTPException(404, "not found")
        names_shown_limit = tier[4] if tier else 5
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.id, i.id, i.theme, i.instrument_group, "
                "ind.key, ind.label, ind.benchmark_etf, i.lane, i.hook, i.thesis, "
                "i.industry_id "
                "FROM tickers s JOIN instruments i ON i.ticker_id = s.id "
                "JOIN industries ind ON ind.id = i.industry_id "
                f"WHERE s.symbol = %s AND {vis} "
                "ORDER BY i.active DESC LIMIT 1",
                tuple([sym] + vis_params),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "not found")
        ticker_id, instrument_id, industry_id = row[0], row[1], row[10]
        with conn.cursor() as cur:
            cur.execute(
                "SELECT value, band, components_present, components_total, "
                "shrinkage_applied, shrinkage_from, component_json, haircut_json, "
                "delta_1d, hard_filter_json "
                "FROM scores WHERE run_id = %s AND instrument_id = %s "
                "AND strategy_id = %s",
                (run_id, instrument_id, strat[0]),
            )
            score = cur.fetchone()
            cur.execute(
                "SELECT DISTINCT ON (st.field) st.field, st.value, st.as_of "
                "FROM snapshots st WHERE st.ticker_id = %s "
                "ORDER BY st.field, st.as_of DESC",
                (ticker_id,),
            )
            snaps = {f: {"value": _as_num(v), "as_of": a.isoformat()}
                     for f, v, a in cur.fetchall() if f in _SNAPSHOT_FIELDS}
            # every strategy, with this run's score and breakdown where one
            # exists, so the dossier shows all five lenses from one call
            lenses = dossier.lenses(cur, run_id, instrument_id)
            components = dossier.components_of(score[6]) if score else []
            extras = {
                "changes": dossier.changes(cur, run_id, instrument_id, strat[0], components),
                "history": dossier.history(cur, instrument_id, strat[0]),
                "peers": dossier.peers(cur, run_id, strat[0], industry_id, instrument_id,
                                       vis, vis_params, names_shown_limit),
                "events": dossier.events(cur, instrument_id, user_id),
                "past_reactions": dossier.past_reactions(cur, instrument_id),
            }
            cur.execute(
                "SELECT note FROM picks WHERE user_id = %s AND instrument_id = %s "
                "AND active",
                (user_id, instrument_id),
            )
            pick = cur.fetchone()
    finally:
        conn.close()
    out = {
        "symbol": sym, "theme": row[2], "group": row[3],
        "industry": {"key": row[4], "label": row[5], "benchmark_etf": row[6]},
        "lane": row[7], "hook": row[8] or "", "thesis": row[9] or "",
        "strategy": _strategy_payload(strat),
        "strategies": lenses,
        "run": {"id": run_id, "as_of": run[1].isoformat()},
        "pinned": pick is not None,
        "note": (pick[0] if pick else "") or "",
        "snapshot": snaps,
        **extras,
    }
    if score:
        shrink = float(score[4]) if score[4] is not None else None
        out["score"] = {
            "value": float(score[0]), "band": score[1],
            "components_present": score[2], "components_total": score[3],
            "shrinkage_applied": shrink,
            "shrinkage_from": float(score[5]) if score[5] is not None else None,
            "components": components,
            "haircuts": [
                {"label": h.get("label"), "points": h.get("points"),
                 "evidence_url": h.get("evidence_url")}
                for h in (score[7] or [])
            ],
            "delta_1d": float(score[8]) if score[8] is not None else None,
            "hard_filters": [
                {"key": f.get("key"), "label": f.get("label"),
                 "value": f.get("value"), "pass": bool(f.get("pass"))}
                for f in (score[9] or [])
            ],
        }
    return out


def _as_num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return v


@app.get("/api/search")
def search(q: str = "", creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    q = q.strip()
    if not q:
        return {"results": []}
    conn = get_conn()
    try:
        run = _latest_run(conn)
        if not run:
            return {"results": []}
        user_row = _user_from_token(creds)
        user_id = user_row[0]
        _provision_free(conn, user_id)
        tier = _tier_for_user(conn, user_id)
        keys, _scope_label, picks = scope.user_scope(conn, user_id, tier[3] if tier else 1)
        vis, vis_params = scope.visible_sql_and_params(keys, picks, "i")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.symbol, i.theme, ind.key, sc.value, sc.band "
                "FROM tickers s "
                "JOIN instruments i ON i.ticker_id = s.id "
                "JOIN industries ind ON ind.id = i.industry_id "
                "LEFT JOIN scores sc ON sc.instrument_id = i.id "
                "  AND sc.run_id = %s "
                f"WHERE (s.symbol ILIKE %s OR i.theme ILIKE %s "
                f"OR ind.label ILIKE %s OR i.hook ILIKE %s OR i.thesis ILIKE %s) AND {vis} "
                "ORDER BY (s.symbol = %s) DESC, sc.value DESC NULLS LAST "
                "LIMIT 12",
                tuple([run[0], q + "%", "%" + q + "%", "%" + q + "%",
                       "%" + q + "%", "%" + q + "%"] +
                      vis_params + [q.upper()]),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"results": [
        {"symbol": r[0], "theme": r[1], "industry_key": r[2],
         "value": float(r[3]) if r[3] is not None else None,
         "band": r[4]} for r in rows
    ]}
@app.get("/lab", include_in_schema=False)
@app.get("/lab/", include_in_schema=False)
def lab_page():
    lab_html = _STATIC / "lab.html"
    if not lab_html.is_file():
        raise HTTPException(404, "not found")
    resp = FileResponse(lab_html)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    return resp


class SPAStaticFiles(StaticFiles):
    """Client-side routes (/, /board, /stock/SYMBOL) fall back to index.html
    like nginx's try_files; /api/ and real asset 404s are left alone."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404 and not path.split("/")[0] == "api":
                index = Path(self.directory) / "index.html"
                if index.is_file():
                    return FileResponse(index)
            raise


if _STATIC.is_dir():
    app.mount("/", SPAStaticFiles(directory=str(_STATIC), html=True), name="static")
