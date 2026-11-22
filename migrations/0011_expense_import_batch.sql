ALTER TABLE expenses ADD COLUMN import_batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_expenses_owner_import_batch ON expenses (owner_id, import_batch_id);
