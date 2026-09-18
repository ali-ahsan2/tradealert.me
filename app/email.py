"""One function: send_email(to, subject, body) via AWS SES (pay-per-use).

Credentials come from the EC2 instance IAM role; the .env only names the
verified sender and region. With SES unconfigured the call logs the message
instead of sending, so the scaffold runs on a laptop.
"""
import logging
import os

from app.db import _load_env

_load_env()

log = logging.getLogger("tradealert.email")


def send_email(to, subject, body):
    sender = os.environ.get("SES_VERIFIED_SENDER")
    region = os.environ.get("AWS_REGION")
    if not sender or not region:
        preview = " ".join(body.split())[:200]
        log.warning("SES not configured — not sent to %s. Subject: %s. Body: %s",
                    to, subject, preview)
        return "skipped"
    import boto3
    client = boto3.client("sesv2", region_name=region)
    client.send_email(
        FromEmailAddress=sender,
        Destination={"ToAddresses": [to]},
        Content={"Simple": {"Subject": {"Data": subject},
                            "Body": {"Text": {"Data": body}}}},
    )
    return "sent"