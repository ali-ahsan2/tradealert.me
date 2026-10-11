"""v5 record surface: the anonymous pulse and the per-subscriber record.
Same harness as test_product_v3.py: a live API on :8000 and Postgres via
POSTGRES_CMD (or docker compose) to flip the verified flag.

    python tests/test_v5.py
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from test_product_v3 import PASSWORD, VISIBLE_INDUSTRY, get, post, psql  # noqa: E402

TALLY_KEYS = {"fired", "names", "measured", "moved_10", "moved_20", "industries"}


def _user(prefix, industries):
    stamp = int(time.time() * 1000)
    email = f"{prefix}{stamp}@example.com"
    # the signup limiter is five per hour per client IP (see test_product_v3):
    # each test user presents its own address so the suite runs in one go
    s, body = post("/signup", {"email": email, "password": PASSWORD},
                   ip=f"10.5.{(stamp // 256) % 256}.{stamp % 256}")
    assert s == 200, body
    token = body["token"]
    psql(f"UPDATE users SET verified=TRUE WHERE email='{email}';")
    for key in industries:
        post("/me/industries", {"key": key}, token)
    return email, token


def test_pulse_is_public_aggregate_and_tickerless():
    s, body = get("/pulse?days=30")
    assert s == 200, body
    assert set(body["alerts"]) == TALLY_KEYS
    assert body["universe"]["names"] > 0 and body["universe"]["industries"] > 0
    assert body["alerts"]["measured"] <= body["alerts"]["fired"]
    assert body["alerts"]["moved_20"] <= body["alerts"]["moved_10"] <= body["alerts"]["measured"]
    for ex in body["examples"]:
        assert "symbol" not in ex and "theme" not in ex
        assert ex["max_5d"] >= 10
        assert ex["peak_after_sessions"] in (None, 1, 2, 3, 4, 5)
    for ind in body["industries"]:
        assert set(ind) >= {"key", "label", "fired", "measured", "moved_10", "moved_20", "names"}
    assert body["method"]


def test_pulse_rejects_unsupported_windows():
    assert get("/pulse?days=3")[0] == 422
    assert get("/pulse?days=400")[0] == 422


def test_record_scopes_tickers_and_counts_beyond():
    _email, token = _user("rec", [VISIBLE_INDUSTRY])
    s, me = get("/me", token)
    assert s == 200
    k = me["tier"]["names_shown_limit"]
    s, body = get("/me/record?days=365", token)
    assert s == 200, body
    for part in ("told", "missed", "beyond"):
        assert set(body[part]["summary"]) == TALLY_KEYS
    # a fresh account was told nothing
    assert body["told"]["summary"]["fired"] == 0 and body["told"]["events"] == []
    missed = body["missed"]
    assert missed["names_shown_limit"] == k
    assert missed["names_shown"] <= k
    shown = {e["symbol"] for e in missed["events"]}
    assert len(shown) == missed["names_shown"]
    assert missed["names_total"] >= missed["names_shown"]
    for e in missed["events"]:
        assert e["told"] is False
        assert e["industry_label"] and e["trigger"] and e["date"]
        if e["max_5d"] is not None:
            assert e["peak_after_sessions"] in (1, 2, 3, 4, 5)
    # beyond the followed industries: labels and counts, never tickers
    assert "events" not in body["beyond"]
    for label in body["beyond"]["industries"]:
        assert isinstance(label, str)
    assert body["beyond"]["summary"]["industries"] == len(body["beyond"]["industries"])


def test_record_for_one_symbol_is_scoped_like_the_dossier():
    from test_product_v3 import HIDDEN, VISIBLE
    _email, token = _user("recs", [VISIBLE_INDUSTRY])
    s, body = get(f"/me/record?symbol={VISIBLE}&days=365", token)
    assert s == 200, body
    assert body["symbol"] == VISIBLE and set(body["summary"]) == TALLY_KEYS
    for e in body["events"]:
        assert e["symbol"] == VISIBLE
    s, body = get(f"/me/record?symbol={HIDDEN}&days=365", token)
    assert s == 404 and body == {"detail": "not found"}
    s, body = get("/me/record?symbol=ZZZZ9&days=365", token)
    assert s == 404 and body == {"detail": "not found"}


def test_record_requires_auth():
    assert get("/me/record")[0] == 401


if __name__ == "__main__":
    import inspect

    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and inspect.isfunction(fn):
            try:
                fn()
                print(f"ok   {name}")
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f"FAIL {name}: {e!r}")
    sys.exit(1 if failures else 0)
