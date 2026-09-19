-- ============================================================
-- 003_admin_flag.sql — admin surface (BUILD_SPEC section 4.5)
-- Adds the admin flag on users (no separate role system), used
-- to gate POST /api/admin/strategies/{key}/calibrate and any
-- operator-only endpoint. Idempotent.
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Under a fresh scaffold the operator board has no admin yet; the
-- deploy doc promotes one via: UPDATE users SET is_admin = TRUE
-- WHERE email = '...';