#!/usr/bin/env python3
"""seed_universe.py — synthetic Fast Mover run from the operator's workbench.

Stages 3/4 need real scored rows before the scoring engine exists. This seeds
the universe (tickers + instruments) plus one scored `run` by replaying the
workbench's own data and scoring decisions:

  * universe metadata: fast_mover_screen.html data constants, extracted to
    `_workbench_meta.json` by `_extract_workbench.js` (node build step). The
    folded SHORTLIST already contains every curated row plus the scan tier.
  * market data: the product's `data.js` snapshot plus the seed_2026-08-*.json
    research passes, merged the same way refresh.py deep-merges them.
  * scores: a direct port of the workbench's FUZZY engine (FZW weights,
    FZ_CURVES interpolation, GROWTH/QUAL/HEAT_RULES/HAIRCUTS/PREREV, uncertainty
    shrinkage toward a neutral 40, documented haircuts and pre-flags), evaluated
    at the data.js vintage so catalyst proximity is consistent with the data.

Design choices, recorded so they can be revisited:
  * Band is assigned purely from the score cutoffs on the `strategies` row.
    The operator removed hard cutoffs from ranking in v5 ("fuzzy 0-100 machine
    score now ranks the whole universe"); hard-filter checks are still captured
    mechanically in hard_filter_json for the stock report's evidence panel.
  * Names the workbench marks `excluded` (e.g. NBIS, graduated) get an inactive
    instrument row and no score, but stay in the universe for the ticker search.

Run inside the app container (psycopg + DATABASE_URL available). The workbench
inputs must be visible at $WB_DIR (default: ../ — the finance dir). Idempotent:
re-running updates the same run and rows in place.

Usage: docker compose exec -T app python db/seed_universe.py
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

WB_DIR = Path(os.environ.get("WB_DIR", Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import get_conn  # noqa: E402

RUN_AS_OF_STR = "2026-08-09T11:21:04Z"
RUN_AS_OF = datetime.fromisoformat(RUN_AS_OF_STR)
SEED_FILES = [
    "seed_2026-08-06.json",
    "seed_2026-08-06_v5.json",
    "seed_2026-08-06_catalysts.json",
    "seed_2026-08-07_close.json",
]

# industry mapping: first match wins, ordered so specific themes win over broad
# catch-alls. Themes come from the workbench's theme buckets.
THEME_RULES = [
    (r"quantum|qubit|neutral-atom|post-quantum", "quantum_compute"),
    (r"defense|drone|missile|hyperson|munition|shipbuild|navy|aviation|space|lunar|satellite|ISR|gov tech|cyber", "defense_space"),
    (r"HALEU|uranium|enrich|nuclear fuel|isotope|reactor|rare earth|critical minerals|antimony|titanium|copper|cobalt", "energy_nuclear"),
    (r"genomic|gene|bio|drug|GLP|obesity|cardiac|diagnost|biotech|medtech|cell therapy|PDUFA|pharma", "biotech_pharma"),
    (r"battery|storage|solar|grid|power|turbine|switchgear|cooling|thermal|800V|clean energy", "battery_clean_energy"),
    (r"fintech|insurtech|lending|neobank|BNPL|payment|digital bank", "fintech_payments"),
    (r"retail|consumer|e-?commerce|homebuild|e-?retail", "consumer_ecom"),
    (r"media|adtech|streaming|social|music|content", "media_adtech"),
    (r"semi|silicon|chip|memory|optic|transceiver|interposer|burn-in|foundry|GPU", "semiconductors"),
    (r"AI|data center|datacenter|HPC|cloud|software|robot|autonomy|voice|edge|LlM|agent", "ai_software_data"),
]

GROUP_FOLD = {"A": "A", "B": "A", "Lottery": "Bench", "WatchX": "Bench", "Bench": "Bench", "Scan": "Scan"}
LANE_FOLD = {"event": "Event", "early": "Early", "none": ""}

FZW = {"float": 13, "si": 14, "dtc": 5, "fee": 4, "cap": 7, "growth": 12,
       "cat": 11, "mom": 9, "news": 9, "qual": 16}
HARD_FILTERS = [
    ("cap", lambda v: 300 <= v <= 3000, "$300M-$3B market cap"),
    ("float", lambda v: v < 50, "float < 50M shares"),
    ("si", lambda v: v > 10, "short interest > 10% of float"),
    ("growth", lambda v: v > 40, "revenue growth > 40% y/y"),
]


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_live_data(data_js):
    m = re.search(r"window\.LIVE_DATA\s*=\s*(\{.*\})\s*;?\s*$", data_js, re.S)
    if not m:
        raise SystemExit("data.js: LIVE_DATA object not found")
    return json.loads(m.group(1))


def deep_merge_seed(base, seed):
    for tk, fields in seed.get("tickers", {}).items():
        dst = base.setdefault("tickers", {}).setdefault(tk, {})
        for k, v in fields.items():
            if k == "notes":
                dst["notes"] = sorted(set(dst.get("notes", []) + v))
            else:
                dst[k] = v
    return base


def fz_interp(x, pts):
    if x <= pts[0][0]:
        return pts[0][1]
    for i in range(1, len(pts)):
        if x <= pts[i][0]:
            x0, y0 = pts[i - 1]
            x1, y1 = pts[i]
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def classify_industry(theme):
    for pat, key in THEME_RULES:
        if re.search(pat, theme, re.I):
            return key
    return "ai_software_data"


def port_fuzzy(rows, meta, live_md, as_of):
    """Replay the workbench FUZZY engine over the folded SHORTLIST rows."""
    curves = meta["FZ_CURVES"]
    heat_rules = meta["HEAT_RULES"]
    growth = meta["GROWTH"]
    qual = meta["QUAL"]
    haircuts = meta["HAIRCUTS"]
    prerev = set(meta["PREREV"])
    scan_est = meta.get("SCAN_EST") or {}

    def live_of(t):
        est = scan_est.get(t) or {}
        live = (live_md.get(t) or {}) if live_md else {}
        return {**est, **live}

    def cat_days(r):
        d = live_of(r["ticker"])
        if d.get("earnings"):
            try:
                e = datetime.fromisoformat(str(d["earnings"]) + "T20:00:00Z")
                days = (e - as_of).total_seconds() / 86400.0
                if days >= -1:
                    return max(0, int(round(days)))
            except ValueError:
                pass
        if r.get("group") == "Scan":
            return 14 if r.get("dated") else 60
        if r.get("dated"):
            return 10
        return 45 if r.get("lane") == "early" else 120

    def heat(r):
        if r.get("heat") is not None:
            return r["heat"]
        for pat, v in heat_rules:
            if re.search(pat, r.get("theme", ""), re.I):
                return v
        return 0.5

    out = {}
    for r in rows:
        if not r.get("ticker"):
            continue
        t = r["ticker"]
        if r.get("excluded"):
            out[t] = {"excluded": True}
            continue
        d = live_of(t)
        parts = []

        def add(k, label, w, s, val, backed):
            if s is not None:
                parts.append({"k": k, "label": label, "weight": w,
                              "score": max(0.0, min(1.0, s)), "val": val, "backed": bool(backed)})

        fl = d.get("float_m") if d.get("float_m") is not None else d.get("so_m")
        add("float", "float tightness", FZW["float"],
            fz_interp(fl, curves["float"]) if fl is not None else None,
            f"{fl}M" + ("" if d.get("float_m") is not None else " (s/o proxy)") if fl is not None else None, True)
        if d.get("si_pct_float") is not None:
            add("si", "short interest", FZW["si"],
                fz_interp(d["si_pct_float"], curves["si"]), f'{d["si_pct_float"]}%', True)
        if d.get("dtc") is not None:
            add("dtc", "days-to-cover", FZW["dtc"], fz_interp(d["dtc"], curves["dtc"]), f'{d["dtc"]}d', True)
        if d.get("fee_pct") is not None:
            add("fee", "borrow fee", FZW["fee"], fz_interp(d["fee_pct"], curves["fee"]), f'{d["fee_pct"]}%', True)
        if d.get("cap_usd_m") is not None:
            cap = d["cap_usd_m"]
            add("cap", "size (scaled)", FZW["cap"], fz_interp(cap, curves["cap"]),
                f'${cap/1000:.1f}B' if cap >= 1000 else f'${int(cap)}M', True)
        gr = d.get("growth_pct") if d.get("growth_pct") is not None else (growth.get(t, [None])[0])
        add("growth", "revenue growth", FZW["growth"],
            .15 if t in prerev else (fz_interp(gr, curves["growth"]) if gr is not None else None),
            "pre-revenue" if t in prerev else (f'+{gr}%' if gr is not None else None), True)
        cd = cat_days(r)
        add("cat", "catalyst proximity", FZW["cat"], fz_interp(cd, curves["catd"]),
            "none" if cd >= 365 else f'{cd}d' + ("" if d.get("earnings") else " (assumed)"), True)
        mom = []
        if d.get("run3m_pct") is not None:
            mom.append(fz_interp(d["run3m_pct"], curves["run3m"]))
        if d.get("off_high_pct") is not None:
            mom.append(fz_interp(d["off_high_pct"], curves["offhi"]))
        if d.get("volx20d") is not None:
            mom.append(fz_interp(d["volx20d"], curves["volx"]))
        if mom:
            add("mom", "momentum / coil", FZW["mom"], sum(mom) / len(mom),
                f'{len(mom)} signal' + ("s" if len(mom) > 1 else ""), True)
        nh = heat(r)
        if d.get("volx20d") is not None and d["volx20d"] >= 3:
            nh = min(1.0, nh + .15)
        add("news", "news / narrative", FZW["news"], nh, f'heat {nh:.2f}', False)
        ql = qual.get(t)
        if ql:
            vals = [v[0] for v in ql.values()]
            add("qual", "quality factors", FZW["qual"], sum(vals) / len(vals),
                f'{len(vals)} of 5 known', True)

        w_sum = sum(p["weight"] for p in parts)
        raw = sum(p["weight"] * p["score"] for p in parts) / (w_sum or 1)
        hc = haircuts.get(t)
        pen = 5 * len(r.get("preFlags") or []) + (hc[0] if hc else 0)
        data_w = sum(p["weight"] for p in parts if p["backed"] and p["k"] != "news")
        data_tot = sum(FZW[k] for k in FZW if k != "news")
        cov = data_w / data_tot
        conf = 0.25 + 0.75 * cov
        total = max(0.0, min(100.0, 40 + (raw * 100 - 40) * conf - pen))

        hf = []
        hf_growth = d.get("growth_pct") if d.get("growth_pct") is not None else gr
        for hf_key, predicate, label in HARD_FILTERS:
            v = hf_growth if hf_key == "growth" else d.get(hf_key)
            if v is not None:
                hf.append({"key": hf_key, "label": label, "value": v, "pass": bool(predicate(v))})

        out[t] = {
            "total": total, "cov": cov, "parts": parts, "pen": pen,
            "hc": hc, "raw": raw * 100,
            "shrinkage": (raw * 100 - 40) * (1 - conf) if cov < 1 else 0.0,
            "shrinkage_from": raw * 100,
            "hard_filters": hf,
        }
    return out


def band_for(value, cutoffs):
    order = [("strong", cutoffs.get("strong", 75)), ("elevated", cutoffs.get("elevated", 50)),
             ("neutral", cutoffs.get("neutral", 25)), ("weak", 0)]
    for name, lo in order:
        if value >= lo:
            return name
    return "weak"


def main():
    meta = load_json(WB_DIR / "_workbench_meta.json")
    rows = meta["SHORTLIST"]

    with (WB_DIR / "data.js").open(encoding="utf-8") as f:
        live = load_live_data(f.read())
    for name in SEED_FILES:
        seed_path = WB_DIR / name
        if seed_path.exists():
            live = deep_merge_seed(live, load_json(seed_path))
    live_md = live.get("tickers", {})

    scores_by_ticker = port_fuzzy(rows, meta, live_md, RUN_AS_OF)

    conn = get_conn()
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("SELECT id, key, band_cutoffs_json FROM strategies WHERE key = 'fast_mover'")
    strat_id, _, cutoffs = cur.fetchone()

    # run row: reuse by as_of so re-runs update in place
    cur.execute("SELECT id FROM runs WHERE as_of = %s ORDER BY id DESC LIMIT 1", (RUN_AS_OF,))
    run = cur.fetchone()
    if run:
        run_id = run[0]
        cur.execute("UPDATE runs SET status = 'completed', completed_at = now() WHERE id = %s", (run_id,))
    else:
        cur.execute("""INSERT INTO runs (as_of, started_at, completed_at, status)
                       VALUES (%s, now(), now(), 'completed') RETURNING id""", (RUN_AS_OF,))
        run_id = cur.fetchone()[0]

    n_scores = 0
    n_instruments = 0
    band_tally = {}
    for r in rows:
        t = r.get("ticker")
        if not t:
            continue
        res = scores_by_ticker.get(t)
        if res and res.get("excluded"):
            active = False
        else:
            active = True

        cur.execute("INSERT INTO tickers (symbol) VALUES (%s) ON CONFLICT (symbol) DO NOTHING", (t,))
        cur.execute("SELECT id FROM tickers WHERE symbol = %s", (t,))
        ticker_id = cur.fetchone()[0]

        industry_key = classify_industry(r.get("theme", ""))
        cur.execute("SELECT id FROM industries WHERE key = %s", (industry_key,))
        industry_row = cur.fetchone()
        if not industry_row:
            continue
        industry_id = industry_row[0]

        hook = r.get("fuel") or ""
        thesis = r.get("thesis") or ""
        cur.execute("""
            INSERT INTO instruments (ticker_id, industry_id, theme, lane, instrument_group, hook, thesis, active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (ticker_id, industry_id) DO UPDATE SET
              theme = EXCLUDED.theme, lane = EXCLUDED.lane,
              instrument_group = EXCLUDED.instrument_group, hook = EXCLUDED.hook,
              thesis = EXCLUDED.thesis, active = EXCLUDED.active
        """, (ticker_id, industry_id, r.get("theme", ""), LANE_FOLD.get(r.get("lane"), ""),
              GROUP_FOLD.get(r.get("group", "Scan"), "Scan"), hook, thesis, active))
        cur.execute("SELECT id FROM instruments WHERE ticker_id = %s AND industry_id = %s",
                    (ticker_id, industry_id))
        instrument_id = cur.fetchone()[0]
        n_instruments += 1

        if not active:
            continue

        total = res["total"]
        band = band_for(total, cutoffs)
        band_tally[band] = band_tally.get(band, 0) + 1
        component_json = json.dumps(res["parts"])
        haircut_json = json.dumps([
            {"label": res["hc"][1], "points": res["hc"][0], "evidence_url": None}
        ]) if res["hc"] else "[]"
        hf_json = json.dumps(res["hard_filters"]) if res["hard_filters"] else None
        present = len(res["parts"])
        shrink = res["shrinkage"]
        if abs(shrink) < 0.05:
            shrink = None
        cur.execute("""
            INSERT INTO scores (run_id, instrument_id, strategy_id, value, band,
                                components_present, components_total,
                                shrinkage_applied, shrinkage_from,
                                component_json, haircut_json, hard_filter_json, delta_1d)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
            ON CONFLICT (run_id, instrument_id, strategy_id) DO UPDATE SET
              value = EXCLUDED.value, band = EXCLUDED.band,
              components_present = EXCLUDED.components_present,
              components_total = EXCLUDED.components_total,
              shrinkage_applied = EXCLUDED.shrinkage_applied,
              shrinkage_from = EXCLUDED.shrinkage_from,
              component_json = EXCLUDED.component_json,
              haircut_json = EXCLUDED.haircut_json,
              hard_filter_json = EXCLUDED.hard_filter_json
        """, (run_id, instrument_id, strat_id, round(total, 1), band,
              present, len(FZW), shrink, round(res["shrinkage_from"], 1),
              component_json, haircut_json, hf_json))
        n_scores += 1

    print(f"run {run_id} as_of {RUN_AS_OF_STR}")
    print(f"instruments {n_instruments} (of {len(rows)} folded rows)")
    print(f"scores {n_scores}  bands {band_tally}")
    prev = scores_by_ticker.get("INOD") or scores_by_ticker.get("AADX") or {}
    if prev:
        print("sample total/coverage:", {k: prev.get(k) for k in ("total", "cov", "pen")})
    conn.close()


if __name__ == "__main__":
    main()