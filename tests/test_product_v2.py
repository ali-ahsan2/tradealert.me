"""Product v2 surface: dossier enrichment, price series, strategy evidence
pages, industry pages, digests, alert read state, notes, export, password
change and account deletion. Same harness as test_account_flow.py: a live
API on :8000 and docker-compose Postgres to flip the verified flag.

    python tests/test_product_v2.py
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


def _ip_for(email):
    # the signup limiter is five per hour per client IP; each test user
    # presents its own address so the suite runs in one go (as v3 does)
    h = abs(hash(email))
    return f"10.{(h >> 16) % 250 + 1}.{(h >> 8) % 250 + 1}.{h % 250 + 1}"


def _call(method, path, body=None, token=None, ip=None):
    headers = {"Accept": "application/json"}
    if ip:
        headers["X-Forwarded-For"] = ip
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None), dict(r.headers)
    except error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except ValueError:
            return e.code, raw, dict(e.headers)


def get(path, token=None):
    return _call("GET", path, token=token)


def post(path, body, token=None, ip=None):
    return _call("POST", path, body, token, ip)


def new_user(email, password=PASSWORD):
    ip = _ip_for(email)
    status, _, _ = post("/signup", {"email": email, "password": password, "accept_terms": True}, ip=ip)
    assert status == 200, status
    subprocess.run(
        f"{POSTGRES} -c \"UPDATE users SET verified=TRUE WHERE email='{email}';\"",
        shell=True, capture_output=True, check=True,
    )
    status, body, _ = post("/login", {"email": email, "password": password}, ip=ip)
    assert status == 200, body
    return body["token"]


def tag():
    return str(int(time.time() * 1000))


def test_series_404_uniform():
    token = new_user(f"ser{tag()}@example.com")
    post("/me/industries", {"key": "energy_nuclear"}, token)
    s1, missing, _ = get("/stock/NOTREAL/series", token)
    s2, invalid, _ = get("/stock/ZZZZZZZZZZZZZZZZZ/series", token)
    assert s1 == s2 == 404
    assert missing == invalid == {"detail": "not found"}, (missing, invalid)
    # a name outside the followed industries is indistinguishable too
    s3, body, _ = get("/stock/BKSY/series", token)
    assert s3 == 404 and body == {"detail": "not found"}, body


def test_series_ok_for_visible_name():
    token = new_user(f"ser2{tag()}@example.com")
    post("/me/industries", {"key": "energy_nuclear"}, token)
    status, body, _ = get("/stock/LEU/series?days=180", token)
    assert status == 200, body
    for k in ("bars", "alerts", "dated_events", "benchmark", "source"):
        assert k in body, k
    assert isinstance(body["bars"], list)


def test_stock_dossier_carries_v2_fields():
    token = new_user(f"dos{tag()}@example.com")
    post("/me/industries", {"key": "energy_nuclear"}, token)
    status, body, _ = get("/stock/LEU", token)
    assert status == 200, body
    assert isinstance(body["strategies"], list) and body["strategies"]
    assert "components" in body["strategies"][0]
    assert "plain" in body["strategies"][0]
    for c in body["strategies"][0]["components"]:
        assert "weight" not in c and "rank" in c
    assert isinstance(body["history"], list)
    assert isinstance(body["peers"], list)
    # peers are the industry's top-K on the strategy; the name itself is
    # flagged when it is inside that top-K, not forced into it
    assert all("self" in p and "rank" in p for p in body["peers"])
    assert isinstance(body["events"], list)
    assert isinstance(body["past_reactions"], list)
    assert body["note"] == ""


def test_strategy_detail_is_public():
    status, body, _ = get("/strategies/fast_mover")
    assert status == 200, body
    assert body["key"] == "fast_mover"
    # the plain card ships; the recipe does not (DESIGN_V6 §8, §10)
    assert body["plain"]["one_line"] and body["plain"]["status"] == "measured"
    assert body["plain"]["record_numbers"] == {"hits": 26, "n": 32}
    for k in ("components", "hard_filters", "band_cutoffs", "declared_weight_total",
              "description"):
        assert k not in body, k
    assert "calibration" in body and "hit_rate" in body["calibration"]
    status, body, _ = get("/strategies/not_a_strategy")
    assert status == 404 and body == {"detail": "not found"}, body


def test_industry_detail_respects_scope():
    token = new_user(f"ind{tag()}@example.com")
    post("/me/industries", {"key": "energy_nuclear"}, token)
    status, body, _ = get("/industries/energy_nuclear", token)
    assert status == 200, body
    assert body["followed"] is True and body["in_scope"] is True
    assert body["names"] is not None
    assert len(body["names"]) <= body["names_shown_limit"]
    status, body, _ = get("/industries/defense_space", token)
    assert status == 200, body
    assert body["in_scope"] is False and body["names"] is None, body
    status, body, _ = get("/industries/energy_nuclear")
    assert status == 200 and body["names"] is None, "anonymous callers get no names"


def test_alert_unread_and_mark_all():
    token = new_user(f"unr{tag()}@example.com")
    status, body, _ = get("/me/alerts/unread", token)
    assert status == 200 and isinstance(body["count"], int), body
    status, body, _ = post("/me/alerts/read", {"all": True}, token)
    assert status == 200 and body["read"] is True, body
    status, body, _ = get("/me/alerts/unread", token)
    assert body["count"] == 0
    status, body, _ = post("/me/alerts/read", {}, token)
    assert status == 422
    status, body, _ = get("/alert-events?unread=1&days=30", token)
    assert status == 200 and body["events"] == []


def test_digest_preview_and_list():
    token = new_user(f"dig{tag()}@example.com")
    post("/me/industries", {"key": "energy_nuclear"}, token)
    status, body, _ = get("/me/digests/preview", token)
    assert status == 200, body
    assert body["preview"] is True and isinstance(body["rows"], list)
    assert len(body["rows"]) <= 5, "free tier previews at most its top-5"
    status, body, _ = get("/me/digests", token)
    assert status == 200 and body["digests"] == []
    status, body, _ = get("/me/digests/999999999", token)
    assert status == 404


def test_pick_note_roundtrip():
    token = new_user(f"note{tag()}@example.com")
    post("/me/industries", {"key": "energy_nuclear"}, token)
    status, _, _ = post("/me/picks", {"symbol": "LEU"}, token)
    assert status == 200
    status, body, _ = _call("PATCH", "/me/picks/LEU", {"note": "HALEU licence is the moat"}, token)
    assert status == 200 and body["note"] == "HALEU licence is the moat", body
    status, body, _ = get("/me/picks", token)
    assert body["picks"][0]["note"] == "HALEU licence is the moat"
    status, body, _ = _call("PATCH", "/me/picks/NOSUCH", {"note": "x"}, token)
    assert status == 404


def test_export_has_everything_and_no_secrets():
    token = new_user(f"exp{tag()}@example.com")
    status, body, headers = get("/me/export", token)
    assert status == 200, body
    disposition = next((v for k, v in headers.items() if k.lower() == "content-disposition"), "")
    assert "attachment" in disposition, headers
    for k in ("account", "settings", "industries", "picks", "alert_rules", "digests"):
        assert k in body, k
    assert "password_hash" not in json.dumps(body)
    assert "webhook_secret" not in json.dumps(body)


def test_password_change():
    email = f"pw{tag()}@example.com"
    token = new_user(email)
    status, body, _ = post("/me/password", {"current": "wrong-password", "new": "newpass12345"}, token)
    assert status == 403, body
    status, body, _ = post("/me/password", {"current": PASSWORD, "new": "newpass12345"}, token)
    assert status == 200 and body["changed"] is True
    status, _, _ = post("/login", {"email": email, "password": PASSWORD})
    assert status == 401
    status, _, _ = post("/login", {"email": email, "password": "newpass12345"})
    assert status == 200


def test_delete_account():
    email = f"del{tag()}@example.com"
    token = new_user(email)
    status, body, _ = _call("DELETE", "/me", {"confirm": "someone@else.com"}, token)
    assert status == 422, body
    status, _, _ = _call("DELETE", "/me", {"confirm": email}, token)
    assert status == 204
    status, _, _ = post("/login", {"email": email, "password": PASSWORD})
    assert status == 401


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
