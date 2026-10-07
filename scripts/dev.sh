#!/usr/bin/env bash
# One command to a running tradealert.me on your machine.
#
#   scripts/dev.sh                 bootstrap the database, load the dev fixture,
#                                  build the frontend once, serve on :8000
#   scripts/dev.sh --no-fixture    skip the synthetic fixture (real ingest only)
#   scripts/dev.sh --build         rebuild the frontend bundle before serving
#   scripts/dev.sh --no-serve      prepare everything and exit
#
# Needs: python3 with requirements.txt installed (a venv is fine), node 18+,
# and Postgres reachable at DATABASE_URL. Without a local Postgres the script
# starts the compose service `postgres` if docker compose is available.
# For hot reload run `npm run dev` in frontend/ in a second shell: Vite on
# :5173 proxies /api to this server.
set -euo pipefail
cd "$(dirname "$0")/.."

FIXTURE=1 BUILD=0 SERVE=1
for a in "$@"; do
  case "$a" in
    --no-fixture) FIXTURE=0 ;;
    --build) BUILD=1 ;;
    --no-serve) SERVE=0 ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    *) echo "unknown option $a" >&2; exit 1 ;;
  esac
done

if [ ! -f .env ]; then
  echo "== creating .env from .env.example (dev defaults, local base URL)"
  sed 's#^APP_BASE_URL=.*#APP_BASE_URL=http://localhost:8000#' .env.example > .env
fi
# .env fills in what the shell has not already set, like app/db.py does
while IFS='=' read -r k v; do
  [[ -z "$k" || "$k" == \#* ]] && continue
  [ -z "${!k:-}" ] && export "$k=$v"
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
export BILLING_DEV_MODE="${BILLING_DEV_MODE:-1}" OAUTH_DEV_MODE="${OAUTH_DEV_MODE:-1}"

python3 - <<'PY' || { echo "python deps missing: pip install -r requirements.txt" >&2; exit 1; }
import fastapi, psycopg2, uvicorn, jwt, bcrypt  # noqa: F401
PY

db_up() { python3 -c "import os, psycopg2; psycopg2.connect(os.environ['DATABASE_URL']).close()" 2>/dev/null; }
if ! db_up; then
  if docker compose version >/dev/null 2>&1; then
    echo "== starting postgres via docker compose"
    docker compose up -d postgres
    for _ in $(seq 1 40); do db_up && break; sleep 1.5; done
  fi
  db_up || { echo "no database at DATABASE_URL=$DATABASE_URL (start Postgres or edit .env)" >&2; exit 1; }
fi

if [ "$FIXTURE" = 1 ]; then
  python3 db/bootstrap.py --fixture
else
  python3 db/bootstrap.py
fi

if [ ! -d frontend/node_modules ]; then
  echo "== npm ci (frontend)"
  (cd frontend && npm ci --no-audit --no-fund)
fi
if [ "$BUILD" = 1 ] || ! ls static/assets/main-*.js >/dev/null 2>&1; then
  echo "== building the frontend bundle"
  (cd frontend && npm run build)
fi

echo
echo "ready: http://localhost:8000   (dev login dev@example.com / devpass123 when the fixture is loaded)"
echo "       http://localhost:8000/lab is the operator Lab; the dev login is an admin"
[ "$SERVE" = 1 ] || exit 0
exec python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
