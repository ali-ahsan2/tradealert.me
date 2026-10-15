-- 015: fundamentals snapshots for Fast Mover's hard filters.
--
-- events_ingest.py writes real earnings/random_day events with inputs_json
-- = {}, so _evaluate_filters in app/lab.py always returns "unavailable" for
-- every real row and only the synthetic seed fixtures can ever pass. This
-- table holds the four fields Fast Mover's filters check (cap, float, short
-- interest, revenue growth) so a real value can be attached.
--
-- yfinance has no free historical point-in-time fundamentals, so this is a
-- current snapshot, not a value as-of each event's date. fetched_at records
-- when it was true. Honest tradeoff, documented rather than hidden: a stock
-- that was small-cap in 2024 and large-cap today gets today's cap applied
-- to its 2024 event. Real data, wrong date -- better than fabricated data,
-- no date, which is what the synthetic rows are.

CREATE TABLE IF NOT EXISTS fundamentals_snapshots (
    ticker_id        BIGINT PRIMARY KEY REFERENCES tickers(id) ON DELETE CASCADE,
    market_cap_usd   NUMERIC(20,2),
    float_shares     BIGINT,
    short_pct_float  NUMERIC(6,3),
    revenue_growth_pct NUMERIC(8,3),
    source           TEXT NOT NULL DEFAULT 'yahoo',
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
