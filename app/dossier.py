"""Read helpers behind GET /api/stock/{symbol}: everything the dossier shows
beyond the headline score. Each function takes an open cursor and ids that
main.py has already resolved inside the subscriber's visibility scope, so
nothing here can widen what a subscriber sees; the one query that lists
other names (peers) carries the same visibility fragment and the same
top-K clamp as the board.

Also home to the strategy facts every payload that names a strategy needs
(the measured record, whether it scored anything on the latest run), so the
plain card's status and record sentence are resolved in one place."""
import threading
import time

from app import plain_copy
from app.db import get_conn


def _f(v):
    return float(v) if v is not None else None


def components_of(raw):
    """component_json as stored by the scorer: [{k, label, weight, score, val,
    backed}] -> what a subscriber may see: {key, label, value, score, backed,
    rank}. The weight orders the list server-side (rank 1 did most to lift
    the score) and never leaves the server (DESIGN_V6 §10)."""
    rows = []
    for c in (raw or []):
        if not isinstance(c, dict):
            continue
        try:
            w = float(c.get("weight")) if c.get("weight") is not None else None
            sc = float(c.get("score")) if c.get("score") is not None else None
        except (TypeError, ValueError):
            w, sc = None, None
        lift = sc * w if sc is not None and w is not None else None
        rows.append((lift, {"key": c.get("k"), "label": c.get("label"),
                            "value": c.get("val"), "score": c.get("score"),
                            "backed": bool(c.get("backed", True))}))
    rows.sort(key=lambda r: (r[0] is None, -(r[0] or 0.0)))
    out = []
    for i, (_lift, row) in enumerate(rows):
        row["rank"] = i + 1
        out.append(row)
    return out


# --------------------------------------------------------------------------
# Strategy facts: the record and whether it runs, resolved once
# --------------------------------------------------------------------------

def strategy_facts(cur):
    """key -> {id, key, label, monogram, calibrated, calibrated_at, resolved,
    record (hits/n or None), record_source, scored, sort_order} for every
    strategy. Three aggregate queries, no per-name rows."""
    cur.execute(
        "SELECT id, key, label, monogram, calibrated, calibrated_at, "
        "resolved_outcomes_count, record_hits, record_n, record_source, sort_order "
        "FROM strategies ORDER BY sort_order",
    )
    rows = cur.fetchall()
    cur.execute(
        "SELECT strategy_id, COUNT(*), COALESCE(SUM(CASE WHEN hit THEN 1 ELSE 0 END), 0) "
        "FROM calibration_outcomes GROUP BY strategy_id",
    )
    outcomes = {r[0]: (int(r[2]), int(r[1])) for r in cur.fetchall()}
    cur.execute(
        "SELECT id FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
    run = cur.fetchone()
    scored = {}
    if run:
        cur.execute(
            "SELECT strategy_id, COUNT(*) FROM scores "
            "WHERE run_id = %s AND value IS NOT NULL GROUP BY strategy_id",
            (run[0],),
        )
        scored = {r[0]: int(r[1]) for r in cur.fetchall()}
    out = {}
    for r in rows:
        o_hits, o_n = outcomes.get(r[0], (None, None))
        out[r[1]] = {
            "id": r[0], "key": r[1], "label": r[2], "monogram": r[3],
            "calibrated": bool(r[4]),
            "calibrated_at": r[5].isoformat() if r[5] else None,
            "resolved": int(r[6] or 0),
            "record": plain_copy.record_numbers(o_hits, o_n, r[7], r[8]),
            "record_source": r[9] or "",
            "scored": scored.get(r[0], 0) if run else None,
            "sort_order": r[10],
        }
    return out


def plain_for(fact, brief=False):
    """The plain card for a strategy_facts row."""
    fn = plain_copy.strategy_brief if brief else plain_copy.strategy_plain
    return fn(fact["key"], fact["calibrated"], scored=fact["scored"],
              resolved=fact["resolved"], record=fact["record"])


_FACTS_TTL = 60.0
_facts_cache = {"t": 0.0, "facts": None}
_facts_lock = threading.Lock()


def facts_cached():
    """strategy_facts on a short in-process cache, for payload builders that
    hold no cursor of their own (the board's and screens' strategy stub)."""
    now = time.time()
    with _facts_lock:
        if _facts_cache["facts"] is not None and now - _facts_cache["t"] < _FACTS_TTL:
            return _facts_cache["facts"]
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            facts = strategy_facts(cur)
    finally:
        conn.close()
    with _facts_lock:
        _facts_cache.update({"t": now, "facts": facts})
    return facts


def plain_brief_cached(key, calibrated=False, resolved=None):
    """{one_line, status, record} for a strategy key, from the cached facts;
    falls back to the row's own flags when the cache cannot be filled."""
    try:
        fact = facts_cached().get(key)
    except Exception:  # noqa: BLE001 - a stub must never fail the request
        fact = None
    if fact:
        return plain_for(fact, brief=True)
    return plain_copy.strategy_brief(key, calibrated, resolved=resolved)


def lenses(cur, run_id, instrument_id):
    """Every strategy with this run's score and breakdown where one exists,
    so the dossier can show all five lenses without five requests. Each
    carries its plain {one_line, status, record}."""
    facts = strategy_facts(cur)
    cur.execute(
        "SELECT st.key, st.label, st.monogram, st.calibrated, "
        "sc.value, sc.band, sc.components_present, sc.components_total, "
        "sc.component_json, sc.shrinkage_applied, sc.delta_1d, sc.haircut_json "
        "FROM strategies st "
        "LEFT JOIN scores sc ON sc.strategy_id = st.id "
        "  AND sc.run_id = %s AND sc.instrument_id = %s "
        "ORDER BY st.sort_order",
        (run_id, instrument_id),
    )
    out = []
    for r in cur.fetchall():
        fact = facts.get(r[0])
        out.append({
            "key": r[0], "label": r[1], "monogram": r[2], "calibrated": bool(r[3]),
            "value": _f(r[4]), "band": r[5],
            "components_present": r[6], "components_total": r[7],
            "components": components_of(r[8]),
            "shrinkage_applied": _f(r[9]), "delta_1d": _f(r[10]),
            "plain": plain_for(fact, brief=True) if fact
            else plain_copy.strategy_brief(r[0], bool(r[3])),
        })
    return out


def previous_run_id(cur, run_id):
    cur.execute(
        "SELECT id, as_of FROM runs WHERE status = 'completed' "
        "AND as_of < (SELECT as_of FROM runs WHERE id = %s) "
        "ORDER BY as_of DESC LIMIT 1",
        (run_id,),
    )
    return cur.fetchone()


def changes(cur, run_id, instrument_id, strategy_id, current_components):
    """What moved since the previous completed run, component by component.
    None when there is no previous run or the name was not scored in it."""
    prev = previous_run_id(cur, run_id)
    if not prev:
        return None
    cur.execute(
        "SELECT value, band, component_json, components_present, components_total "
        "FROM scores WHERE run_id = %s AND instrument_id = %s AND strategy_id = %s",
        (prev[0], instrument_id, strategy_id),
    )
    row = cur.fetchone()
    if not row:
        return None
    before = {c["key"]: c for c in components_of(row[2])}
    after = {c["key"]: c for c in current_components}
    rows = []
    for k in sorted(set(before) | set(after)):
        b, a = before.get(k), after.get(k)
        delta = None
        if b and a and b.get("score") is not None and a.get("score") is not None:
            delta = round(float(a["score"]) - float(b["score"]), 3)
        rows.append({
            "key": k, "label": (a or b).get("label") or k,
            "prev": b.get("score") if b else None, "now": a.get("score") if a else None,
            "prev_value": b.get("value") if b else None, "value": a.get("value") if a else None,
            "delta": delta,
            "status": "added" if a and not b else "dropped" if b and not a else "kept",
        })
    rows.sort(key=lambda r: -abs(r["delta"] if r["delta"] is not None else 0.0))
    return {"prev_run": {"id": prev[0], "as_of": prev[1].isoformat()},
            "prev_value": _f(row[0]), "prev_band": row[1],
            "prev_components_present": row[3], "prev_components_total": row[4],
            "components": rows}


def history(cur, instrument_id, strategy_id, limit=60):
    """Score per completed run, oldest first. Real history, never a decorative
    series: every point is a run that actually happened."""
    cur.execute(
        "SELECT r.id, r.as_of, sc.value, sc.band, sc.components_present, sc.components_total "
        "FROM scores sc JOIN runs r ON r.id = sc.run_id "
        "WHERE sc.instrument_id = %s AND sc.strategy_id = %s AND r.status = 'completed' "
        "ORDER BY r.as_of DESC LIMIT %s",
        (instrument_id, strategy_id, limit),
    )
    rows = cur.fetchall()
    return [
        {"run_id": r[0], "as_of": r[1].isoformat(), "value": _f(r[2]), "band": r[3],
         "components_present": r[4], "components_total": r[5]}
        for r in reversed(rows)
    ]


def peers(cur, run_id, strategy_id, industry_id, instrument_id, vis, vis_params, k):
    """The same industry's top names on this strategy, clamped to the tier's
    top-K and the visibility fragment, exactly like the board. The name
    itself is flagged rather than removed so its rank stays visible."""
    cur.execute(
        "SELECT i.id, t.symbol, i.theme, sc.value, sc.band, "
        "sc.components_present, sc.components_total, sc.delta_1d "
        "FROM scores sc "
        "JOIN instruments i ON i.id = sc.instrument_id "
        "JOIN tickers t ON t.id = i.ticker_id "
        "WHERE sc.run_id = %s AND sc.strategy_id = %s AND i.industry_id = %s "
        f"AND sc.value IS NOT NULL AND {vis} "
        "ORDER BY sc.value DESC, t.symbol LIMIT %s",
        tuple([run_id, strategy_id, industry_id] + vis_params + [k]),
    )
    return [
        {"rank": n + 1, "symbol": r[1], "theme": r[2], "value": _f(r[3]), "band": r[4],
         "components_present": r[5], "components_total": r[6], "delta_1d": _f(r[7]),
         "self": r[0] == instrument_id}
        for n, r in enumerate(cur.fetchall())
    ]


def events(cur, instrument_id, user_id, days=120, limit=40):
    """Impersonal alert events on this name, with the channels that reached
    this subscriber (empty when nothing was armed)."""
    cur.execute(
        "SELECT ae.id, tr.key, tr.label, ae.detail, ae.fired_at, "
        "(SELECT array_agg(ad.channel ORDER BY ad.channel) FROM alert_deliveries ad "
        " WHERE ad.alert_event_id = ae.id AND ad.user_id = %s) AS channels, "
        "(SELECT bool_and(ad.read_at IS NOT NULL) FROM alert_deliveries ad "
        " WHERE ad.alert_event_id = ae.id AND ad.user_id = %s) AS all_read "
        "FROM alert_events ae JOIN triggers tr ON tr.id = ae.trigger_id "
        "WHERE ae.instrument_id = %s AND ae.fired_at >= now() - make_interval(days => %s) "
        "ORDER BY ae.fired_at DESC LIMIT %s",
        (user_id, user_id, instrument_id, days, limit),
    )
    return [
        {"id": r[0], "trigger_key": r[1], "trigger": r[2], "detail": r[3],
         "fired_at": r[4].isoformat(), "channels": r[5] or [],
         "read": bool(r[6]) if r[6] is not None else None}
        for r in cur.fetchall()
    ]


def past_reactions(cur, instrument_id, limit=12):
    """How the name actually moved after its past dated events: real, resolved
    rows only. Synthetic fixtures never reach a subscriber."""
    cur.execute(
        "SELECT event_date, event_kind, fwd_max_move_pct, fwd_close_move_pct, "
        "fwd_vol_spike_x, hit, days_to_move, window_tight_days "
        "FROM backtest_events "
        "WHERE instrument_id = %s AND NOT synthetic_data_used AND resolved_at IS NOT NULL "
        "ORDER BY event_date DESC LIMIT %s",
        (instrument_id, limit),
    )
    return [
        {"date": r[0].isoformat(), "kind": r[1], "max_move_pct": _f(r[2]),
         "close_move_pct": _f(r[3]), "volume_spike_x": _f(r[4]),
         "hit": bool(r[5]) if r[5] is not None else None,
         "days_to_move": r[6], "window_days": r[7]}
        for r in cur.fetchall()
    ]
