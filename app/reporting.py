"""Reporting API: data-source health and multi-level price analysis.

Admin-gated like the Lab, and 404s rather than 401s for the same reason:
these endpoints describe internal plumbing and should not confirm their own
existence to a visitor.

Levels, coarse to fine:
  market    - indices and macro series
  index/etf - one benchmark, with its constituents' aggregate move
  industry  - every stock in one industry, aggregated
  stock     - one symbol, with its benchmarks alongside
"""
import os
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db import get_conn
from app.lab import _require_admin

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

# Worker cadence, mirrored so the dashboard can show "next due" without the
# worker having to publish it. Kept in sync with app/worker.py defaults.
SOURCE_SCHEDULE = {
    "yahoo_prices": {
        "label": "Yahoo Finance — daily OHLCV",
        "provides": "Open/high/low/close/volume, split and dividend adjusted",
        "every_hours": float(os.environ.get("PRICES_REFRESH_HOURS", "6")),
        "auth": "none",
    },
    "sec_earnings": {
        "label": "SEC EDGAR — 8-K item 2.02",
        "provides": "Earnings announcement dates",
        "every_hours": float(os.environ.get("EVENTS_REFRESH_HOURS", "12")),
        "auth": "User-Agent only",
    },
}

# Sources named in the plan but not yet implemented. Listed explicitly so the
# dashboard shows the whole intended surface rather than only what exists,
# and nobody has to guess whether a missing row means broken or unbuilt.
PLANNED_SOURCES = [
    ("sec_filings", "SEC EDGAR — S-3, 424B, Form 4, 13D",
     "Dilution filings, insider buys, activist stakes"),
    ("openfda", "openFDA", "Drug approval decisions"),
    ("fred", "FRED / Treasury", "Rates, dollar index, macro series"),
    ("news_rss", "RSS feeds", "DoD contracts, NASA, press wires"),
]


def _rows(cur):
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


@router.get("/api/admin/reporting/sources")
def sources(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Every source: last run, outcome, next due."""
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT ON (source) source, started_at, finished_at, "
                " ok_count, fail_count, rows_written, status, detail "
                "FROM source_runs ORDER BY source, started_at DESC")
            last = {r["source"]: r for r in _rows(cur)}

            cur.execute(
                "SELECT source, COUNT(*) FILTER (WHERE last_error IS NOT NULL) AS failing, "
                " COUNT(*) AS tracked, MAX(last_bar_date) AS newest "
                "FROM ingest_state GROUP BY source")
            state = {r["source"]: r for r in _rows(cur)}

            out = []
            for key, meta in SOURCE_SCHEDULE.items():
                run = last.get(key)
                st = state.get("yahoo" if key == "yahoo_prices" else key, {})
                nxt = None
                if run and run["finished_at"]:
                    nxt = run["finished_at"] + timedelta(hours=meta["every_hours"])
                out.append({
                    "key": key, "status": "active",
                    **meta,
                    "last_run": run["started_at"] if run else None,
                    "last_finished": run["finished_at"] if run else None,
                    "last_status": run["status"] if run else "never run",
                    "ok": run["ok_count"] if run else 0,
                    "failed": run["fail_count"] if run else 0,
                    "rows": run["rows_written"] if run else 0,
                    "next_due": nxt,
                    "symbols_failing": st.get("failing"),
                    "newest_data": st.get("newest"),
                })
            for key, label, provides in PLANNED_SOURCES:
                out.append({"key": key, "label": label, "provides": provides,
                            "status": "planned", "every_hours": None,
                            "last_run": None, "last_status": "not built",
                            "ok": 0, "failed": 0, "rows": 0, "next_due": None})

            cur.execute(
                "SELECT COUNT(DISTINCT ticker_id) AS symbols, COUNT(*) AS bars, "
                " MIN(d) AS first_bar, MAX(d) AS last_bar FROM price_bars")
            coverage = _rows(cur)[0]
            cur.execute(
                "SELECT synthetic_data_used AS synthetic, event_kind, COUNT(*) AS n, "
                " SUM(CASE WHEN hit THEN 1 ELSE 0 END) AS hits "
                "FROM backtest_events GROUP BY 1,2 ORDER BY 1,2")
            events = _rows(cur)
        return {"sources": out, "coverage": coverage, "events": events}
    finally:
        conn.close()


@router.get("/api/admin/reporting/universe")
def universe(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Universe-level rollup: industries, coverage, data health."""
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ind.id, ind.key, ind.label, COUNT(DISTINCT i.id) AS instruments, "
                " COUNT(DISTINCT b.ticker_id) AS with_bars, "
                " COUNT(DISTINCT e.id) FILTER (WHERE NOT e.synthetic_data_used) AS real_events "
                "FROM industries ind "
                "LEFT JOIN instruments i ON i.industry_id = ind.id AND i.active "
                "LEFT JOIN price_bars b ON b.ticker_id = i.ticker_id "
                "LEFT JOIN backtest_events e ON e.instrument_id = i.id "
                "GROUP BY ind.id, ind.key, ind.label ORDER BY ind.label")
            industries = _rows(cur)

            cur.execute(
                "SELECT COUNT(*) AS total_instruments, "
                " COUNT(*) FILTER (WHERE active) AS active_instruments FROM instruments")
            totals = _rows(cur)[0]

            cur.execute(
                "SELECT t.symbol, s.last_error, s.last_error_at FROM ingest_state s "
                "JOIN tickers t ON t.id = s.ticker_id "
                "WHERE s.last_error IS NOT NULL ORDER BY t.symbol")
            failing = _rows(cur)
        return {"industries": industries, "totals": totals, "failing": failing}
    finally:
        conn.close()


@router.get("/api/admin/reporting/benchmarks")
def benchmarks(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Market level: every index, sector ETF and macro series with its move."""
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.kind, t.symbol, r.label, r.sort_order, "
                " (SELECT close FROM price_bars p WHERE p.ticker_id=t.id "
                "   ORDER BY d DESC LIMIT 1) AS last_close, "
                " (SELECT d FROM price_bars p WHERE p.ticker_id=t.id "
                "   ORDER BY d DESC LIMIT 1) AS last_date, "
                " (SELECT close FROM price_bars p WHERE p.ticker_id=t.id "
                "   AND d <= CURRENT_DATE - 30 ORDER BY d DESC LIMIT 1) AS close_30d, "
                " (SELECT close FROM price_bars p WHERE p.ticker_id=t.id "
                "   AND d <= CURRENT_DATE - 90 ORDER BY d DESC LIMIT 1) AS close_90d, "
                " (SELECT COUNT(*) FROM price_bars p WHERE p.ticker_id=t.id) AS bars "
                "FROM reference_assets r JOIN tickers t ON t.id = r.ticker_id "
                "ORDER BY r.sort_order")
            rows = _rows(cur)
        for r in rows:
            for horizon, key in ((30, "close_30d"), (90, "close_90d")):
                base, last = r.get(key), r.get("last_close")
                r[f"chg_{horizon}d"] = (
                    round((float(last) - float(base)) / float(base) * 100, 2)
                    if base and last and float(base) else None)
        return {"benchmarks": rows}
    finally:
        conn.close()


@router.get("/api/admin/reporting/series/{symbol}")
def series(symbol: str,
           days: int = Query(365, ge=5, le=2000),
           creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Daily bars for one symbol, for charting. Works for any ticker."""
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM tickers WHERE upper(symbol)=upper(%s)", (symbol,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "unknown symbol")
            tid = row[0]
            cur.execute(
                "SELECT d, open, high, low, close, volume FROM price_bars "
                "WHERE ticker_id=%s AND d >= CURRENT_DATE - %s ORDER BY d",
                (tid, days))
            bars = [{"d": str(d), "o": float(o), "h": float(h), "l": float(lo),
                     "c": float(c), "v": int(v)}
                    for d, o, h, lo, c, v in cur.fetchall()]
            cur.execute(
                "SELECT r.kind, r.label FROM reference_assets r WHERE r.ticker_id=%s", (tid,))
            ref = cur.fetchone()
            cur.execute(
                "SELECT e.event_date, e.event_kind, e.fwd_max_move_pct, e.hit, "
                " e.synthetic_data_used "
                "FROM backtest_events e JOIN instruments i ON i.id=e.instrument_id "
                "WHERE i.ticker_id=%s AND e.event_date >= CURRENT_DATE - %s "
                "ORDER BY e.event_date", (tid, days))
            events = [{"date": str(d), "kind": k, "move": float(m) if m is not None else None,
                       "hit": h, "synthetic": s}
                      for d, k, m, h, s in cur.fetchall()]
        return {"symbol": symbol.upper(), "bars": bars, "events": events,
                "is_benchmark": bool(ref),
                "kind": ref[0] if ref else None, "label": ref[1] if ref else None}
    finally:
        conn.close()


@router.get("/api/admin/reporting/stock/{symbol}")
def stock(symbol: str,
          creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Stock level: identity, data health, events, and sector context."""
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT t.id, t.symbol, i.id AS instrument_id, ind.id AS industry_id, "
                " ind.label AS industry, i.theme, i.lane, i.instrument_group, i.active "
                "FROM tickers t "
                "LEFT JOIN instruments i ON i.ticker_id = t.id "
                "LEFT JOIN industries ind ON ind.id = i.industry_id "
                "WHERE upper(t.symbol)=upper(%s) LIMIT 1", (symbol,))
            rows = _rows(cur)
            if not rows:
                raise HTTPException(404, "unknown symbol")
            info = rows[0]
            tid = info["id"]

            cur.execute(
                "SELECT COUNT(*) AS bars, MIN(d) AS first, MAX(d) AS last "
                "FROM price_bars WHERE ticker_id=%s", (tid,))
            info["coverage"] = _rows(cur)[0]

            cur.execute(
                "SELECT last_ok_at, last_bar_date, last_error, last_error_at "
                "FROM ingest_state WHERE ticker_id=%s AND source='yahoo'", (tid,))
            health = _rows(cur)
            info["ingest"] = health[0] if health else None

            cur.execute(
                "SELECT event_kind, COUNT(*) AS n, "
                " SUM(CASE WHEN hit THEN 1 ELSE 0 END) AS hits, "
                " bool_or(synthetic_data_used) AS any_synthetic "
                "FROM backtest_events e JOIN instruments i ON i.id=e.instrument_id "
                "WHERE i.ticker_id=%s GROUP BY event_kind", (tid,))
            info["events"] = _rows(cur)

            # Sector benchmark for context, when the industry maps to one.
            info["benchmark"] = None
            if info.get("industry_id"):
                cur.execute(
                    "SELECT t.symbol, r.label FROM reference_assets r "
                    "JOIN tickers t ON t.id=r.ticker_id "
                    "WHERE r.industry_id=%s ORDER BY r.sort_order LIMIT 1",
                    (info["industry_id"],))
                b = cur.fetchone()
                if b:
                    info["benchmark"] = {"symbol": b[0], "label": b[1]}
        return info
    finally:
        conn.close()


@router.get("/api/admin/reporting/industry/{industry_id}")
def industry(industry_id: int,
             creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Industry level: every instrument with its data health and recent move."""
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT label FROM industries WHERE id=%s", (industry_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "unknown industry")
            cur.execute(
                "SELECT t.symbol, i.instrument_group, i.theme, i.active, "
                " (SELECT COUNT(*) FROM price_bars p WHERE p.ticker_id=t.id) AS bars, "
                " (SELECT close FROM price_bars p WHERE p.ticker_id=t.id "
                "   ORDER BY d DESC LIMIT 1) AS last_close, "
                " (SELECT close FROM price_bars p WHERE p.ticker_id=t.id "
                "   AND d <= CURRENT_DATE - 30 ORDER BY d DESC LIMIT 1) AS close_30d, "
                " (SELECT COUNT(*) FROM backtest_events e "
                "   WHERE e.instrument_id=i.id AND NOT e.synthetic_data_used) AS real_events "
                "FROM instruments i JOIN tickers t ON t.id=i.ticker_id "
                "WHERE i.industry_id=%s ORDER BY t.symbol", (industry_id,))
            members = _rows(cur)
        for m in members:
            base, last = m.get("close_30d"), m.get("last_close")
            m["chg_30d"] = (round((float(last) - float(base)) / float(base) * 100, 2)
                            if base and last and float(base) else None)
        return {"industry": row[0], "members": members}
    finally:
        conn.close()
