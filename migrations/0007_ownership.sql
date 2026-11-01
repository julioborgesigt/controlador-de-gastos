ALTER TABLE expenses ADD COLUMN owner_id TEXT;
ALTER TABLE cards ADD COLUMN owner_id TEXT;
ALTER TABLE income_extras ADD COLUMN owner_id TEXT;
ALTER TABLE months ADD COLUMN owner_id TEXT;
ALTER TABLE sessions ADD COLUMN scope_owner_id TEXT;

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, guest_id)
);
