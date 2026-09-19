from __future__ import annotations

import json
import subprocess
import sys
import time
from urllib import error, request

BASE = "http://127.0.0.1:8000/api"
POSTGRES = "docker compose exec -T postgres psql -U tradealert -d tradealert"


def _call(method, path, body=None, token=None):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except json.JSONDecodeError:
            return e.code, {}


def post(path, body=None, token=None):
    return _call("POST", path, body, token)


def get(path, token=None):
    return _call("GET", path, None, token)


def delete(path, token=None):
    return _call("DELETE", path, None, token)


def psql(sql):
    subprocess.run(
        f"{POSTGRES} -c \"{sql}\"",
        shell=True,
        capture_output=True,
        check=True,
    )


def new_user(email):
    status, body = post("/signup", {"email": email, "password": "testpass123"})
    assert status == 200, body
    status, body = post("/login", {"email": email, "password": "testpass123"})
    assert status == 200, body
    psql(f"UPDATE users SET verified=TRUE WHERE email='{email}';")
    return body["token"]


def verified(email, kind):
    psql(f"UPDATE users SET {kind}=TRUE WHERE email='{email}';")


def test_free_tier_limits_enforced():
    tag = str(int(time.time()))
    email = f"limits{tag}@example.com"
    token = new_user(email)

    status, body = post("/me/industries", {"key": "energy_nuclear"}, token)
    assert status == 200 and body["followed_count"] == 1, body
    status, _ = post("/me/industries", {"key": "defense_space"}, token)
    assert status == 403, "free tier follow cap (1) must 403"

    status, body = post("/me/picks", {"symbol": "PDYN"}, token)
    assert status == 200 and body["score_at_pin"] is not None, body
    status, _ = post("/me/picks", {"symbol": "LEU"}, token)
    assert status == 403, "free tier pick cap (1) must 403"

    status, body = post("/me/alerts/rules",
                        {"symbol": "PDYN", "trigger_key": "volume_3x",
                         "channels": ["email"]}, token)
    assert status == 403, "free tier alerts_limit 0 must 403"


def test_upgrade_then_downgrade_truncates():
    tag = str(int(time.time()))
    email = f"plan{tag}@example.com"
    token = new_user(email)

    post("/me/industries", {"key": "energy_nuclear"}, token)
    post("/me/picks", {"symbol": "PDYN"}, token)

    status, body = post("/billing/dev/preview", {"tier_key": "pro"}, token)
    assert status == 200 and body.get("adopted") == "pro", body
    status, body = post("/me/picks", {"symbol": "LEU"}, token)
    assert status == 200, body
    status, body = post("/me/industries", {"key": "defense_space"}, token)
    assert status == 200, body
    status, body = post("/me/alerts/rules",
                        {"symbol": "PDYN", "trigger_key": "volume_3x",
                         "channels": ["email"]}, token)
    assert status == 200, body

    status, body = post("/billing/dev/preview", {"tier_key": "free"}, token)
    assert status == 200 and body.get("adopted") == "free", body

    status, body = get("/me/picks", token=token)
    assert status == 200 and len(body["picks"]) == 1, body
    status, body = get("/me/industries", token=token)
    assert status == 200 and len(body["industries"]) == 1, body
    status, body = get("/me/alerts/rules", token=token)
    assert status == 200 and body["rules"] == [], "downgrade must delete rules"


def test_reset_link_is_single_use():
    tag = str(int(time.time()))
    email = f"reset{tag}@example.com"
    post("/signup", {"email": email, "password": "seed-old-pass"})

    status, _ = post("/auth/forgot", {"email": email})
    assert status == 200

    status, body = post("/auth/reset",
                        {"token": "bogus", "password": "fresh-new-pass"})
    assert status == 400, "bogus token must be rejected"
    assert body == {"detail": "invalid or expired reset link"}, body

    logs = subprocess.run(
        "docker logs tradealertme-app-1 2>&1",
        shell=True, capture_output=True, check=True,
    ).stdout.decode()
    links = [ln.split("token=", 1)[1].strip() for ln in logs.splitlines() if email in ln and "token=" in ln]
    assert links, "reset link must be logged when SES is unconfigured"
    token = links[-1]

    status, _ = post("/auth/reset", {"token": token, "password": "fresh-new-pass"})
    assert status == 200
    status, _ = post("/auth/reset", {"token": token, "password": "stale-pass"})
    assert status == 400, "consumed reset link must not work twice"

    status, _ = post("/login", {"email": email, "password": "stale-pass"})
    assert status == 401
    status, _ = post("/login", {"email": email, "password": "fresh-new-pass"})
    assert status == 200


def test_visibility_404_out_of_scope():
    tag = str(int(time.time()))
    email = f"vis{tag}@example.com"
    token = new_user(email)
    post("/me/industries", {"key": "energy_nuclear"}, token)

    status, body = get("/stock/BKSY", token=token)
    assert status == 404, "defense-space name not followed must 404"
    assert body == {"detail": "not found"}, body

    status, _ = post("/me/picks", {"symbol": "BKSY"}, token)
    assert status == 200
    status, _ = get("/stock/BKSY", token=token)
    assert status == 200, "pinned name must be readable even outside followed industries"


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