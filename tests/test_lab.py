from __future__ import annotations

import json
import subprocess
import sys
import time
from urllib import error, request

BASE = "http://127.0.0.1:8000/api"
POSTGRES = "docker compose exec -T postgres psql -U tradealert -d tradealert"

ADMIN_EMAIL = "tester@example.com"
ADMIN_PASS = "password123"


def _raw(method, path, body=None, token=None):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}"), dict(r.headers)
    except error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}"), dict(e.headers)
        except json.JSONDecodeError:
            return e.code, {}, dict(e.headers)


def get(path, token=None):
    return _raw("GET", path, None, token)


def post(path, body=None, token=None):
    return _raw("POST", path, body, token)


def patch(path, body=None, token=None):
    return _raw("PATCH", path, body, token)


def psql(sql):
    subprocess.run(
        f"{POSTGRES} -c \"{sql}\"",
        shell=True,
        capture_output=True,
        check=True,
    )


_SHARED = {}


def admin_token():
    if "admin" not in _SHARED:
        status, body, _ = post("/login", {"email": ADMIN_EMAIL,
                                          "password": ADMIN_PASS})
        assert status == 200, body
        _SHARED["admin"] = body["token"]
    return _SHARED["admin"]


def non_admin_token():
    if "nonadmin" not in _SHARED:
        tag = str(int(time.time()))
        email = f"labuser{tag}@example.com"
        status, _, _ = post("/signup", {"email": email, "password": "testpass123"})
        assert status == 200
        status, body, _ = post("/login", {"email": email, "password": "testpass123"})
        assert status == 200, body
        psql(f"UPDATE users SET verified=TRUE WHERE email='{email}';")
        _SHARED["nonadmin"] = body["token"]
    return _SHARED["nonadmin"]


def test_non_admin_uniform_404():
    user = non_admin_token()

    status, body, _ = get("/admin/_check")
    assert status == 404 and body == {"detail": "not found"}, (status, body)

    status, body, _ = get("/admin/_check", token=user)
    assert status == 404 and body == {"detail": "not found"}, "non-admin must 404"

    status, body, _ = get("/admin/lab/strategies", token=user)
    assert status == 404 and body == {"detail": "not found"}, "non-admin must 404"

    status, _, _ = post("/admin/lab/backtest",
                        {"strategy_key": "fast_mover"}, token=user)
    assert status == 404, "non-admin backtest must 404"

    status, body, _ = get("/admin/lab/findings")
    assert status == 404, "anonymous findings must 404"


def test_admin_check_204_and_no_cache():
    token = admin_token()
    status, _, headers = get("/admin/_check", token=token)
    assert status == 204, status
    assert headers.get("cache-control") == "no-store", headers
    assert "noindex" in headers.get("x-robots-tag", ""), headers


def test_lab_strategies_index():
    token = admin_token()
    status, body, headers = get("/admin/lab/strategies", token=token)
    assert status == 200, body
    assert body["events_total"] > 0
    assert body["events_complete"] > 0
    keys = {s["key"] for s in body["strategies"]}
    assert "fast_mover" in keys
    fm = next(s for s in body["strategies"] if s["key"] == "fast_mover")
    assert fm["version_number"] == 1, fm
    assert headers.get("cache-control") == "no-store"


def test_lab_versions_and_diff():
    token = admin_token()
    status, body, _ = get("/admin/lab/strategies/fast_mover/versions", token=token)
    assert status == 200, body
    numbers = [v["version_number"] for v in body["versions"]]
    assert 1 in numbers, "seeded v1 must always be on record"
    assert numbers == sorted(numbers, reverse=True), "timeline must be newest first"
    assert all("state" in v and "created_by" in v for v in body["versions"]), body["versions"]

    status, body, _ = get("/admin/lab/strategies/fast_mover/versions/diff?a=1&b=1",
                          token=token)
    assert status == 200, body
    assert body["hard_filters"] == [] and body["component_weights"] == [], body
    assert "performance" in body, "diff must carry the performance strip"

    status, _, _ = get("/admin/lab/strategies/fast_mover/versions/diff?a=1&b=99",
                       token=token)
    assert status == 404, "missing version must 404"


def test_backtest_guardrails_and_provenance():
    token = admin_token()
    status, body, _ = post("/admin/lab/backtest", {
        "strategy_key": "fast_mover",
        "event_kinds": ["earnings"],
        "hit_definition": {"price_move_pct": 20.0, "volume_spike_x": 3.0,
                           "combine": "or", "window": "tight"},
        "baselines": ["all_events", "random_day"],
        "hypothesis": "passed hard filters hit more often",
    }, token)
    assert status == 200, body
    groups = body["groups"]
    assert any(g["key"] == "pass" for g in groups), groups
    pg = next(g for g in groups if g["key"] == "pass")
    assert pg["ci95"] is not None and len(pg["ci95"]) == 2, pg
    assert pg["n"] >= 10, "fixture pass group should exceed the floor"
    assert isinstance(pg["hit_rate"], float), pg
    assert all(w.get("severity") in ("block", "warn") for w in pg["warnings"])
    assert any(b["label"] == "Random trading days" for b in body["baselines"]), body["baselines"]
    comp = body["comparison"]
    assert comp is not None and comp["p_value_adjusted"] >= 0, comp
    prov = body["provenance"]
    assert prov["synthetic_data_used"] is True, prov
    assert prov["events_in_scope"] > 0, prov
    assert any(x["reason"] == "data_incomplete" for x in prov["exclusions"]), prov
    assert "footer" in body


def test_backtest_cache_reuse():
    token = admin_token()
    spec = {
        "strategy_key": "fast_mover",
        "event_kinds": ["earnings"],
        "hit_definition": {"price_move_pct": 20.0, "volume_spike_x": 3.0,
                           "combine": "or", "window": "tight"},
    }
    status, first, _ = post("/admin/lab/backtest", spec, token)
    assert status == 200 and "query_id" in first, first
    status, second, _ = post("/admin/lab/backtest", spec, token)
    assert status == 200 and second["cached"] is True, second
    assert first["query_id"] != second["query_id"], "cache hit still audit-logs"
    assert second["cached_from_query_id"] == first["query_id"], second


def test_backtest_unknown_strategy_404():
    token = admin_token()
    status, body, _ = post("/admin/lab/backtest", {"strategy_key": "nope"}, token)
    assert status == 404, body


def test_findings_claim_format_validation():
    token = admin_token()
    status, queries, _ = get("/admin/lab/queries", token=token)
    assert status == 200 and queries["queries"], queries
    qid = queries["queries"][0]["id"]

    status, body, _ = post("/admin/lab/findings", {
        "title": "Vague claim",
        "claim": "Short interest matters",
        "claim_kind": "filter",
        "lab_query_ids": [qid],
    }, token)
    assert status == 400 and "claim" in body["detail"], body

    status, body, _ = post("/admin/lab/findings", {
        "title": "Vague claim cites nowhere",
        "claim": "Short interest matters",
        "claim_kind": "filter",
        "lab_query_ids": [999999],
    }, token)
    assert status == 400, "missing query must be rejected"

    claim = ("Events where all hard filters passed showed a 71% hit rate "
             "(29/41 events, 9 instruments) in the fixture dataset.")
    status, body, _ = post("/admin/lab/findings", {
        "title": "Spec-shaped claim",
        "claim": claim,
        "claim_kind": "filter",
        "lab_query_ids": [qid],
    }, token)
    assert status == 200, body
    assert body["evidence_grade"] in ("none", "weak", "moderate", "strong"), body

    status, _, _ = patch(f"/admin/lab/findings/{body['id']}",
                         {"status": "failed"}, token)
    assert status == 200


def test_findings_list_seeded():
    token = admin_token()
    status, body, _ = get("/admin/lab/findings?strategy=fast_mover", token=token)
    assert status == 200 and body["findings"], body
    assert any(f["evidence_grade"] == "strong"
               for f in body["findings"]), "seeded failed-claim finding is strong"
    for f in body["findings"]:
        assert "supports" in f["citations"]

    status, body, _ = get("/admin/lab/findings?strategy=nope", token=token)
    assert status == 200 and body["findings"] == [], body


def test_lab_coverage():
    token = admin_token()
    status, body, _ = get("/admin/lab/strategies/fast_mover/coverage", token=token)
    assert status == 200, body
    assert body["instruments"] > 0 and body["events"] > 0
    assert body["industries"] and all(i["label"] for i in body["industries"])


if __name__ == "__main__":
    failures = 0
    for name in sorted(n for n in globals() if n.startswith("test_")):
        try:
            globals()[name]()
            print(f"PASS {name}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL {name}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {name}: {type(e).__name__}: {e}")
    sys.exit(1 if failures else 0)