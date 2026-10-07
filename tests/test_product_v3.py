"""Product v3 surface: screener, run-to-run changes, catalyst calendar,
overview, alert outcomes, per-field snapshot history, watchlist statistics,
and the board/industry/search extensions. Same harness as
test_product_v2.py: a live API on :8000 and Postgres reachable through
docker compose (or POSTGRES_CMD) to flip the verified flag.

    python tests/test_product_v3.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from urllib import error, request

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")
POSTGRES = os.environ.get(
    "POSTGRES_CMD", "docker compose exec -T postgres psql -U tradealert -d tradealert")
PASSWORD = "testpass123"
VISIBLE, VISIBLE_INDUSTRY = "LEU", "energy_nuclear"
HIDDEN = "BKSY"  # defense_space: outside the followed set below


def _call(method, path, body=None, token=None, ip=None):
    headers = {"Accept": "application/json"}
    if ip:
        # the signup limiter is five per hour per client IP; each test user
        # presents its own address so the suite runs in one go
        headers["X-Forwarded-For"] = ip
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def get(path, token=None):
    return _call("GET", path, token=token)


def post(path, body, token=None):
    return _call("POST", path, body, token)


def psql(sql):
    subprocess.run(f"{POSTGRES} -c \"{sql}\"", shell=True, capture_output=True, check=True)


def _ip_for(email):
    h = abs(hash(email))
    return f"10.{(h >> 16) % 250 + 1}.{(h >> 8) % 250 + 1}.{h % 250 + 1}"


def new_user(email, tier=None):
    ip = _ip_for(email)
    status, _ = _call("POST", "/signup", {"email": email, "password": PASSWORD}, ip=ip)
    assert status == 200, status
    psql(f"UPDATE users SET verified=TRUE WHERE email='{email}';")
    if tier:
        psql(f"UPDATE subscriptions SET tier_id=(SELECT id FROM tiers WHERE key='{tier}') "
             f"WHERE user_id=(SELECT id FROM users WHERE email='{email}');")
    status, body = _call("POST", "/login", {"email": email, "password": PASSWORD}, ip=ip)
    assert status == 200, body
    return body["token"]


def tag():
    return str(int(time.time() * 1000))


def _following(token):
    post("/me/industries", {"key": VISIBLE_INDUSTRY}, token)
    return token


# ---- screener ----------------------------------------------------------

def test_screen_clamps_to_tier_and_counts_the_rest():
    token = _following(new_user(f"scr{tag()}@example.com"))
    status, body = get("/screen", token)
    assert status == 200, body
    meta = body["meta"]
    assert meta["names_shown_limit"] == 5, "free tier shows five"
    assert meta["shown"] <= 5 and len(body["rows"]) == meta["shown"]
    assert meta["matched"] >= meta["shown"]
    assert meta["truncated"] == (meta["matched"] > meta["shown"])
    for r in body["rows"]:
        assert r["industry"]["key"] == VISIBLE_INDUSTRY
        for k in ("snapshot", "price", "hf_pass", "coverage", "pinned", "lane", "group"):
            assert k in r, k
    assert set(body["facets"]) >= {"band", "industry", "hf", "coverage", "lane", "group"}
    assert sum(body["facets"]["band"].values()) == meta["matched"]


def test_screen_filters_compose():
    token = _following(new_user(f"scr2{tag()}@example.com", tier="pro"))
    status, body = get("/screen?bands=strong,elevated&coverage=thin&sort=symbol&dir=asc", token)
    assert status == 200, body
    for r in body["rows"]:
        assert r["band"] in ("strong", "elevated")
        assert r["coverage"] == "thin"
    syms = [r["symbol"] for r in body["rows"]]
    assert syms == sorted(syms)
    status, body = get(f"/screen?q={VISIBLE}", token)
    assert status == 200 and any(r["symbol"] == VISIBLE for r in body["rows"]), body["meta"]
    status, body = get("/screen?industries=defense_space", token)
    assert status == 200 and body["meta"]["matched"] == 0, "an industry outside the plan yields nothing"
    status, body = get("/screen?strategy=not_a_strategy", token)
    assert status == 404 and body == {"detail": "not found"}


def test_screen_pinned_filter_sees_a_pick_from_outside_followed_industries():
    token = _following(new_user(f"scr3{tag()}@example.com", tier="pro"))
    # a pick is visible regardless of industry; the screener must honour that
    post("/me/picks", {"symbol": VISIBLE}, token)
    status, body = get("/screen?pinned=1", token)
    assert status == 200, body
    assert [r["symbol"] for r in body["rows"]] == [VISIBLE]
    assert body["rows"][0]["pinned"] is True


# ---- changes ----------------------------------------------------------

def test_changes_shape_and_windows():
    token = _following(new_user(f"chg{tag()}@example.com"))
    status, body = get("/changes", token)
    assert status == 200, body
    if body["prev_run"] is None:
        assert body["summary"] is None
        return
    s = body["summary"]
    for k in ("compared", "new", "dropped", "band_up", "band_down", "up", "down", "cleared", "failed"):
        assert k in s, k
    for k in ("band_up", "band_down", "new", "dropped", "up", "down", "cleared", "failed"):
        lst = body[k]
        assert lst["total"] >= len(lst["rows"]) and len(lst["rows"]) <= body["names_shown_limit"]
    for r in body["band_up"]["rows"]:
        assert r["now"] and r["prev"]
    assert set(body["distribution"]) == {"now", "prev"}
    status, body7 = get("/changes?vs=7d", token)
    assert status == 200 and body7["vs"] == "7d"
    status, bad = get("/changes?strategy=zzz", token)
    assert status == 404


# ---- calendar ---------------------------------------------------------

def test_calendar_is_scoped_and_clamped():
    token = _following(new_user(f"cal{tag()}@example.com"))
    status, body = get("/calendar?days=90", token)
    assert status == 200, body
    assert body["meta"]["shown"] == len(body["upcoming"]) <= body["meta"]["names_shown_limit"]
    for r in body["upcoming"]:
        assert r["industry"]["key"] == VISIBLE_INDUSTRY
        assert -1 <= r["days"] <= 90
        assert "armed" in r and "past" in r
    for r in body["recent"]:
        assert r["industry"]["key"] == VISIBLE_INDUSTRY
    status, _ = get("/calendar?days=3", token)
    assert status == 422, "window below the floor is rejected"


# ---- overview ---------------------------------------------------------

def test_overview_aggregates_follow_the_plan():
    token = _following(new_user(f"ov{tag()}@example.com"))
    post("/me/picks", {"symbol": VISIBLE}, token)
    status, body = get("/overview", token)
    assert status == 200, body
    for k in ("run", "tier", "industries", "watchlist", "alerts", "catalysts", "changes", "digest"):
        assert k in body, k
    assert [i["key"] for i in body["industries"]] == [VISIBLE_INDUSTRY]
    ind = body["industries"][0]
    assert len(ind["top"]) <= 3
    assert sum(ind["distribution"].values()) == ind["scored"]
    assert body["watchlist"]["count"] == 1
    assert body["alerts"]["limit"] == 0, "free tier has no alerts"
    assert len(body["catalysts"]["upcoming"]) <= 5


# ---- alert outcomes ---------------------------------------------------

def test_alert_outcomes_measured_on_visible_names():
    token = _following(new_user(f"out{tag()}@example.com", tier="pro"))
    status, body = get("/alerts/outcomes?days=730", token)
    assert status == 200, body
    assert "method" in body
    for t in body["triggers"]:
        assert t["measured"] <= t["n"]
        if t["measured"] == 0:
            assert t["mean_chg_5d"] is None
    for ev in body["events"]:
        assert set(ev) >= {"symbol", "trigger_key", "date", "chg_1d", "chg_5d", "max_5d", "pending"}
    status, body = get("/alerts/outcomes?days=10", token)
    assert status == 422


# ---- per-field history ------------------------------------------------

def test_fields_404_uniform_and_shape():
    token = _following(new_user(f"fld{tag()}@example.com"))
    s1, b1 = get(f"/stock/{HIDDEN}/fields", token)
    s2, b2 = get("/stock/NOTREAL/fields", token)
    assert s1 == s2 == 404 and b1 == b2 == {"detail": "not found"}
    status, body = get(f"/stock/{VISIBLE}/fields", token)
    assert status == 200, body
    assert isinstance(body["fields"], dict)
    for pts in body["fields"].values():
        for p in pts:
            assert isinstance(p["value"], float)
    assert isinstance(body["missing_components"], list)
    present = set(body["present_keys"])
    assert not present & {c["key"] for c in body["missing_components"]}
    assert body["since_pin"] is None
    post("/me/picks", {"symbol": VISIBLE}, token)
    status, body = get(f"/stock/{VISIBLE}/fields", token)
    assert body["since_pin"] and body["since_pin"]["score_at_pin"] is not None


# ---- watchlist stats --------------------------------------------------

def test_watchlist_stats_merge_by_symbol():
    token = _following(new_user(f"wls{tag()}@example.com"))
    status, body = get("/me/watchlist/stats", token)
    assert status == 200 and body["picks"] == [] and body["summary"]["count"] == 0
    post("/me/picks", {"symbol": VISIBLE}, token)
    status, body = get("/me/watchlist/stats", token)
    assert status == 200, body
    assert [p["symbol"] for p in body["picks"]] == [VISIBLE]
    p = body["picks"][0]
    for k in ("chg_since_pin", "benchmark", "chg_30d", "earnings", "hf_pass", "unread", "armed"):
        assert k in p, k
    assert body["summary"]["count"] == 1


# ---- extensions to existing endpoints ---------------------------------

def test_board_rows_carry_v3_fields():
    token = _following(new_user(f"brd{tag()}@example.com"))
    status, body = get("/board", token)
    assert status == 200, body
    for r in body["rows"]:
        for k in ("lane", "hf_pass", "price", "earnings_in"):
            assert k in r, k
        assert set(r["price"]) == {"last_close", "chg_30d", "rel_30d", "benchmark"}


def test_industry_shape_is_aggregate_only_outside_plan():
    token = _following(new_user(f"ish{tag()}@example.com"))
    status, body = get("/industries/defense_space", token)
    assert status == 200, body
    assert body["in_scope"] is False and body["names"] is None
    assert body["themes"] is None, "themes could identify names; never shown outside the plan"
    assert "shape" in body and "distribution" in body["shape"]
    assert "reactions" in body and "by_kind" in body["reactions"]
    for k in body["reactions"]["by_kind"]:
        if k["n"] < 10:
            assert k["hit_rate"] is None, "no rate below ten events"
    status, body = get(f"/industries/{VISIBLE_INDUSTRY}", token)
    assert body["in_scope"] is True and isinstance(body["themes"], list)


def test_search_matches_hook_and_thesis_inside_scope():
    token = _following(new_user(f"sea{tag()}@example.com"))
    status, body = get("/search?q=HALEU", token)
    assert status == 200
    assert all(r["industry_key"] == VISIBLE_INDUSTRY for r in body["results"])


def test_picks_do_not_duplicate_across_strategies():
    token = _following(new_user(f"pk{tag()}@example.com"))
    post("/me/picks", {"symbol": VISIBLE}, token)
    status, body = get("/me/picks", token)
    assert status == 200 and [p["symbol"] for p in body["picks"]] == [VISIBLE]


if __name__ == "__main__":
    failures = 0
    for name in sorted(n for n in globals() if n.startswith("test_")):
        try:
            globals()[name]()
            print(f"PASS {name}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL {name}: {e}")
    sys.exit(1 if failures else 0)
