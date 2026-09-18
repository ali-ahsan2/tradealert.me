"""Tradealert scaffold API: signup, login, me, verify. Mounted under /api."""
import logging
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path

import jwt
import psycopg2
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import email as emailer
from app import security
from app.db import _load_env, get_conn

_load_env()

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tradealert")

app = FastAPI(title="tradealert.me", docs_url="/api/docs",
              openapi_url="/api/openapi.json")
bearer = HTTPBearer(auto_error=False)

_ROOT = Path(__file__).resolve().parent.parent
_STATIC = _ROOT / "static"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# per-IP fixed-window rate limits; in-memory is fine for a single uvicorn
# worker and resets on restart. Behind nginx the client IP comes from
# X-Forwarded-For, which only nginx can set (the app port binds to localhost).
_RATE_LIMITS = {"signup": (5, 3600), "login": (10, 60)}
_hits = defaultdict(deque)


def _rate_limited(route, ip):
    if not ip:
        return False
    limit, window = _RATE_LIMITS[route]
    now = time.time()
    if len(_hits) > 10_000:
        # bound memory on a busy or abusively-proxied box: drop every bucket
        # whose newest hit is already past its window
        for key in [k for k, q in _hits.items()
                    if not q or now - q[0] > _RATE_LIMITS[k[0]][1]]:
            del _hits[key]
    q = _hits[(route, ip)]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def _client_ip(request):
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


class SignupIn(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)


class LoginIn(BaseModel):
    email: str
    password: str


def _user_payload(row):
    uid, email, _h, verified, created_at = row
    return {"email": email, "verified": bool(verified),
            "created_at": created_at.isoformat()}


def _get_by(conn, column, value):
    if column not in {"email", "id"}:
        raise ValueError(f"unexpected column {column!r}")
    cur = conn.cursor()
    cur.execute(f"SELECT id, email, password_hash, verified, created_at "
                f"FROM users WHERE {column} = %s", (value,))
    return cur.fetchone()


def _send_verification(email, user_id):
    token = security.make_token(user_id, purpose="verify", expires_days=1)
    base = os.environ.get("APP_BASE_URL", "http://localhost:8000")
    link = f"{base}/api/verify?token={token}"
    try:
        status = emailer.send_email(
            email,
            "Verify your tradealert.me account",
            "Confirm your email address to finish signing up.\n\n"
            f"Open this link: {link}\n\n"
            "This link expires in 24 hours. If you did not create an account, "
            "ignore this email.",
        )
        if status == "skipped":
            # dev mode: the console is the only delivery mechanism
            log.info("verification link for %s: %s", email, link)
        else:
            log.info("verification email sent to %s (token %s...)", email, token[:8])
    except Exception as e:  # never fail signup over email delivery
        log.warning("verification email to %s failed: %s", email, e)


@app.post("/api/signup")
def signup(body: SignupIn, request: Request):
    if _rate_limited("signup", _client_ip(request)):
        raise HTTPException(429, "too many signups from this address, try later")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "enter a valid email address")
    if not 8 <= len(body.password) <= 72 or len(body.password.encode("utf-8")) > 72:
        raise HTTPException(422, "password must be 8-72 bytes")
    hashed = security.hash_password(body.password)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO users (email, password_hash) VALUES (%s, %s) "
                    "RETURNING id, created_at",
                    (email, hashed),
                )
                uid, created_at = cur.fetchone()
                conn.commit()
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                raise HTTPException(409, "that email is already registered")
    finally:
        conn.close()
    _send_verification(email, uid)
    return {"token": security.make_token(uid),
            "user": {"email": email, "verified": False,
                     "created_at": created_at.isoformat()}}


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    if _rate_limited("login", _client_ip(request)):
        raise HTTPException(429, "too many attempts, try later")
    email = body.email.strip().lower()
    conn = get_conn()
    try:
        row = _get_by(conn, "email", email)
    finally:
        conn.close()
    if not row or not security.check_password(body.password, row[2]):
        raise HTTPException(401, "invalid email or password")
    return {"token": security.make_token(row[0]), "user": _user_payload(row)}


@app.get("/api/me")
def me(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if creds is None:
        raise HTTPException(401, "missing bearer token")
    try:
        payload = security.decode_token(creds.credentials, purpose="session")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(401, "invalid or expired token")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(401, "invalid token payload")
    conn = get_conn()
    try:
        row = _get_by(conn, "id", user_id)
    finally:
        conn.close()
    if not row:
        raise HTTPException(401, "user no longer exists")
    return _user_payload(row)


@app.get("/api/verify")
def verify(token: str):
    try:
        payload = security.decode_token(token, purpose="verify")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(400, "invalid or expired verification link")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "invalid verification link")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET verified = TRUE WHERE id = %s "
                "RETURNING email, verified",
                (user_id,),
            )
            row = cur.fetchone()
            conn.commit()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "user not found")
    log.info("verified email %s", row[0])
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Email verified</title></head>'
        '<body style="font-family:sans-serif;line-height:1.6;max-width:30em;'
        'margin:4em auto;padding:0 1em;text-align:center">'
        '<h1>Email verified</h1>'
        '<p>Your tradealert.me account is active.</p>'
        '<p><a href="/login.html">Log in now</a></p>'
        '</body></html>')

if _STATIC.is_dir():
    app.mount("/", StaticFiles(directory=str(_STATIC), html=True), name="static")
