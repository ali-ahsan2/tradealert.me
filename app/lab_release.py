"""The Lab release workflow and per-version metrics.

Implements STRATEGY_ANALYSIS_TOOL.md section 10: the draft -> tested ->
shadow -> live/retired lifecycle, the locked holdout, publishing pause,
the audit journal, and the per-version metrics engine (section 10.5) that
feeds the Performance and version-page answers.

Every route requires an admin session and answers Cache-Control: no-store
and X-Robots-Tag: noindex. Anonymous and non-admin requests get the same
uniform 404 as the rest of the Lab (see app/lab.py).
"""
import json
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.context import user_from_creds, user_id, user_is_admin
from app.db import get_conn

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

MIN_REASON = 40
DEFAULT_TRIAL_DAYS = 60
PROVISIONAL_OUTCOMES = 30
SHADOW_MIN_RESULTS = 10


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


def _strategy(cur, key):
    cur.execute(
        "SELECT id, key, label, calibrated, live_version_id, publishing_paused, "
        "publishing_paused_at, publishing_paused_reason, resolved_outcomes_count "
        "FROM strategies WHERE key = %s",
        (key,),
    )
    row = cur.fetchone()
    if not row:
        _admin_404()
    return {
        "id": row[0], "key": row[1], "label": row[2], "calibrated": bool(row[3]),
        "live_version_id": row[4], "publishing_paused": bool(row[5]),
        "publishing_paused_at": row[6].isoformat() if row[6] else None,
        "publishing_paused_reason": row[7] or "",
        "resolved_outcomes_count": row[8],
    }


def _strategy_id(cur, key):
    cur.execute("SELECT id FROM strategies WHERE key = %s", (key,))
    row = cur.fetchone()
    if not row:
        _admin_404()
    return row[0]


def _version(cur, strategy_id, version_number):
    cur.execute(
        "SELECT id, version_number, band_cutoffs_json, component_weights_json, "
        "hard_filters_json, hit_definition_json, effective_from, effective_to, "
        "created_by_admin_id, change_reason, state, shadow_started_at, "
        "shadow_ends_at, promoted_early, live_outcomes_count, holdout_cutoff, "
        "holdout_check_json FROM strategy_versions "
        "WHERE strategy_id = %s AND version_number = %s ORDER BY id DESC LIMIT 1",
        (strategy_id, version_number),
    )
    return cur.fetchone()


def _latest(cur, strategy_id):
    cur.execute(
        "SELECT id, version_number FROM strategy_versions "
        "WHERE strategy_id = %s ORDER BY version_number DESC LIMIT 1",
        (strategy_id,),
    )
    return cur.fetchone()


def _live_version(cur, strategy_id):
    cur.execute(
        "SELECT sv.id, sv.version_number FROM strategies s "
        "JOIN strategy_versions sv ON sv.id = s.live_version_id "
        "WHERE s.id = %s",
        (strategy_id,),
    )
    return cur.fetchone()


def _serialize_version(row):
    return {
        "id": row[0], "version_number": row[1],
        "band_cutoffs": row[2], "component_weights": row[3],
        "hard_filters": row[4], "hit_definition": row[5],
        "effective_from": row[6].isoformat() if row[6] else None,
        "effective_to": row[7].isoformat() if row[7] else None,
        "created_by_admin_id": row[8], "change_reason": row[9],
        "state": row[10],
        "shadow_started_at": row[11].isoformat() if row[11] else None,
        "shadow_ends_at": row[12].isoformat() if row[12] else None,
        "promoted_early": bool(row[13]),
        "live_outcomes_count": row[14],
        "holdout_cutoff": row[15].isoformat() if row[15] else None,
        "holdout_check": row[16],
    }


def _audit(cur, strategy_id, admin_user_id, event_type, reason="",
           version_id=None, evidence_query_ids=None, meta=None):
    cur.execute(
        "INSERT INTO calibration_events "
        "(strategy_id, event_type, resolved_outcomes_at_event, admin_user_id, "
        "previous_cutoffs_json, new_cutoffs_json, created_at, version_id, "
        "reason, evidence_query_ids, meta_json) "
        "VALUES (%s, %s, 0, %s, NULL, NULL, now(), %s, %s, %s, %s)",
        (strategy_id, event_type, admin_user_id, version_id, reason,
         json.dumps(evidence_query_ids or []),
         json.dumps(meta or {})),
    )


def _evaluate_filters(hard_filters, inputs_json):
    """Pass/fail against a version's hard filters on the event's raw inputs.
    Mirrors app.lab._evaluate_filters for the metrics engine."""
    if not hard_filters:
        return True, None
    for rule in hard_filters:
        key = rule["key"]
        raw = None
        ok = False
        for h in (inputs_json.get("hard_filters") or []):
            if h.get("key") == key:
                raw = h.get("value")
                ok = bool(h.get("pass"))
                break
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


def _hit(event, hit_def):
    price = hit_def.get("price_move_pct", 20.0)
    vol = hit_def.get("volume_spike_x", 3.0)
    combine = hit_def.get("combine", "or")
    try:
        max_move = float(event["fwd_max_move_pct"] or 0)
    except (TypeError, ValueError):
        max_move = 0.0
    try:
        vol_x = float(event["fwd_vol_spike_x"] or 0)
    except (TypeError, ValueError):
        vol_x = 0.0
    by_price = max_move >= price
    by_vol = vol_x >= vol
    if combine == "or":
        return bool(by_price or by_vol)
    return bool(by_price and by_vol)


def _wilson(k, n):
    if n <= 0:
        return None
    z = 1.96
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return [round(max(0.0, centre - half), 3), round(min(1.0, centre + half), 3)]


def _two_prop_p(p1, n1, p2, n2):
    if n1 <= 0 or n2 <= 0:
        return 1.0
    p_hat = (p1 * n1 + p2 * n2) / (n1 + n2)
    se = math.sqrt(max(p_hat * (1 - p_hat), 0.0) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    z = abs(p1 - p2) / se
    return round(2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2)))), 6)


def _phrasing(rate, ci):
    if rate is None:
        return "no rate yet"
    return f"{round(rate*100,1)}% (likely {round(ci[0]*100,1)} to {round(ci[1]*100,1)}%)"


# --------------------------------------------------------------------------
# Drafting
# --------------------------------------------------------------------------

class DraftCreateIn(BaseModel):
    copy_version_number: int | None = None
    change_reason: str = Field(min_length=1, max_length=500)


@router.post("/api/admin/lab/strategies/{key}/drafts",
             dependencies=[Depends(_no_cache)])
def lab_draft_create(key: str, body: DraftCreateIn,
                     creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            latest = _latest(cur, sid)
            next_num = (latest[1] + 1) if latest else 1
            if body.copy_version_number:
                src = _version(cur, sid, body.copy_version_number)
                if not src:
                    _admin_404()
            else:
                live = _live_version(cur, sid)
                if live:
                    src = _version(cur, sid, live[1])
                else:
                    src = _version(cur, sid, next_num - 1) if latest else None
            if not src:
                raise HTTPException(400, "no source version to copy; pass copy_version_number")
            cur.execute(
                "INSERT INTO strategy_versions (strategy_id, version_number, "
                " band_cutoffs_json, component_weights_json, hard_filters_json, "
                " hit_definition_json, effective_from, effective_to, "
                " created_by_admin_id, change_reason, state) "
                "VALUES (%s, %s, %s, %s, %s, %s, now(), NULL, %s, %s, 'draft') "
                "RETURNING id",
                (sid, next_num, json.dumps(src[2]), json.dumps(src[3]),
                 json.dumps(src[4]), json.dumps(src[5] or {
                     "price_move_pct": 20, "volume_spike_x": 3,
                     "combine": "or", "window": "tight"}),
                 admin_id, body.change_reason),
            )
            new_id = cur.fetchone()[0]
            _audit(cur, sid, admin_id, "draft_created",
                   reason=body.change_reason, version_id=new_id)
            row = _version(cur, sid, next_num)
        conn.commit()
        return {"version": _serialize_version(row)}
    finally:
        conn.close()


class DraftPatchIn(BaseModel):
    band_cutoffs: dict | None = None
    component_weights: dict | None = None
    hard_filters: list | None = None
    hit_definition: dict | None = None
    change_reason: str | None = Field(default=None, max_length=500)


@router.patch("/api/admin/lab/strategies/{key}/versions/{v}/draft",
              dependencies=[Depends(_no_cache)])
def lab_draft_patch(key: str, v: int, body: DraftPatchIn,
                    creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] != "draft":
                raise HTTPException(409, "only a draft can change its settings")
            fields, params = [], []
            if body.band_cutoffs is not None:
                fields.append("band_cutoffs_json = %s")
                params.append(json.dumps(body.band_cutoffs))
            if body.component_weights is not None:
                fields.append("component_weights_json = %s")
                params.append(json.dumps(body.component_weights))
            if body.hard_filters is not None:
                fields.append("hard_filters_json = %s")
                params.append(json.dumps(body.hard_filters))
            if body.hit_definition is not None:
                fields.append("hit_definition_json = %s")
                params.append(json.dumps(body.hit_definition))
            if body.change_reason is not None:
                fields.append("change_reason = %s")
                params.append(body.change_reason)
            if fields:
                params.append(row[0])
                cur.execute(
                    "UPDATE strategy_versions SET " + ", ".join(fields) +
                    " WHERE id = %s", tuple(params))
                _audit(cur, sid, admin_id, "draft_edited", version_id=row[0],
                       reason=body.change_reason or "settings changed",
                       meta={"edits": fields})
            after = _version(cur, sid, v)
        conn.commit()
        return {"version": _serialize_version(after)}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Freeze (draft -> tested)
# --------------------------------------------------------------------------

@router.post("/api/admin/lab/strategies/{key}/versions/{v}/freeze",
             dependencies=[Depends(_no_cache)])
def lab_draft_freeze(key: str, v: int,
                     creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] != "draft":
                raise HTTPException(409, f"version is {row[10]}, not draft")
            cur.execute(
                "UPDATE strategy_versions SET state = 'tested' WHERE id = %s",
                (row[0],))
            _audit(cur, sid, admin_id, "draft_frozen", version_id=row[0],
                   reason=row[9] or "draft frozen")
            after = _version(cur, sid, v)
        conn.commit()
        return {"version": _serialize_version(after)}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Locked holdout + taking a tested version to shadow
# --------------------------------------------------------------------------

@router.post("/api/admin/lab/strategies/{key}/versions/{v}/holdout-check",
             dependencies=[Depends(_no_cache)])
def lab_holdout_check(key: str, v: int,
                      creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] not in ("tested", "shadow"):
                raise HTTPException(409, "holdout check runs on a frozen (tested) version")
            live = _live_version(cur, sid)
            if not live or live[0] == row[0]:
                raise HTTPException(409, "there is no live version to compare against")
            if row[15] and row[16]:
                existing = dict(row[16])
                existing["reused"] = True
                return {"version": v, "holdout": existing}

            hit_def = row[5] or {"price_move_pct": 20, "volume_spike_x": 3,
                                 "combine": "or", "window": "tight"}
            # The newest 25% of complete earnings events, locked by date. The
            # cutoff is stored with the result so a repeat cites the same set.
            # Precise: take the newest 25% of distinct event dates as the holdout.
            cur.execute(
                "SELECT COUNT(DISTINCT event_date) FROM backtest_events "
                "WHERE data_complete AND event_kind = 'earnings'")
            n_days = cur.fetchone()[0]
            n_hold = max(1, round(n_days * 0.25))
            cur.execute(
                "SELECT DISTINCT event_date FROM backtest_events "
                "WHERE data_complete AND event_kind = 'earnings' ORDER BY event_date DESC "
                "LIMIT %s", (n_hold,))
            hold_dates = [r[0] for r in cur.fetchall()]
            cutoff = min(hold_dates)
            cur.execute(
                "SELECT be.id, be.instrument_id, be.event_date, t.symbol, "
                "be.fwd_max_move_pct, be.fwd_close_move_pct, be.fwd_vol_spike_x, "
                "be.days_to_move, be.inputs_json, be.provenance_json, "
                "be.synthetic_data_used "
                "FROM backtest_events be "
                "JOIN instruments i ON i.id = be.instrument_id "
                "JOIN tickers t ON t.id = i.ticker_id "
                "WHERE be.data_complete AND be.event_kind = 'earnings' "
                "AND be.event_date IN (SELECT unnest(%s::date[])) "
                "ORDER BY be.event_date, be.id",
                (hold_dates,))
            rows = cur.fetchall()
            events, count = [], {}
            for r in rows:
                events.append(r)
            events.sort(key=lambda r: r[2])
            live_row = _version(cur, sid, live[1])
            cand_hf = (row[4] or [])
            live_hf = (live_row[4] or []) if live_row else []
            results = {"candidate": {"n": 0, "hits": 0},
                       "live": {"n": 0, "hits": 0}}
            for r in events:
                in_json = r[8] or {}
                cand_pass = _evaluate_filters(cand_hf, in_json)[0]
                live_pass = _evaluate_filters(live_hf, in_json)[0]
                ev = {"fwd_max_move_pct": r[4], "fwd_close_move_pct": r[5],
                      "fwd_vol_spike_x": r[6]}
                if cand_pass:
                    results["candidate"]["n"] += 1
                    results["candidate"]["hits"] += 1 if _hit(ev, hit_def) else 0
                if live_pass:
                    results["live"]["n"] += 1
                    results["live"]["hits"] += 1 if _hit(ev, hit_def) else 0
            cand = results["candidate"]
            live_ = results["live"]
            cand_rate = (cand["hits"] / cand["n"]) if cand["n"] else None
            live_rate = (live_["hits"] / live_["n"]) if live_["n"] else None
            cand_ci = _wilson(cand["hits"], cand["n"]) if cand["n"] else None
            live_ci = _wilson(live_["hits"], live_["n"]) if live_["n"] else None
            if cand["n"] >= 30 and live_["n"] >= 10:
                p_worse = _two_prop_p(live_rate, live_["n"], cand_rate, cand["n"])
                if cand_rate is not None and live_rate is not None \
                        and cand_rate < live_rate and p_worse < 0.05:
                    gate = "worse"
                else:
                    gate = "ok"
            elif cand["n"] >= 10:
                gate = "small_sample"
            else:
                gate = "too_few_to_judge"
            cand_text = _phrasing(cand_rate, cand_ci)
            live_text = _phrasing(live_rate, live_ci)
            if gate == "worse":
                verdict_text = (f"v{v} did worse on the held-out events: "
                                f"{cand_text} versus live v{live[1]} at {live_text}. "
                                "The trial is not justified.")
            elif gate == "ok":
                verdict_text = (f"v{v} was not shown to be worse than live v{live[1]} "
                                f"on the held-out events: {cand_text} versus {live_text}.")
            else:
                verdict_text = (f"Too few held-out cases to judge v{v} against "
                                f"live v{live[1]} yet ({cand['n']} passed). Shadow mode "
                                "is the way to get an answer.")
            result = {
                "holdout_dates": [d.isoformat() for d in hold_dates],
                "cutoff": cutoff.isoformat(),
                "n_events_held_back": len(events),
                "candidate_version": v,
                "live_version": live[1],
                "candidate": {"n": cand["n"], "hits": cand["hits"],
                              "hit_rate": round(cand_rate, 3) if cand_rate is not None else None,
                              "ci95": cand_ci},
                "live": {"n": live_["n"], "hits": live_["hits"],
                         "hit_rate": round(live_rate, 3) if live_rate is not None else None,
                         "ci95": live_ci},
                "gate": gate,
                "verdict_text": verdict_text,
            }
            cur.execute(
                "UPDATE strategy_versions SET holdout_cutoff = %s, holdout_check_json = %s "
                "WHERE id = %s",
                (cutoff, json.dumps(result), row[0]))
            _audit(cur, sid, admin_id, "holdout_checked", version_id=row[0],
                   reason=verdict_text, meta=result)
        conn.commit()
        return {"version": v, "holdout": result}
    finally:
        conn.close()


class TrialStartIn(BaseModel):
    evidence_query_ids: list[int] | None = None


@router.post("/api/admin/lab/strategies/{key}/versions/{v}/start-trial",
             dependencies=[Depends(_no_cache)])
def lab_trial_start(key: str, v: int, body: TrialStartIn,
                    creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] != "tested":
                raise HTTPException(409, f"version is {row[10]}, not tested")
            if not row[16]:
                raise HTTPException(409, "run the holdout check before starting a trial")
            if (row[16] or {}).get("gate") == "worse":
                raise HTTPException(409,
                    "the holdout check showed the candidate worse than live; "
                    "this trial is not justified")
            start = datetime.now(timezone.utc)
            end = start + timedelta(days=DEFAULT_TRIAL_DAYS)
            cur.execute(
                "UPDATE strategy_versions SET state = 'shadow', "
                "shadow_started_at = %s, shadow_ends_at = %s WHERE id = %s",
                (start, end, row[0]))
            _audit(cur, sid, admin_id, "shadow_started", version_id=row[0],
                   reason="holdout check did not show the candidate worse",
                   evidence_query_ids=body.evidence_query_ids)
            after = _version(cur, sid, v)
        conn.commit()
        return {"version": _serialize_version(after)}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Promotion + rollout
# --------------------------------------------------------------------------

class PromoteIn(BaseModel):
    reason: str = Field(min_length=0, max_length=2000)
    confirm: bool = False
    evidence_query_ids: list[int] | None = None


def _promote_version(cur, sid, admin_id, target_row, reason, evidence):
    """Moves the live pointer to target_row; previous live becomes retired."""
    live = _live_version(cur, sid)
    now = datetime.now(timezone.utc)
    early = False
    if target_row[10] == "shadow":
        if target_row[12] and now < target_row[12]:
            early = True
            if len(reason.strip()) < MIN_REASON:
                raise HTTPException(409,
                    f"promoting before day {DEFAULT_TRIAL_DAYS} needs a written reason "
                    f"of at least {MIN_REASON} characters")
    if live and live[0] != target_row[0]:
        cur.execute(
            "UPDATE strategy_versions SET state = 'retired', effective_to = %s "
            "WHERE id = %s", (now, live[0]))
        _audit(cur, sid, admin_id, "retired", version_id=live[0],
               reason="superseded by v%d" % target_row[1])
    cur.execute(
        "UPDATE strategy_versions SET state = 'live', effective_to = NULL, "
        "promoted_early = %s WHERE id = %s", (early, target_row[0]))
    cur.execute("UPDATE strategies SET live_version_id = %s WHERE id = %s",
                (target_row[0], sid))
    _audit(cur, sid, admin_id,
           "promoted_early" if early else "promoted",
           version_id=target_row[0], reason=reason or "promoted",
           evidence_query_ids=evidence or [])


@router.post("/api/admin/lab/strategies/{key}/versions/{v}/promote",
             dependencies=[Depends(_no_cache)])
def lab_promote(key: str, v: int, body: PromoteIn,
                creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] != "shadow":
                raise HTTPException(409, f"version is {row[10]}, not on trial")
            if not body.confirm:
                raise HTTPException(409, "confirm the promotion dialog")
            _promote_version(cur, sid, admin_id, row, body.reason,
                             body.evidence_query_ids)
            after = _version(cur, sid, v)
        conn.commit()
        return {"version": _serialize_version(after)}
    finally:
        conn.close()


@router.post("/api/admin/lab/strategies/{key}/versions/{v}/rollback",
             dependencies=[Depends(_no_cache)])
def lab_rollback(key: str, v: int, body: PromoteIn,
                 creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] != "retired":
                raise HTTPException(409, "only a retired version can be restored")
            if not body.confirm:
                raise HTTPException(409, "confirm the rollback dialog")
            if len(body.reason.strip()) < MIN_REASON:
                raise HTTPException(409,
                    f"rolling back needs a written reason of at least {MIN_REASON} characters")
            _promote_version(cur, sid, admin_id, row, body.reason,
                             body.evidence_query_ids)
            _audit(cur, sid, admin_id, "rolled_back", version_id=row[0],
                   reason=body.reason, evidence_query_ids=body.evidence_query_ids or [])
            after = _version(cur, sid, v)
        conn.commit()
        return {"version": _serialize_version(after)}
    finally:
        conn.close()


@router.post("/api/admin/lab/strategies/{key}/versions/{v}/end-trial",
             dependencies=[Depends(_no_cache)])
def lab_end_trial(key: str, v: int,
                  creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] != "shadow":
                raise HTTPException(409, f"version is {row[10]}, not on trial")
            cur.execute(
                "UPDATE strategy_versions SET state = 'tested' WHERE id = %s",
                (row[0],))
            _audit(cur, sid, admin_id, "shadow_ended", version_id=row[0],
                   reason="trial ended; version returned to frozen")
            after = _version(cur, sid, v)
        conn.commit()
        return {"version": _serialize_version(after)}
    finally:
        conn.close()


@router.post("/api/admin/lab/strategies/{key}/versions/{v}/discard",
             dependencies=[Depends(_no_cache)])
def lab_discard(key: str, v: int,
                creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            row = _version(cur, sid, v)
            if not row:
                _admin_404()
            if row[10] != "draft":
                raise HTTPException(409, "only a draft can be discarded")
            cur.execute(
                "UPDATE strategy_versions SET state = 'retired', effective_to = %s "
                "WHERE id = %s AND state = 'draft'", (datetime.now(timezone.utc), row[0]))
            _audit(cur, sid, admin_id, "draft_discarded", version_id=row[0],
                   reason=row[9] or "draft discarded")
            after = _version(cur, sid, v)
        conn.commit()
        return {"version": _serialize_version(after)}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Publishing pause/resume
# --------------------------------------------------------------------------

class PauseIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/api/admin/lab/strategies/{key}/pause",
             dependencies=[Depends(_no_cache)])
def lab_pause(key: str, body: PauseIn,
              creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            if _strategy(cur, key)["publishing_paused"]:
                raise HTTPException(409, "already paused")
            cur.execute(
                "UPDATE strategies SET publishing_paused = TRUE, "
                "publishing_paused_at = now(), publishing_paused_reason = %s "
                "WHERE id = %s", (body.reason, sid))
            _audit(cur, sid, admin_id, "paused", reason=body.reason)
        conn.commit()
        return {"key": key, "publishing_paused": True}
    finally:
        conn.close()


@router.post("/api/admin/lab/strategies/{key}/resume",
             dependencies=[Depends(_no_cache)])
def lab_resume(key: str,
               creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            if not _strategy(cur, key)["publishing_paused"]:
                raise HTTPException(409, "not paused")
            cur.execute(
                "UPDATE strategies SET publishing_paused = FALSE, "
                "publishing_paused_at = NULL, publishing_paused_reason = '' "
                "WHERE id = %s", (sid,))
            _audit(cur, sid, admin_id, "resumed", reason="publishing resumed")
        conn.commit()
        return {"key": key, "publishing_paused": False}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Audit log
# --------------------------------------------------------------------------

@router.get("/api/admin/lab/strategies/{key}/audit",
            dependencies=[Depends(_no_cache)])
def lab_audit(key: str,
              creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            cur.execute(
                "SELECT ce.event_type, ce.created_at, ce.reason, u.email, "
                "ce.resolved_outcomes_at_event, ce.version_id, ce.evidence_query_ids, "
                "ce.meta_json "
                "FROM calibration_events ce JOIN users u ON u.id = ce.admin_user_id "
                "WHERE ce.strategy_id = %s ORDER BY ce.created_at DESC",
                (sid,))
            return {"strategy": key, "events": [
                {"event_type": r[0], "created_at": r[1].isoformat(),
                 "reason": r[2], "by": r[3],
                 "resolved_outcomes_at_event": r[4], "version_id": r[5],
                 "evidence_query_ids": r[6] or [], "meta": r[7] or {}}
                for r in cur.fetchall()]}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Per-version metrics / Performance
# --------------------------------------------------------------------------

def _metrics(cur, version_row):
    """The metrics engine shared by the Performance screen and every version
    page. version_row is the raw strategy_versions row."""
    state = version_row[10]
    hit_def = version_row[5] or {"price_move_pct": 20, "volume_spike_x": 3,
                                 "combine": "or", "window": "tight"}
    hf = version_row[4] or []

    cur.execute(
        "SELECT be.id, be.instrument_id, be.event_date, t.symbol, "
        "be.fwd_max_move_pct, be.fwd_close_move_pct, be.fwd_vol_spike_x, "
        "be.days_to_move, be.inputs_json, be.provenance_json, "
        "be.synthetic_data_used "
        "FROM backtest_events be "
        "JOIN instruments i ON i.id = be.instrument_id "
        "JOIN tickers t ON t.id = i.ticker_id "
        "WHERE be.data_complete AND be.event_kind = 'earnings' "
        "ORDER BY be.event_date, be.id")
    rows = cur.fetchall()
    entries = []
    for r in rows:
        in_json = r[8] or {}
        passed, fail = _evaluate_filters(hf, in_json)
        ev = {"fwd_max_move_pct": r[4], "fwd_close_move_pct": r[5],
              "fwd_vol_spike_x": r[6], "days_to_move": r[7]}
        entries.append({
            "id": r[0], "instrument_id": r[1], "event_date": r[2],
            "symbol": r[3], "passed": passed, "failed": fail,
            "hit": _hit(ev, hit_def), "max_move": float(r[4] or 0),
            "close_move": float(r[5] or 0), "vol_x": float(r[6] or 0),
            "days_to_move": r[7], "band": (in_json.get("band") or "none"),
            "score": in_json.get("score"),
            "inputs": in_json, "synthetic": bool(r[10]),
            "provenance": r[9] or {},
            "instrument": r[1],
        })

    passes = [e for e in entries if e["passed"]]
    all_events = entries
    n_pass, k_pass = len(passes), sum(1 for e in passes if e["hit"])
    rate_pass = (k_pass / n_pass) if n_pass else None
    ci_pass = _wilson(k_pass, n_pass) if n_pass else None
    n_all, k_all = len(all_events), sum(1 for e in all_events if e["hit"])
    rate_all = (k_all / n_all) if n_all else None

    # Random-day baseline
    cur.execute(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE fwd_max_move_pct >= %s OR "
        "fwd_vol_spike_x >= %s) FROM backtest_events "
        "WHERE event_kind = 'random_day' AND data_complete",
        (hit_def.get("price_move_pct", 20), hit_def.get("volume_spike_x", 3)))
    n_rd, k_rd = cur.fetchone()
    n_rd, k_rd = (n_rd or 0), (k_rd or 0)
    rate_rd = (k_rd / n_rd) if n_rd else None
    ci_rd = _wilson(k_rd, n_rd) if n_rd else None

    insts = {e["instrument_id"] for e in passes}
    distinct = len(insts)

    # 1. Lift over random days + over all earnings, with CI on the difference
    lift_rd = (rate_pass - rate_rd) if (rate_pass is not None and rate_rd is not None) else None
    lift_all = (rate_pass - rate_all) if (rate_pass is not None and rate_all is not None) else None
    p_rd = _two_prop_p(rate_pass, n_pass, rate_rd, n_rd) if n_pass and n_rd else 1.0
    p_all = _two_prop_p(rate_pass, n_pass, rate_all, n_all) if n_pass and n_all else 1.0

    # 2. Throughput: passes a week (events span ~2 years; weeks = distinct date days / 7)
    cur.execute(
        "SELECT COUNT(DISTINCT event_date) FROM backtest_events "
        "WHERE event_kind = 'earnings' AND data_complete")
    days_covered = cur.fetchone()[0] or 1
    weeks = max(days_covered / 7, 1)
    throughput = round(n_pass / weeks, 2) if n_pass else 0.0

    # 3. Hit rate by band
    bands = {}
    for e in passes:
        b = e["band"]
        g = bands.setdefault(b, {"n": 0, "hits": 0})
        g["n"] += 1
        g["hits"] += 1 if e["hit"] else 0
    band_rows = [{"band": b, "n": g["n"], "hits": g["hits"],
                  "hit_rate": round(g["hits"]/g["n"], 3),
                  "ci95": _wilson(g["hits"], g["n"])}
                 for b, g in bands.items()]
    band_rows.sort(key=lambda x: x["n"], reverse=True)

    # 4. Filter attribution: drop each filter, re-measure
    attribution = []
    for rule in hf:
        key = rule["key"]
        sub_hf = [r for r in hf if r["key"] != key]
        _pass = sum(1 for e in entries
                    if _evaluate_filters(sub_hf, e["inputs"])[0])
        _hits = sum(1 for e in entries
                    if _evaluate_filters(sub_hf, e["inputs"])[0] and e["hit"])
        rate = (_hits / _pass) if _pass else None
        attribution.append({
            "filter": key, "n": _pass, "hits": _hits,
            "hit_rate": round(rate, 3) if rate is not None else None,
            "ci95": _wilson(_hits, _pass) if _pass else None,
            "change": round(rate - rate_pass, 3) if (rate is not None and rate_pass is not None) else None})
    attribution.sort(key=lambda x: (x["change"] is None, x["change"] or 0))

    # 5. Near misses: failed exactly one filter
    near = []
    for rule in hf:
        key = rule["key"]
        failed = [e for e in all_events if e["failed"] == f"filter_{key}"]
        # failed exactly this one: any other filter failing disqualifies
        failed = [e for e in failed
                  if sum(1 for r in hf
                         if not _evaluate_filters([r], e["inputs"])[0]) == 1]
        if not failed:
            continue
        k = sum(1 for e in failed if e["hit"])
        rate = k / len(failed)
        near.append({"filter": key, "n": len(failed), "hits": k,
                     "hit_rate": round(rate, 3),
                     "ci95": _wilson(k, len(failed))})
    near.sort(key=lambda x: x["n"], reverse=True)

    # 6. Direction split among hits
    ups = sum(1 for e in passes if e["hit"] and e["close_move"] > 0)
    downs = sum(1 for e in passes if e["hit"] and e["close_move"] < 0)
    flat = sum(1 for e in passes if e["hit"] and e["close_move"] == 0)

    # 7. Days to move + median move size among hits
    hit_entries = [e for e in passes if e["hit"]]
    days = sorted(e["days_to_move"] for e in hit_entries if e["days_to_move"] is not None)
    med_days = days[len(days)//2] if days else None
    sizes = sorted(abs(e["close_move"]) for e in hit_entries)
    med_size = round(sizes[len(sizes)//2], 1) if sizes else None

    # 8. Rolling 90-day lift vs all-time
    now = datetime.now(timezone.utc).date()
    _90 = [e for e in all_events if (now - e["event_date"]).days <= 90]
    p90 = [e for e in _90 if e["passed"]]
    if p90 and len(p90) >= 10:
        k90 = sum(1 for e in p90 if e["hit"])
        r90 = k90/len(p90)
        c90 = _wilson(k90, len(p90))
        _90_day = {"n": len(p90), "hit_rate": round(r90, 3), "ci95": c90,
                   "diff_vs_all_time": round(r90 - rate_pass, 3)
                   if rate_pass is not None else None}
    else:
        _90_day = {"n": len(p90), "hit_rate": None, "ci95": None,
                   "diff_vs_all_time": None,
                   "note": "too few cases in the last 90 days to report a rate"}

    # 9. Data coverage and shrinkage
    cur.execute(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE data_complete), "
        "COUNT(*) FILTER (WHERE fwd_max_move_pct IS NULL AND fwd_close_move_pct IS NULL) "
        "FROM backtest_events WHERE event_kind = 'earnings'")
    total_events, complete_events, unresolved = cur.fetchone()
    shrink = sum(1 for e in all_events if e["band"] in (None, "neutral") and e["score"] is not None)
    coverage = {
        "events_total": total_events, "events_complete": complete_events,
        "unresolved": unresolved or 0,
        "score_shrunk_to_neutral": shrink,
    }

    # 10. Concentration: top name share of hits
    from collections import Counter
    hit_syms = Counter(e["symbol"] for e in hit_entries)
    top_sym, top_count = (hit_syms.most_common(1) or [(None, 0)])[0]
    concentration = {
        "top_symbol": top_sym, "top_hits": top_count,
        "share_of_hits": round(top_count / len(hit_entries), 3) if hit_entries else None,
        "share_of_cases": round(top_count / len(passes), 3) if passes else None,
        "distinct_symbols": len(hit_syms),
    }

    # 11. Review override (not measured until Publish layer)
    review_override = {"measured": False, "note": "Starts when the Publish layer ships."}

    provenance_sources = sorted({e["provenance"].get("source") for e in entries
                                 if e["provenance"].get("source")})
    synthetic_used = any(e["synthetic"] for e in entries)

    # Answer phrasing
    if n_pass == 0:
        verdict = "collecting"
        answer_head = "No results yet."
        answer = ("No earnings events have passed this version's filters yet. "
                  "Nothing can be judged until there are cases.")
    elif n_pass < 10:
        verdict = "cant_tell"
        answer_head = "Can't tell yet."
        answer = (f"Only {n_pass} cases have passed the filters so far, too few to "
                  "report a rate. Shadow mode fills faster.")
    elif n_pass < 30:
        verdict = "cant_tell"
        answer_head = "Can't tell yet."
        answer = (f"{n_pass} cases have passed. The rate is {_phrasing(rate_pass, ci_pass)}, "
                  "but the range is too wide to call it working.")
    else:
        working = lift_rd is not None and lift_rd > 0 and p_rd < 0.05
        failing = lift_rd is not None and lift_rd < 0 and p_rd < 0.05
        if working:
            verdict = "working"
            answer_head = "Working."
            answer = (f"Stocks that pass this version's filters moved sharply "
                      f"{round(rate_pass*100,1)}% of the time vs {round(rate_rd*100,1)}% "
                      f"on ordinary days (n={n_pass}).")
        elif failing:
            verdict = "not_working"
            answer_head = "Not working."
            answer = (f"Pass cases hit {round(rate_pass*100,1)}%, inside the ordinary-day "
                      f"rate of {round(rate_rd*100,1)}%. The filters are not separating "
                      "anything.")
        else:
            verdict = "cant_tell"
            answer_head = "Can't tell yet."
            answer = (f"Pass cases hit {round(rate_pass*100,1)}% over {n_pass} cases; the "
                      f"difference from ordinary days ({round(rate_rd*100,1)}%) is inside "
                      "the ranges.")

    if synthetic_used:
        answer_note = ("Results use the sandbox fixture dataset and describe this "
                       "demo data, not live markets.")
    else:
        answer_note = None

    return {
        "version_number": version_row[1],
        "state": state,
        "verdict": verdict, "answer_head": answer_head, "answer": answer,
        "answer_note": answer_note,
        "n_pass": n_pass, "k_pass": k_pass,
        "rate_pass": round(rate_pass, 3) if rate_pass is not None else None,
        "ci_pass": ci_pass,
        "n_all": n_all, "rate_all": round(rate_all, 3) if rate_all is not None else None,
        "ci_all": _wilson(k_all, n_all),
        "n_random": n_rd, "rate_random": round(rate_rd, 3) if rate_rd is not None else None,
        "ci_random": ci_rd,
        "lift_random": round(lift_rd, 3) if lift_rd is not None else None,
        "lift_all_events": round(lift_all, 3) if lift_all is not None else None,
        "lift_p_random": p_rd, "lift_p_all_events": p_all,
        "distinct_instruments": distinct,
        "throughput_per_week": throughput,
        "weeks_covered": round(weeks, 1),
        "band_rows": band_rows,
        "attribution": attribution,
        "near_misses": near,
        "direction": {"up": ups, "down": downs, "flat": flat},
        "days_to_move_median": med_days, "median_move_size": med_size,
        "last_90": _90_day,
        "coverage": coverage,
        "concentration": concentration,
        "review_override": review_override,
        "provenance_sources": provenance_sources,
        "synthetic_data_used": synthetic_used,
        "hit_definition": hit_def,
    }


@router.get("/api/admin/lab/strategies/{key}/performance",
            dependencies=[Depends(_no_cache)])
def lab_performance(key: str, version: int | None = None,
                    creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            if version:
                row = _version(cur, sid, version)
            else:
                live = _live_version(cur, sid)
                latest = None
                if live:
                    row = _version(cur, sid, live[1])
                else:
                    latest = _latest(cur, sid)
                    row = _version(cur, sid, latest[1]) if latest else None
            if not row:
                _admin_404()
            m = _metrics(cur, row)
            return {"strategy": key, "metrics": m}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Version page (draft editor + frozen + shadow + live/retired views)
# --------------------------------------------------------------------------

def _version_page(cur, sid, vnum, admin_id):
    strat = _strategy(cur, _sid_key(cur, sid))
    row = _version(cur, sid, vnum)
    if not row:
        _admin_404()
    base = _serialize_version(row)
    metrics = _metrics(cur, row)
    live = _live_version(cur, sid)
    live_row = None
    if live:
        live_row = _version(cur, sid, live[1])
    comparison = None
    trial = None
    if row[10] == "draft" and live_row:
        # matched comparison: live vs draft on the same non-holdout events
        comparison = _matched_comparison(cur, sid, row, live_row)
    if row[10] == "shadow":
        trial = _trial_state(cur, row, live_row)
    page = {
        "strategy": strat, "version": base, "metrics": metrics,
        "live_version": _serialize_version(live_row) if live_row else None,
        "comparison": comparison, "trial": trial,
    }
    return page


def _sid_key(cur, sid):
    cur.execute("SELECT key FROM strategies WHERE id = %s", (sid,))
    row = cur.fetchone()
    return row[0] if row else ""


def _matched_comparison(cur, sid, draft_row, live_row):
    hit_def = draft_row[5] or {"price_move_pct": 20, "volume_spike_x": 3,
                               "combine": "or", "window": "tight"}
    cutoff = draft_row[15]
    where = "be.data_complete AND be.event_kind = 'earnings'"
    params = []
    if cutoff:
        where += " AND be.event_date < %s"
        params.append(cutoff)
    cur.execute(
        "SELECT be.inputs_json, be.fwd_max_move_pct, be.fwd_vol_spike_x, "
        "be.event_date FROM backtest_events be "
        "WHERE " + where + " ORDER BY be.event_date, be.id",
        tuple(params))
    rows = cur.fetchall()
    d_hf, l_hf = draft_row[4] or [], live_row[4] or []
    cnt = {"draft": {"n": 0, "hits": 0}, "live": {"n": 0, "hits": 0}}
    for in_json, mv, vx, _d in rows:
        in_json = in_json or {}
        ev = {"fwd_max_move_pct": mv, "fwd_vol_spike_x": vx}
        if _evaluate_filters(d_hf, in_json)[0]:
            cnt["draft"]["n"] += 1
            cnt["draft"]["hits"] += 1 if _hit(ev, hit_def) else 0
        if _evaluate_filters(l_hf, in_json)[0]:
            cnt["live"]["n"] += 1
            cnt["live"]["hits"] += 1 if _hit(ev, hit_def) else 0
    out = {}
    for k in ("draft", "live"):
        g = cnt[k]
        rate = (g["hits"]/g["n"]) if g["n"] else None
        out[k] = {"n": g["n"], "hits": g["hits"],
                  "hit_rate": round(rate, 3) if rate is not None else None,
                  "ci95": _wilson(g["hits"], g["n"]) if g["n"] else None}
    diff = None
    if out["draft"]["hit_rate"] is not None and out["live"]["hit_rate"] is not None:
        diff = round(out["draft"]["hit_rate"] - out["live"]["hit_rate"], 3)
    return {"live": out["live"], "candidate": out["draft"], "difference": diff,
            "cutoff": cutoff.isoformat() if cutoff else None}


def _trial_state(cur, row, live_row):
    import datetime as _dt
    started = row[11]
    ends = row[12]
    now = _dt.datetime.now(timezone.utc)
    total_days = max((ends - started).days, 1) if started and ends else DEFAULT_TRIAL_DAYS
    el = (now - started).days if started else 0
    day = max(0, min(el, total_days))
    if not started or not ends:
        return {"started_at": None, "ends_at": None, "day": None,
                "total_days": DEFAULT_TRIAL_DAYS, "results": None}
    # results = events between start and end that BOTH versions scored, resolved
    hit_def = row[5] or {"price_move_pct": 20, "volume_spike_x": 3,
                         "combine": "or", "window": "tight"}
    cur.execute(
        "SELECT be.id, be.instrument_id, be.event_date, t.symbol, "
        "be.fwd_max_move_pct, be.fwd_close_move_pct, be.fwd_vol_spike_x, "
        "be.days_to_move, be.inputs_json "
        "FROM backtest_events be "
        "JOIN instruments i ON i.id = be.instrument_id "
        "JOIN tickers t ON t.id = i.ticker_id "
        "WHERE be.data_complete AND be.event_kind = 'earnings' "
        "AND be.event_date BETWEEN %s AND %s ORDER BY be.event_date, be.id",
        (started.date(), now.date()))
    rows = cur.fetchall()
    cand_hf, live_hf = row[4] or [], (live_row[4] or []) if live_row else []
    results = []
    for r in rows:
        in_json = r[8] or {}
        ev = {"fwd_max_move_pct": r[4], "fwd_vol_spike_x": r[6]}
        cand = _evaluate_filters(cand_hf, in_json)[0]
        liv = _evaluate_filters(live_hf, in_json)[0]
        if not (cand or liv):
            continue
        hit = _hit(ev, hit_def)
        results.append({
            "id": r[0], "symbol": r[3], "event_date": r[2].isoformat(),
            "price_move": float(r[4] or 0), "close_move": float(r[5] or 0),
            "vol_x": float(r[6] or 0), "days_to_move": r[7],
            "picked_by": "both" if (cand and liv) else ("candidate" if cand else "live"),
            "hit": hit})
    n_cand = sum(1 for x in results if x["picked_by"] in ("both", "candidate"))
    k_cand = sum(1 for x in results if x["picked_by"] in ("both", "candidate") and x["hit"])
    n_live = sum(1 for x in results if x["picked_by"] in ("both", "live"))
    k_live = sum(1 for x in results if x["picked_by"] in ("both", "live") and x["hit"])
    return {
        "started_at": started.isoformat(), "ends_at": ends.isoformat(),
        "day": day, "total_days": total_days,
        "candidate": {"n": n_cand, "hits": k_cand,
                      "hit_rate": round(k_cand/n_cand, 3) if n_cand else None,
                      "ci95": _wilson(k_cand, n_cand) if n_cand else None},
        "live_v": {"n": n_live, "hits": k_live,
                   "hit_rate": round(k_live/n_live, 3) if n_live else None,
                   "ci95": _wilson(k_live, n_live) if n_live else None},
        "results": results,
    }


@router.get("/api/admin/lab/strategies/{key}/versions/{v}",
            dependencies=[Depends(_no_cache)])
def lab_version_page(key: str, v: int,
                     creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            sid = _strategy_id(cur, key)
            return _version_page(cur, sid, v, admin_id)
    finally:
        conn.close()