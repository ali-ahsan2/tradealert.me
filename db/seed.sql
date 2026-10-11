-- ============================================================
-- seed.sql — fixed product catalogs (BUILD_SPEC section 3/4)
-- tiers (PROJECT_HANDOFF section 7), strategies (with the
-- per-strategy band cutoffs from BUILD_SPEC 4.1), industries,
-- and the nine trigger keys (PROJECT_HANDOFF section 4).
--
-- Priced as of 2026-09-18. pricing.html and /api/entitlements
-- read these tables, so a price change is a SQL update, not a
-- deploy. Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- Tiers. industries_limit 999 = all industries (Investor).
-- alerts_limit NULL = unlimited; 0 = no alerts (Free).
-- ------------------------------------------------------------
INSERT INTO tiers (id, key, label, price_monthly_cents, industries_limit,
                   names_shown_limit, picks_limit, alerts_limit, channels, sort_order)
VALUES
  (1, 'free',     'Free',     0,    1,   5,   1,   0, '{email}',                                   1),
  (2, 'basic',    'Basic',    1000, 2,   10,  2,   3,   '{email,push}',                            2),
  (3, 'pro',      'Pro',      2900, 5,   50,  20,  NULL,'{email,push,sms}',                        3),
  (4, 'investor', 'Investor', 3900, 999, 100, 100, NULL,'{email,push,sms,webhook}',                4)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  industries_limit = EXCLUDED.industries_limit,
  names_shown_limit = EXCLUDED.names_shown_limit,
  picks_limit = EXCLUDED.picks_limit,
  alerts_limit = EXCLUDED.alerts_limit,
  channels = EXCLUDED.channels,
  sort_order = EXCLUDED.sort_order;

-- ------------------------------------------------------------
-- Strategies. Fast Mover is the only calibrated one (32
-- filter-passing events from the real backtest, PROJECT_HANDOFF
-- "What's been tested"). Its cutoffs are the 25-point scorecard's
-- A/B/pass thresholds scaled x4 to 0-100: strong >= 72 (A-setup,
-- >= 18/25), elevated >= 52 (B, 13-17), neutral >= 40 (pass,
-- 10-12), weak >= 25 (below 10); a hard-filter fail is flagged FAIL and
-- the name is still rated.
-- The other four ship provisional with evenly spaced placeholders
-- (BUILD_SPEC 4.1).
-- ------------------------------------------------------------
INSERT INTO strategies (id, key, label, monogram, calibrated, calibrated_at,
                        resolved_outcomes_count, description,
                        band_cutoffs_json, sort_order,
                        record_hits, record_n, record_source)
VALUES
  -- description is the plain one-liner (app/plain_copy.py); the recipe
  -- (filters, weights, cutoffs) lives in strategy_versions for the Lab.
  -- record_* is the published backtest, read until calibration_outcomes
  -- holds thirty rows.
  (1, 'fast_mover', 'Fast Mover', 'FM', TRUE, '2026-09-18T00:00:00Z', 32,
      'Small, tightly held names a crowd is betting against, with a date coming.',
      '{"strong": 72, "elevated": 52, "neutral": 40, "weak": 25}', 1,
      26, 32, 'test_results.md, Fast Mover backtest 2026-09-11'),
  (2, 'market_shift', 'Market Shift', 'MS', FALSE, NULL, 0,
      'Names pulling ahead of their own sector, with volume behind the move.',
      '{"strong": 75, "elevated": 50, "neutral": 25, "weak": 0}', 2,
      NULL, NULL, ''),
  (3, 'geopolitics', 'GeoPolitics', 'GP', FALSE, NULL, 0,
      'Companies whose fortunes turn on government budgets, trade policy and supply chains.',
      '{"strong": 75, "elevated": 50, "neutral": 25, "weak": 0}', 3,
      NULL, NULL, ''),
  (4, 'industry_restructure', 'Industry Restructure', 'IR', FALSE, NULL, 0,
      'Names where the owners are moving: activists, insiders buying, deals in the air.',
      '{"strong": 75, "elevated": 50, "neutral": 25, "weak": 0}', 4,
      NULL, NULL, ''),
  (5, 'monetary_shifts', 'Monetary Shifts', 'MN', FALSE, NULL, 0,
      'Names most exposed to rates and the dollar, timed to the central bank''s calendar.',
      '{"strong": 75, "elevated": 50, "neutral": 25, "weak": 0}', 5,
      NULL, NULL, '')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  monogram = EXCLUDED.monogram,
  calibrated = EXCLUDED.calibrated,
  calibrated_at = EXCLUDED.calibrated_at,
  resolved_outcomes_count = EXCLUDED.resolved_outcomes_count,
  description = EXCLUDED.description,
  band_cutoffs_json = EXCLUDED.band_cutoffs_json,
  sort_order = EXCLUDED.sort_order,
  record_hits = EXCLUDED.record_hits,
  record_n = EXCLUDED.record_n,
  record_source = EXCLUDED.record_source;

-- ------------------------------------------------------------
-- Industries. The ten names a subscriber follows. Derived from
-- the workbench universe's actual theme clusters; each names the
-- benchmark ETF used for relative-strength scoring. Keys/labels
-- are the editing surface -- these are seed data, not product --
-- and are tuned by the operator, not by a deploy.
-- ------------------------------------------------------------
INSERT INTO industries (id, key, label, benchmark_etf, description, sort_order)
VALUES
  (1,  'semiconductors',     'Semiconductors & Hardware', 'SMH',
      'Chip makers, memory, optics and the equipment that feeds data centers.', 1),
  (2,  'defense_space',      'Defense, Drones & Space',   'ITA',
      'Defense electronics, munitions, drones, satellites and space infrastructure.', 2),
  (3,  'quantum_compute',    'Quantum & Emerging Compute', 'QTUM',
      'Quantum hardware and software, and other early computing companies.', 3),
  (4,  'biotech_pharma',     'Biotech & Pharma',          'XBI',
      'Drug developers, gene editing, dated regulator decisions and medical devices.', 4),
  (5,  'energy_nuclear',     'Nuclear, Uranium & Critical Minerals', 'URA',
      'Uranium and fuel enrichment, nuclear components, rare earths and critical minerals.', 5),
  (6,  'battery_clean_energy', 'Battery & Clean Energy',  'TAN',
      'Energy storage, battery chemistry, solar and the grid.', 6),
  (7,  'ai_software_data',   'AI Software & Data Centers', 'IGV',
      'AI and analytics software, cloud infrastructure and data-center compute.', 7),
  (8,  'fintech_payments',   'Fintech & Payments',        'IPAY',
      'Payments, digital banking and financial infrastructure in emerging markets.', 8),
  (9,  'consumer_ecom',      'Consumer & E-commerce',     'XRT',
      'Online retail, homebuilders, specialty retail and consumer discretionary names.', 9),
  (10, 'media_adtech',       'Media, AdTech & Social',    'XLC',
      'Social platforms, advertising technology, streaming and digital media.', 10)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  benchmark_etf = EXCLUDED.benchmark_etf,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

-- ------------------------------------------------------------
-- Triggers. Nine keys (PROJECT_HANDOFF section 4). The guard
-- row count matches exactly; do not add keys here without a
-- matching application template.
-- ------------------------------------------------------------
INSERT INTO triggers (id, key, label, description)
VALUES
  (1, 'borrow_fee_2x',  'Borrow fee 2x+',
      'Borrow fee doubles or more versus its recent baseline; the daily short-tightening signal.'),
  (2, 'si_cross',       'Short interest crosses 10/15/20%',
      'A FINRA short-interest print moves the name across a 10%, 15%, or 20% threshold.'),
  (3, 'volume_3x',      'Volume at 3x+',
      'Daily volume prints above 3x the 20-day average; the ignition tell.'),
  (4, 'catalyst_dated', 'Catalyst dated',
      'A name gains a dated catalyst (earnings call, FDA action, contract) within the look-ahead.'),
  (5, 's3_424b',        'S-3 or 424B filing',
      'A dilution-risk filing lands on EDGAR; instant-disqualifier alert.'),
  (6, 'band_change',    'Band change',
      'A score crosses a band boundary between runs.'),
  (7, 'insider_buying', 'Insider buying',
      'A Form 4 cluster shows open-market buys after a period of sales.'),
  (8, 'social_surge',   'Social surge',
      '20+ messages in 24 hours on the social feed; a burst of crowd attention.'),
  (9, 'contract_award', 'Contract award',
      'A government or corporate contract award is announced with a dollar figure.')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;