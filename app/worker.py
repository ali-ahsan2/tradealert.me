"""Scheduled background work: market data, events, alerts, digests.

A plain loop rather than celery or a cron container: one process, no broker,
and the schedule is visible in one place. Each step is isolated, so a failing
source logs and the rest of the pass continues.

Intervals are deliberate. Prices refresh after the US close rather than
continuously: these are daily bars, so intraday polling would fetch the same
unfinished bar repeatedly for no gain. Earnings dates move slowly, so EDGAR
is swept a few times a day.

    python -m app.worker            # run forever
    python -m app.worker once       # one pass of everything, then exit
"""
import logging
import os
import time
import traceback
from datetime import datetime, time as dtime, timedelta, timezone

log = logging.getLogger("worker")

# Seconds between checks of the schedule itself; each task has its own gate.
TICK = 60

PRICES_EVERY_H = float(os.environ.get("PRICES_REFRESH_HOURS", "6"))
EVENTS_EVERY_H = float(os.environ.get("EVENTS_REFRESH_HOURS", "12"))
ALERTS_EVERY_M = float(os.environ.get("ALERTS_SWEEP_MINUTES", "15"))
DIGEST_HOUR_UTC = int(os.environ.get("DIGEST_HOUR_UTC", "13"))

# Housekeeping. The box is a t3.small with a 20GB root volume shared by
# Docker images, logs and Postgres, so growth is worth watching before it
# becomes an outage rather than after.
HOUSEKEEP_EVERY_H = float(os.environ.get("HOUSEKEEP_HOURS", "24"))
DISK_WARN_PCT = int(os.environ.get("DISK_WARN_PCT", "75"))
DISK_CRIT_PCT = int(os.environ.get("DISK_CRIT_PCT", "88"))
BARS_RETENTION_DAYS = int(os.environ.get("BARS_RETENTION_DAYS", "1100"))
OPS_EMAIL = os.environ.get("OPS_EMAIL", "")
ALERT_FILE = os.environ.get("ALERT_FILE", "/var/log/tradealert/alerts.log")
# One notice per severity per day; a disk alert every hour trains you to
# ignore it.
_last_notice = {}


def _run(name, fn, *a, **kw):
    started = time.time()
    try:
        out = fn(*a, **kw)
        log.info("%s ok in %.1fs: %s", name, time.time() - started, out)
        return out
    except Exception:
        log.error("%s failed:\n%s", name, traceback.format_exc())
        return None


def refresh_prices():
    from app.market_data import refresh_all
    # 1mo range covers any gap from a missed pass while staying small; the
    # upsert means re-fetching recent bars is free.
    return refresh_all(rng="1mo", stale_only=False, verbose=False)


def refresh_events():
    from app.events_ingest import ingest_earnings
    return ingest_earnings(years=2, verbose=False)


def sweep_alerts():
    from app import jobs
    return jobs.sweep_alerts()


def send_digests():
    from app import jobs
    return jobs.run_daily_digest()


def _notify(key, subject, body):
    """Alert ops at most once per key per day.

    Always writes the alert to ALERT_FILE, which is a mounted volume the
    host can tail or mail out. Email is attempted on top of that, but SES
    returns "skipped" when unconfigured, so the file is what guarantees a
    disk warning is not lost silently.
    """
    today = datetime.now(timezone.utc).date()
    if _last_notice.get(key) == today:
        return False
    _last_notice[key] = today

    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    line = f"[{stamp}] {subject}\n{body}\n{'-' * 60}\n"
    try:
        with open(ALERT_FILE, "a") as fh:
            fh.write(line)
    except Exception:
        log.error("could not write %s", ALERT_FILE)
    log.warning("ALERT %s: %s", key, subject)

    if not OPS_EMAIL:
        return False
    try:
        from app.email import send_email
        for addr in [a.strip() for a in OPS_EMAIL.split(",") if a.strip()]:
            result = send_email(addr, subject, body)
            if result == "skipped":
                log.warning("email not configured; alert is in %s", ALERT_FILE)
        return True
    except Exception:
        log.error("notify failed:\n%s", traceback.format_exc())
        return False


def housekeeping():
    """Prune old rows, then report disk. Returns a summary dict."""
    import shutil
    from app.db import get_conn

    pruned = 0
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Bars older than the retention window cannot back any event we
            # still resolve, so they are dead weight.
            cur.execute(
                "DELETE FROM price_bars WHERE d < (CURRENT_DATE - %s)",
                (BARS_RETENTION_DAYS,))
            pruned = cur.rowcount
            # Failed-ingest rows for symbols that later succeeded are noise.
            cur.execute(
                "DELETE FROM ingest_state WHERE last_error IS NOT NULL "
                "AND last_ok_at IS NOT NULL AND last_ok_at > last_error_at")
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
            db_size = cur.fetchone()[0]
    finally:
        conn.close()

    usage = shutil.disk_usage("/")
    pct = round(usage.used / usage.total * 100)
    free_gb = usage.free / 1e9
    summary = {"pruned_bars": pruned, "db": db_size,
               "disk_pct": pct, "free_gb": round(free_gb, 1)}

    if pct >= DISK_CRIT_PCT:
        _notify("disk_crit",
                f"[tradealert] DISK CRITICAL {pct}% used",
                f"Root volume is {pct}% full with {free_gb:.1f} GB free on "
                f"3.219.6.29.\nPostgres database: {db_size}\n"
                f"Pruned {pruned} expired price bars this pass.\n\n"
                f"Reclaim space:\n"
                f"  sudo docker image prune -af\n"
                f"  sudo docker builder prune -af\n"
                f"  sudo journalctl --vacuum-time=3d\n")
    elif pct >= DISK_WARN_PCT:
        _notify("disk_warn",
                f"[tradealert] disk {pct}% used",
                f"Root volume is {pct}% full, {free_gb:.1f} GB free.\n"
                f"Postgres database: {db_size}\n"
                f"Not urgent yet; crosses critical at {DISK_CRIT_PCT}%.\n")
    return summary


def one_pass():
    _run("prices", refresh_prices)
    _run("events", refresh_events)
    _run("alerts", sweep_alerts)
    _run("digest", send_digests)
    _run("housekeeping", housekeeping)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    log.info("worker up: prices=%sh events=%sh alerts=%sm digest=%02d:00Z",
             PRICES_EVERY_H, EVENTS_EVERY_H, ALERTS_EVERY_M, DIGEST_HOUR_UTC)

    now = time.time()
    # Stagger the first runs so a restart does not fire everything at once.
    next_prices = now + 30
    next_events = now + 300
    next_alerts = now + 60
    next_housekeep = now + 120
    last_digest_day = None

    while True:
        now = time.time()
        if now >= next_prices:
            _run("prices", refresh_prices)
            next_prices = now + PRICES_EVERY_H * 3600
        if now >= next_events:
            _run("events", refresh_events)
            next_events = now + EVENTS_EVERY_H * 3600
        if now >= next_alerts:
            _run("alerts", sweep_alerts)
            next_alerts = now + ALERTS_EVERY_M * 60
        if now >= next_housekeep:
            _run("housekeeping", housekeeping)
            next_housekeep = now + HOUSEKEEP_EVERY_H * 3600

        utc = datetime.now(timezone.utc)
        if utc.hour == DIGEST_HOUR_UTC and last_digest_day != utc.date():
            _run("digest", send_digests)
            last_digest_day = utc.date()

        time.sleep(TICK)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        logging.basicConfig(level=logging.INFO,
                            format="%(asctime)s %(levelname)s %(name)s %(message)s")
        one_pass()
    else:
        main()
