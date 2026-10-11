"""Shared auth helpers for the product routers (account, alerts, billing,
admin, channels). Kept out of main.py so routers never import the app
entrypoint; the row shape is the users table:
  (id, email, password_hash, verified, is_admin, created_at,
   name, provider, provider_id, accepted_terms_version)
"""
import jwt
from fastapi.exceptions import HTTPException

from app import legal, security
from app.db import get_conn

_USER_COLS = ("id, email, password_hash, verified, is_admin, created_at, "
              "name, provider, provider_id, accepted_terms_version")

# The one answer every /api/* route gives an account that has not ticked
# the current terms (DESIGN_V6 §6, §10). The client sends it to /welcome.
CONSENT_REQUIRED = "consent_required"


def user_id(row):
    return row[0]


def user_email(row):
    return row[1]


def user_verified(row):
    return bool(row[3])


def user_is_admin(row):
    return bool(row[4])


def user_terms_version(row):
    """accepted_terms_version, from a context row (index 9) or main's wider
    row (same index); None when the column was not selected."""
    return row[9] if len(row) > 9 else None


def has_current_consent(row):
    return user_terms_version(row) == legal.TERMS_VERSION


def require_current_terms(row):
    """403 consent_required unless the account accepted the current terms
    version. Admins are exempt so the Lab is never blocked; the routes that
    let a person tick, read, export or delete their own account pass
    require_consent=False instead."""
    if user_is_admin(row) or has_current_consent(row):
        return row
    raise HTTPException(403, CONSENT_REQUIRED)


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


def user_from_creds(creds, required=True, require_consent=True):
    """Validate a bearer subject; returns the users row or None when unauthed.
    required=True raises 401 exactly like main's helper. require_consent=True
    (the default for every route) answers 403 consent_required for an
    account that has not accepted the current terms; see require_current_terms."""
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
    if require_consent:
        require_current_terms(row)
    return row