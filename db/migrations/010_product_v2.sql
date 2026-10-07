-- Product v2 (subscriber surface): a private note on each pinned name, and a
-- partial index behind the unread-alert badge the navigation polls.
--
-- Notes are the one subscriber-authored text in the product. They are shown
-- only to their author, never scored, and never leave the account.

ALTER TABLE picks ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_unread
    ON alert_deliveries (user_id) WHERE read_at IS NULL;
