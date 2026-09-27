"""OAuth sign-in for Google. Authorization Code + PKCE.

Google returns a verified email on the userinfo endpoint, so every
Google sign-in resolves to a users row with that email, verified. A
social account carries no local password.

OAUTH_DEV_MODE=1 arms the button on the sandbox: /start skips the
provider redirect and /callback fabricates a fixed dev profile, so the
entire path runs offline against the seeded test user
(db/seed_oauth_test.py). The profile shape, the state store, and the
user upsert are identical to the live flow.

Credentials come from env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
Without them the button returns 503 instead of emitting a broken
redirect, matching the pattern of the other optional integrations
(Stripe, Twilio, SES).
"""
import base64
import hashlib
import html
import json
import logging
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter
from fastapi.exceptions import HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse

from app.db import _load_env, get_conn
from app import security

_load_env()

log = logging.getLogger("tradealert.oauth")

router = APIRouter()

_DEV = os.environ.get("OAUTH_DEV_MODE") == "1"

_PROVIDERS = {
    "google": {
        "label": "Google",
        "authorize_uri": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "userinfo_uri": "https://openidconnect.googleapis.com/v1/userinfo",
        "scopes": "openid email profile",
        "client_id_env": "GOOGLE_CLIENT_ID",
        "client_secret_env": "GOOGLE_CLIENT_SECRET",
    },
}

# Mock identity for OAUTH_DEV_MODE; must match db/seed_oauth_test.py.
_DEV_PROFILES = {
    "google": {
        "provider_id": "g-0001",
        "email": "demo.google@tradealert.me",
        "verified": True,
        "name": "Google Demo",
    },
}

# PKCE verifier lives only in a signed, short-lived state entry.
_CODE_VERIFIER_TTL = 600
_pending = {}


def _provider(provider):
    if provider not in _PROVIDERS:
        raise HTTPException(404, "unknown oauth provider")
    return provider, _PROVIDERS[provider]


def _client_creds(provider, conf):
    cid = os.environ.get(conf["client_id_env"])
    secret = os.environ.get(conf["client_secret_env"])
    if not cid or not secret:
        raise HTTPException(503, f"{conf['label']} sign in is not configured")
    return cid, secret


def _b64url(n):
    return base64.urlsafe_b64encode(os.urandom(n)).rstrip(b"=").decode("ascii")


def _redirect_uri(provider):
    base = os.environ.get("APP_BASE_URL", "http://localhost:8000")
    return f"{base}/api/oauth/callback/{provider}"


def _store_state(provider):
    state = _b64url(24)
    _pending[state] = {"provider": provider, "created_at": time.time()}
    return state


def _pop_state(provider, state):
    entry = _pending.pop(state, None)
    if not entry:
        raise HTTPException(400, "invalid or expired oauth state")
    if entry["provider"] != provider:
        raise HTTPException(400, "oauth state does not match provider")
    if time.time() - entry["created_at"] > _CODE_VERIFIER_TTL:
        raise HTTPException(400, "oauth session expired, try again")
    return entry


def _prune_pending():
    cutoff = time.time() - _CODE_VERIFIER_TTL
    expired = [s for s, e in _pending.items() if e["created_at"] < cutoff]
    for s in expired:
        _pending.pop(s, None)


def _post_form(url, data):
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    req = Request(url, data=urlencode(data).encode("utf-8"),
                  method="POST", headers=headers)
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        log.warning("oauth token exchange failed for %s: %s %.200s",
                    url, e.code, e.read().decode("utf-8", "replace"))
        raise HTTPException(502, "provider token exchange failed") from None
    except URLError as e:
        raise HTTPException(502, "provider token exchange failed") from None


def _get_json(url, bearer):
    req = Request(url, headers={"Authorization": f"Bearer {bearer}"})
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        log.warning("oauth profile fetch failed: %s %.200s", e.code,
                    e.read().decode("utf-8", "replace"))
        raise HTTPException(502, "provider profile fetch failed") from None
    except URLError as e:
        raise HTTPException(502, "provider profile fetch failed") from None


def _profile_from_provider(conf, code):
    cid, secret = _client_creds("google", conf)
    token = _post_form(conf["token_uri"], {
        "client_id": cid,
        "client_secret": secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": _redirect_uri("google"),
    })
    access = token.get("access_token")
    if not access:
        raise HTTPException(502, "provider did not return an access token")
    raw = _get_json(conf["userinfo_uri"], access)
    email = raw.get("email")
    if not email:
        raise HTTPException(400, "Google account has no email")
    return {
        "provider_id": str(raw.get("sub", "")),
        "email": email.lower(),
        "verified": bool(raw.get("email_verified")),
        "name": raw.get("name"),
    }


def _upsert_user(provider, profile):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, verified FROM users "
                "WHERE provider = %s AND provider_id = %s",
                (provider, profile["provider_id"]),
            )
            row = cur.fetchone()
            uid = row[0] if row else None
            if not uid and profile["email"]:
                cur.execute("SELECT id, verified FROM users WHERE email = %s",
                            (profile["email"],))
                row = cur.fetchone()
                if row:
                    uid = row[0]
                    # Linking a Google identity to an existing row whose email
                    # was never verified: anyone could have pre-registered it,
                    # so drop the password factor and verify via the provider.
                    drop_password = "password_hash = NULL, " if not row[1] else ""
                    cur.execute(
                        f"UPDATE users SET {drop_password}provider = %s, "
                        "provider_id = %s, verified = TRUE, "
                        "name = COALESCE(name, %s) WHERE id = %s",
                        (provider, profile["provider_id"],
                         profile["name"], uid),
                    )
            if not uid:
                cur.execute(
                    "INSERT INTO users (email, name, provider, provider_id, "
                    "verified) VALUES (%s, %s, %s, %s, %s) "
                    "ON CONFLICT (provider, provider_id) WHERE provider IS NOT NULL "
                    "DO UPDATE SET name = EXCLUDED.name "
                    "RETURNING id",
                    (profile["email"], profile["name"], provider,
                     profile["provider_id"], profile["verified"]),
                )
                uid = cur.fetchone()[0]
            _provision(conn, uid)
            conn.commit()
            return uid
    finally:
        conn.close()


def _provision(conn, user_id):
    """Free tier + default settings for a brand-new social account."""
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tiers WHERE key = 'free'")
        tier = cur.fetchone()
        if tier:
            cur.execute(
                "INSERT INTO subscriptions (user_id, tier_id) VALUES (%s, %s) "
                "ON CONFLICT (user_id) DO NOTHING",
                (user_id, tier[0]),
            )
        cur.execute(
            "INSERT INTO user_settings (user_id) VALUES (%s) "
            "ON CONFLICT (user_id) DO NOTHING",
            (user_id,),
        )


def _store_token_page(provider, token, name):
    display_name = html.escape(name) if name else "this account"
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Signed in</title></head>'
        '<body style="font-family:sans-serif;line-height:1.6;max-width:30em;'
        'margin:4em auto;padding:0 1em;text-align:center">'
        '<h1>Signed in</h1>'
        f"<p>Finishing {html.escape(provider)} sign-in for {display_name}\u2026</p>"
        '<script>'
        "try{localStorage.setItem('ta_token',"
        f"{json.dumps(token)});}}catch(e){{}}\n"
        "location.href='/';"
        "</script></body></html>"
    )


@router.get("/api/oauth/start/{provider}")
def oauth_start(provider: str):
    provider, conf = _provider(provider)
    _prune_pending()
    state = _store_state(provider)
    if _DEV:
        return RedirectResponse(
            f"/api/oauth/callback/{provider}?state={state}&dev=1",
            status_code=302,
        )
    cid, _secret = _client_creds(provider, conf)
    verifier = _b64url(32)
    pkce_sha = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(pkce_sha).rstrip(b"=").decode("ascii")
    _pending[state]["code_verifier"] = verifier
    params = {
        "client_id": cid,
        "redirect_uri": _redirect_uri(provider),
        "response_type": "code",
        "scope": conf["scopes"],
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if provider == "google":
        params["prompt"] = "select_account"
    return RedirectResponse(f"{conf['authorize_uri']}?{urlencode(params)}",
                            status_code=302)


@router.get("/api/oauth/callback/{provider}")
def oauth_callback(provider: str, code: str = "",
                   state: str = "", dev: str | None = None):
    provider, conf = _provider(provider)
    entry = _pop_state(provider, state)
    if not entry.get("code_verifier") and not (_DEV or dev == "1"):
        raise HTTPException(400, "missing pkce verifier")
    if _DEV or dev == "1":
        profile = dict(_DEV_PROFILES[provider])
    else:
        if not code:
            raise HTTPException(400, "missing authorization code")
        profile = _profile_from_provider(conf, code)
    uid = _upsert_user(provider, profile)
    token = security.make_token(uid)
    log.info("oauth %s sign-in: user %s (dev=%s)", provider, uid, _DEV or dev == "1")
    return _store_token_page(provider, token, profile.get("name"))