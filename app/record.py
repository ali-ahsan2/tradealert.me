"""The record: what fired, who was told, and what the price did after.

Every number here is a recorded fact measured on daily bars, the same way
/api/alerts/outcomes measures: from the last close on or before the alert
to the close five sessions later and to the highest high inside those five
sessions. Nothing is predicted. The product uses these figures to show a
subscriber what they were told and when, what fired on names they were not
watching, and (as counts only) what fired beyond the industries they follow.

Visibility rules are the usual ones: tickers only inside the viewer's
universe, clamped to the plan's names_shown_limit with the remainder as a
count; anything beyond the universe is counts, never tickers; the public
pulse carries no tickers at all.
"""
from __future__ import annotations

import logging
import os
import threading
import time

from fastapi import APIRouter, Depends, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import scope
from app.db import get_conn
from app.discover import _f, _iso, _pct, _viewer

log = logging.getLogger("tradealert.record")
router = APIRouter()
bearer = HTTPBearer(auto_error=False)

MOVE_10 = 10.0
MOVE_20 = 20.0

# forward-move lateral, aliases ae (alert_events) and t (tickers)
_FWD = (
    "LEFT JOIN LATERAL (SELECT "
    "  (SELECT close FROM price_bars p WHERE p.ticker_id = t.id AND p.d <= ae.fired_on "
    "   ORDER BY d DESC LIMIT 1) AS c0, "
    "  (SELECT close FROM price_bars p WHERE p.ticker_id = t.id AND p.d > ae.fired_on "
    "   ORDER BY d LIMIT 1 OFFSET 4) AS c5, "
    "  (SELECT MAX(z.high) FROM (SELECT high FROM price_bars p WHERE p.ticker_id = t.id "
    "   AND p.d > ae.fired_on ORDER BY d LIMIT 5) z) AS h5, "
    "  (SELECT z.idx FROM (SELECT high, row_number() OVER (ORDER BY d) AS idx "
    "   FROM price_bars p WHERE p.ticker_id = t.id AND p.d > ae.fired_on ORDER BY d LIMIT 5) z "
    "   ORDER BY z.high DESC, z.idx LIMIT 1) AS peak_idx, "
    "  (SELECT COUNT(*) FROM (SELECT 1 FROM price_bars p WHERE p.ticker_id = t.id "
    "   AND p.d > ae.fired_on ORDER BY d LIMIT 5) z) AS n_after "
    ") fwd ON TRUE "
)

_FROM = (
    "FROM alert_events ae "
    "JOIN triggers tr ON tr.id = ae.trigger_id "
    "JOIN instruments i ON i.id = ae.instrument_id "
    "JOIN tickers t ON t.id = i.ticker_id "
    "JOIN industries ind ON ind.id = i.industry_id "
)


def _measure(c0, c5, h5, n_after, peak_idx):
    """(chg_5d, max_5d, peak_after_sessions) or Nones while the window is open."""
    if c0 is None or (n_after or 0) < 5:
        return None, None, None
    return _pct(c5, c0), _pct(h5, c0), int(peak_idx) if peak_idx is not None else None


def _event_rows(cur, where, params, uid=None, limit=3000):
    told_sql = ("EXISTS (SELECT 1 FROM alert_deliveries ad WHERE ad.alert_event_id = ae.id "
                "AND ad.user_id = %s)" if uid is not None else "FALSE")
    cur.execute(
        "SELECT ae.id, tr.key, tr.label, t.symbol, i.theme, ind.key, ind.label, "
        f"ae.fired_on, ae.fired_at, ae.detail, {told_sql} AS told, "
        "fwd.c0, fwd.c5, fwd.h5, fwd.n_after, fwd.peak_idx "
        f"{_FROM}{_FWD}"
        f"WHERE {where} ORDER BY ae.fired_at DESC LIMIT %s",
        tuple(([uid] if uid is not None else []) + list(params) + [limit]),
    )
    out = []
    for (eid, tkey, tlabel, sym, theme, ikey, ilabel, fired_on, fired_at, detail, told,
         c0, c5, h5, n_after, peak_idx) in cur.fetchall():
        chg5, max5, peak = _measure(c0, c5, h5, n_after, peak_idx)
        out.append({
            "id": eid, "trigger_key": tkey, "trigger": tlabel, "symbol": sym, "theme": theme,
            "industry_key": ikey, "industry_label": ilabel,
            "date": fired_on.isoformat(), "fired_at": _iso(fired_at), "detail": detail,
            "told": bool(told), "chg_5d": chg5, "max_5d": max5,
            "peak_after_sessions": peak, "pending": chg5 is None and c0 is not None,
        })
    return out


def _tally(events):
    """Counts the product states in words: fired, measured, moved 10/20."""
    measured = [e for e in events if e["max_5d"] is not None]
    return {
        "fired": len(events),
        "names": len({e["symbol"] for e in events}),
        "measured": len(measured),
        "moved_10": sum(1 for e in measured if e["max_5d"] >= MOVE_10),
        "moved_20": sum(1 for e in measured if e["max_5d"] >= MOVE_20),
        "industries": len({e["industry_key"] for e in events}),
    }


def _public_example(e):
    """An example with no ticker: industry, trigger, the move and the lead."""
    return {"industry_key": e["industry_key"], "industry_label": e["industry_label"],
            "trigger_key": e["trigger_key"], "trigger": e["trigger"], "date": e["date"],
            "max_5d": e["max_5d"], "chg_5d": e["chg_5d"],
            "peak_after_sessions": e["peak_after_sessions"]}


def _strip(e):
    return {k: v for k, v in e.items() if k not in ("industry_key",)}


# --------------------------------------------------------------------------
# Public pulse: aggregates and ticker-less examples, cached a few minutes
# --------------------------------------------------------------------------

_PULSE_TTL = int(os.environ.get("PULSE_CACHE_SECONDS", "300"))
_pulse_cache = {"t": 0.0, "days": None, "body": None}
_pulse_lock = threading.Lock()


def compute_pulse(conn, days=30):
    with conn.cursor() as cur:
        events = _event_rows(cur, "ae.fired_at >= now() - make_interval(days => %s)", [days])
        cur.execute("SELECT as_of FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
        r = cur.fetchone()
        cur.execute("SELECT COUNT(*) FROM instruments WHERE active")
        universe = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM industries")
        n_ind = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*), COUNT(*) FILTER (WHERE calibrated) FROM strategies")
        n_strat, n_cal = cur.fetchone()
    tally = _tally(events)
    by_ind = {}
    for e in events:
        ent = by_ind.setdefault(e["industry_key"], {
            "key": e["industry_key"], "label": e["industry_label"], "fired": 0,
            "measured": 0, "moved_10": 0, "moved_20": 0, "names": set()})
        ent["fired"] += 1
        ent["names"].add(e["symbol"])
        if e["max_5d"] is not None:
            ent["measured"] += 1
            ent["moved_10"] += e["max_5d"] >= MOVE_10
            ent["moved_20"] += e["max_5d"] >= MOVE_20
    industries = []
    for ent in by_ind.values():
        ent["names"] = len(ent["names"])
        industries.append(ent)
    industries.sort(key=lambda x: (-x["moved_10"], -x["fired"]))
    measured = sorted((e for e in events if e["max_5d"] is not None),
                      key=lambda e: -e["max_5d"])
    leads = [e["peak_after_sessions"] for e in measured if e["max_5d"] >= MOVE_10
             and e["peak_after_sessions"]]
    leads.sort()
    return {
        "days": days,
        "as_of": _iso(r[0]) if r else None,
        "universe": {"names": universe, "industries": n_ind,
                     "strategies": n_strat, "calibrated": n_cal},
        "alerts": tally,
        "lead_sessions_median": leads[len(leads) // 2] if leads else None,
        "industries": industries,
        "examples": [_public_example(e) for e in measured[:6] if e["max_5d"] >= MOVE_10],
        "method": "Measured from the last daily close on or before each alert to the highest "
                  "high in the next five sessions. Counts, not predictions.",
    }


@router.get("/api/pulse")
def pulse(response: Response, days: int = Query(30, ge=7, le=90)):
    """What fired across the whole universe lately and what moved after.
    Anonymous, aggregate, no tickers. Cached in process."""
    now = time.time()
    with _pulse_lock:
        hit = _pulse_cache["body"]
        if hit is not None and _pulse_cache["days"] == days and now - _pulse_cache["t"] < _PULSE_TTL:
            response.headers["Cache-Control"] = f"public, max-age={_PULSE_TTL}"
            return hit
    conn = get_conn()
    try:
        body = compute_pulse(conn, days)
    finally:
        conn.close()
    with _pulse_lock:
        _pulse_cache.update({"t": now, "days": days, "body": body})
    response.headers["Cache-Control"] = f"public, max-age={_PULSE_TTL}"
    return body


# --------------------------------------------------------------------------
# The subscriber's own record: told, missed, beyond
# --------------------------------------------------------------------------

def compute_record(conn, uid, keys, picks, vis, vis_params, k, days=30):
    with conn.cursor() as cur:
        inside = _event_rows(
            cur, f"{vis} AND ae.fired_at >= now() - make_interval(days => %s)",
            list(vis_params) + [days], uid=uid)
        beyond = _event_rows(
            cur, f"NOT {vis} AND ae.fired_at >= now() - make_interval(days => %s)",
            list(vis_params) + [days])
    told = [e for e in inside if e["told"]]
    missed = [e for e in inside if not e["told"]]
    # the biggest moves first, pending ones after, newest first within each
    rank = lambda e: (-(e["max_5d"] if e["max_5d"] is not None else -1e9), e["date"])  # noqa: E731
    missed.sort(key=rank)
    told.sort(key=rank)
    missed_names = []
    seen = set()
    for e in missed:
        if e["symbol"] not in seen:
            seen.add(e["symbol"])
            missed_names.append(e["symbol"])
    shown = set(missed_names[:k])
    missed_shown = [_strip(e) for e in missed if e["symbol"] in shown]
    beyond_tally = _tally(beyond)
    beyond_inds = {e["industry_key"]: e["industry_label"] for e in beyond}
    return {
        "days": days,
        "told": {"summary": _tally(told), "events": [_strip(e) for e in told[:60]]},
        "missed": {"summary": _tally(missed), "events": missed_shown,
                   "names_shown": len(shown), "names_total": len(missed_names),
                   "names_shown_limit": k},
        "beyond": {"summary": beyond_tally,
                   # labels of industries not followed, never tickers
                   "industries": sorted(beyond_inds.values())},
        "method": "Measured from the last close on or before each alert to the close five "
                  "sessions later and the highest high in between. 'Told' means we sent it "
                  "to you; 'missed' means it fired on a name you were not watching.",
    }


@router.get("/api/me/record")
def my_record(days: int = Query(30, ge=7, le=365), symbol: str = "",
              creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """The subscriber's record; with ?symbol= the alerts on one visible name
    (told and missed alike, no clamp since the name is already in view). A
    name outside the universe is 'not found', the same as a name that does
    not exist."""
    conn = get_conn()
    try:
        uid, tier, keys, picks, vis, vis_params, k = _viewer(conn, creds)
        if symbol:
            sym = symbol.strip().upper()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM instruments i JOIN tickers t ON t.id = i.ticker_id "
                    f"WHERE t.symbol = %s AND i.active AND {vis} LIMIT 1",
                    tuple([sym] + list(vis_params)),
                )
                if not cur.fetchone():
                    from fastapi import HTTPException
                    raise HTTPException(404, "not found")
                events = _event_rows(
                    cur, f"{vis} AND t.symbol = %s AND ae.fired_at >= now() - make_interval(days => %s)",
                    list(vis_params) + [sym, days], uid=uid)
            return {"days": days, "symbol": sym, "summary": _tally(events),
                    "told": _tally([e for e in events if e["told"]]),
                    "events": [_strip(e) for e in events]}
        return compute_record(conn, uid, keys, picks, vis, vis_params, k, days)
    finally:
        conn.close()


def digest_lines(conn, uid, days=7):
    """Short plain-text lines for the digest email, from the same facts."""
    scope.provision_free(conn, uid)
    tier = scope.tier_for_user(conn, uid)
    keys, _label, picks = scope.user_scope(conn, uid, tier[3] if tier else 1)
    vis, vis_params = scope.visible_sql_and_params(keys, picks, "i")
    rec = compute_record(conn, uid, keys, picks, vis, vis_params, tier[4] if tier else 5, days)
    told, missed, beyond = rec["told"]["summary"], rec["missed"]["summary"], rec["beyond"]["summary"]
    lines = []
    if told["fired"]:
        lines.append(f"You were told about {told['fired']} alert(s) this week; "
                     f"{told['moved_10']} of the {told['measured']} measured so far moved 10%+ within five sessions.")
    if missed["fired"]:
        lines.append(f"{missed['fired']} alert(s) fired on names in your industries you were not watching; "
                     f"{missed['moved_10']} moved 10%+ after.")
    if beyond["fired"]:
        lines.append(f"Beyond your industries: {beyond['fired']} alert(s) fired across "
                     f"{beyond['industries']} industries; {beyond['moved_10']} moved 10%+ after.")
    return lines
