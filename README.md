# tradealert.me

Ranked small-cap research with its working shown: a scoring engine over
public filings and market data, a subscriber product (board, screener,
dossiers, calendar, alerts, digests) and an operator Lab for strategy
analysis. FastAPI + Postgres on the back, React + Vite in `frontend/`
built into `static/`.

The product's rules live in the specs at the repo root: `PRODUCT_DESIGN.md`
(design system), `UX_SPEC.md` (screens), `BUILD_SPEC.md` (data contract and
honesty rules), `STRATEGY_ANALYSIS_TOOL.md` and `LAB_DASHBOARD_DESIGN.md`
(the Lab), `SCAFFOLD_SPEC.md` (deployment).

## Run locally

```sh
pip install -r requirements.txt          # a venv is fine
scripts/dev.sh                           # database, fixture, bundle, server
```

Then open <http://localhost:8000> and sign in as `dev@example.com` /
`devpass123` (Pro tier, admin, follows three industries). The script:

1. writes `.env` from `.env.example` with a local base URL if none exists;
2. uses Postgres at `DATABASE_URL`, starting the compose `postgres` service
   when nothing answers and `docker compose` is available;
3. runs `db/bootstrap.py --fixture`: schema, migrations, reference seed,
   the universe and one scored run, benchmarks, then the dev fixture;
4. builds the frontend once (`--build` to rebuild) and serves on `:8000`
   with reload.

For hot reload on the frontend, run `npm run dev` inside `frontend/` in a
second shell; Vite on `:5173` proxies `/api` to the server.

### What the dev fixture is, and is not

`db/seed_dev.py` (run only with `DEV_FIXTURE=1`) writes synthetic daily
bars and snapshots, three earlier runs derived from the seeded one,
impersonal alert events and a dev login, all tagged `dev_fixture` so a
re-run replaces only its own rows. It refuses to run on a database that
already holds bars or snapshots from a real source. Its backtest events are
flagged `synthetic_data_used`, so they appear in the Lab under the
synthetic banner and never on a subscriber screen; past-reaction panels
stay empty until a real event ingest has run. Nothing in the fixture is
market data.

Real data paths: `python ingest.py` and `python refresh.py` for snapshots,
`python -m app.market_data` for daily bars, `python -m app.events_ingest
earnings` for dated events, `python -m app.worker` for the scheduled loop.

## Hosted preview

`frontend/preview/` builds the real app into a static page that needs no
server: a hash router stands in for the history router and a fetch layer
answers from API responses captured off a seeded local server. Useful for
sharing a walkthrough of the product on fixture data.

```sh
python scripts/capture_preview_fixtures.py frontend/preview/fixtures.json   # against a running dev server
cd frontend && npx vite build --config vite.preview.config.js               # -> frontend/preview-dist/
cp preview/fixtures.json public/tokens.css public/theme-override.css preview-dist/
```

Serve `preview-dist/` from any static host and open `preview.html`. Writes
(pins, notes, alerts) stay in the page; the dataset is fixed.

## Tests

The tests are live-API checks against a running server on `:8000` with a
database they can reach through `docker compose exec postgres psql` (or
set `POSTGRES_CMD` to another `psql` invocation):

```sh
python tests/test_404_uniformity.py
python tests/test_account_flow.py
python tests/test_product_v2.py
python tests/test_product_v3.py
python tests/test_lab.py
```

## Deploy

`deploy/setup.sh DOMAIN` bootstraps a fresh Ubuntu host: `.env` with fresh
secrets, docker compose (app, worker, postgres), nginx and certbot. See
`SCAFFOLD_SPEC.md` for the layout and `deploy/` for the templates.
