# Lab Implementation Plan

Execution plan for `STRATEGY_ANALYSIS_TOOL.md` (design spec) against the current repo.
The spec is the authority on design and copy. This document is the build plan: order, files,
and the adaptations forced by what the repo actually contains.

## Scope in one line

Build the Lab: an admin-only React surface at `/lab/*`, a `/api/admin/lab/*` API, five screens,
the `backtest_events` dataset, and the statistical guardrails, so an operator can see what each
strategy version does, how it performed, and compare rate-based evidence with honest intervals.
Regression (Phase 2) is deferred.

## Phase split

| Phase | Contents | Status |
|---|---|---|
| 1 | Schema, events dataset, Lab shell, Input map, Version history + diff, Backtest, Findings ledger, guardrails 6.1/6.2/6.5/6.6/6.7/6.8 | now |
| 2 | Regression builder + endpoint, family/Holm machinery, verdict panel, version-diff performance strip, Send-to-calibration handoff | later |
| 3 | More event kinds, cross-strategy comparison, bootstrap CIs, scheduled re-runs | only if earned |

Keep the Phase 1 / 2 split from spec section 8.1. A regression screen without the family
counter, Holm adjustment, and holdout is worse than no regression screen.

## Adaptations vs the design spec (repo reality)

These are deliberate deviations, each with a reason. Where the spec can be satisfied literally,
it is.

1. **No `test_data/*.json` files exist.** Spec 8.1 step 2 imports `squeeze_events.json`,
   `short_interest.json`, `float_history.json`, `earnings_dates.json` as the initial 191 events.
   None of those files were ever committed. Instead:
   - `backtest_events` is populated by `db/seed_lab.py` with fixture events derived from the real
     sandbox `scores`/`snapshots`/`instruments` rows, marked as synthetic by schema column
     `synthetic_data_used = TRUE`.
   - Every result that touches them renders the synthetic-data banner (spec 6.7) and the
     `Record as finding` action is removed, so the tool cannot be misread as real evidence.
   - The batch job shape survives: `jobs` gains a `build_events` entry point that can later
     switch from fixtures to an ingest path without changing anything downstream.
2. **Hard filters: four, not six.** The ported engine in `db/seed_universe.py` declares
   `cap 300-3000`, `float < 50M`, `si > 10%`, `growth > 40%`. The spec's examples show six.
   The Lab seeds `strategy_versions.hard_filters_json` from the engine's actual four. Filter
   groups ("all passed" / "any failed") are computed from however many the version declares.
   The seed finding copy keeps the spec's real `test_results.md` figures (81.2%, 58.6%, 36.6%),
   which were measured on the real methodology; n and the numbers stay as stated.
3. **Migration wiring is broken, therefore fixed here.** Fresh deploys only mount
   `db/schema.sql`; migrations 002/003/004 never run. This is a pre-existing CRITICAL finding
   (review pass, unfixed). The Lab adds `005`, so this work includes `db/migrate.py`, a runner
   that applies un-applied migrations in order and records them in `schema_migrations`, invoked
   at app container start. Without it the Lab tables would never exist on a fresh box.
4. **`version_confidence` backfill is all-`assumed` in the sandbox.** The 400 existing scores
   predate `strategy_versions`; they get `version_confidence = 'assumed'`, surfacing the
   spec's assumed-version banner on any result that includes them.
5. **No nginx `auth_request`; the client bundle gates.** The product authenticates with a
   bearer token in `localStorage`, which a top-level `/lab` navigation cannot send in a
   subrequest, so `auth_request` would block legitimate admins on first load. `deploy/nginx.conf`
   instead serves `/lab` from `static/lab.html` with `no-store` and `X-Robots-Tag: noindex,
   nofollow`; the bundle re-checks `GET /api/admin/_check` (204 admin, 404 else) before
   rendering and the API returns a uniform 404 to non-admins regardless. FastAPI also serves
   `/lab` directly for access without nginx.

## Files to create or change

Backend:
- `db/migrations/005_lab.sql` — new tables and columns (below).
- `db/migrate.py` — idempotent migration runner; `Dockerfile` runs it before uvicorn and
  `COPY db/ db/`.
- `db/seed_lab.py` — seed strategy version v1, backfill `scores.strategy_version_id` +
  `version_confidence`, insert fixture `backtest_events`, seed 3 findings + their supporting
  `lab_queries`.
- `app/lab.py` — the `/api/admin/lab/*` router (below); mounted in `app/main.py`.
- `app/jobs.py` — add `build_events` job mode calling the shared event-builder.

Frontend:
- `frontend/lab.html`, `frontend/src/lab/main.jsx` — separate Vite entry, never imported by
  the subscriber app (enforced by identical code structure, not an ESLint rule, see below).
- `frontend/vite.config.js` — multi-entry build.
- `frontend/src/lab/` — shell + five screens + small stats helpers (Wilson CI, two-proportion
  z, Holm).

Ops:
- `deploy/nginx.conf` — `/lab` block serving `static/lab.html` with `no-store` + `X-Robots-Tag`
  (no `auth_request`; see adaptation 5).
- `Dockerfile`, `docker-compose.yml` — migration boot.

Tests:
- `tests/test_lab.py` — admin gate 404s, backtest guardrails, claim-format validation,
  findings CRUD, cache/hash reuse.

## Schema (migration 005)

`strategy_versions` exactly as BUILD_SPEC 8.1 plus `hard_filters_json` (spec 3).
`scores` gains `strategy_version_id` (nullable) and `version_confidence` (`recorded`/`assumed`,
default `recorded`). `strategies` gains `score_evidence_note TEXT NULL`.
`backtest_events`, `lab_queries`, `lab_findings`, `lab_finding_queries` exactly as spec section 3.
The `strategy_versions` immutable-after-close trigger from spec 4.4.
Indexes and CHECK constraints as specified.

## API (`/api/admin/lab/*`, all gated)

- `GET /api/admin/_check` — admin gate probe used by the Lab bundle on load: `204` admin,
  `404` otherwise, no body.
- `GET strategies` — index cards payload (version line, separate filters/score evidence lines,
  data line, last query).
- `GET strategies/{key}/inputs?version=` — hard filters w/ vintage lag + coverage, components w/
  declared + median-effective weight, band cutoffs, `score_evidence_note`; evidence grades
  joined from findings with `none` rendered as "never tested".
- `GET strategies/{key}/versions` and `.../diff?a=&b=` — timeline + grouped diff tables.
- `GET strategies/{key}/coverage` — cohort stats for the universe filters.
- `GET findings`, `GET findings/{id}`, `POST findings`, `PATCH findings/{id}`,
  `POST findings/{id}/queries`, `DELETE findings/{id}/queries/{lab_query_id}`.
- `GET queries?strategy=&family=&limit=` — the audit log.
- `POST backtest` — group rate comparison w/ Wilson CIs, baselines, two-proportion z test,
  Holm adjustment, 6.1 floor warnings, provenance + exclusions, synthetic flag, server-side
  hash cache, audit row written before execution.

All Lab write paths compute `evidence_grade` server-side per 6.6; findings require a cited
query and a claim passing 6.5 client- and server-side.

## Guardrails implemented in Phase 1

6.1 floors + mandatory CIs; 6.2 point-in-time (fixtures carry `provenance_json`, restatements
never overwrite, incomplete rows excluded and counted); 6.5 claim format; 6.6 computed grades;
6.7 synthetic flag (removes Record-as-finding); 6.8 permanent footer. The assumed-version note
from spec 3 renders as a separate banner when any contributing score is `assumed`.

6.3 multiple comparisons is scoped to Phase 2 (it is the guardrail for regression, which is
Phase 2), except the audit row + family count on backtest runs, which Phase 1 computes and
displays.

## Screens (Phase 1)

Synonyms per spec: `/lab` strategy index (evidence line separate filters vs score),
`/lab/s/:key/inputs`, `/lab/s/:key/versions` + diff, `/lab/s/:key/backtest`, `/lab/findings`
+ `/lab/findings/:id`. Dark surface via `[data-surface="lab"]` tokens. Persistent
`Internal — not subscriber-visible` chip. Every chart has a Show-as-table toggle; verdicts and
diffs are never color-only. Minimum 14px text, `aria-live` on sample counters, tables with
`<th scope>`.

## Verification

1. `python db/migrate.py` applies 002/003/004/005 cleanly on the sandbox (already-open DB).
2. `python db/seed_lab.py` idempotent and verifiable: 5 strategies, >=1 version each,
   fixture events, 3 findings with citations.
3. Non-admin + anonymous: every `/api/admin/lab/*` response is a uniform 404. The `/lab` page
   is served to everyone (top-level navigation cannot send the bearer token); the bundle gates
   on `/_check`, so non-admins only ever see the gate or the denied screen.
4. Backtest guardrails: sub-30 groups warn, sub-10 suppress rates, CI present, synthetic banner
   on, Record-as-finding absent.
5. Existing suites (`test_account_flow.py`, `test_404_uniformity.py`) stay green.
6. Build serves: `/lab` 200 (admin browser), bundle 200; subscriber bundle contains no Lab
   code (grep the built JS for a Lab-only string).