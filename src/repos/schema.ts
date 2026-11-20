import seed from "../seed-data.json" with { type: "json" };
import { getSetting, setSetting } from "./core.ts";

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
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
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  month_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
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
`;

const readyByDb = new WeakMap<D1Database, Promise<void>>();

export function ensureReady(db: D1Database): Promise<void> {
  let pending = readyByDb.get(db);
  if (!pending) {
    pending = migrateAndSeed(db).catch((error: unknown) => {
      readyByDb.delete(db);
      throw error;
    });
    readyByDb.set(db, pending);
  }
  return pending;
}

async function migrateAndSeed(db: D1Database): Promise<void> {
  const statements = SCHEMA.split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((sql) => db.prepare(sql));
  await db.batch(statements);
  const columns = await db.prepare("PRAGMA table_info(expenses)").all<{ name: string }>();
  if (!(columns.results ?? []).some((column) => column.name === "installment")) {
    await db.prepare("ALTER TABLE expenses ADD COLUMN installment TEXT").run();
  }
  const monthColumns = await db.prepare("PRAGMA table_info(months)").all<{ name: string }>();
  if (!(monthColumns.results ?? []).some((column) => column.name === "income_locked")) {
    await db.prepare("ALTER TABLE months ADD COLUMN income_locked INTEGER NOT NULL DEFAULT 0").run();
  }
  const sessionColumns = await db.prepare("PRAGMA table_info(sessions)").all<{ name: string }>();
  if (!(sessionColumns.results ?? []).some((column) => column.name === "user_id")) {
    await db.prepare("ALTER TABLE sessions ADD COLUMN user_id TEXT").run();
  }

  const seeded = await db.prepare("SELECT value FROM settings WHERE key = 'seeded'").first<{ value: string }>();
  if (seeded?.value === "1") {
    await backfillIncomeLocks(db);
    await ensureOwnership(db);
    return;
  }

  const createdAt = "2026-11-01T00:00:00.000Z";
  const inserts: D1PreparedStatement[] = [];
  for (const month of seed.months) {
    inserts.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO months (id, label, income_cents, settled, sort_order) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(month.id, month.label, month.incomeCents, month.settled, month.sortOrder),
    );
  }
  for (const item of seed.items) {
    seed.months.forEach((month, index) => {
      const amount = item.amounts[index] ?? 0;
      const paid = month.settled === 1 && amount !== 0 ? 1 : 0;
      inserts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO expenses
              (id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, sort_order, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, 'sheet', ?)`,
          )
          .bind(
            `${item.key}:${month.id}`,
            month.id,
            item.name,
            item.section,
            amount,
            item.payment,
            item.cardLabel,
            paid,
            item.sortOrder,
            createdAt,
          ),
      );
    });
  }

  const chunk = 40;
  for (let index = 0; index < inserts.length; index += chunk) {
    await db.batch(inserts.slice(index, index + chunk));
  }
  await setSetting(db, "seeded", "1");
  await backfillIncomeLocks(db);
  await ensureOwnership(db);
}

async function backfillIncomeLocks(db: D1Database): Promise<void> {
  if ((await getSetting(db, "income_locked_backfill")) === "1") return;
  await db.prepare("UPDATE months SET income_locked = 1").run();
  await db
    .prepare(
      "UPDATE months SET sort_order = CAST(substr(id, 1, 4) AS INTEGER) * 12 + CAST(substr(id, 6, 2) AS INTEGER)",
    )
    .run();
  await setSetting(db, "income_locked_backfill", "1");
}

async function ensureColumn(db: D1Database, table: string, column: string, ddl: string): Promise<void> {
  const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!(columns.results ?? []).some((item) => item.name === column)) {
    await db.prepare(ddl).run();
  }
}

async function ensureOwnership(db: D1Database): Promise<void> {
  await ensureColumn(db, "expenses", "owner_id", "ALTER TABLE expenses ADD COLUMN owner_id TEXT");
  await ensureColumn(db, "cards", "owner_id", "ALTER TABLE cards ADD COLUMN owner_id TEXT");
  await ensureColumn(db, "income_extras", "owner_id", "ALTER TABLE income_extras ADD COLUMN owner_id TEXT");
  await ensureColumn(db, "months", "owner_id", "ALTER TABLE months ADD COLUMN owner_id TEXT");
  await ensureColumn(db, "sessions", "scope_owner_id", "ALTER TABLE sessions ADD COLUMN scope_owner_id TEXT");
  await ensureColumn(db, "cards", "due_day", "ALTER TABLE cards ADD COLUMN due_day INTEGER");
  await ensureColumn(db, "cards", "closing_day", "ALTER TABLE cards ADD COLUMN closing_day INTEGER");
  await db.batch([
    db.prepare("DROP INDEX IF EXISTS idx_cards_name"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_owner_name ON cards (owner_id, name COLLATE NOCASE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expenses_owner_month ON expenses (owner_id, month_id, sort_order)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_expenses_owner_section ON expenses (owner_id, section)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_income_extras_owner_month ON income_extras (owner_id, month_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges (expires_at)"),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, guest_id TEXT NOT NULL, permission TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (owner_id, guest_id))",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_shares_guest ON shares (guest_id)"),
  ]);

  if ((await getSetting(db, "ownership_v1")) === "1") return;

  const oldest = await db.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").first<{ id: string }>();
  const owner = oldest?.id ?? "legacy";
  await db.batch([
    db.prepare("UPDATE months SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner),
    db.prepare("UPDATE expenses SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner),
    db.prepare("UPDATE cards SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner),
    db.prepare("UPDATE income_extras SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner),
  ]);

  const table = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'months'").first<{ sql: string }>();
  if (!table?.sql.includes("PRIMARY KEY (owner_id, id)")) {
    await db.batch([
      db.prepare(
        `CREATE TABLE months_v2 (
          owner_id TEXT NOT NULL,
          id TEXT NOT NULL,
          label TEXT NOT NULL,
          income_cents INTEGER NOT NULL,
          settled INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL,
          income_locked INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (owner_id, id)
        )`,
      ),
      db.prepare(
        `INSERT INTO months_v2 (owner_id, id, label, income_cents, settled, sort_order, income_locked)
         SELECT owner_id, id, label, income_cents, settled, sort_order, COALESCE(income_locked, 0)
         FROM months WHERE owner_id IS NOT NULL AND owner_id != ''`,
      ),
      db.prepare("DROP TABLE months"),
      db.prepare("ALTER TABLE months_v2 RENAME TO months"),
    ]);
  }

  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_owner_name ON cards (owner_id, name COLLATE NOCASE)").run();
  const base = await getSetting(db, "base_income_cents");
  if (base !== null && oldest) await setSetting(db, `base_income_cents:${oldest.id}`, base);
  const users = await db.prepare("SELECT id FROM users").all<{ id: string }>();
  for (const user of users.results ?? []) {
    if (user.id !== oldest?.id) await provisionUser(db, user.id);
  }
  await setSetting(db, "ownership_v1", "1");
}

export async function provisionUser(db: D1Database, userId: string): Promise<void> {
  const existing = await db.prepare("SELECT id FROM months WHERE owner_id = ? LIMIT 1").bind(userId).first();
  if (existing) return;
  const inserts = seed.months.map((month) =>
    db
      .prepare(
        "INSERT INTO months (owner_id, id, label, income_cents, settled, sort_order, income_locked) VALUES (?, ?, ?, 0, 0, ?, 0)",
      )
      .bind(userId, month.id, month.label, month.sortOrder),
  );
  if (inserts.length) await db.batch(inserts);
}
