-- 012: consent capture (DESIGN_V6 §6, §10). Which version of the terms a
-- user ticked and when; NULL until the one-time acknowledgement on /welcome.
-- Columns are named after the API fields on /api/me, so there is no mapping.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS accepted_terms_version TEXT,
    ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ;
