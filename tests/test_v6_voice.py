"""The v6 voice (DESIGN_V6 §2, §7): the words a subscriber sees cannot drift
back to the product's internal nouns. These are grep-style checks over the
frontend source the voice sweep owns; they need no server.

Run: pytest -q tests/test_v6_voice.py
"""
from __future__ import annotations

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "frontend", "src")

# The files the first half of the sweep owns. Board, Find, the dossier and
# the watchlist join this list when the second half merges.
SWEPT = [
    "views/Alerts.jsx", "views/Changes.jsx", "views/Calendar.jsx", "views/Compare.jsx",
    "views/Digests.jsx", "views/Settings.jsx", "views/Landing.jsx", "views/Auth.jsx",
    "views/Onboarding.jsx", "views/Welcome.jsx", "views/Help.jsx", "views/Industry.jsx",
    "views/Strategies.jsx", "views/Pricing.jsx", "views/Overview.jsx", "views/Reset.jsx",
    "views/Verified.jsx", "views/Unsubscribe.jsx",
    "components/Shell.jsx", "components/Tour.jsx", "components/NotifyButton.jsx",
    "components/Pin.jsx", "components/UpgradeSheet.jsx", "components/RecordCard.jsx",
    "components/EventList.jsx", "components/CommandPalette.jsx", "components/Shortcuts.jsx",
    "components/Explain.jsx", "components/Plain.jsx", "components/FinePrint.jsx",
    "components/ScreenHead.jsx",
    "lib/plain.js", "lib/record.js",
]

# Strings that must not appear anywhere in a swept file, comments included,
# so the old vocabulary cannot creep back through a copied snippet.
BANNED = [
    "Notify me",
    "Notifying",
    "Pinned",
    "Scoring lens",
    "Provisional · uncalibrated",
    "Provisional — uncalibrated",
    "Manage alerts",
    "Continue to checkout",
    "Compare plans",
    "Open report",
    "See plans",
    "Research and information only",
]

# Internal nouns that may not be shown to the user as actions (DESIGN_V6 §2):
# a button or toast never says arm, disarm, drop, pin or unpin. ("Pick" stays
# a plain verb: §3 says "pick my industries".) The check looks at JSX text
# nodes and quoted strings that start with the word.
ACTION_NOUNS = re.compile(r"(>|[\"'`])\s*(Arm|Disarm|Drop|Pin|Unpin)\b")


def _read(rel):
    with open(os.path.join(SRC, rel), encoding="utf-8") as f:
        return f.read()


def _strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    return text


def test_swept_files_exist():
    missing = [rel for rel in SWEPT if not os.path.exists(os.path.join(SRC, rel))]
    assert not missing, f"swept files missing: {missing}"


def test_no_banned_strings_in_swept_files():
    hits = []
    for rel in SWEPT:
        text = _read(rel)
        for needle in BANNED:
            for m in re.finditer(rf"\b{re.escape(needle)}\b", text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append(f"{rel}:{line}: {needle}")
    assert not hits, "banned vocabulary:\n" + "\n".join(hits)


def test_hard_filter_only_as_the_bracketed_technical_word():
    """Outside the glossary, "hard filter" may appear only in brackets after
    the plain phrase, at most once per screen file."""
    bad = []
    for rel in SWEPT:
        if rel in ("lib/plain.js",):  # the dictionary itself holds the technical word
            continue
        text = _strip_comments(_read(rel))
        lines = text.split("\n")
        bare = []
        for m in re.finditer(r"hard filter", text, flags=re.I):
            if text[max(0, m.start() - 1)] == "(":
                continue
            line = lines[text.count("\n", 0, m.start())]
            if "simple ?" in line or "full-only" in line:  # a Full-mode branch may keep the word
                continue
            bare.append(m)
        if bare:
            bad.append(f"{rel}: {len(bare)} bare")
        if len(re.findall(r"\(hard filter", text, flags=re.I)) > 1:
            bad.append(f"{rel}: bracketed more than once")
    assert not bad, "hard filter outside its bracket:\n" + "\n".join(bad)


def test_internal_nouns_do_not_lead_an_action():
    hits = []
    for rel in SWEPT:
        text = _strip_comments(_read(rel))
        for m in ACTION_NOUNS.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            hits.append(f"{rel}:{line}: {m.group(0).strip()}")
    assert not hits, "internal noun shown as an action:\n" + "\n".join(hits)


def test_cta_map_carries_the_vocabulary():
    plain = _read("lib/plain.js")
    for key, words in [
        ("ALERT_ME", "Alert me"),
        ("ALERTING", "Alerting me"),
        ("MY_ALERTS", "My alerts"),
        ("WATCH", "Watch"),
        ("WATCHING", "Watching"),
        ("WATCH_FOR_ME", "Watch this for me"),
        ("STOP_WATCHING", "Stop watching"),
        ("SHOW_PLANS", "Show me every plan"),
        ("REPORT", "Show me the report"),
        ("CHECKOUT", "Take me to checkout"),
    ]:
        assert re.search(rf"{key}:\s*\"{re.escape(words)}\"", plain), f"CTA.{key} should be \"{words}\""


def test_plain_word_table_matches_design_v6_section_7():
    plain = _read("lib/plain.js")
    for key, words in [
        ("band", "rating"),
        ("coverage", "how much data the score had"),
        ("shrinkage", "pulled toward neutral for missing data"),
        ("lens", "strategy"),
        ("calibrated", "has a measured record"),
        ("provisional", "no measured record yet"),
        ("hard_filter", "must-pass rule"),
        ("run", "this morning's scoring"),
        ("stage_early", "no date set yet"),
        ("stage_event", "a date is set"),
        ("catalyst", "a dated event"),
    ]:
        assert re.search(rf"{key}:\s*\"{re.escape(words)}\"", plain), f"PLAIN_WORD.{key} should be \"{words}\""


def test_notify_and_pin_defaults_use_the_map():
    notify = _read("components/NotifyButton.jsx")
    assert "label = CTA.ALERT_ME" in notify and "onLabel = CTA.ALERTING" in notify
    pin = _read("components/Pin.jsx")
    assert "CTA.WATCHING : CTA.WATCH" in pin
    assert "CTA.STOP_WATCHING_SYM(symbol) : CTA.WATCH_SYM_FOR_ME(symbol)" in pin


def test_screen_heads_are_first_person_and_short():
    titles = {
        "views/Alerts.jsx": "My alerts",
        "views/Changes.jsx": "What changed for me",
        "views/Calendar.jsx": "Coming up for me",
        "views/Compare.jsx": "Compare for me",
        "views/Digests.jsx": "My week",
        "views/Settings.jsx": "My account",
        "views/Strategies.jsx": "How it hunts",
        "views/Help.jsx": "How it works",
    }
    for rel, title in titles.items():
        text = _read(rel)
        assert f'title="{title}"' in text, f"{rel} should open with the ScreenHead title {title!r}"
        assert len(title.split()) <= 4


def test_fine_print_component_is_placed():
    for rel in [
        "views/Alerts.jsx", "views/Changes.jsx", "views/Calendar.jsx", "views/Compare.jsx",
        "views/Digests.jsx", "views/Settings.jsx", "views/Strategies.jsx", "views/Help.jsx",
        "views/Landing.jsx", "views/Auth.jsx", "views/Onboarding.jsx", "views/Welcome.jsx",
        "views/Pricing.jsx", "components/UpgradeSheet.jsx", "components/Shell.jsx",
    ]:
        assert "<FinePrint" in _read(rel), f"{rel} should place the FinePrint component"


def test_landing_carries_the_three_sentences():
    text = _read("views/Landing.jsx")
    assert "tradealert dot me: alerts, sent to me." in text
    assert "It watches my industries." in text and "It tells me before the move is over." in text
    assert "Measured, not predicted." in text
    assert "Free plan, no card." in text


def test_plan_prompts_open_the_sheet_not_pricing():
    for rel in ["views/Changes.jsx", "views/Calendar.jsx", "views/Industry.jsx", "views/Onboarding.jsx"]:
        text = _strip_comments(_read(rel))
        assert 'to="/pricing"' not in text, f"{rel} should open the upgrade sheet, not navigate to /pricing"
        assert "openUpgrade(" in text


def test_backend_sentences_speak_to_the_subscriber():
    with open(os.path.join(ROOT, "app", "record.py"), encoding="utf-8") as f:
        record = f.read()
    assert "'Told' means we sent it " in record and "fired on a name you were not watching" in record
    assert "with no rule armed" not in record
    with open(os.path.join(ROOT, "app", "discover.py"), encoding="utf-8") as f:
        discover = f.read()
    method = re.search(r'"method": "Each event is measured[^}]*?resolved\."', discover, flags=re.S)
    assert method and "Yahoo" not in method.group(0)
