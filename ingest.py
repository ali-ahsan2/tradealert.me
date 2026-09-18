#!/usr/bin/env python3
"""ingest.py — pull live market data and write it into the Postgres snapshots
table as timestamped key-value rows.

Reuses the fetchers in refresh.py (the reference implementation): no scoring
or strategy logic lives here. Each fetched field becomes one snapshot row;
the row's as_of comes from the value's own vintage timestamp where one exists
(for example price uses px_asof, float/SI/cap use stats_asof, borrow uses
fee_asof, and short-interest fields use the FINRA settlement date si_asof so
their bi-weekly staleness is never dressed up as fresh).

Usage:
  python ingest.py --tickers AAPL,MSFT
  python ingest.py --all
  python ingest.py --all --stats-max-age 7
"""

import argparse
import datetime as dt
import sys

import refresh
from app.db import get_conn

# field -> source group, inverted from refresh.FIELD_GROUPS
SOURCE = {}
for _group, _fields in refresh.FIELD_GROUPS.items():
    for _f in _fields:
        SOURCE[_f] = _group

# group -> the asof field that records that group's vintage
GROUP_ASOF = {
    "chart": "px_asof",
    "stats": "stats_asof",
    "borrow": "fee_asof",
}

# SI fields carry the FINRA settlement date, not the fetch time
SI_ASOF_FIELDS = {"si_pct_float", "si_shares_m", "dtc"}


def parse_asof(value):
    if not value:
        return None
    s = str(value)
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    return None


def resolve_asof(rec, field):
    asof = None
    if field in SI_ASOF_FIELDS:
        asof = parse_asof(rec.get("si_asof"))
    if asof is None:
        owner = SOURCE.get(field)
        if owner:
            asof = parse_asof(rec.get(GROUP_ASOF[owner]))
    return asof


def load_previous(conn, symbol):
    """Reconstruct the last known per-field block for a ticker, in the shape
    refresh_ticker expects, so a failed fetch can carry it forward."""
    with conn.cursor() as cur:
        cur.execute(
            """WITH last AS (
                   SELECT DISTINCT ON (s.field) s.field, s.value, s.as_of
                   FROM snapshots s JOIN tickers t ON t.id = s.ticker_id
                   WHERE t.symbol = %s
                   ORDER BY s.field, s.as_of DESC, s.id DESC
               )
               SELECT field, value, as_of FROM last""",
            (symbol,),
        )
        rows = cur.fetchall()
    if not rows:
        return None

    rec = {}
    group_when = {}
    si_when = None
    for field, value, as_of in rows:
        rec[field] = value
        src = SOURCE.get(field)
        if src and (src not in group_when or as_of > group_when[src]):
            group_when[src] = as_of
        if field in SI_ASOF_FIELDS and (si_when is None or as_of > si_when):
            si_when = as_of

    def iso(when):
        return when.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for group, asof_key in GROUP_ASOF.items():
        if asof_key not in rec and group_when.get(group):
            rec[asof_key] = iso(group_when[group])
    if si_when and "si_asof" not in rec:
        rec["si_asof"] = si_when.date().isoformat()
    return rec


def write_ticker(conn, symbol, rec, old):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO tickers (symbol, last_refreshed_at)
               VALUES (%s, now())
               ON CONFLICT (symbol) DO UPDATE SET last_refreshed_at = now()
               RETURNING id""",
            (symbol,),
        )
        ticker_id = cur.fetchone()[0]
        fetched = dt.datetime.now(dt.timezone.utc)
        rows = []
        for field, value in rec.items():
            if field == "errors" or field.endswith("_asof") or value is None:
                continue
            asof = resolve_asof(rec, field) or fetched
            # a fetch that changed nothing is a no-op snapshot: keep the
            # timeline free of identical (value, vintage) repeats
            if old is not None and old.get(field) == str(value) \
                    and resolve_asof(old, field) == asof:
                continue
            rows.append((ticker_id, field, str(value), SOURCE.get(field, "refresh"),
                         asof, fetched))
        if rows:
            cur.executemany(
                """INSERT INTO snapshots (ticker_id, field, value, source, as_of, fetched_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                rows,
            )
    conn.commit()
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--tickers", help="comma-separated subset")
    ap.add_argument("--all", action="store_true",
                    help="full universe from refresh.TICKERS")
    ap.add_argument("--sleep", type=float, default=0.5,
                    help="seconds between tickers (rate-limit courtesy)")
    ap.add_argument("--stats-max-age", type=int, default=0, metavar="DAYS",
                    help="reuse cached float/SI/cap if fetched within DAYS")
    args = ap.parse_args()

    if args.tickers and args.all:
        ap.error("pick --tickers or --all, not both")
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    elif args.all:
        tickers = refresh.TICKERS
    else:
        ap.error("need --tickers or --all")

    conn = get_conn()
    total = 0
    try:
        for i, tk in enumerate(tickers):
            old = load_previous(conn, tk)
            rec = refresh.refresh_ticker(tk, old, offline=False,
                                         stats_max_age=args.stats_max_age)
            rows = write_ticker(conn, tk, rec, old)
            errs = rec.get("errors")
            tag = f"  {len(errs)} issue(s): {'; '.join(errs)}" if errs else ""
            print(f"[{i+1}/{len(tickers)}] {tk}: {len(rows)} snapshot rows{tag}",
                  flush=True)
            total += len(rows)
            if i < len(tickers) - 1:
                import time
                time.sleep(args.sleep)
    finally:
        conn.close()
    print(f"done: {len(tickers)} tickers, {total} snapshot rows")


if __name__ == "__main__":
    main()