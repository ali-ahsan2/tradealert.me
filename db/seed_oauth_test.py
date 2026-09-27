"""Test user for the OAuth sign-in flow (see app/oauth.py).

A single row that mirrors the OAUTH_DEV_MODE profile exactly, so the
sandbox button resolves to a stable account regardless of how many
times the flow is exercised. Idempotent.

Run:  docker compose exec app python db/seed_oauth_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_conn

# (provider, provider_id, email, name, verified)
USERS = [
    ("google", "g-0001", "demo.google@tradealert.me", "Google Demo", True),
]

conn = get_conn()
try:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tiers WHERE key = 'free'")
        free = cur.fetchone()
        for provider, provider_id, email, name, verified in USERS:
            cur.execute(
                "INSERT INTO users (email, name, provider, provider_id, verified) "
                "VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT (provider, provider_id) WHERE provider IS NOT NULL "
                "DO NOTHING RETURNING id",
                (email, name, provider, provider_id, verified),
            )
            row = cur.fetchone()
            if not row:
                cur.execute(
                    "SELECT id FROM users WHERE provider = %s AND provider_id = %s",
                    (provider, provider_id),
                )
                uid = cur.fetchone()[0]
            else:
                uid = row[0]
            if free:
                cur.execute(
                    "INSERT INTO subscriptions (user_id, tier_id) VALUES (%s, %s) "
                    "ON CONFLICT (user_id) DO NOTHING",
                    (uid, free[0]),
                )
            cur.execute(
                "INSERT INTO user_settings (user_id) VALUES (%s) "
                "ON CONFLICT (user_id) DO NOTHING",
                (uid,),
            )
            print(f"seeded {provider} test user id={uid} {name or 'no name'}")
        conn.commit()
finally:
    conn.close()