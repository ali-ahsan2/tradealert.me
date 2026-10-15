"""Fundamentals snapshots: market cap, float, short interest, revenue growth.

Fast Mover's four hard filters check these fields, but events_ingest.py
writes real earnings/random_day events with inputs_json = {} -- it only
ever pulled filing dates and resolved forward returns from bars, never
fundamentals. Without this, _evaluate_filters in app/lab.py finds no
"hard_filters" in inputs_json for any real event and returns "unavailable"
immediately, so only the synthetic seed fixtures can ever pass a filter.

yfinance's .info has no free historical point-in-time fundamentals: this
is a snapshot of today's values, not what cap/float/short-interest were on
each event's actual date. fetched_at records when it was true. attach()
stamps that onto every event it touches so the honesty is visible in the
result, not just in this file's docstring.

    python -m app.fundamentals_ingest fetch      # snapshot every active ticker
    python -m app.fundamentals_ingest attach     # write hard_filters onto events
"""
import json
import sys
import time

from app.db import get_conn

PACE_SECONDS = 0.3

# Mirrors the Fast Mover hard filter keys in strategy_versions.hard_filters_json
# (app/lab.py's _evaluate_filters reads this exact shape).
FILTER_KEYS = ("cap", "float", "si", "growth")


class FetchError(Exception):
    pass


def fetch_one(symbol):
    """Return {"cap": float|None, "float": int|None, "si": float|None,
    "growth": float|None} in the units Fast Mover's rules expect:
    cap in USD, float in shares, si and growth as plain percentages."""
    import yfinance as yf
    try:
        info = yf.Ticker(symbol).info
    except Exception as e:
        raise FetchError(f"{symbol}: {type(e).__name__} {e}") from e
    if not info or info.get("marketCap") is None and info.get("floatShares") is None:
        raise FetchError(f"{symbol}: empty info")

    cap = info.get("marketCap")
    flt = info.get("floatShares")
    short_pct = info.get("shortPercentOfFloat")
    growth = info.get("revenueGrowth")
    return {
        "cap": float(cap) if cap is not None else None,
        "float": int(flt) if flt is not None else None,
        "si": round(float(short_pct) * 100, 3) if short_pct is not None else None,
        "growth": round(float(growth) * 100, 3) if growth is not None else None,
    }


def store(conn, ticker_id, vals):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO fundamentals_snapshots "
            " (ticker_id, market_cap_usd, float_shares, short_pct_float, "
            "  revenue_growth_pct, source, fetched_at) "
            "VALUES (%s,%s,%s,%s,%s,'yahoo', now()) "
            "ON CONFLICT (ticker_id) DO UPDATE SET "
            " market_cap_usd=EXCLUDED.market_cap_usd, "
            " float_shares=EXCLUDED.float_shares, "
            " short_pct_float=EXCLUDED.short_pct_float, "
            " revenue_growth_pct=EXCLUDED.revenue_growth_pct, "
            " source='yahoo', fetched_at=now()",
            (ticker_id, vals["cap"], vals["float"], vals["si"], vals["growth"]))


def fetch_all(limit=None, pace=PACE_SECONDS, verbose=True):
    """Snapshot fundamentals for every ticker backing an active instrument.
    Benchmarks are excluded: they are never scored and have no filters."""
    from app.market_data import finish_run, start_run

    conn = get_conn()
    ok = failed = 0
    errors = []
    run_id = None
    try:
        run_id = start_run(conn, "yahoo_fundamentals")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT t.id, t.symbol FROM tickers t "
                "JOIN instruments i ON i.ticker_id = t.id AND i.active "
                "ORDER BY t.symbol")
            targets = cur.fetchall()
        if limit:
            targets = targets[:limit]
        if verbose:
            print(f"{len(targets)} symbols")
        for n, (tid, sym) in enumerate(targets, 1):
            try:
                vals = fetch_one(sym)
                store(conn, tid, vals)
                conn.commit()
                ok += 1
            except Exception as e:
                conn.rollback()
                failed += 1
                errors.append(f"{sym}: {e}")
            if verbose and n % 50 == 0:
                print(f"  {n}/{len(targets)} ok={ok} failed={failed}")
            if pace:
                time.sleep(pace)
        if run_id:
            finish_run(conn, run_id, ok, failed, ok, {"errors": errors[:40]})
    finally:
        conn.close()
    return {"ok": ok, "failed": failed, "errors": errors}


def attach(verbose=True):
    """Write hard_filters into inputs_json for every real event whose
    ticker has a fundamentals snapshot. Idempotent: re-running overwrites
    with the latest snapshot rather than skipping, since a staler snapshot
    is never preferable to a fresher one on the same events."""
    conn = get_conn()
    updated = skipped = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT be.id, i.ticker_id, f.market_cap_usd, f.float_shares, "
                " f.short_pct_float, f.revenue_growth_pct, f.fetched_at, "
                " be.provenance_json "
                "FROM backtest_events be "
                "JOIN instruments i ON i.id = be.instrument_id "
                "JOIN fundamentals_snapshots f ON f.ticker_id = i.ticker_id "
                "WHERE NOT be.synthetic_data_used")
            rows = cur.fetchall()
            for (eid, _tid, cap, flt, si, growth, fetched_at, prov) in rows:
                vals = {"cap": cap, "float": flt, "si": si, "growth": growth}
                if any(v is None for v in vals.values()):
                    skipped += 1
                    continue
                hard_filters = [
                    {"key": "cap", "value": float(cap)},
                    {"key": "float", "value": int(flt)},
                    {"key": "si", "value": float(si)},
                    {"key": "growth", "value": float(growth)},
                ]
                prov = dict(prov or {})
                prov["fundamentals_source"] = "yahoo snapshot, not point-in-time"
                prov["fundamentals_as_of"] = fetched_at.isoformat()
                cur.execute(
                    "UPDATE backtest_events SET inputs_json = %s, provenance_json = %s "
                    "WHERE id = %s",
                    (json.dumps({"hard_filters": hard_filters}), json.dumps(prov), eid))
                updated += 1
        conn.commit()
    finally:
        conn.close()
    if verbose:
        print(f"attached={updated} skipped(no snapshot or incomplete)={skipped}")
    return {"attached": updated, "skipped": skipped}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    if cmd == "fetch":
        lim = int(sys.argv[2]) if len(sys.argv) > 2 else None
        r = fetch_all(limit=lim)
        print(json.dumps({k: v for k, v in r.items() if k != "errors"}))
        for e in r["errors"][:20]:
            print("  !", e)
    elif cmd == "attach":
        attach()
