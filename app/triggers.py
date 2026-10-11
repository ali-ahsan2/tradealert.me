"""The trigger evaluator: which recorded facts changed on a date.

Each trigger is a small function over a context that answers "what did the
data say on and before this date" for one instrument. The same function
runs live (today, writing alert_events, which the sweep delivers) and in
the Lab's replay (any past date, writing replay_alerts), so an alert the
product sends and an alert the replay counts are the same rule.

The registry below states, per trigger, where its data comes from and
whether it can fire live, be replayed, or neither. That status is served
to the Lab verbatim: a trigger with no source is shown as not firing rather
than quietly producing nothing.

    python -m app.triggers              # evaluate today, write alert events
    python -m app.triggers 2026-06-30   # evaluate a past date, print only
"""
from __future__ import annotations

import json
import logging
import statistics
import sys
from datetime import date, datetime, timedelta, timezone

from app.db import get_conn

log = logging.getLogger("tradealert.triggers")

VOL_LOOKBACK = 20
VOL_MULT = 3.0
FEE_BASELINE_DAYS = 20
FEE_MIN_POINTS = 5
FEE_MULT = 2.0
FEE_FLOOR_PCT = 1.0
SI_LINES = (10.0, 15.0, 20.0)
SI_PRINT_MAX_AGE_DAYS = 16          # a FINRA print is news for one cycle
CATALYST_LOOKAHEAD_DAYS = 45
DILUTION_FORMS = ("S-3", "S-3/A", "S-3ASR", "424B1", "424B2", "424B3", "424B4", "424B5", "424B7")

# key -> {source, live, replay, note}. `live` means the morning pass can fire
# it from current data; `replay` means stored history lets the Lab fire it
# on past dates.
REGISTRY = {
    "volume_3x": {
        "source": "daily bars (price_bars)",
        "live": True, "replay": True,
        "note": "Volume on the session at 3x or more the prior 20-session average.",
    },
    "borrow_fee_2x": {
        "source": "borrow fee snapshots (iBorrowDesk)",
        "live": True, "replay": True,
        "note": "Latest fee at 2x or more the median of the prior 20 days' fees; needs five prior "
                "points, so it replays only from the day fee snapshots began.",
    },
    "si_cross": {
        "source": "short-interest snapshots (FINRA print via stats feed)",
        "live": True, "replay": True,
        "note": "A new print carries the name upward across 10, 15 or 20% of float; replays only "
                "where print history is stored.",
    },
    "catalyst_dated": {
        "source": "next-earnings snapshots (stats feed)",
        "live": True, "replay": True,
        "note": "A dated event appears within 45 days where none was dated before, or the date "
                "moves; replays only where snapshot history is stored.",
    },
    "s3_424b": {
        "source": "SEC EDGAR filings (filings table)",
        "live": True, "replay": True,
        "note": "An S-3 shelf or 424B prospectus lands on EDGAR that day.",
    },
    "band_change": {
        "source": "the engine's own runs",
        "live": True, "replay": False,
        "note": "Fired by app.engine when a score crosses a band boundary between two runs; a "
                "replay would need scored history, which is not stored yet.",
    },
    "insider_buying": {
        "source": "none yet",
        "live": False, "replay": False,
        "note": "Needs Form 4 transaction parsing (buy vs sell, open market); the EDGAR index "
                "only says a Form 4 was filed. Not firing until that source exists.",
    },
    "social_surge": {
        "source": "none",
        "live": False, "replay": False,
        "note": "No social feed is licensed. Not firing.",
    },
    "contract_award": {
        "source": "none yet",
        "live": False, "replay": False,
        "note": "Needs an 8-K item 1.01 / press-release parser with a dollar figure. Not firing.",
    },
}


class Ctx:
    """Per-instrument data up to and including `on`, loaded once per ticker
    for a date range so a replay over hundreds of sessions stays fast.

    bars:   [(d, open, high, low, close, volume)] ascending
    snaps:  {field: [(as_of_date, value)]} ascending
    filings: [(filed_on, form, items)] ascending
    """

    def __init__(self, bars, snaps, filings):
        self.bars = bars
        self.snaps = snaps
        self.filings = filings
        self._bar_index = {b[0]: i for i, b in enumerate(bars)}

    def bar_pos(self, on):
        return self._bar_index.get(on)

    def snap_upto(self, field, on):
        """[(as_of_date, value)] with as_of <= on."""
        return [s for s in self.snaps.get(field, []) if s[0] <= on]

    def latest(self, field, on):
        s = self.snap_upto(field, on)
        return s[-1] if s else None


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def t_volume_3x(ctx, on):
    i = ctx.bar_pos(on)
    if i is None or i < VOL_LOOKBACK:
        return None
    prior = ctx.bars[i - VOL_LOOKBACK:i]
    avg = sum(b[5] for b in prior) / VOL_LOOKBACK
    if avg <= 0:
        return None
    x = ctx.bars[i][5] / avg
    if x >= VOL_MULT:
        return {"detail": f"{x:.1f}x the 20-day average volume", "inputs": {"volx20d": round(x, 2)}}
    return None


def t_borrow_fee_2x(ctx, on):
    latest = ctx.latest("fee_pct", on)
    if not latest or latest[0] != on:
        return None                      # fires on the day a fee snapshot lands
    fee = _f(latest[1])
    if fee is None or fee < FEE_FLOOR_PCT:
        return None
    window = [_f(v) for d, v in ctx.snap_upto("fee_pct", on - timedelta(days=1))
              if d >= on - timedelta(days=FEE_BASELINE_DAYS)]
    window = [w for w in window if w is not None]
    if len(window) < FEE_MIN_POINTS:
        return None
    base = statistics.median(window)
    if base <= 0:
        return None
    x = fee / base
    if x >= FEE_MULT:
        return {"detail": f"borrow fee {x:.1f}x the 20-day baseline ({base:.1f}% to {fee:.1f}%)",
                "inputs": {"fee_pct": fee, "baseline_pct": round(base, 2), "x": round(x, 2)}}
    return None


def t_si_cross(ctx, on):
    prints = ctx.snap_upto("si_pct_float", on)
    if len(prints) < 2 or prints[-1][0] != on:
        return None
    # A new print is the latest distinct as_of; the one before it is the prior print.
    new_d, new_v = prints[-1]
    prev = next((p for p in reversed(prints[:-1]) if p[0] < new_d), None)
    if prev is None:
        return None
    a, b = _f(prev[1]), _f(new_v)
    if a is None or b is None or b <= a:
        return None
    crossed = [line for line in SI_LINES if a < line <= b]
    if not crossed:
        return None
    line = max(crossed)
    return {"detail": f"short interest print crossed {line:.0f}% of float ({a:.1f}% to {b:.1f}%)",
            "inputs": {"si_prev": a, "si_new": b, "line": line}}


def t_catalyst_dated(ctx, on):
    snaps = ctx.snap_upto("earnings", on)
    if not snaps or snaps[-1][0] != on:
        return None
    try:
        ed = date.fromisoformat(str(snaps[-1][1])[:10])
    except ValueError:
        return None
    days = (ed - on).days
    if days < 0 or days > CATALYST_LOOKAHEAD_DAYS:
        return None
    before = [s for s in snaps[:-1] if s[0] < on]
    prev_val = str(before[-1][1])[:10] if before else None
    if prev_val == ed.isoformat():
        return None                      # already dated, nothing changed
    what = "dated" if prev_val is None else f"moved from {prev_val}"
    return {"detail": f"earnings {what}: {ed.isoformat()}, {days} days out",
            "inputs": {"earnings": ed.isoformat(), "days": days, "previous": prev_val}}


def t_s3_424b(ctx, on):
    todays = [f for f in ctx.filings if f[0] == on and f[1] in DILUTION_FORMS]
    if not todays:
        return None
    forms = sorted({f[1] for f in todays})
    return {"detail": f"{' and '.join(forms)} filed on EDGAR; dilution risk",
            "inputs": {"forms": forms}}


FUNCS = {
    "volume_3x": t_volume_3x,
    "borrow_fee_2x": t_borrow_fee_2x,
    "si_cross": t_si_cross,
    "catalyst_dated": t_catalyst_dated,
    "s3_424b": t_s3_424b,
}


def evaluable(keys=None, mode="live"):
    """Trigger keys that can fire in `mode` ('live' or 'replay')."""
    want = keys or list(REGISTRY)
    return [k for k in want if k in FUNCS and REGISTRY.get(k, {}).get(mode)]


# --------------------------------------------------------------------------
# Loading contexts
# --------------------------------------------------------------------------

def load_contexts(cur, ticker_ids, start, end):
    """{ticker_id: Ctx} with bars from `start` minus a year's run-up to `end`
    (momentum and volume baselines need the history), snapshots and filings
    over the same span."""
    tids = list(ticker_ids)
    bars = {}
    cur.execute("SELECT ticker_id, d, open, high, low, close, volume FROM price_bars "
                "WHERE ticker_id = ANY(%s) AND d BETWEEN %s AND %s ORDER BY ticker_id, d",
                (tids, start - timedelta(days=60), end))
    for tid, d, o, h, lo, c, v in cur.fetchall():
        bars.setdefault(tid, []).append((d, float(o), float(h), float(lo), float(c), int(v)))
    snaps = {}
    cur.execute("SELECT ticker_id, field, (as_of AT TIME ZONE 'UTC')::date, value FROM snapshots "
                "WHERE ticker_id = ANY(%s) AND field IN ('fee_pct','si_pct_float','earnings') "
                "AND as_of BETWEEN %s AND %s ORDER BY ticker_id, field, as_of, id",
                (tids, datetime.combine(start - timedelta(days=FEE_BASELINE_DAYS + 5),
                                        datetime.min.time(), tzinfo=timezone.utc),
                 datetime.combine(end, datetime.max.time(), tzinfo=timezone.utc)))
    for tid, field, d, value in cur.fetchall():
        lst = snaps.setdefault(tid, {}).setdefault(field, [])
        if lst and lst[-1][0] == d:
            lst[-1] = (d, value)         # last value of the day wins
        else:
            lst.append((d, value))
    filings = {}
    cur.execute("SELECT ticker_id, filed_on, form, items FROM filings "
                "WHERE ticker_id = ANY(%s) AND filed_on BETWEEN %s AND %s ORDER BY ticker_id, filed_on",
                (tids, start, end))
    for tid, d, form, items in cur.fetchall():
        filings.setdefault(tid, []).append((d, form, items))
    return {tid: Ctx(bars.get(tid, []), snaps.get(tid, {}), filings.get(tid, []))
            for tid in tids}


def evaluate(ctx, on, keys):
    """[(key, result)] for the triggers in `keys` that fire on `on`."""
    out = []
    for k in keys:
        fn = FUNCS.get(k)
        if not fn:
            continue
        r = fn(ctx, on)
        if r:
            out.append((k, r))
    return out


# --------------------------------------------------------------------------
# Live pass
# --------------------------------------------------------------------------

def fire_live(conn, on=None, keys=None, write=True):
    """Evaluate every live trigger for every active instrument on `on`
    (default today) and write alert_events. One event per instrument,
    trigger and day (the table's unique key), so re-running is free."""
    on = on or datetime.now(timezone.utc).date()
    keys = evaluable(keys, "live")
    cur = conn.cursor()
    cur.execute("SELECT id, key FROM triggers")
    trig_ids = {k: i for i, k in cur.fetchall()}
    cur.execute("SELECT i.id, i.ticker_id, t.symbol FROM instruments i "
                "JOIN tickers t ON t.id = i.ticker_id WHERE i.active")
    instruments = cur.fetchall()
    ctxs = load_contexts(cur, {i[1] for i in instruments}, on, on)
    fired = []
    for iid, tid, sym in instruments:
        for key, r in evaluate(ctxs[tid], on, keys):
            fired.append((iid, sym, key, r))
            if write and key in trig_ids:
                cur.execute(
                    "INSERT INTO alert_events (instrument_id, trigger_id, fired_at, detail) "
                    "VALUES (%s, %s, %s, %s) ON CONFLICT (instrument_id, trigger_id, fired_on) DO NOTHING",
                    (iid, trig_ids[key],
                     datetime.combine(on, datetime.min.time(), tzinfo=timezone.utc).replace(hour=14),
                     r["detail"]))
    if write:
        conn.commit()
    by_key = {}
    for _, _, k, _ in fired:
        by_key[k] = by_key.get(k, 0) + 1
    log.info("triggers on %s: %d fired %s", on, len(fired), by_key)
    return {"on": on.isoformat(), "evaluated": keys, "instruments": len(instruments),
            "fired": len(fired), "by_trigger": by_key,
            "sample": [{"symbol": s, "trigger": k, "detail": r["detail"]} for _, s, k, r in fired[:25]]}


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    conn = get_conn()
    try:
        if len(argv) > 1:
            s = fire_live(conn, on=date.fromisoformat(argv[1]), write=False)
        else:
            s = fire_live(conn)
        print(json.dumps(s, indent=1, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv)
