#!/usr/bin/env python3
"""
refresh.py — Phase 1 of the fast-mover screen's live-data layer.
Pulls per-ticker market data and writes data.js (window.LIVE_DATA = {...})
next to fast_mover_screen.html. The page overlays whatever this file
contains and stamps every figure with its age — freshness shown, never implied.

Design rules (from live_interface_plan.md + decision_log.md):
  * Every fetch is wrapped; a failure NEVER kills the run. On failure the
    previous data.js value for that field is carried forward with its OLD
    asof date, so age chips show staleness honestly.
  * Published short interest is bi-weekly and ~9 days stale BY DESIGN — we
    record its settlement/report date separately (si_asof) and never dress
    it up as fresh.
  * Daily short VOLUME (FINRA shvol files) is NOT short interest (decision
    D-013). This script never uses it.
  * Not investment advice. The output queues candidates for verification;
    every cell is a claim to re-verify before money moves.

Usage:
  python3 refresh.py                     # refresh all tickers -> data.js
  python3 refresh.py --tickers NNE,TSSI  # subset
  python3 refresh.py --seed seed.json    # merge hand-verified numbers (research passes)
  python3 refresh.py --offline           # no network: reuse old data.js + seed only
  python3 refresh.py --stats-max-age 7   # price/borrow daily, float/SI weekly
  python3 refresh.py --out /path/data.js

Requires: pip3 install yfinance — without it you get price and borrow only
(no float, SI, cap, DTC or earnings, i.e. none of the squeeze mechanics).

Data sources (free tier, personal use):
  * Yahoo v8 chart API (no auth): price, volume, 52w position, 3-mo run-up.
  * yfinance (pip install yfinance), if importable: float, shares out, SI%
    of float, shares short, DTC, short-interest report date, market cap,
    next earnings date. Skipped gracefully if not installed.
  * iBorrowDesk JSON (IBKR data): borrow fee + available shares (the daily
    real-time proxy for SI tightening).

Scheduling on the Mac (Option A of the plan): see com.ali.stonks.refresh.plist
in this folder — 7:00 ET weekday mornings + Sunday.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "data.js")

# Active universe, v5 (Aug 6, 2026 PM — fuzzy scoring, no hard cutoffs).
# Only NBIS stays excluded (no data row). Keep in sync with the SHORTLIST/
# BENCH/WIDE_BENCH/GEM_BENCH arrays in fast_mover_screen.html.
TICKERS = [
    # core
    "INOD", "SOUN", "RXRX", "AAOI", "RCAT", "RR", "PENG", "APLD", "DUOT",
    # bench v3 (EOSE/CIFR/LUNR re-admitted under v5 size-scaling)
    "QBTS", "RGTI", "QUBT", "ARQQ", "LAES", "NNE", "UUUU", "EOSE", "CIFR",
    "BTDR", "BTBT", "ONDS", "UMAC", "KULR", "LUNR", "RDW", "SERV",
    "AEVA", "OUST", "BBAI", "POET", "ABSI", "USAR",
    # bench v4
    "TSSI", "INFQ", "LTBR", "BKSY", "CRML", "WGS", "PDYN", "NKLR",
    # v5 wide net (sweep-2 near-misses, size/SI scaled instead of gated)
    "ASPI", "FLY", "SEI", "LPTH", "AMSC", "POWL", "VOYG", "EVTL", "EH",
    "BKKT", "AIRO", "METC", "BULL", "SEZL", "HQ",
    # v5 gem sweep (quality factors: founders/backers/gov/orderbook/demand)
    "LEU", "NTLA", "FIGR", "GHM", "KRMN", "SECZ", "PPTA", "BETA", "IPX",
    "AEHR", "VKTX", "HTFL", "LGN", "ISSC", "INV", "TMQ", "VICR",
    # v5.1 (Aug 6 after-market table)
    "INDI",
]

# v6 scan tier (Aug 8, 2026 — ~250 leads; sweep-estimated data until first live pull.
# Full run takes a while at --sleep 1.5; use --sleep 0.5 or --tickers for subsets.)
SCAN_TICKERS = [
    "GTLB", "PATH", "AI", "CRNC", "DOMO", "APPN", "ZETA", "LZ", "LAW", "FIG",
    "TTAN", "FSLY", "AKAM", "DOCN", "ESTC", "CRWV", "QNT", "BTQ", "S", "TENB",
    "RPD", "OSPN", "NTSK", "LSCC", "SYNA", "AMBA", "SMTC", "SITM", "SIMO", "TSEM",
    "GSIT", "AIP", "SVCO", "AMBQ", "FORM", "CAMT", "ONTO", "ACLS", "KLIC", "UCTT",
    "ACMR", "HIMX", "AXTI", "INVZ", "AAON", "MOD", "SPXC", "IESC", "LMB", "DY",
    "VNET", "ATEN", "SMCI", "SANM", "OSS", "BWXT", "MIR", "CW", "IMSR", "FISN",
    "SILXY", "PESI", "DNN", "NXE", "UEC", "EU", "ISOU", "UROY", "SRUUF", "AZZ",
    "PLPC", "HMDPF", "PPSI", "CTOS", "MYRG", "WLDN", "TLN", "FRMI", "BKV", "HNRG",
    "LB", "PSIX", "FRVO", "FLNC", "ARRY", "NXT", "SHLS", "SEDG", "ENVX", "AMPX",
    "SES", "ULBI", "ENS", "LBRT", "PUMP", "AESI", "KGS", "TDW", "OII", "HII",
    "MATX", "KEX", "GLDD", "ORN", "TWIN", "CNRD", "CODA", "OPTT", "AGX", "STRL",
    "PRIM", "ECG", "MTRX", "CECO", "ATS", "MRCY", "DRS", "DCO", "ATRO", "TTMI",
    "BELFB", "ESE", "LASR", "AVNW", "FEIM", "MPTI", "ESP", "ALNT", "NPK", "OLN",
    "MTUS", "PKE", "CPSH", "NNDM", "KDK", "SPAI", "OSIS", "CLBT", "CGNT", "SSTI",
    "SNT", "CDRE", "BYRN", "VTSI", "CAE", "BKTI", "GNSS", "KOPN", "OPXS", "VVX",
    "AADX", "PL", "SPIR", "SATL", "TSAT", "GSAT", "VSAT", "IRDM", "GILT", "NN",
    "SRPT", "ALT", "PHAT", "QURE", "CELC", "VRDN", "OCUL", "LXRX", "DYN", "COGT",
    "PROK", "IOVA", "SANA", "BEAM", "CRSP", "WVE", "ACLX", "TSHA", "LEGN", "CLPT",
    "HIMS", "LFMD", "STVN", "TERN", "GPCR", "SRRK", "BFLY", "NNOX", "PSNL", "RDNT",
    "CERT", "SLP", "CBLL", "MDAI", "EVLV", "TLS", "AISP", "BAH", "PSN", "MTRN",
    "ATI", "CRS", "MP", "ALM", "UAMY", "NB", "TMC", "LAC", "SLI", "IONR",
    "ABAT", "NVA", "NMG", "IE", "TGB", "NG", "THM", "HYMC", "USAS", "USGO",
    "IDR", "BLSH", "ETOR", "WULF", "HUT", "CORZ", "CLSK", "MQ", "CHYM", "KLAR",
    "UPST", "LMND", "DAVE", "ROOT", "HIPO", "OSCR", "KSS", "W", "WOOF", "VSCO",
    "FIGS", "PTON", "ZIM", "ECO", "TRMD", "GNK", "PANL", "HSHP",
]
TICKERS = TICKERS + SCAN_TICKERS

# v7 round-2 harvest (Aug 8 PM)
SCAN_TICKERS_R2 = [
    "MU", "SNDK", "WDC", "STX", "PSTG", "MRAM", "PLAB", "AOSL", "MXL", "AEIS",
    "RMBS", "CEVA", "PDFS", "CLFD", "CALX", "COMM", "UI", "ERII", "ARIS", "NWPX",
    "PCYO", "VITL", "AGRO", "LWAY", "AVO", "ENR", "SYM", "RAIL", "AUR", "FWRD",
    "BLBD", "VIA", "GRND", "FUBO", "RUM", "SEAT", "MNTN", "GRPN", "GLBE", "TDUP",
    "REAL", "JMIA", "ZIP", "ASAN", "NSP", "DLO", "STNE", "INTR", "TBBB", "TMDX",
    "TNDM", "ATEC", "INSP", "STAA", "AQST", "VNDA", "ETON", "HROW", "IRWD", "SNDX",
    "KURA", "AXSM", "PRAX", "NUVL", "NXRX", "LGIH", "HOV", "DFH", "SDHC", "KRP",
    "NRP", "TXO", "SMC", "CARL", "NAVN", "GDS", "ATAT", "BZ", "YMM",
]
TICKERS = TICKERS + SCAN_TICKERS_R2


UA = {"User-Agent": "Mozilla/5.0 (personal research script; fast-mover screen)"}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_json(url, timeout=15):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# ---------------------------------------------------------------- yahoo chart
def fetch_chart(ticker):
    """Price/volume block from Yahoo's unauthenticated chart endpoint."""
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{ticker}?range=1y&interval=1d&events=div%2Csplit")
    j = http_json(url)
    res = j["chart"]["result"][0]
    meta = res.get("meta", {})
    q = res["indicators"]["quote"][0]
    closes = [c for c in (q.get("close") or []) if c is not None]
    vols = [v for v in (q.get("volume") or []) if v is not None]
    if not closes:
        raise ValueError("no closes")
    px = closes[-1]
    prev = closes[-2] if len(closes) > 1 else None
    out = {
        "px": round(px, 4),
        "px_asof": now_iso(),
        "day_pct": round((px / prev - 1) * 100, 2) if prev else None,
        "cur": meta.get("currency") or "USD",
    }
    # 3-month run-up (early lane's "not yet run" filter, ~63 sessions)
    if len(closes) > 63:
        out["run3m_pct"] = round((px / closes[-64] - 1) * 100, 1)
    hi52 = max(closes)
    lo52 = min(closes)
    out["hi52"], out["lo52"] = round(hi52, 2), round(lo52, 2)
    out["off_high_pct"] = round((px / hi52 - 1) * 100, 1)
    if len(vols) >= 21:
        avg20 = sum(vols[-21:-1]) / 20.0
        out["avgvol20"] = int(avg20)
        if avg20:
            out["volx20d"] = round(vols[-1] / avg20, 2)  # >3 = ignition tell
    return out


# ------------------------------------------------------------------ yfinance
def fetch_stats(ticker):
    """Float / SI / cap / earnings via yfinance, field-by-field, best effort."""
    import yfinance as yf  # optional dependency
    t = yf.Ticker(ticker)
    out = {}
    info = {}
    try:
        info = t.get_info() or {}
    except Exception:
        try:
            info = dict(getattr(t, "fast_info", {}) or {})
        except Exception:
            info = {}

    def grab(key, field, scale=None, rnd=None):
        v = info.get(key)
        if v in (None, 0, "N/A"):
            return
        if scale:
            v = v / scale
        if rnd is not None:
            v = round(v, rnd)
        out[field] = v

    grab("marketCap", "cap_usd_m", scale=1e6, rnd=1)
    grab("floatShares", "float_m", scale=1e6, rnd=2)
    grab("sharesOutstanding", "so_m", scale=1e6, rnd=2)
    grab("sharesShort", "si_shares_m", scale=1e6, rnd=2)
    grab("shortRatio", "dtc", rnd=2)
    # quarterly revenue growth y/y (fuzzy 'growth' component; overrides the
    # hand-entered GROWTH map in the page when present)
    v = info.get("revenueGrowth")
    if v is not None:
        out["growth_pct"] = round(v * 100, 1)
    v = info.get("shortPercentOfFloat")
    if v:
        out["si_pct_float"] = round(v * 100, 2)
    elif out.get("si_shares_m") and out.get("float_m"):
        out["si_pct_float"] = round(out["si_shares_m"] / out["float_m"] * 100, 2)
        out.setdefault("notes", []).append("SI% derived from sharesShort/float")
    # the settlement date behind the SI print — the honest age of that number
    d = info.get("dateShortInterest")
    if d:
        try:
            out["si_asof"] = dt.datetime.fromtimestamp(
                int(d), dt.timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            pass
    if any(k in out for k in ("si_pct_float", "si_shares_m", "dtc")):
        out.setdefault("si_asof", None)  # explicit "vintage unknown"
    # next earnings date
    try:
        cal = t.get_earnings_dates(limit=8)
        if cal is not None and len(cal):
            future = [d for d in cal.index.to_pydatetime()
                      if d.date() >= dt.date.today()]
            if future:
                out["earnings"] = min(future).strftime("%Y-%m-%d")
                out["earnings_conf"] = "yfinance"
                out["earnings_asof"] = now_iso()
    except Exception:
        pass
    if out:
        out["stats_asof"] = now_iso()
    return out


# --------------------------------------------------------------- iborrowdesk
def fetch_borrow(ticker):
    """Borrow fee + availability (IBKR via iBorrowDesk) — the daily SI proxy."""
    j = http_json(f"https://www.iborrowdesk.com/api/ticker/{ticker}")
    real = j.get("real_time") or []
    daily = j.get("daily") or []
    row = (real[-1] if real else (daily[-1] if daily else None))
    if not row:
        return {}
    out = {}
    fee = row.get("fee")
    if fee is not None:
        out["fee_pct"] = round(float(fee), 2)
    avail = row.get("available")
    if avail is not None:
        out["borrow_avail"] = avail
    when = row.get("time") or row.get("date")
    out["fee_asof"] = str(when) if when else now_iso()
    return out


# ------------------------------------------------------------------- merging
FIELD_GROUPS = {
    "chart": ["px", "px_asof", "day_pct", "run3m_pct", "hi52", "lo52",
              "off_high_pct", "avgvol20", "volx20d", "cur"],
    "stats": ["cap_usd_m", "float_m", "so_m", "si_shares_m", "si_pct_float",
              "dtc", "growth_pct", "si_asof", "earnings", "earnings_conf",
              "earnings_asof", "stats_asof"],
    "borrow": ["fee_pct", "borrow_avail", "fee_asof"],
}


def load_previous(path):
    """Parse the JSON object out of an existing data.js, if any."""
    try:
        with open(path, encoding="utf-8") as f:
            txt = f.read()
        m = re.search(r"window\.LIVE_DATA\s*=\s*(\{.*\})\s*;?\s*$", txt, re.S)
        if m:
            return json.loads(m.group(1))
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"  ! could not parse previous data.js ({e}) — starting clean")
    return {}


def carry_forward(new, old, group, err):
    """On a failed fetch, keep the old numbers and their OLD dates."""
    kept = False
    for f in FIELD_GROUPS[group]:
        if f in old and f not in new:
            new[f] = old[f]
            kept = True
    tag = f"{group}: {err}" + (" (stale values carried forward)" if kept else "")
    new.setdefault("errors", []).append(tag)


def stats_age_days(old):
    """Age of the cached stats block in days, or None if never fetched."""
    asof = (old or {}).get("stats_asof")
    if not asof:
        return None
    try:
        when = dt.datetime.strptime(asof[:10], "%Y-%m-%d").replace(
            tzinfo=dt.timezone.utc)
    except Exception:
        return None
    return (dt.datetime.now(dt.timezone.utc) - when).days


def refresh_ticker(tk, old, offline, stats_max_age=0):
    rec = {}
    old = old or {}
    if offline:
        rec.update({k: v for k, v in old.items() if k != "errors"})
        rec.setdefault("errors", []).append("offline run — all values carried forward")
        return rec
    try:
        rec.update(fetch_chart(tk))
    except Exception as e:
        carry_forward(rec, old, "chart", f"{type(e).__name__}: {e}")
    # Float/SI/cap move slowly (SI publishes bi-weekly), but each stats pull
    # costs two yfinance calls and is what rate-limits a large universe.
    # --stats-max-age reuses a recent cached block so price/borrow can refresh
    # daily while stats refresh weekly. Cached values keep their OLD asof date,
    # so age chips still show the true vintage.
    age = stats_age_days(old)
    if stats_max_age and age is not None and age <= stats_max_age:
        for f in FIELD_GROUPS["stats"]:
            if f in old:
                rec[f] = old[f]
    else:
        try:
            stats = fetch_stats(tk)
            if stats:
                rec.update(stats)
            else:
                carry_forward(rec, old, "stats", "yfinance returned nothing")
        except ImportError:
            carry_forward(rec, old, "stats", "yfinance not installed (pip install yfinance)")
        except Exception as e:
            carry_forward(rec, old, "stats", f"{type(e).__name__}: {e}")
    try:
        rec.update(fetch_borrow(tk))
    except Exception as e:
        carry_forward(rec, old, "borrow", f"{type(e).__name__}: {e}")
    # keep durable hand-entered notes from seeds/previous runs
    for k in ("notes", "earnings_note", "float_note", "si_note"):
        if k in old and k not in rec:
            rec[k] = old[k]
    return rec


def deep_merge_seed(base, seed):
    """Seed values are hand-verified research numbers WITH their own asof
    dates; they overwrite fetched/carried values field-by-field."""
    for tk, fields in seed.get("tickers", {}).items():
        dst = base.setdefault("tickers", {}).setdefault(tk, {})
        for k, v in fields.items():
            if k == "notes":
                dst["notes"] = sorted(set(dst.get("notes", []) + v))
            else:
                dst[k] = v
    return base


# ---------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--tickers", help="comma-separated subset")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--seed", help="JSON file of hand-verified values to merge")
    ap.add_argument("--offline", action="store_true",
                    help="no network calls; previous data.js + seed only")
    ap.add_argument("--sleep", type=float, default=1.5,
                    help="seconds between tickers (rate-limit courtesy)")
    ap.add_argument("--stats-max-age", type=int, default=0, metavar="DAYS",
                    help="reuse cached float/SI/cap if fetched within DAYS "
                         "(0 = always refetch). Use 7 for large universes: "
                         "price/borrow stay daily, stats go weekly.")
    args = ap.parse_args()

    tickers = ([t.strip().upper() for t in args.tickers.split(",") if t.strip()]
               if args.tickers else TICKERS)
    prev = load_previous(args.out)
    prev_t = prev.get("tickers", {})

    out = {"tickers": {}}
    for i, tk in enumerate(tickers):
        print(f"[{i+1}/{len(tickers)}] {tk} ...", flush=True)
        out["tickers"][tk] = refresh_ticker(tk, prev_t.get(tk), args.offline,
                                            args.stats_max_age)
        if not args.offline and i < len(tickers) - 1:
            time.sleep(args.sleep)

    # tickers not in this run keep their previous block untouched
    for tk, block in prev_t.items():
        out["tickers"].setdefault(tk, block)

    if args.seed:
        with open(args.seed, encoding="utf-8") as f:
            seed = json.load(f)
        deep_merge_seed(out, seed)
        srcs = prev.get("seed_sources", [])
        label = seed.get("label") or os.path.basename(args.seed)
        if label not in srcs:
            srcs.append(label)
        out["seed_sources"] = srcs
    elif "seed_sources" in prev:
        out["seed_sources"] = prev["seed_sources"]

    out["generated"] = now_iso()
    out["generator"] = "refresh.py (Phase 1 — see live_interface_plan.md)"
    n_err = sum(1 for t in out["tickers"].values() if t.get("errors"))
    out["run_summary"] = (f"{len(tickers)} refreshed, "
                          f"{n_err} with fetch issues (stale values carried forward)")

    body = json.dumps(out, indent=1, sort_keys=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("/* generated by refresh.py — do not edit by hand.\n"
                "   Every value is a claim to re-verify before money moves. */\n"
                "window.LIVE_DATA = " + body + ";\n")
    print(f"wrote {args.out} — {out['run_summary']}")


if __name__ == "__main__":
    main()
