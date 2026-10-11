"""v6 legal posture (DESIGN_V6 §6, §10): the consent tick at sign-up, the
consent fields on /api/me, the one-time acknowledgement, the verify redirect,
the resend endpoint, and the fine print plus unsubscribe link on every alert
and digest email. Same harness as test_v5.py: a live API (API_BASE) and
Postgres via POSTGRES_CMD; each sign-up presents its own client address.

    API_BASE=http://127.0.0.1:8005/api \\
    POSTGRES_CMD="psql postgresql://tradealert:dev-only-change-me@localhost:5432/tradealert" \\
    pytest -q tests/test_v6_legal.py
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import time
from http.client import HTTPConnection
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(__file__))
from test_product_v3 import BASE, PASSWORD, POSTGRES, get, post, psql  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from app import legal  # noqa: E402  (pure constants, no dependencies)

ORIGIN = BASE[: -len("/api")] if BASE.endswith("/api") else BASE
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-only-jwt-secret-change-me-0123456789abcdef")


def _ip(stamp):
    return f"10.6.{(stamp // 256) % 256}.{stamp % 256}"


def _signup(prefix, body_extra=None, ip=None):
    stamp = int(time.time() * 1000)
    email = f"{prefix}{stamp}@example.com"
    body = {"email": email, "password": PASSWORD, "accept_terms": True}
    if body_extra is not None:
        body = {"email": email, "password": PASSWORD, **body_extra}
    s, out = post("/signup", body, ip=ip or _ip(stamp))
    return email, s, out


def _user(prefix):
    email, s, body = _signup(prefix)
    assert s == 200, body
    return email, body["token"]


def psql_value(sql):
    """One scalar out of Postgres, through the same command the harness uses."""
    r = subprocess.run(f'{POSTGRES} -Atc "{sql}"', shell=True, capture_output=True,
                       text=True, check=True)
    return r.stdout.strip()


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _verify_token(uid, purpose="verify"):
    """An HS256 token the way app/security.py mints one (stdlib only, so the
    test needs no PyJWT)."""
    now = int(time.time())
    head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps({"sub": str(uid), "purpose": purpose,
                               "iat": now, "exp": now + 3600}).encode())
    sig = hmac.new(JWT_SECRET.encode(), f"{head}.{payload}".encode(), hashlib.sha256).digest()
    return f"{head}.{payload}.{_b64(sig)}"


def raw_get(path):
    """Status and headers of a GET without following redirects."""
    u = urlsplit(ORIGIN)
    conn = HTTPConnection(u.hostname, u.port or 80, timeout=30)
    try:
        conn.request("GET", path, headers={"Accept": "application/json"})
        r = conn.getresponse()
        r.read()
        return r.status, {k.lower(): v for k, v in r.getheaders()}
    finally:
        conn.close()


# ---- the tick at sign-up ------------------------------------------------

def test_signup_refuses_without_the_tick():
    email, s, body = _signup("notick", body_extra={})
    assert s == 422, body
    assert "tick the box" in body["detail"]
    email, s, body = _signup("untick", body_extra={"accept_terms": False})
    assert s == 422, body
    assert psql_value(f"SELECT COUNT(*) FROM users WHERE email='{email}'") == "0"


def test_signup_records_the_version_and_me_carries_it():
    email, token = _user("tick")
    assert psql_value(
        f"SELECT accepted_terms_version FROM users WHERE email='{email}'") == legal.TERMS_VERSION
    assert psql_value(
        f"SELECT accepted_terms_at IS NOT NULL FROM users WHERE email='{email}'") == "t"
    s, me = get("/me", token)
    assert s == 200, me
    assert me["accepted_terms_version"] == legal.TERMS_VERSION
    assert me["accepted_terms_at"]
    assert me["terms_version_current"] == legal.TERMS_VERSION
    # login answers with the same fields
    s, body = post("/login", {"email": email, "password": PASSWORD})
    assert s == 200 and body["user"]["accepted_terms_version"] == legal.TERMS_VERSION


# ---- the one-time acknowledgement ---------------------------------------

def test_consent_rejects_a_stale_version_and_is_idempotent():
    email, token = _user("consent")
    psql(f"UPDATE users SET accepted_terms_version=NULL, accepted_terms_at=NULL "
         f"WHERE email='{email}';")
    s, me = get("/me", token)
    assert s == 200 and me["accepted_terms_version"] is None and me["accepted_terms_at"] is None
    s, body = post("/me/consent", {"version": "2000-01-01"}, token)
    assert s == 422, body
    s, me = get("/me", token)
    assert me["accepted_terms_version"] is None, "a stale tick must not be stored"
    s, first = post("/me/consent", {"version": legal.TERMS_VERSION}, token)
    assert s == 200, first
    assert first["accepted_terms_version"] == legal.TERMS_VERSION and first["accepted_terms_at"]
    assert first["email"] == email and "tier" in first, "the refreshed me comes back"
    s, again = post("/me/consent", {"version": legal.TERMS_VERSION}, token)
    assert s == 200 and again["accepted_terms_at"] == first["accepted_terms_at"]
    assert post("/me/consent", {"version": legal.TERMS_VERSION})[0] == 401


# ---- the server-side gate -----------------------------------------------

def test_api_refuses_an_account_without_the_current_tick():
    """Every /api/* route answers 403 consent_required for an account whose
    accepted_terms_version is not the current one, except the few that let
    the person tick, read, export or delete (DESIGN_V6 §6, §10)."""
    email, token = _user("gate")
    s, body = get("/overview", token)
    assert s == 200, body
    psql(f"UPDATE users SET accepted_terms_version=NULL WHERE email='{email}';")
    s, body = get("/overview", token)
    assert s == 403 and body == {"detail": "consent_required"}, (s, body)
    s, body = get("/board", token)
    assert s == 403 and body["detail"] == "consent_required", (s, body)
    s, body = get("/me/record", token)
    assert s == 403 and body["detail"] == "consent_required", (s, body)
    # what stays open: read the account, export it, resend the verification
    s, me = get("/me", token)
    assert s == 200 and me["accepted_terms_version"] is None, me
    s, body = get("/me/export", token)
    assert s == 200, body
    s, body = post("/me/verify/resend", None, token)
    assert s == 200, body
    # a stale version is refused by consent itself, and the gate stays shut
    s, body = post("/me/consent", {"version": "2000-01-01"}, token)
    assert s == 422, body
    assert get("/overview", token)[0] == 403
    # the tick reopens everything
    s, body = post("/me/consent", {"version": legal.TERMS_VERSION}, token)
    assert s == 200 and body["accepted_terms_version"] == legal.TERMS_VERSION, body
    s, body = get("/overview", token)
    assert s == 200, body
    # an anonymous request is still a 401, never a consent answer
    assert get("/overview")[0] == 401


# ---- verify and resend ---------------------------------------------------

def test_verify_redirects_to_the_client_page():
    email, token = _user("verify")
    uid = int(psql_value(f"SELECT id FROM users WHERE email='{email}'"))
    good = _verify_token(uid)
    status, headers = raw_get(f"/api/verify?token={good}")
    assert status in (302, 303, 307), status
    assert headers["location"] == "/verified?ok=1"
    s, me = get("/me", token)
    assert me["verified"] is True
    # the same link a second time has nothing left to flip: used
    status, headers = raw_get(f"/api/verify?token={good}")
    assert headers["location"] == "/verified?ok=0"
    status, headers = raw_get("/api/verify?token=not-a-token")
    assert status in (302, 303, 307) and headers["location"] == "/verified?ok=0"
    # a session token is not a verification token
    status, headers = raw_get(f"/api/verify?token={token}")
    assert headers["location"] == "/verified?ok=0"


def test_resend_is_rate_limited_and_honest_when_verified():
    email, token = _user("resend")
    for _ in range(3):
        s, body = post("/me/verify/resend", None, token)
        assert s == 200 and body == {"sent": True, "verified": False}, body
    s, body = post("/me/verify/resend", None, token)
    assert s == 429, body
    psql(f"UPDATE users SET verified=TRUE WHERE email='{email}';")
    s, body = post("/me/verify/resend", None, token)
    assert s == 200 and body == {"sent": False, "verified": True}, body
    assert post("/me/verify/resend", None)[0] == 401


# ---- emails ---------------------------------------------------------------

def _database_url():
    m = re.search(r"postgres(?:ql)?://\S+", POSTGRES)
    if m:
        return m.group(0).strip('"\'')
    return os.environ.get("DATABASE_URL")


_PROBE = r"""
import json, sys
from datetime import datetime, timezone
from app import admin, email as emailer, jobs, main
from app.db import get_conn
captured = []
def fake_send(to, subject, body):
    captured.append({"to": to, "subject": subject, "body": body})
    return "skipped"  # nothing is recorded as delivered
emailer.send_email = fake_send  # main, admin and channels all call through this name
uid, email = int(sys.argv[1]), sys.argv[2]
main._send_verification(email, uid)
admin.forgot(admin.ResetRequestIn(email=email))
conn = get_conn()
jobs._dispatch(conn, uid, 0, "LEU", "borrow_fee_2x", None, datetime.now(timezone.utc),
               ["email"], email, True, False, None, False, None)
with conn.cursor() as cur:
    cur.execute("SELECT id FROM runs WHERE status='completed' ORDER BY as_of DESC LIMIT 1")
    run = cur.fetchone()
if run:
    jobs._send_digest(conn, uid, run[0], email)
conn.close()
print(json.dumps(captured))
"""


def _emails_for(email):
    """Runs the alert sweep's dispatch and the digest for one user in-process,
    with the email sender stubbed, and returns what would have gone out."""
    import pytest
    url = _database_url()
    if not url:
        pytest.skip("no DATABASE_URL derivable from POSTGRES_CMD")
    uid = psql_value(f"SELECT id FROM users WHERE email='{email}'")
    env = {**os.environ, "DATABASE_URL": url, "APP_BASE_URL": ORIGIN,
           "JWT_SECRET": JWT_SECRET, "PYTHONPATH": ROOT}
    py = shutil.which("python3") or shutil.which("python")
    r = subprocess.run([py, "-c", _PROBE, uid, email], cwd=ROOT, env=env,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_alert_and_digest_emails_carry_fine_print_and_unsubscribe():
    email, token = _user("mail")
    psql(f"UPDATE users SET verified=TRUE WHERE email='{email}';")
    post("/me/industries", {"key": "energy_nuclear"}, token)
    mails = _emails_for(email)
    assert len(mails) >= 3, mails
    verification, reset, alert = mails[0], mails[1], mails[2]
    # account emails: the paragraph and the settings link, no unsubscribe
    assert verification["subject"] == "Verify your tradealert.me account"
    assert f"{ORIGIN}/api/verify?token=" in verification["body"]
    assert "Measured, not predicted." in verification["body"]
    assert reset["subject"] == "Reset your tradealert.me password"
    for m in (verification, reset):
        assert legal.FINE_PRINT_LONG in m["body"], m["subject"]
        assert m["body"].rstrip().endswith(f"Change how you reach me: {ORIGIN}/settings")
        assert "/unsubscribe?" not in m["body"]
    assert alert["subject"] == "[tradealert] LEU: The cost to borrow doubles", alert["subject"]
    assert f"Show me the report: {ORIGIN}/stock/LEU" in alert["body"]
    assert legal.FINE_PRINT_LONG in alert["body"]
    assert f"{ORIGIN}/unsubscribe?token=" in alert["body"]
    assert f"{ORIGIN}/settings" in alert["body"]
    assert "not a recommendation. Unsubscribe: your account settings" not in alert["body"]
    assert alert["body"].rstrip().endswith(f"{ORIGIN}/settings"), "the footer ends the email"
    if len(mails) > 3:
        digest = mails[3]
        assert digest["subject"].startswith("[tradealert] My week, measured")
        assert legal.FINE_PRINT_LONG in digest["body"]
        assert f"{ORIGIN}/unsubscribe?token=" in digest["body"]
        assert f"{ORIGIN}/home" in digest["body"]
        assert "Measured, not predicted." in digest["body"]
        assert "/overview" not in digest["body"]
    # the link works, silences email, and the account can turn it back on
    m = re.search(r"/unsubscribe\?token=([^&\s]+)&channel=email", alert["body"])
    assert m, alert["body"]
    tok = m.group(1)
    s, body = get(f"/unsubscribe?token={tok}&channel=email")
    assert s == 200 and body == {"ok": True, "channel": "email"}, body
    s, settings = get("/me/settings", token)
    assert settings["channel_email"] is False
    s, body = get(f"/unsubscribe?token={tok}&channel=email")
    assert body["ok"] is False, "a spent token stays spent"
    s, settings = post_patch("/me/settings", {"channel_email": True}, token)
    assert s == 200 and settings["channel_email"] is True, settings


def post_patch(path, body, token):
    from test_product_v3 import _call
    return _call("PATCH", path, body, token)


# ---- the two copies of the constants ------------------------------------

def _js_string(name):
    src = open(os.path.join(ROOT, "frontend", "src", "lib", "legal.js")).read()
    m = re.search(rf"export const {name} =\s*((?:\"[^\"]*\"\s*\+?\s*)+);", src)
    assert m, name
    return "".join(re.findall(r'"([^"]*)"', m.group(1)))


def test_frontend_and_backend_legal_constants_match():
    assert _js_string("TERMS_VERSION") == legal.TERMS_VERSION
    assert _js_string("TERMS_EFFECTIVE") == legal.TERMS_EFFECTIVE
    assert _js_string("FINE_PRINT_SHORT") == legal.FINE_PRINT_SHORT
    assert _js_string("FINE_PRINT_LONG") == legal.FINE_PRINT_LONG
    assert _js_string("CONSENT_LABEL") == legal.CONSENT_LABEL
    for clause in ("owes you no fiduciary duty", "gives no personalised advice",
                   "not a registered investment adviser or broker-dealer"):
        assert clause in legal.FINE_PRINT_LONG, clause


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
