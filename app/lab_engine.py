"""Lab: the engine screen. Admin-only, uniform 404 to everyone else, like the
rest of /api/admin.

  GET  /api/admin/lab/engine/status           universe, data freshness, latest run,
                                              trigger registry with live counts, replays
  POST /api/admin/lab/engine/score            score the universe now (writes a run)
  POST /api/admin/lab/engine/triggers         evaluate the live triggers now
  POST /api/admin/lab/engine/replay           run a replay (synchronous; seconds)
  GET  /api/admin/lab/engine/replay/{id}      one replay: summary and sample rows
  POST /api/admin/lab/engine/replay/{id}/publish   make it the strategy's record
  GET  /api/admin/lab/engine/universe         the SIC rules and current counts
  POST /api/admin/lab/engine/universe/plan    what the rule would admit (network)
  POST /api/admin/lab/engine/universe/apply   write it
  POST /api/admin/lab/engine/ingest           filings | bars | events, with a limit

Long passes (a full bar refresh, two years of filings for every name) are
the worker's; the ingest endpoint takes a limit so an operator can spot
check a source from the Lab without tying up the API.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app import engine, providers, replay, triggers, universe
from app.db import get_conn
from app.lab import _admin_404, _no_cache, _require_admin, bearer
from app.context import user_id

router = APIRouter()
DEPS = [Depends(_no_cache)]


def _status(cur):
    now = datetime.now(timezone.utc)
    cur.execute("SELECT ind.key, ind.label, i.origin, COUNT(*) FILTER (WHERE i.active), COUNT(*) "
                "FROM instruments i JOIN industries ind ON ind.id = i.industry_id "
                "GROUP BY 1, 2, 3 ORDER BY 1, 3")
    uni = {}
    for key, label, origin, active, total in cur.fetchall():
        d = uni.setdefault(key, {"key": key, "label": label, "active": 0, "total": 0, "origins": {}})
        d["active"] += active
        d["total"] += total
        d["origins"][origin] = active
    cur.execute("SELECT COUNT(*) FROM instruments WHERE active")
    active_total = cur.fetchone()[0]

    # data: bars, snapshots by group, filings
    cur.execute("SELECT COUNT(DISTINCT ticker_id), MAX(d), MIN(d), "
                "COUNT(DISTINCT ticker_id) FILTER (WHERE d >= CURRENT_DATE - 5), "
                "array_agg(DISTINCT source) FROM price_bars")
    tk, maxd, mind, fresh, srcs = cur.fetchone()
    data = {"bars": {"tickers": tk, "latest": str(maxd) if maxd else None, "earliest": str(mind) if mind else None,
                     "fresh_tickers": fresh, "sources": srcs or [],
                     "provider": providers.active_provider()}}
    cur.execute("SELECT field, COUNT(DISTINCT ticker_id), MAX(as_of), array_agg(DISTINCT source) "
                "FROM snapshots WHERE field IN ('cap_usd_m','si_pct_float','fee_pct','earnings','px') "
                "GROUP BY field")
    data["snapshots"] = {f: {"tickers": n, "latest": m.isoformat() if m else None, "sources": s}
                         for f, n, m, s in cur.fetchall()}
    cur.execute("SELECT COUNT(*), COUNT(DISTINCT ticker_id), MAX(filed_on) FROM filings")
    n, t, m = cur.fetchone()
    data["filings"] = {"rows": n, "tickers": t, "latest": str(m) if m else None}
    cur.execute("SELECT COUNT(*) FROM tickers WHERE sic <> ''")
    data["tickers_with_sic"] = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM instrument_research ir JOIN instruments i ON i.id = ir.instrument_id "
                "WHERE i.active")
    data["research_rows"] = cur.fetchone()[0]
    cur.execute("SELECT source, status, started_at, finished_at, ok_count, fail_count, rows_written "
                "FROM source_runs ORDER BY id DESC LIMIT 12")
    data["recent_passes"] = [{"source": s, "status": st, "started_at": a.isoformat(),
                              "finished_at": f.isoformat() if f else None,
                              "ok": ok, "failed": fl, "rows": rw}
                             for s, st, a, f, ok, fl, rw in cur.fetchall()]

    # latest run
    cur.execute("SELECT r.id, r.as_of, r.status, r.completed_at, COUNT(sc.id), "
                "COUNT(sc.id) FILTER (WHERE sc.band = 'strong'), "
                "COUNT(sc.id) FILTER (WHERE sc.band = 'elevated'), "
                "COUNT(sc.id) FILTER (WHERE sc.delta_1d IS NOT NULL) "
                "FROM runs r LEFT JOIN scores sc ON sc.run_id = r.id "
                "GROUP BY r.id ORDER BY r.as_of DESC, r.id DESC LIMIT 5")
    runs = [{"id": i, "as_of": a.isoformat(), "status": s, "completed_at": c.isoformat() if c else None,
             "scored": n, "strong": st, "elevated": el, "with_delta": wd}
            for i, a, s, c, n, st, el, wd in cur.fetchall()]

    # triggers: registry + live counts
    cur.execute("SELECT t.key, COUNT(ae.id) FILTER (WHERE ae.fired_at > %s), "
                "COUNT(ae.id) FILTER (WHERE ae.fired_at > %s), MAX(ae.fired_at) "
                "FROM triggers t LEFT JOIN alert_events ae ON ae.trigger_id = t.id "
                "GROUP BY t.key", (now - timedelta(days=7), now - timedelta(days=30)))
    counts = {k: (w, m, last) for k, w, m, last in cur.fetchall()}
    trig = []
    for key, meta in triggers.REGISTRY.items():
        w, m, last = counts.get(key, (0, 0, None))
        trig.append({"key": key, **meta, "fired_7d": w, "fired_30d": m,
                     "last_fired": last.isoformat() if last else None})

    cur.execute("SELECT id, status, started_at, finished_at, from_date, to_date, params_json, "
                "instruments_count, sessions_count, alerts_count, note, summary_json "
                "FROM replay_runs ORDER BY id DESC LIMIT 10")
    replays = []
    for i, st, a, f, fd, td, p, ic, sc, ac, note, summ in cur.fetchall():
        ov = (summ or {}).get("overall") or {}
        replays.append({"id": i, "status": st, "started_at": a.isoformat(),
                        "finished_at": f.isoformat() if f else None, "from": str(fd), "to": str(td),
                        "triggers": (p or {}).get("triggers", []), "instruments": ic, "sessions": sc,
                        "alerts": ac, "note": note, "hits": ov.get("hits"), "n": ov.get("n"),
                        "hit_rate": ov.get("hit_rate"), "synthetic": bool((summ or {}).get("synthetic_data_used"))})
    cur.execute("SELECT key, record_hits, record_n, record_source FROM strategies ORDER BY sort_order")
    records = [{"key": k, "hits": h, "n": n, "source": s} for k, h, n, s in cur.fetchall()]
    return {"engine_live": engine.engine_live(),
            "universe": {"active": active_total, "industries": list(uni.values())},
            "data": data, "runs": runs, "triggers": trig, "replays": replays, "records": records,
            "now": now.isoformat()}


@router.get("/api/admin/lab/engine/status", dependencies=DEPS)
def engine_status(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            return _status(cur)
    finally:
        conn.close()


class ScoreIn(BaseModel):
    as_of: str | None = None          # ISO date; a past date is a dry run
    write: bool = True


@router.post("/api/admin/lab/engine/score", dependencies=DEPS)
def engine_score(body: ScoreIn, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        on = date.fromisoformat(body.as_of) if body.as_of else None
        s = engine.score_run(conn, as_of=on, write=body.write)
        s.pop("results", None)
        return s
    finally:
        conn.close()


class TriggersIn(BaseModel):
    on: str | None = None
    triggers: list[str] | None = None
    write: bool = True


@router.post("/api/admin/lab/engine/triggers", dependencies=DEPS)
def engine_triggers(body: TriggersIn, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        on = date.fromisoformat(body.on) if body.on else None
        return triggers.fire_live(conn, on=on, keys=body.triggers, write=body.write)
    finally:
        conn.close()


class ReplayIn(BaseModel):
    from_date: str
    to_date: str
    triggers: list[str] | None = None
    industries: list[str] | None = None
    baseline_per_instrument: int = Field(default=replay.BASELINE_PER_INSTRUMENT, ge=0, le=30)
    note: str = Field(default="", max_length=300)


@router.post("/api/admin/lab/engine/replay", dependencies=DEPS)
def engine_replay(body: ReplayIn, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    try:
        f, t = date.fromisoformat(body.from_date), date.fromisoformat(body.to_date)
    except ValueError:
        raise HTTPException(422, "dates must be ISO")
    if t <= f or (t - f).days > 366 * 5:
        raise HTTPException(422, "a replay covers from one day to five years")
    conn = get_conn()
    try:
        s = replay.run_replay(conn, f, t, keys=body.triggers, industry_keys=body.industries,
                              admin_id=user_id(admin), baseline_per_instrument=body.baseline_per_instrument,
                              note=body.note)
        return s
    finally:
        conn.close()


@router.get("/api/admin/lab/engine/replay/{rid}", dependencies=DEPS)
def engine_replay_get(rid: int, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status, summary_json, note, from_date, to_date, started_at, finished_at "
                        "FROM replay_runs WHERE id = %s", (rid,))
            row = cur.fetchone()
            if not row:
                _admin_404()
            cur.execute("SELECT t.symbol, tr.key, ra.fired_on, ra.detail, ra.fwd_close_5d, ra.fwd_max_5d, "
                        "ra.vol_spike_x, ra.peak_after_sessions, ra.hit, ra.resolved "
                        "FROM replay_alerts ra JOIN instruments i ON i.id = ra.instrument_id "
                        "JOIN tickers t ON t.id = i.ticker_id JOIN triggers tr ON tr.id = ra.trigger_id "
                        "WHERE ra.replay_run_id = %s AND NOT ra.baseline "
                        "ORDER BY ra.fired_on DESC, t.symbol LIMIT 200", (rid,))
            rows = [{"symbol": s, "trigger": k, "fired_on": str(d), "detail": dt,
                     "fwd_close_5d": None if c5 is None else float(c5),
                     "fwd_max_5d": None if m5 is None else float(m5),
                     "vol_spike_x": None if vx is None else float(vx),
                     "peak_after_sessions": pk, "hit": h, "resolved": r}
                    for s, k, d, dt, c5, m5, vx, pk, h, r in cur.fetchall()]
            return {"id": rid, "status": row[0], "summary": row[1], "note": row[2],
                    "from": str(row[3]), "to": str(row[4]), "started_at": row[5].isoformat(),
                    "finished_at": row[6].isoformat() if row[6] else None, "alerts": rows}
    finally:
        conn.close()


class PublishIn(BaseModel):
    strategy_key: str = "fast_mover"


@router.post("/api/admin/lab/engine/replay/{rid}/publish", dependencies=DEPS)
def engine_replay_publish(rid: int, body: PublishIn,
                          creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        try:
            return replay.publish_record(conn, rid, body.strategy_key)
        except ValueError as e:
            raise HTTPException(409, str(e))
    finally:
        conn.close()


@router.get("/api/admin/lab/engine/universe", dependencies=DEPS)
def engine_universe(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn = get_conn()
    try:
        return {"sic_map": {k: sorted(v) for k, v in universe.SIC_MAP.items()},
                "excluded_sic": sorted(universe.EXCLUDED_SIC),
                "exchanges": sorted(universe.EXCHANGES),
                "cap_band_m": [universe.DEFAULT_CAP_MIN_M, universe.DEFAULT_CAP_MAX_M],
                "counts": universe.counts(conn)}
    finally:
        conn.close()


class UniverseIn(BaseModel):
    cap_min_m: float = universe.DEFAULT_CAP_MIN_M
    cap_max_m: float = universe.DEFAULT_CAP_MAX_M
    fetch_identity: bool = False     # one EDGAR call per unknown company; minutes, not seconds
    limit: int | None = Field(default=None, ge=1, le=20000)


def _plan(body):
    conn = get_conn()
    try:
        try:
            p = universe.plan(conn, None, body.cap_min_m, body.cap_max_m,
                              fetch_identity=body.fetch_identity, limit=body.limit, verbose=False)
        except Exception as e:
            raise HTTPException(502, f"SEC listing unavailable: {type(e).__name__}")
        return conn, p
    except HTTPException:
        conn.close()
        raise


@router.post("/api/admin/lab/engine/universe/plan", dependencies=DEPS)
def engine_universe_plan(body: UniverseIn, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn, p = _plan(body)
    conn.close()
    rows = p.pop("rows")
    p["sample"] = [{"symbol": r[1], "name": r[2], "exchange": r[3], "sic": r[4], "industry": r[5],
                    "cap_m": r[6]} for r in rows[:50]]
    return p


@router.post("/api/admin/lab/engine/universe/apply", dependencies=DEPS)
def engine_universe_apply(body: UniverseIn, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    conn, p = _plan(body)
    try:
        out = universe.apply(conn, p)
        p.pop("rows")
        return {**p, **out}
    finally:
        conn.close()


class IngestIn(BaseModel):
    what: str = Field(pattern="^(filings|bars|events)$")
    limit: int = Field(default=20, ge=1, le=200)


@router.post("/api/admin/lab/engine/ingest", dependencies=DEPS)
def engine_ingest(body: IngestIn, creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    _require_admin(creds)
    try:
        if body.what == "filings":
            from app.filings_ingest import ingest_filings
            return ingest_filings(limit=body.limit, verbose=False)
        if body.what == "bars":
            from app.market_data import refresh_all
            return refresh_all(rng="1mo", limit=body.limit, verbose=False)
        from app.events_ingest import ingest_earnings
        return ingest_earnings(limit=body.limit, verbose=False)
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {str(e)[:120]}")
