"""Outbound channel delivery (BUILD_SPEC stage 11). Every channel is
env-gated and degrades to a logged skip when its credentials are absent,
the same way SES does in app/email.py, so the stack runs on a laptop."""
import hashlib
import hmac
import json
import logging
import os
import urllib.error
import urllib.request

from app import email as emailer
from app.db import get_conn

log = logging.getLogger("tradealert.channels")

_VAPID_CONFIGURED = all(os.environ.get(k) for k in
                        ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"))


def send_email(to, subject, body):
    try:
        return emailer.send_email(to, subject, body) == "sent"
    except Exception as e:  # noqa: BLE001
        log.warning("email to %s failed: %s", to, e)
        return False


def send_push(subscription_json, title, body):
    if not _VAPID_CONFIGURED or not subscription_json:
        log.info("push skipped (VAPID not configured) to %s", title)
        return False
    try:
        from pywebpush import webpush
        webpush(
            subscription_info=subscription_json,
            data=json.dumps({"title": title, "body": body}),
            vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
            vapid_claims={"sub": os.environ["VAPID_SUBJECT"]},
            ttl=86400,
        )
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("push failed: %s", e)
        return False


def send_sms(to_number, body):
    sid = os.environ.get("TWILIO_SID")
    token = os.environ.get("TWILIO_TOKEN")
    from_num = os.environ.get("TWILIO_FROM")
    if not (sid and token and from_num and to_number):
        log.info("sms skipped (Twilio not configured) to %s", to_number)
        return False
    import base64
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
    payload = f"To={to_number}&From={from_num}&Body={body}".encode()
    req = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        data=payload,
        headers={"Authorization": f"Basic {auth}",
                 "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except urllib.error.HTTPError as e:
        log.warning("sms failed: %s %s", e.code, e.read()[:200])
        return False
    except Exception as e:  # noqa: BLE001
        log.warning("sms failed: %s", e)
        return False


def post_webhook(conn, user_id, payload):
    """HMAC-SHA256 signing (X-Tradealert-Signature), read from user_settings.
    A non-2xx response auto-disables the webhook."""
    from app.db import _load_env
    _load_env()
    webhook_key = os.environ.get("WEBHOOK_SECRET_KEY")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT webhook_url, webhook_enabled, webhook_secret "
            "FROM user_settings WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
    if not row or not row[0] or not row[1]:
        log.info("webhook skipped (not enabled) for user %s", user_id)
        return False
    url, _enabled, secret_blob = row[0], row[1], row[2]
    if secret_blob and webhook_key:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pgp_sym_decrypt(webhook_secret, %s) "
                "FROM user_settings WHERE user_id = %s",
                (webhook_key, user_id),
            )
            secret = cur.fetchone()[0]
    else:
        secret = b""
    body = json.dumps(payload, separators=(",", ":")).encode()
    digest = hmac.new(secret, body, hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json",
                 "X-Tradealert-Signature": digest},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except urllib.error.HTTPError as e:
        log.warning("webhook %s -> %s %s; auto-disabling", url, e.code, e.reason)
        _auto_disable(conn, user_id)
        return False
    except Exception as e:  # noqa: BLE001
        log.warning("webhook %s failed: %s; auto-disabling", url, e)
        _auto_disable(conn, user_id)
        return False


def _auto_disable(conn, user_id):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE user_settings SET webhook_enabled = FALSE, "
            "webhook_auto_disabled_at = now() WHERE user_id = %s",
            (user_id,),
        )
    conn.commit()