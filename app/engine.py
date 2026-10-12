"""The daily engine: score every active instrument from stored data.

Before this module the product had one scored run, replayed from the
operator's workbench at seed time. Here a run is made from what the
database holds on a date: the latest snapshot of each field as of that
date, momentum measured from the stored daily bars, and the operator's
research inputs. The arithmetic is app/engine_core.py, the same for the
morning pass and for a Lab replay of a past date.

    python -m app.engine              # score as of today; writes only when ENGINE_LIVE=1
    python -m app.engine 2026-06-30   # score as of a past date (dry run)

A band change between the new run and the previous completed run fires the
`band_change` alert event, which is the only trigger the engine itself
owns; the rest live in app/triggers.py.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import date, datetime, timedelta, timezone

from app import engine_core
from app.db import get_conn

log = logging.getLogger("tradealert.engine")


def engine_live():
    """True when ENGINE_LIVE=1. Off by default: until the operator turns it
    on, the engine and the live triggers score and evaluate but write
    nothing a subscriber reads, so a deploy changes no subscriber screen.
    Turn it on after the Lab's dry runs and replays look right and the
    research inputs are loaded (deploy/UPGRADE.md, step 8)."""
    import os
    return os.environ.get("ENGINE_LIVE") == "1"

SNAPSHOT_FIELDS = ("cap_usd_m", "float_m", "so_m", "si_pct_float", "dtc", "fee_pct",
                   "growth_pct", "earnings", "earnings_conf", "run3m_pct",
                   "off_high_pct", "volx20d", "px")
SNAPSHOT_MAX_AGE_DAYS = 45      # a snapshot older than this is not "current"
RUN3M_SESSIONS = 63
HIGH_SESSIONS = 252
VOL_SESSIONS = 20
MAX_BAND_CHANGE_SHARE = 0.25     # above this a run is a regime change, not news


def _as_of_date(as_of):
    if as_of is None:
        return datetime.now(timezone.utc).date()
    if isinstance(as_of, datetime):
        return as_of.date()
    if isinstance(as_of, str):
        return date.fromisoformat(as_of[:10])
    return as_of


def latest_snapshots(cur, on, ticker_ids=None, fields=SNAPSHOT_FIELDS, max_age_days=SNAPSHOT_MAX_AGE_DAYS):
    """{ticker_id: {field: value}} with each field's latest snapshot whose
    as_of is on or before the end of `on` and not older than max_age_days."""
    end = datetime.combine(on, datetime.max.time(), tzinfo=timezone.utc)
    start = end - timedelta(days=max_age_days)
    sql = ("SELECT DISTINCT ON (ticker_id, field) ticker_id, field, value "
           "FROM snapshots WHERE field = ANY(%s) AND as_of <= %s AND as_of > %s ")
    args = [list(fields), end, start]
    if ticker_ids:
        sql += "AND ticker_id = ANY(%s) "
        args.append(list(ticker_ids))
    sql += "ORDER BY ticker_id, field, as_of DESC, id DESC"
    cur.execute(sql, args)
    out = {}
    for tid, field, value in cur.fetchall():
        out.setdefault(tid, {})[field] = value
    return out


def momentum_from_bars(cur, on, ticker_ids=None):
    """{ticker_id: {run3m_pct, off_high_pct, volx20d}} from stored bars on or
    before `on`. Needs at least 21 sessions; the 3-month and 52-week figures
    use what is there, so a young listing gets shorter windows, stated by
    the engine's coverage rather than hidden."""
    sql = ("SELECT ticker_id, d, close, high, volume FROM price_bars "
           "WHERE d <= %s AND d > %s ")
    args = [on, on - timedelta(days=400)]
    if ticker_ids:
        sql += "AND ticker_id = ANY(%s) "
        args.append(list(ticker_ids))
    sql += "ORDER BY ticker_id, d"
    cur.execute(sql, args)
    series = {}
    for tid, d, close, high, vol in cur.fetchall():
        series.setdefault(tid, []).append((d, float(close), float(high), int(vol)))
    out = {}
    for tid, bars in series.items():
        if len(bars) < VOL_SESSIONS + 1:
            continue
        last = bars[-1]
        m = {}
        back = bars[-RUN3M_SESSIONS - 1] if len(bars) > RUN3M_SESSIONS else bars[0]
        if back[1] > 0:
            m["run3m_pct"] = round((last[1] / back[1] - 1) * 100, 1)
        hi = max(b[2] for b in bars[-HIGH_SESSIONS:])
        if hi > 0:
            m["off_high_pct"] = round((last[1] / hi - 1) * 100, 1)
        prior = bars[-VOL_SESSIONS - 1:-1]
        avg = sum(b[3] for b in prior) / len(prior)
        if avg > 0:
            m["volx20d"] = round(last[3] / avg, 2)
        m["bar_date"] = last[0].isoformat()
        out[tid] = m
    return out


def research(cur, instrument_ids=None):
    sql = ("SELECT instrument_id, heat, qual, qual_note, haircut_points, haircut_note, "
           "prerev, pre_flags_json, growth_pct FROM instrument_research ")
    args = []
    if instrument_ids:
        sql += "WHERE instrument_id = ANY(%s)"
        args.append(list(instrument_ids))
    cur.execute(sql, args)
    out = {}
    for iid, heat, qual, qn, hp, hn, prerev, flags, gr in cur.fetchall():
        out[iid] = {"heat": None if heat is None else float(heat),
                    "qual": None if qual is None else float(qual), "qual_note": qn,
                    "haircut": float(hp or 0), "haircut_note": hn, "prerev": bool(prerev),
                    "pre_flags": flags or [], "growth_pct_research": None if gr is None else float(gr)}
    return out


def live_version(cur, strategy_key):
    cur.execute(
        "SELECT s.id, s.band_cutoffs_json, sv.id, sv.component_weights_json, sv.hard_filters_json, "
        "sv.band_cutoffs_json FROM strategies s "
        "LEFT JOIN strategy_versions sv ON sv.id = s.live_version_id WHERE s.key = %s",
        (strategy_key,))
    row = cur.fetchone()
    if not row:
        raise ValueError(f"no strategy {strategy_key}")
    sid, cutoffs, vid, weights, filters, vcut = row
    if vid is None:
        # No live pointer: the first version on record, as the Lab seed does.
        cur.execute("SELECT id, component_weights_json, hard_filters_json, band_cutoffs_json "
                    "FROM strategy_versions WHERE strategy_id = %s ORDER BY version_number LIMIT 1",
                    (sid,))
        v = cur.fetchone()
        if v:
            vid, weights, filters, vcut = v
    return {"strategy_id": sid, "version_id": vid,
            "weights": weights or {}, "hard_filters": filters or [],
            "cutoffs": vcut or cutoffs}


def build_inputs(cur, on, instruments):
    """One input dict per instrument for engine_core.score."""
    tids = sorted({i[1] for i in instruments})
    snaps = latest_snapshots(cur, on, tids)
    mom = momentum_from_bars(cur, on, tids)
    res = research(cur, [i[0] for i in instruments])
    out = {}
    for iid, tid, _sym in instruments:
        inp = dict(snaps.get(tid, {}))
        inp.update(mom.get(tid, {}))           # bars beat a stale chart snapshot
        r = res.get(iid)
        if r:
            if r["growth_pct_research"] is not None and inp.get("growth_pct") in (None, ""):
                inp["growth_pct"] = r["growth_pct_research"]
            inp.update({k: r[k] for k in ("heat", "qual", "qual_note", "haircut",
                                          "haircut_note", "prerev", "pre_flags")})
        out[iid] = inp
    return out


def active_instruments(cur, strategy_industries=None):
    cur.execute("SELECT i.id, i.ticker_id, t.symbol FROM instruments i "
                "JOIN tickers t ON t.id = i.ticker_id WHERE i.active ORDER BY t.symbol")
    return cur.fetchall()


def previous_run(cur, strategy_id, before_run_id=None):
    sql = "SELECT id FROM runs WHERE status = 'completed' "
    args = []
    if before_run_id:
        sql += "AND id < %s "
        args.append(before_run_id)
    sql += "ORDER BY as_of DESC, id DESC LIMIT 1"
    cur.execute(sql, args)
    row = cur.fetchone()
    return row[0] if row else None


def score_run(conn, as_of=None, strategy_key="fast_mover", write=True, fire_band_changes=True):
    """Score every active instrument as of `as_of` (default today).

    write=False scores and returns the summary without touching runs/scores.
    Band-change alert events are written only for a run as of today, since
    an alert says "this changed today"; a replay measures them separately.
    """
    on = _as_of_date(as_of)
    today = datetime.now(timezone.utc).date()
    dry_reason = None
    if write and on != today:
        write, dry_reason = False, "a past date is always a dry run"
    elif write and not engine_live():
        write, dry_reason = False, "the engine is off (ENGINE_LIVE is not 1)"
    as_of_ts = datetime.combine(on, datetime.min.time(), tzinfo=timezone.utc).replace(hour=13)
    cur = conn.cursor()
    ver = live_version(cur, strategy_key)
    instruments = active_instruments(cur)
    inputs = build_inputs(cur, on, instruments)
    results = {}
    tally = {}
    cov_sum = 0.0
    for iid, tid, sym in instruments:
        r = engine_core.score(inputs[iid], as_of=on, weights=ver["weights"],
                              hard_filters=ver["hard_filters"], cutoffs=ver["cutoffs"])
        results[iid] = r
        tally[r["band"]] = tally.get(r["band"], 0) + 1
        cov_sum += r["cov"]
    summary = {"as_of": on.isoformat(), "strategy": strategy_key, "version_id": ver["version_id"],
               "scored": len(results), "bands": tally,
               "mean_coverage": round(cov_sum / len(results), 3) if results else None,
               "run_id": None, "band_changes": 0, "written": False, "dry_run_reason": dry_reason}
    if not write:
        summary["results"] = {iid: {"total": r["total"], "band": r["band"], "cov": round(r["cov"], 3)}
                              for iid, r in results.items()}
        return summary

    prev_id = previous_run(cur, ver["strategy_id"])
    prev = {}
    if prev_id:
        cur.execute("SELECT instrument_id, value, band FROM scores WHERE run_id = %s AND strategy_id = %s",
                    (prev_id, ver["strategy_id"]))
        prev = {iid: (float(v), b) for iid, v, b in cur.fetchall()}

    cur.execute("SELECT id FROM runs WHERE as_of = %s ORDER BY id DESC LIMIT 1", (as_of_ts,))
    row = cur.fetchone()
    if row:
        run_id = row[0]
        cur.execute("UPDATE runs SET status = 'running', started_at = now(), completed_at = NULL "
                    "WHERE id = %s", (run_id,))
    else:
        cur.execute("INSERT INTO runs (as_of, status) VALUES (%s, 'running') RETURNING id", (as_of_ts,))
        run_id = cur.fetchone()[0]

    changes = []
    for iid, tid, sym in instruments:
        r = results[iid]
        p = prev.get(iid)
        delta = round(r["total"] - p[0], 1) if p else None
        shrink = r["shrinkage"] if abs(r["shrinkage"]) >= 0.05 else None
        haircut = json.dumps([{"label": r["haircut_note"], "points": r["pen"], "evidence_url": None}]) \
            if r["pen"] else "[]"
        cur.execute(
            "INSERT INTO scores (run_id, instrument_id, strategy_id, value, band, components_present, "
            " components_total, shrinkage_applied, shrinkage_from, component_json, haircut_json, "
            " hard_filter_json, delta_1d) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (run_id, instrument_id, strategy_id) DO UPDATE SET value = EXCLUDED.value, "
            " band = EXCLUDED.band, components_present = EXCLUDED.components_present, "
            " components_total = EXCLUDED.components_total, shrinkage_applied = EXCLUDED.shrinkage_applied, "
            " shrinkage_from = EXCLUDED.shrinkage_from, component_json = EXCLUDED.component_json, "
            " haircut_json = EXCLUDED.haircut_json, hard_filter_json = EXCLUDED.hard_filter_json, "
            " delta_1d = EXCLUDED.delta_1d",
            (run_id, iid, ver["strategy_id"], r["total"], r["band"], r["present"], r["total_components"],
             None if shrink is None else round(shrink, 1), round(r["shrinkage_from"], 1),
             json.dumps(r["parts"]), haircut,
             json.dumps(r["hard_filters"]) if r["hard_filters"] else None, delta))
        if p and p[1] != r["band"]:
            changes.append((iid, sym, p[1], r["band"], p[0], r["total"]))
    cur.execute("UPDATE runs SET status = 'completed', completed_at = now() WHERE id = %s", (run_id,))

    fired = 0
    share = len(changes) / len(instruments) if instruments else 0
    if fire_band_changes and on == today and changes and share > MAX_BAND_CHANGE_SHARE:
        # More than a quarter of the universe changing band in one run is a
        # change of data regime (a new feed, a first run after a seed), not
        # news about each name. Score it, log it, fire nothing.
        log.warning("engine run %s: %d of %d instruments changed band; "
                    "band_change alerts withheld as a regime change", run_id, len(changes), len(instruments))
        summary["band_changes_withheld"] = True
    elif fire_band_changes and on == today and changes:
        cur.execute("SELECT id FROM triggers WHERE key = 'band_change'")
        trow = cur.fetchone()
        if trow:
            for iid, sym, old_b, new_b, old_v, new_v in changes:
                detail = f"score moved {old_v:.0f} to {new_v:.0f}, from {old_b} to {new_b}"
                cur.execute(
                    "INSERT INTO alert_events (instrument_id, trigger_id, fired_at, detail) "
                    "VALUES (%s, %s, now(), %s) ON CONFLICT (instrument_id, trigger_id, fired_on) DO NOTHING",
                    (iid, trow[0], detail))
                fired += cur.rowcount
    conn.commit()
    summary.update({"run_id": run_id, "band_changes": len(changes), "alerts_fired": fired,
                    "written": True, "previous_run_id": prev_id})
    log.info("engine run %s as of %s: %s scored, bands %s, %d band changes",
             run_id, on, len(results), tally, len(changes))
    return summary


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    conn = get_conn()
    try:
        if len(argv) > 1:
            s = score_run(conn, as_of=argv[1], write=False)
            s.pop("results", None)
        else:
            s = score_run(conn)
        print(json.dumps(s, indent=1, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv)
