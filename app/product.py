"""Subscriber-facing v2 surface: the dossier's price series, public strategy
evidence pages, industry pages, on-site digests, and account utilities.

Every instrument-scoped read resolves the name through
scope.visible_sql_and_params first, so a symbol outside the subscriber's
universe 404s byte-identically to one that does not exist (the uniformity
rule in BUILD_SPEC section 5). Strategy and industry pages are public in the
sense /api/strategies already is: they describe the product, never a
subscriber's view of it."""
import json
import re
from datetime import datetime, timezone

import psycopg2
from fastapi import APIRouter, Depends, Query, Response
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app import context, scope, security
from app.db import get_conn

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def _not_found():
    raise HTTPException(404, "not found")


def _f(v):
    return float(v) if v is not None else None


def _latest_run(cur):
    cur.execute(
        "SELECT id, as_of FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
    return cur.fetchone()


def _resolve(conn, user_row, sym):
    """(ticker_id, instrument_id, industry_id, tier, keys, vis, vis_params) for
    a visible instrument; 404 otherwise. One code path for every
    instrument-scoped endpoint in this module."""
    uid = context.user_id(user_row)
    scope.provision_free(conn, uid)
    tier = scope.tier_for_user(conn, uid)
    keys, _label, picks = scope.user_scope(conn, uid, tier[3] if tier else 1)
    vis, vis_params = scope.visible_sql_and_params(keys, picks, "i")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT t.id, i.id, i.industry_id FROM tickers t "
            "JOIN instruments i ON i.ticker_id = t.id "
            f"WHERE t.symbol = %s AND {vis} ORDER BY i.active DESC LIMIT 1",
            tuple([sym] + vis_params),
        )
        row = cur.fetchone()
    if not row:
        _not_found()
    return row[0], row[1], row[2], tier, keys, vis, vis_params


# --------------------------------------------------------------------------
# Price series for the dossier chart
# --------------------------------------------------------------------------

@router.get("/api/stock/{symbol}/series")
def stock_series(symbol: str, days: int = Query(365, ge=30, le=1500),
                 creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    sym = symbol.strip().upper()
    if not _SYMBOL_RE.match(sym):
        _not_found()
    user = context.user_from_creds(creds)
    conn = get_conn()
    try:
        ticker_id, instrument_id, industry_id, *_ = _resolve(conn, user, sym)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT d, open, high, low, close, volume FROM price_bars "
                "WHERE ticker_id = %s AND d >= CURRENT_DATE - %s ORDER BY d",
                (ticker_id, days),
            )
            bars = [{"d": d.isoformat(), "o": float(o), "h": float(h), "l": float(lo),
                     "c": float(c), "v": int(v)} for d, o, h, lo, c, v in cur.fetchall()]
            cur.execute(
                "SELECT (ae.fired_at AT TIME ZONE 'UTC')::date, tr.key, tr.label, ae.detail "
                "FROM alert_events ae JOIN triggers tr ON tr.id = ae.trigger_id "
                "WHERE ae.instrument_id = %s AND ae.fired_at >= CURRENT_DATE - %s "
                "ORDER BY 1",
                (instrument_id, days),
            )
            alerts = [{"date": d.isoformat(), "trigger_key": k, "trigger": lab, "detail": det}
                      for d, k, lab, det in cur.fetchall()]
            cur.execute(
                "SELECT event_date, event_kind, fwd_max_move_pct, hit FROM backtest_events "
                "WHERE instrument_id = %s AND NOT synthetic_data_used "
                "AND event_date >= CURRENT_DATE - %s ORDER BY event_date",
                (instrument_id, days),
            )
            dated = [{"date": d.isoformat(), "kind": k, "max_move_pct": _f(m), "hit": h}
                     for d, k, m, h in cur.fetchall()]
            bench = None
            cur.execute(
                "SELECT t.id, t.symbol, r.label FROM reference_assets r "
                "JOIN tickers t ON t.id = r.ticker_id WHERE r.industry_id = %s "
                "ORDER BY r.sort_order LIMIT 1",
                (industry_id,),
            )
            b = cur.fetchone()
            if b:
                cur.execute(
                    "SELECT d, close FROM price_bars WHERE ticker_id = %s "
                    "AND d >= CURRENT_DATE - %s ORDER BY d",
                    (b[0], days),
                )
                bench = {"symbol": b[1], "label": b[2],
                         "bars": [{"d": d.isoformat(), "c": float(c)} for d, c in cur.fetchall()]}
            cur.execute(
                "SELECT last_ok_at, last_bar_date, last_error FROM ingest_state "
                "WHERE ticker_id = %s AND source = 'yahoo'",
                (ticker_id,),
            )
            st = cur.fetchone()
    finally:
        conn.close()
    return {
        "symbol": sym, "days": days, "bars": bars, "alerts": alerts, "dated_events": dated,
        "benchmark": bench,
        "source": {"name": "Yahoo Finance daily bars, split and dividend adjusted",
                   "last_ok_at": st[0].isoformat() if st and st[0] else None,
                   "last_bar_date": st[1].isoformat() if st and st[1] else None,
                   "last_error": st[2] if st else None},
    }


# --------------------------------------------------------------------------
# Strategy evidence pages (public, like /api/strategies)
# --------------------------------------------------------------------------

def _component_labels(cur, strategy_id):
    """Labels live on scored breakdowns, not on the version row. Take them
    from the richest breakdown in the latest run; keys fall back to
    themselves."""
    cur.execute(
        "SELECT sc.component_json FROM scores sc JOIN runs r ON r.id = sc.run_id "
        "WHERE sc.strategy_id = %s AND r.status = 'completed' "
        "ORDER BY r.as_of DESC, jsonb_array_length(sc.component_json) DESC LIMIT 1",
        (strategy_id,),
    )
    row = cur.fetchone()
    labels = {}
    for c in (row[0] if row else []) or []:
        if isinstance(c, dict) and c.get("k"):
            labels[c["k"]] = c.get("label") or c["k"]
    return labels


@router.get("/api/strategies/{key}")
def strategy_detail(key: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, key, label, monogram, calibrated, calibrated_at, "
                "resolved_outcomes_count, description, band_cutoffs_json, "
                "score_evidence_note, live_version_id, publishing_paused, "
                "publishing_paused_reason, sort_order "
                "FROM strategies WHERE key = %s",
                (key.strip().lower(),),
            )
            s = cur.fetchone()
            if not s:
                _not_found()
            sid = s[0]
            version = None
            if s[10]:
                cur.execute(
                    "SELECT version_number, state, effective_from, component_weights_json, "
                    "hard_filters_json, band_cutoffs_json, hit_definition_json, "
                    "live_outcomes_count FROM strategy_versions WHERE id = %s",
                    (s[10],),
                )
                version = cur.fetchone()
            if not version:
                cur.execute(
                    "SELECT version_number, state, effective_from, component_weights_json, "
                    "hard_filters_json, band_cutoffs_json, hit_definition_json, "
                    "live_outcomes_count FROM strategy_versions WHERE strategy_id = %s "
                    "ORDER BY effective_from DESC LIMIT 1",
                    (sid,),
                )
                version = cur.fetchone()
            labels = _component_labels(cur, sid)
            weights = dict((version[3] or {}) if version else {})
            total = sum(float(w) for w in weights.values()) or 0.0
            components = sorted(
                [{"key": k, "label": labels.get(k, k), "weight": float(w),
                  "share": round(float(w) / total, 4) if total else None}
                 for k, w in weights.items()],
                key=lambda c: -c["weight"],
            )
            # calibration record: aggregates only, never a per-name row
            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN hit THEN 1 ELSE 0 END), 0), "
                "AVG(outcome_return) FROM calibration_outcomes WHERE strategy_id = %s",
                (sid,),
            )
            n, hits, mean_ret = cur.fetchone()
            cur.execute(
                "SELECT going_in_band, COUNT(*), SUM(CASE WHEN hit THEN 1 ELSE 0 END), "
                "AVG(outcome_return) FROM calibration_outcomes WHERE strategy_id = %s "
                "GROUP BY going_in_band",
                (sid,),
            )
            by_band = {r[0]: {"n": r[1], "hits": r[2],
                              "hit_rate": round(r[2] / r[1], 3) if r[1] else None,
                              "mean_return_pct": _f(r[3])} for r in cur.fetchall()}
            cur.execute(
                "SELECT event_type, created_at, resolved_outcomes_at_event, reason "
                "FROM calibration_events WHERE strategy_id = %s "
                "ORDER BY created_at DESC LIMIT 20",
                (sid,),
            )
            timeline = [{"type": r[0], "at": r[1].isoformat(),
                         "resolved_outcomes": r[2], "reason": r[3] or ""}
                        for r in cur.fetchall()]
            run = _latest_run(cur)
            distribution, scored, mean_cov = {}, 0, None
            if run:
                cur.execute(
                    "SELECT band, COUNT(*) FROM scores WHERE run_id = %s AND strategy_id = %s "
                    "AND value IS NOT NULL GROUP BY band",
                    (run[0], sid),
                )
                distribution = {b: c for b, c in cur.fetchall()}
                scored = sum(distribution.values())
                cur.execute(
                    "SELECT AVG(components_present::float / NULLIF(components_total, 0)) "
                    "FROM scores WHERE run_id = %s AND strategy_id = %s AND value IS NOT NULL",
                    (run[0], sid),
                )
                mean_cov = _f(cur.fetchone()[0])
    finally:
        conn.close()
    return {
        "key": s[1], "label": s[2], "monogram": s[3], "calibrated": bool(s[4]),
        "calibrated_at": s[5].isoformat() if s[5] else None,
        "resolved_outcomes_count": s[6], "description": s[7] or "",
        "score_evidence_note": s[9] or "",
        "publishing_paused": bool(s[11]), "publishing_paused_reason": s[12] or "",
        "band_cutoffs": (version[5] if version else None) or s[8],
        "version": None if not version else {
            "number": version[0], "state": version[1],
            "effective_from": version[2].isoformat() if version[2] else None,
            "hit_definition": version[6], "live_outcomes_count": version[7],
        },
        "components": components, "declared_weight_total": total,
        "hard_filters": [
            {"key": f.get("key"), "label": f.get("label") or f.get("key"), "op": f.get("op"),
             "value": f.get("value"), "unit": f.get("unit")}
            for f in ((version[4] if version else None) or []) if isinstance(f, dict)
        ],
        "calibration": {
            "resolved": n, "hits": hits,
            "hit_rate": round(hits / n, 3) if n else None,
            "mean_return_pct": _f(mean_ret), "by_band": by_band,
        },
        "timeline": timeline,
        "latest_run": None if not run else {
            "id": run[0], "as_of": run[1].isoformat(), "scored": scored,
            "distribution": distribution, "mean_coverage": mean_cov,
        },
    }


# --------------------------------------------------------------------------
# Industry pages
# --------------------------------------------------------------------------

def _pct(last, base):
    if last is None or base is None or not float(base):
        return None
    return round((float(last) - float(base)) / float(base) * 100, 2)


@router.get("/api/industries/{key}")
def industry_detail(key: str,
                    creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, key, label, benchmark_etf, description, "
                "(SELECT COUNT(*) FROM instruments i WHERE i.industry_id = industries.id AND i.active) "
                "FROM industries WHERE key = %s",
                (key.strip().lower(),),
            )
            ind = cur.fetchone()
            if not ind:
                _not_found()
            cur.execute(
                "SELECT t.symbol, r.label, "
                " (SELECT close FROM price_bars p WHERE p.ticker_id = t.id ORDER BY d DESC LIMIT 1), "
                " (SELECT d FROM price_bars p WHERE p.ticker_id = t.id ORDER BY d DESC LIMIT 1), "
                " (SELECT close FROM price_bars p WHERE p.ticker_id = t.id "
                "   AND d <= CURRENT_DATE - 30 ORDER BY d DESC LIMIT 1), "
                " (SELECT close FROM price_bars p WHERE p.ticker_id = t.id "
                "   AND d <= CURRENT_DATE - 90 ORDER BY d DESC LIMIT 1) "
                "FROM reference_assets r JOIN tickers t ON t.id = r.ticker_id "
                "WHERE r.industry_id = %s ORDER BY r.sort_order LIMIT 1",
                (ind[0],),
            )
            b = cur.fetchone()
            benchmark = None if not b else {
                "symbol": b[0], "label": b[1], "last_close": _f(b[2]),
                "last_date": b[3].isoformat() if b[3] else None,
                "chg_30d": _pct(b[2], b[4]), "chg_90d": _pct(b[2], b[5]),
            }
            user = context.user_from_creds(creds, required=False)
            followed, in_scope, names, k, run_as_of = False, False, None, None, None
            if user is not None:
                uid = context.user_id(user)
                scope.provision_free(conn, uid)
                tier = scope.tier_for_user(conn, uid)
                k = tier[4] if tier else 5
                keys, _label, picks = scope.user_scope(conn, uid, tier[3] if tier else 1)
                cur.execute(
                    "SELECT 1 FROM user_industries ui WHERE ui.user_id = %s AND ui.industry_id = %s",
                    (uid, ind[0]),
                )
                followed = cur.fetchone() is not None
                in_scope = ind[1] in keys
                run = _latest_run(cur)
                if in_scope and run:
                    run_as_of = run[1].isoformat()
                    vis, vis_params = scope.visible_sql_and_params(keys, picks, "i")
                    cur.execute(
                        "SELECT t.symbol, i.theme, sc.value, sc.band, sc.components_present, "
                        "sc.components_total, sc.delta_1d "
                        "FROM scores sc JOIN instruments i ON i.id = sc.instrument_id "
                        "JOIN tickers t ON t.id = i.ticker_id "
                        "JOIN strategies st ON st.id = sc.strategy_id AND st.key = 'fast_mover' "
                        f"WHERE sc.run_id = %s AND i.industry_id = %s AND sc.value IS NOT NULL AND {vis} "
                        "ORDER BY sc.value DESC, t.symbol LIMIT %s",
                        tuple([run[0], ind[0]] + vis_params + [k]),
                    )
                    names = [
                        {"rank": n + 1, "symbol": r[0], "theme": r[1], "value": _f(r[2]),
                         "band": r[3], "components_present": r[4], "components_total": r[5],
                         "delta_1d": _f(r[6])}
                        for n, r in enumerate(cur.fetchall())
                    ]
    finally:
        conn.close()
    return {
        "key": ind[1], "label": ind[2], "benchmark_etf": ind[3], "description": ind[4] or "",
        "universe_count": ind[5], "benchmark": benchmark,
        "followed": followed, "in_scope": in_scope, "names_shown_limit": k,
        "names": names, "run_as_of": run_as_of,
    }


# --------------------------------------------------------------------------
# Digests: the on-site twin of the weekly email
# --------------------------------------------------------------------------

@router.get("/api/me/digests")
def list_digests(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = context.user_from_creds(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT d.id, d.sent_at, d.run_id, r.as_of, "
                "jsonb_array_length(COALESCE(d.content_json->'rows', '[]'::jsonb)) "
                "FROM digests d JOIN runs r ON r.id = d.run_id "
                "WHERE d.user_id = %s ORDER BY d.sent_at DESC LIMIT 52",
                (context.user_id(row),),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"digests": [
        {"id": r[0], "sent_at": r[1].isoformat(), "run_id": r[2],
         "run_as_of": r[3].isoformat(), "rows": r[4]} for r in rows
    ]}


@router.get("/api/me/digests/preview")
def preview_digest(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """What the next digest would contain if it went out now, built by the
    same function the cron job uses, so the preview is never a different
    render from the email."""
    from app.jobs import _board_rows_for

    row = context.user_from_creds(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        scope.provision_free(conn, uid)
        tier = scope.tier_for_user(conn, uid)
        if not tier:
            _not_found()
        with conn.cursor() as cur:
            run = _latest_run(cur)
        if not run:
            _not_found()
        rows, truncated = _board_rows_for(conn, uid, tier, limit=tier[4])
    finally:
        conn.close()
    return {"run_id": run[0], "run_as_of": run[1].isoformat(), "tier_key": tier[0],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "rows": rows, "truncated": truncated, "preview": True}


@router.get("/api/me/digests/{digest_id}")
def get_digest(digest_id: int,
               creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = context.user_from_creds(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT d.id, d.sent_at, d.run_id, r.as_of, d.content_json "
                "FROM digests d JOIN runs r ON r.id = d.run_id "
                "WHERE d.id = %s AND d.user_id = %s",
                (digest_id, context.user_id(row)),
            )
            d = cur.fetchone()
    finally:
        conn.close()
    if not d:
        _not_found()
    content = d[4] if isinstance(d[4], dict) else json.loads(d[4] or "{}")
    return {"id": d[0], "sent_at": d[1].isoformat(), "run_id": d[2],
            "run_as_of": d[3].isoformat(), **content}


# --------------------------------------------------------------------------
# Account utilities
# --------------------------------------------------------------------------

class NoteIn(BaseModel):
    note: str = Field(default="", max_length=280)


@router.patch("/api/me/picks/{symbol}")
def set_pick_note(symbol: str, body: NoteIn,
                  creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = context.user_from_creds(creds)
    sym = symbol.strip().upper()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE picks p SET note = %s "
                "FROM instruments i JOIN tickers t ON t.id = i.ticker_id "
                "WHERE p.instrument_id = i.id AND p.user_id = %s AND p.active AND t.symbol = %s "
                "RETURNING p.id",
                (body.note.strip(), context.user_id(row), sym),
            )
            updated = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    if not updated:
        _not_found()
    return {"symbol": sym, "note": body.note.strip()}


@router.get("/api/me/export")
def export_account(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Everything the subscriber authored, as one JSON document. Secrets
    (password hash, webhook secret, push subscription) are never included."""
    row = context.user_from_creds(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT timezone, digest_enabled, digest_day, digest_hour, channel_email, "
                "channel_push, channel_sms, phone_number, webhook_url FROM user_settings "
                "WHERE user_id = %s",
                (uid,),
            )
            s = cur.fetchone()
            settings = None if not s else dict(zip(
                ["timezone", "digest_enabled", "digest_day", "digest_hour", "channel_email",
                 "channel_push", "channel_sms", "phone_number", "webhook_url"], s))
            cur.execute(
                "SELECT i.key, i.label, ui.followed_at FROM user_industries ui "
                "JOIN industries i ON i.id = ui.industry_id WHERE ui.user_id = %s "
                "ORDER BY ui.followed_at",
                (uid,),
            )
            industries = [{"key": r[0], "label": r[1], "followed_at": r[2].isoformat()}
                          for r in cur.fetchall()]
            cur.execute(
                "SELECT t.symbol, p.pinned_at, p.score_at_pin, p.sort_order, p.active, p.note "
                "FROM picks p JOIN instruments i ON i.id = p.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id WHERE p.user_id = %s "
                "ORDER BY p.sort_order, p.pinned_at",
                (uid,),
            )
            picks = [{"symbol": r[0], "pinned_at": r[1].isoformat(), "score_at_pin": _f(r[2]),
                      "sort_order": r[3], "active": r[4], "note": r[5]} for r in cur.fetchall()]
            cur.execute(
                "SELECT t.symbol, tr.key, ar.channels, ar.armed_at FROM alert_rules ar "
                "JOIN instruments i ON i.id = ar.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "JOIN triggers tr ON tr.id = ar.trigger_id WHERE ar.user_id = %s "
                "ORDER BY ar.armed_at",
                (uid,),
            )
            rules = [{"symbol": r[0], "trigger_key": r[1], "channels": r[2],
                      "armed_at": r[3].isoformat()} for r in cur.fetchall()]
            cur.execute(
                "SELECT ae.id, t.symbol, tr.key, ae.detail, ae.fired_at, ad.channel, ad.sent_at, "
                "ad.read_at FROM alert_deliveries ad "
                "JOIN alert_events ae ON ae.id = ad.alert_event_id "
                "JOIN instruments i ON i.id = ae.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "JOIN triggers tr ON tr.id = ae.trigger_id WHERE ad.user_id = %s "
                "ORDER BY ad.sent_at DESC LIMIT 2000",
                (uid,),
            )
            deliveries = [{"event_id": r[0], "symbol": r[1], "trigger_key": r[2], "detail": r[3],
                           "fired_at": r[4].isoformat(), "channel": r[5],
                           "sent_at": r[6].isoformat(),
                           "read_at": r[7].isoformat() if r[7] else None}
                          for r in cur.fetchall()]
            cur.execute(
                "SELECT id, sent_at, run_id FROM digests WHERE user_id = %s ORDER BY sent_at DESC",
                (uid,),
            )
            digests = [{"id": r[0], "sent_at": r[1].isoformat(), "run_id": r[2]}
                       for r in cur.fetchall()]
    finally:
        conn.close()
    doc = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {"email": context.user_email(row), "name": row[6], "provider": row[7],
                    "verified": context.user_verified(row), "created_at": row[5].isoformat()},
        "settings": settings, "industries": industries, "picks": picks,
        "alert_rules": rules, "alert_deliveries": deliveries, "digests": digests,
    }
    return JSONResponse(
        doc,
        headers={"Content-Disposition":
                 f'attachment; filename="tradealert-export-{uid}.json"'},
    )


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=72)
    new: str = Field(min_length=8, max_length=72)


@router.post("/api/me/password")
def change_password(body: PasswordIn,
                    creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = context.user_from_creds(creds)
    if row[2] is None:
        raise HTTPException(
            400, "this account signs in with a provider; use the reset link to set a password")
    if not security.check_password(body.current, row[2]):
        raise HTTPException(403, "current password is incorrect")
    if len(body.new.encode("utf-8")) > 72:
        raise HTTPException(422, "password must be 8-72 bytes")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s",
                        (security.hash_password(body.new), context.user_id(row)))
        conn.commit()
    finally:
        conn.close()
    return {"changed": True}


class DeleteIn(BaseModel):
    confirm: str = Field(min_length=1, max_length=320)


@router.delete("/api/me", status_code=204)
def delete_account(body: DeleteIn,
                   creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Permanent. The typed email is the confirmation; a live paid plan must
    be cancelled through billing first so no one is charged for a deleted
    account; an account that authored operator records cannot be removed
    without breaking the audit trail and is refused."""
    row = context.user_from_creds(creds)
    uid = context.user_id(row)
    email = (context.user_email(row) or "").lower()
    if body.confirm.strip().lower() != email:
        raise HTTPException(422, "type your email address exactly to confirm")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT t.price_monthly_cents FROM subscriptions s JOIN tiers t ON t.id = s.tier_id "
                "WHERE s.user_id = %s AND s.status = 'active'",
                (uid,),
            )
            r = cur.fetchone()
            if r and r[0] > 0:
                raise HTTPException(409, "cancel your paid plan before deleting the account")
            try:
                cur.execute("DELETE FROM users WHERE id = %s", (uid,))
            except psycopg2.errors.ForeignKeyViolation:
                conn.rollback()
                raise HTTPException(
                    409, "this account owns operator records and cannot be deleted")
        conn.commit()
    finally:
        conn.close()
    return Response(status_code=204)
