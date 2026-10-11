# tradealert.me

Ranked small-cap research with its working shown: a scoring engine over
public filings and market data, a subscriber product (board, screener,
dossiers, calendar, alerts, digests) and an operator Lab for strategy
analysis. FastAPI + Postgres on the back, React + Vite in `frontend/`
built into `static/`.

The product's rules live in the specs at the repo root: `DESIGN_V6.md`
(the binding plan: the proposition in the user's words, the voice, the
journey and its three layouts, the simple Home, the lightness system, the
legal posture with consent and fine print, strategies in human terms, the
readable Lab; §12 lists what shipped and the deviations), `DESIGN_V5.md`
(desire and flow: the record endpoints `/api/pulse` and `/api/me/record`,
the binding copy rules for FOMO built from recorded facts, the connected
funnel and the in-place upgrade sheet), `DESIGN_V4.md`
(the current look: consumer app and analysis terminal; §6 positioning as an
assistant that watches, explains and alerts; §7 the newcomer-ease pass with
Simple/Full mode, the glossary and `/help`), `PRODUCT_DESIGN.md`
(honesty rules and the earlier system), `UX_SPEC.md` (screens), `BUILD_SPEC.md` (data contract and
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
   the universe and one scored run, benchmarks, then the Lab seed, the dev
   fixture and the demo rows (the Lab and demo rows are not tagged `dev_fixture`);
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
`python -m app.market_data` for daily bars (Tiingo when `TIINGO_TOKEN` is
set, Yahoo otherwise), `python -m app.events_ingest earnings` for dated
events, `python -m app.filings_ingest` for EDGAR filings and ticker
identity, `python -m app.worker` for the scheduled loop.

## The engine

`app/engine.py` scores every active instrument from stored data (latest
snapshots, momentum from the bars, the operator's research inputs in
`instrument_research`) with `app/engine_core.py`, the scorer ported from the
workbench; a band change against the previous run fires `band_change`.
`app/triggers.py` evaluates the sourced triggers (volume, borrow fee, short
interest print, dated catalyst, S-3/424B filing) on a date and writes
`alert_events`; its registry states, per trigger, the source and whether it
can fire live or be replayed, and the Lab shows that verbatim. The worker
runs both once a day after the price pass (`ENGINE_HOUR_UTC`, default 11).

`app/replay.py` runs the same trigger code over a span of stored history,
resolves every firing against the bars that followed (close and largest
move over 5 and 14 sessions, volume spike, peak session) beside a matched
random-day baseline, and writes `replay_runs` / `replay_alerts`, which no
subscriber surface reads. The Lab's Engine tab runs replays, shows the
per-trigger table with intervals and p-values, and can publish a replay
over real bars as a strategy's record with the replay named as the source.

`app/universe.py` builds the universe by rule: SEC-listed companies whose
SIC code maps to an industry (`SIC_MAP`), inside a market-cap band. Plan
first (counts, no writes), then apply; workbench rows keep `origin =
'workbench'` and are never deleted.

## Hosted preview

`frontend/preview/` builds the real app into a static page that needs no
server: a hash router stands in for the history router and a fetch layer
answers from API responses captured off a seeded local server. Useful for
sharing a walkthrough of the product on fixture data.

```sh
python scripts/capture_preview_fixtures.py frontend/preview/fixtures.json   # against a running dev server
cd frontend && npx vite build --config vite.preview.config.js               # -> frontend/preview-dist/
cp preview/fixtures.json preview-dist/
```

Serve `preview-dist/` from any static host and open `preview.html`. Writes
(pins, notes, alerts) stay in the page; the dataset is fixed.

## Tests

The tests are live-API checks against a running server (`API_BASE`,
default `http://127.0.0.1:8000/api`) with a database they can reach through
`docker compose exec postgres psql` (or set `POSTGRES_CMD` to another `psql`
invocation, e.g. `psql postgresql://tradealert:dev-only-change-me@localhost:5432/tradealert`).
Run them with pytest, so `tests/conftest.py` can give each test its own
client address (the sign-up and log-in limiters are per address):

```sh
pytest -q tests          # 108 passed, 1 skipped on a fresh `db/bootstrap.py --fixture` database
```

The Lab suite signs in as `LAB_ADMIN_EMAIL` / `LAB_ADMIN_PASSWORD`, falling
back to the dev fixture admin. `tests/test_v6_voice.py` reads the sources
and needs no server; the reset-link test skips where no compose container
holds the logged link.

## Deploy

`deploy/setup.sh DOMAIN` bootstraps a fresh Ubuntu host: `.env` with fresh
secrets, docker compose (app, worker, postgres), nginx and certbot. See
`SCAFFOLD_SPEC.md` for the layout and `deploy/` for the templates.
