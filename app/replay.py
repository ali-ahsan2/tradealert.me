"""Replay: run the triggers over stored history and measure what followed.

The product's promise is "it tells me before the move is over, measured not
predicted". Measuring it live takes months of alerts. A replay walks every
stored session between two dates, fires each trigger exactly as the live
pass would have fired it that morning (app/triggers.py, same functions),
and resolves each firing against the bars that came after: the close and
the largest move over 5 and 14 sessions, the volume spike, and the session
on which the move peaked. A matched baseline of random sessions for the
same instruments answers "compared with what".

Rows land in replay_alerts under one replay_runs row and never touch
alert_events, the pulse or any subscriber record: a replayed alert is what
would have fired, not what was sent. The Lab reads the summary, and an
operator may publish a replay as a strategy's record, with the replay named
as the source.

    python -m app.replay 2025-01-01 2026-06-30 [volume_3x,s3_424b]
"""
from __future__ import annotations

import json
import logging
import random
import statistics
import sys
import time
from datetime import date, datetime, timedelta, timezone

from app import triggers
from app.db import get_conn

log = logging.getLogger("tradealert.replay")

TIGHT = 5
WIDE = 14
HIT_MOVE_PCT = 20.0        # the Lab's default hit definition
HIT_VOL_X = 3.0
BASELINE_PER_INSTRUMENT = 6
BASELINE_GAP_SESSIONS = 6  # a random day keeps this far from any fired alert
MIN_GROUP = 10             # same floor as the Lab's backtest


def resolve(bars, i):
    """Forward figures for the alert on bars[i]. None until WIDE sessions of
    bars exist after it, so a half-open window never counts as resolved."""
    if i is None or i + TIGHT >= len(bars):
        return None
    ref = bars[i][4]
    if ref <= 0:
        return None
    fwd = bars[i + 1:i + 1 + WIDE]
    if len(fwd) < TIGHT:
        return None
    prior = bars[max(0, i - triggers.VOL_LOOKBACK):i]
    avg_vol = (sum(b[5] for b in prior) / len(prior)) if prior else 0
    tight = fwd[:TIGHT]
    wide = fwd[:WIDE]

    def max_move(seg):
        best, when = 0.0, 0
        for n, b in enumerate(seg, 1):
            up = (b[2] / ref - 1) * 100
            dn = (b[3] / ref - 1) * 100
            m = up if abs(up) >= abs(dn) else dn
            if abs(m) > abs(best):
                best, when = m, n
        return best, when

    m5, when5 = max_move(tight)
    m14, when14 = max_move(wide)
    vol_x = (max(b[5] for b in tight) / avg_vol) if avg_vol > 0 else None
    out = {
        "fwd_close_5d": round((tight[-1][4] / ref - 1) * 100, 2),
        "fwd_max_5d": round(m5, 2),
        "fwd_close_14d": round((wide[-1][4] / ref - 1) * 100, 2) if len(wide) == WIDE else None,
        "fwd_max_14d": round(m14, 2) if len(wide) == WIDE else None,
        "vol_spike_x": round(vol_x, 2) if vol_x is not None else None,
        "peak_after_sessions": when5,
        "resolved": len(wide) == WIDE,
    }
    out["hit"] = abs(out["fwd_max_5d"]) >= HIT_MOVE_PCT or (vol_x or 0) >= HIT_VOL_X
    return out


def wilson(k, n, z=1.96):
    if n <= 0:
        return None
    import math
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def two_prop_p(k1, n1, k2, n2):
    import math
    if n1 <= 0 or n2 <= 0:
        return None
    p1, p2 = k1 / n1, k2 / n2
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    z = abs(p1 - p2) / se
    return round(2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2)))), 6)


def _summarise(rows):
    """rows: [(hit, fwd_max_5d, fwd_close_5d, peak_after_sessions, instrument_id)]"""
    n = len(rows)
    hits = sum(1 for r in rows if r[0])
    out = {"n": n, "hits": hits, "hit_rate": round(hits / n, 4) if n else None,
           "ci": wilson(hits, n), "instruments": len({r[4] for r in rows})}
    if n:
        out["median_max_move_5d"] = round(statistics.median(abs(r[1]) for r in rows), 2)
        out["median_close_5d"] = round(statistics.median(r[2] for r in rows), 2)
        out["median_peak_session"] = statistics.median(r[3] for r in rows)
        out["share_up_5d"] = round(sum(1 for r in rows if r[2] > 0) / n, 3)
    return out


def run_replay(conn, from_date, to_date, keys=None, industry_keys=None, admin_id=None,
               baseline_per_instrument=BASELINE_PER_INSTRUMENT, note="", seed=7):
    """Fire the replayable triggers over [from_date, to_date], resolve, and
    write one replay_runs row with its summary. Returns the summary."""
    keys = triggers.evaluable(keys, "replay")
    t0 = time.time()
    cur = conn.cursor()
    cur.execute("INSERT INTO replay_runs (admin_user_id, from_date, to_date, params_json, note) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (admin_id, from_date, to_date,
                 json.dumps({"triggers": keys, "industries": industry_keys or [],
                             "baseline_per_instrument": baseline_per_instrument,
                             "hit": {"move_pct": HIT_MOVE_PCT, "vol_x": HIT_VOL_X, "window": TIGHT}}),
                 note))
    run_id = cur.fetchone()[0]
    conn.commit()
    try:
        summary = _replay(conn, cur, run_id, from_date, to_date, keys, industry_keys,
                          baseline_per_instrument, seed)
        summary["seconds"] = round(time.time() - t0, 1)
        cur.execute("UPDATE replay_runs SET status = 'completed', finished_at = now(), summary_json = %s, "
                    "instruments_count = %s, sessions_count = %s, alerts_count = %s WHERE id = %s",
                    (json.dumps(summary), summary["instruments"], summary["sessions"],
                     summary["alerts"], run_id))
        conn.commit()
        summary["replay_run_id"] = run_id
        return summary
    except Exception as e:
        conn.rollback()
        cur.execute("UPDATE replay_runs SET status = 'failed', finished_at = now(), note = %s WHERE id = %s",
                    (f"{note} | {type(e).__name__}: {e}"[:500], run_id))
        conn.commit()
        raise


def _replay(conn, cur, run_id, from_date, to_date, keys, industry_keys, per_instrument, seed):
    sql = ("SELECT i.id, i.ticker_id, t.symbol, ind.key FROM instruments i "
           "JOIN tickers t ON t.id = i.ticker_id JOIN industries ind ON ind.id = i.industry_id "
           "WHERE i.active ")
    args = []
    if industry_keys:
        sql += "AND ind.key = ANY(%s) "
        args.append(list(industry_keys))
    cur.execute(sql + "ORDER BY t.symbol", args)
    instruments = cur.fetchall()
    cur.execute("SELECT id, key FROM triggers")
    trig_ids = {k: i for i, k in cur.fetchall()}
    tids = {i[1] for i in instruments}
    ctxs = triggers.load_contexts(cur, tids, from_date, to_date + timedelta(days=WIDE * 2 + 10))
    rng = random.Random(seed)

    sessions = set()
    for c in ctxs.values():
        sessions.update(b[0] for b in c.bars if from_date <= b[0] <= to_date)
    sessions = sorted(sessions)

    alert_rows, base_rows = [], []
    per_trigger = {k: [] for k in keys}
    unresolved = 0
    synthetic = 0
    cur.execute("SELECT DISTINCT source FROM price_bars WHERE ticker_id = ANY(%s)", (list(tids),))
    bar_sources = sorted(r[0] for r in cur.fetchall())
    if any(s == "dev_fixture" for s in bar_sources):
        synthetic = 1

    for iid, tid, sym, ind in instruments:
        ctx = ctxs[tid]
        fired_positions = set()
        for on in sessions:
            i = ctx.bar_pos(on)
            if i is None:
                continue
            for key, r in triggers.evaluate(ctx, on, keys):
                res = resolve(ctx.bars, i)
                row = {"iid": iid, "sym": sym, "ind": ind, "key": key, "on": on,
                       "detail": r["detail"], "inputs": r["inputs"], "res": res}
                alert_rows.append(row)
                fired_positions.add(i)
                if res and res["resolved"]:
                    per_trigger[key].append((res["hit"], res["fwd_max_5d"], res["fwd_close_5d"],
                                             res["peak_after_sessions"], iid))
                else:
                    unresolved += 1
        # matched baseline: random sessions for the same instrument, clear of its alerts
        idx = [ctx.bar_pos(on) for on in sessions]
        idx = [i for i in idx if i is not None and i + WIDE < len(ctx.bars)
               and all(abs(i - f) > BASELINE_GAP_SESSIONS for f in fired_positions)]
        if idx and per_instrument:
            for i in rng.sample(idx, min(per_instrument, len(idx))):
                res = resolve(ctx.bars, i)
                if res and res["resolved"]:
                    base_rows.append((res["hit"], res["fwd_max_5d"], res["fwd_close_5d"],
                                      res["peak_after_sessions"], iid))
                    row = {"iid": iid, "sym": sym, "ind": ind, "key": None, "on": ctx.bars[i][0],
                           "detail": "matched random session", "inputs": {}, "res": res, "base": True}
                    alert_rows.append(row)

    # write
    buf = []
    for r in alert_rows:
        res = r["res"] or {}
        buf.append((run_id, r["iid"], trig_ids.get(r["key"]) if r["key"] else trig_ids.get(keys[0]),
                    r["on"], r["detail"], json.dumps(r["inputs"]),
                    res.get("fwd_close_5d"), res.get("fwd_max_5d"), res.get("fwd_close_14d"),
                    res.get("fwd_max_14d"), res.get("vol_spike_x"), res.get("peak_after_sessions"),
                    res.get("hit"), bool(res.get("resolved")), bool(r.get("base"))))
    cur.executemany(
        "INSERT INTO replay_alerts (replay_run_id, instrument_id, trigger_id, fired_on, detail, inputs_json, "
        " fwd_close_5d, fwd_max_5d, fwd_close_14d, fwd_max_14d, vol_spike_x, peak_after_sessions, hit, "
        " resolved, baseline) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT DO NOTHING", buf)

    base = _summarise(base_rows)
    by_trigger = {}
    for key in keys:
        s = _summarise(per_trigger[key])
        s["source"] = triggers.REGISTRY[key]["source"]
        if s["n"] and base["n"]:
            s["difference"] = round((s["hit_rate"] - base["hit_rate"]) * 100, 1)
            s["p"] = two_prop_p(s["hits"], s["n"], base["hits"], base["n"])
        s["warnings"] = []
        if s["n"] < MIN_GROUP:
            s["warnings"].append("below_floor")
        if s["n"] and s["instruments"] < 5:
            s["warnings"].append("few_instruments")
        by_trigger[key] = s
    all_rows = [r for k in keys for r in per_trigger[k]]
    overall = _summarise(all_rows)
    if overall["n"] and base["n"]:
        overall["difference"] = round((overall["hit_rate"] - base["hit_rate"]) * 100, 1)
        overall["p"] = two_prop_p(overall["hits"], overall["n"], base["hits"], base["n"])

    # by industry, all triggers together
    by_industry = {}
    for r in alert_rows:
        if r.get("base") or not r["res"] or not r["res"]["resolved"]:
            continue
        by_industry.setdefault(r["ind"], []).append(
            (r["res"]["hit"], r["res"]["fwd_max_5d"], r["res"]["fwd_close_5d"],
             r["res"]["peak_after_sessions"], r["iid"]))
    by_industry = {k: _summarise(v) for k, v in by_industry.items()}

    return {
        "from": from_date.isoformat(), "to": to_date.isoformat(), "triggers": keys,
        "instruments": len(instruments), "sessions": len(sessions),
        "alerts": sum(1 for r in alert_rows if not r.get("base")),
        "unresolved": unresolved,
        "overall": overall, "baseline": base, "by_trigger": by_trigger, "by_industry": by_industry,
        "not_replayed": {k: triggers.REGISTRY[k]["note"] for k in triggers.REGISTRY
                         if not triggers.REGISTRY[k]["replay"]},
        "bar_sources": bar_sources, "synthetic_data_used": bool(synthetic),
        "hit_definition": f"a move of {HIT_MOVE_PCT:.0f}% or more within {TIGHT} sessions, "
                          f"or volume {HIT_VOL_X:.0f}x the prior 20-session average",
        "footer": "This measures whether a move happened after an alert, not its direction and "
                  "not whether a trade would have been profitable.",
    }


def publish_record(conn, replay_run_id, strategy_key="fast_mover"):
    """Make a completed replay the strategy's published record: hits and n
    across every resolved alert, with the replay named as the source. The
    live path (calibration_outcomes) still takes over at thirty rows, as
    migration 013 states."""
    cur = conn.cursor()
    cur.execute("SELECT status, summary_json, from_date, to_date FROM replay_runs WHERE id = %s",
                (replay_run_id,))
    row = cur.fetchone()
    if not row or row[0] != "completed":
        raise ValueError("replay not completed")
    s = row[1] or {}
    if s.get("synthetic_data_used"):
        raise ValueError("a replay over synthetic bars cannot be published")
    ov = s.get("overall") or {}
    if not ov.get("n") or ov["n"] < MIN_GROUP:
        raise ValueError(f"fewer than {MIN_GROUP} resolved alerts")
    source = (f"replay #{replay_run_id}, {row[2]} to {row[3]}, "
              f"{', '.join(s.get('triggers') or [])}: {ov['hits']} of {ov['n']} moved")
    cur.execute("UPDATE strategies SET record_hits = %s, record_n = %s, record_source = %s WHERE key = %s",
                (ov["hits"], ov["n"], source, strategy_key))
    conn.commit()
    return {"record_hits": ov["hits"], "record_n": ov["n"], "record_source": source}


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(argv) < 3:
        print(__doc__)
        return
    keys = argv[3].split(",") if len(argv) > 3 else None
    conn = get_conn()
    try:
        s = run_replay(conn, date.fromisoformat(argv[1]), date.fromisoformat(argv[2]), keys)
        print(json.dumps({k: v for k, v in s.items() if k != "by_industry"}, indent=1, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv)
