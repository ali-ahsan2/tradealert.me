"""Dev fixture: enough stored data to exercise every subscriber screen on a
laptop, plus a ready-made login. Never for a production database.

    DEV_FIXTURE=1 python db/seed_dev.py

What it writes, all tagged so it can be found and removed:
  - snapshots for every active instrument, two as_of points each
    (source = 'dev_fixture'), including a next earnings date for most names
  - synthetic daily bars for every instrument and reference asset
    (source = 'dev_fixture'); a seeded random walk, not market data
  - three earlier completed runs (1, 9 and 35 days before the seeded run)
    with jittered copies of the seeded scores, and delta_1d on the latest
  - impersonal alert events (detail prefixed '[dev fixture]')
  - backtest events flagged synthetic_data_used = TRUE
    (provenance {"source": "dev_fixture"}); they show in the Lab under its
    synthetic banner and never reach a subscriber screen, which is the
    production rule, so past-reaction panels stay empty until a real
    ingest runs
  - a verified Pro admin login: dev@example.com / devpass123, following
    three industries, with picks, armed rules and a few unread deliveries

Refuses to run unless DEV_FIXTURE=1 is set, and refuses when the database
already holds bars or snapshots from a real source (pass --force to
override on a box you are sure is disposable). Re-running replaces only
its own rows."""
import argparse
import io
import json
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import security  # noqa: E402
from app.db import get_conn  # noqa: E402

TAG = "dev_fixture"
DEV_EMAIL = "dev@example.com"
DEV_PASSWORD = "devpass123"
DEV_INDUSTRIES = ("energy_nuclear", "semiconductors", "defense_space")
DEV_PICKS = ("LEU", "UAMY", "BWXT", "ATI")
DEV_RULES = (("LEU", "catalyst_dated"), ("UAMY", "volume_3x"), ("LEU", "si_cross"))
RUN_OFFSETS = (1, 9, 35)


def rnd(*parts):
    return random.Random(":".join(str(p) for p in parts))


def _refuse_if_real(cur, force):
    cur.execute("SELECT COUNT(*) FROM price_bars WHERE source <> %s", (TAG,))
    bars = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM snapshots WHERE source <> %s", (TAG,))
    snaps = cur.fetchone()[0]
    if (bars or snaps) and not force:
        raise SystemExit(
            f"refusing: {bars} bars and {snaps} snapshots from a real source exist; "
            "this fixture is for empty dev databases (--force to override)")


def ensure_dev_user(cur):
    cur.execute("SELECT id FROM users WHERE email = %s", (DEV_EMAIL,))
    row = cur.fetchone()
    if row:
        uid = row[0]
    else:
        cur.execute(
            "INSERT INTO users (email, password_hash, verified, is_admin) "
            "VALUES (%s, %s, TRUE, TRUE) RETURNING id",
            (DEV_EMAIL, security.hash_password(DEV_PASSWORD)))
        uid = cur.fetchone()[0]
    cur.execute("SELECT id FROM tiers WHERE key = 'pro'")
    pro = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO subscriptions (user_id, tier_id) VALUES (%s, %s) "
        "ON CONFLICT (user_id) DO UPDATE SET tier_id = EXCLUDED.tier_id, status = 'active'",
        (uid, pro))
    cur.execute("INSERT INTO user_settings (user_id) VALUES (%s) ON CONFLICT (user_id) DO NOTHING", (uid,))
    for key in DEV_INDUSTRIES:
        cur.execute(
            "INSERT INTO user_industries (user_id, industry_id) "
            "SELECT %s, id FROM industries WHERE key = %s ON CONFLICT DO NOTHING",
            (uid, key))
    return uid


def seed_user_data(cur, uid, now):
    for n, sym in enumerate(DEV_PICKS):
        cur.execute(
            "INSERT INTO picks (user_id, instrument_id, pinned_at, score_at_pin, sort_order, active) "
            "SELECT %s, i.id, %s, sc.value, %s, TRUE FROM instruments i "
            "JOIN tickers t ON t.id = i.ticker_id "
            "LEFT JOIN scores sc ON sc.instrument_id = i.id AND sc.run_id = "
            " (SELECT id FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1) "
            " AND sc.strategy_id = (SELECT id FROM strategies WHERE key = 'fast_mover') "
            "WHERE t.symbol = %s AND i.active "
            "AND NOT EXISTS (SELECT 1 FROM picks p WHERE p.user_id = %s AND p.instrument_id = i.id) "
            "LIMIT 1",
            (uid, now - timedelta(days=40), n, sym, uid))
    for sym, trig in DEV_RULES:
        cur.execute(
            "INSERT INTO alert_rules (user_id, instrument_id, trigger_id, channels) "
            "SELECT %s, i.id, tr.id, '{email}' FROM instruments i "
            "JOIN tickers t ON t.id = i.ticker_id, triggers tr "
            "WHERE t.symbol = %s AND i.active AND tr.key = %s "
            "ON CONFLICT DO NOTHING",
            (uid, sym, trig))


def seed_snapshots(cur, names, now):
    cur.execute("DELETE FROM snapshots WHERE source = %s", (TAG,))
    rows = []
    today = now.date()
    for tid, sym, _iid, _ind in names:
        r = rnd(sym, "snap")
        px = round(r.uniform(2, 180), 2)
        cap = round(r.uniform(80, 5000), 1)
        so = round(cap / px, 1)
        base = {
            "px": px, "cap_usd_m": cap, "so_m": so,
            "float_m": round(so * r.uniform(0.4, 0.95), 1),
            "si_pct_float": round(r.uniform(1, 38), 1), "dtc": round(r.uniform(0.5, 12), 1),
            "fee_pct": round(r.uniform(0.3, 60), 1), "volx20d": round(r.uniform(0.3, 5.5), 2),
            "run3m_pct": round(r.uniform(-45, 160), 1), "off_high_pct": round(-r.uniform(0, 70), 1),
            "day_pct": round(r.uniform(-9, 12), 2), "growth_pct": round(r.uniform(-20, 140), 1),
        }
        for k, as_of in ((0, now - timedelta(days=22)), (1, now - timedelta(hours=14))):
            j = 1 + (r.uniform(-0.12, 0.12) if k == 0 else 0)
            for f, v in base.items():
                val = v if f in ("so_m", "float_m", "off_high_pct", "day_pct", "growth_pct") else round(v * j, 2)
                rows.append((tid, f, str(val), TAG, as_of, as_of))
        if r.random() < 0.65:
            ed = today + timedelta(days=r.randint(-3, 75))
            rows.append((tid, "earnings", ed.isoformat(), TAG, now - timedelta(hours=14), now))
            rows.append((tid, "earnings_conf", r.choice(["confirmed", "estimated"]), TAG,
                         now - timedelta(hours=14), now))
    cur.executemany(
        "INSERT INTO snapshots (ticker_id, field, value, source, as_of, fetched_at) "
        "VALUES (%s, %s, %s, %s, %s, %s)", rows)
    return len(rows)


def seed_bars(cur, ticker_rows, now):
    cur.execute("DELETE FROM price_bars WHERE source = %s", (TAG,))
    today = now.date()
    buf = io.StringIO()
    n = 0
    for tid, sym in ticker_rows:
        r = rnd(sym, "bars")
        p = r.uniform(5, 150)
        d = today - timedelta(days=420)
        while d <= today:
            if d.weekday() < 5:
                o = p
                c = max(0.5, p * (1 + r.gauss(0.0005, 0.03)))
                h = max(o, c) * (1 + abs(r.gauss(0, 0.012)))
                lo = min(o, c) * (1 - abs(r.gauss(0, 0.012)))
                v = int(abs(r.gauss(1.2e6, 6e5))) + 1000
                buf.write(f"{tid}\t{d.isoformat()}\t{o:.4f}\t{h:.4f}\t{lo:.4f}\t{c:.4f}\t{c:.4f}\t{v}\t{TAG}\t{now.isoformat()}\n")
                p = c
                n += 1
            d += timedelta(days=1)
    buf.seek(0)
    cur.copy_from(buf, "price_bars", columns=(
        "ticker_id", "d", "open", "high", "low", "close", "raw_close", "volume", "source", "fetched_at"))
    return n


def seed_runs(cur):
    """Earlier runs as jittered copies of the newest real seeded run. The
    fixture runs are keyed by their as_of so re-running replaces them."""
    cur.execute(
        "SELECT id, as_of FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
    latest = cur.fetchone()
    if not latest:
        print("no completed run to derive earlier runs from; skipping")
        return 0
    latest_id, latest_as_of = latest
    cur.execute("SELECT id, band_cutoffs_json FROM strategies WHERE key = 'fast_mover'")
    sid, cutoffs = cur.fetchone()

    def band_for(v):
        for name, lo in (("strong", cutoffs.get("strong", 75)), ("elevated", cutoffs.get("elevated", 50)),
                         ("neutral", cutoffs.get("neutral", 25))):
            if v >= lo:
                return name
        return "weak"

    cur.execute(
        "SELECT instrument_id, value, band, components_present, components_total, shrinkage_applied, "
        "shrinkage_from, component_json, haircut_json, hard_filter_json, strategy_version_id "
        "FROM scores WHERE run_id = %s AND strategy_id = %s", (latest_id, sid))
    scores = cur.fetchall()
    made = 0
    for back in RUN_OFFSETS:
        as_of = latest_as_of - timedelta(days=back)
        cur.execute("DELETE FROM runs WHERE as_of = %s AND id <> %s", (as_of, latest_id))
        cur.execute(
            "INSERT INTO runs (as_of, started_at, completed_at, status) VALUES (%s, %s, %s, 'completed') "
            "RETURNING id", (as_of, as_of, as_of))
        rid = cur.fetchone()[0]
        for s in scores:
            r = rnd(s[0], "run", back)
            if r.random() < 0.06:
                continue  # scored now, not then: shows as "new"
            v = max(0.0, min(100.0, float(s[1]) + r.gauss(0, 6 + back / 4)))
            comps, pres = s[7], s[3]
            if r.random() < 0.1 and comps:
                comps, pres = comps[:-1], max(0, pres - 1)
            hf = s[9]
            if hf and r.random() < 0.12:
                hf = [dict(f, **{"pass": not f.get("pass")}) if i == 0 else f for i, f in enumerate(hf)]
            cur.execute(
                "INSERT INTO scores (run_id, instrument_id, strategy_id, value, band, components_present, "
                "components_total, shrinkage_applied, shrinkage_from, component_json, haircut_json, "
                "hard_filter_json, strategy_version_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (rid, s[0], sid, round(v, 1), band_for(v), pres, s[4], s[5], s[6], json.dumps(comps),
                 json.dumps(s[8]), json.dumps(hf) if hf else None, s[10]))
        made += 1
    cur.execute(
        "SELECT id FROM runs WHERE status = 'completed' AND as_of < %s ORDER BY as_of DESC LIMIT 1",
        (latest_as_of,))
    prev_id = cur.fetchone()[0]
    cur.execute(
        "UPDATE scores a SET delta_1d = a.value - b.value FROM scores b "
        "WHERE a.run_id = %s AND b.run_id = %s AND a.instrument_id = b.instrument_id "
        "AND a.strategy_id = b.strategy_id", (latest_id, prev_id))
    return made


def seed_alert_events(cur, names, now):
    cur.execute("DELETE FROM alert_events WHERE detail LIKE %s", (f"[{TAG}]%",))
    cur.execute("SELECT id, key, label FROM triggers")
    trig = cur.fetchall()
    n = 0
    for tid, sym, iid, _ind in names[:120]:
        r = rnd(sym, "alerts")
        for _ in range(r.randint(0, 4)):
            t = r.choice(trig)
            when = now - timedelta(days=r.randint(1, 200), hours=r.randint(0, 20))
            cur.execute(
                "INSERT INTO alert_events (instrument_id, trigger_id, fired_at, detail) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (iid, t[0], when, f"[{TAG}] {t[2]} on {sym}"))
            n += cur.rowcount
    return n


def seed_backtest_events(cur, names, now):
    cur.execute("DELETE FROM backtest_events WHERE provenance_json->>'source' = %s", (TAG,))
    today = now.date()
    n = 0
    for _tid, sym, iid, _ind in names[:90]:
        r = rnd(sym, "events")
        for _ in range(r.randint(1, 4)):
            ed = today - timedelta(days=r.randint(2, 700))
            resolved = ed < today - timedelta(days=8)
            mx = round(r.gauss(9, 14), 2)
            cl = round(mx * r.uniform(-0.6, 0.9), 2)
            vs = round(abs(r.gauss(1.8, 1.2)), 2)
            hit = (abs(mx) >= 20 or vs >= 3) if resolved else None
            cur.execute(
                "INSERT INTO backtest_events (instrument_id, event_date, event_kind, inputs_json, "
                "provenance_json, fwd_max_move_pct, fwd_close_move_pct, fwd_vol_spike_x, hit, resolved_at, "
                "data_complete, synthetic_data_used, days_to_move) "
                "VALUES (%s, %s, %s, '{}', %s, %s, %s, %s, %s, %s, TRUE, TRUE, %s) ON CONFLICT DO NOTHING",
                (iid, ed, r.choice(["earnings", "earnings", "contract_award", "fda"]),
                 json.dumps({"source": TAG}),
                 mx if resolved else None, cl if resolved else None, vs if resolved else None, hit,
                 (datetime.combine(ed, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=7))
                 if resolved else None,
                 r.randint(1, 5) if hit else None))
            n += cur.rowcount
    return n


def seed_deliveries(cur, uid):
    cur.execute(
        "INSERT INTO alert_deliveries (user_id, alert_event_id, channel, sent_at) "
        "SELECT %s, ae.id, 'email', ae.fired_at FROM alert_events ae "
        "JOIN picks p ON p.instrument_id = ae.instrument_id AND p.user_id = %s AND p.active "
        "WHERE ae.detail LIKE %s ON CONFLICT DO NOTHING",
        (uid, uid, f"[{TAG}]%"))
    return cur.rowcount


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="load even if real bars or snapshots exist")
    args = ap.parse_args()
    if os.environ.get("DEV_FIXTURE") != "1":
        raise SystemExit("set DEV_FIXTURE=1 to confirm this is a development database")
    now = datetime.now(timezone.utc)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            _refuse_if_real(cur, args.force)
            cur.execute(
                "SELECT t.id, t.symbol, i.id, i.industry_id FROM instruments i "
                "JOIN tickers t ON t.id = i.ticker_id WHERE i.active ORDER BY t.symbol")
            names = cur.fetchall()
            if not names:
                raise SystemExit("no instruments: run db/seed_universe.py (or db/bootstrap.py) first")
            cur.execute("SELECT t.id, t.symbol FROM reference_assets r JOIN tickers t ON t.id = r.ticker_id")
            refs = cur.fetchall()
            uid = ensure_dev_user(cur)
            print(f"snapshots: {seed_snapshots(cur, names, now)}")
            print(f"bars: {seed_bars(cur, [(n[0], n[1]) for n in names] + list(refs), now)}")
            print(f"earlier runs: {seed_runs(cur)}")
            print(f"alert events: {seed_alert_events(cur, names, now)}")
            print(f"synthetic backtest events: {seed_backtest_events(cur, names, now)}")
            seed_user_data(cur, uid, now)
            print(f"deliveries to dev user: {seed_deliveries(cur, uid)}")
        conn.commit()
    finally:
        conn.close()
    print(f"dev login: {DEV_EMAIL} / {DEV_PASSWORD} (Pro, admin, follows {', '.join(DEV_INDUSTRIES)})")


if __name__ == "__main__":
    main()
