"""Tradealert scaffold API: signup, login, me, verify. Mounted under /api."""
import logging
import os
import re
from pathlib import Path

import jwt
import psycopg2
from fastapi import Depends, FastAPI, HTTPException
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
            log.info("verification link for %s: %s", email, link)
    except Exception as e:  # never fail signup over email delivery
        log.warning("verification email to %s failed: %s", email, e)


@app.post("/api/signup")
def signup(body: SignupIn):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "enter a valid email address")
    if not 8 <= len(body.password) <= 72:
        raise HTTPException(422, "password must be 8-72 characters")
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
def login(body: LoginIn):
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
    conn = get_conn()
    try:
        row = _get_by(conn, "id", int(payload["sub"]))
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
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET verified = TRUE WHERE id = %s "
                "RETURNING email, verified",
                (int(payload["sub"]),),
            )
            row = cur.fetchone()
            conn.commit()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "user not found")
    return {"verified": True, "email": row[0]}

if _STATIC.is_dir():
    app.mount("/", StaticFiles(directory=str(_STATIC), html=True), name="static")
