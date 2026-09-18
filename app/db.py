"""Shared DB access for the app and ingest. Reads DATABASE_URL from .env."""
import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def _load_env():
    env = _ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v)


_load_env()


def get_conn():
    import psycopg2

    return psycopg2.connect(os.environ["DATABASE_URL"])