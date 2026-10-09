"""Read helpers behind GET /api/stock/{symbol}: everything the dossier shows
beyond the headline score. Each function takes an open cursor and ids that
main.py has already resolved inside the subscriber's visibility scope, so
nothing here can widen what a subscriber sees; the one query that lists
other names (peers) carries the same visibility fragment and the same
top-K clamp as the board."""


def _f(v):
    return float(v) if v is not None else None


def components_of(raw):
    """component_json as stored by the scorer: [{k, label, weight, score, val,
    backed}] -> the shape the API has always returned."""
    return [
        {"key": c.get("k"), "label": c.get("label"), "weight": c.get("weight"),
         "score": c.get("score"), "value": c.get("val"),
         "backed": bool(c.get("backed", True))}
        for c in (raw or []) if isinstance(c, dict)
    ]


def lenses(cur, run_id, instrument_id):
    """Every strategy with this run's score and breakdown where one exists,
    so the dossier can show all five lenses without five requests."""
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
        out.append({
            "key": r[0], "label": r[1], "monogram": r[2], "calibrated": bool(r[3]),
            "value": _f(r[4]), "band": r[5],
            "components_present": r[6], "components_total": r[7],
            "components": components_of(r[8]),
            "shrinkage_applied": _f(r[9]), "delta_1d": _f(r[10]),
            "haircut_points": sum(float(h.get("points") or 0) for h in (r[11] or [])
                                  if isinstance(h, dict)),
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
