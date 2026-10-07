"""Account surface: settings, followed industries, pins (picks),
and entitlements. Stages 5-7 of BUILD_SPEC."""
import os
from zoneinfo import available_timezones

from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from psycopg2.extras import execute_values

from app import context, scope
from app.db import get_conn

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

_TZ = available_timezones()
_WEBHOOK_KEY = os.environ.get("WEBHOOK_SECRET_KEY")

_BASIC_SETTINGS = (
    "timezone, digest_enabled, digest_day, digest_hour, channel_email, "
    "channel_push, channel_sms, phone_number, phone_verified, "
    "webhook_url, webhook_auto_disabled_at, webhook_enabled"
)


def _require_user(creds):
    return context.user_from_creds(creds)


def _tier_payload(conn, user_id):
    tier = scope.tier_for_user(conn, user_id)
    if not tier:
        return None
    return {"key": tier[0], "label": tier[1], "price_monthly_cents": tier[2],
            "industries_limit": tier[3], "names_shown_limit": tier[4],
            "picks_limit": tier[5], "alerts_limit": tier[6], "channels": tier[7]}


def _settings_payload(conn, user_id):
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_BASIC_SETTINGS}, webhook_secret FROM user_settings "
            "WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        scope.provision_free(conn, user_id)
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_BASIC_SETTINGS}, webhook_secret FROM user_settings "
                "WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()
    secret_revealed = None
    if row[11] is not None and _WEBHOOK_KEY:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pgp_sym_decrypt(webhook_secret, %s) "
                "FROM user_settings WHERE user_id = %s",
                (_WEBHOOK_KEY, user_id),
            )
            secret_revealed = cur.fetchone()[0]
    return {
        "timezone": row[0], "digest_enabled": row[1], "digest_day": row[2],
        "digest_hour": row[3], "channel_email": row[4], "channel_push": row[5],
        "channel_sms": row[6], "phone_number": row[7], "phone_verified": row[8],
        "webhook_url": row[9],
        "webhook_auto_disabled_at": row[10].isoformat() if row[10] else None,
        "webhook_secret": secret_revealed,
        "webhook_secret_stored": bool(row[11]) and _WEBHOOK_KEY is not None,
    }


class SettingsIn(BaseModel):
    timezone: str | None = None
    digest_enabled: bool | None = None
    digest_day: int | None = Field(default=None, ge=0, le=6)
    digest_hour: int | None = Field(default=None, ge=0, le=23)
    channel_email: bool | None = None
    channel_push: bool | None = None
    channel_sms: bool | None = None
    phone_number: str | None = None
    webhook_url: str | None = None
    webhook_secret: str | None = None
    regenerate_webhook_secret: bool = False
    reset_auto_disable: bool = False


class IndustryIn(BaseModel):
    key: str = Field(min_length=1, max_length=64)


class PickIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=12)


class PicksOrderIn(BaseModel):
    symbols: list[str]


def _tier_has_channel(tier, channel):
    return tier is not None and channel in tier[7]


def _apply_settings(conn, user_id, body, tier):
    tier_channels = tier[7] if tier else ["email"]
    sets, params = [], []
    if body.timezone is not None:
        if body.timezone not in _TZ:
            raise HTTPException(422, "unknown timezone")
        sets.append("timezone = %s"); params.append(body.timezone)
    for col in ("digest_enabled", "channel_email", "channel_push", "channel_sms"):
        v = getattr(body, col)
        if v is not None:
            sets.append(f"{col} = %s"); params.append(bool(v))
    if body.digest_day is not None:
        sets.append("digest_day = %s"); params.append(body.digest_day)
    if body.digest_hour is not None:
        sets.append("digest_hour = %s"); params.append(body.digest_hour)
    if body.phone_number is not None:
        sets.append("phone_number = %s"); params.append(body.phone_number or None)
        sets.append("phone_verified = FALSE")
    if body.webhook_url is not None:
        url = (body.webhook_url or "").strip()
        if url and not _tier_has_channel(tier, "webhook"):
            raise HTTPException(403, "webhook channel is not in your plan")
        if url and not url.startswith("https://"):
            raise HTTPException(422, "webhook url must be https")
        sets.append("webhook_url = %s"); params.append(url)
        sets.append("webhook_enabled = %s"); params.append(bool(url))
    if body.webhook_secret is not None or body.regenerate_webhook_secret:
        if not _tier_has_channel(tier, "webhook"):
            raise HTTPException(403, "webhook channel is not in your plan")
        if not _WEBHOOK_KEY:
            raise HTTPException(503, "webhook secret storage not configured")
        secret = body.webhook_secret if body.webhook_secret is not None \
            else os.urandom(32).hex()
        sets.append("webhook_secret = pgp_sym_encrypt(%s, %s)")
        params.extend([secret, _WEBHOOK_KEY])
        sets.append("webhook_enabled = %s"); params.append(True)
    if body.reset_auto_disable:
        sets.append("webhook_auto_disabled_at = NULL")
        sets.append("webhook_enabled = %s"); params.append(True)
    if sets:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE user_settings SET {', '.join(sets)} WHERE user_id = %s",
                params + [user_id],
            )


@router.get("/api/me/settings")
def get_settings(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    conn = get_conn()
    try:
        return _settings_payload(conn, context.user_id(row))
    finally:
        conn.close()


@router.patch("/api/me/settings")
def patch_settings(body: SettingsIn,
                   creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        scope.provision_free(conn, uid)
        tier = scope.tier_for_user(conn, uid)
        _apply_settings(conn, uid, body, tier)
        conn.commit()
        return _settings_payload(conn, uid)
    finally:
        conn.close()


@router.get("/api/me/industries")
def get_industries(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT i.key, i.label, i.benchmark_etf, i.description, ui.followed_at, "
                "(SELECT COUNT(*) FROM instruments ins WHERE ins.industry_id = i.id) "
                "FROM user_industries ui JOIN industries i ON i.id = ui.industry_id "
                "WHERE ui.user_id = %s ORDER BY ui.followed_at",
                (context.user_id(row),),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"industries": [
        {"key": r[0], "label": r[1], "benchmark_etf": r[2], "description": r[3],
         "followed_at": r[4].isoformat(), "universe_count": r[5]} for r in rows
    ]}


@router.post("/api/me/industries")
def add_industry(body: IndustryIn,
                 creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        scope.provision_free(conn, uid)
        tier = scope.tier_for_user(conn, uid)
        limit = tier[3] if tier else 1
        if limit < 999:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM user_industries WHERE user_id = %s", (uid,))
                if cur.fetchone()[0] >= limit:
                    raise HTTPException(
                        403, f"your plan follows {limit} industr{'y' if limit == 1 else 'ies'}; upgrade to add more")
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM industries WHERE key = %s", (body.key,))
            industry = cur.fetchone()
            if not industry:
                raise HTTPException(404, "not found")
            cur.execute(
                "INSERT INTO user_industries (user_id, industry_id) VALUES (%s, %s) "
                "ON CONFLICT (user_id, industry_id) DO NOTHING",
                (uid, industry[0]),
            )
        conn.commit()
        return _industries_summary(conn, uid)
    finally:
        conn.close()


def _industries_summary(conn, uid):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM user_industries WHERE user_id = %s", (uid,))
        return {"followed_count": cur.fetchone()[0]}


@router.delete("/api/me/industries/{key}")
def drop_industry(key: str,
                  creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM industries WHERE key = %s", (key,))
            industry = cur.fetchone()
            if not industry:
                raise HTTPException(404, "not found")
            cur.execute(
                "DELETE FROM user_industries WHERE user_id = %s AND industry_id = %s",
                (uid, industry[0]),
            )
            cur.execute(
                "SELECT COUNT(*) FROM picks p JOIN instruments i ON i.id = p.instrument_id "
                "WHERE p.user_id = %s AND p.active AND i.industry_id = %s",
                (uid, industry[0]),
            )
            affected = cur.fetchone()[0]
        conn.commit()
        return {"removed": key, "affected_picks": affected}
    finally:
        conn.close()


def _latest_run_id(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
        r = cur.fetchone()
        return r[0] if r else None


@router.get("/api/me/picks")
def get_picks(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        run_id = _latest_run_id(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT p.id, t.symbol, i.theme, i.lane, ind.key, ind.label, "
                "ind.benchmark_etf, p.score_at_pin, p.pinned_at, "
                "sc.value, sc.band, sc.delta_1d, p.note "
                "FROM picks p "
                "JOIN instruments i ON i.id = p.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "JOIN industries ind ON ind.id = i.industry_id "
                "LEFT JOIN scores sc ON sc.instrument_id = i.id AND sc.run_id = %s "
                "WHERE p.user_id = %s AND p.active "
                "ORDER BY p.sort_order, p.pinned_at",
                (run_id, uid),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"picks": [
        {"id": r[0], "symbol": r[1], "theme": r[2], "lane": r[3],
         "industry": {"key": r[4], "label": r[5], "benchmark_etf": r[6]},
         "score_at_pin": float(r[7]) if r[7] is not None else None,
         "pinned_at": r[8].isoformat(),
         "value": float(r[9]) if r[9] is not None else None,
         "band": r[10], "delta_1d": float(r[11]) if r[11] is not None else None,
         "note": r[12] or ""}
        for r in rows
    ]}


@router.post("/api/me/picks")
def add_pick(body: PickIn,
             creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    sym = body.symbol.strip().upper()
    conn = get_conn()
    try:
        scope.provision_free(conn, uid)
        tier = scope.tier_for_user(conn, uid)
        picks_limit = tier[5] if tier else 1
        run_id = _latest_run_id(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT i.id, s.value FROM tickers t "
                "JOIN instruments i ON i.ticker_id = t.id "
                "LEFT JOIN scores s ON s.instrument_id = i.id AND s.run_id = %s "
                "WHERE t.symbol = %s AND i.active "
                "ORDER BY i.active DESC, s.value DESC NULLS LAST LIMIT 1",
                (run_id, sym),
            )
            found = cur.fetchone()
            if not found:
                raise HTTPException(404, "not found")
            instr_id, score_val = found
            cur.execute(
                "SELECT p.id, p.active FROM picks p "
                "WHERE p.instrument_id = %s AND p.user_id = %s LIMIT 1",
                (instr_id, uid),
            )
            existing = cur.fetchone()
            existing_pick, pick_active = existing if existing else (None, None)
            if existing_pick is not None and pick_active:
                raise HTTPException(409, "already on your watchlist")
            cur.execute("SELECT COUNT(*) FROM picks WHERE user_id = %s AND active", (uid,))
            if cur.fetchone()[0] >= picks_limit:
                raise HTTPException(
                    403, f"your plan pins {picks_limit} ticker{'s' if picks_limit != 1 else ''}; upgrade to pin more")
            if existing_pick is not None and not pick_active:
                cur.execute("UPDATE picks SET active = TRUE, score_at_pin = %s WHERE id = %s",
                            (score_val, existing_pick))
                conn.commit()
                return {"added": sym, "score_at_pin": float(score_val) if score_val else None}
            cur.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM picks WHERE user_id = %s", (uid,))
            next_order = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO picks (user_id, instrument_id, score_at_pin, sort_order) "
                "VALUES (%s, %s, %s, %s)",
                (uid, instr_id, score_val, next_order),
            )
        conn.commit()
        return {"added": sym, "score_at_pin": float(score_val) if score_val else None}
    finally:
        conn.close()


@router.post("/api/me/picks/swap")
def swap_pick(body: PickIn,
              creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Watchlist at its cap: drop the oldest pinned name and pin this one in
    a single transaction, so a full board can be swapped from the stock page
    instead of unpin-then-pin in two round trips."""
    row = _require_user(creds)
    uid = context.user_id(row)
    sym = body.symbol.strip().upper()
    conn = get_conn()
    try:
        scope.provision_free(conn, uid)
        tier = scope.tier_for_user(conn, uid)
        picks_limit = tier[5] if tier else 1
        run_id = _latest_run_id(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.value FROM tickers t "
                "JOIN instruments i ON i.ticker_id = t.id "
                "LEFT JOIN scores s ON s.instrument_id = i.id AND s.run_id = %s "
                "WHERE t.symbol = %s AND i.active "
                "ORDER BY i.active DESC, s.value DESC NULLS LAST LIMIT 1",
                (run_id, sym),
            )
            found = cur.fetchone()
            if not found:
                raise HTTPException(404, "not found")
            cur.execute(
                "SELECT i.id, p.id, p.active FROM instruments i "
                "JOIN tickers t ON t.id = i.ticker_id "
                "LEFT JOIN picks p ON p.instrument_id = i.id AND p.user_id = %s "
                "WHERE t.symbol = %s AND i.active LIMIT 1",
                (uid, sym),
            )
            instr_id, existing_pick, pick_active = cur.fetchone()
            if existing_pick is not None and pick_active:
                raise HTTPException(409, "already on your watchlist")
            cur.execute("SELECT COUNT(*) FROM picks WHERE user_id = %s AND active", (uid,))
            active_count = cur.fetchone()[0]
            dropped = None
            if active_count >= picks_limit:
                cur.execute(
                    "SELECT p.id, t.symbol FROM picks p "
                    "JOIN instruments i ON i.id = p.instrument_id "
                    "JOIN tickers t ON t.id = i.ticker_id "
                    "WHERE p.user_id = %s AND p.active "
                    "ORDER BY p.sort_order, p.pinned_at, p.id LIMIT 1",
                    (uid,),
                )
                oldest = cur.fetchone()
                if oldest:
                    cur.execute("UPDATE picks SET active = FALSE WHERE id = %s", (oldest[0],))
                    dropped = oldest[1]
            if existing_pick is not None:
                cur.execute("UPDATE picks SET active = TRUE, score_at_pin = %s WHERE id = %s",
                            (found[0], existing_pick))
            else:
                cur.execute(
                    "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM picks WHERE user_id = %s",
                    (uid,),
                )
                next_order = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO picks (user_id, instrument_id, score_at_pin, sort_order) "
                    "VALUES (%s, %s, %s, %s)",
                    (uid, instr_id, found[0], next_order),
                )
        conn.commit()
        return {"added": sym, "dropped": dropped,
                "score_at_pin": float(found[0]) if found[0] else None}
    finally:
        conn.close()


@router.delete("/api/me/picks/{symbol}")
def drop_pick(symbol: str,
              creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    sym = symbol.strip().upper()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE picks p SET active = FALSE "
                "FROM instruments i JOIN tickers t ON t.id = i.ticker_id "
                "WHERE p.instrument_id = i.id AND p.user_id = %s AND t.symbol = %s",
                (uid, sym),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "not found")
        conn.commit()
        return {"removed": sym}
    finally:
        conn.close()


@router.put("/api/me/picks/order")
def order_picks(body: PicksOrderIn,
                creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT t.symbol FROM picks p "
                "JOIN instruments i ON i.id = p.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "WHERE p.user_id = %s AND p.active",
                (uid,),
            )
            owned = {r[0] for r in cur.fetchall()}
            wanted = [s.strip().upper() for s in body.symbols if s.strip().upper() in owned]
            if wanted:
                execute_values(
                    cur,
                    "UPDATE picks p SET sort_order = v.n "
                    "FROM (VALUES %s) AS v(symbol, n), "
                    " instruments i JOIN tickers t ON t.id = i.ticker_id "
                    "WHERE p.instrument_id = i.id AND t.symbol = v.symbol "
                    f"AND p.user_id = {int(uid)} AND p.active",
                    [(s, i) for i, s in enumerate(wanted)],
                    template="(%s, %s)",
                    page_size=100,
                )
            cur.execute(
                "SELECT t.symbol FROM picks p "
                "JOIN instruments i ON i.id = p.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "WHERE p.user_id = %s AND p.active ORDER BY p.sort_order",
                (uid,),
            )
            rows = [r[0] for r in cur.fetchall()]
        conn.commit()
        return {"order": rows}
    finally:
        conn.close()


@router.get("/api/entitlements")
def entitlements(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT key, label, price_monthly_cents, industries_limit, "
                "names_shown_limit, picks_limit, alerts_limit, channels "
                "FROM tiers ORDER BY sort_order",
            )
            tiers = [dict(zip(
                ["key", "label", "price_monthly_cents", "industries_limit",
                 "names_shown_limit", "picks_limit", "alerts_limit", "channels"],
                r)) for r in cur.fetchall()]
        user = context.user_from_creds(creds, required=False)
        if user is None:
            conn.close()
            return {"tiers": tiers, "current": None, "usage": None,
                    "subscription": None}
        uid = context.user_id(user)
        scope.provision_free(conn, uid)
        tier = _tier_payload(conn, uid)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM picks WHERE user_id = %s AND active", (uid,))
            picks_used = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM user_industries WHERE user_id = %s", (uid,))
            industries_followed = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM alert_rules WHERE user_id = %s", (uid,))
            alerts_used = cur.fetchone()[0]
            cur.execute("SELECT status, current_period_end FROM subscriptions WHERE user_id = %s", (uid,))
            sub = cur.fetchone()
    finally:
        conn.close()
    return {
        "tiers": tiers, "current": tier,
        "usage": {"picks_used": picks_used,
                  "industries_followed": industries_followed,
                  "alerts_used": alerts_used},
        "subscription": None if not sub else {
            "status": sub[0],
            "current_period_end": sub[1].isoformat() if sub[1] else None},
    }