"""Operator surface: strategy calibration (BUILD_SPEC 4.5) and password
reset (BUILD_SPEC stage 11). Calibration is gated by users.is_admin."""
import json
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app import security
from app.context import fetch_by_email, fetch_by_id, user_from_creds, user_is_admin, user_id
from app.db import get_conn
from app import email as emailer

router = APIRouter()
bearer = HTTPBearer(auto_error=False)


def _require_admin(creds):
    row = user_from_creds(creds)
    if not user_is_admin(row):
        raise HTTPException(403, "admin only")
    return row


class CalibrateIn(BaseModel):
    resolved_outcomes_count: int | None = Field(default=None, ge=1)
    band_cutoffs: dict | None = None


class ResetRequestIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=72)


@router.post("/api/admin/strategies/{key}/calibrate")
def calibrate(key: str, body: CalibrateIn,
              creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    admin = _require_admin(creds)
    admin_id = user_id(admin)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, calibrated, calibrated_at, resolved_outcomes_count, "
                "band_cutoffs_json FROM strategies WHERE key = %s",
                (key,),
            )
            strat = cur.fetchone()
            if not strat:
                raise HTTPException(404, "not found")
            strat_id, was_calibrated = strat[0], strat[1]
            previous_cutoffs = strat[4] if was_calibrated else None
            new_cutoffs = body.band_cutoffs or strat[4] or {
                "strong": 75, "elevated": 50, "neutral": 25, "weak": 0}
            new_count = body.resolved_outcomes_count or strat[3]
            cur.execute(
                "UPDATE strategies SET calibrated = TRUE, calibrated_at = now(), "
                "resolved_outcomes_count = %s, band_cutoffs_json = %s "
                "WHERE id = %s",
                (new_count, json.dumps(new_cutoffs), strat_id),
            )
            # journal event
            cur.execute(
                "INSERT INTO calibration_events "
                "(strategy_id, event_type, resolved_outcomes_at_event, admin_user_id, "
                "previous_cutoffs_json, new_cutoffs_json, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, now())",
                (strat_id, "recalibrated" if was_calibrated else "calibrated",
                 new_count, admin_id,
                 json.dumps(previous_cutoffs) if previous_cutoffs else None,
                 json.dumps(new_cutoffs)),
            )
            cur.execute(
                "SELECT calibrated, calibrated_at, resolved_outcomes_count, "
                "band_cutoffs_json FROM strategies WHERE id = %s",
                (strat_id,),
            )
            after = cur.fetchone()
        conn.commit()
        return {"key": key, "calibrated": bool(after[0]),
                "calibrated_at": after[1].isoformat(),
                "resolved_outcomes_count": after[2], "band_cutoffs": after[3]}
    finally:
        conn.close()


@router.post("/api/auth/forgot")
def forgot(body: ResetRequestIn):
    email = body.email.strip().lower()
    conn = get_conn()
    try:
        row = fetch_by_email(email)
    finally:
        conn.close()
    if not row:
        # uniform: never reveal whether an address is registered
        return {"sent": True}
    uid = user_id(row)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT reset_counter FROM users WHERE id = %s", (uid,))
            rev = cur.fetchone()[0]
    finally:
        conn.close()
    token = security.make_token(uid, purpose="reset", expires_days=1, v=rev)
    base = __import__("os").environ.get("APP_BASE_URL", "http://localhost:8000")
    link = f"{base}/reset?token={token}"
    try:
        status = emailer.send_email(
            email,
            "Reset your tradealert.me password",
            f"Open this link to choose a new password (expires in 24h):\n\n{link}\n\n"
            "If you did not request this, ignore the email.",
        )
        if status == "skipped":
            import logging
            logging.getLogger("tradealert.admin").info("reset link for %s: %s", email, link)
    except Exception:
        pass
    return {"sent": True}


@router.post("/api/auth/reset")
def reset(body: ResetIn):
    try:
        payload = security.decode_token(body.token, purpose="reset")
        uid = int(payload["sub"])
        rev = int(payload["v"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(400, "invalid or expired reset link")
    hashed = security.hash_password(body.password)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET password_hash = %s, reset_counter = reset_counter + 1 "
                "WHERE id = %s AND reset_counter = %s",
                (hashed, uid, rev),
            )
            if cur.rowcount == 0:
                raise HTTPException(400, "invalid or expired reset link")
        conn.commit()
    finally:
        conn.close()
    return {"reset": True}