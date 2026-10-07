"""Bring an empty database to a runnable product in one command.

    python db/bootstrap.py            # schema, migrations, reference seed, universe
    python db/bootstrap.py --fixture  # ...plus the dev fixture and a dev login

Steps, each idempotent so the command is safe to re-run:
  1. wait for DATABASE_URL to accept connections (up to 60 s)
  2. db/schema.sql (CREATE IF NOT EXISTS throughout)
  3. db/migrate.py (records what it applied in schema_migrations)
  4. db/seed.sql (industries, strategies, triggers, tiers; ON CONFLICT upserts)
  5. db/seed_universe.py (instruments and one scored run). Needs the
     workbench's data.js at $WB_DIR; when it is absent a stub with no live
     market data is used so the universe still loads, scored on the
     operator's research inputs alone
  6. db/seed_benchmarks.py (reference ETFs, no network)
  7. with --fixture: db/seed_dev.py, then db/seed_lab.py and db/seed_demo.py

Secrets never appear here; everything reads .env through app.db."""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.db import get_conn  # noqa: E402  (loads .env)

DB = ROOT / "db"


def _wait_for_db(seconds=60):
    deadline = time.time() + seconds
    last = None
    while time.time() < deadline:
        try:
            get_conn().close()
            return
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5)
    raise SystemExit(f"database not reachable at DATABASE_URL after {seconds}s: {last}")


def _apply_sql(path):
    sql = path.read_text(encoding="utf-8")
    conn = get_conn()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(sql)
    finally:
        conn.close()
    print(f"applied {path.relative_to(ROOT)}")


def _run(script, env=None):
    print(f"== {script.relative_to(ROOT)}")
    subprocess.run([sys.executable, str(script)], check=True, cwd=str(ROOT),
                   env={**os.environ, **(env or {})})


def _seed_universe():
    wb = Path(os.environ.get("WB_DIR", ROOT.parent))
    if (wb / "data.js").exists() and (wb / "_workbench_meta.json").exists():
        _run(DB / "seed_universe.py", {"WB_DIR": str(wb)})
        return
    # no workbench checkout beside the repo: use the vendored meta with an
    # empty live-data object so instruments and a scored run still exist
    tmp = Path(tempfile.mkdtemp(prefix="ta-wb-"))
    shutil.copy(DB / "_workbench_meta.json", tmp / "_workbench_meta.json")
    (tmp / "data.js").write_text('window.LIVE_DATA = {"tickers": {}};\n')
    print("workbench data.js not found; seeding the universe without live market data")
    try:
        _run(DB / "seed_universe.py", {"WB_DIR": str(tmp)})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixture", action="store_true",
                    help="also load the dev fixture (synthetic bars and snapshots, a dev login)")
    ap.add_argument("--skip-universe", action="store_true", help="do not run seed_universe.py")
    args = ap.parse_args()

    _wait_for_db()
    _apply_sql(DB / "schema.sql")
    _run(DB / "migrate.py")
    _apply_sql(DB / "seed.sql")
    if not args.skip_universe:
        _seed_universe()
    _run(DB / "seed_benchmarks.py")
    if args.fixture:
        _run(DB / "seed_dev.py", {"DEV_FIXTURE": "1"})
        _run(DB / "seed_lab.py")
        _run(DB / "seed_demo.py")
    print("bootstrap complete")


if __name__ == "__main__":
    main()
