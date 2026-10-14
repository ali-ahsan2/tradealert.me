"""SEC EDGAR filings by date and form, and each ticker's identity.

The submissions feed (data.sec.gov/submissions/CIK##########.json) lists a
company's recent filings with form type, filing date, accession number and
8-K item codes, plus the company's name, SIC code and exchange. One call per
company gives both the filings the triggers read (S-3 and 424B for
dilution, 8-K items for catalysts) and the identity the rule-built universe
needs (app/universe.py).

    python -m app.filings_ingest              # every active instrument, 2 years
    python -m app.filings_ingest --limit 20   # a spot check

Offline, `store_submission(cur, ticker_id, submission_json)` takes a saved
submissions document, which is how the tests run without the network.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import date, timedelta

from app.db import get_conn
from app.events_ingest import PACE, SUBMISSIONS, _get, ticker_to_cik

log = logging.getLogger("tradealert.filings")

# Forms worth storing. Everything else in the feed (10-Q, DEF 14A, SC 13G...)
# is noise for the triggers that exist today; widen when a trigger needs it.
FORMS = {
    "8-K", "8-K/A",
    "S-3", "S-3/A", "S-3ASR", "S-1", "S-1/A",
    "424B1", "424B2", "424B3", "424B4", "424B5", "424B7",
    "4", "4/A",
    "SC 13D", "SC 13D/A",
}


def store_submission(cur, ticker_id, sub, since=None):
    """Write the filings and identity from one submissions document.
    Returns the number of filing rows inserted."""
    cik = str(sub.get("cik") or "").zfill(10)
    name = (sub.get("name") or "").strip()
    sic = str(sub.get("sic") or "")
    sic_desc = (sub.get("sicDescription") or "").strip()
    exchanges = sub.get("exchanges") or []
    exchange = exchanges[0] if exchanges else ""
    cur.execute("UPDATE tickers SET cik = %s, name = CASE WHEN %s <> '' THEN %s ELSE name END, "
                "exchange = CASE WHEN %s <> '' THEN %s ELSE exchange END, sic = %s, sic_desc = %s "
                "WHERE id = %s",
                (cik, name, name, exchange, exchange, sic, sic_desc, ticker_id))
    rec = (sub.get("filings") or {}).get("recent") or {}
    forms = rec.get("form") or []
    dates = rec.get("filingDate") or []
    accs = rec.get("accessionNumber") or []
    items = rec.get("items") or [""] * len(forms)
    docs = rec.get("primaryDocument") or [""] * len(forms)
    rows = []
    for i, form in enumerate(forms):
        if form not in FORMS:
            continue
        try:
            d = date.fromisoformat(dates[i])
        except (ValueError, IndexError):
            continue
        if since and d < since:
            continue
        rows.append((ticker_id, cik, form, d, accs[i] if i < len(accs) else f"{cik}-{i}",
                     items[i] if i < len(items) else "", docs[i] if i < len(docs) else ""))
    if not rows:
        return 0
    cur.executemany(
        "INSERT INTO filings (ticker_id, cik, form, filed_on, accession, items, primary_doc) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (accession, ticker_id) DO NOTHING", rows)
    return cur.rowcount if cur.rowcount and cur.rowcount > 0 else len(rows)


def ingest_filings(years=2, limit=None, verbose=True, symbols=None):
    """One submissions call per distinct symbol among the active instruments
    (or `symbols`), stored as filings and identity."""
    from app.market_data import finish_run, start_run

    since = date.today() - timedelta(days=365 * years)
    conn = get_conn()
    written = failed = skipped = 0
    run_id = None
    try:
        run_id = start_run(conn, "sec_filings")
        with conn.cursor() as cur:
            if symbols:
                cur.execute("SELECT id, symbol FROM tickers WHERE symbol = ANY(%s) ORDER BY symbol",
                            (list(symbols),))
            else:
                cur.execute("SELECT DISTINCT t.id, t.symbol FROM instruments i "
                            "JOIN tickers t ON t.id = i.ticker_id WHERE i.active ORDER BY t.symbol")
            rows = cur.fetchall()
        if limit:
            rows = rows[:limit]
        cmap = ticker_to_cik()
        if verbose:
            print(f"{len(rows)} symbols, since {since}")
        for n, (ticker_id, symbol) in enumerate(rows, 1):
            cik = cmap.get(symbol.upper())
            if not cik:
                skipped += 1
                continue
            try:
                sub = _get(SUBMISSIONS.format(cik=cik))
                time.sleep(PACE)
                with conn.cursor() as cur:
                    written += store_submission(cur, ticker_id, sub, since)
                conn.commit()
            except Exception as e:
                conn.rollback()
                failed += 1
                if verbose and failed <= 5:
                    print(f"  ! {symbol}: {str(e)[:80]}")
            if verbose and n % 50 == 0:
                print(f"  {n}/{len(rows)} written={written} failed={failed} skipped={skipped}")
        if run_id:
            finish_run(conn, run_id, len(rows) - failed, failed, written,
                       {"skipped": skipped, "since": str(since)})
    finally:
        conn.close()
    return {"written": written, "failed": failed, "skipped": skipped, "symbols": len(rows)}


def status():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT form, COUNT(*), MAX(filed_on) FROM filings GROUP BY form ORDER BY 2 DESC")
            return [{"form": f, "count": c, "latest": str(d)} for f, c, d in cur.fetchall()]
    finally:
        conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--years", type=int, default=2)
    ap.add_argument("--status", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    if a.status:
        print(json.dumps(status(), indent=1))
    else:
        print(json.dumps(ingest_filings(years=a.years, limit=a.limit), indent=1))
