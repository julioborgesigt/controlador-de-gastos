ALTER TABLE months ADD COLUMN income_locked INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS income_extras (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  month_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
