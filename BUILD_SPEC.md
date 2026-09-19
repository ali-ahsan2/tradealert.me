# Tradealert.me — Full Build Spec (v1)

Written for: a coding assistant one-shotting the subscriber product on top of the existing auth scaffold, to a deployable end state.

This is the merged, gap-filled version of three source documents: `PROJECT_HANDOFF.md` (architecture and business rules), `UX_SPEC.md` (screens and flows), `PRODUCT_DESIGN.md` (visual system). Those three remain valid for narrative detail. This document is the build authority: where it resolves an open question those documents left unresolved, this document wins. Read this document first, then the other three for supporting detail on any given section.

Current state, verified by running it: signup, login, `/api/me`, and email verification work end to end against a live Postgres instance in Docker. There is no product UI beyond bare auth forms (`static/index.html`, `login.html`, `signup.html`, `app.html`). The database has two tables (`users`, `tickers`, `snapshots`) and nothing else. Everything in this document is new work on top of that.

**Frontend framework update (supersedes "no framework" in `SCAFFOLD_SPEC.md` and `UX_SPEC.md`'s plain-HTML approach):** the frontend will be built in React, to keep the door open for a native app later (React Native shares component logic and mental model with React, not with hand-written vanilla JS). This changes the build story but not the deploy story:

- **Build tool: Vite.** Vite is a build-time dependency only, not a runtime service. `npm run build` compiles the React app into a static `dist/` folder of plain JS/CSS/HTML. There is no per-user server rendering and no Node process in production — nginx serves the built files exactly as it serves static HTML today. The single-EC2-box, no-new-AWS-services constraint is unaffected.
- **Personalization stays runtime, not build-time.** One built bundle is shipped to every visitor. The app calls the existing FastAPI JSON endpoints (`/api/board`, `/api/me`, etc.) after load and renders whatever comes back, same pattern as `UX_SPEC.md`'s vanilla `api()` helper, just with React owning the DOM updates instead of manual `innerHTML` writes.
- **Routing**: client-side (`react-router`), still one SPA entry point behind nginx's `try_files ... /index.html` fallback, replacing the multi-`.html`-file structure `UX_SPEC.md` specified.
- **What carries over unchanged**: every screen spec, every API endpoint, the database schema, the entitlement gating rules, the visible-universe 404 rule, and the design tokens from `PRODUCT_DESIGN.md` — those become CSS custom properties consumed by React components instead of by hand-written HTML, with no change to the values or the theming mechanism in section 6.
- **What needs rework before implementation**: `UX_SPEC.md` section 5.4's shared-asset structure (`app.js` globals) and `UX_SPEC.md`'s per-screen `.html` file list, since React replaces both with components and a router. Treat those two subsections as superseded; everything else in `UX_SPEC.md` (flows, screen content, states, data contracts) still applies directly to the equivalent React views.

---

## 1. What was missing from the source documents, and how it's resolved here

The UX and design documents were written by agents working from the architecture description alone, without the database or full stack in front of them. Five things they explicitly left open, plus two things neither addressed at all:

1. **Band cutoffs, per-strategy or shared.** Resolved: cutoffs are per-strategy (section 4). A "Strong" in Fast Mover and a "Strong" in Market Shift are not claiming the same thing, and forcing shared cutoffs would misrepresent an uncalibrated strategy as equally precise. The comparability rule UX_SPEC.md asked for: band words are never compared across strategies in any UI copy or sort; only within-strategy comparison is implied anywhere.

2. **Coverage thresholds.** Resolved: full = all declared components present, partial = at least half present, thin = fewer than half (section 4.3).

3. **Does the engine produce a range or a point estimate?** Resolved: point estimate only, for v1. No confidence interval is computable without a distributional model the engine doesn't have yet. PRODUCT_DESIGN.md's `~` prefix on thin-coverage scores is the only uncertainty affordance in v1. Do not build the range UI.

4. **`signal` vs `candidate` vocabulary split.** Resolved: accepted, in full, including email subject lines and webhook payload field names. This is cheap to build if done from the start and expensive to retrofit.

5. **Print stylesheet priority.** Resolved: build it in stage 1 alongside `app.css`. It's a few dozen lines and the cost of doing it later, after report markup has drifted, is higher than the cost of doing it now.

6. **Not addressed by either document: the database schema.** UX_SPEC.md's 40 endpoints and PRODUCT_DESIGN.md's components both assume roughly fifteen tables of data (strategies, industries, instruments, universe tags, scores per run, entitlements, picks, alert rules, alert events, digests, webhook config) that do not exist. Section 3 below is the schema. This is the largest gap and the reason the earlier scaffold "worked" but had nothing to show — there was no data model for a product to render.

7. **Not addressed by either document: theming is hardcoded.** PRODUCT_DESIGN.md's token block (`PRODUCT_DESIGN.md` section 4.8) is a fixed navy palette with no mechanism to change it. Section 6 below makes it configurable without adding a build step or a framework, per your requirement that identity stays professional but themeable.

---

## 2. Non-negotiable constraints, restated

These come from `PROJECT_HANDOFF.md` and `SCAFFOLD_SPEC.md` and are repeated here because a one-shot build is the highest-risk moment for silently dropping them.

- No paid SaaS subscription anywhere in the stack. AWS pay-as-you-go (EC2, SES, S3) is fine. A payment provider charging per-transaction (not a monthly platform fee) is fine per `UX_SPEC.md` block 6's note — use Stripe in per-transaction mode, do not sign up for a paid tier of anything else.
- No framework, no build step, no npm, no bundler on the frontend. Plain HTML/CSS/vanilla JS, served as static files by FastAPI.
- Single EC2 instance. Postgres in Docker on the same box, not RDS. Cron, not a message queue.
- The visible-universe rule is a security property, not a display preference: a 404 for a name outside a subscriber's tier-limited universe must be byte-identical to a 404 for a name that doesn't exist. This governs both the API (section 5) and every screen that can render a 404 (`UX_SPEC.md` section 1.4).
- Every score-bearing screen shows its data's age. No number without a timestamp.
- Four of five strategies are provisional (uncalibrated). The interface must never let a provisional score look as authoritative as Fast Mover's. This is a disclosure obligation, not a style choice — see `PRODUCT_DESIGN.md` section 3.

---

## 3. Database schema

Extends `db/schema.sql`. Written for Postgres 16 (the version already pinned in `docker-compose.yml`). All new tables below; `users`, `tickers`, `snapshots` are unchanged.

```sql
-- ============================================================
-- Universe: industries, instruments, strategies
-- ============================================================

CREATE TABLE IF NOT EXISTS industries (
    id              BIGSERIAL PRIMARY KEY,
    key             TEXT UNIQUE NOT NULL,          -- 'semiconductors'
    label           TEXT NOT NULL,                  -- 'Semiconductors'
    benchmark_etf   TEXT NOT NULL,                  -- 'SMH'
    description     TEXT NOT NULL DEFAULT '',
    sort_order      SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS strategies (
    id              BIGSERIAL PRIMARY KEY,
    key             TEXT UNIQUE NOT NULL,           -- 'fast_mover'
    label           TEXT NOT NULL,                  -- 'Fast Mover'
    monogram        TEXT NOT NULL,                  -- 'FM'
    calibrated      BOOLEAN NOT NULL DEFAULT FALSE,
    calibrated_at   TIMESTAMPTZ,
    resolved_outcomes_count INT NOT NULL DEFAULT 0,
    description     TEXT NOT NULL DEFAULT '',
    sort_order      SMALLINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_calibration_consistency CHECK (
        (calibrated = FALSE AND calibrated_at IS NULL) OR
        (calibrated = TRUE AND calibrated_at IS NOT NULL)
    )
);

-- one row per (name, strategy): the instrument's static universe tagging.
-- ticker_id references the existing tickers table so refresh.py's data
-- and the product's universe share one ticker identity.
CREATE TABLE IF NOT EXISTS instruments (
    id              BIGSERIAL PRIMARY KEY,
    ticker_id       BIGINT NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    industry_id     BIGINT NOT NULL REFERENCES industries(id),
    theme           TEXT NOT NULL DEFAULT '',
    lane            TEXT NOT NULL DEFAULT '',        -- e.g. 'Early', 'Event'
    instrument_group TEXT NOT NULL DEFAULT 'Scan',    -- 'A' | 'Bench' | 'Scan'
    hook            TEXT NOT NULL DEFAULT '',
    thesis          TEXT NOT NULL DEFAULT '',
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (ticker_id, industry_id)
);
CREATE INDEX IF NOT EXISTS idx_instruments_industry ON instruments (industry_id) WHERE active;

-- ============================================================
-- Runs and scores
-- ============================================================

CREATE TABLE IF NOT EXISTS runs (
    id              BIGSERIAL PRIMARY KEY,
    as_of           TIMESTAMPTZ NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running'  -- 'running' | 'completed' | 'failed'
);
CREATE INDEX IF NOT EXISTS idx_runs_as_of ON runs (as_of DESC);

-- one row per (run, instrument, strategy): the scoring output the whole
-- product reads from. component_json holds the per-component breakdown
-- (raw, weight, contribution, present, evidence) as a JSON array so new
-- components never require a migration -- the same design principle
-- already used for the snapshots table.
CREATE TABLE IF NOT EXISTS scores (
    id                  BIGSERIAL PRIMARY KEY,
    run_id              BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    instrument_id       BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    strategy_id         BIGINT NOT NULL REFERENCES strategies(id),
    value               NUMERIC(5,1) NOT NULL,
    band                TEXT NOT NULL
        CHECK (band IN ('strong','elevated','neutral','weak','excluded')),
    components_present  SMALLINT NOT NULL,
    components_total    SMALLINT NOT NULL,
    shrinkage_applied    NUMERIC(5,1),                -- NULL if no shrinkage occurred
    shrinkage_from       NUMERIC(5,1),
    component_json      JSONB NOT NULL DEFAULT '[]',
    haircut_json         JSONB NOT NULL DEFAULT '[]', -- [{label, points, evidence_url}]
    hard_filter_json     JSONB,                       -- Fast Mover only; NULL for other strategies
    delta_1d            NUMERIC(5,1),                 -- computed at write time vs prior run
    UNIQUE (run_id, instrument_id, strategy_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_lookup ON scores (strategy_id, instrument_id, run_id DESC);
CREATE INDEX IF NOT EXISTS idx_scores_run_board ON scores (run_id, strategy_id, value DESC);

-- calibration journal: PROJECT_HANDOFF.md section 4. one row per resolved
-- outcome, feeding both the strategy calibration status and the evidence
-- sidebar on the stock report.
CREATE TABLE IF NOT EXISTS calibration_outcomes (
    id              BIGSERIAL PRIMARY KEY,
    strategy_id     BIGINT NOT NULL REFERENCES strategies(id),
    instrument_id   BIGINT NOT NULL REFERENCES instruments(id),
    score_id        BIGINT NOT NULL REFERENCES scores(id),
    going_in_score  NUMERIC(5,1) NOT NULL,
    going_in_band   TEXT NOT NULL
        CHECK (going_in_band IN ('strong','elevated','neutral','weak','excluded')),
    resolved_at     TIMESTAMPTZ NOT NULL,
    outcome_return  NUMERIC(6,2),                     -- percent move over the resolution window
    hit             BOOLEAN NOT NULL,
    resolution_window_days SMALLINT NOT NULL DEFAULT 30
);
-- strategy_id already covered as the leading column of idx_calibration_strategy below;
-- instrument_id and score_id are separate foreign keys with no index of their own,
-- so joins/lookups by either (e.g. a stock report's evidence sidebar querying by
-- instrument_id, or joining scores -> calibration_outcomes by score_id) would
-- sequential-scan this table as it grows. Both added explicitly.
CREATE INDEX IF NOT EXISTS idx_calibration_strategy ON calibration_outcomes (strategy_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_calibration_instrument ON calibration_outcomes (instrument_id);
CREATE INDEX IF NOT EXISTS idx_calibration_score ON calibration_outcomes (score_id);

-- ============================================================
-- Alerts
-- ============================================================

CREATE TABLE IF NOT EXISTS triggers (
    id              BIGSERIAL PRIMARY KEY,
    key             TEXT UNIQUE NOT NULL,   -- 'borrow_fee_2x', 'si_cross_10', ...
    label           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT ''
);

-- impersonal: one row per (instrument, trigger, day) regardless of whether
-- any subscriber armed it. PROJECT_HANDOFF.md section 4.
CREATE TABLE IF NOT EXISTS alert_events (
    id              BIGSERIAL PRIMARY KEY,
    instrument_id   BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    trigger_id      BIGINT NOT NULL REFERENCES triggers(id),
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    detail          TEXT NOT NULL DEFAULT '',   -- rendered sentence, e.g. '4.2% -> 9.1%'
    UNIQUE (instrument_id, trigger_id, (fired_at::date))
);
CREATE INDEX IF NOT EXISTS idx_alert_events_instrument ON alert_events (instrument_id, fired_at DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instrument_id   BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    trigger_id      BIGINT NOT NULL REFERENCES triggers(id),
    channels        TEXT[] NOT NULL DEFAULT '{email}',
    armed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, instrument_id, trigger_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules (user_id);

-- one row per (subscriber, alert_event, channel): what was actually sent.
-- separate from alert_events because delivery is filtered by universe at
-- enqueue AND send time (PROJECT_HANDOFF.md section 6) -- an event can
-- exist with zero deliveries.
CREATE TABLE IF NOT EXISTS alert_deliveries (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_event_id  BIGINT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL
        CHECK (channel IN ('email','push','sms','webhook')),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_user ON alert_deliveries (user_id, sent_at DESC);
-- alert_event_id has no index of its own; needed to answer "who was this
-- event delivered to" without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_event ON alert_deliveries (alert_event_id);

-- ============================================================
-- Entitlements, picks, subscriptions
-- ============================================================

CREATE TABLE IF NOT EXISTS tiers (
    id              BIGSERIAL PRIMARY KEY,
    key             TEXT UNIQUE NOT NULL,     -- 'free' | 'basic' | 'pro' | 'investor'
    label           TEXT NOT NULL,
    price_monthly_cents INT NOT NULL,
    industries_limit     SMALLINT NOT NULL,
    names_shown_limit    SMALLINT NOT NULL,
    picks_limit           SMALLINT NOT NULL,
    alerts_limit           SMALLINT,           -- NULL = unlimited
    channels               TEXT[] NOT NULL,     -- e.g. '{email}' or '{email,push,sms,webhook}'
    sort_order              SMALLINT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id         BIGINT NOT NULL REFERENCES tiers(id),
    status          TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','canceled','past_due')),
    billing_provider_customer_id TEXT,
    current_period_end TIMESTAMPTZ,
    pending_tier_id BIGINT REFERENCES tiers(id),      -- set on scheduled downgrade
    pending_change_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- tier_id and pending_tier_id are foreign keys with no index; billing and
-- downgrade-processing jobs look subscriptions up by tier (e.g. "everyone
-- pending a downgrade today"), so both get an index. user_id already has
-- one implicitly, since UNIQUE creates an index automatically.
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions (tier_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_pending ON subscriptions (pending_change_at) WHERE pending_tier_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_industries (
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    industry_id     BIGINT NOT NULL REFERENCES industries(id),
    followed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, industry_id)
);

CREATE TABLE IF NOT EXISTS picks (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instrument_id   BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    pinned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    score_at_pin    NUMERIC(5,1),
    sort_order      INT NOT NULL DEFAULT 0,
    active          BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = retained but over-quota after downgrade
    UNIQUE (user_id, instrument_id)
);
CREATE INDEX IF NOT EXISTS idx_picks_user ON picks (user_id) WHERE active;
-- instrument_id has no index; needed for "who has this name pinned" (used
-- when an industry is unfollowed, to compute the impact-preview numbers
-- UX_SPEC.md's account screen shows before a removal is confirmed).
CREATE INDEX IF NOT EXISTS idx_picks_instrument ON picks (instrument_id);
-- Reordering (PUT /api/me/picks/order) must be implemented as one batched
-- UPDATE ... FROM (VALUES ...) statement, not a per-row loop issuing one
-- UPDATE per pick. At 100 picks (Investor tier max), a naive loop is 100
-- round trips per reorder for no reason -- this is an application-code
-- note, not a schema change, but it belongs next to this table.

-- ============================================================
-- Delivery preferences and digests
-- ============================================================

CREATE TABLE IF NOT EXISTS user_settings (
    user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    timezone            TEXT NOT NULL DEFAULT 'America/New_York',
    digest_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    digest_day          SMALLINT NOT NULL DEFAULT 1,   -- 0=Sun .. 6=Sat, default Monday
    digest_hour         SMALLINT NOT NULL DEFAULT 7,
    channel_email       BOOLEAN NOT NULL DEFAULT TRUE,
    channel_push        BOOLEAN NOT NULL DEFAULT FALSE,
    channel_sms         BOOLEAN NOT NULL DEFAULT FALSE,
    phone_number        TEXT,
    phone_verified       BOOLEAN NOT NULL DEFAULT FALSE,
    push_subscription_json JSONB,
    webhook_url          TEXT,
    webhook_secret        BYTEA,   -- pgcrypto-encrypted, not plaintext -- see note below
    webhook_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_auto_disabled_at TIMESTAMPTZ
);
-- webhook_secret must round-trip (the account screen reveals it and
-- supports rotation, per UX_SPEC.md section 3.5), so it can't be a one-way
-- hash like the password. Encrypt it at the application layer with
-- pgcrypto's pgp_sym_encrypt(), keyed from an environment secret that is
-- never itself stored in the database, rather than writing it as plain
-- TEXT. Enable the extension once per database:
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Write:  UPDATE user_settings SET webhook_secret =
--           pgp_sym_encrypt('the-secret', :encryption_key) WHERE user_id = :id;
-- Read:   SELECT pgp_sym_decrypt(webhook_secret, :encryption_key) FROM user_settings ...;
-- This protects the secret if the database is ever dumped or leaked
-- without the application's encryption key alongside it.

CREATE TABLE IF NOT EXISTS digests (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id          BIGINT NOT NULL REFERENCES runs(id),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_json    JSONB NOT NULL   -- frozen render payload, so a permalink never changes after sending
);
CREATE INDEX IF NOT EXISTS idx_digests_user ON digests (user_id, sent_at DESC);
-- run_id has no index; the admin/ops question "which digests came from
-- this run" (useful when debugging a bad run after the fact) would
-- otherwise scan the whole table.
CREATE INDEX IF NOT EXISTS idx_digests_run ON digests (run_id);

CREATE TABLE IF NOT EXISTS unsubscribe_tokens (
    token           TEXT PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL
        CHECK (channel IN ('email','push','sms')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at         TIMESTAMPTZ
);
-- user_id has no index beyond the implicit one PRIMARY KEY(token) does not
-- provide for this column; needed to answer "all unsubscribe tokens ever
-- issued to this user" for support/account-export purposes.
CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_user ON unsubscribe_tokens (user_id);
```

**Design notes carried over from the existing `snapshots` table's pattern:** `component_json` and `haircut_json` on `scores` are JSONB rather than normalized tables, deliberately, matching the reasoning already in `SCAFFOLD_SPEC.md` for the key-value `snapshots` design — the scoring engine's component set will change before the schema should have to. Everything that drives access control (`tiers`, `subscriptions`, `user_industries`, `picks` counts) is fully normalized, because access control bugs are the expensive kind.

**Seed data required before the API can serve anything:** the four rows of `tiers` matching `PROJECT_HANDOFF.md` section 7 exactly, the five rows of `strategies`, the ten rows of `industries`, and the trigger catalog (nine trigger keys from `PROJECT_HANDOFF.md` section 4). Write this as `db/seed.sql`, run once after `schema.sql` in `deploy/setup.sh` and in local dev bring-up. Do not hardcode these values in application code — `pricing.html` and `/api/entitlements` both read `tiers` from the database specifically so a price change is a SQL update, not a deploy.

---

## 4. Resolved product decisions

### 4.1 Band cutoffs

Per-strategy, stored on the `strategies` row as a fifth JSONB column added by this build (`band_cutoffs_json`, e.g. `{"strong": 75, "elevated": 60, "neutral": 40, "weak": 25}`, values are the lower bound of each band, `weak` down to 0, anything failing a hard filter forces `excluded` regardless of numeric value). Fast Mover's initial cutoffs come from the existing 25-point scorecard's already-established thresholds in `fast_mover_screen.md` — do not invent new ones. The other four strategies ship with placeholder cutoffs (0/25/50/75 evenly spaced) until they accumulate calibration data; this is acceptable specifically because they're already marked provisional everywhere.

Comparability rule for the UI: never write copy that compares a band word across strategies ("stronger than its Market Shift score"). Band words are only ever presented within one strategy's own context.

### 4.2 Uncertainty display

Point estimate only. No range UI. The `~` thin-coverage prefix from `PRODUCT_DESIGN.md` section 2.4 is the only uncertainty affordance in v1. Do not build a confidence-interval or range component — there's no distributional model behind it yet and a fabricated range is worse than none, per that document's own section 2.7.

### 4.3 Coverage thresholds

- **Full**: `components_present = components_total`
- **Partial**: `components_present >= ceil(components_total / 2)` and less than total
- **Thin**: `components_present < ceil(components_total / 2)`

Maps to the three-segment bar in `PRODUCT_DESIGN.md` section 2.4: 3/3 segments for full, 2/3 for partial, 1/3 for thin.

### 4.4 Vocabulary split

Accepted as specified in `PRODUCT_DESIGN.md` section 3.4, rule 3. Implementation requirement: this is not just a template string swap in HTML. It must be a single source of truth — a `noun_for(strategy)` helper in both the Python email/webhook templating code and `app.js`'s formatters — returning `"signal"` when `strategies.calibrated = true` and `"candidate"` otherwise, so a strategy's calibration transition (section 4.5) automatically changes its vocabulary everywhere without a find-and-replace across templates.

### 4.5 Calibration transition

When an operator marks a strategy calibrated (an authenticated admin action, not exposed to subscribers — build as a single protected endpoint `POST /api/admin/strategies/{key}/calibrate`, gated by a separate admin flag on the `users` row, not a new role system), the following happens atomically in one transaction:

1. `strategies.calibrated = true`, `calibrated_at = now()`
2. A row is written to a new `calibration_events` table (see below) recording the date, the resolved-outcome count it was based on, the admin user id, and the previous `band_cutoffs_json` value
3. From that point, all rendering (`noun_for`, badge color, sort position, digest ordering) picks up the new status on the next request — no cache invalidation needed beyond the existing `sessionStorage` 5-minute TTL on `/api/strategies`

```sql
CREATE TABLE IF NOT EXISTS calibration_events (
    id                  BIGSERIAL PRIMARY KEY,
    strategy_id         BIGINT NOT NULL REFERENCES strategies(id),
    event_type          TEXT NOT NULL,         -- 'calibrated' | 'recalibrated'
    resolved_outcomes_at_event INT NOT NULL,
    admin_user_id        BIGINT NOT NULL REFERENCES users(id),
    previous_cutoffs_json JSONB,
    new_cutoffs_json       JSONB NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Add this table to section 3. Surfaced on the strategy detail page per `PRODUCT_DESIGN.md` section 3.6.

### 4.6 Payment provider

Stripe, in standard per-transaction mode (not Stripe Billing's higher tiers, just Checkout + a subscription product + webhooks). This does not violate the no-monthly-SaaS constraint: Stripe's base account has no monthly fee, it takes a percentage of transactions, which only exists when revenue exists. Use Stripe Checkout (hosted, not a custom card form — avoids PCI scope entirely) and the Stripe customer portal for `POST /api/billing/portal`, so no billing UI has to be hand-built.

### 4.7 Verification gates delivery, not browsing

Confirmed as UX_SPEC.md proposed: unverified users can see the Board immediately after signup. Verification is required only for: receiving any email/push/SMS, arming any alert, and completing a paid upgrade. This is now decided, not open.

---

## 5. API surface

`UX_SPEC.md` section 6 defines the endpoint list; treat it as complete and correct. Two additions from this document:

- `POST /api/admin/strategies/{key}/calibrate` (section 4.5 above)
- `GET /api/me` response gains `tier`, `verified`, `followed_industry_count`, `timezone` as UX_SPEC.md section 6 already specifies — implement this first, it's the smallest change with the widest payoff (unblocks `renderNav()` everywhere).

Restate the single most important correctness rule because it spans both the API and the schema: a `GET /api/stock/{symbol}` for a ticker outside the subscriber's `(followed industries top-K) UNION (their picks)` set returns the identical 404 body as a ticker that doesn't exist in `instruments` at all. Implement this as one code path, not two branches that happen to return the same JSON — a future edit to one branch and not the other is how this rule quietly breaks. Suggested implementation: the query that fetches a stock report is itself scoped to the visible set (a `WHERE` clause joining `user_industries` and `picks`, ranked and limited to `names_shown_limit`), so "not found" and "not visible" are structurally the same query result, not two checks.

---

## 6. Configurable theming

`PRODUCT_DESIGN.md`'s token block is the right default palette but is currently unconditional CSS. Make it configurable without a build step:

**`static/tokens.css`** holds only custom property declarations on `:root`, exactly as specified in `PRODUCT_DESIGN.md` section 4.8, but every color token becomes overridable by a `data-theme` attribute on `<html>`:

```css
:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --surface-sunken: #eef0f4;
  --border: #d8dce3;
  --border-strong: #b4bac6;
  --ink: #161a21;
  --ink-muted: #5b6472;
  --ink-faint: #8b93a2;
  --info: #24466f;      /* brand accent, the one token a re-theme most likely changes */
  --pos: #1f6b4a;
  --neg: #9b2c2c;
  --warn: #8a5a00;
  --band-strong: #1d3a5f;
  --band-elevated: #3a6491;
  --band-neutral: #dfe3ea;
  --band-weak: #e8e4d8;
  --band-excluded: #eef0f4;
  /* spacing, radii, type scale, shadow, breakpoints: unchanged, not
     re-themeable, since PRODUCT_DESIGN.md's structural rules (no pill
     shapes, one shadow, monospace data) are identity decisions, not
     brand decisions -- re-theming swaps the palette, not the system. */
}
```

A second, optional file `static/theme-override.css`, empty by default, loaded after `tokens.css` in every HTML page's `<head>`, lets a future rebrand redefine only the color custom properties without touching `app.css` or any component. This satisfies "configurable" with zero runtime cost, zero JavaScript, and zero build step: changing the brand is editing one small file of `:root { --info: ... }` declarations. Document this as the supported theming mechanism in a short comment at the top of `tokens.css` so a future editor doesn't hand-edit colors inline in `app.css` and defeat the mechanism.

Do not implement a runtime theme switcher (a `<select>` that toggles themes via JavaScript) — `PRODUCT_DESIGN.md` section 5 explicitly excludes a settings surface beyond the minimum, and "configurable" here means editable by whoever deploys it, not switchable by the subscriber.

---

## 7. Build order

Supersedes `UX_SPEC.md` section 7 by inserting the schema and seed work that document didn't know was missing. Each stage independently testable, matching the existing scaffold's git-commit-per-stage convention.

1. **Schema migration.** Add section 3's tables to `db/schema.sql` (or a new `db/migrations/002_product.sql` if the project wants to keep `schema.sql` as stage-1-only history — either is fine, pick one and be consistent). Write and run `db/seed.sql` (tiers, strategies, industries, triggers).
2. `tokens.css` + `app.css` + `app.js` (shared formatters, `requireAuth`, `api()`, `renderNav`, modal, toast) + print stylesheet. Rewrite `index.html`, `login.html`, `signup.html`, add `verify-pending.html`. Delete `app.html`. Extend `GET /api/me`.
3. `GET /api/strategies`, `GET /api/industries`, `GET /api/board` + `board.html`, Fast Mover only, reading real rows from `scores`/`instruments`/`industries`. This requires at least one real scored `run` in the database — if the scoring engine itself isn't built yet, write a one-off seed script that inserts a synthetic `run` and `scores` rows from `refresh.py`'s existing output so the Board has something real to render; do not fabricate scores in the frontend.
4. `GET /api/stock/{symbol}` + `stock.html`. Verify the 404-uniformity rule with an actual test: one request for an out-of-universe real ticker, one for a nonexistent ticker, assert identical status, headers, and body.
5. `GET/PATCH /api/me/settings`, `POST /api/me/industries`, `account.html`, `onboarding.html`. Board's industry filter goes live.
6. `picks` endpoints, `watchlist.html`, pinning from the Board.
7. Entitlement gating pass across all screens built so far: upgrade card, quota modal, locked controls, `GET /api/entitlements`, `pricing.html`.
8. `alert_rules`/`alert_events`/`alert_deliveries` endpoints, `alerts.html`, email channel only.
9. Stripe Checkout integration, `upgrade.html`, `subscriptions` table wiring, webhook handler for payment events. Revenue is possible at the end of this stage.
10. Digest generation (cron job, reuses the existing `deploy/crontab` pattern), `digest.html`, unsubscribe flow.
11. Remaining channels (push via VAPID, SMS via a pay-per-message provider, webhook delivery with HMAC signing), the four provisional strategies exposed as Board tabs once they have real (even if provisional) scores, `POST /api/admin/strategies/{key}/calibrate`, password reset.
12. Deploy: extend the existing `deploy/setup.sh`, `deploy/nginx.conf`, `deploy/crontab` to cover the new digest cron job and any new environment variables (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Confirm `docker compose up` still boots clean, confirm nginx serves every new static file, confirm cron fires the digest job.

Stages 1-4 are the minimum for a coherent demonstrable product with real data behind it — this is the point at which "does this work" has a concrete, checkable answer. Stage 9 is the minimum for the product to be sellable. Stage 12 is deployable end-to-end.
