# Upgrading a running box to the latest `main`

`deploy/setup.sh` bootstraps a fresh host. This is the other path: a box
that already runs the product and must move to the current code without
losing its database or its TLS certificate. Every step is safe to re-run.

Run everything as the deploy user on the box, in `/opt/tradealert.me`.

## 0. See what is there

```sh
cd /opt/tradealert.me
git log -1 --oneline                      # the deployed commit
git status --short                        # local edits that a pull would meet
docker compose ps                         # app, postgres (worker appears after this upgrade)
docker compose exec -T postgres psql -U tradealert -d tradealert \
  -c "SELECT file FROM schema_migrations ORDER BY file"       # what is applied
```

If `git status` shows edits to tracked files, stash them (`git stash`) and
reapply after the pull; `.env` and `logs/` are ignored and untouched.

## 1. Back up the database

```sh
mkdir -p ~/backups
docker compose exec -T postgres pg_dump -U tradealert tradealert \
  | gzip > ~/backups/tradealert-$(date +%F-%H%M).sql.gz
ls -la ~/backups
```

Restore, if ever needed: `gunzip -c FILE | docker compose exec -T postgres psql -U tradealert -d tradealert`.

## 2. Bring `.env` up to date

Compose now reads variables the first deploy did not have. Missing ones
come through empty (a feature then logs a skip or answers 503), but add
them so compose stops warning and the operator can see what is unset.
Compare against `deploy/env.sample` and append what is missing:

```sh
for k in STRIPE_SECRET_KEY STRIPE_PRICE_ID_free STRIPE_PRICE_ID_basic \
         STRIPE_PRICE_ID_pro STRIPE_PRICE_ID_investor STRIPE_WEBHOOK_SECRET \
         PULSE_CACHE_SECONDS VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT \
         TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM WEBHOOK_SECRET_KEY \
         BILLING_DEV_MODE OAUTH_DEV_MODE GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET OPS_EMAIL; do
  grep -q "^$k=" .env || echo "$k=" >> .env
done
```

Then set, by hand:

- `WEBHOOK_SECRET_KEY` to a fresh random value if it is empty
  (`head -c 20 /dev/urandom | base64 | tr -d '/+=' | head -c 32`).
- `BILLING_DEV_MODE=0` and `OAUTH_DEV_MODE=0`.
- `PULSE_CACHE_SECONDS=300`, `VAPID_SUBJECT=mailto:alerts@tradealert.me`.
- `OPS_EMAIL` to the address that should get the worker's disk and
  failure notices.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` only when the Google button
  should work; the redirect URI to register is
  `https://tradealert.me/api/oauth/callback/google`.

`JWT_SECRET` and `POSTGRES_PASSWORD` must stay what they are: a new JWT
secret signs every subscriber out, and a new database password does not
reach the existing volume.

## 3. Pull the code

The built frontend is committed under `static/`, so the box needs no node.

```sh
git fetch origin main
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

## 4. Rebuild and restart the containers

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app        # expect "applied 0NN_*.sql" lines, then uvicorn
```

The app container runs `db/migrate.py` before uvicorn, so every migration
not yet in `schema_migrations` (up to `013_strategy_record.sql`) is applied
here, each in its own transaction. The `worker` service is new: it refreshes
daily bars and dated events, sweeps alerts, sends the weekly brief and
does housekeeping, and writes its notices to `./logs/alerts.log`.

## 5. Refresh the reference seed

`db/seed.sql` holds industries, strategies, triggers and tiers as upserts
and has changed since the first deploy (plain-language names and
descriptions). It is not in the image, so apply it from the checkout:

```sh
docker compose exec -T postgres psql -U tradealert -d tradealert -v ON_ERROR_STOP=1 < db/seed.sql
docker compose exec -T app python db/seed_benchmarks.py      # reference ETFs, idempotent, no network
```

Do not run `seed_dev.py`, `seed_demo.py` or `seed_lab.py` on this box:
they are the fixture layer and refuse or pollute a real database.

## 6. Re-install nginx

The template changed (immutable cache headers for hashed assets, a never
cached `index.html`, the `/lab` page, a root for the SPA fallback). It
already carries the Let's Encrypt paths, so copying it over keeps TLS.

```sh
sed -e "s/DOMAIN/tradealert.me/g" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/tradealert.me >/dev/null
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Cron

`deploy/crontab` still runs the nightly snapshot ingest, which the worker
does not do, so keep it. Its sweep and digest lines now duplicate the
worker; both passes are idempotent (one delivery per account per event,
one brief per account per run), so they are harmless, but you can delete
the two `app.jobs` lines from `/etc/crontab` to halve the log noise.

```sh
sudo cp deploy/crontab /etc/crontab      # only if you have not edited it by hand
sudo cp deploy/logrotate /etc/logrotate.d/tradealert
```

## 8. Check

```sh
curl -sSI https://tradealert.me/api/openapi.json | head -1      # the compose healthcheck's own probe
curl -sS https://tradealert.me/api/pulse | head -c 300; echo
curl -sSI https://tradealert.me/ | grep -iE 'HTTP|cache-control'
docker compose logs --tail=30 worker
```

Then, in a browser: the landing loads, log in with an existing account,
the consent screen appears once for accounts created before the terms
version and lands on Home after the tick, `/lab` opens for an admin.

## 9. If something is wrong

- **App container restarting.** `docker compose logs app`. A migration
  error names the file; fix it or restore the backup from step 1 and
  `docker compose up -d --build` again.
- **Blank page or old UI.** Hard-refresh; `index.html` was cacheable under
  the old nginx config and the new one stops that. A stale tab reloads
  itself once when it meets a missing chunk.
- **Roll back.** `git checkout <old commit> && docker compose up -d --build`.
  Migrations are additive, so the old code runs on the new schema.
