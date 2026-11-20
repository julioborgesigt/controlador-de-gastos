ALTER TABLE expenses ADD COLUMN import_key TEXT;
CREATE INDEX IF NOT EXISTS idx_expenses_owner_import_key ON expenses (owner_id, import_key);
