-- ============================================================
-- 005_lab.sql — Lab schema (STRATEGY_ANALYSIS_TOOL.md section 3,
-- BUILD_SPEC section 8.1). Strategy versioning, the backtest event
-- store, and the findings/audit tables. Idempotent.
-- ============================================================

-- ============================================================
-- Strategy versions (BUILD_SPEC 8.1, adopted as written, plus
-- hard_filters_json per STRATEGY_ANALYSIS_TOOL.md section 3)
-- ============================================================

CREATE TABLE IF NOT EXISTS strategy_versions (
    id                  BIGSERIAL PRIMARY KEY,
    strategy_id         BIGINT NOT NULL REFERENCES strategies(id),
    version_number       INT NOT NULL,
    band_cutoffs_json    JSONB NOT NULL,
    component_weights_json JSONB NOT NULL,
    hard_filters_json    JSONB NOT NULL DEFAULT '[]',
    effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to         TIMESTAMPTZ,
    created_by_admin_id  BIGINT NOT NULL REFERENCES users(id),
    change_reason        TEXT NOT NULL DEFAULT '',
    UNIQUE (strategy_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_lookup
    ON strategy_versions (strategy_id, effective_from DESC);

-- A version closed by effective_to is immutable: the Lab cache keys on
-- versioned data, so editing a superseded version would silently serve a
-- result computed against weights that no longer match the record.
CREATE OR REPLACE FUNCTION forbid_strategy_version_edit() RETURNS trigger AS $$
BEGIN
  IF OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'strategy_versions row % is closed (effective_to set) and cannot be modified; create a new version instead', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_strategy_versions_immutable ON strategy_versions;
CREATE TRIGGER trg_strategy_versions_immutable
  BEFORE UPDATE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_strategy_version_edit();

-- ============================================================
-- Scores: which version produced each score, and how sure we are
-- ============================================================

ALTER TABLE scores ADD COLUMN IF NOT EXISTS strategy_version_id BIGINT
    REFERENCES strategy_versions(id);
ALTER TABLE scores ADD COLUMN IF NOT EXISTS version_confidence TEXT NOT NULL DEFAULT 'recorded'
    CHECK (version_confidence IN ('recorded', 'assumed'));

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS score_evidence_note TEXT;

-- ============================================================
-- Lab: analysis, findings, audit
-- ============================================================

-- Every analysis an operator runs, whether or not they liked the result.
-- This is both the audit log (spec 1.4) and the denominator for the
-- multiple-comparisons counter (spec 6.3). Written BEFORE computation so
-- an abandoned or failed run still counts.
CREATE TABLE IF NOT EXISTS lab_queries (
    id                  BIGSERIAL PRIMARY KEY,
    admin_user_id       BIGINT NOT NULL REFERENCES users(id),
    strategy_id         BIGINT NOT NULL REFERENCES strategies(id),
    strategy_version_id BIGINT REFERENCES strategy_versions(id),
    query_type          TEXT NOT NULL
        CHECK (query_type IN ('backtest','regression','version_diff')),
    spec_json           JSONB NOT NULL,
    spec_hash           TEXT NOT NULL,
    hypothesis          TEXT NOT NULL DEFAULT '',
    family_key          TEXT,
    cached_from_query_id BIGINT REFERENCES lab_queries(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed','cancelled')),
    result_json         JSONB,
    error_text          TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_queries_family
    ON lab_queries (strategy_id, family_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_queries_hash
    ON lab_queries (spec_hash) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_lab_queries_admin
    ON lab_queries (admin_user_id, created_at DESC);

-- A finding is an operator's durable interpretation of one or more
-- queries. Separate from lab_queries because a query is a fact (it ran,
-- it produced numbers) and a finding is a judgement.
CREATE TABLE IF NOT EXISTS lab_findings (
    id                  BIGSERIAL PRIMARY KEY,
    strategy_id         BIGINT NOT NULL REFERENCES strategies(id),
    title               TEXT NOT NULL,
    claim               TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'hypothesis'
        CHECK (status IN ('hypothesis','tested','held_up','failed','superseded')),
    evidence_grade      TEXT NOT NULL DEFAULT 'none'
        CHECK (evidence_grade IN ('none','weak','moderate','strong')),
    claim_kind          TEXT NOT NULL
        CHECK (claim_kind IN ('filter','weight','band','component','other')),
    created_by_admin_id BIGINT NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_by_id    BIGINT REFERENCES lab_findings(id),
    notes               TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lab_findings_strategy
    ON lab_findings (strategy_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS lab_finding_queries (
    finding_id          BIGINT NOT NULL REFERENCES lab_findings(id) ON DELETE CASCADE,
    lab_query_id        BIGINT NOT NULL REFERENCES lab_queries(id) ON DELETE CASCADE,
    relation            TEXT NOT NULL DEFAULT 'supports'
        CHECK (relation IN ('supports','contradicts','replicates')),
    PRIMARY KEY (finding_id, lab_query_id)
);
CREATE INDEX IF NOT EXISTS idx_lab_finding_queries_query
    ON lab_finding_queries (lab_query_id);

-- Resolved event outcomes, computed once and reused by every backtest.
-- Populated by db/seed_lab.py fixtures in the sandbox (synthetic_data_used
-- TRUE); a real ingest path replaces the fixtures without changing anything
-- downstream. Never re-derived inline in a request.
CREATE TABLE IF NOT EXISTS backtest_events (
    id                  BIGSERIAL PRIMARY KEY,
    instrument_id       BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    event_date          DATE NOT NULL,
    event_kind          TEXT NOT NULL
        CHECK (event_kind IN ('earnings','fda','contract_award','filing','macro','random_day')),
    inputs_json         JSONB NOT NULL,
    provenance_json     JSONB NOT NULL,
    fwd_max_move_pct    NUMERIC(8,2),
    fwd_close_move_pct  NUMERIC(8,2),
    fwd_vol_spike_x     NUMERIC(6,2),
    window_tight_days   SMALLINT NOT NULL DEFAULT 5,
    window_wide_days    SMALLINT NOT NULL DEFAULT 14,
    hit                 BOOLEAN,
    resolved_at         TIMESTAMPTZ,
    data_complete       BOOLEAN NOT NULL DEFAULT TRUE,
    synthetic_data_used BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (instrument_id, event_date, event_kind)
);
CREATE INDEX IF NOT EXISTS idx_backtest_events_date
    ON backtest_events (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_events_instrument
    ON backtest_events (instrument_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_events_kind
    ON backtest_events (event_kind, event_date DESC);