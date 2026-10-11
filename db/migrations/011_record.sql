-- The record (v5): what fired, who was told, what moved after. The pulse and
-- the per-subscriber record scan alert_events by time and join deliveries by
-- (event, user); both get an index.

CREATE INDEX IF NOT EXISTS idx_alert_events_fired_at ON alert_events (fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_event_user ON alert_deliveries (alert_event_id, user_id);
