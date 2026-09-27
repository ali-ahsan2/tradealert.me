"""Shared auth helpers for the product routers (account, alerts, billing,
admin, channels). Kept out of main.py so routers never import the app
entrypoint; the row shape is the users table:
  (id, email, password_hash, verified, is_admin, created_at,
   name, provider, provider_id)
"""
import jwt
from fastapi.exceptions import HTTPException

from app import security
from app.db import get_conn

_USER_COLS = ("id, email, password_hash, verified, is_admin, created_at, "
              "name, provider, provider_id")


def user_id(row):
    return row[0]


def user_email(row):
    return row[1]


def user_verified(row):
    return bool(row[3])


def user_is_admin(row):
    return bool(row[4])


def fetch_by_id(user_id):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_USER_COLS} FROM users WHERE id = %s", (user_id,))
            return cur.fetchone()
    finally:
        conn.close()


def fetch_by_email(email):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_USER_COLS} FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    finally:
        conn.close()


def user_from_creds(creds, required=True):
    """Validate a bearer subject; returns the users row or None when unauthed.
    required=True raises 401 exactly like main's helper."""
    if creds is None:
        if required:
            raise HTTPException(401, "missing bearer token")
        return None
    try:
        payload = security.decode_token(creds.credentials, purpose="session")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(401, "invalid or expired token")
    try:
        uid = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(401, "invalid token payload")
    row = fetch_by_id(uid)
    if not row:
        raise HTTPException(401, "user no longer exists")
    return row