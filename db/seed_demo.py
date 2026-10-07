"""Demo alert events for the sandbox (BUILD_SPEC stage 8).

Alert events are impersonal: one row per (instrument, trigger, day),
fired by the ingest pipeline regardless of subscribers. This seeds a
small set of realistic fired events around the run's as_of so the
alerts surface has something to render. Idempotent.

Run:  docker exec -i tradealertme-app-1 python db/seed_demo.py
Needs app/db on the path and DATABASE_URL in the env (the app
container already has both).
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_conn

# (symbol, trigger_key, days_before_run_as_of, detail)
EVENTS = [
    ("PDYN", "catalyst_dated", 12, "FY26 guide raised to +357-415% y/y at Q2 print; earnings call dated"),
    ("PDYN", "volume_3x", 9, "3.8x the 20-day average on the guide"),
    ("PDYN", "band_change", 6, "score crossed 40 -> 70 as coverage filled in"),
    ("LEU", "si_cross", 11, "FINRA short interest print crossed 15%"),
    ("NNE", "borrow_fee_2x", 10, "borrow fee 2.4x the 20-day baseline"),
    ("NNE", "contract_award", 5, "multi-unit microreactor award with dollar figure"),
    ("BKSY", "volume_3x", 8, "3.2x the 20-day average, no fundamental driver dated"),
    ("SERV", "s3_424b", 3, "S-3ASR shelf filed; instant-disqualifier alert"),
    ("LTBR", "catalyst_dated", 14, "HALEU supply award within look-ahead"),
    ("PDFS", "band_change", 2, "score crossed 52 into elevated as short data updated"),
]

AS_OF = datetime(2026, 8, 9, 11, 21, 4, tzinfo=timezone.utc)

conn = get_conn()
try:
    with conn.cursor() as cur:
        for symbol, trigger_key, days_before, detail in EVENTS:
            cur.execute("SELECT id FROM tickers WHERE symbol = %s", (symbol,))
            ticker = cur.fetchone()
            if not ticker:
                print(f"skip {symbol}: no ticker", flush=True)
                continue
            cur.execute("SELECT id FROM instruments WHERE ticker_id = %s ORDER BY active DESC LIMIT 1", (ticker[0],))
            instr = cur.fetchone()
            if not instr:
                print(f"skip {symbol}: no instrument", flush=True)
                continue
            cur.execute("SELECT id FROM triggers WHERE key = %s", (trigger_key,))
            trig = cur.fetchone()
            if not trig:
                print(f"skip {symbol}/{trigger_key}: no trigger", flush=True)
                continue
            cur.execute(
                "INSERT INTO alert_events (instrument_id, trigger_id, fired_at, detail) "
                "VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (instrument_id, trigger_id, fired_on) DO NOTHING",
                (instr[0], trig[0], AS_OF - timedelta(days=days_before), detail),
            )
            if cur.rowcount:
                print(f"seeded {symbol} {trigger_key} ", flush=True)
        conn.commit()
finally:
    conn.close()
print("done", flush=True)