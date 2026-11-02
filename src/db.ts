import seed from "./seed-data.json";
import type { Expense, Payment, Section } from "./domain.ts";
import { formatCpf } from "./auth.ts";
import { carryForward, cardKey, computeTotals, expenseCountForCard, listMonthRange, monthLabel, monthSortOrder, planCardPurchase, previousMonthId, resetTargets } from "./domain.ts";

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

type MonthRow = {
  id: string;
  label: string;
  income_cents: number;
  settled: number;
  sort_order: number;
  income_locked: number;
};

export type IncomeExtra = {
  id: string;
  kind: "ir" | "thirteenth" | "vacation" | "other";
  name: string;
  amountCents: number;
  monthId: string;
};

type ExpenseRow = {
  id: string;
  month_id: string;
  name: string;
  section: string;
  amount_cents: number;
  payment: string;
  on_card: number;
  card_label: string | null;
  paid: number;
  note: string | null;
  installment: string | null;
  sort_order: number;
  source: string;
};

let ready: Promise<void> | null = null;

export function ensureReady(db: D1Database): Promise<void> {
  if (!ready) {
    ready = migrateAndSeed(db).catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
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
  await db.prepare("DROP INDEX IF EXISTS idx_cards_name").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_owner_name ON cards (owner_id, name COLLATE NOCASE)").run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, guest_id TEXT NOT NULL, permission TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (owner_id, guest_id))",
  ).run();

  if ((await getSetting(db, "ownership_v1")) === "1") return;

  const oldest = await db.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").first<{ id: string }>();
  const owner = oldest?.id ?? "legacy";
  await db.prepare("UPDATE months SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner).run();
  await db.prepare("UPDATE expenses SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner).run();
  await db.prepare("UPDATE cards SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner).run();
  await db.prepare("UPDATE income_extras SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''").bind(owner).run();

  const table = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'months'").first<{ sql: string }>();
  if (!table?.sql.includes("PRIMARY KEY (owner_id, id)")) {
    await db.prepare(
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
    ).run();
    await db.prepare(
      `INSERT INTO months_v2 (owner_id, id, label, income_cents, settled, sort_order, income_locked)
       SELECT owner_id, id, label, income_cents, settled, sort_order, COALESCE(income_locked, 0)
       FROM months WHERE owner_id IS NOT NULL AND owner_id != ''`,
    ).run();
    await db.prepare("DROP TABLE months").run();
    await db.prepare("ALTER TABLE months_v2 RENAME TO months").run();
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

export type Account = {
  id: string;
  cpf: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function findUserByCpf(db: D1Database, cpf: string): Promise<Account | null> {
  const row = await db
    .prepare("SELECT id, cpf, email, password_hash, password_salt FROM users WHERE cpf = ?")
    .bind(cpf)
    .first<{ id: string; cpf: string; email: string; password_hash: string; password_salt: string }>();
  return row ? mapAccount(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<Account | null> {
  const row = await db
    .prepare("SELECT id, cpf, email, password_hash, password_salt FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; cpf: string; email: string; password_hash: string; password_salt: string }>();
  return row ? mapAccount(row) : null;
}

export async function findUserById(db: D1Database, id: string): Promise<Account | null> {
  const row = await db
    .prepare("SELECT id, cpf, email, password_hash, password_salt FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: string; cpf: string; email: string; password_hash: string; password_salt: string }>();
  return row ? mapAccount(row) : null;
}

export async function createUser(
  db: D1Database,
  input: { cpf: string; email: string; passwordHash: string; passwordSalt: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (await findUserByCpf(db, input.cpf)) return { ok: false, error: "Já existe uma conta com este CPF." };
  if (await findUserByEmail(db, input.email)) return { ok: false, error: "Já existe uma conta com este e-mail." };
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        "INSERT INTO users (id, cpf, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(id, input.cpf, input.email, input.passwordHash, input.passwordSalt, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe uma conta com este CPF ou e-mail." };
    throw error;
  }
  return { ok: true, id };
}

export async function updatePassword(
  db: D1Database,
  userId: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(passwordHash, passwordSalt, userId)
    .run();
}

export type PasskeyRecord = {
  id: string;
  userId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  createdAt: string;
};

export async function listPasskeys(db: D1Database, userId: string): Promise<PasskeyRecord[]> {
  const result = await db
    .prepare("SELECT id, user_id, public_key, counter, transports, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at")
    .bind(userId)
    .all<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null; created_at: string }>();
  return (result.results ?? []).map(mapPasskey);
}

export async function getPasskey(db: D1Database, id: string): Promise<PasskeyRecord | null> {
  const row = await db
    .prepare("SELECT id, user_id, public_key, counter, transports, created_at FROM passkeys WHERE id = ?")
    .bind(id)
    .first<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null; created_at: string }>();
  return row ? mapPasskey(row) : null;
}

export async function countPasskeys(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertPasskey(
  db: D1Database,
  input: { id: string; userId: string; publicKey: string; counter: number; transports: string[] },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO passkeys (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(input.id, input.userId, input.publicKey, input.counter, input.transports.join(","), new Date().toISOString())
    .run();
}

export async function updatePasskeyCounter(db: D1Database, id: string, counter: number): Promise<void> {
  await db.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(counter, id).run();
}

export async function deletePasskey(db: D1Database, id: string, userId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteUserPasskeys(db: D1Database, userId: string): Promise<number> {
  const count = await countPasskeys(db, userId);
  if (count > 0) await db.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(userId).run();
  return count;
}

export async function savePasskeyChallenge(
  db: D1Database,
  input: { userId: string | null; challenge: string; kind: "register" | "login" },
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare("DELETE FROM passkey_challenges WHERE expires_at < ?").bind(now).run();
  await db
    .prepare("INSERT INTO passkey_challenges (id, user_id, challenge, kind, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), input.userId, input.challenge, input.kind, new Date(Date.now() + 5 * 60 * 1000).toISOString())
    .run();
}

export async function matchPasskeyChallenge(
  db: D1Database,
  challenge: string,
  kind: "register" | "login",
  userId?: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT id, user_id, expires_at FROM passkey_challenges WHERE challenge = ? AND kind = ?")
    .bind(challenge, kind)
    .first<{ id: string; user_id: string | null; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return false;
  if (userId && row.user_id !== userId) return false;
  await db.prepare("DELETE FROM passkey_challenges WHERE id = ?").bind(row.id).run();
  return true;
}

function mapPasskey(row: {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: string;
}): PasskeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: row.transports ? row.transports.split(",").filter(Boolean) : [],
    createdAt: row.created_at,
  };
}

function mapAccount(row: { id: string; cpf: string; email: string; password_hash: string; password_salt: string }): Account {
  return {
    id: row.id,
    cpf: row.cpf,
    email: row.email,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
  };
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function listMonths(db: D1Database, ownerId: string): Promise<Array<{ id: string; label: string; settled: boolean; sortOrder: number; incomeCents: number; incomeLocked: boolean }>> {
  const result = await db
    .prepare("SELECT id, label, income_cents, settled, sort_order, income_locked FROM months WHERE owner_id = ? ORDER BY sort_order")
    .bind(ownerId)
    .all<MonthRow>();
  return (result.results ?? []).map((month) => ({
    id: month.id,
    label: month.label,
    settled: month.settled === 1,
    sortOrder: month.sort_order,
    incomeCents: month.income_cents,
    incomeLocked: month.income_locked === 1,
  }));
}

export async function getMonth(db: D1Database, ownerId: string, monthId: string): Promise<MonthRow | null> {
  return db
    .prepare("SELECT id, label, income_cents, settled, sort_order, income_locked FROM months WHERE owner_id = ? AND id = ?")
    .bind(ownerId, monthId)
    .first<MonthRow>();
}

export async function listIncomeExtras(db: D1Database, ownerId: string): Promise<IncomeExtra[]> {
  const result = await db
    .prepare("SELECT id, kind, name, amount_cents, month_id FROM income_extras WHERE owner_id = ? ORDER BY month_id, name")
    .bind(ownerId)
    .all<{ id: string; kind: IncomeExtra["kind"]; name: string; amount_cents: number; month_id: string }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    amountCents: row.amount_cents,
    monthId: row.month_id,
  }));
}

export async function listExpenses(db: D1Database, ownerId: string, monthId: string): Promise<Expense[]> {
  const result = await db
    .prepare("SELECT * FROM expenses WHERE owner_id = ? AND month_id = ? ORDER BY sort_order, name")
    .bind(ownerId, monthId)
    .all<ExpenseRow>();
  return (result.results ?? []).map(mapExpense);
}

export async function getExpense(db: D1Database, ownerId: string, id: string): Promise<Expense | null> {
  const row = await db.prepare("SELECT * FROM expenses WHERE owner_id = ? AND id = ?").bind(ownerId, id).first<ExpenseRow>();
  return row ? mapExpense(row) : null;
}

export function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    monthId: row.month_id,
    name: row.name,
    section: row.section as Section,
    amountCents: row.amount_cents,
    payment: row.payment as Payment,
    onCard: row.on_card === 1,
    cardLabel: row.card_label,
    paid: row.paid === 1,
    note: row.note,
    installment: row.installment ?? null,
    sortOrder: row.sort_order,
    source: row.source === "user" ? "user" : "sheet",
  };
}

export type CardAccount = { id: string; name: string; sortOrder: number; expenseCount: number; dueDay: number | null };

export async function listCards(db: D1Database, ownerId: string): Promise<CardAccount[]> {
  const result = await db
    .prepare("SELECT id, name, sort_order, due_day FROM cards WHERE owner_id = ? ORDER BY sort_order, name")
    .bind(ownerId)
    .all<{
      id: string;
      name: string;
      sort_order: number;
      due_day: number | null;
    }>();
  const labels = await cardLabelCounts(db, ownerId);
  return (result.results ?? []).map((card) => ({
    id: card.id,
    name: card.name,
    sortOrder: card.sort_order,
    dueDay: card.due_day ?? null,
    expenseCount: expenseCountForCard(labels, card.name),
  }));
}

async function cardLabelCounts(db: D1Database, ownerId: string): Promise<Array<{ label: string | null; count: number }>> {
  const result = await db
    .prepare("SELECT card_label AS label, COUNT(*) AS count FROM expenses WHERE owner_id = ? AND card_label IS NOT NULL GROUP BY card_label")
    .bind(ownerId)
    .all<{ label: string | null; count: number }>();
  return result.results ?? [];
}

export async function renameCard(
  db: D1Database,
  ownerId: string,
  cardId: string,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  const current = cards.find((card) => card.id === cardId);
  if (!current) return { ok: false, error: "Cartão não encontrado." };
  const key = cardKey(name);
  if (key && cards.some((card) => card.id !== cardId && cardKey(card.name) === key)) {
    return { ok: false, error: "Já existe um cartão com esse nome." };
  }
  if (current.name === name) return { ok: true };
  try {
    await db.prepare("UPDATE cards SET name = ? WHERE owner_id = ? AND id = ?").bind(name, ownerId, cardId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe um cartão com esse nome." };
    throw error;
  }
  const labels = await cardLabelCounts(db, ownerId);
  for (const item of labels) {
    if (cardKey(item.label) !== cardKey(current.name) || !item.label || item.label === name) continue;
    await db.prepare("UPDATE expenses SET card_label = ? WHERE owner_id = ? AND card_label = ?").bind(name, ownerId, item.label).run();
  }
  return { ok: true };
}

export async function deleteCard(
  db: D1Database,
  ownerId: string,
  cardId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  const current = cards.find((card) => card.id === cardId);
  if (!current) return { ok: false, error: "Cartão não encontrado." };
  if (current.expenseCount > 0) {
    return { ok: false, error: "Este cartão tem gastos lançados. A exclusão só fica disponível quando não houver nenhum." };
  }
  await db.prepare("DELETE FROM cards WHERE owner_id = ? AND id = ?").bind(ownerId, cardId).run();
  return { ok: true };
}

export async function setCardDueDay(
  db: D1Database,
  ownerId: string,
  cardId: string,
  dueDay: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  if (!cards.some((card) => card.id === cardId)) return { ok: false, error: "Cartão não encontrado." };
  await db.prepare("UPDATE cards SET due_day = ? WHERE owner_id = ? AND id = ?").bind(dueDay, ownerId, cardId).run();
  return { ok: true };
}

export async function getTheme(db: D1Database, ownerId: string): Promise<"light" | "dark"> {
  return (await getSetting(db, themeKey(ownerId))) === "dark" ? "dark" : "light";
}

export async function setTheme(db: D1Database, ownerId: string, theme: "light" | "dark"): Promise<void> {
  await setSetting(db, themeKey(ownerId), theme);
}

function themeKey(ownerId: string): string {
  return `theme:${ownerId}`;
}

export async function createCard(
  db: D1Database,
  ownerId: string,
  name: string,
  dueDay: number | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  const key = cardKey(name);
  if (key && cards.some((card) => cardKey(card.name) === key)) {
    return { ok: false, error: "Já existe um cartão com esse nome." };
  }
  const sortOrder = cards.reduce((max, card) => Math.max(max, card.sortOrder), -1) + 1;
  try {
    await db
      .prepare("INSERT INTO cards (id, owner_id, name, sort_order, due_day, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), ownerId, name, sortOrder, dueDay, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe um cartão com esse nome." };
    throw error;
  }
  return { ok: true };
}

export async function monthPayload(db: D1Database, ownerId: string, monthId: string) {
  const month = await getMonth(db, ownerId, monthId);
  if (!month) return null;
  const expenses = await listExpenses(db, ownerId, monthId);
  const cards = await listCards(db, ownerId);
  const incomeExtras = await listIncomeExtras(db, ownerId);
  const extraIncomeCents = incomeExtras
    .filter((extra) => extra.monthId === monthId)
    .reduce((sum, extra) => sum + extra.amountCents, 0);
  const incomeCents = month.income_cents + extraIncomeCents;
  const totals = computeTotals(expenses, incomeCents);
  const settled = totals.remainingCents === 0 && totals.commitmentsCents > 0;
  if (settled !== (month.settled === 1)) {
    await db.prepare("UPDATE months SET settled = ? WHERE owner_id = ? AND id = ?").bind(settled ? 1 : 0, ownerId, monthId).run();
  }
  const months = await listMonths(db, ownerId);
  const baseIncome = await getSetting(db, baseIncomeKey(ownerId));
  return {
    month: {
      id: month.id,
      label: month.label,
      baseIncomeCents: month.income_cents,
      extraIncomeCents,
      incomeCents,
      incomeLocked: month.income_locked === 1,
      settled,
      sortOrder: month.sort_order,
    },
    months: months.map((item) => ({ ...item, settled: item.id === monthId ? settled : item.settled })),
    expenses,
    cards,
    incomeExtras,
    baseIncomeCents: baseIncome === null ? null : Number(baseIncome),
    totals,
    theme: await getTheme(db, ownerId),
  };
}

export async function syncSettled(db: D1Database, ownerId: string, monthId: string): Promise<void> {
  await monthPayload(db, ownerId, monthId);
}

export async function copyFromPreviousMonth(db: D1Database, ownerId: string, monthId: string): Promise<number> {
  const sourceMonth = previousMonthId(monthId);
  if (!sourceMonth) return 0;
  const source = await listExpenses(db, ownerId, sourceMonth);
  const destination = await listExpenses(db, ownerId, monthId);
  const taken = new Set(destination.map((expense) => `${expense.section}|${expense.name.toLowerCase()}`));
  const nextSort = destination.reduce((max, expense) => Math.max(max, expense.sortOrder), 0);
  const createdAt = new Date().toISOString();
  const inserts: D1PreparedStatement[] = [];
  for (const expense of source) {
    const carried = carryForward(expense);
    if (!carried) continue;
    const key = `${carried.section}|${carried.name.toLowerCase()}`;
    if (taken.has(key)) continue;
    taken.add(key);
    inserts.push(
      db
        .prepare(
          `INSERT INTO expenses
            (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'user', ?)`,
        )
        .bind(
          crypto.randomUUID(),
          ownerId,
          monthId,
          carried.name,
          carried.section,
          carried.amountCents,
          carried.payment,
          carried.onCard ? 1 : 0,
          carried.cardLabel,
          carried.note,
          carried.installment,
          nextSort + inserts.length + 1,
          createdAt,
        ),
    );
  }
  if (inserts.length) await db.batch(inserts);
  return inserts.length;
}

export async function ensureMonth(db: D1Database, ownerId: string, monthId: string): Promise<void> {
  const existing = await getMonth(db, ownerId, monthId);
  if (existing) return;
  const base = await getSetting(db, baseIncomeKey(ownerId));
  const income = base === null ? 0 : Number(base);
  await db
    .prepare(
      "INSERT INTO months (owner_id, id, label, income_cents, settled, sort_order, income_locked) VALUES (?, ?, ?, ?, 0, ?, 0)",
    )
    .bind(ownerId, monthId, monthLabel(monthId), Number.isFinite(income) ? income : 0, monthSortOrder(monthId))
    .run();
}

function baseIncomeKey(ownerId: string): string {
  return `base_income_cents:${ownerId}`;
}

export async function setManagedPeriod(
  db: D1Database,
  ownerId: string,
  startMonthId: string,
  endMonthId: string,
): Promise<{ ok: true; startMonthId: string } | { ok: false; error: string }> {
  const range = listMonthRange(startMonthId, endMonthId);
  if (!range.ok) return range;
  const existing = await listMonths(db, ownerId);
  const keep = new Set(range.months);
  for (const month of existing) {
    if (keep.has(month.id)) continue;
    const expenses = await db
      .prepare("SELECT COUNT(*) AS n FROM expenses WHERE owner_id = ? AND month_id = ?")
      .bind(ownerId, month.id)
      .first<{ n: number }>();
    const extras = await db
      .prepare("SELECT COUNT(*) AS n FROM income_extras WHERE owner_id = ? AND month_id = ?")
      .bind(ownerId, month.id)
      .first<{ n: number }>();
    if (Number(expenses?.n) > 0 || Number(extras?.n) > 0 || month.incomeLocked) {
      return { ok: false, error: `Há dados em ${month.label}. Apague esses dados antes de tirar o mês do período.` };
    }
  }
  for (const month of existing) {
    if (keep.has(month.id)) continue;
    await db.prepare("DELETE FROM expenses WHERE owner_id = ? AND month_id = ?").bind(ownerId, month.id).run();
    await db.prepare("DELETE FROM income_extras WHERE owner_id = ? AND month_id = ?").bind(ownerId, month.id).run();
    await db.prepare("DELETE FROM months WHERE owner_id = ? AND id = ?").bind(ownerId, month.id).run();
  }
  for (const monthId of range.months) await ensureMonth(db, ownerId, monthId);
  return { ok: true, startMonthId: range.months[0] };
}

export async function resetOwnerData(
  db: D1Database,
  ownerId: string,
  input: { scope: string; year?: number; monthId?: string },
): Promise<{ ok: true; ids: string[]; wiped?: boolean } | { ok: false; error: string }> {
  if (input.scope === "all") {
    await db.prepare("DELETE FROM expenses WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM income_extras WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM months WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM cards WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM settings WHERE key = ? OR key = ?").bind(baseIncomeKey(ownerId), themeKey(ownerId)).run();
    return { ok: true, ids: [], wiped: true };
  }
  const months = await listMonths(db, ownerId);
  const targets = resetTargets(months.map((month) => month.id), input);
  if (!targets.ok) return targets;
  const base = await getSetting(db, baseIncomeKey(ownerId));
  const income = base === null ? 0 : Number(base);
  const incomeCents = Number.isFinite(income) ? income : 0;
  for (const monthId of targets.ids) {
    await db.prepare("DELETE FROM expenses WHERE owner_id = ? AND month_id = ?").bind(ownerId, monthId).run();
    await db.prepare("DELETE FROM income_extras WHERE owner_id = ? AND month_id = ?").bind(ownerId, monthId).run();
    await db
      .prepare("UPDATE months SET income_cents = ?, income_locked = 0, settled = 0 WHERE owner_id = ? AND id = ?")
      .bind(incomeCents, ownerId, monthId)
      .run();
  }
  return { ok: true, ids: targets.ids };
}

export async function insertCardPurchase(
  db: D1Database,
  input: {
    ownerId: string;
    startMonthId: string;
    name: string;
    section: Section;
    payment: Payment;
    cardLabel: string | null;
    note: string | null;
    totalCount: number;
    paidCount: number;
    amountCents: number;
    mode: "installment" | "total";
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = planCardPurchase(input);
  if (!plan.ok) return plan;
  const createdAt = new Date().toISOString();
  for (const part of plan.plan.schedule) {
    await ensureMonth(db, input.ownerId, part.monthId);
  }
  const inserts: D1PreparedStatement[] = [];
  for (const part of plan.plan.schedule) {
    const sort = await db
      .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM expenses WHERE owner_id = ? AND month_id = ?")
      .bind(input.ownerId, part.monthId)
      .first<{ next: number }>();
    inserts.push(
      db
        .prepare(
          `INSERT INTO expenses
            (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'card', 0, ?, 0, ?, ?, ?, 'user', ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.ownerId,
          part.monthId,
          input.name,
          input.section === "fixed" ? "card" : input.section,
          part.amountCents,
          input.cardLabel,
          input.note,
          part.installment,
          sort?.next ?? 1000,
          createdAt,
        ),
    );
  }
  if (inserts.length) await db.batch(inserts);
  return { ok: true };
}

export function recurringOriginNote(expenseId: string): string {
  return `origem:${expenseId}`;
}

export async function clearRecurringCardLines(db: D1Database, ownerId: string, expenseId: string): Promise<void> {
  const marker = recurringOriginNote(expenseId);
  await db
    .prepare("DELETE FROM expenses WHERE owner_id = ? AND (note = ? OR note LIKE ?)")
    .bind(ownerId, marker, `${marker}\n%`)
    .run();
}

export async function payRecurringOnCard(
  db: D1Database,
  input: {
    ownerId: string;
    expenseId: string;
    cardLabel: string;
    alias: string;
    amountCents: number;
    totalCount: number;
    startMonthId?: string;
    mode?: "installment" | "total";
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expense = await getExpense(db, input.ownerId, input.expenseId);
  if (!expense) return { ok: false, error: "Gasto não encontrado." };
  if (expense.section !== "fixed") return { ok: false, error: "Só um gasto recorrente entra na fatura por aqui." };
  const alias = input.alias.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!alias) return { ok: false, error: "Escolha o apelido que vai aparecer na fatura." };
  const startMonthId = input.startMonthId || expense.monthId;
  const mode = input.mode === "total" ? "total" : "installment";
  const plan = planCardPurchase({
    startMonthId,
    totalCount: input.totalCount,
    paidCount: 0,
    amountCents: input.amountCents,
    mode,
  });
  if (!plan.ok) return plan;
  await clearRecurringCardLines(db, input.ownerId, input.expenseId);
  await db
    .prepare("UPDATE expenses SET payment = 'card', on_card = 1, card_label = ?, paid = 1 WHERE owner_id = ? AND id = ?")
    .bind(input.cardLabel, input.ownerId, input.expenseId)
    .run();
  return insertCardPurchase(db, {
    ownerId: input.ownerId,
    startMonthId,
    name: alias,
    section: "card",
    payment: "card",
    cardLabel: input.cardLabel,
    note: recurringOriginNote(input.expenseId),
    totalCount: input.totalCount,
    paidCount: 0,
    amountCents: input.amountCents,
    mode,
  });
}

export async function clearRecurringCardCharge(
  db: D1Database,
  ownerId: string,
  expenseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expense = await getExpense(db, ownerId, expenseId);
  if (!expense) return { ok: false, error: "Gasto não encontrado." };
  await clearRecurringCardLines(db, ownerId, expenseId);
  await db
    .prepare("UPDATE expenses SET payment = 'pix', on_card = 0, card_label = NULL, paid = 0 WHERE owner_id = ? AND id = ?")
    .bind(ownerId, expenseId)
    .run();
  return { ok: true };
}

export async function applyBaseIncome(db: D1Database, ownerId: string, amountCents: number, scope: "all" | "unlocked"): Promise<void> {
  await setSetting(db, baseIncomeKey(ownerId), String(amountCents));
  if (scope === "all") {
    await db.prepare("UPDATE months SET income_cents = ?, income_locked = 0 WHERE owner_id = ?").bind(amountCents, ownerId).run();
    return;
  }
  await db.prepare("UPDATE months SET income_cents = ? WHERE owner_id = ? AND income_locked = 0").bind(amountCents, ownerId).run();
}

export async function setMonthIncome(db: D1Database, ownerId: string, monthId: string, amountCents: number): Promise<void> {
  await db
    .prepare("UPDATE months SET income_cents = ?, income_locked = 1 WHERE owner_id = ? AND id = ?")
    .bind(amountCents, ownerId, monthId)
    .run();
}

export async function unlockMonthIncome(db: D1Database, ownerId: string, monthId: string): Promise<void> {
  const base = await getSetting(db, baseIncomeKey(ownerId));
  const amount = base === null ? 0 : Number(base);
  await db
    .prepare("UPDATE months SET income_cents = ?, income_locked = 0 WHERE owner_id = ? AND id = ?")
    .bind(Number.isFinite(amount) ? amount : 0, ownerId, monthId)
    .run();
}

export type SharePermission = "view" | "edit";

export type Space = {
  ownerId: string;
  label: string;
  detail: string;
  permission: "own" | SharePermission;
};

export async function listSpaces(db: D1Database, actorId: string): Promise<Space[]> {
  const me = await findUserById(db, actorId);
  const incoming = await db
    .prepare(
      `SELECT s.permission, u.id, u.cpf, u.email
       FROM shares s JOIN users u ON u.id = s.owner_id
       WHERE s.guest_id = ?
       ORDER BY u.cpf`,
    )
    .bind(actorId)
    .all<{ permission: SharePermission; id: string; cpf: string; email: string }>();
  return [
    { ownerId: actorId, label: "Meus gastos", detail: me ? formatCpf(me.cpf) : "", permission: "own" },
    ...(incoming.results ?? []).map((row) => ({
      ownerId: row.id,
      label: formatCpf(row.cpf),
      detail: row.email,
      permission: row.permission,
    })),
  ];
}

export async function listOutgoingShares(db: D1Database, ownerId: string) {
  const result = await db
    .prepare(
      `SELECT s.id, s.permission, u.cpf, u.email
       FROM shares s JOIN users u ON u.id = s.guest_id
       WHERE s.owner_id = ?
       ORDER BY u.cpf`,
    )
    .bind(ownerId)
    .all<{ id: string; permission: SharePermission; cpf: string; email: string }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    permission: row.permission,
    cpf: formatCpf(row.cpf),
    email: row.email,
  }));
}

export async function shareWithCpf(
  db: D1Database,
  ownerId: string,
  cpf: string,
  permission: SharePermission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guest = await findUserByCpf(db, cpf);
  if (!guest) return { ok: false, error: "Não há conta com esse CPF." };
  if (guest.id === ownerId) return { ok: false, error: "Informe o CPF de outra pessoa." };
  await db
    .prepare(
      `INSERT INTO shares (id, owner_id, guest_id, permission, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, guest_id) DO UPDATE SET permission = excluded.permission`,
    )
    .bind(crypto.randomUUID(), ownerId, guest.id, permission, new Date().toISOString())
    .run();
  return { ok: true };
}

export async function updateSharePermission(
  db: D1Database,
  ownerId: string,
  shareId: string,
  permission: SharePermission,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE shares SET permission = ? WHERE id = ? AND owner_id = ?")
    .bind(permission, shareId, ownerId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteShare(db: D1Database, ownerId: string, shareId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM shares WHERE id = ? AND owner_id = ?").bind(shareId, ownerId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function accessTo(
  db: D1Database,
  actorId: string,
  ownerId: string,
): Promise<{ permission: "own" | SharePermission; label: string } | null> {
  if (actorId === ownerId) {
    const me = await findUserById(db, actorId);
    return { permission: "own", label: me ? "Meus gastos" : "Meus gastos" };
  }
  const row = await db
    .prepare(
      `SELECT s.permission, u.cpf FROM shares s JOIN users u ON u.id = s.owner_id
       WHERE s.owner_id = ? AND s.guest_id = ?`,
    )
    .bind(ownerId, actorId)
    .first<{ permission: SharePermission; cpf: string }>();
  if (!row) return null;
  return { permission: row.permission, label: formatCpf(row.cpf) };
}
