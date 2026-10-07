"""Real backtest events from SEC EDGAR, resolved against stored price bars.

Earnings dates come from 8-K Item 2.02 ("Results of Operations and Financial
Condition"), which is the filing a company makes when it announces results.
That is the date the market reacts to, not the fiscal quarter end, and it is
authoritative rather than estimated. Spot-checked against Yahoo's
earningsTimestamp for the most recent quarter: they agree.

Forward returns are computed from price_bars, so an event is only written
when the bars needed to resolve it are present. Events that cannot be
resolved are skipped rather than written with nulls, keeping
data_complete honest.

    python -m app.events_ingest earnings      # 8-K 2.02 -> events
    python -m app.events_ingest random        # matched baseline days
    python -m app.events_ingest status
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

from app.db import get_conn

UA = {"User-Agent": "tradealert.me research aliameenrana@gmail.com"}
TICKER_MAP = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik}.json"

# SEC asks for <= 10 req/s; 0.12s keeps us under that with margin.
PACE = 0.12
EARNINGS_ITEM = "2.02"

# Windows the Lab already assumes (backtest_events defaults).
TIGHT_DAYS = 5
WIDE_DAYS = 14
VOL_LOOKBACK = 20


def _get(url, timeout=25, retries=3):
    for i in range(retries):
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            time.sleep(1.0 * (i + 1))
        except Exception:
            time.sleep(1.0 * (i + 1))
    raise RuntimeError(f"failed: {url}")


def ticker_to_cik():
    data = _get(TICKER_MAP)
    return {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in data.values()}


def earnings_dates(cik, since):
    """8-K Item 2.02 filing dates on or after `since`."""
    sub = _get(SUBMISSIONS.format(cik=cik))
    rec = sub.get("filings", {}).get("recent", {})
    forms = rec.get("form") or []
    dates = rec.get("filingDate") or []
    items = rec.get("items") or [""] * len(forms)
    out = []
    for i, form in enumerate(forms):
        if form != "8-K":
            continue
        if EARNINGS_ITEM not in (items[i] or ""):
            continue
        try:
            d = date.fromisoformat(dates[i])
        except (ValueError, IndexError):
            continue
        if d >= since:
            out.append(d)
    return sorted(set(out))


def _bars(cur, ticker_id, start, end):
    cur.execute(
        "SELECT d, high, low, close, volume FROM price_bars "
        "WHERE ticker_id=%s AND d BETWEEN %s AND %s ORDER BY d",
        (ticker_id, start, end))
    return cur.fetchall()


def resolve(cur, ticker_id, event_date):
    """Forward move and volume spike after event_date.

    Returns None when the window is not fully covered by bars, so a
    half-resolved event never reaches the Lab as if it were complete.
    """
    # Baseline: average volume over the 20 sessions before the event.
    cur.execute(
        "SELECT AVG(volume)::bigint FROM (SELECT volume FROM price_bars "
        " WHERE ticker_id=%s AND d < %s ORDER BY d DESC LIMIT %s) q",
        (ticker_id, event_date, VOL_LOOKBACK))
    row = cur.fetchone()
    avg_vol = row[0] if row and row[0] else None

    # Reference close: last session on or before the event.
    cur.execute(
        "SELECT close FROM price_bars WHERE ticker_id=%s AND d <= %s "
        "ORDER BY d DESC LIMIT 1", (ticker_id, event_date))
    ref = cur.fetchone()
    if not ref or not ref[0]:
        return None
    ref_close = float(ref[0])
    if ref_close <= 0:
        return None

    fwd = _bars(cur, ticker_id, event_date + timedelta(days=1),
                event_date + timedelta(days=WIDE_DAYS + 10))
    if len(fwd) < TIGHT_DAYS:
        return None

    tight = fwd[:TIGHT_DAYS]
    max_move = 0.0
    days_to_move = None
    for n, (d, hi, lo, close, vol) in enumerate(tight, 1):
        up = (float(hi) - ref_close) / ref_close * 100.0
        dn = (float(lo) - ref_close) / ref_close * 100.0
        biggest = up if abs(up) >= abs(dn) else dn
        if abs(biggest) > abs(max_move):
            max_move = biggest
        if days_to_move is None and abs(biggest) >= 20.0:
            days_to_move = n

    close_move = (float(tight[-1][3]) - ref_close) / ref_close * 100.0
    spike = None
    if avg_vol:
        peak = max(int(b[4]) for b in tight)
        spike = peak / float(avg_vol) if avg_vol else None

    return {
        "fwd_max_move_pct": round(max_move, 2),
        "fwd_close_move_pct": round(close_move, 2),
        "fwd_vol_spike_x": round(spike, 2) if spike is not None else None,
        "days_to_move": days_to_move,
        "bars": len(fwd),
    }


def _instruments(cur):
    cur.execute(
        "SELECT i.id, t.id, t.symbol FROM instruments i "
        "JOIN tickers t ON t.id=i.ticker_id WHERE i.active ORDER BY t.symbol")
    return cur.fetchall()


def ingest_earnings(years=2, limit=None, verbose=True):
    from app.market_data import finish_run, start_run

    since = date.today() - timedelta(days=365 * years)
    conn = get_conn()
    written = skipped = failed = 0
    run_id = None
    try:
        run_id = start_run(conn, "sec_earnings")
        with conn.cursor() as cur:
            rows = _instruments(cur)
        if limit:
            rows = rows[:limit]
        cmap = ticker_to_cik()
        if verbose:
            print(f"{len(rows)} instruments, since {since}")

        # One SEC call per distinct symbol, reused across its instruments.
        seen = {}
        for n, (instrument_id, ticker_id, symbol) in enumerate(rows, 1):
            cik = cmap.get(symbol.upper())
            if not cik:
                skipped += 1
                continue
            try:
                if symbol not in seen:
                    seen[symbol] = earnings_dates(cik, since)
                    time.sleep(PACE)
                dates = seen[symbol]
            except Exception as e:
                failed += 1
                if verbose and failed <= 5:
                    print(f"  ! {symbol}: {str(e)[:60]}")
                continue

            with conn.cursor() as cur:
                for d in dates:
                    r = resolve(cur, ticker_id, d)
                    if r is None:
                        skipped += 1
                        continue
                    hit = (abs(r["fwd_max_move_pct"]) >= 20.0 or
                           (r["fwd_vol_spike_x"] or 0) >= 3.0)
                    prov = {
                        "source": "SEC EDGAR 8-K item 2.02",
                        "prices": "Yahoo daily, split/dividend adjusted",
                        "cik": cik,
                        "window_days": TIGHT_DAYS,
                        "vol_baseline_sessions": VOL_LOOKBACK,
                    }
                    cur.execute(
                        "INSERT INTO backtest_events (instrument_id, event_date, event_kind,"
                        " inputs_json, provenance_json, fwd_max_move_pct, fwd_close_move_pct,"
                        " fwd_vol_spike_x, days_to_move, hit, resolved_at, data_complete,"
                        " synthetic_data_used) "
                        "VALUES (%s,%s,'earnings',%s,%s,%s,%s,%s,%s,%s, now(), TRUE, FALSE) "
                        "ON CONFLICT DO NOTHING",
                        (instrument_id, d, json.dumps({}), json.dumps(prov),
                         r["fwd_max_move_pct"], r["fwd_close_move_pct"],
                         r["fwd_vol_spike_x"], r["days_to_move"], hit))
                    written += cur.rowcount
            conn.commit()
            if verbose and n % 50 == 0:
                print(f"  {n}/{len(rows)} written={written} skipped={skipped} failed={failed}")
        if run_id:
            finish_run(conn, run_id, len(rows) - failed, failed, written,
                       {"skipped": skipped, "since": str(since)})
    finally:
        conn.close()
    return {"written": written, "skipped": skipped, "failed": failed}


def ingest_random_days(per_instrument=3, verbose=True):
    """Baseline events: dates with no earnings within 6 sessions.

    Uses each instrument's own bar history so the baseline is drawn from the
    same period and the same symbol as its earnings events.
    """
    conn = get_conn()
    written = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT e.instrument_id, i.ticker_id FROM backtest_events e "
                "JOIN instruments i ON i.id=e.instrument_id "
                "WHERE e.event_kind='earnings' AND NOT e.synthetic_data_used")
            pairs = cur.fetchall()
            for instrument_id, ticker_id in pairs:
                cur.execute(
                    "SELECT event_date FROM backtest_events "
                    "WHERE instrument_id=%s AND event_kind='earnings'", (instrument_id,))
                avoid = [r[0] for r in cur.fetchall()]
                cur.execute(
                    "SELECT d FROM price_bars WHERE ticker_id=%s "
                    "ORDER BY d", (ticker_id,))
                days = [r[0] for r in cur.fetchall()]
                if len(days) < 60:
                    continue
                # Evenly spaced picks across the window, deterministic.
                step = max(1, len(days) // (per_instrument + 1))
                picks = [days[step * (k + 1)] for k in range(per_instrument)
                         if step * (k + 1) < len(days) - WIDE_DAYS - 2]
                for d in picks:
                    if any(abs((d - a).days) <= 6 for a in avoid):
                        continue
                    r = resolve(cur, ticker_id, d)
                    if r is None:
                        continue
                    hit = (abs(r["fwd_max_move_pct"]) >= 20.0 or
                           (r["fwd_vol_spike_x"] or 0) >= 3.0)
                    prov = {"source": "baseline: non-event session",
                            "prices": "Yahoo daily, split/dividend adjusted"}
                    cur.execute(
                        "INSERT INTO backtest_events (instrument_id, event_date, event_kind,"
                        " inputs_json, provenance_json, fwd_max_move_pct, fwd_close_move_pct,"
                        " fwd_vol_spike_x, days_to_move, hit, resolved_at, data_complete,"
                        " synthetic_data_used) "
                        "VALUES (%s,%s,'random_day',%s,%s,%s,%s,%s,%s,%s, now(), TRUE, FALSE) "
                        "ON CONFLICT DO NOTHING",
                        (instrument_id, d, json.dumps({}), json.dumps(prov),
                         r["fwd_max_move_pct"], r["fwd_close_move_pct"],
                         r["fwd_vol_spike_x"], r["days_to_move"], hit))
                    written += cur.rowcount
                conn.commit()
    finally:
        conn.close()
    if verbose:
        print(f"random_day written={written}")
    return written


def status():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT synthetic_data_used, event_kind, COUNT(*), "
                " SUM(CASE WHEN hit THEN 1 ELSE 0 END), MIN(event_date), MAX(event_date) "
                "FROM backtest_events GROUP BY 1,2 ORDER BY 1,2")
            return cur.fetchall()
    finally:
        conn.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "earnings":
        lim = int(sys.argv[2]) if len(sys.argv) > 2 else None
        print(json.dumps(ingest_earnings(limit=lim)))
    elif cmd == "random":
        ingest_random_days()
    elif cmd == "status":
        for r in status():
            print(f"synthetic={r[0]} {r[1]:<14} n={r[2]:<6} hits={r[3]:<6} {r[4]}..{r[5]}")
