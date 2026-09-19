"""Billing (BUILD_SPEC stage 9): Stripe Checkout + customer portal +
webhook handler, subscriptions wiring, downgrade enforcement.

Stripe is env-gated: with STRIPE_SECRET_KEY unset the endpoints return
503 and the UI renders the disabled state. BILLING_DEV_MODE=1 arms a
/dev/preview endpoint that applies a tier without payment for local
testing; it is inert in any production env.
"""
import os

import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app import context, scope
from app.db import get_conn
from app import email as emailer

router = APIRouter()
bearer = HTTPBearer(auto_error=False)

_DEV_MODE = os.environ.get("BILLING_DEV_MODE") == "1"


def _stripe():
    key = os.environ.get("STRIPE_SECRET_KEY")
    if not key:
        return None
    try:
        import stripe
        stripe.api_key = key
        return stripe
    except ImportError:
        return None


def _require_user(creds):
    row = context.user_from_creds(creds)
    if not context.user_verified(row):
        raise HTTPException(403, "verify your email before upgrading")
    return row


class TierIn(BaseModel):
    tier_key: str = Field(min_length=1, max_length=32)


def _adopt_tier(conn, user_id, tier_key, customer_id=None, period_end=None):
    """Apply a tier to a subscriber, preserving their data within the new
    limits. Idempotent: an upgrade adopts the tier; a (re)charge renews it."""
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tiers WHERE key = %s", (tier_key,))
        tier = cur.fetchone()
        if not tier:
            raise HTTPException(404, "not found")
        tier_id = tier[0]
        cur.execute(
            "INSERT INTO subscriptions "
            "(user_id, tier_id, status, billing_provider_customer_id, current_period_end) "
            "VALUES (%s, %s, 'active', %s, %s) "
            "ON CONFLICT (user_id) DO UPDATE SET "
            "tier_id = EXCLUDED.tier_id, status = 'active', "
            "billing_provider_customer_id = COALESCE(EXCLUDED.billing_provider_customer_id, "
            "                                         subscriptions.billing_provider_customer_id), "
            "current_period_end = EXCLUDED.current_period_end, "
            "pending_tier_id = NULL, pending_change_at = NULL",
            (user_id, tier_id, customer_id, period_end),
        )
        cur.execute(
            "SELECT key, label, price_monthly_cents, industries_limit, "
            "names_shown_limit, picks_limit, alerts_limit, channels "
            "FROM tiers WHERE id = %s",
            (tier_id,),
        )
        tier_row = cur.fetchone()
        scope.enforce_tier_limits(conn, user_id, tier_row)
        conn.commit()
        return tier_key


@router.get("/api/billing/health")
def billing_health():
    return {"configured": _stripe() is not None, "dev": _DEV_MODE}


@router.post("/api/billing/checkout")
def checkout(body: TierIn,
             creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    stripe = _stripe()
    if stripe is None:
        raise HTTPException(503, "billing is not configured on this instance")
    env_key = "STRIPE_PRICE_ID_" + body.tier_key.upper()
    price_id = os.environ.get(env_key)
    if not price_id:
        raise HTTPException(503, f"no price configured for {body.tier_key} (set {env_key})")
    base = os.environ.get("APP_BASE_URL", "http://localhost:8000")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT billing_provider_customer_id FROM subscriptions "
                "WHERE user_id = %s",
                (uid,),
            )
            customer_id = None
            r = cur.fetchone()
            if r:
                customer_id = r[0]
        if not customer_id:
            customer = stripe.Customer.create(
                email=context.user_email(row), metadata={"user_id": uid})
            customer_id = customer.id
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE subscriptions "
                    "SET billing_provider_customer_id = %s WHERE user_id = %s",
                    (customer_id, uid),
                )
            conn.commit()
    finally:
        conn.close()
    session = stripe.checkout.Session.create(
        mode="subscription",
        client_reference_id=str(uid),
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        metadata={"tier_key": body.tier_key},
        success_url=f"{base}/settings?billing=success",
        cancel_url=f"{base}/pricing?billing=cancel",
    )
    return {"url": session.url}


@router.post("/api/billing/portal")
def portal(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    row = _require_user(creds)
    uid = context.user_id(row)
    stripe = _stripe()
    if stripe is None:
        raise HTTPException(503, "billing is not configured on this instance")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT billing_provider_customer_id FROM subscriptions WHERE user_id = %s",
                (uid,),
            )
            r = cur.fetchone()
    finally:
        conn.close()
    if not r or not r[0]:
        raise HTTPException(400, "no billing customer on file")
    session = stripe.billing_portal.Session.create(
        customer=r[0],
        return_url=f"{os.environ.get('APP_BASE_URL', 'http://localhost:8000')}/pricing",
    )
    return {"url": session.url}


@router.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "billing is not configured")
    import stripe
    body = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            body, request.headers.get("stripe-signature", ""), secret)
    except ValueError:
        raise HTTPException(400, "invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "invalid signature")
    obj = event["data"]["object"]
    conn = get_conn()
    try:
        if event["type"] == "checkout.session.completed":
            uid = int(obj.get("client_reference_id", ""))
            tier_key = (obj.get("metadata") or {}).get("tier_key")
            period_end = None
            sub_id = obj.get("subscription")
            stripe = _stripe()
            if sub_id and stripe:
                try:
                    period_end = stripe.Subscription.retrieve(sub_id).current_period_end
                except Exception:
                    pass
            if uid and tier_key:
                _adopt_tier(conn, uid, tier_key, obj.get("customer"), period_end)
        elif event["type"] == "customer.subscription.updated":
            uid = _user_from_customer(obj.get("customer"))
            meta = event["data"].get("previous_attributes", {})
            if uid and "cancel_at_period_end" in meta:
                tier_key = getattr(obj, "plan", {}).get("metadata", {}).get("tier_key") or "free"
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE subscriptions SET pending_tier_id = (SELECT id FROM tiers "
                        "WHERE key = 'free'), pending_change_at = now() WHERE user_id = %s",
                        (uid,),
                    )
                conn.commit()
        elif event["type"] == "customer.subscription.deleted":
            uid = _user_from_customer(obj.get("customer"))
            if uid:
                _adopt_tier(conn, uid, "free")
        elif event["type"] == "customer.subscription.created":
            pass  # checkout.session.completed already adopts
    finally:
        conn.close()
    return {"received": True}


def _user_from_customer(customer_id):
    if not customer_id:
        return None
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id FROM subscriptions "
                "WHERE billing_provider_customer_id = %s",
                (customer_id,),
            )
            r = cur.fetchone()
            return r[0] if r else None
    finally:
        conn.close()


@router.post("/api/billing/dev/preview")
def billing_dev_preview(body: TierIn,
                        creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
    """No-payment tier change for local development only. Never active in an
    environment without BILLING_DEV_MODE=1."""
    if not _DEV_MODE:
        raise HTTPException(404, "not found")
    row = _require_user(creds)
    uid = context.user_id(row)
    conn = get_conn()
    try:
        key = _adopt_tier(conn, uid, body.tier_key)
    finally:
        conn.close()
    return {"adopted": key, "dev": True}