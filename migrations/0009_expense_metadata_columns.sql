-- Migração estrutural (Onda 4): promove metadados internos de expenses.note
-- para colunas relacionais indexadas, eliminando varreduras LIKE '%...%' no D1.

ALTER TABLE expenses ADD COLUMN series_id TEXT;
ALTER TABLE expenses ADD COLUMN origin_expense_id TEXT;
ALTER TABLE expenses ADD COLUMN partial_id TEXT;
ALTER TABLE expenses ADD COLUMN track TEXT;
ALTER TABLE expenses ADD COLUMN cost_kind TEXT;
ALTER TABLE expenses ADD COLUMN invoice_shift TEXT NOT NULL DEFAULT 'mes';
ALTER TABLE expenses ADD COLUMN invoice_month_id TEXT;
ALTER TABLE expenses ADD COLUMN reference_month_id TEXT;
ALTER TABLE expenses ADD COLUMN purchase_date TEXT;
ALTER TABLE expenses ADD COLUMN finalized_zero INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_expenses_owner_origin ON expenses (owner_id, origin_expense_id);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_partial ON expenses (owner_id, partial_id);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_series ON expenses (owner_id, series_id);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_ref_month ON expenses (owner_id, reference_month_id);
