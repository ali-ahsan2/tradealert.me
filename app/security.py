"""Auth primitives: bcrypt password hashing + self-issued JWT (HS256)."""
import datetime as dt
import os

import bcrypt
import jwt

from app.db import _load_env

_load_env()


def hash_password(pw):
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def check_password(pw, hashed):
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _secret():
    return os.environ["JWT_SECRET"]


def make_token(user_id, purpose="session", expires_days=30):
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(user_id),
        "purpose": purpose,
        "iat": now,
        "exp": now + dt.timedelta(days=expires_days),
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


def decode_token(token, purpose=None):
    payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    if purpose and payload.get("purpose") != purpose:
        raise jwt.InvalidTokenError("wrong token purpose")
    return payload