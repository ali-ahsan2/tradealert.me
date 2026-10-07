"""Daily OHLCV ingest.

One provider today (Yahoo's chart endpoint, which is what yfinance wraps).
Everything downstream goes through fetch_bars/store_bars, so swapping in a
licensed feed means writing one new fetch function, not touching callers.

Yahoo is an unofficial endpoint: it is free and it is what retail backtesters
use, but it can change without notice and it rate-limits sustained scraping.
Hence the pacing in refresh_all and the per-symbol error recording.

    python -m app.market_data backfill       # 2y for every active ticker
    python -m app.market_data refresh        # only what is stale
    python -m app.market_data verify AAPL    # print what we hold
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

from app.db import get_conn

CHART_URL = ("https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
             "?range={rng}&interval=1d")
UA = {"User-Agent": "Mozilla/5.0 (compatible; tradealert.me/1.0)"}
SOURCE = "yahoo"

# Yahoo tolerates bursts but throttles sustained scraping; 0.4s keeps a
# 401-symbol pass under three minutes while staying well clear of that.
PACE_SECONDS = 0.4
MAX_RETRIES = 3


class FetchError(Exception):
    pass


def fetch_bars(symbol, rng="2y"):
    """Return [(date, open, high, low, close, raw_close, volume), ...].

    Prices are adjusted: Yahoo gives raw OHLC plus an adjclose series, and
    the ratio adjclose/close is the split+dividend factor for that bar.
    Applying it to all four prices keeps a split from reading as a crash.
    """
    url = CHART_URL.format(sym=urllib.parse.quote(symbol), rng=rng)
    last = None
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as resp:
                payload = json.load(resp)
            break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last = e
            code = getattr(e, "code", None)
            if code in (404, 400):          # delisted or bad symbol: no retry
                raise FetchError(f"{symbol}: HTTP {code}") from e
            # 429 and 5xx are worth backing off for.
            time.sleep(1.5 * (attempt + 1))
    else:
        raise FetchError(f"{symbol}: {type(last).__name__} {last}") from last

    chart = (payload or {}).get("chart") or {}
    if chart.get("error"):
        raise FetchError(f"{symbol}: {chart['error']}")
    results = chart.get("result") or []
    if not results:
        raise FetchError(f"{symbol}: empty result")

    res = results[0]
    stamps = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    adj = ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")

    o, h, lo = quote.get("open"), quote.get("high"), quote.get("low")
    c, v = quote.get("close"), quote.get("volume")
    if not stamps or c is None:
        raise FetchError(f"{symbol}: no quote series")

    rows = []
    for i, ts in enumerate(stamps):
        try:
            co, ch, cl, cc = o[i], h[i], lo[i], c[i]
        except (IndexError, TypeError):
            continue
        # Yahoo emits nulls for halted or untraded sessions; a bar without a
        # close cannot produce a return, so it is dropped rather than zeroed.
        if cc is None or co is None or ch is None or cl is None:
            continue
        if cc <= 0 or co <= 0:
            continue
        factor = 1.0
        if adj and i < len(adj) and adj[i] is not None and cc:
            factor = adj[i] / cc
        d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
        vol = 0
        if v and i < len(v) and v[i] is not None:
            vol = int(v[i])
        rows.append((
            d,
            round(co * factor, 4), round(ch * factor, 4),
            round(cl * factor, 4), round(cc * factor, 4),
            round(cc, 4), vol,
        ))
    if not rows:
        raise FetchError(f"{symbol}: no usable bars")
    return rows


def store_bars(conn, ticker_id, rows):
    """Upsert bars. Returns the number written."""
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO price_bars "
            " (ticker_id, d, open, high, low, close, raw_close, volume, source, fetched_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s, now()) "
            "ON CONFLICT (ticker_id, d) DO UPDATE SET "
            " open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, "
            " close=EXCLUDED.close, raw_close=EXCLUDED.raw_close, "
            " volume=EXCLUDED.volume, source=EXCLUDED.source, fetched_at=now()",
            [(ticker_id, r[0], r[1], r[2], r[3], r[4], r[5], r[6], SOURCE) for r in rows],
        )
    return len(rows)


def _mark_ok(conn, ticker_id, last_bar):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ingest_state (source, ticker_id, last_ok_at, last_bar_date, "
            " last_error, last_error_at, attempts) "
            "VALUES (%s,%s, now(), %s, NULL, NULL, 0) "
            "ON CONFLICT (source, ticker_id) DO UPDATE SET "
            " last_ok_at=now(), last_bar_date=EXCLUDED.last_bar_date, "
            " last_error=NULL, last_error_at=NULL, attempts=0",
            (SOURCE, ticker_id, last_bar),
        )


def _mark_fail(conn, ticker_id, err):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ingest_state (source, ticker_id, last_error, last_error_at, attempts) "
            "VALUES (%s,%s,%s, now(), 1) "
            "ON CONFLICT (source, ticker_id) DO UPDATE SET "
            " last_error=EXCLUDED.last_error, last_error_at=now(), "
            " attempts=ingest_state.attempts+1",
            (SOURCE, ticker_id, str(err)[:500]),
        )


def _targets(conn, stale_only=False, limit=None):
    sql = ("SELECT t.id, t.symbol FROM tickers t "
           "JOIN instruments i ON i.ticker_id = t.id AND i.active ")
    if stale_only:
        sql += ("LEFT JOIN ingest_state s ON s.ticker_id = t.id AND s.source = 'yahoo' "
                "WHERE s.last_bar_date IS NULL "
                "   OR s.last_bar_date < (CURRENT_DATE - 1) ")
    sql += "GROUP BY t.id, t.symbol ORDER BY t.symbol"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def refresh_all(rng="2y", stale_only=False, limit=None, pace=PACE_SECONDS, verbose=True):
    conn = get_conn()
    ok = failed = bars = 0
    errors = []
    try:
        targets = _targets(conn, stale_only=stale_only, limit=limit)
        total = len(targets)
        if verbose:
            print(f"{total} symbols, range={rng}, pace={pace}s")
        started = time.time()
        for n, (tid, sym) in enumerate(targets, 1):
            try:
                rows = fetch_bars(sym, rng=rng)
                written = store_bars(conn, tid, rows)
                _mark_ok(conn, tid, rows[-1][0])
                conn.commit()
                ok += 1
                bars += written
            except Exception as e:                      # one bad symbol must not stop the pass
                conn.rollback()
                _mark_fail(conn, tid, e)
                conn.commit()
                failed += 1
                errors.append(f"{sym}: {e}")
            if verbose and (n % 50 == 0 or n == total):
                el = time.time() - started
                print(f"  {n}/{total}  ok={ok} fail={failed} bars={bars}  {el:.0f}s")
            if pace:
                time.sleep(pace)
    finally:
        conn.close()
    return {"ok": ok, "failed": failed, "bars": bars, "errors": errors}


def coverage():
    """What we actually hold, for verification."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT ticker_id), COUNT(*), MIN(d), MAX(d) FROM price_bars")
            syms, rows, lo, hi = cur.fetchone()
            cur.execute("SELECT COUNT(*) FROM tickers t JOIN instruments i "
                        "ON i.ticker_id=t.id AND i.active")
            active = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM ingest_state "
                        "WHERE source='yahoo' AND last_error IS NOT NULL")
            failing = cur.fetchone()[0]
        return {"symbols_with_bars": syms, "active_tickers": active,
                "bars": rows, "first": lo, "last": hi, "failing": failing}
    finally:
        conn.close()


def verify(symbol):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT d, open, high, low, close, raw_close, volume "
                "FROM price_bars b JOIN tickers t ON t.id=b.ticker_id "
                "WHERE t.symbol=%s ORDER BY d DESC LIMIT 5", (symbol,))
            return cur.fetchall()
    finally:
        conn.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "refresh"
    if cmd == "backfill":
        lim = int(sys.argv[2]) if len(sys.argv) > 2 else None
        r = refresh_all(rng="2y", limit=lim)
        print(json.dumps({k: v for k, v in r.items() if k != "errors"}))
        for e in r["errors"][:20]:
            print("  !", e)
    elif cmd == "refresh":
        r = refresh_all(rng="1mo", stale_only=True)
        print(json.dumps({k: v for k, v in r.items() if k != "errors"}))
    elif cmd == "verify":
        for row in verify(sys.argv[2]):
            print(row)
    elif cmd == "coverage":
        print(json.dumps(coverage(), default=str, indent=2))
