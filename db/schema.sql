CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    verified      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS tickers (
    id                 BIGSERIAL PRIMARY KEY,
    symbol             TEXT UNIQUE NOT NULL,
    last_refreshed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS snapshots (
    id         BIGSERIAL PRIMARY KEY,
    ticker_id  BIGINT NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    field      TEXT NOT NULL,
    value      TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'unknown',
    as_of      TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup ON snapshots (ticker_id, field, as_of DESC);