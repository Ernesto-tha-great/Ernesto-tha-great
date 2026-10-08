-- Works on SQLite 3.38+. For Postgres, see the note at the top of journeys.sql.
CREATE TABLE IF NOT EXISTS developers (
  id           TEXT PRIMARY KEY,
  signed_up_at TEXT NOT NULL            -- ISO 8601, UTC
);

CREATE TABLE IF NOT EXISTS api_calls (
  developer_id TEXT NOT NULL,
  at           TEXT NOT NULL,           -- ISO 8601, UTC
  method       TEXT NOT NULL,
  route        TEXT NOT NULL,           -- the route template, e.g. /v1/labels/:id
  status       INTEGER NOT NULL,
  key_mode     TEXT NOT NULL,           -- 'test' or 'live'
  sdk          TEXT                     -- e.g. 'parcel-node/2.1.0', from the User-Agent
);
CREATE INDEX IF NOT EXISTS api_calls_by_developer ON api_calls (developer_id, at);

CREATE TABLE IF NOT EXISTS nudges (
  developer_id TEXT NOT NULL,
  at           TEXT NOT NULL,
  kind         TEXT NOT NULL            -- 'email', 'in_app', 'devrel_dm', ...
);
CREATE INDEX IF NOT EXISTS nudges_by_developer ON nudges (developer_id, at);

-- Calls that prove nothing about building with the API.
CREATE TABLE IF NOT EXISTS excluded_routes (route TEXT PRIMARY KEY);
INSERT OR IGNORE INTO excluded_routes VALUES ('/v1/health'), ('/v1/me'), ('/v1/oauth/token');
