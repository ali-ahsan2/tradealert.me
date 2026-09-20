"""The Lab: admin-only strategy analysis (STRATEGY_ANALYSIS_TOOL.md).

Every route here requires an admin session and answers with Cache-Control:
no-store and X-Robots-Tag: noindex. Anonymous requests and non-admin
sessions get a uniform 404, never a 403, so the surface's existence stays
hidden. The /api/admin/_check route is the admin gate probe the Lab bundle calls on load:
204 for admins, uniform 404 for anonymous and non-admin requests, no body.

Phase 1 scope: strategy index/inputs/versions/diff/coverage, the backtest
rate-comparison engine with guardrails, the findings ledger with computed
evidence grades, and the query audit log. Regression remains Phase 2.
"""
import hashlib
import json
import math
import re

from fastapi import APIRouter, Depends, Response
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.context import user_from_creds, user_id, user_is_admin
from app.db import get_conn

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

COMPARISON_FOOTER = ("This measures whether a move happened, not its "
                     "direction and not whether a trade would have been "
                     "profitable. Results describe the instruments and "
                     "period selected, not future market conditions.")

MIN_GROUP_FLOOR = 10
SMALL_SAMPLE = 30
MIN_INSTRUMENTS = 5


def _admin_404():
    raise HTTPException(404, "not found")


def _require_admin(creds):
    if creds is None:
        _admin_404()
    row = user_from_creds(creds)
    if not user_is_admin(row):
        _admin_404()
    return row


def _no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"


# --------------------------------------------------------------------------
# Statistics (spec 6.1: intervals are mandatory, never optional)
# --------------------------------------------------------------------------

def wilson_ci(k, n, z=1.96):
    """Wilson score interval; None when n is 0."""
    if n <= 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def two_prop_p(p1, n1, p2, n2):
    """Two-sided p for a difference in two proportions (normal approx)."""
    if n1 <= 0 or n2 <= 0:
        return 1.0
    p_hat = (p1 * n1 + p2 * n2) / (n1 + n2)
    se = math.sqrt(p_hat * (1 - p_hat) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    z = abs(p1 - p2) / se
    return round(2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2)))), 6)


def holm_adjust(p_target, family_p_values):
    """Holm-Bonferroni adjusted p over the whole family (spec 6.3)."""
    if not family_p_values:
        return p_target
    full = sorted(family_p_values + [p_target])
    m = len(full)
    rank = full.index(p_target) + 1
    best = 1.0
    for i in range(rank):
        best = max(best, full[i] * (m - i))
    return round(min(1.0, best), 6)


# --------------------------------------------------------------------------
# Gate probe
# --------------------------------------------------------------------------

@router.get("/api/admin/_check")
def check(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    resp = Response(status_code=204)
    _no_cache(resp)
    return resp


# --------------------------------------------------------------------------
# Strategy index
# --------------------------------------------------------------------------

def _strategy_key(cur, key):
    cur.execute(
        "SELECT id, key, label, calibrated, calibrated_at, "
        "resolved_outcomes_count, score_evidence_note "
        "FROM strategies WHERE key = %s",
        (key,),
    )
    row = cur.fetchone()
    if not row:
        _admin_404()
    return {"id": row[0], "key": row[1], "label": row[2],
            "calibrated": bool(row[3]),
            "calibrated_at": row[4].isoformat() if row[4] else None,
            "resolved_outcomes_count": row[5],
            "score_evidence_note": row[6]}


def _current_version(cur, strategy_id):
    cur.execute(
        "SELECT id, version_number, band_cutoffs_json, component_weights_json, "
        "hard_filters_json, effective_from, effective_to, created_by_admin_id, "
        "change_reason FROM strategy_versions "
        "WHERE strategy_id = %s ORDER BY version_number DESC LIMIT 1",
        (strategy_id,),
    )
    return cur.fetchone()


def _version_row(cur, strategy_id, version_number):
    cur.execute(
        "SELECT id, version_number, band_cutoffs_json, component_weights_json, "
        "hard_filters_json, effective_from, effective_to, created_by_admin_id, "
        "change_reason FROM strategy_versions "
        "WHERE strategy_id = %s AND version_number = %s ORDER BY id DESC LIMIT 1",
        (strategy_id, version_number),
    )
    return cur.fetchone()


def _serialize_version(row):
    return {
        "id": row[0], "version_number": row[1],
        "band_cutoffs": row[2], "component_weights": row[3],
        "hard_filters": row[4],
        "effective_from": row[5].isoformat(),
        "effective_to": row[6].isoformat() if row[6] else None,
        "created_by_admin_id": row[7], "change_reason": row[8],
    }


@router.get("/api/admin/lab/strategies", dependencies=[Depends(_no_cache)])
def lab_strategies(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, key, label, calibrated, calibrated_at, "
                        "resolved_outcomes_count FROM strategies ORDER BY sort_order, id")
            rows = cur.fetchall()
            cur.execute("SELECT COUNT(*) FROM backtest_events WHERE data_complete")
            events_complete = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM backtest_events")
            events_total = cur.fetchone()[0]
            out = []
            for r in rows:
                sid, key, label = r[0], r[1], r[2]
                ver = _current_version(cur, sid)
                cur.execute(
                    "SELECT lq.created_at, u.email FROM lab_queries lq "
                    "JOIN users u ON u.id = lq.admin_user_id "
                    "WHERE lq.strategy_id = %s AND lq.status = 'completed' "
                    "ORDER BY lq.created_at DESC LIMIT 1",
                    (sid,),
                )
                last = cur.fetchone()
                out.append({
                    "key": key, "label": label, "calibrated": bool(r[3]),
                    "version_number": ver[1] if ver else None,
                    "effective_from": ver[5].isoformat() if ver and ver[5] else None,
                    "last_query_at": last[0].isoformat() if last else None,
                    "last_query_by": last[1] if last else None,
                })
            return {"strategies": out,
                    "events_total": events_total,
                    "events_complete": events_complete}
    finally:
        conn.close()


@router.get("/api/admin/lab/strategies/{key}/inputs",
            dependencies=[Depends(_no_cache)])
def lab_inputs(key: str, version: str | None = None,
               creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            strat = _strategy_key(cur, key)
            if version and version.isdigit():
                row = _version_row(cur, strat["id"], int(version))
            else:
                row = _current_version(cur, strat["id"])
            cur.execute(
                "SELECT claim, status, evidence_grade, claim_kind, id FROM lab_findings "
                "WHERE strategy_id = %s ORDER BY updated_at DESC",
                (strat["id"],),
            )
            findings = [{"id": f[4], "claim": f[0], "status": f[1],
                         "evidence_grade": f[2], "claim_kind": f[3]}
                        for f in cur.fetchall()]
            return {"strategy": {"key": strat["key"], "label": strat["label"],
                                 "calibrated": strat["calibrated"]},
                    "version": _serialize_version(row) if row else None,
                    "score_evidence_note": strat["score_evidence_note"],
                    "findings": findings}
    finally:
        conn.close()


@router.get("/api/admin/lab/strategies/{key}/versions",
            dependencies=[Depends(_no_cache)])
def lab_versions(key: str, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            strat = _strategy_key(cur, key)
            cur.execute(
                "SELECT sv.id, sv.version_number, sv.band_cutoffs_json, "
                "sv.component_weights_json, sv.hard_filters_json, sv.effective_from, "
                "sv.effective_to, sv.created_by_admin_id, sv.change_reason, u.email "
                "FROM strategy_versions sv JOIN users u ON u.id = sv.created_by_admin_id "
                "WHERE sv.strategy_id = %s ORDER BY sv.version_number DESC",
                (strat["id"],),
            )
            versions = [{"id": r[0], "version_number": r[1], "band_cutoffs": r[2],
                         "component_weights": r[3], "hard_filters": r[4],
                         "effective_from": r[5].isoformat(),
                         "effective_to": r[6].isoformat() if r[6] else None,
                         "created_by": r[9], "change_reason": r[8]} for r in cur.fetchall()]
            return {"strategy": key, "versions": versions}
    finally:
        conn.close()


def _diff_sets(a, b):
    """Dict-of-dicts diff between two version payloads (earlier vs later)."""
    changed = []
    for k in sorted(set(a) | set(b)):
        if a.get(k) != b.get(k):
            changed.append({"key": k, "before": a.get(k), "after": b.get(k)})
    return changed


@router.get("/api/admin/lab/strategies/{key}/versions/diff",
            dependencies=[Depends(_no_cache)])
def lab_diff(key: str, a: int, b: int,
             creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            strat = _strategy_key(cur, key)
            ra = _version_row(cur, strat["id"], a)
            rb = _version_row(cur, strat["id"], b)
            if not (ra and rb):
                _admin_404()
            earlier, later = (ra, rb) if ra[1] <= rb[1] else (rb, ra)
            e_f = {f["key"]: f for f in (earlier[4] or [])}
            l_f = {f["key"]: f for f in (later[4] or [])}
            hf = _diff_sets(e_f, l_f)
            e_w, l_w = dict(earlier[3] or {}), dict(later[3] or {})
            e_b, l_b = dict(earlier[2] or {}), dict(later[2] or {})
            return {
                "strategy": key,
                "earlier": earlier[1], "later": later[1],
                "hard_filters": [
                    h for h in hf if h["key"] not in e_f
                    or h["before"] != h["after"]
                ],
                "component_weights": [{"key": k, "before": e_w.get(k),
                                       "after": l_w.get(k)}
                                      for k in sorted(set(e_w) | set(l_w))
                                      if e_w.get(k) != l_w.get(k)],
                "band_cutoffs": [{"key": k, "before": e_b.get(k),
                                  "after": l_b.get(k)}
                                 for k in sorted(set(e_b) | set(l_b))
                                 if e_b.get(k) != l_b.get(k)],
            }
    finally:
        conn.close()


@router.get("/api/admin/lab/strategies/{key}/coverage",
            dependencies=[Depends(_no_cache)])
def lab_coverage(key: str, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            _strategy_key(cur, key)  # 404 unless strategy exists
            cur.execute(
                "SELECT COUNT(DISTINCT instrument_id), COUNT(*), "
                "COUNT(*) FILTER (WHERE data_complete) FROM backtest_events")
            totals = cur.fetchone()
            cur.execute(
                "SELECT ind.key, ind.label, "
                "COUNT(*) FILTER (WHERE be.synthetic_data_used) AS synthetic, "
                "COUNT(*) AS events, COUNT(DISTINCT be.instrument_id) AS instrs "
                "FROM backtest_events be "
                "JOIN instruments i ON i.id = be.instrument_id "
                "JOIN industries ind ON ind.id = i.industry_id "
                "GROUP BY ind.key, ind.label ORDER BY events DESC")
            return {"strategy": key,
                    "instruments": totals[0] or 0, "events": totals[1] or 0,
                    "events_complete": totals[2] or 0,
                    "industries": [{"key": r[0], "label": r[1], "synthetic": r[2],
                                    "events": r[3], "instruments": r[4]}
                                   for r in cur.fetchall()]}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Backtest (Phase 1; regression is Phase 2)
# --------------------------------------------------------------------------

class UniverseIn(BaseModel):
    tickers: list[str] | None = None
    industry_keys: list[str] | None = None
    market_cap_band: list | None = None
    instrument_group: str | None = None
    theme_regex: str | None = None


class HitDefinitionIn(BaseModel):
    price_move_pct: float = 20.0
    volume_spike_x: float = 3.0
    combine: str = "or"
    window: str = "tight"


class WindowIn(BaseModel):
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None


class BacktestIn(BaseModel):
    strategy_key: str
    version_number: int | None = None
    universe: UniverseIn = Field(default_factory=UniverseIn)
    window: WindowIn = Field(default_factory=WindowIn)
    event_kinds: list[str] | None = None
    hit_definition: HitDefinitionIn = Field(default_factory=HitDefinitionIn)
    baselines: list[str] | None = None
    hypothesis: str = ""
    family_key: str | None = None


def _normalize_spec(body: BacktestIn) -> dict:
    return {
        "strategy": body.strategy_key,
        "version": body.version_number,
        "universe": body.universe.model_dump(exclude_none=True),
        "window": body.window.model_dump(exclude_none=True),
        "event_kinds": body.event_kinds,
        "hit": body.hit_definition.model_dump(),
        "baselines": body.baselines,
    }


def _match_terms(spec, universe_on: bool):
    """Shared WHERE for backtest_events. universe_on=False drops the universe
    selectors so the all-events baseline and excluded counts stay honest."""
    where, params = [], []
    uni = spec.get("universe") or {}
    kinds = spec.get("event_kinds") or ["earnings"]
    placeholders = ",".join(["%s"] * len(kinds))
    where.append(f"be.event_kind IN ({placeholders})")
    params.extend(kinds)
    win = spec.get("window") or {}
    if win.get("from"):
        where.append("be.event_date >= %s")
        params.append(win["from"])
    if win.get("to"):
        where.append("be.event_date <= %s")
        params.append(win["to"])
    if universe_on:
        if uni.get("tickers"):
            ph = ",".join(["%s"] * len(uni["tickers"]))
            where.append(f"UPPER(t.symbol) IN ({ph})")
            params.extend([u.upper() for u in uni["tickers"]])
        if uni.get("industry_keys"):
            ph = ",".join(["%s"] * len(uni["industry_keys"]))
            where.append(f"i.industry_id IN (SELECT id FROM industries WHERE key IN ({ph}))")
            params.extend(uni["industry_keys"])
        if uni.get("instrument_group"):
            where.append("i.instrument_group = %s")
            params.append(uni["instrument_group"])
        if uni.get("theme_regex"):
            where.append("i.theme ~* %s")
            params.append(uni["theme_regex"])
        if uni.get("market_cap_band") and len(uni["market_cap_band"]) == 2:
            lo, hi = uni["market_cap_band"]
            where.append(
                "EXISTS (SELECT 1 FROM snapshots sn "
                "WHERE sn.ticker_id = i.ticker_id AND sn.field = 'cap_usd_m' "
                "AND sn.value::numeric BETWEEN %s AND %s)")
            params.extend([lo, hi])
    return where, params


def _evaluate_filters(version_row, inputs_json):
    """Pass/fail per the version's hard filters on the event's raw inputs."""
    hf = (version_row[4] or []) if version_row else []
    if not hf:
        return True, None
    for rule in hf:
        key = rule["key"]
        raw = None
        stored_pass = False
        found = False
        for h in (inputs_json.get("hard_filters") or []):
            if h.get("key") == key:
                raw = h.get("value")
                stored_pass = bool(h.get("pass"))
                found = True
                break
        if not found:
            return False, f"filter_{key}_unavailable"
        ok = stored_pass
        op = rule.get("op")
        if raw is not None and op:
            thr = rule.get("value")
            if op == "between":
                lo, hi = thr
                ok = raw >= lo and raw <= hi
            elif op == ">":
                ok = raw > thr
            elif op == "<":
                ok = raw < thr
            elif op == ">=":
                ok = raw >= thr
            elif op == "<=":
                ok = raw <= thr
        if not ok:
            return False, f"filter_{key}"
    return True, None


def _run_backtest(body: BacktestIn, version_row, cur):
    spec = _normalize_spec(body)
    hit_price = body.hit_definition.price_move_pct
    hit_vol = body.hit_definition.volume_spike_x
    combine = body.hit_definition.combine

    where, params = _match_terms(spec, universe_on=True)
    cur.execute(
        "SELECT be.id, be.instrument_id, be.event_kind, be.fwd_max_move_pct, "
        "be.fwd_vol_spike_x, be.inputs_json, be.provenance_json, "
        "be.synthetic_data_used, t.symbol "
        "FROM backtest_events be "
        "JOIN instruments i ON i.id = be.instrument_id "
        "JOIN tickers t ON t.id = i.ticker_id "
        "WHERE " + " AND ".join(where) + " AND be.data_complete",
        tuple(params),
    )
    events = cur.fetchall()
    in_scope = len(events)

    where_all, params_all = _match_terms(spec, universe_on=False)
    cur.execute(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE data_complete) "
        "FROM backtest_events be "
        "JOIN instruments i ON i.id = be.instrument_id "
        "JOIN tickers t ON t.id = i.ticker_id "
        "WHERE " + " AND ".join(where_all),
        tuple(params_all),
    )
    raw_all, complete_all = cur.fetchone()
    excluded_universe = (complete_all or 0) - in_scope
    excluded_incomplete = (raw_all or 0) - (complete_all or 0)

    groups = {}
    synthetic = False
    sources = set()
    for (_eid, _iid, _kind, max_move, vol_spike, inputs_json, prov, syn, _sym) in events:
        max_move = float(max_move) if max_move is not None else 0.0
        vol_spike = float(vol_spike) if vol_spike is not None else 0.0
        by_price = max_move >= hit_price
        by_vol = vol_spike >= hit_vol
        hit = (by_price or by_vol) if combine == "or" else (by_price and by_vol)
        pass_ok, _fail = _evaluate_filters(version_row, inputs_json)
        if _kind == "random_day":
            key = "na"
        else:
            key = "pass" if pass_ok else "fail"
        g = groups.setdefault(key, {"n": 0, "hits": 0, "instruments": set()})
        g["n"] += 1
        g["hits"] += 1 if hit else 0
        g["instruments"].add(_iid)
        synthetic = synthetic or bool(syn)
        src = (prov or {}).get("source")
        if src:
            sources.add(src)

    groups_out = []
    labels = (("pass", "All hard filters passed"),
              ("fail", "Any hard filter failed"),
              ("na", "Random-day baseline (filters not applicable)"))
    for key, label in labels:
        g = groups.get(key)
        if not g:
            continue
        n, k = g["n"], g["hits"]
        distinct = len(g["instruments"])
        warnings = []
        rate = (k / n) if n else None
        if n < MIN_GROUP_FLOOR:
            warnings.append({
                "code": "GROUP_TOO_SMALL", "severity": "block",
                "text": (f"{n} events in this group is below the floor of {MIN_GROUP_FLOOR} "
                         "this tool treats as reportable. A rate is not reported.")})
            rate = None
        elif n < SMALL_SAMPLE:
            warnings.append({
                "code": "SMALL_SAMPLE", "severity": "warn",
                "text": f"{n} events in this group. The rate is unstable to a decimal point."})
        if distinct < MIN_INSTRUMENTS:
            warnings.append({
                "code": "FEW_INSTRUMENTS", "severity": "warn",
                "text": (f"{distinct} distinct instrument{'s' if distinct != 1 else ''}, "
                         f"below the {MIN_INSTRUMENTS} needed to generalise.")})
        groups_out.append({
            "key": key, "label": label, "n": n, "hits": k,
            "hit_rate": round(rate, 4) if rate is not None else None,
            "ci95": wilson_ci(k, n),
            "distinct_instruments": distinct, "warnings": warnings,
        })

    baselines_out = []
    all_rate = all_k = all_n = None
    if body.baselines:
        kinds = spec.get("event_kinds") or ["earnings"]
        ph = ",".join(["%s"] * len(kinds))
        win = spec.get("window") or {}
        conds = [f"be.event_kind IN ({ph})", "be.data_complete"]
        wparams = list(kinds)
        if win.get("from"):
            conds.append("be.event_date >= %s")
            wparams.append(win["from"])
        if win.get("to"):
            conds.append("be.event_date <= %s")
            wparams.append(win["to"])
        cur.execute(
            f"SELECT COUNT(*), COUNT(*) FILTER (WHERE fwd_max_move_pct >= %s OR "
            f"fwd_vol_spike_x >= %s) FROM backtest_events be "
            f"WHERE {' AND '.join(conds)}",
            tuple([hit_price, hit_vol] + wparams),
        )
        all_n, all_k = cur.fetchone()
        all_n = all_n or 0
        all_k = all_k or 0
        lab = ", ".join(sorted({k for k in kinds}))
        if "all_events" in body.baselines:
            rate = (all_k / all_n) if all_n else None
            baselines_out.append({"label": f"All {lab} events", "n": all_n,
                                  "hits": all_k,
                                  "hit_rate": round(rate, 4) if rate is not None else None,
                                  "ci95": wilson_ci(all_k, all_n)})
        if "random_day" in body.baselines:
            cur.execute(
                "SELECT COUNT(*), COUNT(*) FILTER (WHERE fwd_max_move_pct >= %s OR "
                "fwd_vol_spike_x >= %s) FROM backtest_events "
                "WHERE event_kind = 'random_day' AND data_complete",
                (hit_price, hit_vol),
            )
            n, k = cur.fetchone()
            n, k = n or 0, k or 0
            rate = (k / n) if n else None
            baselines_out.append({"label": "Random trading days", "n": n, "hits": k,
                                  "hit_rate": round(rate, 4) if rate is not None else None,
                                  "ci95": wilson_ci(k, n)})

    comparison = None
    pg = groups.get("pass")
    if pg and all_n:
        p1 = pg["hits"] / pg["n"]
        p2 = (all_k / all_n) if all_n else None
        pval = two_prop_p(p1, pg["n"], p2, all_n)
        family_p = [pval]
        if body.family_key:
            cur.execute(
                "SELECT result_json FROM lab_queries WHERE family_key = %s "
                "AND query_type = 'backtest' AND status = 'completed' "
                "AND created_at > now() - interval '90 days'",
                (body.family_key,),
            )
            for (res,) in cur.fetchall():
                if res and res.get("comparison", {}).get("p_value") is not None:
                    family_p.append(res["comparison"]["p_value"])
        comparison = {
            "vs": "All selected events",
            "difference": round(p1 - p2, 4),
            "test": "two-proportion z-test",
            "p_value": pval,
            "p_value_adjusted": holm_adjust(pval, family_p),
            "adjustment": {"method": "holm",
                           "family_key": body.family_key,
                           "tests_in_family": len(family_p)},
        }

    cur.execute(
        "SELECT COUNT(*) FROM scores sc JOIN strategies s ON s.id = sc.strategy_id "
        "WHERE s.key = %s AND sc.version_confidence = 'assumed'",
        (body.strategy_key,),
    )
    assumed_count = cur.fetchone()[0]

    provenance = {
        "events_in_scope": in_scope,
        "events_total_after_universe": complete_all or 0,
        "events_excluded": excluded_universe + excluded_incomplete,
        "exclusions": [{"reason": "universe_filter", "count": excluded_universe},
                       {"reason": "data_incomplete", "count": excluded_incomplete}],
        "sources": sorted(sources),
        "synthetic_data_used": synthetic,
        "version_confidence_assumed_count": assumed_count,
    }

    all_warnings = [w for g in groups_out for w in g["warnings"]]
    return spec, {
        "groups": groups_out, "baselines": baselines_out,
        "comparison": comparison, "warnings": all_warnings,
        "provenance": provenance, "footer": COMPARISON_FOOTER,
    }


@router.post("/api/admin/lab/backtest", dependencies=[Depends(_no_cache)])
def lab_backtest(body: BacktestIn,
                 creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            strat = _strategy_key(cur, body.strategy_key)
            if body.version_number:
                ver = _version_row(cur, strat["id"], body.version_number)
                if not ver:
                    _admin_404()
            else:
                ver = _current_version(cur, strat["id"])
            spec = _normalize_spec(body)
            spec_hash = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
            cur.execute("SELECT COALESCE(MAX(id), 0) FROM backtest_events")
            events_max_id = cur.fetchone()[0]
            cur.execute(
                "SELECT id, result_json FROM lab_queries "
                "WHERE spec_hash = %s AND status = 'completed' "
                "ORDER BY id DESC LIMIT 1", (spec_hash,))
            cached = cur.fetchone()
            fresh = cached is None or not cached[1] or cached[1].get("events_max_id") != events_max_id
            cur.execute(
                "INSERT INTO lab_queries (admin_user_id, strategy_id, strategy_version_id, "
                " query_type, spec_json, spec_hash, hypothesis, family_key, status) "
                "VALUES (%s, %s, %s, 'backtest', %s, %s, %s, %s, 'running') RETURNING id",
                (admin_id, strat["id"], ver[0] if ver else None,
                 json.dumps(spec), spec_hash, body.hypothesis, body.family_key))
            query_id = cur.fetchone()[0]
            if fresh:
                _spec, result = _run_backtest(body, ver, cur)
                result["events_max_id"] = events_max_id
            else:
                result = dict(cached[1])
                result.pop("cached_from_query_id", None)
                result["cached_from_query_id"] = cached[0]
            cur.execute(
                "UPDATE lab_queries SET status = 'completed', completed_at = now(), "
                "result_json = %s WHERE id = %s",
                (json.dumps(result), query_id))
            conn.commit()
            return {"query_id": query_id, "spec_hash": spec_hash[:16],
                    "cached": not fresh, **result}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Findings ledger
# --------------------------------------------------------------------------

class FindingCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    claim: str = Field(min_length=10, max_length=500)
    claim_kind: str = Field(pattern="^(filter|weight|band|component|other)$")
    lab_query_ids: list[int] = Field(min_length=1)
    notes: str = ""


class FindingPatchIn(BaseModel):
    title: str | None = None
    claim: str | None = None
    status: str | None = Field(
        default=None, pattern="^(hypothesis|tested|held_up|failed|superseded)$")
    claim_kind: str | None = Field(
        default=None, pattern="^(filter|weight|band|component|other)$")
    notes: str | None = None
    superseded_by_id: int | None = None


class FindingQueryIn(BaseModel):
    lab_query_id: int
    relation: str = Field(pattern="^(supports|contradicts|replicates)$")


def _claim_format_errors(claim: str) -> list[str]:
    errors = []
    if not re.search(r"\d", claim):
        errors.append("A claim needs a number. \u201cShort interest matters\u201d cannot be "
                      "checked later; \u201cSI above 12% raised hit rate by 7 points (n=61)\u201d can.")
    if not re.search(r"n=|events|instruments", claim, re.I):
        errors.append("Say how much data this rests on (n=..., events, or instruments).")
    if len(claim) > 400:
        errors.append("If it takes more than 400 characters, it is more than one claim. Split it.")
    return errors


def _compute_evidence_grade(cur, finding_id):
    """Spec 6.6. All grades are computed server-side, never client-supplied.
    Phase 1 ceiling is 'weak': 'moderate' needs a regression holdout and
    'strong' needs replication, both of which are Phase 2 machinery."""
    cur.execute(
        "SELECT lq.result_json, lfq.relation FROM lab_finding_queries lfq "
        "JOIN lab_queries lq ON lq.id = lfq.lab_query_id "
        "WHERE lfq.finding_id = %s AND lq.status = 'completed'",
        (finding_id,),
    )
    rows = cur.fetchall()
    if not any(r[1] == "supports" for r in rows):
        return "none"
    best = "none"
    synthetic = False
    for res, relation in rows:
        if not res:
            continue
        synthetic = synthetic or bool(res.get("synthetic_data_used"))
        groups = res.get("groups") or []
        for grp in groups:
            n = grp.get("n") or 0
            rate = grp.get("hit_rate")
            ci = grp.get("ci95")
            if rate is None or n < SMALL_SAMPLE or not ci or ci[0] is None:
                continue
            grade = "weak" if rate > 0.5 else "none"
            if grade == "weak" and best == "none":
                best = "weak"
        comp = res.get("comparison") or {}
        p = comp.get("p_value_adjusted")
        if p is not None and p < 0.05 and best == "none":
            best = "weak"
    if synthetic and best in ("moderate", "strong"):
        best = "weak"
    if any(r[1] == "replicates" for r in rows) and best == "weak":
        best = "strong"
    return best


def _finding_detail(cur, finding_id):
    cur.execute(
        "SELECT lf.id, st.key, lf.title, lf.claim, lf.status, lf.evidence_grade, "
        "lf.claim_kind, lf.created_at, lf.updated_at, lf.notes, lf.superseded_by_id "
        "FROM lab_findings lf JOIN strategies st ON st.id = lf.strategy_id "
        "WHERE lf.id = %s", (finding_id,))
    r = cur.fetchone()
    if not r:
        _admin_404()
    cur.execute(
        "SELECT lq.id, lq.query_type, lq.status, lq.created_at, lfq.relation, "
        "lq.spec_json, lq.result_json, u.email "
        "FROM lab_finding_queries lfq JOIN lab_queries lq ON lq.id = lfq.lab_query_id "
        "JOIN users u ON u.id = lq.admin_user_id WHERE lfq.finding_id = %s",
        (finding_id,))
    queries = [{"id": q[0], "query_type": q[1], "status": q[2],
                "created_at": q[3].isoformat(), "relation": q[4], "spec": q[5],
                "result": q[6], "by": q[7]} for q in cur.fetchall()]
    return {"id": r[0], "strategy": r[1], "title": r[2], "claim": r[3],
            "status": r[4], "evidence_grade": r[5], "claim_kind": r[6],
            "created_at": r[7].isoformat(), "updated_at": r[8].isoformat(),
            "notes": r[9], "superseded_by_id": r[10], "queries": queries}


@router.get("/api/admin/lab/findings", dependencies=[Depends(_no_cache)])
def lab_findings_list(strategy: str | None = None, status: str | None = None,
                      creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            where, params = [], []
            if strategy:
                where.append("st.key = %s")
                params.append(strategy)
            if status:
                where.append("lf.status = %s")
                params.append(status)
            w = (" WHERE " + " AND ".join(where)) if where else ""
            cur.execute(
                "SELECT lf.id, st.key, lf.title, lf.claim, lf.status, lf.evidence_grade, "
                "lf.claim_kind, lf.updated_at, "
                "COUNT(*) FILTER (WHERE fq.relation = 'supports') AS sup, "
                "COUNT(*) FILTER (WHERE fq.relation = 'replicates') AS rep, "
                "COUNT(*) FILTER (WHERE fq.relation = 'contradicts') AS con "
                "FROM lab_findings lf JOIN strategies st ON st.id = lf.strategy_id "
                "LEFT JOIN lab_finding_queries fq ON fq.finding_id = lf.id "
                + w + " GROUP BY lf.id, st.key ORDER BY lf.updated_at DESC LIMIT 500",
                tuple(params))
            findings = [{"id": r[0], "strategy": r[1], "title": r[2], "claim": r[3],
                         "status": r[4], "evidence_grade": r[5], "claim_kind": r[6],
                         "updated_at": r[7].isoformat(),
                         "citations": {"supports": r[8], "replicates": r[9],
                                       "contradicts": r[10]}} for r in cur.fetchall()]
            return {"findings": findings}
    finally:
        conn.close()


@router.get("/api/admin/lab/findings/{fid}", dependencies=[Depends(_no_cache)])
def lab_finding_detail(fid: int, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            return _finding_detail(cur, fid)
    finally:
        conn.close()


@router.post("/api/admin/lab/findings", dependencies=[Depends(_no_cache)])
def lab_finding_create(body: FindingCreateIn,
                       creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    errors = _claim_format_errors(body.claim)
    if errors:
        raise HTTPException(400, {"claim": errors})
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT strategy_id FROM lab_queries WHERE id = ANY(%s) AND status = 'completed'",
                (body.lab_query_ids,))
            rows = cur.fetchall()
            if len(rows) != len(set(body.lab_query_ids)):
                raise HTTPException(400, "every cited query must exist and be completed")
            cur.execute(
                "INSERT INTO lab_findings (strategy_id, title, claim, status, claim_kind, "
                " created_by_admin_id, notes) VALUES (%s, %s, %s, 'tested', %s, %s, %s) "
                "RETURNING id",
                (rows[0][0], body.title.strip(), body.claim.strip(), body.claim_kind,
                 admin_id, body.notes))
            fid = cur.fetchone()[0]
            for qid in set(body.lab_query_ids):
                cur.execute(
                    "INSERT INTO lab_finding_queries (finding_id, lab_query_id, relation) "
                    "VALUES (%s, %s, 'supports')", (fid, qid))
            grade = _compute_evidence_grade(cur, fid)
            cur.execute("UPDATE lab_findings SET evidence_grade = %s WHERE id = %s",
                        (grade, fid))
            conn.commit()
            return {"id": fid, "evidence_grade": grade}
    finally:
        conn.close()


@router.patch("/api/admin/lab/findings/{fid}", dependencies=[Depends(_no_cache)])
def lab_finding_patch(fid: int, body: FindingPatchIn,
                      creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM lab_findings WHERE id = %s", (fid,))
            if not cur.fetchone():
                _admin_404()
            if body.claim is not None:
                errors = _claim_format_errors(body.claim)
                if errors:
                    raise HTTPException(400, {"claim": errors})
            sets, params = [], []
            for col, val in (("title", body.title), ("claim", body.claim),
                             ("status", body.status), ("claim_kind", body.claim_kind),
                             ("notes", body.notes),
                             ("superseded_by_id", body.superseded_by_id)):
                if val is not None:
                    sets.append(f"{col} = %s")
                    params.append(val)
            sets.append("updated_at = now()")
            if sets:
                cur.execute(f"UPDATE lab_findings SET {', '.join(sets)} WHERE id = %s",
                            (*params, fid))
            grade = _compute_evidence_grade(cur, fid)
            cur.execute("UPDATE lab_findings SET evidence_grade = %s WHERE id = %s",
                        (grade, fid))
            conn.commit()
            return _finding_detail(cur, fid)
    finally:
        conn.close()


@router.post("/api/admin/lab/findings/{fid}/queries", dependencies=[Depends(_no_cache)])
def lab_finding_add_query(fid: int, body: FindingQueryIn,
                          creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM lab_findings WHERE id = %s", (fid,))
            if not cur.fetchone():
                _admin_404()
            cur.execute(
                "INSERT INTO lab_finding_queries (finding_id, lab_query_id, relation) "
                "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (fid, body.lab_query_id, body.relation))
            grade = _compute_evidence_grade(cur, fid)
            cur.execute("UPDATE lab_findings SET evidence_grade = %s, updated_at = now() "
                        "WHERE id = %s", (grade, fid))
            conn.commit()
            return {"evidence_grade": grade}
    finally:
        conn.close()


@router.delete("/api/admin/lab/findings/{fid}/queries/{lqid}",
               dependencies=[Depends(_no_cache)])
def lab_finding_remove_query(fid: int, lqid: int,
                             creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM lab_finding_queries WHERE finding_id = %s AND lab_query_id = %s",
                (fid, lqid))
            grade = _compute_evidence_grade(cur, fid)
            cur.execute("UPDATE lab_findings SET evidence_grade = %s, updated_at = now() "
                        "WHERE id = %s", (grade, fid))
            conn.commit()
            return {"evidence_grade": grade}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Query audit log
# --------------------------------------------------------------------------

@router.get("/api/admin/lab/queries", dependencies=[Depends(_no_cache)])
def lab_queries_list(strategy: str | None = None, family: str | None = None,
                     limit: int = 50,
                     creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            where, params = [], []
            if strategy:
                where.append("st.key = %s")
                params.append(strategy)
            if family:
                where.append("lq.family_key = %s")
                params.append(family)
            w = (" WHERE " + " AND ".join(where)) if where else ""
            cur.execute(
                "SELECT lq.id, st.key, lq.query_type, lq.status, lq.family_key, "
                "lq.hypothesis, lq.created_at, lq.completed_at, lq.spec_hash, "
                "lq.cached_from_query_id, u.email "
                "FROM lab_queries lq JOIN strategies st ON st.id = lq.strategy_id "
                "JOIN users u ON u.id = lq.admin_user_id " + w +
                " ORDER BY lq.created_at DESC LIMIT %s",
                (*params, min(limit, 200)))
            rows = cur.fetchall()
            return {"queries": [{"id": q[0], "strategy": q[1], "query_type": q[2],
                                 "status": q[3], "family_key": q[4], "hypothesis": q[5],
                                 "created_at": q[6].isoformat(),
                                 "completed_at": q[7].isoformat() if q[7] else None,
                                 "spec_hash": q[8][:16],
                                 "cached_from_query_id": q[9], "by": q[10]}
                                for q in rows]}
    finally:
        conn.close()