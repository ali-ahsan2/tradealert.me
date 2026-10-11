-- 013: the measured record gets a real source (DESIGN_V6 §8).
--
-- The published Fast Mover backtest (26 of 32 filter-passing events moved)
-- lived in four unsynchronised copies and in no column the API read, so the
-- plain card for the one calibrated strategy said "no measured record yet".
-- These columns hold the published figure and where it comes from. The live
-- path (calibration_outcomes) takes over once it holds at least 30 rows.
--
-- The same file retires the recipe from the `description` column: thresholds
-- and weights stay in strategy_versions for the Lab; the public description
-- is the plain one-liner. Guarded so an operator's later edit is kept.

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS record_hits INT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS record_n INT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS record_source TEXT NOT NULL DEFAULT '';

UPDATE strategies
   SET record_hits = 26, record_n = 32,
       record_source = 'test_results.md, Fast Mover backtest 2026-09-11'
 WHERE key = 'fast_mover' AND record_n IS NULL;

UPDATE strategies SET description = 'Small, tightly held names a crowd is betting against, with a date coming.'
 WHERE key = 'fast_mover' AND description LIKE '%Hard filters (%';
UPDATE strategies SET description = 'Names pulling ahead of their own sector, with volume behind the move.'
 WHERE key = 'market_shift' AND description LIKE '%Provisional: weights%';
UPDATE strategies SET description = 'Companies whose fortunes turn on government budgets, trade policy and supply chains.'
 WHERE key = 'geopolitics' AND description LIKE '%Provisional: weights%';
UPDATE strategies SET description = 'Names where the owners are moving: activists, insiders buying, deals in the air.'
 WHERE key = 'industry_restructure' AND description LIKE '%Provisional: weights%';
UPDATE strategies SET description = 'Names most exposed to rates and the dollar, timed to the central bank''s calendar.'
 WHERE key = 'monetary_shifts' AND description LIKE '%Provisional: weights%';

-- industries: the seed's jargon ("plays", "squeezes") becomes what is in it
UPDATE industries SET description = 'Chip makers, memory, optics and the equipment that feeds data centers.'
 WHERE key = 'semiconductors' AND description LIKE 'Chips, power semis, semi IP%';
UPDATE industries SET description = 'Defense electronics, munitions, drones, satellites and space infrastructure.'
 WHERE key = 'defense_space' AND description LIKE 'Defense electronics and munitions%';
UPDATE industries SET description = 'Quantum hardware and software, and other early computing companies.'
 WHERE key = 'quantum_compute' AND description LIKE '%emergent computing plays%';
UPDATE industries SET description = 'Drug developers, gene editing, dated regulator decisions and medical devices.'
 WHERE key = 'biotech_pharma' AND description LIKE '%PDUFA- dated plays%';
UPDATE industries SET description = 'Uranium and fuel enrichment, nuclear components, rare earths and critical minerals.'
 WHERE key = 'energy_nuclear' AND description LIKE 'Uranium and fuel enrichment, nuclear components, rare earths, and%';
UPDATE industries SET description = 'Energy storage, battery chemistry, solar and the grid.'
 WHERE key = 'battery_clean_energy' AND description LIKE '%grid decarbonization%';
UPDATE industries SET description = 'AI and analytics software, cloud infrastructure and data-center compute.'
 WHERE key = 'ai_software_data' AND description LIKE '%data-center compute demand%';
UPDATE industries SET description = 'Payments, digital banking and financial infrastructure in emerging markets.'
 WHERE key = 'fintech_payments' AND description LIKE '%emerging-market financial infrastructure%';
UPDATE industries SET description = 'Online retail, homebuilders, specialty retail and consumer discretionary names.'
 WHERE key = 'consumer_ecom' AND description LIKE 'E-commerce, homebuilders%';
UPDATE industries SET description = 'Social platforms, advertising technology, streaming and digital media.'
 WHERE key = 'media_adtech' AND description LIKE '%digital media squeezes%';
