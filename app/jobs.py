"""Cron jobs (BUILD_SPEC stages 8 and 10): the alert sweep and the daily
digest. Run via the cron table in deploy/crontab:

  cd /opt/tradealert && .venv/bin/python -m app.jobs digest
  cd /opt/tradealert && .venv/bin/python -m app.jobs sweep

Both are idempotent and safe to run back-to-back:
  sweep  - matches impersonal alert_events (last 24h) against armed rules,
           records deliveries, sends each channel.
  digest - builds each subscriber's board digest on their scheduled
           day/hour, freezes the render into digests.content_json, emails
           it with a per-user unsubscribe token.
"""
import json
import logging
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

from app import channels, context, email as emailer, legal, scope
from app.db import get_conn

log = logging.getLogger("tradealert.jobs")

# settings.digest_day uses BUILD_SPEC ordering 0=Sun..6=Sat.
_PY = {"0": 6, "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5}


def _now():
    tz = os.environ.get("APP_TIMEZONE", "America/New_York")
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(tz=ZoneInfo(tz))
    except Exception:  # noqa: BLE001
        return datetime.now(timezone.utc)


def sweep_alerts():
    conn = get_conn()
    try:
        cutoff = _now() - timedelta(hours=24)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ae.id, ae.instrument_id, ae.trigger_id, ae.fired_at, ae.detail, "
                "t.symbol, tr.key "
                "FROM alert_events ae "
                "JOIN instruments i ON i.id = ae.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "JOIN triggers tr ON tr.id = ae.trigger_id "
                "WHERE ae.fired_at >= %s ORDER BY ae.fired_at DESC",
                (cutoff,),
            )
            events = cur.fetchall()
        for (event_id, instrument_id, trigger_id, fired_at, detail,
             symbol, trigger_key) in events:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT ar.user_id, ar.channels, u.email, us.channel_email, "
                    "us.channel_push, us.push_subscription_json, "
                    "us.channel_sms, us.phone_number, s.tier_id "
                    "FROM alert_rules ar "
                    "JOIN users u ON u.id = ar.user_id "
                    "JOIN user_settings us ON us.user_id = ar.user_id "
                    "JOIN subscriptions s ON s.user_id = ar.user_id AND s.status = 'active' "
                    "JOIN tiers t ON t.id = s.tier_id "
                    "WHERE ar.instrument_id = %s AND ar.trigger_id = %s",
                    (instrument_id, trigger_id),
                )
                for (uid, rule_channels, email_addr, ch_email, ch_push,
                     push_sub, ch_sms, phone, _tier_id) in cur.fetchall():
                    _dispatch(conn, uid, event_id, symbol, trigger_key, detail,
                              fired_at, rule_channels, email_addr,
                              ch_email, ch_push, push_sub, ch_sms, phone)
    finally:
        conn.close()
    log.info("alert sweep complete")


def _base_url():
    return os.environ.get("APP_BASE_URL", "http://localhost:8000")


def _unsubscribe_link(conn, uid, channel="email"):
    """The link every alert and digest email carries (DESIGN_V6 §6). One
    unused token per user and channel is reused until it is spent; the
    client page /unsubscribe calls GET /api/unsubscribe with it."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT token FROM unsubscribe_tokens WHERE user_id = %s AND channel = %s "
            "AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (uid, channel),
        )
        row = cur.fetchone()
        if row:
            token = row[0]
        else:
            token = secrets.token_urlsafe(24)
            cur.execute(
                "INSERT INTO unsubscribe_tokens (token, user_id, channel) VALUES (%s, %s, %s)",
                (token, uid, channel),
            )
    conn.commit()
    return f"{_base_url()}/unsubscribe?token={token}&channel={channel}"


def alert_message(symbol, trigger_key, detail, base):
    """Subject line and plain body of one alert, shared by every channel.
    The subject carries the plain trigger word (DESIGN_V6 §7); the body says
    what changed and where to read more."""
    plain = legal.trigger_plain(trigger_key)
    title = f"{symbol}: {plain}"
    what = detail or f"A recorded fact changed on {symbol}: {plain.lower()}."
    body = f"{what}\n\nShow me the report: {base}/stock/{symbol}"
    return title, body


def _dispatch(conn, uid, event_id, symbol, trigger_key, detail, fired_at,
              rule_channels, email_addr, ch_email, ch_push, push_sub,
              ch_sms, phone):
    base = _base_url()
    title, body = alert_message(symbol, trigger_key, detail, base)
    sent = []
    with conn.cursor() as cur:
        for channel in rule_channels:
            cur.execute(
                "SELECT 1 FROM alert_deliveries WHERE user_id = %s "
                "AND alert_event_id = %s AND channel = %s",
                (uid, event_id, channel),
            )
            if cur.fetchone():
                continue
            ok = False
            if channel == "email" and ch_email:
                ok = channels.send_email(
                    email_addr,
                    f"[tradealert] {title}",
                    body + legal.email_footer(_unsubscribe_link(conn, uid, "email"),
                                              f"{base}/settings"),
                )
            elif channel == "push" and ch_push:
                ok = channels.send_push(push_sub, title, body)
            elif channel == "sms" and ch_sms:
                # no room for the paragraph: one line and the disclaimer link
                ok = channels.send_sms(
                    phone, f"[tradealert] {title} — {body}\nNot advice: {base}/legal/disclaimer")
            elif channel == "webhook":
                ok = channels.post_webhook(
                    conn, uid, {"event": "alert", "symbol": symbol,
                                "trigger_key": trigger_key, "detail": detail,
                                "fired_at": fired_at.isoformat()})
            if ok:
                # record what actually left the box
                cur.execute(
                    "INSERT INTO alert_deliveries (user_id, alert_event_id, channel) "
                    "VALUES (%s, %s, %s)",
                    (uid, event_id, channel),
                )
                sent.append(channel)
        conn.commit()
    if sent:
        log.info("delivered %s to user %s for event %s", ",".join(sent), uid, event_id)


def run_daily_digest():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM runs WHERE status = 'completed' "
                "ORDER BY as_of DESC LIMIT 1",
            )
            run = cur.fetchone()
            if not run:
                log.info("digest skipped: no completed run")
                return
            run_id = run[0]
            cur.execute(
                "SELECT u.id, u.email, us.timezone, us.digest_day, us.digest_hour, "
                "s.tier_id "
                "FROM users u "
                "JOIN user_settings us ON us.user_id = u.id "
                "JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' "
                "WHERE u.verified AND us.digest_enabled AND us.channel_email",
            )
            for uid, email_addr, tz, day, hour, tier_id in cur.fetchall():
                local = _now().astimezone(timezone.utc)
                build_day = str((_now().weekday() + 1) % 7)
                if build_day != str(day):
                    continue
                if _now().hour < hour or hour is None:
                    continue
                _send_digest(conn, uid, run_id, email_addr)
    finally:
        conn.close()
    log.info("digest pass complete")


def _board_rows_for(conn, user_id, tier_row, limit=None):
    """Visible-universe digest payload, same scope rule as the API."""
    limit = limit or tier_row[4]
    keys, _scope, picks = scope.user_scope(conn, user_id, tier_row[3])
    vis, params = scope.visible_sql_and_params(keys, picks, "i")
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
        run_id = cur.fetchone()[0]
        params = [run_id] + params
        q = (
            "SELECT t.symbol, i.theme, ind.label, sc.value, sc.band "
            "FROM scores sc JOIN instruments i ON i.id = sc.instrument_id "
            "JOIN tickers t ON t.id = i.ticker_id "
            "JOIN industries ind ON ind.id = i.industry_id "
            f"WHERE sc.run_id = %s AND {vis} "
            "ORDER BY sc.value DESC, t.symbol LIMIT %s"
        )
        cur.execute(q, tuple(params + [limit + 1]))
        rows = cur.fetchall()
    truncated = len(rows) > limit
    return [
        {"rank": i + 1, "symbol": r[0], "theme": r[1], "industry": r[2],
         "value": float(r[3]), "band": r[4]}
        for i, r in enumerate(rows[:limit])
    ], truncated


def _send_digest(conn, uid, run_id, email_addr):
    # The full tier row in scope.TIER_COLS order: _board_rows_for reads
    # index 3 as the industries limit and index 4 as names shown. A shorter
    # tuple here once put names_shown_limit in the industries slot, which
    # widened a Free digest to five industries instead of one.
    tier = scope.tier_for_user(conn, uid)
    if not tier:
        return
    rows, truncated = _board_rows_for(conn, uid, tier, limit=tier[4])
    frozen = {"run_id": run_id, "tier_key": tier[0],
              "generated_at": _now().isoformat(), "rows": rows,
              "truncated": truncated}
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO digests (user_id, run_id, content_json) "
            "VALUES (%s, %s, %s) RETURNING id",
            (uid, run_id, json.dumps(frozen)),
        )
        digest_id = cur.fetchone()[0]
    conn.commit()
    try:
        from app.record import digest_lines
        rec = digest_lines(conn, uid, days=7)
    except Exception as e:  # noqa: BLE001 - the record never blocks a digest
        log.warning("digest record lines failed for user %s: %s", uid, e)
        rec = []
    unsubscribe_url = _unsubscribe_link(conn, uid, "email")
    subject, text = digest_message(frozen, rec, _base_url(), unsubscribe_url)
    channels.send_email(email_addr, subject, text)
    log.info("digest %s sent to user %s (%s rows)", digest_id, uid, len(rows))


def digest_message(frozen, rec, base, unsubscribe_url):
    """Subject and plain body of the weekly brief: the ranked names the plan
    watches, the week measured, the links, then the fine print."""
    date = frozen["generated_at"][:10]
    lines = [f"My week, measured — {date}", "",
             "Ranked this morning (Fast Mover):"]
    for r in frozen["rows"]:
        lines.append(f"{r['rank']:>3}. {r['symbol']:<6} {r['band']:<8} "
                     f"{r['value']:5.1f}  {r['theme']}")
    if frozen["truncated"]:
        lines.append(f"\n… and more. Show me the whole list: {base}/board")
    if rec:
        lines.append("\nMy week, measured:")
        lines.extend(f"- {ln}" for ln in rec)
    lines.append(f"\nShow me my Home: {base}/home")
    lines.append("Measured, not predicted.")
    text = "\n".join(lines) + legal.email_footer(unsubscribe_url, f"{base}/settings")
    return f"[tradealert] My week, measured — {date}", text


def unsubscribe(token, channel="email"):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, used_at FROM unsubscribe_tokens "
                "WHERE token = %s AND channel = %s",
                (token, channel),
            )
            row = cur.fetchone()
            if not row or row[1]:
                conn.close()
                return False
            cur.execute("UPDATE unsubscribe_tokens SET used_at = now() WHERE token = %s",
                        (token,))
            cur.execute(
                "UPDATE user_settings SET channel_email = FALSE WHERE user_id = %s",
                (row[0],),
            )
        conn.commit()
        return True
    finally:
        conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    job = sys.argv[1] if len(sys.argv) > 1 else "digest"
    if job == "sweep":
        sweep_alerts()
    elif job == "digest":
        run_daily_digest()
    else:
        raise SystemExit(f"unknown job {job}")