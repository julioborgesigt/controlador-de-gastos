CREATE TABLE IF NOT EXISTS months (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  income_cents INTEGER NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  month_id TEXT NOT NULL,
  name TEXT NOT NULL,
  section TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment TEXT NOT NULL,
  on_card INTEGER NOT NULL DEFAULT 0,
  card_label TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  sort_order INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses (month_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
