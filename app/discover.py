"""Discovery surface built on data the product already stores: a screener
over the visible universe, a run-to-run diff, a catalyst calendar, an
overview, alert outcomes measured against daily bars, per-field snapshot
history, and watchlist statistics.

No new tables or columns. Every instrument-scoped read carries the same
visibility fragment as the board (scope.visible_sql_and_params), lists are
clamped to the tier's names_shown_limit with an aggregate count of what was
left out (never a ticker), synthetic backtest rows never reach a
subscriber, and nothing here is computed from fewer than the rows it says
it used."""
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import context, scope
from app.db import get_conn

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

# Snapshot fields the ingest and seed paths write. Values are TEXT in the
# snapshots table; numeric ones are cast only when they look like a number,
# so a stray string never breaks a query.
NUMERIC_FIELDS = (
    "px", "cap_usd_m", "so_m", "float_m", "si_pct_float", "si_shares_m", "dtc",
    "fee_pct", "volx20d", "run3m_pct", "off_high_pct", "day_pct", "growth_pct",
    "borrow_avail", "avgvol20", "lo52", "hi52",
)
TEXT_FIELDS = ("earnings", "earnings_conf", "si_asof", "fee_asof")
SNAPSHOT_FIELDS = NUMERIC_FIELDS + TEXT_FIELDS

_NUM_RE = r"'^-?[0-9]+(\.[0-9]+)?$'"
_DATE_RE = "'^[0-9]{4}-[0-9]{2}-[0-9]{2}'"

BAND_ORDER = {"strong": 4, "elevated": 3, "neutral": 2, "weak": 1, "excluded": 0}
BANDS = ("strong", "elevated", "neutral", "weak", "excluded")

# Labels for components that have never had data on any scored row (so no
# breakdown carries their label). Mirrors db/seed_universe.py.
COMPONENT_LABELS = {
    "float": "float tightness", "si": "short interest", "dtc": "days-to-cover",
    "fee": "borrow fee", "cap": "size (scaled)", "growth": "revenue growth",
    "cat": "catalyst proximity", "mom": "momentum / coil", "news": "news / narrative",
    "qual": "quality (operator)",
}

# Which stored input feeds each Fast Mover component, so the dossier can say
# what data would complete a thin score. Judgment components have no field.
COMPONENT_SOURCE = {
    "float": "float_m (shares outstanding as a fallback)",
    "si": "si_pct_float from the FINRA short-interest print",
    "dtc": "dtc (days to cover)",
    "fee": "fee_pct (stock-borrow fee)",
    "cap": "cap_usd_m",
    "growth": "growth_pct (latest reported revenue growth)",
    "cat": "earnings (next dated event)",
    "mom": "run3m_pct, off_high_pct, volx20d",
    "news": "operator-set narrative heat (judgment, not data)",
    "qual": "operator research pass (judgment, not data)",
}


def _not_found():
    raise HTTPException(404, "not found")


def _f(v):
    return float(v) if v is not None else None


def _pct(last, base):
    if last is None or base is None or not float(base):
        return None
    return round((float(last) - float(base)) / float(base) * 100, 2)


def _iso(dt):
    return dt.isoformat() if dt else None


def _num(col, alias="sn"):
    return f"(CASE WHEN {alias}.{col} ~ {_NUM_RE} THEN {alias}.{col}::numeric END)"


def _earn(alias="sn"):
    return (f"(CASE WHEN {alias}.earnings ~ {_DATE_RE} "
            f"THEN substr({alias}.earnings, 1, 10)::date END)")


def _hf_pass(alias="sc"):
    """TRUE when every stored hard filter passed, FALSE when any failed,
    NULL when the strategy stores none (every strategy but Fast Mover)."""
    return (f"(CASE WHEN {alias}.hard_filter_json IS NULL "
            f"OR jsonb_typeof({alias}.hard_filter_json) <> 'array' THEN NULL "
            f"ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements({alias}.hard_filter_json) f "
            "WHERE NOT COALESCE((f->>'pass')::boolean, FALSE)) END)")


def _hf_fails(alias="sc"):
    return ("(SELECT COUNT(*) FROM jsonb_array_elements("
            f"CASE WHEN jsonb_typeof({alias}.hard_filter_json) = 'array' "
            f"THEN {alias}.hard_filter_json ELSE '[]'::jsonb END) f "
            "WHERE NOT COALESCE((f->>'pass')::boolean, FALSE))")


def snapshot_lateral(ticker_alias="t", alias="sn"):
    """One row per ticker with the latest value of every snapshot field as a
    column. Takes one parameter: the list of fields (SNAPSHOT_FIELDS)."""
    cols = ", ".join(
        f"MAX(CASE WHEN x.field = '{f}' THEN x.value END) AS {f}" for f in SNAPSHOT_FIELDS)
    as_ofs = ", ".join(
        f"MAX(CASE WHEN x.field = '{f}' THEN x.as_of END) AS {f}_as_of"
        for f in ("earnings", "si_pct_float", "fee_pct", "px"))
    return (f"LEFT JOIN LATERAL (SELECT {cols}, {as_ofs} FROM ("
            "SELECT DISTINCT ON (s.field) s.field, s.value, s.as_of FROM snapshots s "
            f"WHERE s.ticker_id = {ticker_alias}.id AND s.field = ANY(%s) "
            f"ORDER BY s.field, s.as_of DESC) x) {alias} ON TRUE")


SPARK_BARS = 30


def price_lateral(ticker_alias="t", alias="px"):
    """Latest close, its date, the close 30 days back, and the last 30 closes
    oldest-first for a sparkline. No parameters."""
    t = ticker_alias
    return (
        "LEFT JOIN LATERAL (SELECT "
        f" (SELECT close FROM price_bars p WHERE p.ticker_id = {t}.id ORDER BY d DESC LIMIT 1) AS last_close, "
        f" (SELECT d FROM price_bars p WHERE p.ticker_id = {t}.id ORDER BY d DESC LIMIT 1) AS last_d, "
        f" (SELECT close FROM price_bars p WHERE p.ticker_id = {t}.id "
        "   AND p.d <= CURRENT_DATE - 30 ORDER BY d DESC LIMIT 1) AS c30, "
        " (SELECT array_agg(z.close ORDER BY z.d) FROM (SELECT close, d FROM price_bars p "
        f"   WHERE p.ticker_id = {t}.id ORDER BY d DESC LIMIT {SPARK_BARS}) z) AS closes"
        f") {alias} ON TRUE")


def _spark(arr):
    return [round(float(v), 4) for v in arr] if arr else []


def benchmarks(cur, industry_ids):
    """{industry_id: {symbol, label, last_close, last_date, chg_30d, chg_90d}}
    for the first reference asset of each industry."""
    ids = [i for i in set(industry_ids) if i is not None]
    if not ids:
        return {}
    cur.execute(
        "SELECT DISTINCT ON (r.industry_id) r.industry_id, t.symbol, r.label, "
        " (SELECT close FROM price_bars p WHERE p.ticker_id = t.id ORDER BY d DESC LIMIT 1), "
        " (SELECT d FROM price_bars p WHERE p.ticker_id = t.id ORDER BY d DESC LIMIT 1), "
        " (SELECT close FROM price_bars p WHERE p.ticker_id = t.id "
        "   AND d <= CURRENT_DATE - 30 ORDER BY d DESC LIMIT 1), "
        " (SELECT close FROM price_bars p WHERE p.ticker_id = t.id "
        "   AND d <= CURRENT_DATE - 90 ORDER BY d DESC LIMIT 1), "
        " (SELECT array_agg(z.close ORDER BY z.d) FROM (SELECT close, d FROM price_bars p "
        f"   WHERE p.ticker_id = t.id ORDER BY d DESC LIMIT {SPARK_BARS}) z) "
        "FROM reference_assets r JOIN tickers t ON t.id = r.ticker_id "
        "WHERE r.industry_id = ANY(%s) ORDER BY r.industry_id, r.sort_order",
        (ids,),
    )
    out = {}
    for iid, sym, label, last, last_d, c30, c90, closes in cur.fetchall():
        out[iid] = {"symbol": sym, "label": label, "last_close": _f(last),
                    "last_date": _iso(last_d), "chg_30d": _pct(last, c30),
                    "chg_90d": _pct(last, c90), "closes": _spark(closes)}
    return out


def _runs(cur):
    cur.execute(
        "SELECT id, as_of, completed_at FROM runs WHERE status = 'completed' "
        "ORDER BY as_of DESC LIMIT 2")
    rows = cur.fetchall()
    latest = rows[0] if rows else None
    prev = rows[1] if len(rows) > 1 else None
    return latest, prev


def _run_at_least_days_before(cur, latest_as_of, days):
    cur.execute(
        "SELECT id, as_of, completed_at FROM runs WHERE status = 'completed' "
        "AND as_of <= %s - make_interval(days => %s) ORDER BY as_of DESC LIMIT 1",
        (latest_as_of, days),
    )
    row = cur.fetchone()
    if row:
        return row
    # not enough history for that window: fall back to the oldest run so the
    # comparison is still real, and say so through the returned as_of
    cur.execute(
        "SELECT id, as_of, completed_at FROM runs WHERE status = 'completed' "
        "AND as_of < %s ORDER BY as_of ASC LIMIT 1",
        (latest_as_of,),
    )
    return cur.fetchone()


def _strategy(cur, key):
    cur.execute(
        "SELECT id, key, label, monogram, calibrated, resolved_outcomes_count "
        "FROM strategies WHERE key = %s",
        ((key or "fast_mover").strip().lower(),),
    )
    row = cur.fetchone()
    if not row:
        _not_found()
    return row


def _strategy_payload(s):
    return {"key": s[1], "label": s[2], "monogram": s[3], "calibrated": bool(s[4]),
            "resolved_outcomes_count": s[5]}


def _viewer(conn, creds):
    """(uid, tier, keys, picks, vis, vis_params, K) for the signed-in
    subscriber. K is the tier's names_shown_limit."""
    user = context.user_from_creds(creds)
    uid = context.user_id(user)
    scope.provision_free(conn, uid)
    tier = scope.tier_for_user(conn, uid)
    keys, _label, picks = scope.user_scope(conn, uid, tier[3] if tier else 1)
    vis, vis_params = scope.visible_sql_and_params(keys, picks, "i")
    k = tier[4] if tier else 5
    return uid, tier, keys, picks, vis, vis_params, k


def _coverage_state(present, total):
    if present is None or not total or present >= total:
        return "full"
    if present >= math.ceil(total / 2):
        return "partial"
    return "thin"


# --------------------------------------------------------------------------
# Screener
# --------------------------------------------------------------------------

_SORTS = {
    "score": ("b.value", "DESC"),
    "delta": ("b.delta_1d", "DESC"),
    "coverage": ("(b.components_present::float / NULLIF(b.components_total, 0))", "DESC"),
    "symbol": ("b.symbol", "ASC"),
    "cap": ("b.cap_usd_m", "ASC"),
    "si": ("b.si_pct_float", "DESC"),
    "float": ("b.float_m", "ASC"),
    "fee": ("b.fee_pct", "DESC"),
    "volx": ("b.volx20d", "DESC"),
    "run3m": ("b.run3m_pct", "DESC"),
    "offhigh": ("b.off_high_pct", "DESC"),
    "earnings": ("b.earn_date", "ASC"),
    "chg30": ("((b.last_close - b.c30) / NULLIF(b.c30, 0))", "DESC"),
    "industry": ("b.industry_label", "ASC"),
}


def _base_select(uid_param_first=True):
    """The screener's inner query: every scored, visible name on one run and
    strategy with its snapshot numbers, filter verdict and price change.
    Parameters in order: user_id, snapshot fields, run_id, strategy_id,
    then the visibility params."""
    return (
        "SELECT t.id AS ticker_id, i.id AS instrument_id, t.symbol, i.theme, i.lane, "
        "i.instrument_group AS grp, i.hook, i.thesis, "
        "ind.id AS industry_id, ind.key AS industry_key, ind.label AS industry_label, "
        "ind.benchmark_etf, "
        "sc.value, sc.band, sc.components_present, sc.components_total, sc.delta_1d, "
        f"{_hf_pass()} AS hf_pass, {_hf_fails()} AS hf_fails, "
        f"{_num('cap_usd_m')} AS cap_usd_m, {_num('si_pct_float')} AS si_pct_float, "
        f"{_num('float_m')} AS float_m, {_num('so_m')} AS so_m, {_num('fee_pct')} AS fee_pct, "
        f"{_num('volx20d')} AS volx20d, {_num('run3m_pct')} AS run3m_pct, "
        f"{_num('off_high_pct')} AS off_high_pct, {_num('px')} AS px, "
        f"{_num('day_pct')} AS day_pct, {_num('dtc')} AS dtc, {_num('growth_pct')} AS growth_pct, "
        f"{_earn()} AS earn_date, sn.earnings_conf, sn.earnings_as_of, sn.si_pct_float_as_of, "
        "px.last_close, px.last_d, px.c30, px.closes, (p.id IS NOT NULL) AS pinned "
        "FROM scores sc "
        "JOIN instruments i ON i.id = sc.instrument_id "
        "JOIN tickers t ON t.id = i.ticker_id "
        "JOIN industries ind ON ind.id = i.industry_id "
        "LEFT JOIN picks p ON p.instrument_id = i.id AND p.user_id = %s AND p.active "
        f"{snapshot_lateral('t')} {price_lateral('t')} "
        "WHERE sc.run_id = %s AND sc.strategy_id = %s AND sc.value IS NOT NULL AND "
    )


def _row_payload(r, bench):
    chg30 = _pct(r["last_close"], r["c30"])
    b = bench.get(r["industry_id"]) or {}
    earn = r["earn_date"]
    days_to = None
    if earn is not None:
        days_to = (earn - datetime.now(timezone.utc).date()).days
    return {
        "symbol": r["symbol"], "theme": r["theme"], "lane": r["lane"] or "",
        "group": r["grp"] or "",
        "industry": {"key": r["industry_key"], "label": r["industry_label"],
                     "benchmark_etf": r["benchmark_etf"]},
        "value": _f(r["value"]), "band": r["band"],
        "components_present": r["components_present"],
        "components_total": r["components_total"],
        "coverage": _coverage_state(r["components_present"], r["components_total"]),
        "delta_1d": _f(r["delta_1d"]),
        "hf_pass": r["hf_pass"], "hf_fails": r["hf_fails"],
        "snapshot": {
            "cap_usd_m": _f(r["cap_usd_m"]), "si_pct_float": _f(r["si_pct_float"]),
            "float_m": _f(r["float_m"]), "so_m": _f(r["so_m"]), "fee_pct": _f(r["fee_pct"]),
            "volx20d": _f(r["volx20d"]), "run3m_pct": _f(r["run3m_pct"]),
            "off_high_pct": _f(r["off_high_pct"]), "px": _f(r["px"]),
            "day_pct": _f(r["day_pct"]), "dtc": _f(r["dtc"]), "growth_pct": _f(r["growth_pct"]),
            "si_as_of": _iso(r["si_pct_float_as_of"]),
        },
        "earnings": None if earn is None else {
            "date": earn.isoformat(), "days": days_to,
            "confidence": r["earnings_conf"], "as_of": _iso(r["earnings_as_of"])},
        "price": {"last_close": _f(r["last_close"]), "last_date": _iso(r["last_d"]),
                  "chg_30d": chg30, "closes": _spark(r["closes"]),
                  "rel_30d": (round(chg30 - b["chg_30d"], 2)
                              if chg30 is not None and b.get("chg_30d") is not None else None),
                  "benchmark": b.get("symbol")},
        "pinned": bool(r["pinned"]),
    }


def _cols(cur):
    return [d[0] for d in cur.description]


@router.get("/api/screen")
def screen(strategy: str = "fast_mover", bands: str = "", min_score: float | None = None,
           max_score: float | None = None, coverage: str = "", hf: str = "",
           industries: str = "", lane: str = "", group: str = "", q: str = "",
           min_delta: float | None = None, max_delta: float | None = None, new: int = 0,
           cap_min: float | None = None, cap_max: float | None = None,
           si_min: float | None = None, si_max: float | None = None,
           float_max: float | None = None, fee_min: float | None = None,
           volx_min: float | None = None, run3m_min: float | None = None,
           run3m_max: float | None = None, offhigh_max: float | None = None,
           earnings_within: int | None = Query(None, ge=0, le=400), pinned: int = 0,
           sort: str = "score", dir: str = "", limit: int = Query(100, ge=1, le=200),
           creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Filter and sort the subscriber's visible universe on one run. The
    result is clamped to the tier's names_shown_limit; `meta.matched` says
    how many names matched in total so the screen can report what it left
    out without naming it."""
    conn = get_conn()
    try:
        uid, tier, keys, picks, vis, vis_params, k = _viewer(conn, creds)
        with conn.cursor() as cur:
            latest, _prev = _runs(cur)
            if not latest:
                _not_found()
            strat = _strategy(cur, strategy)
            params = [uid, list(SNAPSHOT_FIELDS), latest[0], strat[0]] + vis_params
            inner = _base_select() + vis
            where, wp = [], []
            band_list = [b for b in (bands or "").split(",") if b in BAND_ORDER]
            if band_list:
                where.append("b.band = ANY(%s)")
                wp.append(band_list)
            if min_score is not None:
                where.append("b.value >= %s")
                wp.append(min_score)
            if max_score is not None:
                where.append("b.value <= %s")
                wp.append(max_score)
            if coverage == "full":
                where.append("b.components_present >= b.components_total")
            elif coverage == "partial":
                where.append("b.components_present < b.components_total "
                             "AND b.components_present >= CEIL(b.components_total / 2.0)")
            elif coverage == "thin":
                where.append("b.components_present < CEIL(b.components_total / 2.0)")
            if hf == "pass":
                where.append("b.hf_pass IS TRUE")
            elif hf == "fail":
                where.append("b.hf_pass IS FALSE")
            ind_list = [i.strip().lower() for i in (industries or "").split(",") if i.strip()]
            if ind_list:
                where.append("b.industry_key = ANY(%s)")
                wp.append(ind_list)
            if lane:
                where.append("b.lane = %s")
                wp.append(lane.strip())
            if group:
                where.append("b.grp = %s")
                wp.append(group.strip())
            if q.strip():
                like = f"%{q.strip()}%"
                where.append("(b.symbol ILIKE %s OR b.theme ILIKE %s OR b.hook ILIKE %s "
                             "OR b.thesis ILIKE %s OR b.industry_label ILIKE %s)")
                wp += [q.strip() + "%", like, like, like, like]
            if new:
                where.append("b.delta_1d IS NULL")
            if min_delta is not None:
                where.append("b.delta_1d >= %s")
                wp.append(min_delta)
            if max_delta is not None:
                where.append("b.delta_1d <= %s")
                wp.append(max_delta)
            for col, lo, hi in (("cap_usd_m", cap_min, cap_max), ("si_pct_float", si_min, si_max),
                                ("float_m", None, float_max), ("fee_pct", fee_min, None),
                                ("volx20d", volx_min, None), ("run3m_pct", run3m_min, run3m_max)):
                if lo is not None:
                    where.append(f"b.{col} >= %s")
                    wp.append(lo)
                if hi is not None:
                    where.append(f"b.{col} <= %s")
                    wp.append(hi)
            if offhigh_max is not None:
                where.append("ABS(b.off_high_pct) <= %s")
                wp.append(offhigh_max)
            if earnings_within is not None:
                where.append("b.earn_date BETWEEN CURRENT_DATE AND CURRENT_DATE + %s")
                wp.append(earnings_within)
            if pinned:
                where.append("b.pinned")
            filt = (" WHERE " + " AND ".join(where)) if where else ""
            expr, default_dir = _SORTS.get(sort, _SORTS["score"])
            direction = dir.upper() if dir.upper() in ("ASC", "DESC") else default_dir
            order = f"{expr} {direction} NULLS LAST, b.value DESC NULLS LAST, b.symbol"
            shown_limit = min(limit, k)
            cur.execute(
                f"SELECT b.*, COUNT(*) OVER () AS matched FROM ({inner}) b{filt} "
                f"ORDER BY {order} LIMIT %s",
                tuple(params + wp + [shown_limit]),
            )
            cols = _cols(cur)
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            # facets over the whole matched set, not just the clamped rows
            cur.execute(
                f"SELECT b.band, b.industry_key, b.industry_label, b.hf_pass, "
                "b.components_present, b.components_total, b.lane, b.grp "
                f"FROM ({inner}) b{filt}",
                tuple(params + wp),
            )
            facets = {"band": {}, "industry": {}, "hf": {"pass": 0, "fail": 0, "none": 0},
                      "coverage": {"full": 0, "partial": 0, "thin": 0}, "lane": {}, "group": {}}
            for band, ikey, ilabel, hfp, pres, tot, ln, grp in cur.fetchall():
                facets["band"][band] = facets["band"].get(band, 0) + 1
                ent = facets["industry"].setdefault(ikey, {"label": ilabel, "n": 0})
                ent["n"] += 1
                facets["hf"]["pass" if hfp is True else "fail" if hfp is False else "none"] += 1
                facets["coverage"][_coverage_state(pres, tot)] += 1
                if ln:
                    facets["lane"][ln] = facets["lane"].get(ln, 0) + 1
                if grp:
                    facets["group"][grp] = facets["group"].get(grp, 0) + 1
            bench = benchmarks(cur, [r["industry_id"] for r in rows])
    finally:
        conn.close()
    matched = rows[0]["matched"] if rows else 0
    return {
        "as_of": latest[1].isoformat(), "run_id": latest[0],
        "strategy": _strategy_payload(strat),
        "rows": [dict(_row_payload(r, bench), rank=n + 1) for n, r in enumerate(rows)],
        "facets": facets,
        "meta": {"matched": matched, "shown": len(rows), "truncated": matched > len(rows),
                 "names_shown_limit": k, "scope": keys, "sort": sort,
                 "dir": direction.lower()},
    }


# --------------------------------------------------------------------------
# Run-to-run changes
# --------------------------------------------------------------------------

def diff_rows(cur, uid, run_a, run_b, strategy_id, vis, vis_params):
    """Every visible name scored in either run, with both scores."""
    cur.execute(
        "SELECT t.symbol, i.theme, i.lane, ind.key, ind.label, ind.benchmark_etf, "
        "a.value, a.band, a.components_present, a.components_total, "
        f"{_hf_pass('a')} AS a_hf, "
        "b.value, b.band, b.components_present, b.components_total, "
        f"{_hf_pass('b')} AS b_hf, (p.id IS NOT NULL) AS pinned "
        "FROM instruments i "
        "JOIN tickers t ON t.id = i.ticker_id "
        "JOIN industries ind ON ind.id = i.industry_id "
        "LEFT JOIN scores a ON a.instrument_id = i.id AND a.run_id = %s AND a.strategy_id = %s "
        "LEFT JOIN scores b ON b.instrument_id = i.id AND b.run_id = %s AND b.strategy_id = %s "
        "LEFT JOIN picks p ON p.instrument_id = i.id AND p.user_id = %s AND p.active "
        f"WHERE (a.id IS NOT NULL OR b.id IS NOT NULL) AND {vis}",
        tuple([run_a, strategy_id, run_b, strategy_id, uid] + vis_params),
    )
    out = []
    for r in cur.fetchall():
        now = {"value": _f(r[6]), "band": r[7], "present": r[8], "total": r[9], "hf_pass": r[10]}
        prev = {"value": _f(r[11]), "band": r[12], "present": r[13], "total": r[14],
                "hf_pass": r[15]}
        out.append({
            "symbol": r[0], "theme": r[1], "lane": r[2] or "",
            "industry": {"key": r[3], "label": r[4], "benchmark_etf": r[5]},
            "now": now if now["value"] is not None else None,
            "prev": prev if prev["value"] is not None else None,
            "delta": (round(now["value"] - prev["value"], 1)
                      if now["value"] is not None and prev["value"] is not None else None),
            "pinned": bool(r[16]),
        })
    return out


def classify_diff(rows):
    """Buckets over diff_rows output. A name can sit in several buckets
    (a band move is also a score move); the summary counts each once."""
    new, dropped, band_up, band_down, up, down = [], [], [], [], [], []
    cleared, failed, cov_up, cov_down, unchanged = [], [], [], [], []
    dist_now, dist_prev = {b: 0 for b in BANDS}, {b: 0 for b in BANDS}
    for r in rows:
        n, p = r["now"], r["prev"]
        if n:
            dist_now[n["band"]] = dist_now.get(n["band"], 0) + 1
        if p:
            dist_prev[p["band"]] = dist_prev.get(p["band"], 0) + 1
        if n and not p:
            new.append(r)
            continue
        if p and not n:
            dropped.append(r)
            continue
        if BAND_ORDER.get(n["band"], 0) > BAND_ORDER.get(p["band"], 0):
            band_up.append(r)
        elif BAND_ORDER.get(n["band"], 0) < BAND_ORDER.get(p["band"], 0):
            band_down.append(r)
        if r["delta"] is not None and r["delta"] > 0:
            up.append(r)
        elif r["delta"] is not None and r["delta"] < 0:
            down.append(r)
        else:
            unchanged.append(r)
        if p["hf_pass"] is False and n["hf_pass"] is True:
            cleared.append(r)
        elif p["hf_pass"] is True and n["hf_pass"] is False:
            failed.append(r)
        if n["present"] is not None and p["present"] is not None:
            if n["present"] > p["present"]:
                cov_up.append(r)
            elif n["present"] < p["present"]:
                cov_down.append(r)
    by_delta = lambda xs, rev: sorted(xs, key=lambda r: (r["delta"] or 0), reverse=rev)  # noqa: E731
    deltas = [r["delta"] for r in rows if r["delta"] is not None]
    return {
        "new": sorted(new, key=lambda r: -(r["now"]["value"] or 0)),
        "dropped": sorted(dropped, key=lambda r: -(r["prev"]["value"] or 0)),
        "band_up": by_delta(band_up, True), "band_down": by_delta(band_down, False),
        "up": by_delta(up, True), "down": by_delta(down, False),
        "cleared": by_delta(cleared, True), "failed": by_delta(failed, False),
        "coverage_up": cov_up, "coverage_down": cov_down,
        "summary": {
            "compared": len(rows), "new": len(new), "dropped": len(dropped),
            "band_up": len(band_up), "band_down": len(band_down),
            "up": len(up), "down": len(down), "unchanged": len(unchanged),
            "cleared": len(cleared), "failed": len(failed),
            "coverage_up": len(cov_up), "coverage_down": len(cov_down),
            "mean_delta": round(sum(deltas) / len(deltas), 2) if deltas else None,
        },
        "distribution": {"now": dist_now, "prev": dist_prev},
    }


def _clamp(lst, k):
    return {"rows": lst[:k], "total": len(lst), "truncated": len(lst) > k}


@router.get("/api/changes")
def changes(strategy: str = "fast_mover", vs: str = "prev",
            creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """What moved between two completed runs across the visible universe.
    `vs` is `prev` (the previous run), or `7d`/`30d` (the latest run at least
    that many days before the current one, or the oldest run on record when
    history is shorter, which the returned `prev_run.as_of` makes plain)."""
    conn = get_conn()
    try:
        uid, tier, keys, picks, vis, vis_params, k = _viewer(conn, creds)
        with conn.cursor() as cur:
            latest, prev = _runs(cur)
            if not latest:
                _not_found()
            strat = _strategy(cur, strategy)
            if vs in ("7d", "30d", "90d"):
                prev = _run_at_least_days_before(cur, latest[1], int(vs[:-1]))
            if not prev:
                return {"as_of": latest[1].isoformat(), "run_id": latest[0], "prev_run": None,
                        "strategy": _strategy_payload(strat), "vs": vs,
                        "summary": None, "names_shown_limit": k}
            rows = diff_rows(cur, uid, latest[0], prev[0], strat[0], vis, vis_params)
    finally:
        conn.close()
    c = classify_diff(rows)
    lists = {key: _clamp(c[key], k) for key in
             ("new", "dropped", "band_up", "band_down", "up", "down", "cleared", "failed",
              "coverage_up", "coverage_down")}
    return {
        "as_of": latest[1].isoformat(), "run_id": latest[0],
        "prev_run": {"id": prev[0], "as_of": prev[1].isoformat()},
        "strategy": _strategy_payload(strat), "vs": vs,
        "summary": c["summary"], "distribution": c["distribution"],
        "names_shown_limit": k, **lists,
    }


# --------------------------------------------------------------------------
# Catalyst calendar
# --------------------------------------------------------------------------

def upcoming_events(cur, uid, run_id, strategy_id, vis, vis_params, days, limit=None):
    """Visible names whose latest earnings snapshot falls inside the window,
    with the current score, filter verdict, whether a catalyst alert is
    armed, and how the name moved after its past real earnings."""
    cur.execute(
        "SELECT t.symbol, i.theme, i.lane, ind.key, ind.label, ind.benchmark_etf, "
        "substr(e.value, 1, 10)::date AS earn_date, e.as_of, ec.value AS conf, "
        "sc.value, sc.band, sc.components_present, sc.components_total, "
        f"{_hf_pass()} AS hf_pass, (p.id IS NOT NULL) AS pinned, "
        "EXISTS (SELECT 1 FROM alert_rules ar JOIN triggers tr ON tr.id = ar.trigger_id "
        "  WHERE ar.user_id = %s AND ar.instrument_id = i.id AND tr.key = 'catalyst_dated') AS armed, "
        "(SELECT COUNT(*) FROM backtest_events be WHERE be.instrument_id = i.id "
        "  AND be.event_kind = 'earnings' AND NOT be.synthetic_data_used "
        "  AND be.resolved_at IS NOT NULL) AS past_n, "
        "(SELECT COALESCE(SUM(CASE WHEN be.hit THEN 1 ELSE 0 END), 0) FROM backtest_events be "
        "  WHERE be.instrument_id = i.id AND be.event_kind = 'earnings' "
        "  AND NOT be.synthetic_data_used AND be.resolved_at IS NOT NULL) AS past_hits, "
        "(SELECT AVG(ABS(be.fwd_max_move_pct)) FROM backtest_events be "
        "  WHERE be.instrument_id = i.id AND be.event_kind = 'earnings' "
        "  AND NOT be.synthetic_data_used AND be.resolved_at IS NOT NULL) AS past_avg_move "
        "FROM instruments i "
        "JOIN tickers t ON t.id = i.ticker_id "
        "JOIN industries ind ON ind.id = i.industry_id "
        "JOIN LATERAL (SELECT value, as_of FROM snapshots s WHERE s.ticker_id = t.id "
        "  AND s.field = 'earnings' ORDER BY s.as_of DESC LIMIT 1) e ON TRUE "
        "LEFT JOIN LATERAL (SELECT value FROM snapshots s WHERE s.ticker_id = t.id "
        "  AND s.field = 'earnings_conf' ORDER BY s.as_of DESC LIMIT 1) ec ON TRUE "
        "LEFT JOIN scores sc ON sc.instrument_id = i.id AND sc.run_id = %s AND sc.strategy_id = %s "
        "LEFT JOIN picks p ON p.instrument_id = i.id AND p.user_id = %s AND p.active "
        f"WHERE i.active AND e.value ~ {_DATE_RE} "
        "AND substr(e.value, 1, 10)::date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + %s "
        f"AND {vis} "
        "ORDER BY 7, sc.value DESC NULLS LAST, t.symbol",
        tuple([uid, run_id, strategy_id, uid, days] + vis_params),
    )
    today = datetime.now(timezone.utc).date()
    rows = []
    for r in cur.fetchall():
        rows.append({
            "symbol": r[0], "theme": r[1], "lane": r[2] or "",
            "industry": {"key": r[3], "label": r[4], "benchmark_etf": r[5]},
            "date": r[6].isoformat(), "days": (r[6] - today).days,
            "as_of": _iso(r[7]), "confidence": r[8],
            "value": _f(r[9]), "band": r[10], "components_present": r[11],
            "components_total": r[12], "hf_pass": r[13], "pinned": bool(r[14]),
            "armed": bool(r[15]),
            "past": {"n": r[16], "hits": r[17], "avg_max_move_pct": _f(r[18])},
        })
    total = len(rows)
    if limit is not None:
        rows = rows[:limit]
    return rows, total


@router.get("/api/calendar")
def calendar(days: int = Query(60, ge=7, le=180),
             creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    conn = get_conn()
    try:
        uid, tier, keys, picks, vis, vis_params, k = _viewer(conn, creds)
        with conn.cursor() as cur:
            latest, _prev = _runs(cur)
            strat = _strategy(cur, "fast_mover")
            run_id = latest[0] if latest else None
            upcoming, total = upcoming_events(cur, uid, run_id, strat[0], vis, vis_params,
                                              days, limit=k)
            # what happened: real dated events in the last 45 days and how
            # the name moved, where the window has resolved
            cur.execute(
                "SELECT t.symbol, i.theme, ind.key, ind.label, be.event_date, be.event_kind, "
                "be.fwd_max_move_pct, be.fwd_close_move_pct, be.fwd_vol_spike_x, be.hit, "
                "be.days_to_move, be.resolved_at "
                "FROM backtest_events be "
                "JOIN instruments i ON i.id = be.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "JOIN industries ind ON ind.id = i.industry_id "
                "WHERE NOT be.synthetic_data_used AND be.event_kind <> 'random_day' "
                "AND be.event_date BETWEEN CURRENT_DATE - 45 AND CURRENT_DATE "
                f"AND {vis} ORDER BY be.event_date DESC, t.symbol LIMIT %s",
                tuple(vis_params + [k]),
            )
            recent = [
                {"symbol": r[0], "theme": r[1], "industry": {"key": r[2], "label": r[3]},
                 "date": r[4].isoformat(), "kind": r[5], "max_move_pct": _f(r[6]),
                 "close_move_pct": _f(r[7]), "volume_spike_x": _f(r[8]),
                 "hit": bool(r[9]) if r[9] is not None else None, "days_to_move": r[10],
                 "resolved": r[11] is not None}
                for r in cur.fetchall()
            ]
            cur.execute(
                "SELECT t.symbol, i.theme, ae.detail, ae.fired_at FROM alert_events ae "
                "JOIN triggers tr ON tr.id = ae.trigger_id AND tr.key = 'catalyst_dated' "
                "JOIN instruments i ON i.id = ae.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                f"WHERE ae.fired_at >= now() - interval '30 days' AND {vis} "
                "ORDER BY ae.fired_at DESC LIMIT %s",
                tuple(vis_params + [k]),
            )
            flagged = [{"symbol": r[0], "theme": r[1], "detail": r[2], "fired_at": r[3].isoformat()}
                       for r in cur.fetchall()]
    finally:
        conn.close()
    return {
        "days": days, "run_as_of": latest[1].isoformat() if latest else None,
        "upcoming": upcoming,
        "meta": {"total": total, "shown": len(upcoming), "truncated": total > len(upcoming),
                 "names_shown_limit": k},
        "recent": recent, "flagged": flagged,
        "source": "Next earnings date from the latest market snapshot on file for each name; "
                  "past reactions from real, resolved dated events only.",
    }


# --------------------------------------------------------------------------
# Overview
# --------------------------------------------------------------------------

@router.get("/api/overview")
def overview(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """One screen of state for the signed-in subscriber: the run, each
    followed industry's shape, the watchlist, alerts, upcoming catalysts and
    what moved since the previous run. Every list is clamped to the tier."""
    conn = get_conn()
    try:
        uid, tier, keys, picks, vis, vis_params, k = _viewer(conn, creds)
        with conn.cursor() as cur:
            latest, prev = _runs(cur)
            strat = _strategy(cur, "fast_mover")
            run_id = latest[0] if latest else None
            cur.execute("SELECT COUNT(*) FROM runs WHERE status = 'completed'")
            runs_on_record = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM instruments WHERE active")
            universe_active = cur.fetchone()[0]
            # per followed industry (aggregates over the whole industry, top
            # names clamped by visibility and tier)
            cur.execute(
                "SELECT ind.id, ind.key, ind.label, ind.benchmark_etf, "
                "COUNT(*) FILTER (WHERE i.active), COUNT(sc.id), AVG(sc.value), AVG(sc.delta_1d), "
                + ", ".join(f"COUNT(*) FILTER (WHERE sc.band = '{b}')" for b in BANDS) + ", "
                f"COUNT(*) FILTER (WHERE {_hf_pass()} IS TRUE), "
                "COUNT(*) FILTER (WHERE sc.id IS NOT NULL AND sc.delta_1d IS NULL) "
                "FROM industries ind "
                "LEFT JOIN instruments i ON i.industry_id = ind.id "
                "LEFT JOIN scores sc ON sc.instrument_id = i.id AND sc.run_id = %s "
                "  AND sc.strategy_id = %s "
                "WHERE ind.key = ANY(%s) GROUP BY ind.id ORDER BY ind.sort_order",
                (run_id, strat[0], keys),
            )
            inds = {}
            for r in cur.fetchall():
                inds[r[0]] = {
                    "key": r[1], "label": r[2], "benchmark_etf": r[3], "universe": r[4],
                    "scored": r[5], "mean_score": round(float(r[6]), 1) if r[6] is not None else None,
                    "mean_delta": round(float(r[7]), 1) if r[7] is not None else None,
                    "distribution": dict(zip(BANDS, r[8:13])), "cleared": r[13], "new": r[14],
                    "top": [],
                }
            if run_id and inds:
                cur.execute(
                    "SELECT * FROM (SELECT i.industry_id, t.symbol, i.theme, sc.value, sc.band, "
                    "sc.components_present, sc.components_total, sc.delta_1d, "
                    "ROW_NUMBER() OVER (PARTITION BY i.industry_id ORDER BY sc.value DESC, t.symbol) AS rn "
                    "FROM scores sc JOIN instruments i ON i.id = sc.instrument_id "
                    "JOIN tickers t ON t.id = i.ticker_id "
                    f"WHERE sc.run_id = %s AND sc.strategy_id = %s AND sc.value IS NOT NULL AND {vis}) x "
                    "WHERE rn <= %s",
                    tuple([run_id, strat[0]] + vis_params + [min(3, k)]),
                )
                for r in cur.fetchall():
                    if r[0] in inds:
                        inds[r[0]]["top"].append({
                            "symbol": r[1], "theme": r[2], "value": _f(r[3]), "band": r[4],
                            "components_present": r[5], "components_total": r[6],
                            "delta_1d": _f(r[7])})
            bench = benchmarks(cur, list(inds))
            for iid, ent in inds.items():
                ent["benchmark"] = bench.get(iid)
            # watchlist
            cur.execute(
                "SELECT COUNT(*), AVG(sc.value - p.score_at_pin), "
                "COUNT(*) FILTER (WHERE sc.band IN ('strong', 'elevated')), "
                f"COUNT(*) FILTER (WHERE {_hf_pass()} IS TRUE), "
                "COUNT(*) FILTER (WHERE sc.value - p.score_at_pin >= 5), "
                "COUNT(*) FILTER (WHERE sc.value - p.score_at_pin <= -5) "
                "FROM picks p LEFT JOIN scores sc ON sc.instrument_id = p.instrument_id "
                "AND sc.run_id = %s AND sc.strategy_id = %s "
                "WHERE p.user_id = %s AND p.active",
                (run_id, strat[0], uid),
            )
            w = cur.fetchone()
            cur.execute(
                "SELECT t.symbol, sc.value - p.score_at_pin AS d, sc.value, sc.band "
                "FROM picks p JOIN instruments i ON i.id = p.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "LEFT JOIN scores sc ON sc.instrument_id = p.instrument_id AND sc.run_id = %s "
                "AND sc.strategy_id = %s WHERE p.user_id = %s AND p.active "
                "AND sc.value IS NOT NULL AND p.score_at_pin IS NOT NULL "
                "ORDER BY ABS(sc.value - p.score_at_pin) DESC LIMIT 3",
                (run_id, strat[0], uid),
            )
            movers = [{"symbol": r[0], "delta_since_pin": _f(r[1]), "value": _f(r[2]),
                       "band": r[3]} for r in cur.fetchall()]
            # alerts
            cur.execute(
                "SELECT COUNT(*) FROM alert_deliveries WHERE user_id = %s AND read_at IS NULL",
                (uid,))
            unread = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM alert_rules WHERE user_id = %s", (uid,))
            armed = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(*), COUNT(DISTINCT ae.instrument_id) FROM alert_events ae "
                "JOIN instruments i ON i.id = ae.instrument_id "
                f"WHERE ae.fired_at >= now() - interval '7 days' AND {vis}",
                tuple(vis_params),
            )
            fired7, fired7_names = cur.fetchone()
            cur.execute(
                "SELECT tr.label, COUNT(*) FROM alert_events ae "
                "JOIN triggers tr ON tr.id = ae.trigger_id "
                "JOIN instruments i ON i.id = ae.instrument_id "
                f"WHERE ae.fired_at >= now() - interval '7 days' AND {vis} "
                "GROUP BY tr.label ORDER BY 2 DESC LIMIT 4",
                tuple(vis_params),
            )
            fired_by_trigger = [{"trigger": r[0], "n": r[1]} for r in cur.fetchall()]
            # catalysts in the next 14 days
            upcoming, up_total = upcoming_events(cur, uid, run_id, strat[0], vis, vis_params,
                                                 14, limit=min(5, k))
            # changes since the previous run
            diff = None
            if latest and prev:
                c = classify_diff(diff_rows(cur, uid, latest[0], prev[0], strat[0], vis, vis_params))
                diff = {"prev_as_of": prev[1].isoformat(), "summary": c["summary"],
                        "band_up": c["band_up"][:min(3, k)], "band_down": c["band_down"][:min(3, k)],
                        "new": c["new"][:min(3, k)]}
            cur.execute(
                "SELECT digest_enabled, digest_day, digest_hour, timezone FROM user_settings "
                "WHERE user_id = %s", (uid,))
            ds = cur.fetchone()
            cur.execute(
                "SELECT COUNT(*) FROM instruments i WHERE i.active AND "
                f"{vis}", tuple(vis_params))
            visible_names = cur.fetchone()[0]
    finally:
        conn.close()
    return {
        "run": None if not latest else {
            "id": latest[0], "as_of": latest[1].isoformat(), "completed_at": _iso(latest[2]),
            "prev_as_of": prev[1].isoformat() if prev else None,
            "runs_on_record": runs_on_record, "universe_active": universe_active,
            "visible_names": visible_names,
        },
        "tier": None if not tier else {"key": tier[0], "label": tier[1],
                                       "industries_limit": tier[3], "names_shown_limit": tier[4],
                                       "picks_limit": tier[5], "alerts_limit": tier[6]},
        "industries": list(inds.values()),
        "watchlist": {"count": w[0], "mean_delta_since_pin": _f(w[1]), "strong_or_elevated": w[2],
                      "cleared": w[3], "up_5": w[4], "down_5": w[5], "movers": movers,
                      "limit": tier[5] if tier else None},
        "alerts": {"unread": unread, "armed": armed, "fired_7d": fired7,
                   "fired_7d_names": fired7_names, "by_trigger": fired_by_trigger,
                   "limit": tier[6] if tier else None},
        "catalysts": {"next_14d": up_total, "upcoming": upcoming},
        "changes": diff,
        "digest": None if not ds else {"enabled": ds[0], "day": ds[1], "hour": ds[2],
                                       "timezone": ds[3]},
    }


# --------------------------------------------------------------------------
# Alert outcomes: what happened to price after each impersonal event
# --------------------------------------------------------------------------

@router.get("/api/alerts/outcomes")
def alert_outcomes(days: int = Query(365, ge=30, le=1095), trigger: str = "",
                   creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Forward moves after alert events on visible names, measured on daily
    bars: the close five sessions after the event and the highest high in
    those five sessions, both against the last close on or before the
    event. Measured history on a handful of names, not a backtest; the
    screen shows a rate only when at least ten events were measured."""
    conn = get_conn()
    try:
        uid, tier, keys, picks, vis, vis_params, k = _viewer(conn, creds)
        where = [vis, "ae.fired_at >= now() - make_interval(days => %s)"]
        params = list(vis_params) + [days]
        if trigger:
            where.append("tr.key = %s")
            params.append(trigger.strip().lower())
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ae.id, tr.key, tr.label, t.symbol, i.theme, ae.fired_on, ae.detail, "
                "fwd.c0, fwd.c1, fwd.c5, fwd.h5, fwd.n_after "
                "FROM alert_events ae "
                "JOIN triggers tr ON tr.id = ae.trigger_id "
                "JOIN instruments i ON i.id = ae.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "LEFT JOIN LATERAL (SELECT "
                "  (SELECT close FROM price_bars p WHERE p.ticker_id = t.id AND p.d <= ae.fired_on "
                "   ORDER BY d DESC LIMIT 1) AS c0, "
                "  (SELECT close FROM price_bars p WHERE p.ticker_id = t.id AND p.d > ae.fired_on "
                "   ORDER BY d LIMIT 1) AS c1, "
                "  (SELECT close FROM price_bars p WHERE p.ticker_id = t.id AND p.d > ae.fired_on "
                "   ORDER BY d LIMIT 1 OFFSET 4) AS c5, "
                "  (SELECT MAX(z.high) FROM (SELECT high FROM price_bars p WHERE p.ticker_id = t.id "
                "   AND p.d > ae.fired_on ORDER BY d LIMIT 5) z) AS h5, "
                "  (SELECT COUNT(*) FROM (SELECT 1 FROM price_bars p WHERE p.ticker_id = t.id "
                "   AND p.d > ae.fired_on ORDER BY d LIMIT 5) z) AS n_after "
                ") fwd ON TRUE "
                f"WHERE {' AND '.join(where)} ORDER BY ae.fired_at DESC LIMIT 2000",
                tuple(params),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    by_trigger = {}
    events = []
    for eid, key, label, sym, theme, d, detail, c0, c1, c5, h5, n_after in rows:
        chg1 = _pct(c1, c0)
        chg5 = _pct(c5, c0) if (n_after or 0) >= 5 else None
        max5 = _pct(h5, c0) if (n_after or 0) >= 5 else None
        ent = by_trigger.setdefault(key, {"key": key, "label": label, "n": 0, "measured": 0,
                                          "_c5": [], "_m5": [], "_c1": []})
        ent["n"] += 1
        if chg5 is not None:
            ent["measured"] += 1
            ent["_c5"].append(chg5)
            ent["_m5"].append(max5 if max5 is not None else chg5)
        if chg1 is not None:
            ent["_c1"].append(chg1)
        if len(events) < 80:
            events.append({"id": eid, "trigger_key": key, "trigger": label, "symbol": sym,
                           "theme": theme, "date": d.isoformat(), "detail": detail,
                           "chg_1d": chg1, "chg_5d": chg5, "max_5d": max5,
                           "pending": chg5 is None and c0 is not None})
    out = []
    for ent in by_trigger.values():
        c5, m5, c1 = ent.pop("_c5"), ent.pop("_m5"), ent.pop("_c1")
        srt = sorted(c5)
        ent.update({
            "mean_chg_5d": round(sum(c5) / len(c5), 2) if c5 else None,
            "median_chg_5d": (round(srt[len(srt) // 2], 2) if srt else None),
            "mean_max_5d": round(sum(m5) / len(m5), 2) if m5 else None,
            "mean_chg_1d": round(sum(c1) / len(c1), 2) if c1 else None,
            "share_up_5d": round(sum(1 for v in c5 if v > 0) / len(c5), 3) if c5 else None,
            "share_max_10": round(sum(1 for v in m5 if v >= 10) / len(m5), 3) if m5 else None,
        })
        out.append(ent)
    out.sort(key=lambda e: -e["n"])
    return {"days": days, "triggers": out, "events": events,
            "method": "Each event is measured from the last daily close on or before it to "
                      "the close five sessions later, and to the highest high inside those "
                      "five sessions. Yahoo Finance adjusted bars. Rates are shown only once "
                      "ten or more events have resolved."}


# --------------------------------------------------------------------------
# Per-field snapshot history and what would complete the score
# --------------------------------------------------------------------------

@router.get("/api/stock/{symbol}/fields")
def stock_fields(symbol: str, days: int = Query(365, ge=30, le=1500),
                 strategy: str = "fast_mover",
                 creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    from app.product import _SYMBOL_RE, _component_labels, _resolve

    sym = symbol.strip().upper()
    if not _SYMBOL_RE.match(sym):
        _not_found()
    user = context.user_from_creds(creds)
    uid = context.user_id(user)
    conn = get_conn()
    try:
        ticker_id, instrument_id, industry_id, *_ = _resolve(conn, user, sym)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT field, as_of, value, source FROM snapshots "
                "WHERE ticker_id = %s AND field = ANY(%s) "
                "AND as_of >= now() - make_interval(days => %s) ORDER BY field, as_of",
                (ticker_id, list(NUMERIC_FIELDS), days),
            )
            fields = {}
            for f, as_of, v, src in cur.fetchall():
                try:
                    num = float(v)
                except (TypeError, ValueError):
                    continue
                fields.setdefault(f, []).append({"as_of": as_of.isoformat(), "value": num,
                                                 "source": src})
            strat = _strategy(cur, strategy)
            latest, _prev = _runs(cur)
            present_keys, score_row = [], None
            if latest:
                cur.execute(
                    "SELECT component_json, components_present, components_total FROM scores "
                    "WHERE run_id = %s AND instrument_id = %s AND strategy_id = %s",
                    (latest[0], instrument_id, strat[0]),
                )
                score_row = cur.fetchone()
                if score_row:
                    present_keys = [c.get("k") for c in (score_row[0] or [])
                                    if isinstance(c, dict) and c.get("k")]
            cur.execute(
                "SELECT sv.component_weights_json FROM strategies s "
                "LEFT JOIN strategy_versions sv ON sv.id = s.live_version_id "
                "WHERE s.id = %s", (strat[0],))
            vrow = cur.fetchone()
            weights = dict((vrow[0] or {}) if vrow else {})
            if not weights:
                cur.execute(
                    "SELECT component_weights_json FROM strategy_versions WHERE strategy_id = %s "
                    "ORDER BY effective_from DESC LIMIT 1", (strat[0],))
                vrow = cur.fetchone()
                weights = dict((vrow[0] or {}) if vrow else {})
            labels = _component_labels(cur, strat[0])
            total_w = sum(float(w) for w in weights.values()) or 0.0
            missing = sorted(
                [{"key": kk, "label": labels.get(kk) or COMPONENT_LABELS.get(kk, kk),
                  "weight": float(w),
                  "share": round(float(w) / total_w, 4) if total_w else None,
                  "source": COMPONENT_SOURCE.get(kk, "")}
                 for kk, w in weights.items() if kk not in present_keys],
                key=lambda c: -c["weight"])
            # price since pinned, against the industry benchmark
            since_pin = None
            cur.execute(
                "SELECT pinned_at, score_at_pin FROM picks WHERE user_id = %s "
                "AND instrument_id = %s AND active", (uid, instrument_id))
            pk = cur.fetchone()
            if pk:
                cur.execute(
                    "SELECT (SELECT close FROM price_bars WHERE ticker_id = %s AND d <= %s::date "
                    "  ORDER BY d DESC LIMIT 1), "
                    "(SELECT close FROM price_bars WHERE ticker_id = %s ORDER BY d DESC LIMIT 1), "
                    "(SELECT d FROM price_bars WHERE ticker_id = %s ORDER BY d DESC LIMIT 1)",
                    (ticker_id, pk[0], ticker_id, ticker_id))
                c_pin, c_last, d_last = cur.fetchone()
                bench = benchmarks(cur, [industry_id]).get(industry_id)
                b_chg = None
                if bench:
                    cur.execute(
                        "SELECT (SELECT close FROM price_bars p JOIN tickers t ON t.id = p.ticker_id "
                        "  WHERE t.symbol = %s AND p.d <= %s::date ORDER BY p.d DESC LIMIT 1), "
                        "(SELECT close FROM price_bars p JOIN tickers t ON t.id = p.ticker_id "
                        "  WHERE t.symbol = %s ORDER BY p.d DESC LIMIT 1)",
                        (bench["symbol"], pk[0], bench["symbol"]))
                    b0, b1 = cur.fetchone()
                    b_chg = _pct(b1, b0)
                since_pin = {"pinned_at": pk[0].isoformat(), "score_at_pin": _f(pk[1]),
                             "close_at_pin": _f(c_pin), "last_close": _f(c_last),
                             "last_date": _iso(d_last), "chg_pct": _pct(c_last, c_pin),
                             "benchmark": bench["symbol"] if bench else None,
                             "benchmark_chg_pct": b_chg}
    finally:
        conn.close()
    return {
        "symbol": sym, "days": days, "fields": fields,
        "strategy": _strategy_payload(strat),
        "present_keys": present_keys,
        "components_present": score_row[1] if score_row else None,
        "components_total": score_row[2] if score_row else None,
        "missing_components": missing, "declared_weight_total": total_w,
        "since_pin": since_pin,
    }


# --------------------------------------------------------------------------
# Watchlist statistics
# --------------------------------------------------------------------------

@router.get("/api/me/watchlist/stats")
def watchlist_stats(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Per pinned name: price since pinned against its industry benchmark,
    30-day change, next earnings, filter verdict, unread alerts and armed
    rules. Merged client-side with /api/me/picks by symbol."""
    user = context.user_from_creds(creds)
    uid = context.user_id(user)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            latest, _prev = _runs(cur)
            strat = _strategy(cur, "fast_mover")
            cur.execute(
                "SELECT t.symbol, i.industry_id, p.pinned_at, p.score_at_pin, "
                "(SELECT close FROM price_bars b WHERE b.ticker_id = t.id "
                "  AND b.d <= p.pinned_at::date ORDER BY d DESC LIMIT 1) AS c_pin, "
                "px.last_close, px.last_d, px.c30, px.closes, "
                f"{_earn()} AS earn_date, sn.earnings_conf, {_num('si_pct_float')}, "
                f"{_num('fee_pct')}, {_num('volx20d')}, "
                f"{_hf_pass()} AS hf_pass, sc.value, sc.band, "
                "(SELECT COUNT(*) FROM alert_deliveries ad JOIN alert_events ae ON ae.id = ad.alert_event_id "
                "  WHERE ad.user_id = %s AND ae.instrument_id = i.id AND ad.read_at IS NULL) AS unread, "
                "(SELECT COUNT(*) FROM alert_rules ar WHERE ar.user_id = %s AND ar.instrument_id = i.id) AS armed, "
                "(SELECT COUNT(*) FROM alert_events ae WHERE ae.instrument_id = i.id "
                "  AND ae.fired_at >= now() - interval '30 days') AS fired_30d, "
                "sc.components_present, sc.components_total "
                "FROM picks p JOIN instruments i ON i.id = p.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "LEFT JOIN scores sc ON sc.instrument_id = i.id AND sc.run_id = %s AND sc.strategy_id = %s "
                f"{snapshot_lateral('t')} {price_lateral('t')} "
                "WHERE p.user_id = %s AND p.active ORDER BY p.sort_order, p.pinned_at",
                (uid, uid, latest[0] if latest else None, strat[0], list(SNAPSHOT_FIELDS), uid),
            )
            rows = cur.fetchall()
            bench = benchmarks(cur, [r[1] for r in rows])
            # benchmark close at each pin date, one query per distinct (bench, date)
            bcache = {}
            today = datetime.now(timezone.utc).date()
            out = []
            for r in rows:
                b = bench.get(r[1])
                b_chg = None
                if b and b["symbol"]:
                    key = (b["symbol"], r[2].date())
                    if key not in bcache:
                        cur.execute(
                            "SELECT close FROM price_bars p JOIN tickers t ON t.id = p.ticker_id "
                            "WHERE t.symbol = %s AND p.d <= %s ORDER BY p.d DESC LIMIT 1",
                            key)
                        c = cur.fetchone()
                        bcache[key] = _f(c[0]) if c else None
                    b_chg = _pct(b["last_close"], bcache[key])
                earn = r[9]
                out.append({
                    "symbol": r[0], "pinned_at": r[2].isoformat(), "score_at_pin": _f(r[3]),
                    "close_at_pin": _f(r[4]), "last_close": _f(r[5]), "last_date": _iso(r[6]),
                    "chg_since_pin": _pct(r[5], r[4]), "benchmark": b["symbol"] if b else None,
                    "benchmark_chg_since_pin": b_chg, "chg_30d": _pct(r[5], r[7]),
                    "closes": _spark(r[8]),
                    "earnings": None if earn is None else {
                        "date": earn.isoformat(), "days": (earn - today).days, "confidence": r[10]},
                    "si_pct_float": _f(r[11]), "fee_pct": _f(r[12]), "volx20d": _f(r[13]),
                    "hf_pass": r[14], "value": _f(r[15]), "band": r[16],
                    "unread": r[17], "armed": r[18], "fired_30d": r[19],
                    "components_present": r[20], "components_total": r[21],
                })
    finally:
        conn.close()
    deltas = [p["value"] - p["score_at_pin"] for p in out
              if p["value"] is not None and p["score_at_pin"] is not None]
    pxs = [p["chg_since_pin"] for p in out if p["chg_since_pin"] is not None]
    rel = [p["chg_since_pin"] - p["benchmark_chg_since_pin"] for p in out
           if p["chg_since_pin"] is not None and p["benchmark_chg_since_pin"] is not None]
    return {
        "picks": out,
        "summary": {
            "count": len(out),
            "mean_score_delta_since_pin": round(sum(deltas) / len(deltas), 1) if deltas else None,
            "mean_chg_since_pin": round(sum(pxs) / len(pxs), 2) if pxs else None,
            "mean_rel_since_pin": round(sum(rel) / len(rel), 2) if rel else None,
            "cleared": sum(1 for p in out if p["hf_pass"] is True),
            "earnings_14d": sum(1 for p in out if p["earnings"] and 0 <= p["earnings"]["days"] <= 14),
            "unread": sum(p["unread"] for p in out),
            "armed": sum(p["armed"] for p in out),
        },
        "run_as_of": latest[1].isoformat() if latest else None,
    }


# --------------------------------------------------------------------------
# Watchlist index: the home screen's hero chart
# --------------------------------------------------------------------------

def _rebased(cur, ticker_ids, days):
    """Equal-weight index of the given tickers' closes over the window,
    rebased to 100 at each ticker's first close in the window and averaged
    per day over the tickers that have a close that day. Returns
    [{d, v}] oldest first, or [] when nothing is on file."""
    if not ticker_ids:
        return []
    cur.execute(
        "SELECT ticker_id, d, close FROM price_bars WHERE ticker_id = ANY(%s) "
        "AND d >= CURRENT_DATE - %s ORDER BY d",
        (list(ticker_ids), days),
    )
    first, by_day = {}, {}
    for tid, d, close in cur.fetchall():
        c = float(close)
        if tid not in first:
            if not c:
                continue
            first[tid] = c
        by_day.setdefault(d, []).append(c / first[tid] * 100)
    return [{"d": d.isoformat(), "v": round(sum(vs) / len(vs), 3)} for d, vs in sorted(by_day.items())]


@router.get("/api/me/watchlist/series")
def watchlist_series(days: int = Query(90, ge=7, le=730),
                     creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """Two rebased series: the subscriber's pinned names as an equal-weight
    index, and the ETFs of the industries they follow. Rebased to 100 at the
    start of the window, so the chart shows relative movement, never a
    dollar figure that the product does not hold."""
    conn = get_conn()
    try:
        uid, tier, keys, picks, vis, vis_params, k = _viewer(conn, creds)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT t.id, t.symbol FROM picks p JOIN instruments i ON i.id = p.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id WHERE p.user_id = %s AND p.active "
                "ORDER BY p.sort_order, p.pinned_at",
                (uid,),
            )
            pick_rows = cur.fetchall()
            watch = _rebased(cur, [r[0] for r in pick_rows], days)
            cur.execute(
                "SELECT DISTINCT ON (ind.id) ind.id, ind.key, ind.label, t.id, t.symbol, r.label "
                "FROM industries ind JOIN reference_assets r ON r.industry_id = ind.id "
                "JOIN tickers t ON t.id = r.ticker_id WHERE ind.key = ANY(%s) "
                "ORDER BY ind.id, r.sort_order",
                (keys,),
            )
            bench = []
            for iid, ikey, ilabel, tid, sym, label in cur.fetchall():
                pts = _rebased(cur, [tid], days)
                bench.append({"industry_key": ikey, "industry_label": ilabel, "symbol": sym,
                              "label": label, "points": pts,
                              "change_pct": round(pts[-1]["v"] - 100, 2) if pts else None})
    finally:
        conn.close()
    return {
        "days": days,
        "watchlist": {"symbols": [r[1] for r in pick_rows], "points": watch,
                      "change_pct": round(watch[-1]["v"] - 100, 2) if watch else None},
        "benchmarks": bench,
        "note": "Equal-weight, rebased to 100 at the start of the window; relative movement only.",
    }
