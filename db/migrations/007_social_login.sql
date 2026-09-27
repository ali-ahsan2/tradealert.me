-- ============================================================
-- 007_social_login.sql — OAuth sign-in identities
-- Social accounts have no local password (Google) or no email at
-- all (X free tier returns only the user id and handle). Email
-- and password_hash become nullable; provider + provider_id carry
-- the identity and stay unique across both login kinds. Idempotent.
-- ============================================================
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider
    ON users (provider, provider_id) WHERE provider IS NOT NULL;