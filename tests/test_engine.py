"""The engine: scorer, triggers, replay, universe rule and the Lab endpoints.

The pure parts (engine_core, the trigger functions, the SIC map, the
replay resolver) run with no server and no database. The rest are live-API
checks like the other suites and need the dev fixture (db/bootstrap.py
--fixture) behind API_BASE.
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import engine, engine_core, replay, triggers, universe  # noqa: E402
from tests.test_lab import _raw as _raw3, admin_token  # noqa: E402


def _raw(method, path, body=None, token=None):
    st, body, _headers = _raw3(method, path, body, token)
    return st, body



# --------------------------------------------------------------------------
# engine_core
# --------------------------------------------------------------------------

def test_score_with_no_inputs_sits_near_neutral_with_assumed_catalyst():
    r = engine_core.score({}, as_of=date(2026, 6, 1))
    assert r["present"] == 2          # catalyst (assumed) and news (default heat)
    assert r["cov"] < 0.2
    assert 30 <= r["total"] <= 50
    assert r["band"] in ("neutral", "weak")


def test_rich_inputs_score_high_and_pass_filters():
    inputs = {"float_m": 12, "si_pct_float": 24, "dtc": 6, "fee_pct": 30, "cap_usd_m": 600,
              "growth_pct": 80, "earnings": "2026-06-15", "run3m_pct": -10, "off_high_pct": -40,
              "volx20d": 3.5, "heat": 0.9, "qual": 0.8}
    hf = [{"key": "cap", "op": "between", "value": [300e6, 3000e6]},
          {"key": "float", "op": "<", "value": 50e6},
          {"key": "si", "op": ">", "value": 10},
          {"key": "growth", "op": ">", "value": 40}]
    r = engine_core.score(inputs, as_of=date(2026, 6, 1), hard_filters=hf)
    assert r["total"] >= 72 and r["band"] == "strong"
    assert r["cov"] == 1.0 and r["shrinkage"] == 0.0
    assert all(f["pass"] for f in r["hard_filters"]) and len(r["hard_filters"]) == 4


def test_missing_inputs_shrink_toward_neutral_and_filters_stay_silent():
    strong = engine_core.score({"float_m": 12, "si_pct_float": 24, "cap_usd_m": 600,
                                "growth_pct": 80, "earnings": "2026-06-15"}, as_of=date(2026, 6, 1))
    partial = engine_core.score({"float_m": 12, "si_pct_float": 24}, as_of=date(2026, 6, 1))
    assert partial["cov"] < strong["cov"]
    assert partial["shrinkage"] > 0
    assert partial["total"] < strong["total"]
    assert partial["hard_filters"] == []    # no filters given, none invented


def test_haircut_and_preflags_cost_points():
    base = engine_core.score({"float_m": 20, "si_pct_float": 15}, as_of=date(2026, 6, 1))
    cut = engine_core.score({"float_m": 20, "si_pct_float": 15, "haircut": 10, "pre_flags": ["x"]},
                            as_of=date(2026, 6, 1))
    assert round(base["total"] - cut["total"], 1) == 15.0


def test_filter_units_convert_from_raw_to_millions():
    hf = [{"key": "cap", "op": "between", "value": [300e6, 3000e6]}]
    assert engine_core.check_hard_filters({"cap_usd_m": 500}, hf)[0]["pass"] is True
    assert engine_core.check_hard_filters({"cap_usd_m": 5000}, hf)[0]["pass"] is False


# --------------------------------------------------------------------------
# triggers (pure)
# --------------------------------------------------------------------------

def _bars(n, vol=1_000_000, start=date(2026, 1, 5)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append((d, 10.0, 10.5, 9.5, 10.0, vol))
        d += timedelta(days=1)
    return out


def test_volume_3x_fires_only_on_a_3x_session():
    bars = _bars(30)
    d = bars[-1][0]
    ctx = triggers.Ctx(bars, {}, [])
    assert triggers.t_volume_3x(ctx, d) is None
    bars[-1] = (d, 10.0, 10.5, 9.5, 10.0, 3_100_000)
    r = triggers.t_volume_3x(triggers.Ctx(bars, {}, []), d)
    assert r and r["inputs"]["volx20d"] >= 3.0 and "3.1x" in r["detail"]


def test_borrow_fee_needs_five_points_and_a_doubling():
    on = date(2026, 3, 2)
    hist = [(on - timedelta(days=k), "4.0") for k in range(10, 0, -1)]
    ctx = triggers.Ctx([], {"fee_pct": hist + [(on, "9.0")]}, [])
    r = triggers.t_borrow_fee_2x(ctx, on)
    assert r and r["inputs"]["x"] >= 2.0
    few = triggers.Ctx([], {"fee_pct": hist[-3:] + [(on, "9.0")]}, [])
    assert triggers.t_borrow_fee_2x(few, on) is None
    flat = triggers.Ctx([], {"fee_pct": hist + [(on, "6.0")]}, [])
    assert triggers.t_borrow_fee_2x(flat, on) is None


def test_si_cross_fires_upward_across_a_line_only():
    on = date(2026, 3, 2)
    up = triggers.Ctx([], {"si_pct_float": [(on - timedelta(days=14), "12.0"), (on, "16.5")]}, [])
    r = triggers.t_si_cross(up, on)
    assert r and r["inputs"]["line"] == 15.0
    down = triggers.Ctx([], {"si_pct_float": [(on - timedelta(days=14), "16.5"), (on, "12.0")]}, [])
    assert triggers.t_si_cross(down, on) is None
    same = triggers.Ctx([], {"si_pct_float": [(on - timedelta(days=14), "12.0"), (on, "13.0")]}, [])
    assert triggers.t_si_cross(same, on) is None


def test_catalyst_dated_fires_when_a_date_appears_or_moves():
    on = date(2026, 3, 2)
    new = triggers.Ctx([], {"earnings": [(on, "2026-03-20")]}, [])
    assert triggers.t_catalyst_dated(new, on)["inputs"]["previous"] is None
    same = triggers.Ctx([], {"earnings": [(on - timedelta(days=3), "2026-03-20"), (on, "2026-03-20")]}, [])
    assert triggers.t_catalyst_dated(same, on) is None
    moved = triggers.Ctx([], {"earnings": [(on - timedelta(days=3), "2026-03-20"), (on, "2026-03-27")]}, [])
    assert "moved from 2026-03-20" in triggers.t_catalyst_dated(moved, on)["detail"]
    far = triggers.Ctx([], {"earnings": [(on, "2026-09-01")]}, [])
    assert triggers.t_catalyst_dated(far, on) is None


def test_s3_424b_fires_on_dilution_forms_only():
    on = date(2026, 3, 2)
    ctx = triggers.Ctx([], {}, [(on, "8-K", "2.02"), (on, "424B5", "")])
    assert "424B5" in triggers.t_s3_424b(ctx, on)["detail"]
    assert triggers.t_s3_424b(triggers.Ctx([], {}, [(on, "8-K", "2.02")]), on) is None


def test_registry_states_a_source_for_every_product_trigger():
    for key in ("borrow_fee_2x", "si_cross", "volume_3x", "catalyst_dated", "s3_424b",
                "band_change", "insider_buying", "social_surge", "contract_award"):
        meta = triggers.REGISTRY[key]
        assert meta["source"] and meta["note"]
        assert isinstance(meta["live"], bool) and isinstance(meta["replay"], bool)
    assert set(triggers.evaluable(None, "replay")) == set(triggers.FUNCS)
    assert "insider_buying" not in triggers.evaluable(None, "live")


def test_live_window_sees_last_sessions_spike_and_old_si_print():
    # The pass runs on a Monday before the open: the newest bar is Friday's.
    bars = _bars(30, start=date(2026, 8, 31))
    friday = bars[-1][0]
    monday = friday + timedelta(days=3)
    bars[-1] = (friday, 10.0, 10.5, 9.5, 10.0, 3_500_000)
    settlement = monday - timedelta(days=12)           # published a week after settling
    snaps = {"si_pct_float": [(settlement - timedelta(days=14), "12.0"), (settlement, "16.0")]}
    ctx = triggers.Ctx(bars, snaps, [])
    # what the first build did: evaluate on the calendar day only, and see nothing
    assert triggers.evaluate(ctx, monday, ["volume_3x", "si_cross"]) == []
    got = {(k, d) for k, d, _ in triggers.live_candidates(ctx, monday, ["volume_3x", "si_cross"])}
    assert got == {("volume_3x", friday), ("si_cross", settlement)}


def test_live_window_stops_at_each_triggers_lookback():
    bars = _bars(40, start=date(2026, 8, 3))
    old = bars[-8][0]
    bars[-8] = (old, 10.0, 10.5, 9.5, 10.0, 3_500_000)
    ctx = triggers.Ctx(bars, {}, [])
    today = bars[-1][0] + timedelta(days=1)
    assert (today - old).days > triggers.LIVE_LOOKBACK_DAYS["volume_3x"]
    assert triggers.live_candidates(ctx, today, ["volume_3x"]) == []


def test_engine_switch_reads_engine_live(monkeypatch):
    monkeypatch.delenv("ENGINE_LIVE", raising=False)
    assert engine.engine_live() is False
    monkeypatch.setenv("ENGINE_LIVE", "0")
    assert engine.engine_live() is False
    monkeypatch.setenv("ENGINE_LIVE", "1")
    assert engine.engine_live() is True


def test_research_row_carries_haircut_and_quality():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "db"))
    import json
    import seed_research
    meta = json.loads(seed_research.META.read_text(encoding="utf-8"))
    cut = next(t for t in meta["HAIRCUTS"])
    row = next(r for r in meta["SHORTLIST"] if r.get("ticker") == cut)
    values = seed_research.research_row(meta, row)
    assert values[3] == meta["HAIRCUTS"][cut][0] and values[4]


# --------------------------------------------------------------------------
# replay resolver (pure)
# --------------------------------------------------------------------------

def test_resolve_measures_the_largest_move_and_its_session():
    bars = _bars(40)
    i = 20
    bars[i + 3] = (bars[i + 3][0], 10.0, 13.0, 9.9, 12.5, 1_000_000)   # +30% high on session 3
    r = replay.resolve(bars, i)
    assert r["resolved"] and r["hit"] and r["peak_after_sessions"] == 3
    assert r["fwd_max_5d"] == 30.0 and r["fwd_close_5d"] == 0.0
    assert replay.resolve(bars, len(bars) - 3) is None


# --------------------------------------------------------------------------
# universe rule (pure)
# --------------------------------------------------------------------------

def test_sic_map_is_one_to_one_and_excludes_spacs():
    assert universe.industry_for_sic("3674") == "semiconductors"
    assert universe.industry_for_sic("2834") == "biotech_pharma"
    assert universe.industry_for_sic("6770") is None
    assert universe.industry_for_sic("") is None
    doc = {"fields": ["cik", "name", "ticker", "exchange"],
           "data": [[1, "A Corp", "AAA", "Nasdaq"], [2, "B Warrant", "BBB-WT", "NYSE"],
                    [3, "C OTC", "CCC", "OTC"], [4, "D Inc", "DDD", "NYSE American"]]}
    assert [c[2] for c in universe.listed_companies(doc)] == ["AAA", "DDD"]


# --------------------------------------------------------------------------
# live API
# --------------------------------------------------------------------------

@pytest.fixture(scope="module")
def tok():
    return admin_token()


def test_engine_routes_are_404_to_anonymous_and_non_admin():
    st, body = _raw("GET", "/admin/lab/engine/status")
    assert st == 404
    st, _ = _raw("POST", "/admin/lab/engine/replay", {"from_date": "2026-01-01", "to_date": "2026-02-01"})
    assert st == 404


def test_status_names_universe_data_triggers_and_records(tok):
    st, d = _raw("GET", "/admin/lab/engine/status", token=tok)
    assert st == 200
    assert d["universe"]["active"] > 0 and d["universe"]["industries"]
    assert "bars" in d["data"] and "provider" in d["data"]["bars"]
    keys = {t["key"] for t in d["triggers"]}
    assert {"volume_3x", "s3_424b", "insider_buying"} <= keys
    assert all("source" in t and "note" in t for t in d["triggers"])
    assert any(r["key"] == "fast_mover" for r in d["records"])


def test_score_dry_run_on_a_past_date_writes_nothing(tok):
    st, before = _raw("GET", "/admin/lab/engine/status", token=tok)
    past = (date.today() - timedelta(days=30)).isoformat()
    st, s = _raw("POST", "/admin/lab/engine/score", {"as_of": past, "write": True}, token=tok)
    assert st == 200 and s["written"] is False and s["scored"] > 0 and s["as_of"] == past
    st, after = _raw("GET", "/admin/lab/engine/status", token=tok)
    assert [r["id"] for r in after["runs"]] == [r["id"] for r in before["runs"]]


def test_score_today_writes_only_while_the_engine_is_live(tok):
    st, before = _raw("GET", "/admin/lab/engine/status", token=tok)
    st, s = _raw("POST", "/admin/lab/engine/score", {}, token=tok)
    assert st == 200 and s["scored"] > 0
    st, d = _raw("GET", "/admin/lab/engine/status", token=tok)
    if before["engine_live"]:
        assert s["written"] and s["run_id"] and s["dry_run_reason"] is None
        assert d["runs"][0]["id"] == s["run_id"] and d["runs"][0]["status"] == "completed"
    else:
        # off: a dry run that leaves the run subscribers read untouched
        assert s["written"] is False and s["run_id"] is None and "ENGINE_LIVE" in s["dry_run_reason"]
        assert [r["id"] for r in d["runs"]] == [r["id"] for r in before["runs"]]


def test_status_reports_the_switch_and_research_coverage(tok):
    st, d = _raw("GET", "/admin/lab/engine/status", token=tok)
    assert st == 200 and isinstance(d["engine_live"], bool)
    assert 0 <= d["data"]["research_rows"] <= d["universe"]["active"]


def test_triggers_dry_run_returns_the_registry_slice(tok):
    st, r = _raw("POST", "/admin/lab/engine/triggers", {"triggers": ["volume_3x", "insider_buying"], "write": False},
                 token=tok)
    assert st == 200 and r["evaluated"] == ["volume_3x"] and r["instruments"] > 0
    assert r["write"] is False and r["written"] == 0 and r["lookback_days"] == {"volume_3x": 5}


def test_triggers_on_a_past_date_never_write(tok):
    past = (date.today() - timedelta(days=40)).isoformat()
    st, r = _raw("POST", "/admin/lab/engine/triggers", {"on": past, "write": True}, token=tok)
    assert st == 200 and r["write"] is False and r["written"] == 0 and "past date" in r["dry_run_reason"]


def test_replay_runs_resolves_and_is_marked_synthetic_on_the_fixture(tok):
    body = {"from_date": (date.today() - timedelta(days=200)).isoformat(),
            "to_date": (date.today() - timedelta(days=30)).isoformat(),
            "triggers": ["volume_3x", "s3_424b"], "note": "suite"}
    st, s = _raw("POST", "/admin/lab/engine/replay", body, token=tok)
    assert st == 200, s
    assert s["replay_run_id"] and s["sessions"] > 100 and s["instruments"] > 0
    assert set(s["by_trigger"]) == {"volume_3x", "s3_424b"}
    assert s["baseline"]["n"] > 0 and s["baseline"]["ci"]
    assert "insider_buying" in s["not_replayed"]
    assert s["synthetic_data_used"] is True
    rid = s["replay_run_id"]
    st, one = _raw("GET", f"/admin/lab/engine/replay/{rid}", token=tok)
    assert st == 200 and one["status"] == "completed" and one["summary"]["alerts"] == s["alerts"]
    # a synthetic replay can never become the published record
    st, _ = _raw("POST", f"/admin/lab/engine/replay/{rid}/publish", {"strategy_key": "fast_mover"}, token=tok)
    assert st == 409


def test_replay_rejects_a_backwards_span(tok):
    st, _ = _raw("POST", "/admin/lab/engine/replay",
                 {"from_date": "2026-03-01", "to_date": "2026-02-01"}, token=tok)
    assert st == 422


def test_universe_rule_is_served_with_counts(tok):
    st, u = _raw("GET", "/admin/lab/engine/universe", token=tok)
    assert st == 200
    assert "semiconductors" in u["sic_map"] and "6770" in u["excluded_sic"]
    assert u["cap_band_m"] == [50.0, 5000.0]
    assert isinstance(u["counts"], dict)
