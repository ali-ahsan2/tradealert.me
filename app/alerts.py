"""Alert surface (BUILD_SPEC stage 8): rule CRUD over the impersonal
event feed. Firing and delivery live in app/jobs.py (cron); channels
in app/channels.py."""
from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app import context, scope
from app.db import get_conn

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

CHANNELS = {"email", "push", "sms", "webhook"}


def _require_user(creds):
    return context.user_from_creds(creds)


def _latest_run_id(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
        r = cur.fetchone()
        return r[0] if r else None


class RuleIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=12)
    trigger_key: str = Field(min_length=1, max_length=64)
    channels: list[str] = ["email"]


class ReadIn(BaseModel):
    event_id: int | None = None
    all: bool = False


class ChannelsIn(BaseModel):
    channels: list[str] = Field(min_length=1)


@router.get("/api/me/alerts/rules")
def list_rules(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ar.id, t.symbol, tr.key, tr.label, ar.channels, ar.armed_at "
                "FROM alert_rules ar "
                "JOIN instruments i ON i.id = ar.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "JOIN triggers tr ON tr.id = ar.trigger_id "
                "WHERE ar.user_id = %s ORDER BY ar.armed_at DESC",
                (uid,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"rules": [
        {"id": r[0], "symbol": r[1], "trigger_key": r[2], "trigger": r[3],
         "channels": r[4], "armed_at": r[5].isoformat()} for r in rows
    ]}


@router.post("/api/me/alerts/rules")
def arm_rule(body: RuleIn,
             creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    if not context.user_verified(row):
        raise HTTPException(403, "verify your email before arming alerts")
    bad = set(body.channels) - CHANNELS
    if bad:
        raise HTTPException(422, f"unknown channel(s): {', '.join(sorted(bad))}")
    if not body.channels:
        raise HTTPException(422, "choose at least one channel")
    conn = get_conn()
    try:
        scope.provision_free(conn, uid)
        tier = scope.tier_for_user(conn, uid)
        tier_channels = set(tier[7]) if tier else {"email"}
        not_allowed = set(body.channels) - tier_channels
        if not_allowed:
            raise HTTPException(
                403, f"channel(s) {', '.join(sorted(not_allowed))} not in your plan")
        alerts_limit = tier[6] if tier else 0
        sym = body.symbol.strip().upper()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT i.id, t.symbol FROM instruments i JOIN tickers t ON t.id = i.ticker_id "
                "WHERE t.symbol = %s AND i.active LIMIT 1",
                (sym,),
            )
            instrument = cur.fetchone()
            if not instrument:
                raise HTTPException(404, "not found")
            cur.execute("SELECT id FROM triggers WHERE key = %s", (body.trigger_key,))
            trigger = cur.fetchone()
            if not trigger:
                raise HTTPException(404, "not found")
            if alerts_limit is not None:
                cur.execute("SELECT COUNT(*) FROM alert_rules WHERE user_id = %s", (uid,))
                if cur.fetchone()[0] >= alerts_limit:
                    raise HTTPException(
                        403, f"your plan arms {alerts_limit} alert{'s' if alerts_limit == 1 else ''}; upgrade for more")
            cur.execute(
                "INSERT INTO alert_rules (user_id, instrument_id, trigger_id, channels) "
                "VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (user_id, instrument_id, trigger_id) DO UPDATE SET "
                "channels = EXCLUDED.channels, armed_at = now() "
                "RETURNING id, channels, armed_at",
                (uid, instrument[0], trigger[0], body.channels),
            )
            r = cur.fetchone()
        conn.commit()
        return {"rule": {"id": r[0], "symbol": sym, "trigger_key": body.trigger_key,
                         "channels": r[1], "armed_at": r[2].isoformat()}}
    finally:
        conn.close()


@router.delete("/api/me/alerts/rules/{rule_id}")
def disarm_rule(rule_id: int,
                creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM alert_rules WHERE id = %s AND user_id = %s",
                (rule_id, uid),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "not found")
        conn.commit()
        return {"disarmed": rule_id}
    finally:
        conn.close()


@router.patch("/api/me/alerts/rules/{rule_id}")
def set_rule_channels(rule_id: int, body: ChannelsIn,
                      creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Change where an armed alert is delivered without re-arming it."""
    row = _require_user(creds)
    uid = context.user_id(row)
    bad = set(body.channels) - CHANNELS
    if bad:
        raise HTTPException(422, f"unknown channel(s): {', '.join(sorted(bad))}")
    conn = get_conn()
    try:
        tier = scope.tier_for_user(conn, uid)
        tier_channels = set(tier[7]) if tier else {"email"}
        not_allowed = set(body.channels) - tier_channels
        if not_allowed:
            raise HTTPException(
                403, f"channel(s) {', '.join(sorted(not_allowed))} not in your plan")
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE alert_rules SET channels = %s WHERE id = %s AND user_id = %s "
                "RETURNING id, channels",
                (sorted(set(body.channels)), rule_id, uid),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(404, "not found")
        conn.commit()
        return {"rule": {"id": r[0], "channels": r[1]}}
    finally:
        conn.close()


@router.get("/api/alert-events")
def alert_events(limit: int = 50, trigger: str = "", symbol: str = "",
                 unread: int = 0, days: int = 365,
                 creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Impersonal event feed, filtered to the viewer's visible universe
    (same scope helpers as board/stock). Each event carries what reached
    this subscriber and whether they have read it; filters live in the
    query string so a filtered view is linkable."""
    conn = get_conn()
    try:
        user = context.user_from_creds(creds, required=True)
        uid = context.user_id(user)
        scope.provision_free(conn, uid)
        tier = scope.tier_for_user(conn, uid)
        keys, _scope, picks = scope.user_scope(conn, uid, tier[3] if tier else 1)
        vis, vis_params = scope.visible_sql_and_params(keys, picks, "i")
        where = [vis, "ae.fired_at >= now() - make_interval(days => %s)"]
        params = [uid, uid, uid] + vis_params + [max(1, min(days, 3650))]
        if trigger:
            where.append("tr.key = %s")
            params.append(trigger.strip().lower())
        if symbol:
            where.append("t.symbol = %s")
            params.append(symbol.strip().upper())
        if unread:
            where.append(
                "EXISTS (SELECT 1 FROM alert_deliveries ad WHERE ad.alert_event_id = ae.id "
                "AND ad.user_id = %s AND ad.read_at IS NULL)")
            params.append(uid)
        q = (
            "SELECT ae.id, t.symbol, i.theme, tr.key, tr.label, ae.detail, ae.fired_at, "
            "(SELECT array_agg(ad.channel ORDER BY ad.channel) FROM alert_deliveries ad "
            " WHERE ad.alert_event_id = ae.id AND ad.user_id = %s) AS channels, "
            "(SELECT bool_and(ad.read_at IS NOT NULL) FROM alert_deliveries ad "
            " WHERE ad.alert_event_id = ae.id AND ad.user_id = %s) AS all_read, "
            "(SELECT MAX(ad.sent_at) FROM alert_deliveries ad "
            " WHERE ad.alert_event_id = ae.id AND ad.user_id = %s) AS delivered_at "
            "FROM alert_events ae "
            "JOIN instruments i ON i.id = ae.instrument_id "
            "JOIN tickers t ON t.id = i.ticker_id "
            "JOIN triggers tr ON tr.id = ae.trigger_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY ae.fired_at DESC LIMIT %s"
        )
        params.append(min(max(limit, 1), 200))
        with conn.cursor() as cur:
            cur.execute(q, tuple(params))
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"events": [
        {"id": r[0], "symbol": r[1], "theme": r[2], "trigger_key": r[3], "trigger": r[4],
         "detail": r[5], "fired_at": r[6].isoformat(),
         "channels": r[7] or [], "delivered": len(r[7] or []),
         "read": bool(r[8]) if r[8] is not None else None,
         "delivered_at": r[9].isoformat() if r[9] else None}
        for r in rows
    ]}


@router.get("/api/me/alerts/unread")
def unread_count(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Distinct events delivered to this subscriber and not yet read; the
    navigation badge."""
    row = _require_user(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT alert_event_id) FROM alert_deliveries "
                "WHERE user_id = %s AND read_at IS NULL",
                (context.user_id(row),),
            )
            n = cur.fetchone()[0]
    finally:
        conn.close()
    return {"count": n}


@router.post("/api/me/alerts/read")
def mark_read(body: ReadIn,
              creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    if body.event_id is None and not body.all:
        raise HTTPException(422, "pass an event_id or all=true")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if body.all:
                cur.execute(
                    "UPDATE alert_deliveries SET read_at = now() "
                    "WHERE user_id = %s AND read_at IS NULL",
                    (uid,),
                )
            else:
                cur.execute(
                    "UPDATE alert_deliveries SET read_at = now() "
                    "WHERE user_id = %s AND alert_event_id = %s AND read_at IS NULL",
                    (uid, body.event_id),
                )
            n = cur.rowcount
        conn.commit()
        return {"read": True, "updated": n}
    finally:
        conn.close()