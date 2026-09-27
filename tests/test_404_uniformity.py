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
        with request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except error.HTTPError as e:
        return e.code, e.read()


def tester():
    tag = str(int(time.time()))
    email = f"unif{tag}@example.com"
    status, _ = _call("POST", "/signup", {"email": email, "password": "testpass123"})
    assert status == 200
    subprocess.run(
        f"{POSTGRES} -c \"UPDATE users SET verified=TRUE WHERE email='{email}';\"",
        shell=True, capture_output=True, check=True,
    )
    status, body = _call("POST", "/login", {"email": email, "password": "testpass123"})
    assert status == 200
    return json.loads(body)["token"]


def test_board_and_stock_require_auth():
    status, _ = _call("GET", "/board")
    assert status == 401, "board must not be readable anonymously"
    status, _ = _call("GET", "/stock/AAPL")
    assert status == 401, "stock pages must not be readable anonymously"


def test_404_identical_between_missing_and_invalid(token):
    _, missing = _call("GET", "/stock/NOTREAL", token=token)
    _, invalid = _call("GET", "/stock/ZZZZZZZZZZZZZZZZZ", token=token)
    assert missing == invalid, "out-of-universe and nonexistent symbols must 404 identically"
    body = json.loads(missing)
    assert body == {"detail": "not found"}, f"unexpected body: {body!r}"


def test_out_of_universe_symbol_404s(token):
    status, body = _call("GET", "/stock/NOTREAL", token=token)
    assert status == 404
    assert json.loads(body) == {"detail": "not found"}


def test_board_ok(token):
    status, body = _call("GET", "/board", token=token)
    assert status == 200
    payload = json.loads(body)
    assert isinstance(payload["run_id"], int)
    assert isinstance(payload["rows"], list)
    assert isinstance(payload["meta"], dict)


if __name__ == "__main__":
    failures = 0
    try:
        test_board_and_stock_require_auth()
        print("PASS test_board_and_stock_require_auth")
    except Exception as e:
        failures += 1
        print(f"FAIL test_board_and_stock_require_auth: {type(e).__name__}: {e}")

    try:
        token = tester()
        for name in ("test_404_identical_between_missing_and_invalid",
                     "test_out_of_universe_symbol_404s", "test_board_ok"):
            try:
                globals()[name](token)
                print(f"PASS {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f"ERROR {name}: {type(e).__name__}: {e}")
    except Exception as e:  # noqa: BLE001
        failures += 1
        print(f"ERROR tester(): {type(e).__name__}: {e}")

    sys.exit(1 if failures else 0)