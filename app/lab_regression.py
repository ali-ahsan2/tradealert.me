"""Phase-2 regression endpoint (STRATEGY_ANALYSIS_TOOL.md section 4.3).

Pure-Python logistic (IRLS) and OLS with cluster-robust standard errors by
instrument, VIF diagnostics, a time-based holdout, the section 6 guardrail
warnings, Holm family adjustment against the shared lab_queries journal, and
the section 5.5 verdict banner. No numpy/scipy: the container has neither.

Every route requires an admin session and answers Cache-Control: no-store
and X-Robots-Tag: noindex, matching app/lab.py's uniform 404 surface.
"""
import hashlib
import json
import math
from collections import Counter

from fastapi import APIRouter, Depends, Response
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.context import user_id
from app.db import get_conn
from app.lab import (COMPARISON_FOOTER, MIN_INSTRUMENTS, _evaluate_filters,
                     _match_terms, _require_admin, _version_row, holm_adjust)

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

EPV_WARN = 20
EPV_BLOCK = 10
HYPOTHESIS_MIN = 40
FAMILY_WINDOW_DAYS = 90
FAMILY_MATCH_DAYS = 30
FAMILY_MATCH_CAP_TOLERANCE = 0.05
FAMILY_MATCH_TICKER_OVERLAP = 0.80
HOLDOUT_TOLERANCE = 0.05

_SYNTHETIC_BANNER = ("Synthetic data in this result. This sandbox runs on "
                     "seeded values, not ingested source data. Numbers below "
                     "cannot be cited as evidence and cannot be attached to a finding.")

_FAMILY_FRICTION_5 = ("5 tests in this line of inquiry. At this count, one "
                      "result at p < 0.05 is expected by chance alone even if "
                      "nothing is related.")


def _no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"


def _admin_404():
    raise HTTPException(404, "not found")


# --------------------------------------------------------------------------
# Pure-Python linear algebra and statistics (small models)
# --------------------------------------------------------------------------

def _transpose(A):
    return [list(col) for col in zip(*A)] if A else []


def _lu_solve(A, b):
    n = len(A)
    aug = [list(A[i]) + [b[i]] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-15:
            raise ValueError("singular system")
        aug[col], aug[pivot] = aug[pivot], aug[col]
        for r in range(col + 1, n):
            f = aug[r][col] / aug[col][col]
            for c in range(col, n + 1):
                aug[r][c] -= f * aug[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (aug[r][n] - sum(aug[r][c] * x[c] for c in range(r + 1, n))) / aug[r][r]
    return x


def _matmul(A, B):
    if not A or not B:
        return []
    return [[sum(A[i][p] * B[p][j] for p in range(len(B))) for j in range(len(B[0]))]
            for i in range(len(A))]


def _inverse(A):
    n = len(A)
    return _transpose([_lu_solve(A, [1.0 if i == j else 0.0 for i in range(n)])
                       for j in range(n)])


def _sigmoid(z):
    if z < -40:
        return 1e-18
    if z > 40:
        return 1.0 - 1e-18
    return 1.0 / (1.0 + math.exp(-z))


def _mean(vals):
    return sum(vals) / len(vals) if vals else 0.0


def _variance(vals):
    if len(vals) < 2:
        return 0.0
    m = _mean(vals)
    return sum((v - m) ** 2 for v in vals) / (len(vals) - 1)


def _logistic_ll(X, y, beta):
    nll = 0.0
    for xi, yi in zip(X, y):
        p = _sigmoid(sum(b * x for b, x in zip(beta, xi)))
        nll += yi * math.log(max(p, 1e-300)) + (1 - yi) * math.log(max(1 - p, 1e-300))
    return nll


def _logistic_fit(X, y, max_iter=80, tol=1e-10):
    p = len(X[0])
    n = len(y)
    beta = [0.0] * p
    cur_ll = _logistic_ll(X, y, beta)
    for _ in range(max_iter):
        mu = [_sigmoid(sum(b * x for b, x in zip(beta, xi))) for xi in X]
        s = [sum(X[i][j] * (y[i] - mu[i]) for i in range(n)) for j in range(p)]
        if sum(abs(v) for v in s) < tol:
            break
        wd = [m * (1 - m) for m in mu]
        H = [[sum(X[i][j] * wd[i] * X[i][k] for i in range(n)) for k in range(p)]
             for j in range(p)]
        delta = _lu_solve(H, s)
        step = 1.0
        improved = False
        for _ in range(12):
            trial = [beta[j] + step * delta[j] for j in range(p)]
            ll = _logistic_ll(X, y, trial)
            if ll >= cur_ll - 1e-12:
                beta, cur_ll = trial, ll
                improved = True
                break
            step *= 0.5
        if not improved or step * max(abs(d) for d in delta) < tol:
            break
    return beta


def _ols_fit(X, y):
    Xt = _transpose(X)
    beta = _lu_solve(_matmul(Xt, X),
                     [sum(X[i][j] * y[i] for i in range(len(X))) for j in range(len(X[0]))])
    resid = [y[i] - sum(b * x for b, x in zip(beta, X[i])) for i in range(len(y))]
    return beta, resid


def _cluster_se(X, y, clusters, bread, residual_fn):
    """Sandwich SE: bread X'WX inverse, meat from per-cluster score sums.
    residual_fn(i) is the score contribution vector of observation i."""
    p = len(X[0])
    by_cluster = {}
    for i, c in enumerate(clusters):
        by_cluster.setdefault(c, []).append(i)
    meat = [[0.0] * p for _ in range(p)]
    for rows in by_cluster.values():
        g = [0.0] * p
        for i in rows:
            sc = residual_fn(i)
            for j in range(p):
                g[j] += sc[j]
        for j in range(p):
            for k in range(p):
                meat[j][k] += g[j] * g[k]
    g = len(by_cluster)
    n = len(X)
    if g > 1:
        scale = (g / (g - 1)) * ((n - 1) / max(n - p, 1))
        meat = [[v * scale for v in row] for row in meat]
    sandwich = _matmul(_matmul(bread, meat), bread)
    return [math.sqrt(max(sandwich[j][j], 0.0)) for j in range(p)]


def _column_basis(X, tol=1e-10):
    """Indices of linearly independent columns of X via column-modified
    Gram-Schmidt. Constant and duplicate columns are excluded."""
    n, p = len(X), len(X[0])
    basis, kept = [], []
    for j in range(p):
        v = [float(X[i][j]) for i in range(n)]
        for b in basis:
            proj = sum(v[i] * b[i] for i in range(n))
            v = [v[i] - proj * b[i] for i in range(n)]
        norm = math.sqrt(sum(x * x for x in v))
        if norm > tol:
            inv = 1.0 / norm
            basis.append([x * inv for x in v])
            kept.append(j)
    return kept


def _vifs(X):
    p = len(X[0])
    vifs = [1.0] * p
    for j in range(1, p):
        others = [k for k in range(p) if k != j and k != 0]
        cols = [X[i][j] for i in range(len(X))]
        if _variance(cols) < 1e-12:
            continue
        design = [[X[i][k] for k in others] + [1.0] for i in range(len(X))]
        try:
            _, resid = _ols_fit(design, cols)
        except ValueError:
            continue
        ss_res = sum(r * r for r in resid)
        ss_tot = sum((c - _mean(cols)) ** 2 for c in cols)
        if ss_tot > 0 and ss_res / ss_tot <= 1 - 1e-12:
            vifs[j] = 1.0 / (1.0 - ss_res / ss_tot)
    return vifs


def _auc(prob, y):
    n_pos = sum(y)
    n_neg = len(y) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None
    order = sorted(range(len(prob)), key=lambda i: prob[i])
    rank_sum = sum(r + 1 for r, i in enumerate(order) if y[i])
    return (rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def _p_from_z(z):
    if z is None or not math.isfinite(z):
        return 1.0
    p = 1 - math.erf(abs(z) / math.sqrt(2))
    return round(min(1.0, max(0.0, p)), 6)


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------

class UniverseIn(BaseModel):
    mode: str = "filter"
    industry_keys: list[str] | None = None
    market_cap_band: list | None = None
    instrument_group: str | None = None
    theme_regex: str | None = None
    exchange_keys: list[str] | None = None
    region_keys: list[str] | None = None
    tickers: list[str] | None = None
    pass_fail: str | None = None


class IndependentIn(BaseModel):
    key: str
    transform: str = "none"


class DependSelectIn(BaseModel):
    key: str  # hit | fwd_close_move_pct | days_to_move
    hit_definition: dict | None = None


class HoldoutIn(BaseModel):
    mode: str = "time"
    train_to: str | None = None


class RegressionIn(BaseModel):
    strategy_key: str
    version_number: int | None = None
    hypothesis: str = ""
    family_key: str | None = None
    model: str | None = None  # derived from dependent when absent
    dependent: DependSelectIn
    independent: list[IndependentIn] = Field(default_factory=list)
    controls: list[str] = Field(default_factory=list)
    universe: UniverseIn = Field(default_factory=UniverseIn)
    window: dict | None = None
    holdout: HoldoutIn | None = None
    expected_direction: str | None = None


def _normalize_spec(body):
    window = body.window or {}
    return {
        "strategy": body.strategy_key,
        "version": body.version_number,
        "model": body.model,
        "dependent": {"key": body.dependent.key,
                      "hit_definition": body.dependent.hit_definition},
        "independent": [i.model_dump() for i in body.independent],
        "controls": body.controls,
        "universe": body.universe.model_dump(exclude_none=True),
        "window": {"from": window.get("from"), "to": window.get("to")},
"holdout": body.holdout.model_dump() if body.holdout else None,
    "direction": body.expected_direction,
    "family_key": body.family_key,
}


# --------------------------------------------------------------------------
# Family accounting (section 6.3)
# --------------------------------------------------------------------------

def _dependent_canon(spec):
    return json.dumps(spec["dependent"], sort_keys=True)


def _universe_matches(a, b):
    if a.get("mode") != b.get("mode"):
        return False
    if a.get("mode") == "tickers":
        sa, sb = set(a.get("tickers") or []), set(b.get("tickers") or [])
        if not sa or not sb:
            return False
        return len(sa & sb) / min(len(sa), len(sb)) >= FAMILY_MATCH_TICKER_OVERLAP
    for key in ("industry_keys", "exchange_keys", "region_keys",
                "instrument_group", "theme_regex", "pass_fail"):
        if (a.get(key) or None) != (b.get(key) or None):
            return False
    for x, y in zip(a.get("market_cap_band") or [None, None],
                    b.get("market_cap_band") or [None, None]):
        if x is None or y is None:
            if x != y:
                return False
        elif abs(x - y) / abs(y) > FAMILY_MATCH_CAP_TOLERANCE:
            return False
    return True


def _family_context(cur, strategy_id, spec):
    family_key = spec.get("family_key")
    prior_p = []
    first_test_at = None
    if family_key:
        cur.execute(
            "SELECT (lq.result_json->'comparisons_context'->>'primary_p_value')::float8 "
            "FROM lab_queries lq "
            "WHERE lq.strategy_id = %s AND lq.family_key = %s "
            "AND lq.query_type = 'regression' AND lq.status = 'completed' "
            "AND lq.created_at > now() - interval '%s days' "
            "AND lq.result_json IS NOT NULL",
            (strategy_id, family_key, FAMILY_WINDOW_DAYS),
        )
        prior_p = [r[0] for r in cur.fetchall() if r[0] is not None]
        cur.execute("SELECT MIN(created_at) FROM lab_queries "
                    "WHERE strategy_id = %s AND family_key = %s",
                    (strategy_id, family_key))
        first_test_at = cur.fetchone()[0]
    tests_in_family = len(prior_p) + 1
    combined_total = tests_in_family
    split = False
    if family_key:
        cur.execute(
            "SELECT family_key, COUNT(*) FROM lab_queries "
            "WHERE strategy_id = %s AND query_type = 'regression' "
            "AND created_at > now() - interval '%s days' "
            "AND family_key IS NOT NULL GROUP BY family_key",
            (strategy_id, FAMILY_MATCH_DAYS),
        )
        counts = {k: c for k, c in cur.fetchall()}
        cur.execute(
            "SELECT family_key, spec_json FROM lab_queries "
            "WHERE strategy_id = %s AND query_type = 'regression' "
            "AND spec_json IS NOT NULL "
            "AND created_at > now() - interval '%s days'",
            (strategy_id, FAMILY_MATCH_DAYS),
        )
        seen = set()
        for other_key, spec_json in cur.fetchall():
            if other_key is None or other_key == family_key:
                continue
            ospec = spec_json or {}
            if not ospec.get("dependent"):
                continue
            if _dependent_canon(ospec) != _dependent_canon(spec):
                continue
            if not _universe_matches(ospec.get("universe") or {},
                                     spec.get("universe") or {}):
                continue
            if other_key in seen:
                continue
            seen.add(other_key)
            combined_total += counts.get(other_key, 0)
            split = True
    return {"family_key": family_key, "prior_p": prior_p,
            "tests_in_family": tests_in_family,
            "combined_total": combined_total, "split": split,
            "first_test_at": first_test_at}


# --------------------------------------------------------------------------
# Event loading + design matrix
# --------------------------------------------------------------------------

def _load_events(cur, spec, version_row):
    sub = {"event_kinds": ["earnings"],
           "window": spec.get("window") or {},
           "universe": spec.get("universe") or {}}
    where, params = _match_terms(sub, universe_on=True)
    cur.execute(
        "SELECT be.id, be.instrument_id, be.event_date, t.symbol, "
        "be.inputs_json, be.provenance_json, be.synthetic_data_used, "
        "be.fwd_max_move_pct, be.fwd_vol_spike_x, be.fwd_close_move_pct, "
        "be.days_to_move "
        "FROM backtest_events be "
        "JOIN instruments i ON i.id = be.instrument_id "
        "JOIN tickers t ON t.id = i.ticker_id "
        "WHERE " + " AND ".join(where) + " AND be.data_complete",
        tuple(params),
    )
    pass_fail = spec.get("universe", {}).get("pass_fail")
    events = []
    for r in cur.fetchall():
        in_json = r[4] or {}
        if pass_fail and pass_fail != "either":
            if version_row is None:
                raise HTTPException(422,
                    "a version is required to apply a pass_fail filter")
            p_ok, _f = _evaluate_filters(version_row, in_json)
            if (pass_fail == "pass") != p_ok:
                continue
        events.append({
            "id": r[0], "instrument_id": r[1], "event_date": r[2],
            "symbol": r[3], "inputs": in_json, "provenance": r[5] or {},
            "synthetic": bool(r[6]),
            "fwd_max_move_pct": float(r[7]) if r[7] is not None else 0.0,
            "fwd_vol_spike_x": float(r[8]) if r[8] is not None else 0.0,
            "fwd_close_move_pct": float(r[9]) if r[9] is not None else 0.0,
            "days_to_move": r[10],
        })
    return events


def _dependent_value(event, dep_key, hit_def):
    if dep_key == "hit":
        price = float(hit_def.get("price_move_pct", 20))
        vol = float(hit_def.get("volume_spike_x", 3))
        combine = hit_def.get("combine", "or")
        by_price = event["fwd_max_move_pct"] >= price
        by_vol = event["fwd_vol_spike_x"] >= vol
        return 1 if ((by_price or by_vol) if combine == "or"
                     else (by_price and by_vol)) else 0
    if dep_key == "fwd_close_move_pct":
        return event["fwd_close_move_pct"]
    if dep_key == "days_to_move":
        return event["days_to_move"]
    raise HTTPException(422, "unknown dependent key")


def _scalar(inputs, key):
    if key == "score":
        v = inputs.get("score")
        return float(v) if isinstance(v, (int, float)) else None
    if key == "band":
        v = inputs.get("band")
        return str(v) if v else None
    for h in (inputs.get("hard_filters") or []):
        if h.get("key") == key:
            v = h.get("value")
            return float(v) if isinstance(v, (int, float)) else None
    for c in (inputs.get("components") or []):
        if c.get("k") == key:
            v = c.get("score")
            return float(v) if isinstance(v, (int, float)) else None
    return None


def _transform(values, transform):
    if transform == "rank":
        order = sorted(range(len(values)), key=lambda i: values[i])
        out = [0.0] * len(values)
        for r, i in enumerate(order):
            out[i] = (r + 1) / len(values)
        return out
    if transform == "log":
        positive = [v for v in values if v > 0]
        floor = (min(positive) if positive else 1.0) / 1e9
        return [math.log(max(v, floor)) for v in values]
    if transform == "winsorize 1%":
        vals = sorted(values)
        lo = vals[int(0.01 * len(vals))]
        hi = vals[int(0.99 * len(vals)) - 1]
        return [min(max(v, lo), hi) for v in values]
    return list(values)


def _predictor_names(body):
    names = [(i.transform + "_" + i.key if i.transform != "none" else i.key)
             for i in body.independent]
    return names + list(body.controls)


def _design(body, events):
    """Build X (intercept included), y, clusters and column metadata.
    Rows with a missing predictor value are dropped as complete cases."""
    dep_key = body.dependent.key
    hit_def = body.dependent.hit_definition or {}
    names = _predictor_names(body)

    y = []
    kept = []
    for e in events:
        v = _dependent_value(e, dep_key, hit_def)
        if v is None:
            continue
        y.append(v)
        kept.append(e)

    predictors = []  # (name, kind, per_event_values)
    for name in names:
        base = name
        transform = "none"
        for ind in body.independent:
            if name == ind.key or name == ind.transform + "_" + ind.key:
                base = ind.key
                transform = ind.transform
                break
        per_event = [_scalar(e["inputs"], base) for e in kept]
        if base == "band":
            predictors.append((name, "categorical", per_event))
        elif all(v is None for v in per_event):
            predictors.append((name, "unavailable", per_event))
        else:
            default = _mean([v for v in per_event if v is not None])
            cleaned = [default if v is None else v for v in per_event]
            predictors.append((name, "numeric", _transform(cleaned, transform)))

    ok_rows = []
    for i in range(len(kept)):
        usable = True
        for _name, kind, vals in predictors:
            if kind == "unavailable":
                usable = False
                break
            if kind == "numeric" and vals[i] is None:
                usable = False
                break
        if usable:
            ok_rows.append(i)

    if not ok_rows:
        raise HTTPException(422,
            "no events have values for every selected predictor; "
            "the model cannot be fit")

    levels = sorted({str(vals[i]) for _n, kind, vals in predictors
                     if kind == "categorical" for i in ok_rows})
    ref_level = levels[0] if levels else None

    col_meta = [{"key": "(intercept)", "label": "(intercept)", "kind": "numeric"}]
    X = [[1.0] for _ in ok_rows]
    unavailable = []
    for name, kind, vals in predictors:
        if kind == "unavailable":
            unavailable.append(name)
            continue
        if kind == "categorical":
            for lvl in levels:
                if lvl == ref_level:
                    continue
                col_meta.append({"key": f"{name}={lvl}", "label": f"{name} = {lvl}",
                                 "kind": "categorical"})
                for c, i in enumerate(ok_rows):
                    X[c].append(1.0 if str(vals[i]) == lvl else 0.0)
        else:
            col_meta.append({"key": name, "label": name, "kind": "numeric"})
            for c, i in enumerate(ok_rows):
                X[c].append(vals[i])

    return {
        "X": X,
        "y": [y[i] for i in ok_rows],
        "clusters": [kept[i]["instrument_id"] for i in ok_rows],
        "events": [kept[i] for i in ok_rows],
        "col_meta": col_meta,
        "unavailable": unavailable,
        "raw_n": len(kept),
    }


# --------------------------------------------------------------------------
# Fitting
# --------------------------------------------------------------------------

def _fit(data, dep_key):
    X, y, clusters, col_meta = data["X"], data["y"], data["clusters"], data["col_meta"]
    n = len(y)
    p_full = len(X[0])

    # Standardize numeric predictors (z-scores) so the fit is numerically
    # stable; intercept and categorical dummies stay on the raw scale.
    std_mean = [0.0] * p_full
    std_sd = [1.0] * p_full
    for j in range(p_full):
        if j > 0 and col_meta[j]["kind"] != "categorical":
            sd = math.sqrt(_variance([X[i][j] for i in range(n)]))
            if sd > 1e-12:
                std_mean[j] = _mean([X[i][j] for i in range(n)])
                std_sd[j] = sd
    Xw_full = [[(X[i][j] - std_mean[j]) / std_sd[j] for j in range(p_full)]
               for i in range(n)]

    # Collinearity is judged in the standardized space, where scale
    # differences no longer hide duplicate columns.
    kept = _column_basis(Xw_full)
    all_keys = [c["key"] for c in col_meta]
    dropped_collinear = [all_keys[j] for j in range(p_full) if j not in kept]
    Xr = [[X[i][j] for j in kept] for i in range(n)]
    Xw = [[Xw_full[i][j] for j in kept] for i in range(n)]
    col_meta_fit = [col_meta[j] for j in kept]
    std_mean = [std_mean[j] for j in kept]
    std_sd = [std_sd[j] for j in kept]
    p = len(kept)
    if p > max(n, 1):
        raise HTTPException(422,
            "more predictors than observations; drop a predictor or widen the window")

    if dep_key == "hit":
        n_pos = sum(y)
        if n_pos == 0 or n_pos == n:
            raise HTTPException(422, "the dependent has no variation in this sample")
        beta_s = _logistic_fit(Xw, y)
        mu = [_sigmoid(sum(b * x for b, x in zip(beta_s, Xw[i]))) for i in range(n)]
        ll = _logistic_ll(Xw, y, beta_s)
        pbar = n_pos / n
        ll_null = n * (pbar * math.log(max(pbar, 1e-300))
                       + (1 - pbar) * math.log(max(1 - pbar, 1e-300)))
        wd = [m * (1 - m) for m in mu]
        bread = _inverse([[sum(Xw[i][j] * wd[i] * Xw[i][k] for i in range(n))
                           for k in range(p)] for j in range(p)])
        se_s = _cluster_se(Xw, y, clusters, bread,
                           lambda i: [(y[i] - mu[i]) * Xw[i][j] for j in range(p)])
        metrics = {"pseudo_r2_mcfadden": round(1.0 - ll / ll_null, 4)
                   if ll_null != 0 else None,
                   "auc": round(_auc(mu, y), 4) if _auc(mu, y) is not None else None,
                   "r_squared": None, "adj_r_squared": None,
                   "n_events_positive": n_pos}
        def link(raw_rows):
            return [_sigmoid(sum(b * ((r[j] - std_mean[j]) / std_sd[j])
                                  for j, b in enumerate(beta_s))) for r in raw_rows]
    else:
        beta_s, resid = _ols_fit(Xw, y)
        ss_res = sum(r * r for r in resid)
        ss_tot = sum((v - _mean(y)) ** 2 for v in y)
        r2 = 1.0 - ss_res / ss_tot if ss_tot else None
        adj = 1.0 - (1.0 - r2) * (n - 1) / (n - p) if (r2 is not None and n > p) else None
        bread = _inverse([[sum(Xw[i][j] * Xw[i][k] for i in range(n))
                           for k in range(p)] for j in range(p)])
        se_s = _cluster_se(Xw, y, clusters, bread,
                           lambda i: [resid[i] * Xw[i][j] for j in range(p)])
        metrics = {"pseudo_r2_mcfadden": None, "auc": None,
                   "r_squared": round(r2, 4), "adj_r_squared": round(adj, 4),
                   "n_events_positive": None}
        def link(raw_rows):
            return [sum(b * ((r[j] - std_mean[j]) / std_sd[j])
                        for j, b in enumerate(beta_s)) for r in raw_rows]

    # Map coefficients back to the raw predictor scale for the report.
    beta = [0.0] * p
    se = [0.0] * p
    for j in range(p):
        beta[j] = beta_s[j] / std_sd[j]
        se[j] = se_s[j] / std_sd[j]
    beta[0] = beta_s[0] - sum(beta_s[j] * std_mean[j] / std_sd[j]
                              for j in range(1, p))

    coeffs = []
    primary = None
    for j in range(p):
        bj, sej = beta[j], se[j]
        z = bj / sej if (sej and sej > 0) else None
        pv = _p_from_z(z)
        name = col_meta_fit[j]["key"]
        row = {"key": name, "label": col_meta_fit[j]["label"], "coef": round(bj, 6),
               "se": round(sej, 6) if sej is not None else None,
               "p_value": pv, "p_value_adjusted": None,
               "is_intercept": j == 0}
        if dep_key == "hit" and not row["is_intercept"]:
            row["odds_ratio"] = round(math.exp(bj), 4)
            row["ci95_odds"] = ([round(math.exp(bj - 1.96 * sej), 4),
                                 round(math.exp(bj + 1.96 * sej), 4)]
                                if sej and sej > 0 else None)
        elif dep_key != "hit" and not row["is_intercept"]:
            row["ci95_coef"] = ([round(bj - 1.96 * sej, 6), round(bj + 1.96 * sej, 6)]
                                if sej and sej > 0 else None)
        coeffs.append(row)
        if not row["is_intercept"] and (primary is None or pv < primary["p_value"]):
            primary = row

    residual_sd = None
    if dep_key != "hit":
        mu_hat = link(Xr)
        residual_sd = round(math.sqrt(_variance([y[i] - mu_hat[i] for i in range(n)])), 4)

    vifs = [1.0] * p
    try:
        vifs = _vifs(Xw)
    except ValueError:
        pass

    return {"coeffs": coeffs, "primary": primary, "beta": beta,
            "predict": link, "metrics": metrics,
            "n": n, "residual_sd": residual_sd,
            "keep_cols": kept, "dropped_collinear": dropped_collinear,
            "vifs": vifs}


def _holdout_result(body, data, dep_key):
    if not body.holdout or not body.holdout.train_to:
        return None
    split_date = body.holdout.train_to
    mask = [e["event_date"].isoformat() <= split_date for e in data["events"]]
    train_i = [i for i, m in enumerate(mask) if m]
    test_i = [i for i, m in enumerate(mask) if not m]
    if not train_i or len(test_i) < 10:
        return {"mode": "time", "train_to": split_date,
                "n_train": len(train_i), "n_test": len(test_i),
                "verdict": "no_test_period"}
    train = {"X": [data["X"][i] for i in train_i],
             "y": [data["y"][i] for i in train_i],
             "clusters": [data["clusters"][i] for i in train_i],
             "events": [data["events"][i] for i in train_i],
             "col_meta": data["col_meta"], "raw_n": data["raw_n"]}
    ftrain = _fit(train, dep_key)
    if dep_key == "hit":
        tr_metric = ftrain["metrics"]["auc"]
        te_X = [[data["X"][i][j] for j in ftrain["keep_cols"]] for i in test_i]
        te_probs = ftrain["predict"](te_X)
        te_metric = _auc(te_probs, [data["y"][i] for i in test_i])
        metric_name = "auc"
    else:
        tr_metric = ftrain["metrics"]["r_squared"]
        te_X = [[data["X"][i][j] for j in ftrain["keep_cols"]] for i in test_i]
        te_pred = ftrain["predict"](te_X)
        te_y = [data["y"][i] for i in test_i]
        ss_res = sum((te_y[i] - te_pred[i]) ** 2 for i in range(len(te_y)))
        ss_tot = sum((v - _mean(te_y)) ** 2 for v in te_y)
        te_metric = 1.0 - ss_res / ss_tot if ss_tot else None
        metric_name = "r_squared"
    if tr_metric is None or te_metric is None:
        return {"mode": "time", "train_to": split_date,
                "n_train": len(train_i), "n_test": len(test_i),
                "verdict": "no_test_period"}
    passed = abs(te_metric - tr_metric) <= HOLDOUT_TOLERANCE
    return {"mode": "time", "train_to": split_date, "metric": metric_name,
            "n_train": len(train_i), "n_test": len(test_i),
            "in_sample": round(tr_metric, 3),
            "out_of_sample": round(te_metric, 3),
            "verdict": "generalized" if passed else "did_not_generalize"}


# --------------------------------------------------------------------------
# Result assembly
# --------------------------------------------------------------------------

def _reading(full, dep_key, n):
    primary = full["primary"]
    if primary is None:
        return "No non-intercept coefficient could be estimated."
    if dep_key == "hit":
        orr = primary.get("odds_ratio")
        pct = ((orr or 1.0) - 1.0) * 100
        return (f"Each 1-point rise in {primary['key']} is associated with about "
                f"{round(abs(pct), 1)}% "
                f"{'higher' if pct >= 0 else 'lower'} odds of a big move "
                f"(odds ratio {orr}, 95% CI {primary['ci95_odds'][0]} to "
                f"{primary['ci95_odds'][1]}) over {n} events.")
    return (f"Over {n} events, each 1-point rise in {primary['key']} is associated "
            f"with about {round(primary['coef'], 3)} points of "
            "the outcome (95% CI "
            f"{primary['ci95_coef'][0]} to {primary['ci95_coef'][1]}).")


def _verdict(full, holdout, warnings, dep_key, body):
    if any(w["severity"] == "block" for w in warnings):
        return {"state": "blocked", "text": "Not enough data to read this result."}
    primary = full["primary"]
    sig = primary is not None and primary["p_value_adjusted"] < 0.05
    if not sig:
        return {"state": "no_signal",
                "text": "No relationship found. This is a real result; record it."}
    if holdout is None or holdout.get("verdict") != "generalized":
        return {"state": "suggestive",
                "text": ("Possible relationship, not confirmed. Worth another "
                         "test on different data.")}
    if body.expected_direction:
        sign = 1 if primary["coef"] >= 0 else -1
        wanted = 1 if body.expected_direction == "positive" else -1
        if sign != wanted:
            return {"state": "contradicted",
                    "text": ("This result points the opposite way from the "
                             "hypothesis.")}
    return {"state": "held_up", "text": "Held up out of sample."}


def _build_result(body, spec, data, full, holdout, fam, events_max_id):
    dep_key = body.dependent.key
    n = full["n"]
    p_model = len(full["coeffs"]) - 1
    warnings = []

    if dep_key == "hit":
        epv = (full["metrics"]["n_events_positive"] / p_model) if p_model else None
    else:
        epv = (n / p_model) if p_model else None
    if epv is not None and epv < EPV_BLOCK:
        warnings.append({
            "code": "EPV_BLOCK", "severity": "block",
            "text": (f"{n} observations, {full['metrics']['n_events_positive'] or n} "
                     f"{'positive' if dep_key == 'hit' else ''} events, {p_model} "
                     f"predictors: {round(epv, 1)} events per predictor. Below the "
                     f"{EPV_BLOCK} this tool treats as a hard floor; coefficients "
                     "are hidden behind Show anyway.")})
    elif epv is not None and epv < EPV_WARN:
        warnings.append({
            "code": "EPV_LOW", "severity": "warn",
            "text": (f"{round(epv, 1)} events per predictor is below the {EPV_WARN} "
                     "this tool requires. Drop a predictor or widen the window "
                     "before reading the coefficients.")})

    events = data["events"]
    distinct = len({e["instrument_id"] for e in events})
    if distinct < MIN_INSTRUMENTS:
        warnings.append({
            "code": "FEW_INSTRUMENTS", "severity": "warn",
            "text": (f"{distinct} distinct instruments, below the "
                     f"{MIN_INSTRUMENTS} needed to generalise.")})
    sym_count = Counter(e["symbol"] for e in events)
    if sym_count:
        top_sym, top_n = sym_count.most_common(1)[0]
        share = top_n / len(events)
        if share > 0.40:
            warnings.append({
                "code": "SINGLE_INSTRUMENT_SHARE", "severity": "warn",
                "text": (f"{top_sym} is {round(share*100,1)}% of the events in this "
                         "sample; one ticker should not carry a result.")})

    if holdout and holdout.get("verdict") == "did_not_generalize":
        warnings.append({
            "code": "HOLDOUT_FAILED", "severity": "warn",
            "text": (f"The {holdout['metric']} fell from {holdout['in_sample']} "
                     f"in-sample to {holdout['out_of_sample']} out-of-sample. "
                     "The in-sample fit is not evidence.")})
    for name in data["unavailable"]:
        warnings.append({
            "code": "FIELD_UNAVAILABLE", "severity": "warn",
            "text": (f"{name} has no values in the event store on this sample and was "
                     "dropped. (Sandbox fixtures record score, band and hard-filter "
                     "values only.)")})

    if body.expected_direction and body.expected_direction not in ("positive", "negative"):
        warnings.append({"code": "BAD_DIRECTION", "severity": "warn",
                         "text": "expected_direction must be positive or negative; ignored."})

    if fam["tests_in_family"] >= 5 and not fam["split"]:
        warnings.append({"code": "FAMILY_SIZE", "severity": "warn",
                         "text": _FAMILY_FRICTION_5})
    if fam["split"]:
        warnings.append({
            "code": "FAMILY_SPLIT", "severity": "warn",
            "text": (f"This new family matches an existing line of inquiry on "
                     "dependent variable and universe within the last 30 days. "
                     f"Counting {fam['combined_total']} tests across both names.")})

    comparison = {
        "family_key": fam["family_key"],
        "tests_in_family": fam["tests_in_family"],
        "combined_total": fam["combined_total"],
        "adjustment": "holm",
        "family_split": fam["split"],
        "primary_p_value": full["primary"]["p_value"] if full["primary"] else None,
        "first_test_at": fam["first_test_at"].isoformat() if fam["first_test_at"] else None,
    }

    # Holm adjustment: adjusted first, heavier weight in the UI.
    for c in full["coeffs"]:
        if c["is_intercept"]:
            c["p_value_adjusted"] = None
        else:
            c["p_value_adjusted"] = holm_adjust(c["p_value"], fam["prior_p"])

    model = "logistic" if dep_key == "hit" else "ols"
    synthetic = any(e["synthetic"] for e in events)
    sources = sorted({e["provenance"].get("source") for e in events
                      if e["provenance"].get("source")})

    for name in full["dropped_collinear"]:
        warnings.append({
            "code": "COLLINEAR_PREDICTOR", "severity": "warn",
            "text": (f"{name} is constant or colinear with another predictor on "
                     "this sample and was dropped from the fit.")})

    p_total = len(full["coeffs"])

    if fam["tests_in_family"]:
        m = fam["tests_in_family"]
        adjusted_threshold = round(0.05 / m, 4)
    if fam["tests_in_family"] >= 10:
        warnings.append({
            "code": "FAMILY_FRICTION_10", "severity": "warn",
            "text": ("You have run {} tests in this line of inquiry. `Record as "
                     "finding` now requires you to tick: I understand this is test "
                     "{} in this family and the adjusted threshold is p < {}."
                     .format(fam["tests_in_family"], fam["tests_in_family"],
                             adjusted_threshold))})

    verdict = _verdict(full, holdout, warnings, dep_key, body)
    metrics = dict(full["metrics"])
    if p_model:
        numerator = metrics["n_events_positive"] if dep_key == "hit" else n
        events_per_predictor = round(numerator / p_model, 1)
    else:
        events_per_predictor = None
    return {
        "model": model,
        "model_reason": ("chosen because the outcome is yes/no"
                         if dep_key == "hit" else "chosen because the outcome is continuous"),
        "n": n, "n_events_positive": metrics["n_events_positive"],
        "events_per_predictor": events_per_predictor,
        "pseudo_r2_mcfadden": metrics["pseudo_r2_mcfadden"],
        "auc": metrics["auc"],
        "r_squared": metrics["r_squared"],
        "adj_r_squared": metrics["adj_r_squared"],
        "residual_sd": full["residual_sd"],
        "coefficients": [c for c in full["coeffs"]],
        "reading": _reading(full, dep_key, n),
        "banner": verdict,
        "holdout": holdout,
        "diagnostics": {
            "max_vif": round(max(full["vifs"]), 2) if full["vifs"] else None,
            "vifs": [round(v, 2) for v in full["vifs"]] or None,
            "clustered_se_by": "instrument_id",
            "n_clusters": len({e["instrument_id"] for e in events}),
            "complete_case_dropped": data["raw_n"] - n,
            "distinct_instruments": distinct,
            "unavailable_predictors": data["unavailable"],
            "columns": p_total,
        },
        "comparisons_context": comparison,
        "version_number": body.version_number,
        "warnings": warnings,
        "provenance": {
            "events_total": data["raw_n"],
            "events_dropped_for_missing": data["raw_n"] - n,
            "synthetic_data_used": synthetic,
            "sources": sources,
            "footer": COMPARISON_FOOTER,
        },
        "synthetic_banner": _SYNTHETIC_BANNER if synthetic else None,
    }


# --------------------------------------------------------------------------
# Endpoint
# --------------------------------------------------------------------------

@router.post("/api/admin/lab/regression", dependencies=[Depends(_no_cache)])
def lab_regression(body: RegressionIn,
                   creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    hypothesis = body.hypothesis.strip()
    if len(hypothesis) < HYPOTHESIS_MIN:
        raise HTTPException(422,
            "declare the hypothesis first; written first it is a test, written "
            f"after it is a description ({HYPOTHESIS_MIN}+ characters)")
    if not body.independent and not body.controls:
        raise HTTPException(422, "select at least one independent variable")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM strategies WHERE key = %s", (body.strategy_key,))
            srow = cur.fetchone()
            if not srow:
                _admin_404()
            strategy_id = srow[0]
            version_row = None
            if body.version_number:
                version_row = _version_row(cur, strategy_id, body.version_number)
                if not version_row:
                    _admin_404()
            spec = _normalize_spec(body)
            spec_hash = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
            cur.execute("SELECT COALESCE(MAX(id), 0) FROM backtest_events")
            events_max_id = cur.fetchone()[0]
            cur.execute(
                "SELECT id, result_json FROM lab_queries "
                "WHERE spec_hash = %s AND status = 'completed' ORDER BY id DESC LIMIT 1",
                (spec_hash,))
            cached = cur.fetchone()
            fresh = cached is None or not cached[1] \
                or cached[1].get("events_max_id") != events_max_id
            cur.execute(
                "INSERT INTO lab_queries (admin_user_id, strategy_id, strategy_version_id, "
                " query_type, spec_json, spec_hash, hypothesis, family_key, status) "
                "VALUES (%s, %s, %s, 'regression', %s, %s, %s, %s, 'running') RETURNING id",
                (admin_id, strategy_id, version_row[0] if version_row else None,
                 json.dumps(spec), spec_hash, hypothesis, body.family_key))
            query_id = cur.fetchone()[0]
            if fresh:
                events = _load_events(cur, spec, version_row)
                if not events:
                    raise HTTPException(422,
                        "no events match the selected universe and window")
                data = _design(body, events)
                dep_key = body.dependent.key
                full = _fit(data, dep_key)
                holdout = _holdout_result(body, data, dep_key)
                fam = _family_context(cur, strategy_id, spec)
                result = _build_result(body, spec, data, full, holdout, fam,
                                       events_max_id)
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