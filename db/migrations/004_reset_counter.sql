-- Single-use password reset enforcement.
-- reset_counter is baked into each reset link at issuance; resetting the
-- password increments it, which kills the link that was used and every
-- sibling link issued before it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_counter BIGINT NOT NULL DEFAULT 0;