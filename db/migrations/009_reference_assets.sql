-- Benchmarks: indices, sector ETFs and macro series.
--
-- These are never scored and never appear on the board. They exist to give a
-- stock something to be measured against, which is what turns "up 8%" into
-- "up 8% while its sector fell 2%". Kept in tickers so price_bars needs no
-- second shape, and marked here so scoring can exclude them.

CREATE TABLE IF NOT EXISTS reference_assets (
    ticker_id  BIGINT PRIMARY KEY REFERENCES tickers(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('index','etf','sector_etf','macro','crypto','fx')),
    label      TEXT NOT NULL,
    -- Which industry this benchmark represents, when it represents one.
    industry_id BIGINT REFERENCES industries(id),
    sort_order SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reference_assets_kind
    ON reference_assets (kind, sort_order);

-- Per-source ingest reporting. ingest_state is per (source, ticker); this is
-- the roll-up a dashboard reads: when a source last ran, how it went, and
-- when it is due again.
CREATE TABLE IF NOT EXISTS source_runs (
    id           BIGSERIAL PRIMARY KEY,
    source       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    ok_count     INT NOT NULL DEFAULT 0,
    fail_count   INT NOT NULL DEFAULT 0,
    rows_written INT NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','ok','partial','failed')),
    detail       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_source_runs_source
    ON source_runs (source, started_at DESC);
