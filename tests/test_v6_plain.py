"""v6 plain words (DESIGN_V6 §8): every strategy and industry ships a plain
card, the measured record has a real source, and the recipe (weights,
thresholds, cutoffs) leaves every subscriber payload. Same harness as
test_product_v3.py: a live API at API_BASE and Postgres via POSTGRES_CMD.

    API_BASE=http://127.0.0.1:8004/api POSTGRES_CMD="psql postgresql://..." \\
        pytest -q tests/test_v6_plain.py
"""
from __future__ import annotations

import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from test_product_v3 import VISIBLE, VISIBLE_INDUSTRY, get, new_user, post  # noqa: E402

STATUSES = {"measured", "provisional", "not_running"}
RECIPE_FIELDS = ("hard_filters", "components", "band_cutoffs", "declared_weight_total",
                 "description")
# the record is the one place a number may appear on a plain card
RECORD_FIELDS = {"record", "record_numbers", "record_definition", "status"}
NUMBERS = re.compile(r"\d|%|\$|weight", re.I)


def _user(prefix):
    email = f"{prefix}{int(time.time() * 1000)}@example.com"
    token = new_user(email)
    post("/me/industries", {"key": VISIBLE_INDUSTRY}, token)
    return token


def _strategies():
    s, body = get("/strategies")
    assert s == 200, body
    assert body["strategies"], "no strategies"
    return body["strategies"]


def _words(text):
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def _plain_text_fields(plain):
    """Every string on the card except the record, flattened."""
    out = []
    for k, v in plain.items():
        if k in RECORD_FIELDS:
            continue
        if isinstance(v, str):
            out.append((k, v))
        elif isinstance(v, list):
            out.extend((k, x) for x in v if isinstance(x, str))
    return out


def test_every_strategy_row_carries_the_plain_card():
    for row in _strategies():
        p = row["plain"]
        assert p["one_line"], row["key"]
        assert p["record"], row["key"]
        assert p["status"] in STATUSES, (row["key"], p["status"])
        assert isinstance(p["looks_for"], list)
        assert "record_numbers" in p and "record_definition" in p
        assert isinstance(row["scored_on_latest_run"], int)


def test_fast_mover_record_is_the_published_backtest():
    fm = next(r for r in _strategies() if r["key"] == "fast_mover")
    p = fm["plain"]
    assert p["status"] == "measured"
    assert p["record_numbers"] == {"hits": 26, "n": 32}, p["record_numbers"]
    assert p["record"].startswith("26 of 32"), p["record"]
    assert "No measured record" not in p["record"]
    s, body = get("/strategies/fast_mover")
    assert s == 200
    assert body["plain"]["record_numbers"] == {"hits": 26, "n": 32}
    assert body["record_source"], "the record names its source"


def test_strategies_that_put_no_score_on_the_run_say_so():
    rows = _strategies()
    for row in rows:
        if row["scored_on_latest_run"] == 0:
            assert row["plain"]["status"] == "not_running", row["key"]
            assert row["plain"]["record"].startswith("Not scoring yet"), row["plain"]["record"]
        else:
            assert row["plain"]["status"] != "not_running", row["key"]
    # the one calibrated strategy scores names and has the record
    assert any(r["plain"]["status"] == "measured" for r in rows)


def test_strategy_detail_carries_no_recipe():
    for row in _strategies():
        s, body = get(f"/strategies/{row['key']}")
        assert s == 200, body
        for k in RECIPE_FIELDS:
            assert k not in body, (row["key"], k)
        assert body["version"] is None or "hit_definition" not in body["version"], row["key"]
        assert body["plain"]["one_line"] == row["plain"]["one_line"]
        assert body["plain"]["record_definition"]
        assert "20%" in body["plain"]["record_definition"]
        assert "calibration" in body and "timeline" in body


def test_plain_text_carries_no_numbers_or_weights():
    for row in _strategies():
        for k, text in _plain_text_fields(row["plain"]):
            assert not NUMBERS.search(text), (row["key"], k, text)
    s, body = get("/industries")
    assert s == 200
    for ind in body["industries"]:
        for k, text in _plain_text_fields(ind["plain"]):
            assert not NUMBERS.search(text), (ind["key"], k, text)


def test_card_sentences_keep_to_fourteen_words():
    for row in _strategies():
        assert _words(row["plain"]["one_line"]) <= 14, row["plain"]["one_line"]
    s, body = get("/industries")
    for ind in body["industries"]:
        for k in ("why_it_moves", "what_is_in_it"):
            assert ind["plain"][k], (ind["key"], k)
            assert _words(ind["plain"][k]) <= 14, (ind["key"], ind["plain"][k])
            for bad in ("plays", "squeeze", "violently", "re-rates"):
                assert bad not in ind["plain"][k].lower(), (ind["key"], bad)


def test_must_pass_rules_never_claim_exclusion():
    for row in _strategies():
        text = " ".join(t for _k, t in _plain_text_fields(row["plain"])).lower()
        assert "excluded before scoring" not in text
        assert "fails a must-pass rule outright" not in text
        assert "hard filter" not in text, (row["key"], "jargon on the card")


def test_dossier_components_carry_rank_not_weight():
    token = _user("v6c")
    s, body = get(f"/stock/{VISIBLE}", token)
    assert s == 200, body
    assert body["strategy"]["plain"]["status"] in STATUSES
    assert body["strategy"]["plain"]["one_line"]
    for lens in body["strategies"]:
        assert set(lens["plain"]) == {"one_line", "status", "record"}, lens["key"]
        for c in lens["components"]:
            assert "weight" not in c and "share" not in c, c
            assert set(c) == {"key", "label", "value", "score", "backed", "rank"}, c
    comps = body.get("score", {}).get("components", [])
    ranks = [c["rank"] for c in comps]
    assert ranks == list(range(1, len(comps) + 1)), ranks
    for c in comps:
        assert "weight" not in c


def test_fields_missing_components_carry_no_weight_or_share():
    token = _user("v6f")
    s, body = get(f"/stock/{VISIBLE}/fields", token)
    assert s == 200, body
    assert "declared_weight_total" not in body
    for c in body["missing_components"]:
        assert "weight" not in c and "share" not in c, c
        assert set(c) == {"key", "label", "source"}, c


def test_industries_carry_plain_and_the_measured_month():
    s, body = get("/industries")
    assert s == 200, body
    for ind in body["industries"]:
        p, m = ind["plain"], ind["month"]
        assert p["why_it_moves"] and p["what_is_in_it"], ind["key"]
        assert "what_fires" not in p, "what fires is measured, never written"
        assert m["days"] == 30
        assert m["fired"] >= m["measured"] >= m["moved_10"] >= 0, m
        assert isinstance(m["top_triggers"], list)
        assert sum(t["n"] for t in m["top_triggers"]) == m["fired"], m
        for t in m["top_triggers"]:
            assert set(t) == {"key", "label", "n"}, t
        assert "symbol" not in str(m)
    s, body = get(f"/industries/{VISIBLE_INDUSTRY}")
    assert s == 200, body
    assert body["plain"]["why_it_moves"] and body["plain"]["what_is_in_it"]
    assert set(body["month"]) == {"days", "fired", "measured", "moved_10", "top_triggers"}


def test_strategy_stub_on_board_and_screen_carries_plain():
    token = _user("v6b")
    s, body = get("/board", token)
    assert s == 200, body
    assert body["strategy"]["plain"]["status"] in STATUSES
    s, body = get("/screen", token)
    if s == 200 and isinstance(body, dict) and body.get("strategy"):
        assert body["strategy"]["plain"]["one_line"]


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
