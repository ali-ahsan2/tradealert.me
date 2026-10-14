-- 014: the engine. Until now nothing in the product re-scored the universe or
-- fired an alert from fresh data: the only scored run was the workbench
-- replay and the only alert events came from the fixtures. This file holds
-- what the live engine and the Lab's replay need.
--
--   tickers      identity from SEC EDGAR (CIK, exchange, SIC) so a universe
--                can be built by rule instead of by hand
--   instruments  origin: 'workbench' (the operator's shortlist) or 'rule'
--   filings      EDGAR filings by date and form, the source for the
--                dilution (S-3 / 424B) and catalyst triggers
--   replay_runs  one replay of history: what would have fired, and what
--                the price did after. Never read by a subscriber surface.
--   replay_alerts the fired-and-resolved rows of one replay

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS name     TEXT NOT NULL DEFAULT '';
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS cik      TEXT;
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT '';
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS sic      TEXT NOT NULL DEFAULT '';
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS sic_desc TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tickers_cik ON tickers (cik);

ALTER TABLE instruments ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'workbench';

CREATE TABLE IF NOT EXISTS filings (
    id          BIGSERIAL PRIMARY KEY,
    ticker_id   BIGINT NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    cik         TEXT NOT NULL,
    form        TEXT NOT NULL,                 -- '8-K', 'S-3', '424B5', '4', ...
    filed_on    DATE NOT NULL,
    accession   TEXT NOT NULL,
    items       TEXT NOT NULL DEFAULT '',      -- 8-K item codes, comma separated
    primary_doc TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'sec_edgar',
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (accession, ticker_id)
);
CREATE INDEX IF NOT EXISTS idx_filings_ticker_date ON filings (ticker_id, filed_on DESC);
CREATE INDEX IF NOT EXISTS idx_filings_form_date ON filings (form, filed_on DESC);

CREATE TABLE IF NOT EXISTS replay_runs (
    id                BIGSERIAL PRIMARY KEY,
    admin_user_id     BIGINT REFERENCES users(id),
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ,
    status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','completed','failed')),
    from_date         DATE NOT NULL,
    to_date           DATE NOT NULL,
    params_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    instruments_count INT NOT NULL DEFAULT 0,
    sessions_count    INT NOT NULL DEFAULT 0,
    alerts_count      INT NOT NULL DEFAULT 0,
    note              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS replay_alerts (
    id                  BIGSERIAL PRIMARY KEY,
    replay_run_id       BIGINT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
    instrument_id       BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    trigger_id          BIGINT NOT NULL REFERENCES triggers(id),
    fired_on            DATE NOT NULL,
    detail              TEXT NOT NULL DEFAULT '',
    inputs_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
    fwd_close_5d        NUMERIC(8,2),
    fwd_max_5d          NUMERIC(8,2),
    fwd_close_14d       NUMERIC(8,2),
    fwd_max_14d         NUMERIC(8,2),
    vol_spike_x         NUMERIC(6,2),
    peak_after_sessions SMALLINT,
    hit                 BOOLEAN,
    resolved            BOOLEAN NOT NULL DEFAULT FALSE,
    baseline            BOOLEAN NOT NULL DEFAULT FALSE,   -- a matched random day, not a fired alert
    UNIQUE (replay_run_id, instrument_id, trigger_id, fired_on, baseline)
);
CREATE INDEX IF NOT EXISTS idx_replay_alerts_run ON replay_alerts (replay_run_id, trigger_id);

-- Operator research inputs the score reads beside the market data: narrative
-- heat, quality factors, haircuts, pre-revenue and pre-flags. The workbench
-- carried these in its meta file; the live engine reads them here so a
-- morning run reproduces the seeded score, and an operator edit in the Lab
-- lands in the next run.
CREATE TABLE IF NOT EXISTS instrument_research (
    instrument_id  BIGINT PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
    heat           NUMERIC(4,2),                -- 0..1 narrative heat; NULL = default
    qual           NUMERIC(4,2),                -- 0..1 mean of known quality factors
    qual_note      TEXT NOT NULL DEFAULT '',
    haircut_points NUMERIC(5,1) NOT NULL DEFAULT 0,
    haircut_note   TEXT NOT NULL DEFAULT '',
    prerev         BOOLEAN NOT NULL DEFAULT FALSE,
    pre_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    growth_pct     NUMERIC(7,1),                -- operator-verified y/y growth when the feed has none
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The day the fact happened, beside the day the product noticed it. The
-- morning pass looks back a few sessions (a volume spike is only visible
-- once the session's bar exists; a FINRA short-interest print is dated its
-- settlement day, a week or more before it is published), so one fact can
-- be seen on several mornings. It is recorded once: the unique index below.
-- fired_at stays the time of noticing, which the delivery sweep reads.
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS fact_on DATE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_events_fact
    ON alert_events (instrument_id, trigger_id, fact_on) WHERE fact_on IS NOT NULL;
