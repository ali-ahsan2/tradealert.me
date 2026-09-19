-- ============================================================
-- 002_product.sql — product schema (BUILD_SPEC section 3)
-- Adds the strategy/industry/instrument, runs/scores, alerts,
-- entitlement, and delivery tables on top of the scaffold's
-- users/tickers/snapshots. Idempotent; run via psql after
-- db/schema.sql.
-- ============================================================

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
    -- BUILD_SPEC section 4.1: per-strategy band cutoffs, e.g.
    -- {"strong": 72, "elevated": 52, "neutral": 40, "weak": 25},
    -- the values are each band's lower bound (weak runs to 0).
    band_cutoffs_json JSONB NOT NULL DEFAULT '{"strong": 75, "elevated": 50, "neutral": 25, "weak": 0}',
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
CREATE INDEX IF NOT EXISTS idx_calibration_strategy ON calibration_outcomes (strategy_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_calibration_instrument ON calibration_outcomes (instrument_id);
CREATE INDEX IF NOT EXISTS idx_calibration_score ON calibration_outcomes (score_id);

-- ============================================================
-- Alerts
-- ============================================================

CREATE TABLE IF NOT EXISTS triggers (
    id              BIGSERIAL PRIMARY KEY,
    key             TEXT UNIQUE NOT NULL,   -- 'borrow_fee_2x', 'si_cross', ...
    label           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT ''
);

-- impersonal: one row per (instrument, trigger, day) regardless of whether
-- any subscriber armed it. PROJECT_HANDOFF.md section 4.
-- one event per (instrument, trigger, day); the day is a generated
-- column because PostgreSQL only allows expressions in indexes, and
-- a unique index on an expression must be IMMUTABLE, which fired_at::date
-- is not (it depends on the session TimeZone). fired_on pins the UTC day.
CREATE TABLE IF NOT EXISTS alert_events (
    id              BIGSERIAL PRIMARY KEY,
    instrument_id   BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    trigger_id      BIGINT NOT NULL REFERENCES triggers(id),
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    fired_on        DATE GENERATED ALWAYS AS ((fired_at AT TIME ZONE 'UTC')::date) STORED,
    detail          TEXT NOT NULL DEFAULT '',   -- rendered sentence, e.g. '4.2% -> 9.1%'
    UNIQUE (instrument_id, trigger_id, fired_on)
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
CREATE INDEX IF NOT EXISTS idx_picks_instrument ON picks (instrument_id);

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
    webhook_secret        BYTEA,   -- pgcrypto-encrypted, not plaintext
    webhook_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_auto_disabled_at TIMESTAMPTZ
);
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS digests (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id          BIGINT NOT NULL REFERENCES runs(id),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_json    JSONB NOT NULL   -- frozen render payload, so a permalink never changes after sending
);
CREATE INDEX IF NOT EXISTS idx_digests_user ON digests (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_digests_run ON digests (run_id);

CREATE TABLE IF NOT EXISTS unsubscribe_tokens (
    token           TEXT PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL
        CHECK (channel IN ('email','push','sms')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_user ON unsubscribe_tokens (user_id);

-- ============================================================
-- Calibration events (BUILD_SPEC section 4.5) — the dated,
-- auditable record of every calibrated/recalibrated transition.
-- ============================================================

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