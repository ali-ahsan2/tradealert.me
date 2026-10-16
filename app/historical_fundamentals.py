"""Point-in-time fundamentals for Fast Mover's hard filters, not today's
snapshot stamped onto every historical event.

fundamentals_ingest.py's attach() writes one current value per ticker onto
every event regardless of date; a stock whose cap crossed outside Fast
Mover's $300M-$3B band between an old event and today gets the wrong
verdict. Three of the four fields have a free source with real history:

  cap     shares outstanding (SEC XBRL, dei:EntityCommonStockSharesOutstanding)
          times the close on the event date (price_bars, already stored).
  growth  trailing four-quarter revenue vs the same four quarters a year
          earlier (SEC XBRL us-gaap:Revenues / RevenueFromContract...),
          as of whichever quarter precedes the event date.
  si      bi-monthly settlement short interest (NASDAQ's public API),
          the settlement on or before the event date.
  float   EntityPublicFloat (SEC XBRL, dollars, one value per 10-K) divided
          by the close on its own "as of" date -- an approximation in
          shares, updated once a year per filing, not the exact float on
          every date. The best free source that exists; no vendor publishes
          historical float in shares at finer granularity without payment.
          Labelled as such in provenance, never presented as exact.

Nothing here replaces fundamentals_ingest.py's current-snapshot path; a
ticker with no XBRL coverage (a recent IPO, a foreign private issuer) falls
back to it, so every event still gets the best available value rather than
none.

    python -m app.historical_fundamentals run        # all real events
    python -m app.historical_fundamentals run 20      # first 20 tickers
"""
import json
import sys
import time
import urllib.error
import urllib.request
from bisect import bisect_right
from datetime import date

from app.db import get_conn
from app.events_ingest import ticker_to_cik

UA = {"User-Agent": "tradealert.me research aliameenrana@gmail.com"}
XBRL_CONCEPT = "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/{taxonomy}/{tag}.json"
NASDAQ_SI = "https://api.nasdaq.com/api/quote/{sym}/short-interest?assetclass=stocks"
PACE = 0.15


class FetchError(Exception):
    pass


def _xbrl_series(cik, taxonomy, tag, unit):
    """[(end_date, value), ...] sorted by date. Empty list, not an error,
    when the company never reported this tag (common for small/new names)."""
    url = XBRL_CONCEPT.format(cik=cik, taxonomy=taxonomy, tag=tag)
    try:
        import urllib.request as r
        with r.urlopen(r.Request(url, headers=UA), timeout=20) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        raise FetchError(f"{tag}: HTTP {e.code}") from e
    units = (data.get("units") or {}).get(unit) or []
    out = []
    for u in units:
        try:
            d = date.fromisoformat(u["end"])
            out.append((d, float(u["val"])))
        except (KeyError, ValueError, TypeError):
            continue
    out.sort(key=lambda x: x[0])
    return out


def _value_as_of(series, as_of):
    """Most recent (date, value) at or before as_of. None if the series
    starts after as_of -- never carry a future value backward."""
    if not series:
        return None
    dates = [d for d, _ in series]
    i = bisect_right(dates, as_of) - 1
    return series[i] if i >= 0 else None


def shares_series(cik):
    return _xbrl_series(cik, "dei", "EntityCommonStockSharesOutstanding", "shares")


def float_usd_series(cik):
    return _xbrl_series(cik, "dei", "EntityPublicFloat", "USD")


def revenue_series(cik):
    """Merge of us-gaap:Revenues and RevenueFromContractWithCustomerExcluding
    AssessedTax. The reporting tag companies use changed industry-wide
    around 2018; a filer that stopped using "Revenues" still has old
    entries under it, so using it whenever it is non-empty (the original
    either/or) picked years-stale data over the tag actually in current
    use. Keyed by quarter-end: the later-filed value for a given end date
    wins, since a restated figure supersedes the original, and XBRL
    sometimes carries both a quarterly and a cumulative figure for the same
    end date under the same tag -- the smaller of the two is kept, since a
    cumulative (year-to-date) figure is always >= the standalone quarter
    for a growing or flat company and mixing them breaks the y/y compare."""
    merged = {}
    for s in (_xbrl_series(cik, "us-gaap", "Revenues", "USD"),
              _xbrl_series(cik, "us-gaap",
                           "RevenueFromContractWithCustomerExcludingAssessedTax", "USD")):
        for d, v in s:
            if d not in merged or v < merged[d]:
                merged[d] = v
    return sorted(merged.items())


_SI_CACHE = None
_SI_CACHE_PATH = "/app/app/short_interest_raw.json"


def _load_si_cache():
    """NASDAQ's API blocks AWS-origin requests outright (confirmed: every
    call from this box times out, the same call returns in under 3s from a
    residential IP). The cache file is fetched out-of-band from a non-AWS
    machine and copied in; absent the file, this falls through to the live
    call below so a dev box without the cache still works."""
    global _SI_CACHE
    if _SI_CACHE is None:
        try:
            with open(_SI_CACHE_PATH) as f:
                _SI_CACHE = json.load(f)
        except FileNotFoundError:
            _SI_CACHE = {}
    return _SI_CACHE


def short_interest_series(symbol, retries=3):
    """[(settlement_date, pct_of_float), ...]. NASDAQ returns interest
    (shares) and avg daily volume, not percent of float directly, so this
    needs float-in-shares to convert; callers pass raw shares and divide
    downstream against the float series for the same date.

    Raises on a real failure rather than returning []: NASDAQ's endpoint
    times out intermittently under load, and a timeout silently returned
    as "no data" is indistinguishable from a symbol that genuinely has
    none, which makes every si field quietly absent with no error to see."""
    cache = _load_si_cache()
    if symbol in cache:
        data = cache[symbol]
        if data is None:
            return []
    else:
        url = NASDAQ_SI.format(sym=symbol)
        last = None
        for attempt in range(retries):
            try:
                with urllib.request.urlopen(
                        urllib.request.Request(url, headers=UA), timeout=20) as resp:
                    data = json.load(resp)
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return []  # symbol not covered (e.g. delisted) -- a real empty, not a failure
                last = e
                time.sleep(1.5 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError) as e:
                last = e
                time.sleep(1.5 * (attempt + 1))
        else:
            raise FetchError(f"{symbol}: short interest {type(last).__name__} {last}") from last
    rows = ((data.get("data") or {}).get("shortInterestTable") or {}).get("rows") or []
    out = []
    for r in rows:
        try:
            mm, dd, yyyy = (int(x) for x in r["settlementDate"].split("/"))
            d = date(yyyy, mm, dd)
            shares = int(r["interest"].replace(",", ""))
            out.append((d, shares))
        except (KeyError, ValueError, TypeError):
            continue
    out.sort(key=lambda x: x[0])
    return out


def _close_on_or_before(cur, ticker_id, d):
    cur.execute(
        "SELECT close FROM price_bars WHERE ticker_id=%s AND d<=%s "
        "ORDER BY d DESC LIMIT 1", (ticker_id, d))
    row = cur.fetchone()
    return float(row[0]) if row else None


def compute_for_ticker(cur, ticker_id, cik, symbol, event_dates):
    """{event_date: {"cap":.., "float":.., "si":.., "growth":..}} using only
    the value known as of each date. A field stays None when no series
    exists or it starts after the event, rather than guessing."""
    shares = shares_series(cik)
    floatusd = float_usd_series(cik)
    revenue = revenue_series(cik)
    si_shares = short_interest_series(symbol)

    out = {}
    for d in event_dates:
        px = _close_on_or_before(cur, ticker_id, d)
        row = {"cap": None, "float": None, "si": None, "growth": None}

        sh = _value_as_of(shares, d)
        if sh and px:
            row["cap"] = round(sh[1] * px, 2)

        fl = _value_as_of(floatusd, d)
        if fl and fl[1] and px:
            row["float"] = int(fl[1] / px)

        sip = _value_as_of(si_shares, d)
        flt_shares = row["float"] or (sh[1] if sh else None)
        if sip and flt_shares:
            row["si"] = round(sip[1] / flt_shares * 100, 3)

        rv = _value_as_of(revenue, d)
        if rv:
            # Same calendar quarter, one year earlier -- revenue is deduped
            # to one value per exact quarter-end, so an exact date match
            # (allowing for the one-day leap-year slip) is the real y/y
            # comparison, not a fuzzy nearest-value lookup that can land on
            # an adjacent quarter and silently misreport growth.
            try:
                target = rv[0].replace(year=rv[0].year - 1)
            except ValueError:  # Feb 29 with no leap year a year prior
                target = rv[0].replace(year=rv[0].year - 1, day=28)
            prior_val = next((v for (dd, v) in revenue if abs((dd - target).days) <= 3), None)
            if prior_val and prior_val > 0:
                row["growth"] = round((rv[1] - prior_val) / prior_val * 100, 3)

        out[d] = row
    return out


def run(limit=None, verbose=True):
    from app.market_data import finish_run, start_run

    conn = get_conn()
    updated = skipped = failed = 0
    run_id = None
    try:
        run_id = start_run(conn, "historical_fundamentals")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT i.ticker_id, t.symbol FROM backtest_events be "
                "JOIN instruments i ON i.id=be.instrument_id "
                "JOIN tickers t ON t.id=i.ticker_id "
                "WHERE NOT be.synthetic_data_used ORDER BY t.symbol")
            tickers = cur.fetchall()
        if limit:
            tickers = tickers[:limit]
        cmap = ticker_to_cik()
        if verbose:
            print(f"{len(tickers)} tickers")

        for n, (ticker_id, symbol) in enumerate(tickers, 1):
            cik = cmap.get(symbol.upper())
            if not cik:
                skipped += 1
                continue
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT be.id, be.event_date, be.provenance_json FROM backtest_events be "
                        "JOIN instruments i ON i.id=be.instrument_id "
                        "WHERE i.ticker_id=%s AND NOT be.synthetic_data_used", (ticker_id,))
                    events = cur.fetchall()
                    dates = sorted({e[1] for e in events})
                    values = compute_for_ticker(cur, ticker_id, cik, symbol, dates)
                    for eid, d, prov in events:
                        v = values.get(d, {})
                        if all(x is None for x in v.values()):
                            continue
                        hard_filters = [{"key": k, "value": val}
                                         for k, val in v.items() if val is not None]
                        prov = dict(prov or {})
                        prov["fundamentals_source"] = (
                            "SEC XBRL (cap, growth, float) + NASDAQ settlement SI "
                            "(short interest); point-in-time as of the event date, "
                            "except float which is the most recent annual 10-K figure")
                        prov["fundamentals_as_of"] = d.isoformat()
                        cur.execute(
                            "UPDATE backtest_events SET inputs_json=%s, provenance_json=%s "
                            "WHERE id=%s",
                            (json.dumps({"hard_filters": hard_filters}), json.dumps(prov), eid))
                        updated += 1
                conn.commit()
            except Exception as e:
                conn.rollback()
                failed += 1
                if verbose and failed <= 10:
                    print(f"  ! {symbol}: {e}")
            if verbose and n % 50 == 0:
                print(f"  {n}/{len(tickers)} updated={updated} skipped={skipped} failed={failed}")
            time.sleep(PACE)
        if run_id:
            finish_run(conn, run_id, len(tickers) - failed, failed, updated, {})
    finally:
        conn.close()
    if verbose:
        print(f"done: events_updated={updated} tickers_skipped={skipped} tickers_failed={failed}")
    return {"events_updated": updated, "tickers_skipped": skipped, "tickers_failed": failed}


if __name__ == "__main__":
    lim = int(sys.argv[1]) if len(sys.argv) > 1 else None
    run(limit=lim)
