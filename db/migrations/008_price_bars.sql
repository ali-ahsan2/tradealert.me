-- Daily OHLCV history, the substrate every real backtest needs.
--
-- Keyed on ticker rather than instrument: a symbol has one price series, but
-- an instrument is (ticker x industry) and the same symbol appears under
-- several industries, which would store the same bars repeatedly.
--
-- Prices are split- and dividend-adjusted at write time from the source's
-- adjusted close, so a forward return never reads a split as a 400% move.
-- raw_close keeps the unadjusted value for reconciliation against a chart.

CREATE TABLE IF NOT EXISTS price_bars (
    ticker_id   BIGINT NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    d           DATE   NOT NULL,
    open        NUMERIC(14,4) NOT NULL,
    high        NUMERIC(14,4) NOT NULL,
    low         NUMERIC(14,4) NOT NULL,
    close       NUMERIC(14,4) NOT NULL,
    raw_close   NUMERIC(14,4),
    volume      BIGINT NOT NULL DEFAULT 0,
    source      TEXT   NOT NULL DEFAULT 'yahoo',
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ticker_id, d),
    CONSTRAINT chk_bar_sane CHECK (
        high >= low AND open > 0 AND close > 0 AND volume >= 0
    )
);

-- Range scans per symbol are the only access pattern: "bars for ticker X
-- between event_date and event_date + N".
CREATE INDEX IF NOT EXISTS idx_price_bars_ticker_date
    ON price_bars (ticker_id, d DESC);

-- Per-symbol record of the last successful pull and the last failure, so a
-- refresh can skip what is current and a silent outage is visible rather
-- than looking like a symbol with no history.
CREATE TABLE IF NOT EXISTS ingest_state (
    source        TEXT NOT NULL,
    ticker_id     BIGINT NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    last_ok_at    TIMESTAMPTZ,
    last_bar_date DATE,
    last_error    TEXT,
    last_error_at TIMESTAMPTZ,
    attempts      INT NOT NULL DEFAULT 0,
    PRIMARY KEY (source, ticker_id)
);
