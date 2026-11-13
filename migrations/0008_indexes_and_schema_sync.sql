CREATE TABLE IF NOT EXISTS partial_payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment TEXT NOT NULL,
  card_label TEXT,
  installment TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partial_payments_expense ON partial_payments (owner_id, expense_id);

DROP INDEX IF EXISTS idx_cards_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_owner_name ON cards (owner_id, name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_expenses_owner_month ON expenses (owner_id, month_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_section ON expenses (owner_id, section);
CREATE INDEX IF NOT EXISTS idx_income_extras_owner_month ON income_extras (owner_id, month_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_guest ON shares (guest_id);
