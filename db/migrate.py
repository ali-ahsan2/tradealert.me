"""Idempotent migration runner. Applies every .sql file in db/migrations/
not yet recorded in schema_migrations, in filename order, each inside its
own transaction.

Run at app container start (Dockerfile CMD) after postgres is healthy, so a
fresh box gets schema.sql via the postgres entrypoint and every migration
here; an existing box gets only what is still pending.

    python db/migrate.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_conn  # noqa: E402

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def main():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " file TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            cur.execute("SELECT file FROM schema_migrations")
            applied = {row[0] for row in cur.fetchall()}
        conn.commit()
        conn.autocommit = True

        for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if f.name in applied:
                continue
            with conn.cursor() as cur:
                cur.execute(f.read_text())  # multi-statement batch; files are idempotent
                cur.execute("INSERT INTO schema_migrations (file) VALUES (%s)", (f.name,))
            print(f"applied {f.name}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()