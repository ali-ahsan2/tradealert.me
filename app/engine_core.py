"""The scorer, with no database in it.

A port of the workbench FUZZY engine that db/seed_universe.py replays once at
seed time, written so the same arithmetic can run every morning on stored
data and, in the Lab, on any past date. Inputs come in as one plain dict per
instrument; the result carries the same fields the seed writes into `scores`
(total, coverage, parts, penalties, shrinkage, hard filters), so a run made
here and a run made by the seed read the same on every screen.

Nothing here knows where a number came from. Missing inputs are missing:
their weight drops out, coverage falls, and the shrinkage toward 40 grows,
which is the honesty rule the product already states ("pulled toward
neutral for missing data").
"""
from __future__ import annotations

from datetime import date, datetime, timezone

# Membership curves from the workbench (_workbench_meta.json FZ_CURVES),
# fixed here so the engine no longer depends on that file at run time.
CURVES = {
    "float": [[10, 1], [15, 0.95], [30, 0.8], [50, 0.62], [75, 0.42], [100, 0.3], [200, 0.12], [400, 0.05]],
    "si": [[0, 0.02], [5, 0.2], [10, 0.45], [15, 0.65], [20, 0.8], [25, 0.9], [35, 1]],
    "dtc": [[0, 0.05], [1, 0.2], [2, 0.4], [3, 0.6], [5, 0.85], [8, 1]],
    "fee": [[0, 0.15], [2, 0.35], [5, 0.5], [10, 0.65], [20, 0.8], [50, 1]],
    "cap": [[50, 0.2], [150, 0.55], [300, 0.9], [500, 1], [1500, 1], [3000, 0.72], [5000, 0.5],
            [8000, 0.35], [13000, 0.25], [25000, 0.15]],
    "growth": [[-20, 0.05], [0, 0.15], [20, 0.4], [40, 0.7], [60, 0.82], [100, 0.92], [300, 1]],
    "catd": [[0, 1], [14, 0.95], [21, 0.75], [30, 0.6], [45, 0.42], [60, 0.35], [120, 0.2], [365, 0.12]],
    "run3m": [[-60, 0.35], [-40, 0.5], [-20, 0.85], [0, 1], [25, 0.85], [50, 0.45], [100, 0.15]],
    "offhi": [[-90, 0.45], [-70, 0.65], [-55, 0.75], [-35, 0.7], [-15, 0.55], [0, 0.45]],
    "volx": [[0.3, 0.4], [1, 0.5], [2, 0.7], [3, 0.9], [5, 1]],
}

# Default component weights (the live fast_mover version carries the same
# numbers in strategy_versions.component_weights_json; a version may differ).
DEFAULT_WEIGHTS = {"float": 13, "si": 14, "dtc": 5, "fee": 4, "cap": 7, "growth": 12,
                   "cat": 11, "mom": 9, "news": 9, "qual": 16}

NEUTRAL = 40.0           # where a score sits with no information at all
DEFAULT_HEAT = 0.5       # narrative heat when no operator note exists
ASSUMED_CATALYST_DAYS = 120   # an undated name is treated as "a catalyst some day"

COMPONENT_LABELS = {
    "float": "float tightness", "si": "short interest", "dtc": "days-to-cover",
    "fee": "borrow fee", "cap": "size (scaled)", "growth": "revenue growth",
    "cat": "catalyst proximity", "mom": "momentum / coil", "news": "news / narrative",
    "qual": "quality factors",
}


def fz_interp(x, pts):
    if x <= pts[0][0]:
        return pts[0][1]
    for i in range(1, len(pts)):
        if x <= pts[i][0]:
            x0, y0 = pts[i - 1]
            x1, y1 = pts[i]
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def band_for(value, cutoffs):
    order = [("strong", cutoffs.get("strong", 75)), ("elevated", cutoffs.get("elevated", 50)),
             ("neutral", cutoffs.get("neutral", 25)), ("weak", 0)]
    for name, lo in order:
        if value >= lo:
            return name
    return "weak"


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def catalyst_days(inputs, as_of):
    """Days to the next dated catalyst, or the assumed figure when none is
    known. `inputs["earnings"]` is an ISO date; a date more than a day in the
    past no longer counts."""
    e = inputs.get("earnings")
    if e:
        try:
            ed = date.fromisoformat(str(e)[:10])
            days = (ed - as_of).days
            if days >= -1:
                return max(0, days), True
        except ValueError:
            pass
    return ASSUMED_CATALYST_DAYS, False


# Hard filters in strategy_versions.hard_filters_json speak in raw units
# (USD, shares); snapshot fields are in millions. One place converts.
_FILTER_FIELD = {"cap": ("cap_usd_m", 1e6), "float": ("float_m", 1e6),
                 "si": ("si_pct_float", 1.0), "growth": ("growth_pct", 1.0),
                 "dtc": ("dtc", 1.0), "fee": ("fee_pct", 1.0)}


def check_hard_filters(inputs, hard_filters):
    """[{key, label, value, pass}] for the filters whose input is present."""
    out = []
    for f in hard_filters or []:
        key = f.get("key")
        spec = _FILTER_FIELD.get(key)
        if not spec:
            continue
        field, scale = spec
        v = _num(inputs.get(field))
        if v is None and key == "float":
            v = _num(inputs.get("so_m"))
        if v is None:
            continue
        raw = v * scale
        op, val = f.get("op"), f.get("value")
        if op == "between" and isinstance(val, (list, tuple)) and len(val) == 2:
            ok = val[0] <= raw <= val[1]
        elif op == "<":
            ok = raw < val
        elif op == "<=":
            ok = raw <= val
        elif op == ">":
            ok = raw > val
        elif op == ">=":
            ok = raw >= val
        else:
            continue
        out.append({"key": key, "label": f.get("label") or key, "value": v, "pass": bool(ok)})
    return out


def score(inputs, as_of=None, weights=None, hard_filters=None, cutoffs=None):
    """Score one instrument.

    inputs: float_m, so_m, si_pct_float, dtc, fee_pct, cap_usd_m, growth_pct,
            earnings (ISO date), run3m_pct, off_high_pct, volx20d,
            heat (0..1), qual (0..1), prerev (bool), haircut (points),
            haircut_note, pre_flags (list)
    Returns a dict with total, band, cov, parts, pen, raw, shrinkage,
    shrinkage_from, hard_filters, present, total_components.
    """
    as_of = as_of or datetime.now(timezone.utc).date()
    if isinstance(as_of, datetime):
        as_of = as_of.date()
    W = {k: float(v) for k, v in (weights or DEFAULT_WEIGHTS).items()}
    cutoffs = cutoffs or {"strong": 72, "elevated": 52, "neutral": 40, "weak": 25}
    parts = []

    def add(k, s, val, backed=True):
        if s is None or k not in W:
            return
        parts.append({"k": k, "label": COMPONENT_LABELS.get(k, k), "weight": W[k],
                      "score": max(0.0, min(1.0, s)), "val": val, "backed": bool(backed)})

    fl = _num(inputs.get("float_m"))
    proxy = False
    if fl is None:
        fl = _num(inputs.get("so_m"))
        proxy = fl is not None
    if fl is not None:
        add("float", fz_interp(fl, CURVES["float"]), f"{fl:g}M" + (" (s/o proxy)" if proxy else ""))
    si = _num(inputs.get("si_pct_float"))
    if si is not None:
        add("si", fz_interp(si, CURVES["si"]), f"{si:g}%")
    dtc = _num(inputs.get("dtc"))
    if dtc is not None:
        add("dtc", fz_interp(dtc, CURVES["dtc"]), f"{dtc:g}d")
    fee = _num(inputs.get("fee_pct"))
    if fee is not None:
        add("fee", fz_interp(fee, CURVES["fee"]), f"{fee:g}%")
    cap = _num(inputs.get("cap_usd_m"))
    if cap is not None:
        add("cap", fz_interp(cap, CURVES["cap"]),
            f"${cap / 1000:.1f}B" if cap >= 1000 else f"${int(cap)}M")
    gr = _num(inputs.get("growth_pct"))
    if inputs.get("prerev"):
        add("growth", 0.15, "pre-revenue")
    elif gr is not None:
        add("growth", fz_interp(gr, CURVES["growth"]), f"+{gr:g}%" if gr >= 0 else f"{gr:g}%")
    cd, dated = catalyst_days(inputs, as_of)
    add("cat", fz_interp(cd, CURVES["catd"]),
        "none" if cd >= 365 else f"{cd}d" + ("" if dated else " (assumed)"))
    mom = []
    r3 = _num(inputs.get("run3m_pct"))
    if r3 is not None:
        mom.append(fz_interp(r3, CURVES["run3m"]))
    oh = _num(inputs.get("off_high_pct"))
    if oh is not None:
        mom.append(fz_interp(oh, CURVES["offhi"]))
    vx = _num(inputs.get("volx20d"))
    if vx is not None:
        mom.append(fz_interp(vx, CURVES["volx"]))
    if mom:
        add("mom", sum(mom) / len(mom), f"{len(mom)} signal" + ("s" if len(mom) > 1 else ""))
    nh = _num(inputs.get("heat"))
    nh = DEFAULT_HEAT if nh is None else nh
    if vx is not None and vx >= 3:
        nh = min(1.0, nh + 0.15)
    add("news", nh, f"heat {nh:.2f}", backed=False)
    ql = _num(inputs.get("qual"))
    if ql is not None:
        add("qual", ql, inputs.get("qual_note") or "operator-rated")

    w_sum = sum(p["weight"] for p in parts)
    raw = sum(p["weight"] * p["score"] for p in parts) / (w_sum or 1)
    pen = 5 * len(inputs.get("pre_flags") or []) + float(inputs.get("haircut") or 0)
    data_w = sum(p["weight"] for p in parts if p["backed"] and p["k"] != "news")
    data_tot = sum(w for k, w in W.items() if k != "news") or 1
    cov = min(1.0, data_w / data_tot)
    conf = 0.25 + 0.75 * cov
    total = max(0.0, min(100.0, NEUTRAL + (raw * 100 - NEUTRAL) * conf - pen))
    hf = check_hard_filters(inputs, hard_filters)
    return {
        "total": round(total, 1), "band": band_for(total, cutoffs), "cov": cov,
        "parts": parts, "pen": pen, "raw": raw * 100,
        "shrinkage": (raw * 100 - NEUTRAL) * (1 - conf) if cov < 1 else 0.0,
        "shrinkage_from": raw * 100,
        "hard_filters": hf,
        "present": len(parts), "total_components": len(W),
        "haircut_note": inputs.get("haircut_note") or "",
    }
