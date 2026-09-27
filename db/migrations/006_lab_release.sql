-- ============================================================
-- 006_lab_release.sql — Lab §10 release workflow
-- (STRATEGY_ANALYSIS_TOOL.md section 10). Adds the version
-- lifecycle (draft/tested/shadow/live/retired), the live-version
-- pointer, publishing pause, the locked holdout, the per-version
-- hit definition, and the shadow trial fields. Idempotent.
-- ============================================================

-- ============================================================
-- strategy_versions lifecycle state
-- ============================================================

ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'live'
    CHECK (state IN ('draft','tested','shadow','live','retired'));

-- Hit definition is part of a version's settings (section 10.1), so it can
-- change in a draft like any other setting and freezes with the rest.
ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS hit_definition_json JSONB
    DEFAULT '{"price_move_pct": 20, "volume_spike_x": 3, "combine": "or", "window": "tight"}';

-- Shadow trial fields (section 10.2).
ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS shadow_started_at TIMESTAMPTZ;
ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS shadow_ends_at TIMESTAMPTZ;
ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS promoted_early BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS live_outcomes_count INT NOT NULL DEFAULT 0;

-- The locked holdout (section 10.4): the first Tested-to-Shadow check on
-- this version, run once against the newest 25% of events and reused for
-- every repeat request. holdout_cutoff records the date boundary that
-- check used, so a repeat always cites the same set.
ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS holdout_cutoff DATE;
ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS holdout_check_json JSONB;

-- Trading days from event until the move's max; NULL before the Publish layer
-- records it. The metrics engine needs "days to move" (section 10.5 #7).
ALTER TABLE backtest_events ADD COLUMN IF NOT EXISTS days_to_move SMALLINT;

-- ============================================================
-- strategies: live pointer + publishing pause (section 10.1, 10.3)
-- ============================================================

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS live_version_id BIGINT
    REFERENCES strategy_versions(id);
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS publishing_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS publishing_paused_at TIMESTAMPTZ;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS publishing_paused_reason TEXT NOT NULL DEFAULT '';

-- ============================================================
-- Hardened immutability: a version is immutable outside Draft.
-- State transitions (draft->tested, shadow->live, live->retired,
-- retire->live on rollback) only touch state and lifecycle fields,
-- never the settings columns below. The cache keys on versioned
-- settings, so any settings edit outside Draft would silently serve
-- results computed against settings the record no longer matches.
-- ============================================================

CREATE OR REPLACE FUNCTION forbid_strategy_version_edit() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'draft' THEN
    IF OLD.band_cutoffs_json IS DISTINCT FROM NEW.band_cutoffs_json
       OR OLD.component_weights_json IS DISTINCT FROM NEW.component_weights_json
       OR OLD.hard_filters_json IS DISTINCT FROM NEW.hard_filters_json
       OR OLD.hit_definition_json IS DISTINCT FROM NEW.hit_definition_json
       OR OLD.change_reason IS DISTINCT FROM NEW.change_reason THEN
      RAISE EXCEPTION 'strategy_versions row % is % and its settings cannot change; create a new draft instead', OLD.id, OLD.state;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_strategy_versions_immutable ON strategy_versions;
CREATE TRIGGER trg_strategy_versions_immutable
  BEFORE UPDATE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_strategy_version_edit();

-- ============================================================
-- calibration_events is the single audit log for both calibration
-- and the release workflow (section 10.3). Widen the columns it
-- needs for release events; all new columns nullable so historical
-- calibration rows read unchanged.
-- ============================================================

ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS version_id BIGINT
    REFERENCES strategy_versions(id);
ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '';
ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS evidence_query_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}';

-- Release-workflow rows describe a state change, not cutoffs. Relax the
-- original NOT NULL so one journal table holds both kinds of event.
ALTER TABLE calibration_events ALTER COLUMN new_cutoffs_json DROP NOT NULL;