import { EXPENSE_META_SET_SQL, expenseMetaParams, getSetting, runStatements, setSetting } from "./core.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS months (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  income_cents INTEGER NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  income_locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  month_id TEXT NOT NULL,
  name TEXT NOT NULL,
  section TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment TEXT NOT NULL,
  on_card INTEGER NOT NULL DEFAULT 0,
  card_label TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  installment TEXT,
  sort_order INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  series_id TEXT,
  origin_expense_id TEXT,
  partial_id TEXT,
  track TEXT,
  cost_kind TEXT,
  invoice_shift TEXT NOT NULL DEFAULT 'mes',
  invoice_month_id TEXT,
  reference_month_id TEXT,
  purchase_date TEXT,
  finalized_zero INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses (month_id);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_month ON expenses (owner_id, month_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_section ON expenses (owner_id, section);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  scope_owner_id TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  due_day INTEGER,
  closing_day INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_owner_name ON cards (owner_id, name COLLATE NOCASE);
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
CREATE TABLE IF NOT EXISTS income_extras (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  month_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_income_extras_owner_month ON income_extras (owner_id, month_id);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  cpf TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (user_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  challenge TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges (expires_at);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, guest_id)
);
CREATE INDEX IF NOT EXISTS idx_shares_guest ON shares (guest_id);
`;

const METADATA_COLUMNS: ReadonlyArray<[string, string]> = [
  ["series_id", "ALTER TABLE expenses ADD COLUMN series_id TEXT"],
  ["origin_expense_id", "ALTER TABLE expenses ADD COLUMN origin_expense_id TEXT"],
  ["partial_id", "ALTER TABLE expenses ADD COLUMN partial_id TEXT"],
  ["track", "ALTER TABLE expenses ADD COLUMN track TEXT"],
  ["cost_kind", "ALTER TABLE expenses ADD COLUMN cost_kind TEXT"],
  ["invoice_shift", "ALTER TABLE expenses ADD COLUMN invoice_shift TEXT NOT NULL DEFAULT 'mes'"],
  ["invoice_month_id", "ALTER TABLE expenses ADD COLUMN invoice_month_id TEXT"],
  ["reference_month_id", "ALTER TABLE expenses ADD COLUMN reference_month_id TEXT"],
  ["purchase_date", "ALTER TABLE expenses ADD COLUMN purchase_date TEXT"],
  ["finalized_zero", "ALTER TABLE expenses ADD COLUMN finalized_zero INTEGER NOT NULL DEFAULT 0"],
];

const readyByDb = new WeakMap<D1Database, Promise<void>>();

export function ensureReady(db: D1Database): Promise<void> {
  let pending = readyByDb.get(db);
  if (!pending) {
    pending = initializeSchema(db).catch((error: unknown) => {
      readyByDb.delete(db);
      throw error;
    });
    readyByDb.set(db, pending);
  }
  return pending;
}

async function initializeSchema(db: D1Database): Promise<void> {
  const statements = SCHEMA.split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((sql) => db.prepare(sql));
  await db.batch(statements);

  if ((await getSetting(db, "expense_meta_v1")) === "1") return;

  const existing = await db.prepare("PRAGMA table_info(expenses)").all<{ name: string }>();
  const existingNames = new Set((existing.results ?? []).map((column) => column.name));
  for (const [name, ddl] of METADATA_COLUMNS) {
    if (!existingNames.has(name)) {
      await db.prepare(ddl).run();
    }
  }

  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expenses_owner_origin ON expenses (owner_id, origin_expense_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expenses_owner_partial ON expenses (owner_id, partial_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expenses_owner_series ON expenses (owner_id, series_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expenses_owner_ref_month ON expenses (owner_id, reference_month_id)"),
  ]);

  await backfillExpenseMetadata(db);
  await setSetting(db, "expense_meta_v1", "1");
}

export async function backfillExpenseMetadata(db: D1Database): Promise<number> {
  const rows = await db
    .prepare("SELECT id, section, note FROM expenses WHERE note IS NOT NULL AND note != ''")
    .all<{ id: string; section: string; note: string }>();
  const list = rows.results ?? [];
  if (!list.length) return 0;
  const updates = list.map((row) =>
    db
      .prepare(`UPDATE expenses SET ${EXPENSE_META_SET_SQL} WHERE id = ?`)
      .bind(...expenseMetaParams(row.section, row.note), row.id),
  );
  await runStatements(db, updates);
  return list.length;
}
