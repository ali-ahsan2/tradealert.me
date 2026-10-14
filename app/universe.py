"""The universe, built by rule.

"It watches every name in my industries" was a promise the workbench
shortlist could not keep: four hundred names one person had looked at. This
module builds the universe from public rules instead:

  1. every company on NYSE, Nasdaq or NYSE American in the SEC's
     company_tickers_exchange.json;
  2. whose SIC code maps to one of the product's industries (SIC_MAP below,
     inspectable in the Lab), fetched from the submissions feed and stored
     on the ticker by app/filings_ingest.py;
  3. whose market cap, once a stats snapshot exists, falls inside the band
     (default $50M to $5B; the Fast Mover hard filter is narrower and
     still applies at scoring time).

Every instrument it writes carries origin = 'rule'; the workbench rows
keep origin = 'workbench' and are never deleted here, only deactivated when
they fall outside the band. A dry run reports what would change.

    python -m app.universe plan                 # counts only, no writes
    python -m app.universe apply                # write instruments
    python -m app.universe apply --cap 50 5000
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime, timedelta, timezone

from app.db import get_conn
from app.events_ingest import PACE, SUBMISSIONS, _get

log = logging.getLogger("tradealert.universe")

EXCHANGE_LIST = "https://www.sec.gov/files/company_tickers_exchange.json"
EXCHANGES = {"NYSE", "Nasdaq", "NYSE American", "NYSE Arca"}
DEFAULT_CAP_MIN_M = 50.0
DEFAULT_CAP_MAX_M = 5000.0

# SIC code -> industry key. Industries are the product's own; a code listed
# under two would be a bug, so each appears once. Codes not listed are out.
SIC_MAP = {
    "semiconductors": {"3674", "3672", "3677", "3678", "3679", "3577", "3663", "3669", "3825",
                       "3826", "3827", "3861"},
    "defense_space": {"3480", "3489", "3720", "3721", "3724", "3728", "3760", "3761", "3769",
                      "3812", "3795"},
    "quantum_compute": {"3571", "3572", "3575", "3578", "3670", "3671", "3690"},
    "biotech_pharma": {"2833", "2834", "2835", "2836", "8731", "3841", "3842", "3845", "3851",
                       "8071", "8090", "2830"},
    "energy_nuclear": {"1000", "1040", "1090", "1094", "1099", "1400", "3339", "1021", "1031",
                       "3443"},
    "battery_clean_energy": {"3691", "3692", "3621", "3711", "3714", "3713", "4991", "3634",
                             "3620", "3612", "4931", "3990"},
    "ai_software_data": {"7370", "7371", "7372", "7373", "7374", "7379", "3570", "3576", "7389",
                         "4899", "7380"},
    "fintech_payments": {"6199", "6141", "6153", "6163", "6099", "6211", "6282", "6111", "6159",
                         "6172", "6035", "6036"},
    "consumer_ecom": {"5961", "5900", "5990", "5945", "5940", "5700", "5731", "5812", "5311",
                      "5331", "5399", "5411", "5621", "5651", "5661", "5712", "5734", "5912",
                      "2300", "3140", "3942", "3944", "3949", "2080", "2086"},
    "media_adtech": {"7310", "7311", "7319", "7812", "7819", "7822", "7829", "4841", "4833",
                     "2711", "2721", "2731", "2741", "7375", "4832", "7900", "7990", "7996"},
}
# Codes never admitted whatever the mapping: blank-check SPACs, REITs,
# asset-backed issuers, closed-end funds.
EXCLUDED_SIC = {"6770", "6798", "6189", "6722", "6726"}

INDUSTRY_OF_SIC = {}
for _ind, _codes in SIC_MAP.items():
    for _c in _codes:
        assert _c not in INDUSTRY_OF_SIC, f"SIC {_c} mapped twice"
        INDUSTRY_OF_SIC[_c] = _ind


def industry_for_sic(sic):
    sic = str(sic or "").strip()
    if not sic or sic in EXCLUDED_SIC:
        return None
    return INDUSTRY_OF_SIC.get(sic)


def listed_companies(doc):
    """[(cik10, name, ticker, exchange)] from company_tickers_exchange.json
    (or a saved copy), on the exchanges we admit."""
    fields = doc.get("fields") or []
    idx = {f: i for i, f in enumerate(fields)}
    out = []
    for row in doc.get("data") or []:
        try:
            cik = str(row[idx["cik"]]).zfill(10)
            name = row[idx["name"]]
            ticker = (row[idx["ticker"]] or "").upper()
            exch = row[idx["exchange"]] or ""
        except (KeyError, IndexError, TypeError):
            continue
        if not ticker or exch not in EXCHANGES:
            continue
        if any(ch in ticker for ch in "-^./") and not ticker.isalpha():
            continue                      # warrants, units, preferreds
        out.append((cik, name, ticker, exch))
    return out


def plan(conn, listing=None, cap_min_m=DEFAULT_CAP_MIN_M, cap_max_m=DEFAULT_CAP_MAX_M,
         fetch_identity=False, limit=None, verbose=True):
    """What the rule would produce. With `listing` (a saved
    company_tickers_exchange document) no network is needed except, with
    fetch_identity, one submissions call per listed company whose SIC we do
    not have yet."""
    cur = conn.cursor()
    doc = listing or _get(EXCHANGE_LIST)
    companies = listed_companies(doc)
    if limit:
        companies = companies[:limit]
    cur.execute("SELECT symbol, id, sic, cik FROM tickers")
    known = {s: (i, sic, cik) for s, i, sic, cik in cur.fetchall()}
    fetched = 0
    for cik, name, ticker, exch in companies:
        row = known.get(ticker)
        if row and row[1]:
            continue
        if not fetch_identity:
            continue
        try:
            sub = _get(SUBMISSIONS.format(cik=cik))
            time.sleep(PACE)
        except Exception:
            continue
        cur.execute("INSERT INTO tickers (symbol) VALUES (%s) ON CONFLICT (symbol) DO NOTHING", (ticker,))
        cur.execute("SELECT id FROM tickers WHERE symbol = %s", (ticker,))
        tid = cur.fetchone()[0]
        from app.filings_ingest import store_submission
        store_submission(cur, tid, sub, since=None)
        conn.commit()
        known[ticker] = (tid, str(sub.get("sic") or ""), cik)
        fetched += 1
        if verbose and fetched % 100 == 0:
            print(f"  identity fetched for {fetched}")

    # the latest cap per ticker, where a stats snapshot exists
    cur.execute("SELECT DISTINCT ON (ticker_id) ticker_id, value FROM snapshots "
                "WHERE field = 'cap_usd_m' AND as_of > %s ORDER BY ticker_id, as_of DESC",
                (datetime.now(timezone.utc) - timedelta(days=60),))
    caps = {}
    for tid, v in cur.fetchall():
        try:
            caps[tid] = float(v)
        except (TypeError, ValueError):
            pass

    admitted, by_industry, no_sic, out_of_band, unmapped, no_cap = [], {}, 0, 0, 0, 0
    for cik, name, ticker, exch in companies:
        row = known.get(ticker)
        if not row or not row[1]:
            no_sic += 1
            continue
        tid, sic, _ = row
        ind = industry_for_sic(sic)
        if not ind:
            unmapped += 1
            continue
        cap = caps.get(tid)
        if cap is None:
            no_cap += 1
        elif not (cap_min_m <= cap <= cap_max_m):
            out_of_band += 1
            continue
        admitted.append((tid, ticker, name, exch, sic, ind, cap))
        by_industry[ind] = by_industry.get(ind, 0) + 1
    return {
        "listed": len(companies), "with_sic": len(companies) - no_sic, "no_sic": no_sic,
        "unmapped_sic": unmapped, "out_of_cap_band": out_of_band, "cap_unknown_admitted": no_cap,
        "admitted": len(admitted), "by_industry": by_industry,
        "cap_band_m": [cap_min_m, cap_max_m], "identity_fetched": fetched,
        "rows": admitted,
    }


def apply(conn, p):
    """Write the plan: one instrument per admitted (ticker, industry) with
    origin 'rule'; rule instruments no longer admitted are deactivated."""
    cur = conn.cursor()
    cur.execute("SELECT key, id FROM industries")
    ind_ids = dict(cur.fetchall())
    keep = set()
    written = 0
    for tid, ticker, name, exch, sic, ind, cap in p["rows"]:
        iid_ind = ind_ids.get(ind)
        if not iid_ind:
            continue
        cur.execute(
            "INSERT INTO instruments (ticker_id, industry_id, theme, instrument_group, origin, active) "
            "VALUES (%s, %s, %s, 'Scan', 'rule', TRUE) "
            "ON CONFLICT (ticker_id, industry_id) DO UPDATE SET active = TRUE, "
            " theme = CASE WHEN instruments.theme = '' THEN EXCLUDED.theme ELSE instruments.theme END "
            "RETURNING id", (tid, iid_ind, name[:80]))
        keep.add(cur.fetchone()[0])
        written += 1
    cur.execute("UPDATE instruments SET active = FALSE WHERE origin = 'rule' AND active AND NOT (id = ANY(%s))",
                (list(keep) or [0],))
    deactivated = cur.rowcount
    conn.commit()
    return {"written": written, "deactivated": deactivated}


def counts(conn):
    cur = conn.cursor()
    cur.execute("SELECT ind.key, i.origin, COUNT(*) FILTER (WHERE i.active), COUNT(*) "
                "FROM instruments i JOIN industries ind ON ind.id = i.industry_id "
                "GROUP BY 1, 2 ORDER BY 1, 2")
    out = {}
    for ind, origin, active, total in cur.fetchall():
        out.setdefault(ind, {})[origin] = {"active": active, "total": total}
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cmd", choices=["plan", "apply", "counts"])
    ap.add_argument("--cap", nargs=2, type=float, default=[DEFAULT_CAP_MIN_M, DEFAULT_CAP_MAX_M])
    ap.add_argument("--listing", help="saved company_tickers_exchange.json")
    ap.add_argument("--no-identity", action="store_true", help="do not fetch SIC for unknown tickers")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    c = get_conn()
    try:
        if a.cmd == "counts":
            print(json.dumps(counts(c), indent=1))
        else:
            listing = json.load(open(a.listing)) if a.listing else None
            p = plan(c, listing, a.cap[0], a.cap[1], fetch_identity=not a.no_identity, limit=a.limit)
            print(json.dumps({k: v for k, v in p.items() if k != "rows"}, indent=1))
            if a.cmd == "apply":
                print(json.dumps(apply(c, p), indent=1))
    finally:
        c.close()
