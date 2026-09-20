# Strategy Analysis Tool — Design Spec (Lab)

Written for: a coding assistant implementing `BUILD_SPEC.md` section 8. This document resolves section 8 from a four-bullet requirement into a buildable design: screens, routes, API payloads, exact copy strings, statistical guardrails, and a two-phase build order.

**Authority:** `BUILD_SPEC.md` is the build authority for everything else. Where this document resolves something section 8 left open, this document wins. Where it conflicts with `BUILD_SPEC.md` section 3 (schema) or 4.5 (calibration transition), `BUILD_SPEC.md` wins and this document must be corrected instead.

**Name:** the tool is called **the Lab** in all UI copy, routed at `/lab/*`. Not "Analysis", not "Admin" — those read as generic nav chrome. A short proper noun is easier to talk about ("check it in the Lab") and makes it obvious in logs, routes, and component names that a screen is operator-only.

---

## 0. Scope and non-goals

**In scope:** an admin-only React view set under `/lab`, a set of `/api/admin/lab/*` endpoints, four new tables, and the statistical guardrails that stop an operator from drawing a conclusion the data does not support.

**Out of scope, explicitly:**

- Any subscriber-visible surface. Nothing in the Lab is ever linked, cached, or rendered outside an admin session. See section 1.2.
- Editing weights. The Lab is read-and-analyze. Changing a strategy's weights stays with `POST /api/admin/strategies/{key}/calibrate` (`BUILD_SPEC.md` section 4.5). The Lab's job ends at producing evidence; applying that evidence is the existing human-gated action. The one bridge between them is the "Send to calibration" handoff in section 5.6, which prefills the calibrate form but does not submit it.
- Automated strategy search / hyperparameter optimization. A machine that tries ten thousand weight combinations and keeps the best one is exactly the failure mode section 6 exists to prevent, at a scale no human review can catch.
- Trade profitability, position sizing, or direction prediction. `test_results.md` measures whether a large move happened, not its direction or P&L. The Lab inherits that limit and states it on screen rather than quietly extending past it.

---

## 1. Access, gating, and the leak risk

### 1.1 Gate

Identical mechanism to `POST /api/admin/strategies/{key}/calibrate`: the `is_admin` boolean flag on the `users` row. No new role system, no permission table.

One shared FastAPI dependency, `require_admin`, applied to the entire `/api/admin` router including every Lab endpoint. Do not decorate endpoints individually — a route added later without the decorator is a silent full-disclosure bug.

Non-admin authenticated users and anonymous requests get an identical `404` with the standard not-found body, not a `403`. Reason: a `403` confirms the endpoint exists, which tells a probing subscriber the tool exists and is worth attacking. This is the same reasoning as the visible-universe rule in `BUILD_SPEC.md` section 5, applied one level up — the existence of the surface is itself the thing being hidden.

### 1.2 Bundle separation

The Lab must not ship inside the subscriber React bundle. A React app with the Lab's components tree-shaken in but route-gated still contains, in readable JS on a public CDN path, every component weight label, every regression variable name, and every piece of methodology copy. That is the "how to copy this" detail the business decided to keep private (`PROJECT_HANDOFF.md`'s moat discussion, restated in `BUILD_SPEC.md` section 8 intro).

Concretely, with Vite (`BUILD_SPEC.md` preamble):

- A second Vite entry point, `lab.html` / `src/lab/main.tsx`, built by the same `npm run build` into `dist/lab/`.
- nginx serves `dist/lab/*` only behind an `auth_request` subrequest to a new `GET /api/admin/_check` endpoint returning `204` for admins and `404` otherwise. An unauthenticated fetch of `/lab/assets/index-[hash].js` returns `404`, not the bundle.
- No import path crosses from `src/lab/` into `src/app/` or the reverse, except through `src/shared/` (design tokens, `api()` helper, formatters). Enforce with an ESLint `no-restricted-imports` rule so a later contributor gets a build error rather than a quiet leak.

### 1.3 No-index and no-cache

Every Lab HTML response and every `/api/admin/lab/*` JSON response carries `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`. Regression results are cached server-side by hash (section 4.4), never by the browser or by nginx — a shared proxy cache holding a regression result keyed only on URL is a cross-session leak.

### 1.4 Audit

Every regression run, backtest run, and version comparison writes a row to `lab_queries` (section 3). This is not security theater: it is the input to the multiple-comparisons counter in section 6.3, which cannot work without a durable record of how many tests the operator has already run. The audit log and the p-hacking guardrail are the same table.

---

## 2. Information architecture

### 2.1 Route map

```
/lab                                  Strategy index (landing)
/lab/s/:strategyKey                   Strategy overview  (tabs below)
/lab/s/:strategyKey/inputs            Input map          (tab 1, default)
/lab/s/:strategyKey/versions          Version history    (tab 2)
/lab/s/:strategyKey/versions/:a..:b   Version diff       (tab 2, drill-in)
/lab/s/:strategyKey/backtest          Backtest           (tab 3)
/lab/s/:strategyKey/regression        Regression         (tab 4)
/lab/findings                         Findings ledger    (cross-strategy)
/lab/findings/:id                     Single finding, permalink
```

Five screens, not five separate tools. The strategy is the spine: an operator thinks "I have a question about Fast Mover", and every screen is a different lens on one strategy. The Findings ledger is the only cross-strategy screen, because a finding's whole purpose is to outlive the session that produced it.

### 2.2 Why this shape

**Tabs, not a sidebar tree.** Four tabs is under the seven-item threshold where a flat set stops being scannable, and tabs make the mental model explicit: same subject, different view. A sidebar tree would imply a hierarchy that does not exist (inputs are not parents of versions).

**Progressive disclosure across the four tabs, left to right, in increasing epistemic risk order.** Inputs is pure description — it cannot be wrong. Versions is history — also factual. Backtest is measurement, which can mislead through sample size. Regression is inference, which can mislead in a dozen ways. Reading order matches risk order, so an operator who stops halfway has stopped at the safe end. This is also why the Regression tab is the only one with a mandatory pre-run declaration step (section 5.4).

**The Findings ledger is a first-class screen, not a modal or an export.** Section 6.3's multiple-comparisons guardrail only means anything if a finding is a durable object with a status, not a screenshot someone took. Giving it a permalink and a ledger is what converts "I ran a regression" into "we know this, and here is what it is worth."

### 2.3 Shell

Reuses the design tokens from `BUILD_SPEC.md` section 6 with one addition to `theme-override.css`:

```css
[data-surface="lab"] {
  --bg: #12151a;
  --surface: #1a1e26;
  --surface-sunken: #0d1015;
  --border: #2b313c;
  --ink: #e8eaee;
  --ink-muted: #9aa3b2;
}
```

The Lab is dark; the subscriber product is light. Reason: this is the cheapest possible always-on signal that the operator is looking at a private surface, and it makes a screenshot accidentally pasted into a public channel obviously internal. It is not a style preference — it is a mislabeling guard. The type scale, spacing, and the "no dashed borders" rule from `BUILD_SPEC.md` section 7.1 carry over unchanged.

Header: `tradealert.me Lab` wordmark, strategy switcher `<select>`, and a persistent right-side chip reading `Internal — not subscriber-visible`. The chip is always rendered, never dismissible.

---

## 3. Schema additions

`BUILD_SPEC.md` section 8.1's `strategy_versions` table is adopted as written. Four more tables, plus one column, are needed.

```sql
-- ============================================================
-- Lab: analysis, findings, audit
-- ============================================================

-- Every analysis an operator runs, whether or not they liked the result.
-- This is both the audit log (section 1.4) and the denominator for the
-- multiple-comparisons counter (section 6.3). A row is written BEFORE
-- the computation runs, so an abandoned or failed run still counts --
-- otherwise an operator could cancel out of unfavourable results and
-- silently reset their own multiple-testing budget.
CREATE TABLE IF NOT EXISTS lab_queries (
    id                  BIGSERIAL PRIMARY KEY,
    admin_user_id       BIGINT NOT NULL REFERENCES users(id),
    strategy_id         BIGINT NOT NULL REFERENCES strategies(id),
    strategy_version_id BIGINT REFERENCES strategy_versions(id),   -- NULL = "as currently configured"
    query_type          TEXT NOT NULL
        CHECK (query_type IN ('backtest','regression','version_diff')),
    spec_json           JSONB NOT NULL,      -- the full, normalized query definition (section 4.3)
    spec_hash           TEXT NOT NULL,       -- sha256 of canonicalized spec_json, for result caching
    hypothesis          TEXT NOT NULL DEFAULT '',   -- required for regression, see section 5.4
    family_key          TEXT,                -- groups related tests for the comparisons counter
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed','cancelled')),
    result_json         JSONB,               -- NULL until completed
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
-- it produced numbers) and a finding is a judgement (what those numbers
-- mean, and how much it should be trusted).
CREATE TABLE IF NOT EXISTS lab_findings (
    id                  BIGSERIAL PRIMARY KEY,
    strategy_id         BIGINT NOT NULL REFERENCES strategies(id),
    title               TEXT NOT NULL,
    claim               TEXT NOT NULL,        -- the falsifiable sentence, section 6.5
    status              TEXT NOT NULL DEFAULT 'hypothesis'
        CHECK (status IN ('hypothesis','tested','held_up','failed','superseded')),
    evidence_grade      TEXT NOT NULL
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

-- Many-to-many: a finding cites the queries that support (or contradict)
-- it. 'contradicts' exists deliberately -- a finding that survived an
-- attempt to break it is worth more than one that was never challenged,
-- and the UI shows both counts (section 5.6).
CREATE TABLE IF NOT EXISTS lab_finding_queries (
    finding_id          BIGINT NOT NULL REFERENCES lab_findings(id) ON DELETE CASCADE,
    lab_query_id        BIGINT NOT NULL REFERENCES lab_queries(id) ON DELETE CASCADE,
    relation            TEXT NOT NULL DEFAULT 'supports'
        CHECK (relation IN ('supports','contradicts','replicates')),
    PRIMARY KEY (finding_id, lab_query_id)
);
CREATE INDEX IF NOT EXISTS idx_lab_finding_queries_query
    ON lab_finding_queries (lab_query_id);

-- Resolved event outcomes, computed once and reused by every backtest
-- and regression. This is the generalization of test_results.md's
-- squeeze_events.json from a one-off file into a queryable table.
-- Populated by a batch job (section 7), never computed inline in a
-- request -- a regression over 400 instruments must not re-derive
-- outcomes from price bars on every run.
CREATE TABLE IF NOT EXISTS backtest_events (
    id                  BIGSERIAL PRIMARY KEY,
    instrument_id       BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    event_date          DATE NOT NULL,
    event_kind          TEXT NOT NULL
        CHECK (event_kind IN ('earnings','fda','contract_award','filing','macro','random_day')),
    -- point-in-time input snapshot: every field as it was KNOWN on
    -- event_date, never as later restated. Keyed by component key so a
    -- new component needs no migration, same principle as snapshots.
    inputs_json         JSONB NOT NULL,
    -- provenance per field: {component_key: {source, as_of, vintage}}.
    -- Non-negotiable: short interest carries its FINRA reporting
    -- vintage, share count carries its SEC filing date. Without this,
    -- lookahead bias is undetectable after the fact.
    provenance_json     JSONB NOT NULL,
    -- realized outcome, measured identically for every event_kind so
    -- groups stay comparable (test_results.md's own rule).
    fwd_max_move_pct    NUMERIC(8,2),        -- tight window, signed max absolute excursion
    fwd_close_move_pct  NUMERIC(8,2),        -- close-to-close over the window
    fwd_vol_spike_x     NUMERIC(6,2),        -- peak volume / trailing 20d average
    window_tight_days   SMALLINT NOT NULL DEFAULT 5,
    window_wide_days    SMALLINT NOT NULL DEFAULT 14,
    hit                 BOOLEAN,             -- NULL until resolved
    resolved_at         TIMESTAMPTZ,
    data_complete       BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = some input unavailable at event_date
    UNIQUE (instrument_id, event_date, event_kind)
);
CREATE INDEX IF NOT EXISTS idx_backtest_events_date
    ON backtest_events (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_events_instrument
    ON backtest_events (instrument_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_events_kind
    ON backtest_events (event_kind, event_date DESC);
```

One column added to `strategy_versions` beyond `BUILD_SPEC.md` section 8.1:

```sql
ALTER TABLE strategy_versions
    ADD COLUMN IF NOT EXISTS hard_filters_json JSONB NOT NULL DEFAULT '[]';
-- [{key, label, op, value, unit}] e.g.
-- [{"key":"float_shares","label":"Float","op":"<","value":50000000,"unit":"shares"},
--  {"key":"short_interest_pct","label":"Short interest","op":">","value":10,"unit":"% of float"}]
```

**Why this column is the most important line in this document.** `BUILD_SPEC.md` section 8.1 versions `component_weights_json` and `band_cutoffs_json` — the score. It does not version the hard filters. `test_results.md`'s entire verified result is about the hard filters; the score showed no relationship to forward returns. A version-history tool that tracks only the part with no demonstrated signal, and not the part with demonstrated signal, would make the original methodology error structural. Hard filters are versioned, diffed, and backtested as first-class objects everywhere in this document.

`scores.strategy_version_id` is added per `BUILD_SPEC.md` section 8.1, unchanged, plus one companion column `BUILD_SPEC.md` calls for but does not define:

```sql
ALTER TABLE scores
    ADD COLUMN IF NOT EXISTS version_confidence TEXT NOT NULL DEFAULT 'recorded'
        CHECK (version_confidence IN ('recorded','assumed'));
-- 'recorded': this score was written after strategy_versions existed, so
-- strategy_version_id is a fact. 'assumed': backfilled onto a pre-tracking
-- score using the earliest known version, which cannot rule out an
-- unrecorded change happening before tracking began (BUILD_SPEC.md
-- section 3.1's backfill note).
```

Any `backtest_events` row or regression observation built from a `scores` row with `version_confidence = 'assumed'` sets `provenance.version_confidence_assumed_count` in the response (section 4.2, 4.3), and the result panel (section 5.5) renders a `--warn` line above the numbers whenever that count is non-zero: `N of the events in this result rest on an assumed, not recorded, strategy version — the exact filter/weight set in effect cannot be confirmed for dates before version tracking began.` This is the same visibility principle as the synthetic-data banner in section 6.7, applied to a different kind of unverifiable input, and is added to that section's guardrail list rather than left as a one-off mention here.

---

## 4. API surface

All routes under `/api/admin/lab`, all behind `require_admin` (section 1.1).

### 4.1 Read endpoints

```
GET /api/admin/lab/strategies
GET /api/admin/lab/strategies/{key}/inputs?version={n|current}
GET /api/admin/lab/strategies/{key}/versions
GET /api/admin/lab/strategies/{key}/versions/diff?a={n}&b={m}
GET /api/admin/lab/strategies/{key}/coverage
GET /api/admin/lab/findings?strategy={key}&status={s}
GET /api/admin/lab/findings/{id}
GET /api/admin/lab/queries?strategy={key}&family={key}&limit=50
```

`GET /api/admin/lab/strategies/{key}/inputs` response:

```json
{
  "strategy": {"key": "fast_mover", "label": "Fast Mover", "calibrated": true},
  "version": {"id": 7, "version_number": 3, "effective_from": "2026-06-02T00:00:00Z",
              "effective_to": null, "change_reason": "Tightened SI floor to 12%"},
  "hard_filters": [
    {"key": "market_cap", "label": "Market cap", "op": "between",
     "value": [300000000, 3000000000], "unit": "USD",
     "source": {"name": "yfinance", "field": "marketCap", "refresh": "daily",
                "vintage_lag_days": 0},
     "coverage_pct": 99.3, "null_pct": 0.7, "evidence_grade": "strong"},
    {"key": "short_interest_pct", "label": "Short interest", "op": ">",
     "value": 12, "unit": "% of float",
     "source": {"name": "FINRA biweekly", "field": "currentShortPosition",
                "refresh": "biweekly", "vintage_lag_days": 11},
     "coverage_pct": 94.1, "null_pct": 5.9, "evidence_grade": "strong"}
  ],
  "components": [
    {"key": "catalyst_proximity", "label": "Catalyst proximity", "weight": 0.25,
     "weight_renormalized_median": 0.27,
     "source": {"name": "earnings calendar", "field": "next_earnings_date",
                "refresh": "daily", "vintage_lag_days": 0},
     "coverage_pct": 88.4, "null_pct": 11.6, "evidence_grade": "none"}
  ],
  "band_cutoffs": {"strong": 75, "elevated": 60, "neutral": 40, "weak": 25},
  "score_evidence_note": "This strategy's numeric score has no verified relationship to forward returns. See finding #4."
}
```

`evidence_grade` on each row is joined from `lab_findings`: the highest grade among non-superseded findings whose `claim_kind` and cited component match that row. `"none"` means never tested, and renders as such — not as a blank, not as a dash.

### 4.2 Backtest

```
POST /api/admin/lab/backtest
```

Request:

```json
{
  "strategy_key": "fast_mover",
  "version_number": 3,
  "universe": {
    "mode": "filter",
    "tickers": null,
    "industry_keys": ["defense"],
    "market_cap_band": [300000000, 3000000000],
    "instrument_group": null,
    "theme_regex": null
  },
  "window": {"from": "2024-09-01", "to": "2026-06-30"},
  "event_kinds": ["earnings"],
  "hit_definition": {
    "price_move_pct": 20,
    "volume_spike_x": 3,
    "combine": "or",
    "window": "tight"
  },
  "baselines": ["all_events", "random_day"],
  "group_by": "filter_pass"
}
```

Response:

```json
{
  "query_id": 412,
  "spec_hash": "9f2c…",
  "groups": [
    {"label": "All six filters passed", "n": 32, "hits": 26, "hit_rate": 0.8125,
     "ci95": [0.646, 0.918], "distinct_instruments": 8,
     "max_instrument_share": 0.25},
    {"label": "Any filter failed", "n": 159, "hits": 86, "hit_rate": 0.5409,
     "ci95": [0.462, 0.618], "distinct_instruments": 26,
     "max_instrument_share": 0.11}
  ],
  "baselines": [
    {"label": "All earnings events", "n": 191, "hits": 112, "hit_rate": 0.5864,
     "ci95": [0.515, 0.655]},
    {"label": "Random trading days", "n": 232, "hits": 85, "hit_rate": 0.3664,
     "ci95": [0.306, 0.431]}
  ],
  "comparison": {
    "vs": "All earnings events",
    "difference": 0.2261,
    "test": "two-proportion z-test",
    "p_value": 0.0091,
    "p_value_adjusted": 0.0364,
    "adjustment": {"method": "holm", "family_key": "fm_v3_si_threshold",
                   "tests_in_family": 4}
  },
  "warnings": [
    {"code": "SMALL_SAMPLE", "severity": "warn",
     "text": "32 events in the primary group. The rate is clearly above baseline; the figure 81.2% is not stable to a decimal point."},
    {"code": "CONCENTRATION", "severity": "info",
     "text": "8 of 32 events (25%) come from a single instrument (INOD). Results are not driven by one name, but are not broadly diversified either."}
  ],
  "provenance": {
    "events_total": 191,
    "events_excluded": 7,
    "exclusions": [{"reason": "annual_filer_insufficient_history", "count": 4},
                   {"reason": "no_cik_match", "count": 2},
                   {"reason": "incomplete_inputs", "count": 1}],
    "sources": ["FINRA biweekly short interest", "SEC EDGAR companyfacts",
                "daily OHLCV", "earnings calendar"],
    "synthetic_data_used": false
  }
}
```

`synthetic_data_used` is computed, not asserted: it is `true` if any contributing `backtest_events` row was generated by a seed/fixture script rather than an ingest job. If `true`, every number in the UI renders with a hatched background and the banner in section 6.7. `PROJECT_HANDOFF.md` records a prior wrong turn involving a synthetic-data proxy backtest; this field makes a repeat visible rather than discoverable months later.

### 4.3 Regression

```
POST /api/admin/lab/regression
```

Request:

```json
{
  "strategy_key": "fast_mover",
  "version_number": 3,
  "hypothesis": "Short interest above 12% raises hit rate for defense names under $1B, independent of catalyst proximity.",
  "family_key": "fm_v3_si_threshold",
  "model": "logistic",
  "dependent": {"key": "hit", "hit_definition": {"price_move_pct": 20, "volume_spike_x": 3, "combine": "or", "window": "tight"}},
  "independent": [
    {"key": "short_interest_pct", "transform": "none"},
    {"key": "float_shares", "transform": "log"},
    {"key": "days_to_catalyst", "transform": "none"}
  ],
  "controls": ["market_regime_3m", "event_kind"],
  "universe": {"mode": "filter", "industry_keys": ["defense"],
               "market_cap_band": [0, 1000000000]},
  "window": {"from": "2024-09-01", "to": "2026-06-30"},
  "holdout": {"mode": "time", "train_to": "2026-01-31"}
}
```

Response (logistic; linear returns `r_squared`, `adj_r_squared`, and residual diagnostics instead of pseudo-R²/AUC):

```json
{
  "query_id": 413,
  "model": "logistic",
  "n": 74,
  "n_events_positive": 41,
  "events_per_predictor": 13.7,
  "pseudo_r2_mcfadden": 0.081,
  "auc": 0.63,
  "coefficients": [
    {"key": "short_interest_pct", "coef": 0.0412, "se": 0.0191,
     "odds_ratio": 1.042, "p_value": 0.031, "p_value_adjusted": 0.124,
     "ci95_odds": [1.004, 1.082]},
    {"key": "log_float_shares", "coef": -0.331, "se": 0.288,
     "odds_ratio": 0.718, "p_value": 0.251, "p_value_adjusted": 0.502,
     "ci95_odds": [0.408, 1.263]}
  ],
  "holdout": {"mode": "time", "n_train": 52, "n_test": 22,
              "auc_train": 0.71, "auc_test": 0.54,
              "verdict": "did_not_generalize"},
  "diagnostics": {
    "max_vif": 3.8,
    "clustered_se_by": "instrument_id",
    "n_clusters": 11,
    "complete_case_dropped": 9
  },
  "comparisons_context": {
    "family_key": "fm_v3_si_threshold",
    "tests_in_family": 4,
    "adjustment": "holm",
    "first_test_at": "2026-09-19T14:02:11Z"
  },
  "warnings": [
    {"code": "EPV_LOW", "severity": "block",
     "text": "74 observations, 41 positive, 3 predictors: 13.7 events per predictor. Below the 20 this tool requires. Drop a predictor or widen the window before reading the coefficients."},
    {"code": "HOLDOUT_FAILED", "severity": "warn",
     "text": "AUC fell from 0.71 in-sample to 0.54 out-of-sample. The in-sample fit is not evidence."},
    {"code": "FAMILY_SIZE", "severity": "warn",
     "text": "This is test 4 in this family. Holm-adjusted p for short_interest_pct is 0.124; unadjusted was 0.031."}
  ]
}
```

### 4.4 Caching and execution

Results are cached server-side keyed on `spec_hash` plus the max `backtest_events.id` at execution time. A repeated identical spec returns the cached `result_json` and still writes a new `lab_queries` row with `status='completed'` and a `cached_from_query_id` reference in `spec_json`. Reason: the comparisons counter must count the operator's *attempts*, not the server's *computations*. Re-running the same test to get a friendlier-looking screen is still an attempt.

**Cache-invalidation hole, closed:** the cache key does not include anything from `strategy_versions`, so if a `strategy_versions` row were edited in place after being cached against, a repeated spec would silently serve a result computed against weights that no longer match what the version record now says. This is only possible if `strategy_versions` rows are mutable after `effective_to` is set, which they must not be. Enforce with a database trigger, not just application discipline:

```sql
CREATE OR REPLACE FUNCTION forbid_strategy_version_edit() RETURNS trigger AS $$
BEGIN
  IF OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'strategy_versions row % is closed (effective_to set) and cannot be modified; create a new version instead', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_strategy_versions_immutable
  BEFORE UPDATE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_strategy_version_edit();
```

A version with `effective_to = NULL` (the current, open version) may still be updated — that is how `POST /api/admin/strategies/{key}/calibrate` closes it. The trigger only blocks editing a version after it has been superseded, which is exactly the state the cache assumes will never change.

Execution is synchronous with a hard 30-second server-side timeout. If a spec exceeds it, return `202` with the `query_id` and have the UI poll `GET /api/admin/lab/queries/{id}` every 2 seconds. No Celery, no Redis — `BUILD_SPEC.md` section 2's constraint holds; a thread pool with a bounded queue of 2 is sufficient for a single-operator tool.

### 4.5 Findings

```
POST   /api/admin/lab/findings
PATCH  /api/admin/lab/findings/{id}
POST   /api/admin/lab/findings/{id}/queries    {lab_query_id, relation}
DELETE /api/admin/lab/findings/{id}/queries/{lab_query_id}
```

`POST` requires `title`, `claim`, `claim_kind`, and at least one cited `lab_query_id`. A finding with no cited query cannot be created through the API — an untethered claim is exactly what the Lab exists to prevent.

`evidence_grade` is **computed server-side on every write**, never accepted from the client. Rules in section 6.6.

---

## 5. The five screens

### 5.1 Strategy index — `/lab`

One card per strategy, five cards, single column at a comfortable reading width (not a grid — five items in a grid at three-across leaves a ragged second row and implies a ranking that does not exist).

Each card shows:

| Element | Content | Notes |
|---|---|---|
| Name + status chip | `Fast Mover` / `Calibrated` or `Provisional` | Solid-fill chip per `BUILD_SPEC.md` section 7.1, never a dashed border |
| Version line | `v3, effective since 2 Jun 2026` | Links to the version history tab |
| Evidence line | `Filters: tested, held up (32 events). Score: tested, no signal.` | The headline honesty statement, see below |
| Data line | `191 resolved events across 27 instruments, 2024-09 to 2026-06` | For provisional strategies: `0 resolved events. Nothing here can be backtested yet.` |
| Last analysis | `Last query 2 days ago by ali@…` | Links to the query log |

**The evidence line is the most important element on this screen.** It states, separately, what is known about the filters and what is known about the score. Fast Mover's real state is that one half of it has verified predictive value and the other half was tested and showed none (`test_results.md` limits section). A single "Calibrated" badge collapses those two facts into one reassuring word, which is the precise shape of the original error. The Lab's landing screen refuses to collapse them.

For the four provisional strategies, the evidence line reads: `Filters: not tested. Score: not tested. No resolved outcomes yet.` and the card's Backtest and Regression tabs render the empty state in section 5.5.

### 5.2 Input map — `/lab/s/:key/inputs`

Two stacked sections, hard filters first, components second. Hard filters come first because they are the part with demonstrated signal.

**Hard filters section.** One row per filter:

```
Short interest        > 12% of float        FINRA biweekly · 11-day vintage lag
                                             94.1% coverage · tested, held up
```

A vintage-lag column is mandatory on every row. Short interest is reported biweekly, so a filter evaluated "today" is using data up to eleven days stale, and any backtest that ignores this has lookahead bias. `PROJECT_HANDOFF.md` already requires short interest to be tagged with its FINRA vintage at ingest; this screen is where that tag becomes visible to the person drawing conclusions.

**Components section.** One row per component: declared weight, median renormalized weight across the last run, data source, coverage percent, and evidence grade.

The declared-vs-renormalized pair matters and is why both are shown. `PROJECT_HANDOFF.md` section 3 renormalizes weights over whichever components are present, so a component with 25% declared weight and 60% coverage actually carries a much larger share on the names where it is present. An operator reasoning from the declared number alone will misattribute the score's behavior. Render as: `0.25 declared → 0.27 median effective`.

**Header banner, always present, non-dismissible:**

> This screen describes what the strategy does. It says nothing about whether any of it works. Evidence grades come from the Findings ledger.

**Score evidence note.** For Fast Mover, directly above the components section, in a `--warn`-tinted box:

> This strategy's 25-point score was tested against forward returns and showed no relationship (r² near zero, all horizons). The verified claim is about the hard filters above, not about the score. Do not use score magnitude as evidence for a weight change without a new test that finds otherwise.

This text is stored as `strategies.score_evidence_note` (new `TEXT` column, nullable) and rendered whenever non-empty, so any strategy that later fails a score test gets the same treatment without a code change.

### 5.3 Version history — `/lab/s/:key/versions`

A vertical timeline, newest at top, one entry per `strategy_versions` row.

Entry: version number, date range, author, `change_reason`, and a one-line change summary generated from the diff (`Short interest floor 10% → 12%; catalyst_proximity weight 0.20 → 0.25`).

Each entry carries two secondary actions: `Compare to previous` (opens the diff view) and `Backtest this version` (opens the Backtest tab with `version_number` prefilled).

**Diff view** — `/lab/s/:key/versions/3..4`. Three grouped tables: hard filters changed, component weights changed, band cutoffs changed. Unchanged rows collapse behind a `Show 11 unchanged` toggle. Additions in `--pos`, removals in `--neg`, and **every change also carries an arrow glyph and a `+`/`−` prefix** so the diff is readable without color (accessibility requirement, and it survives a grayscale print of the audit trail).

Below the tables, a **performance comparison strip**: if both versions have a cached backtest over an identical spec, show the two hit rates side by side with the difference and its confidence interval. If either is missing, show a button `Run both versions on the same events` rather than a blank space — comparing two versions on different event sets is the most common way to produce a meaningless improvement number, so the tool only ever offers the matched comparison.

**Empty state, all four provisional strategies:**

> One version on record, created when the strategy was defined. Version history becomes useful after the first weight change. Nothing to compare yet.

### 5.4 Regression builder — `/lab/s/:key/regression`

This is the screen that decides whether the tool has rigor or is a slot machine. Design for an operator who is not a professional quant but needs a real result.

**Layout:** a left panel (the builder, ~380px fixed) and a right panel (results, fluid). The builder stays on screen while results render, so changing one variable and re-running is a two-click loop — but each re-run passes through the declaration gate below.

**Step 1 — Hypothesis, before anything else.** A single required textarea at the top of the builder, above every variable control. Placeholder:

> What do you expect to find, and what result would change your mind? e.g. "Tightening short interest from 10% to 12% raises hit rate for defense names under $1B. If the difference is under 5 points or the confidence interval crosses zero, the change is not justified."

The Run button is disabled until this field has at least 40 characters. The text is stored in `lab_queries.hypothesis` and reprinted at the top of every result.

Why this gate exists, stated in a helper line under the field: **"Written first, a hypothesis is a test. Written after, it is a description of whatever the data happened to show."** This is the single cheapest protection against the failure mode in `test_results.md` — the invented composite score was regression-tested without a prior statement of what claim was under test, which is how a test of the wrong claim got run at all. A forced hypothesis field makes "the platform claims the filters mark higher-probability setups" or "the platform claims the score predicts return size" an explicit, recorded choice rather than an implicit one.

**Step 2 — Family.** A `<select>` of existing `family_key` values for this strategy plus `+ New line of inquiry`. Label: `Line of inquiry`. Helper: `Tests in the same line of inquiry are counted together when adjusting for multiple comparisons.` Defaults to the family of the operator's most recent query on this strategy within 24 hours, so the common case (keep poking at the same question) is correctly grouped without thought. Choosing `New` opens a name field.

**Step 3 — What are you measuring? (dependent variable).** Radio group, not a dropdown, because the options are few and the choice is consequential enough to deserve visible alternatives:

- `Did a big move happen?` — binary hit. Sub-controls: price-move threshold (default 20%), volume-spike threshold (default 3x), `or` / `and`, tight/wide window. Helper: `This is what the Fast Mover backtest measured. It does not measure direction or profit.`
- `How big was the move?` — continuous, signed close-to-close percent. Helper, in `--warn`: `Return magnitude is much harder to predict than whether a move occurred. A near-zero r² here is the expected result, not a surprise.`
- `How long until it resolved?` — days to the move. Helper: `Only defined for events that did resolve; this silently drops non-events and will bias any comparison.`

The model type is derived, not chosen: binary → logistic, continuous → OLS. An operator should not have to know the word "logistic". The chosen model is stated in the result header (`Logistic regression, chosen because the outcome is yes/no`).

**Step 4 — What might explain it? (independent variables).** A searchable multi-select of the strategy's components and hard-filter fields, plus a small set of always-available contextual fields (`market_cap`, `float_shares`, `days_to_catalyst`, `event_kind`, `market_regime_3m`, `sector_breadth`). Each selected variable becomes a chip with a transform `<select>` (`none` / `log` / `rank` / `winsorize 1%`).

A live counter sits directly under the multi-select and is the primary rigor affordance on this screen:

```
3 variables · 74 observations · 41 positive outcomes
13.7 events per variable — below the 20 this tool requires
```

It updates on every selection change, **before** the run. The bar turns `--neg` below 10, `--warn` from 10 to 20, `--pos` at 20 or above. Putting this before the run rather than in the result is deliberate: a warning that appears next to a result the operator already likes will lose the argument against it.

**Step 5 — Which stocks? (universe).** Three mutually exclusive modes as a segmented control:

- `Named tickers` — a token input.
- `By filter` — industry multi-select, market-cap band (two number inputs with a `$300M–$3B` preset button matching Fast Mover's own filter), instrument group, theme regex with a live match count.
- `Filter pass/fail` — passed all hard filters / failed at least one / either. This mode is what answers the section 5.7 question directly.

Under any mode, a live line: `Matches 14 instruments, 61 events in the selected window.` If it drops below 30 events, the line turns `--warn` and reads `61 events is below the 30 this tool treats as a floor for a rate comparison.`

**Step 6 — When? (window).** Two date inputs with presets `Last 12 months`, `Last 24 months`, `All available`. Below them a small stacked bar showing event density per quarter across the selected window, so a window that is really "one busy quarter plus eighteen empty months" is visible before the run rather than inferred from a confusing result.

**Step 7 — Holdout, on by default.** A checkbox, checked, labeled `Hold out the most recent period as a test` with a period selector (default: last 30% of the window by time, not by row count). Helper: `The tool fits on the earlier period and checks the result on the later one. Unchecking this is allowed; the result will be labeled "in-sample only" and can never reach evidence grade above "weak".`

Time-based, not random, holdout. Random splits across a time series leak future information through events on adjacent days for the same instrument, which reliably manufactures a result that will not survive contact with next quarter.

**Step 8 — Run.** The button reads `Run test (test 4 in this line of inquiry)` when the family already has tests, making the accumulating cost visible on the control itself rather than only in the result.

### 5.5 Results panel

Read top to bottom in this fixed order. The order is the design: verdict before numbers, because a number seen first anchors the interpretation regardless of what qualifies it later.

**1. Verdict banner.** One of five states, with an icon-plus-text pair (never color alone):

| State | Banner text | Condition |
|---|---|---|
| `Blocked` | `Not enough data to read this result.` | Any `severity: block` warning |
| `No signal` | `No relationship found. This is a real result — record it.` | No adjusted p below 0.05 |
| `Suggestive` | `Possible relationship, not confirmed. Worth another test on different data.` | Adjusted p below 0.05, holdout not run or not passed |
| `Held up` | `Held up out of sample.` | Adjusted p below 0.05 and holdout AUC within 0.05 of in-sample |
| `Contradicted` | `This result points the opposite way from the hypothesis.` | Significant coefficient with sign opposite to the stated hypothesis direction |

The `No signal` wording is deliberate. The invented-composite-score test in `test_results.md` found r² near zero, which was a genuinely informative result correctly acted on. A tool that renders a null result as a failure or a blank teaches the operator to keep re-running until something non-null appears; a tool that names it a result, and offers to record it as a finding, does not.

**2. The hypothesis, verbatim**, in quotes, above every number. Lets the operator see immediately whether the result answers the question actually asked.

**3. Warnings**, every one, above the numbers, never collapsed.

**4. Plain-language reading of the main coefficient.** One sentence, generated:

> Each 1-point rise in short interest is associated with about 4% higher odds of a big move (odds ratio 1.042, 95% CI 1.00 to 1.08). After adjusting for the 4 tests in this line of inquiry, this is not statistically distinguishable from no effect (p = 0.124).

Then the coefficient table, with both raw and adjusted p, the adjusted column first.

**5. Effect-size framing before statistical significance.** Above the table, the practical translation: `Over the 74 events tested, moving the threshold from 10% to 12% would have changed 6 events from pass to fail. 4 of those 6 were hits.` Significance answers "is this distinguishable from noise"; six events answers "is this worth doing", and the second question is the one the operator actually has.

**6. Diagnostics**, collapsed by default under `Show diagnostics`: VIF, clustering, complete-case drops, holdout split sizes. Collapsed because it is reference material, not because it is optional.

**7. Actions row:** `Record as finding`, `Copy permalink`, `Export CSV`, `Run the same test on a different period` (the single most useful replication action, so it gets a button rather than requiring a manual rebuild).

**Empty state for the four provisional strategies**, on both Backtest and Regression tabs:

> **Nothing to test yet.** Market Shift has no resolved outcomes on record. Backtests and regressions need realized events with point-in-time inputs; this strategy has produced scores but none of them have resolved.
>
> What would make this testable: 30 resolved outcomes, the same floor the recalibration loop uses before it will propose weights. Current count: 0.
>
> You can still inspect the Input map and Version history tabs.

The Run button is not merely disabled, it is absent. A disabled button invites hunting for the condition that enables it; an explicit statement of what is missing and its current count answers the question directly. This also blocks the most tempting shortcut with these four strategies, which is to backtest them against synthetic or forward-filled data just to see something on screen.

### 5.6 Findings ledger — `/lab/findings`

A table across all five strategies, default sorted by `updated_at` descending, filterable by strategy, status, and evidence grade.

| Column | Content |
|---|---|
| Claim | The `claim` sentence, truncated at 120 chars |
| Strategy | Chip |
| Kind | `filter` / `weight` / `band` / `component` |
| Status | `Hypothesis` / `Tested` / `Held up` / `Failed` / `Superseded` |
| Evidence | Grade chip plus the citation counts: `strong · 3 supporting, 1 replication, 0 contradicting` |
| Updated | Relative date |

**Status and evidence grade are separate columns on purpose.** Status is process (has anyone tested it). Grade is strength (how much it survived). A finding can be `tested` with grade `none` — someone ran a test and it showed nothing — and that combination is the single most valuable row in the ledger, because it is the record that stops the same dead end being re-explored in six months.

**Seed the ledger with three rows at build time**, from `test_results.md`, so the tool ships with a worked example of what a good finding looks like rather than an empty table:

1. `Fast Mover hard filters mark higher-probability setups` — kind `filter`, status `held_up`, grade `moderate`. Claim: *Events where all six Fast Mover filters passed showed an 81.2% hit rate (26/32) versus 58.6% for earnings events generally and 36.6% for random days, across 8 distinct instruments, Sept 2024 to Sept 2026.* Grade is `moderate`, not `strong`, because n=32 and the window is one two-year regime.
2. `The Fast Mover 25-point score does not predict return size` — kind `component`, status `failed`, grade `strong`. Claim: *An invented 0-100 composite of the same inputs showed r² near zero against forward returns at all tested horizons.* Note field: *This test was run against a claim the platform does not make. Recorded so the same test is not repeated as if it were news; the platform's claim is about filters, not score magnitude.*
3. `A large earnings beat separates from a miss; a small beat does not` — kind `other`, status `tested`, grade `weak`. Claim: *Large beats (20%+) hit 75.0% (n=80) versus 45.7% for small beats (n=35) and 47.1% for misses (n=70).* Note: *Correlation only. Does not establish the short-covering mechanism the strategy describes.*

**Finding detail** — `/lab/findings/:id`. The claim, status, grade, every cited query as a clickable row with its verdict and n, the notes field, and a `Send to calibration` button. That button opens the existing `POST /api/admin/strategies/{key}/calibrate` form with the new cutoffs and `change_reason` prefilled as `Per finding #12: <title>` — prefilled, not submitted. The Lab produces evidence; a human still applies it, per `PROJECT_HANDOFF.md` section 4's rule that weight overrides are never automatic.

The button is disabled with an inline explanation when grade is `weak` or `none`: `Findings below "moderate" evidence cannot be sent to calibration. Run a replication on a different period first.`

### 5.7 Worked flow: the short-interest question

The motivating question: *did tightening the short-interest threshold in v3 improve hit rate for small-cap defense names?* Eight steps, no ad-hoc scripting.

1. `/lab` → Fast Mover card. Evidence line reads `Filters: tested, held up. Score: tested, no signal.` Click through.
2. **Versions tab.** v3's entry shows `Short interest floor 10% → 12%`, effective 2 Jun 2026, reason "Tightened SI floor to 12%". Click `Compare to previous`.
3. **Diff view.** One hard-filter change, no weight changes. The performance strip shows `No matched backtest yet` and offers `Run both versions on the same events`. Click it.
4. The tool opens the **Backtest tab** with both versions selected, one shared event set, and the universe unset. Set universe mode to `By filter`: industry `Defense`, market cap `$0–$1B`. Live line: `Matches 14 instruments, 61 events in the selected window.` Window: last 24 months.
5. Run. Result: v2 filters 54.5% (n=22, CI 32.2–75.6), v3 filters 61.5% (n=13, CI 31.6–86.1). Difference 7 points, CI on the difference crosses zero, adjusted p = 0.41. Verdict banner: **No signal** — `No relationship found. This is a real result — record it.` Warning: `13 events in the v3 group. Below the 30-event floor; this comparison cannot distinguish a 7-point improvement from noise.`
6. The operator now has the honest answer to the question as asked: **not enough defense small-caps cleared the tighter threshold to tell.** This is the answer in most real cases, and the tool's main job is to deliver it in one screen instead of after a week of spreadsheet work that ends in a number with no interval around it.
7. To go further, switch to the **Regression tab**, which prefills the hypothesis field from the backtest spec as an editable draft: *"Raising the short interest floor from 10% to 12% raises hit rate for defense names under $1B."* Add `short_interest_pct`, `log(float_shares)`, `days_to_catalyst` as independents; dependent `Did a big move happen?`. The events-per-variable counter reads `20.3 per variable` on the widened all-industry universe and `6.1` on defense-only, in `--neg`. The operator sees the trade-off before running: answer a narrow question with too little data, or a broader question that is not the question asked.
8. Either way, `Record as finding`. If the result was null, the finding is recorded with status `tested`, grade `none`, and claim *"Tightening the SI floor to 12% did not measurably change hit rate for defense small-caps; n too small to detect a 7-point difference."* That row is what stops the same question being re-asked from scratch next quarter.

---

## 6. Statistical guardrails

The design premise: this tool, by construction, invites an operator to try many combinations until one looks good. Every guardrail below exists to make that behavior visible and costly rather than free.

### 6.1 Sample-size floors

| Analysis | Floor | Behavior below floor |
|---|---|---|
| Rate comparison between two groups | 30 events per group | `severity: warn`, rate shown with CI, difference shown but the verdict cannot be better than `Suggestive` |
| Any group | 10 events | `severity: block`, group rate suppressed and rendered as `n=7 — too few to report a rate` |
| Logistic regression | 20 events per predictor (EPV) | Below 20: `warn`. Below 10: `block`, coefficients hidden behind an explicit `Show anyway (not readable as evidence)` link |
| OLS | 20 observations per predictor | Same two-tier structure |
| Distinct instruments in a group | 5 | `warn`: a rate from 3 tickers is a statement about 3 tickers |
| Max single-instrument share | 40% of group events | `warn` with the instrument named |

The 30-event rate floor comes from the actual working precedent: `test_results.md` reports n=32 for the filter-passing group and explicitly says the 81.2% figure should be read as "clearly above baseline", not to a decimal point. The floor encodes that judgement rather than leaving each operator to re-derive it.

The EPV-20 floor blocks rather than warns below 10 because a logistic regression with 5 events per predictor does not produce a weak result, it produces a confidently wrong one; the coefficient table looks identical either way. Hiding it behind a deliberate click is the difference.

**Confidence intervals are mandatory and never optional.** Every rate renders as `81.2% (CI 64.6–91.8)`. A rate without an interval is the main mechanism by which a small sample impersonates a finding, and making the interval a display toggle guarantees it gets toggled off.

### 6.2 Point-in-time discipline

Every input value used in a backtest or regression comes from `backtest_events.inputs_json`, which is populated as-of `event_date` with provenance. Three enforced rules:

1. **Vintage lag is applied, not ignored.** Short interest at an event on 2026-05-07 uses the most recent FINRA settlement date *on or before* 2026-05-07 minus the publication lag, not the settlement date nearest in time. Share count uses the SEC filing on file as of the event date. This is exactly what `test_results.md`'s method did (`Filed value nearest to, and on or before, each event date`), promoted from a script's discipline to a column constraint.
2. **Restatements never overwrite.** If a later filing restates a figure, a new `backtest_events` row is not written and the existing `inputs_json` is not updated. A backtest that uses restated data is measuring a strategy nobody could have run.
3. **Incomplete rows are excluded and counted, never imputed.** `data_complete = false` rows drop out of every analysis and appear in `provenance.exclusions` with their reason. The result header always shows `191 events, 7 excluded`. `PROJECT_HANDOFF.md` says a failed data source carries the last known value forward in *live scoring*; that behavior must not extend to backtesting, where carrying a stale value forward across an event window is fabrication. This difference is worth a comment in the batch job.

### 6.3 Multiple comparisons

The concrete risk: an operator tries twelve variable combinations, one comes back at p = 0.04, and it gets treated as a finding. At twelve independent tests the chance of at least one false positive at the 0.05 level is roughly 46%.

Three mechanisms, in increasing strength:

**Counting.** Every query writes to `lab_queries` before execution (section 3). The `family_key` groups related attempts. The count is displayed in three places: on the Run button (`test 4 in this line of inquiry`), in the result's `comparisons_context`, and on a persistent strip at the top of the Regression tab: `You have run 11 tests in this line of inquiry since 19 Sept. Adjusted significance threshold: p < 0.0045.`

**Adjustment.** Holm-Bonferroni across the family, applied to every reported p-value. Both raw and adjusted are shown, adjusted first and in the heavier type weight. Holm rather than plain Bonferroni because Bonferroni at 12 tests is severe enough that operators route around it; Holm is uniformly more powerful, controls the same family-wise error rate, and is ten lines of code. Benjamini-Hochberg is the wrong choice here because the operator is making a go/no-go decision on one hypothesis, not screening a list where a controlled false-discovery proportion is acceptable.

**Escalating friction.** At 5 tests in a family, an inline notice: `5 tests in this line of inquiry. At this count, one result at p < 0.05 is expected by chance alone even if nothing is related.` At 10, the `Record as finding` button on results in that family requires the operator to first tick a checkbox labeled `I understand this is test 11 in this family and the adjusted threshold is p < 0.0045`. Friction, not prohibition — sometimes eleven tests is the right thing to do, and a tool that forbids it gets worked around outside the tool, where nothing is counted at all.

**A new `family_key` does not reset the count if the dependent variable and universe are unchanged.** Server-side check on `POST /api/admin/lab/regression`: if a new family's spec matches an existing family on dependent variable and universe within 30 days, the response carries `warning: FAMILY_SPLIT` and the counter shows the combined total. Without this, the friction above is defeated by typing a new family name.

**"Matches" is defined precisely, not left to loose comparison, or the check above is trivially defeated.** Dependent variable matches if `dependent.key` and `dependent.hit_definition` (when present) are identical after JSON canonicalization — no tolerance, since there are only three dependent-variable choices and they are categorical. Universe matches if `universe.mode` is identical and, within that mode: for `filter`, `industry_keys` sets are identical, `instrument_group`/`theme_regex` are identical, and `market_cap_band` bounds are within 5% of each other on both ends (not exact equality, since two honestly-different questions can legitimately use $300M and $305M); for `named tickers`, the ticker sets overlap by 80% or more; for `filter pass/fail`, the mode value is identical. A universe change that trips none of these thresholds is treated as a genuinely new line of inquiry and does not need to defeat anything. The 5%/80% thresholds are stored as named constants in one place (`FAMILY_MATCH_CAP_TOLERANCE`, `FAMILY_MATCH_TICKER_OVERLAP`), not hardcoded inline, so they can be tightened later without hunting through the codebase.

### 6.4 The specific mistake, prevented specifically

The error recorded in `PROJECT_HANDOFF.md` and `test_results.md`: an invented 0-100 composite score was regression-tested against forward returns, found no relationship, and the result was initially read as evidence about the strategy. It was not, because the strategy's claim was about hard filters marking higher-probability setups, not about score magnitude predicting return size. The test was methodologically fine; it tested the wrong claim.

At the scale this tool enables, that error would go from one wasted analysis to a steady stream. Four specific defenses:

**1. Every analysis declares its claim kind.** The Regression builder's Step 3 dependent-variable choice is explicitly labeled with what it can and cannot support:

- `Did a big move happen?` → helper: `Tests a filter-style claim: does this setup mark higher-probability events?`
- `How big was the move?` → helper, `--warn`: `Tests a magnitude claim. The platform does not currently claim any score predicts return size. The Fast Mover score was tested this way and showed no relationship (finding #2). Confirm this is the claim you mean to test.`

Choosing `How big was the move?` renders an inline link to finding #2 before the run. The operator is not blocked; they are shown the prior result so a re-run is a deliberate replication rather than an accidental repeat.

**2. Composite variables are flagged as derived.** Any independent variable that is itself a function of other variables in the model (the strategy score, any sub-score, any index built in the builder) carries a `derived` chip and a warning at run time: `"score" is a weighted combination of 4 of the variables already in this model. A result on the composite is not additional evidence about its parts.` The builder will not let a composite and its own inputs into the same model without a `severity: warn` that is repeated in the result header.

**3. Filter claims and score claims are never averaged into one badge.** Section 5.1's evidence line reports them separately, permanently. `lab_findings.claim_kind` keeps them separate in the ledger. There is no strategy-level "quality score" anywhere in this tool, because such a number would be exactly the kind of invented composite that caused the original error.

**4. The `No signal` verdict is a recordable outcome, not a dead end.** Its banner includes the button `Record as finding` and copy: `A null result is worth recording. It stops this being re-tested as if it were an open question.` The corrected history of this project is one where a null result was recognized and acted on correctly; the tool makes that the path of least resistance.

### 6.5 What counts as a claim

`lab_findings.claim` must be falsifiable and must name its numbers. The creation form enforces three checks client-side and server-side, each with an inline error:

- Contains at least one digit. `A claim needs a number. "Short interest matters" cannot be checked later; "SI above 12% raised hit rate by 7 points (n=61)" can.`
- Contains a sample-size reference (`n=`, `events`, or `instruments`). `Say how much data this rests on.`
- Under 400 characters. `If it takes more than 400 characters, it is more than one claim. Split it.`

### 6.6 Evidence grades, computed not asserted

| Grade | Conditions, all required |
|---|---|
| `none` | Default. No completed supporting query, or every supporting query returned `No signal`. |
| `weak` | One supporting query, adjusted p < 0.05, or a rate difference whose CI excludes zero. No holdout, or holdout not passed. |
| `moderate` | Adjusted p < 0.05 with holdout passed, n at or above every section 6.1 floor, and 5 or more distinct instruments with no single instrument above 40% of events. |
| `strong` | Everything in `moderate`, plus at least one `replicates` citation from a query on a non-overlapping time window or a non-overlapping instrument set. |

Computed on every write to `lab_findings` or `lab_finding_queries` (section 4.5). An operator cannot set it directly. Reason: self-assessed confidence is the least reliable input in the entire system, and the whole value of the grade is that it means the same thing on every row.

`test_results.md`'s own Fast Mover result grades as `moderate`, not `strong`: n=32, 8 distinct instruments, max instrument share 25%, but one continuous two-year window with no replication on a disjoint period. Seed finding #1 must be entered at `moderate` so the ledger's very first row demonstrates that the project's best existing evidence is still short of the top grade. A tool whose seed data sits at the ceiling teaches operators the ceiling is easy to reach.

### 6.7 The synthetic-data banner

If any contributing event row was seeded rather than ingested, the entire result panel renders behind a `--warn` banner:

> **Synthetic data in this result.** 34 of 191 events use seeded values, not ingested source data. Numbers below cannot be cited as evidence and cannot be attached to a finding.

`Record as finding` is removed, not disabled, on such a result. `PROJECT_HANDOFF.md` records that a synthetic-data proxy backtest was a prior wrong turn; the defense is not a policy but a computed flag that cannot be forgotten. `BUILD_SPEC.md` build stage 3 explicitly permits synthetic seed scores so the Board has something to render — which means synthetic rows will exist in this database, making the flag load-bearing rather than hypothetical.

**A second, related but distinct flag: assumed version confidence (section 3, `scores.version_confidence`).** Synthetic data means the *values* are not real. Assumed version confidence means the values are real but the *filter/weight set that produced the score* cannot be confirmed for scores written before `strategy_versions` existed. Same visibility treatment, separate banner (they can both be true on the same result and both render):

> **N events rest on an assumed strategy version.** The exact filter or weight set in effect on these dates cannot be confirmed. Numbers below are not blocked, but a "which version was better" comparison including these events is only as reliable as that assumption.

Unlike the synthetic-data flag, this does not remove `Record as finding` — an assumed-version result can still be real evidence about *whether a filter works at all*, just not precise evidence about *which version of the filter*. The finding's `evidence_grade` computation (section 6.6) is not automatically capped by this flag; the operator's claim wording should reflect it (`claim_kind = 'filter'` findings that don't hinge on a specific version number are unaffected).

### 6.8 The permanent footer on every result

Rendered under every backtest and regression result, non-dismissible, small `--ink-muted` text:

> This measures whether a move happened, not its direction and not whether a trade would have been profitable. Results describe the instruments and period selected, not future market conditions.

Lifted almost verbatim from `test_results.md`'s limits section. It is under every result rather than in a help page because the moment an operator most needs it is the moment they are looking at a number they like.

---

## 7. Accessibility

Operator-only does not exempt the tool from the project's baseline; a single-operator tool used for hours at a time is precisely where these matter.

- **Keyboard-only operation, complete.** The regression builder is a form; every control is a native `<input>`, `<select>`, `<textarea>`, or `<button>`. No custom drag-and-drop variable picker — a drag-only variable ordering would be keyboard-inaccessible and buys nothing, since regression variable order is not meaningful.
- **No color-only encoding anywhere.** Diff rows carry `+`/`−` prefixes alongside `--pos`/`--neg`. Verdict banners carry a text label alongside their tint. Warning severity carries the words `Blocked` / `Warning` / `Note`. The events-per-variable bar shows its number, not just its color.
- **Results are a `<table>` with real `<th scope>`**, not a grid of `<div>`s. Coefficient tables get read correctly by a screen reader and copy-paste into a spreadsheet intact, which is the second most common thing an operator does with them.
- **Charts have a table.** Every chart (event density bar, hit-rate comparison) has a `Show as table` toggle rendering the same numbers. No chart is the only path to a value.
- **Live regions.** The events-per-variable counter and the universe match-count line are `aria-live="polite"`, so a screen-reader user hears the sample-size warning at the same moment a sighted user sees it.
- **Long-running runs announce completion** via `aria-live` and a title-bar change, since a 30-second run invites tab-switching.
- **Minimum 14px body text, 1.5 line height**, per the existing type scale. Data tables use the monospace face already specified in `PRODUCT_DESIGN.md`.
- **No flashing.** Loading states are a static skeleton or a determinate progress bar, not a pulsing animation.

---

## 8. Build order

### 8.1 Phase 1 — minimum genuinely useful version

The bar for "not a toy": an operator can answer a real question about Fast Mover with correct confidence intervals and honest warnings, and the answer is durable. The bar is not "has a regression engine".

**What ships in Phase 1:**

1. **Schema.** `strategy_versions` (with `hard_filters_json`), `scores.strategy_version_id`, `backtest_events`, `lab_queries`, `lab_findings`, `lab_finding_queries`, `strategies.score_evidence_note`.
2. **The `backtest_events` batch job.** Port `test_results.md`'s methodology out of its one-off script into `jobs/build_backtest_events.py`, run by the existing cron pattern. Source data already exists as `test_data/squeeze_events.json`, `short_interest.json`, `float_history.json`, `earnings_dates.json` — import those 191 events as the initial rows rather than re-deriving them, so Phase 1 opens with real, already-verified data instead of an empty table. This job is the single highest-value item in the whole document: every other feature is a view over it, and without it every screen is empty.
3. **Lab shell**: separate Vite entry, `require_admin` gate, nginx `auth_request`, dark surface, header chip.
4. **Screen: Input map** (section 5.2), including vintage lag, declared-vs-effective weights, and the score evidence note.
5. **Screen: Version history + diff** (section 5.3), without the performance comparison strip.
6. **Screen: Backtest** (sections 4.2, 5.5) — group rate comparison with confidence intervals, baselines, sample-size warnings, provenance and exclusion counts, the synthetic-data flag. **No regression.**
7. **Screen: Findings ledger** (section 5.6) with the three seeded findings and computed evidence grades.
8. **Guardrails: 6.1 (floors and CIs), 6.2 (point-in-time), 6.5 (claim format), 6.6 (grades), 6.7 (synthetic flag), 6.8 (footer).**

**Why this is useful without regression.** The section 5.7 worked flow reaches its real answer at step 5, using only a rate comparison with confidence intervals. `test_results.md`'s entire verified result is a rate comparison; no regression was needed to establish the project's one piece of real evidence. Two-proportion comparison with honest intervals and sample-size floors answers most operator questions correctly, and answers the rest with "not enough data", which is also correct. Regression's main marginal value is controlling for confounders, which requires more events per predictor than this dataset currently has for any strategy.

**Why regression is deliberately held back rather than shipped half-built.** A regression screen without the family counter, Holm adjustment, and holdout is worse than no regression screen, because it produces authoritative-looking coefficients with no defense against the failure mode in section 6.3. The guardrails are not polish on the regression feature; they are the feature.

**Phase 1 estimated surface:** 6 tables, 1 batch job, 8 endpoints, 4 screens.

### 8.2 Phase 2 — regression

1. Regression endpoint (4.3), logistic and OLS, cluster-robust SE by instrument, VIF, time-based holdout.
2. Regression builder screen (5.4), all eight steps including the mandatory hypothesis field.
3. Results panel verdict system (5.5), the five verdict states, plain-language coefficient reading, effect-size framing.
4. Multiple-comparisons machinery (6.3): family counting, Holm adjustment, escalating friction at 5 and 10, the family-split check.
5. Composite/derived-variable detection (6.4, defense 2).
6. Version diff performance comparison strip (5.3), which depends on matched backtest specs.
7. `Send to calibration` handoff (5.6).

### 8.3 Phase 3 — later, only if earned

- Additional `event_kind` coverage beyond earnings (FDA decisions, contract awards, S-3/424B filings) in `backtest_events`. Adds statistical power, and power is what everything above is currently short of.
- Cross-strategy comparison: does a name scoring Strong on two strategies simultaneously outperform either alone. High analytical value, high p-hacking surface, and meaningless until more than one strategy has resolved outcomes.
- Bootstrap confidence intervals for rate differences where the normal approximation is poor at small n.
- Scheduled re-runs: re-execute a finding's supporting queries monthly on newly resolved events and flag decay. This is the feature that would convert `moderate` grades into `strong` ones automatically, and it is the most valuable Phase 3 item.

### 8.4 Sequencing against `BUILD_SPEC.md` section 9

`BUILD_SPEC.md` section 8.3 sequences the Lab after subscriber stages 1-8 and after the Publish layer. That holds, with one carve-out repeated from section 8.3 because it is easy to lose: **the `strategy_versions` schema addition, including `hard_filters_json`, must land whenever the next calibration work happens, regardless of when the Lab's UI is built.** Version history recorded from day one is cheap; reconstructed after versions have drifted it is not reliably possible. The same applies to `backtest_events`: running its batch job from the moment there are resolved outcomes costs a cron entry and builds the dataset every Phase 1 screen depends on.

---

## 9. Open items requiring an operator decision

Three things this document does not decide, because each depends on judgement the spec cannot supply. Each has a stated default so a build is not blocked.

1. **Hit definition defaults per strategy — decided: per-strategy, not universal.** Fast Mover keeps 20% / 3x from `test_results.md`, since that is the definition its evidence was actually built on; changing it would invalidate the one real result the platform has. Each of the other four strategies gets its own hit definition matching its actual mechanic rather than inheriting Fast Mover's squeeze-shaped threshold — e.g. Monetary Shifts (rate/dollar beta, funding runway) is not a squeeze play and a 20%-in-five-days bar would likely undercount it working correctly, so its definition should be set when it has enough resolved outcomes to calibrate one, not borrowed from Fast Mover in the meantime. Until a strategy has its own definition, it ships with **no default hit definition at all** and the Backtest/Regression tabs show the same explicit empty state as the no-resolved-outcomes case (section 5's provisional-strategy empty state, Run button absent, not disabled) rather than silently reusing Fast Mover's numbers. `lab_queries.spec_json` still records whichever definition was used for the query, so a later change never silently invalidates a past finding.
2. **Whether `random_day` baseline events are generated for all 401 instruments or only those with resolved events.** Default: only instruments that have at least one non-random event, matching `test_results.md`'s construction (same 27 tickers, excluding days within 6 of an earnings date). Generating them universe-wide is more work and changes the baseline's meaning.
3. **Retention of `lab_queries`.** The table grows unbounded and the comparisons counter only needs a rolling window. Default: keep all rows indefinitely (it is small, and the audit value is real), count families over a rolling 90 days.
