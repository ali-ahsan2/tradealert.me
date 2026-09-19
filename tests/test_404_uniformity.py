from __future__ import annotations

import json
import sys
from urllib import error, request

BASE = "http://127.0.0.1:8000/api"


def get(path):
    req = request.Request(BASE + path, headers={"Accept": "application/json"})
    try:
        with request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except error.HTTPError as e:
        return e.code, e.read()


def test_404_identical_between_missing_and_invalid():
    _, missing = get("/stock/NOTREAL")
    _, invalid = get("/stock/ZZZZZZZZZZZZZZZZZ")
    assert missing == invalid, "out-of-universe and nonexistent symbols must 404 identically"
    body = json.loads(missing)
    assert body == {"detail": "not found"}, f"unexpected body: {body!r}"


def test_out_of_universe_symbol_404s():
    status, body = get("/stock/NOTREAL")
    assert status == 404
    assert json.loads(body) == {"detail": "not found"}


def test_board_and_me_ok():
    status, body = get("/board")
    assert status == 200
    payload = json.loads(body)
    assert payload["run_id"] == 1
    assert isinstance(payload["rows"], list)
    assert isinstance(payload["meta"], dict)
    status, body = get("/me")
    assert status == 401 or status == 200


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