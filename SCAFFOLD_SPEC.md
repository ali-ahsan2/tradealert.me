# Tradealert.me — Scaffold Build Spec

Goal: a working skeleton, not the five-strategy engine. Ingestion runs, data lands in Postgres, a daily job runs it, users can sign up, log in, and receive one email. Deployed on a single EC2 box. No paid SaaS.

## Stack

- Backend: Python, FastAPI
- DB: Postgres, run via Docker on the same box (not RDS)
- Queue/scheduler: cron on the box calling a Python script directly (no Redis/Celery)
- Auth: email + password, bcrypt for hashing, self-issued JWT (no Clerk/Auth0)
- Email: AWS SES (pay-per-use, not a subscription)
- Reverse proxy/TLS: nginx + certbot (Let's Encrypt)
- Frontend: plain server-rendered HTML/CSS or a minimal static JS page hitting the API — no framework needed for a scaffold
- Deploy target: single EC2 instance (t3.small or similar)

## Components to build

### 1. Database schema (Postgres)
- `users`: id, email (unique), password_hash, created_at, verified boolean
- `sessions` or rely on stateless JWT (prefer JWT, skip a sessions table)
- `tickers`: id, symbol, last_refreshed_at
- `snapshots`: id, ticker_id, field, value, source, as_of, fetched_at (generic key-value so new fields don't require migrations)

### 2. Ingestion
- Reuse `refresh.py` from `/Users/apple/Desktop/finance/refresh.py` as the reference implementation (already working, already fixed for iBorrowDesk's www subdomain bug).
- Wrap it to write into Postgres `snapshots` table instead of `data.js`.
- One script, callable via `python ingest.py --tickers AAPL,MSFT` or `--all`.

### 3. Queue / scheduled run
- A `crontab` entry (documented in a `deploy/crontab` file) running `ingest.py --all` once daily.
- No message broker. This is intentionally the simplest thing that works.

### 4. Auth API (FastAPI routes)
- `POST /signup` — email + password, hash with bcrypt, insert user, send verification email via SES, return JWT
- `POST /login` — verify password, return JWT
- `GET /me` — JWT-protected, returns current user
- JWT secret from an environment variable, not committed

### 5. Email delivery
- AWS SES client (`boto3`), one function `send_email(to, subject, body)`.
- Used for: signup verification email only in the scaffold (no digest, no alerts yet — those come with the real strategies).
- Needs: SES verified sender identity, IAM credentials on the EC2 instance role (not hardcoded keys).

### 6. Frontend
- Two pages: signup form, login form, and a bare "logged in, here's your JWT-authenticated ping" page to prove the loop works end to end.
- Static HTML + fetch() calls to the API. No build step, no npm framework, so there's nothing to compile on the box.

### 7. nginx config
- Reverse proxy `/api/*` to the FastAPI app (uvicorn on localhost:8000)
- Serve the static frontend directly
- certbot-managed TLS cert for the domain

### 8. Deployment
- `docker-compose.yml` with two services: `postgres` (official image, named volume) and `app` (FastAPI, built from a Dockerfile)
- nginx and certbot run on the host, not in Docker, for simplicity
- `.env` file (gitignored) holds DB URL, JWT secret; SES uses the EC2 instance IAM role, no keys in `.env`

## Explicitly out of scope for this scaffold

- The five scoring strategies (Fast Mover, Market Shift, GeoPolitics, Industry Restructure, Monetary Shifts)
- Calibration journal / recalibration loop
- Alerts, digests, webhooks
- Push notifications, SMS
- Entitlement tiers / billing
- Universe/instrument tagging, quality factors, haircuts

## Order of build (so each step is independently testable)

1. Postgres schema + docker-compose up, confirm connection
2. `ingest.py` writing real data for 2-3 tickers into `snapshots`
3. Auth routes (signup/login/me) against `users` table, tested with curl
4. SES email send, tested with one real verification email
5. Static frontend wired to auth routes
6. nginx + certbot on the actual EC2 box, domain pointed at it
7. cron entry for daily ingest

Each step should be committed separately so a failure in step 6 (deployment) doesn't block steps 1-5 (which can be verified locally first).
