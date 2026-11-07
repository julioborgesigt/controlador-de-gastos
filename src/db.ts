import seed from "./seed-data.json";
import type { Expense, PartialPayment, Payment, Section } from "./domain.ts";
import { formatCpf } from "./auth.ts";
import { cardDeletionEffects, carryForward, cardKey, cardOpenExpenses, coercePayment, computeTotals, editTargets, expenseCountForCard, expenseDeleteTargets, listMonthRange, livingCardSendTargets, livingCardUndoTargets, monthCanSettle, monthLabel, monthSortOrder, noteForTrack, noteWithChargeContext, noteWithOrigin, noteWithSeries, noteWithVisibleText, isVariableCost, originExpenseId, partialIdFromNote, planCardPayoff, planCardPurchase, previousMonthId, resetTargets, sameAccount, seriesIdFromNote, visibleExpenseNote, type EditScope, type ExpenseTrack } from "./domain.ts";

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
  created_at: string;
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
  await ensureColumn(db, "cards", "closing_day", "ALTER TABLE cards ADD COLUMN closing_day INTEGER");
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

export async function listFixedExpenses(db: D1Database, ownerId: string): Promise<Array<Expense & { hasPartials: boolean }>> {
  const result = await db
    .prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM partial_payments p WHERE p.owner_id = e.owner_id AND p.expense_id = e.id) AS partial_count
       FROM expenses e
       WHERE e.owner_id = ? AND e.section = 'fixed'`,
    )
    .bind(ownerId)
    .all<ExpenseRow & { partial_count: number }>();
  return (result.results ?? []).map((row) => ({ ...mapExpense(row), hasPartials: Number(row.partial_count) > 0 }));
}

async function listSectionExpenses(db: D1Database, ownerId: string, section: Section): Promise<Expense[]> {
  const result = await db
    .prepare("SELECT * FROM expenses WHERE owner_id = ? AND section = ?")
    .bind(ownerId, section)
    .all<ExpenseRow>();
  return (result.results ?? []).map(mapExpense);
}

export async function deleteMatchingExpenses(
  db: D1Database,
  ownerId: string,
  expenseId: string,
  scope: "month" | "forward" | "series",
): Promise<{ ok: true; monthId: string; count: number } | { ok: false; error: string }> {
  const current = await getExpense(db, ownerId, expenseId);
  if (!current) return { ok: false, error: "Gasto não encontrado." };
  const spreads = current.section === "fixed" || current.section === "card" || (current.section === "extra" && current.payment === "card");
  const pool = spreads ? await listSectionExpenses(db, ownerId, current.section) : [current];
  const ids = expenseDeleteTargets(pool, current.id, scope);
  if (current.section === "card" && scope === "series") {
    const origins = pool.filter((item) => ids.includes(item.id)).map((item) => originExpenseId(item.note)).filter(Boolean);
    if (origins.length) {
      const fixed = await listFixedExpenses(db, ownerId);
      const seeds = fixed.filter((item) => origins.includes(item.id));
      const siblingIds = new Set(fixed.filter((item) => seeds.some((seed) => sameAccount(seed, item))).map((item) => item.id));
      for (const card of pool) {
        const origin = originExpenseId(card.note);
        if (origin && siblingIds.has(origin) && !ids.includes(card.id)) ids.push(card.id);
      }
    }
  }
  if (!ids.length) return { ok: false, error: "Gasto não encontrado." };
  const selected = pool.filter((item) => ids.includes(item.id));
  const fixedIds = selected.filter((item) => item.section === "fixed").map((item) => item.id);
  if (fixedIds.length) {
    await deletePartialsForExpenses(db, ownerId, fixedIds);
    for (const id of fixedIds) await clearRecurringCardLines(db, ownerId, id);
  }
  const deletedNotes = selected.map((item) => item.note);
  await db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND id IN (${sqlMarks(ids)})`).bind(ownerId, ...ids).run();
  const left = await db
    .prepare("SELECT note FROM expenses WHERE owner_id = ? AND note IS NOT NULL")
    .bind(ownerId)
    .all<{ note: string }>();
  const effects = cardDeletionEffects(deletedNotes, (left.results ?? []).map((row) => row.note));
  for (const origin of effects.resetOriginIds) {
    if (ids.includes(origin)) continue;
    await db
      .prepare("UPDATE expenses SET payment = 'pix', on_card = 0, card_label = NULL, paid = 0 WHERE owner_id = ? AND id = ? AND section = 'fixed'")
      .bind(ownerId, origin)
      .run();
  }
  for (const partialId of effects.dropPartialIds) {
    const row = await db
      .prepare("SELECT expense_id FROM partial_payments WHERE owner_id = ? AND id = ?")
      .bind(ownerId, partialId)
      .first<{ expense_id: string }>();
    if (!row || ids.includes(row.expense_id)) continue;
    await deletePartialPayment(db, ownerId, row.expense_id, partialId);
  }
  return { ok: true, monthId: current.monthId, count: ids.length };
}

export async function applySeriesEdit(
  db: D1Database,
  input: {
    ownerId: string;
    expenseId: string;
    scope: Exclude<EditScope, "month">;
    name: string;
    amountCents: number;
    note: string | null;
    payment: Payment;
    cardLabel: string | null;
    installment: string | null;
  },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const current = await getExpense(db, input.ownerId, input.expenseId);
  if (!current) return { ok: false, error: "Gasto não encontrado." };
  if (current.section !== "fixed" && current.section !== "card") {
    return { ok: false, error: "Este gasto não se repete nos meses." };
  }
  if (current.section === "fixed" && input.payment === "card" && input.amountCents <= 0) {
    return { ok: false, error: "Informe um valor maior que zero para lançar no cartão." };
  }
  if ((current.section === "card" || input.payment === "card") && !input.cardLabel) {
    return { ok: false, error: "Escolha o cartão." };
  }
  const pool = current.section === "fixed"
    ? await listFixedExpenses(db, input.ownerId)
    : await listSectionExpenses(db, input.ownerId, "card");
  const targets = editTargets(pool, current.id, input.scope);
  if (!targets.length) return { ok: false, error: "Gasto não encontrado." };
  const visible = visibleExpenseNote(input.note);
  const cardLines = await listSectionExpenses(db, input.ownerId, "card");
  const statements: D1PreparedStatement[] = [];
  for (const row of targets) {
    const note = noteWithVisibleText(row.note, visible);
    if (current.section === "card") {
      statements.push(
        db.prepare(
          "UPDATE expenses SET name = ?, amount_cents = ?, card_label = ?, note = ?, installment = ? WHERE owner_id = ? AND id = ?",
        ).bind(
          input.name,
          input.amountCents,
          input.cardLabel,
          note,
          row.id === current.id ? input.installment : row.installment,
          input.ownerId,
          row.id,
        ),
      );
      continue;
    }
    if (input.payment !== "card") {
      statements.push(
        db.prepare(
          "UPDATE expenses SET name = ?, amount_cents = ?, payment = ?, on_card = 0, card_label = NULL, paid = ?, note = ? WHERE owner_id = ? AND id = ?",
        ).bind(
          input.name,
          input.amountCents,
          input.payment,
          row.onCard ? 0 : row.paid ? 1 : 0,
          note,
          input.ownerId,
          row.id,
        ),
      );
      if (row.onCard) {
        for (const line of cardLines) {
          if (originExpenseId(line.note) === row.id) {
            statements.push(db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, line.id));
          }
        }
      }
      continue;
    }
    statements.push(
      db.prepare(
        "UPDATE expenses SET name = ?, amount_cents = ?, payment = 'card', card_label = ?, note = ? WHERE owner_id = ? AND id = ?",
      ).bind(input.name, input.amountCents, input.cardLabel, note, input.ownerId, row.id),
    );
    if (row.onCard) {
      for (const line of cardLines) {
        if (originExpenseId(line.note) === row.id && !partialIdFromNote(line.note)) {
          statements.push(
            db.prepare("UPDATE expenses SET name = ?, amount_cents = ?, card_label = ? WHERE owner_id = ? AND id = ?")
              .bind(input.name, input.amountCents, input.cardLabel, input.ownerId, line.id),
          );
        }
      }
    }
  }
  await runStatements(db, statements);
  if (current.section === "fixed" && input.payment === "card") {
    const pending = targets
      .filter((row) => !row.onCard && !("hasPartials" in row && row.hasPartials))
      .map((row) => ({ ...row, name: input.name, amountCents: input.amountCents }));
    if (pending.length) {
      const charged = await chargeLivingRowsOnCard(db, {
        ownerId: input.ownerId,
        rows: pending,
        anchorId: current.id,
        cardLabel: input.cardLabel || "",
        alias: input.name,
        amountCents: input.amountCents,
        startMonthId: current.monthId,
      });
      if (!charged.ok) return charged;
    }
  }
  return { ok: true, count: targets.length };
}

export function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    monthId: row.month_id,
    name: row.name,
    section: row.section as Section,
    amountCents: row.amount_cents,
    payment: coercePayment(row.payment),
    onCard: row.on_card === 1,
    cardLabel: row.card_label,
    paid: row.paid === 1,
    note: row.note,
    installment: row.installment ?? null,
    sortOrder: row.sort_order,
    source: row.source === "user" ? "user" : "sheet",
    createdAt: row.created_at,
  };
}

export type CardAccount = { id: string; name: string; sortOrder: number; expenseCount: number; dueDay: number | null; closingDay: number | null };

export async function listCards(db: D1Database, ownerId: string): Promise<CardAccount[]> {
  const result = await db
    .prepare("SELECT id, name, sort_order, due_day, closing_day FROM cards WHERE owner_id = ? ORDER BY sort_order, name")
    .bind(ownerId)
    .all<{
      id: string;
      name: string;
      sort_order: number;
      due_day: number | null;
      closing_day: number | null;
    }>();
  const labels = await cardLabelCounts(db, ownerId);
  return (result.results ?? []).map((card) => ({
    id: card.id,
    name: card.name,
    sortOrder: card.sort_order,
    dueDay: card.due_day ?? null,
    closingDay: card.closing_day ?? null,
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
  await runStatements(
    db,
    labels.flatMap((item) => {
      if (cardKey(item.label) !== cardKey(current.name) || !item.label || item.label === name) return [];
      return [db.prepare("UPDATE expenses SET card_label = ? WHERE owner_id = ? AND card_label = ?").bind(name, ownerId, item.label)];
    }),
  );
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
  closingDay: number | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  if (!cards.some((card) => card.id === cardId)) return { ok: false, error: "Cartão não encontrado." };
  await db.prepare("UPDATE cards SET due_day = ?, closing_day = ? WHERE owner_id = ? AND id = ?").bind(dueDay, closingDay, ownerId, cardId).run();
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
  closingDay: number | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  const key = cardKey(name);
  if (key && cards.some((card) => cardKey(card.name) === key)) {
    return { ok: false, error: "Já existe um cartão com esse nome." };
  }
  const sortOrder = cards.reduce((max, card) => Math.max(max, card.sortOrder), -1) + 1;
  try {
    await db
      .prepare("INSERT INTO cards (id, owner_id, name, sort_order, due_day, closing_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), ownerId, name, sortOrder, dueDay, closingDay, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe um cartão com esse nome." };
    throw error;
  }
  return { ok: true };
}

async function attachPartials(db: D1Database, ownerId: string, expenses: Expense[]): Promise<Expense[]> {
  const ids = expenses.map((expense) => expense.id);
  if (!ids.length) return expenses;
  const rows = await db
    .prepare(
      `SELECT id, expense_id, amount_cents, payment, card_label, installment, created_at
       FROM partial_payments WHERE owner_id = ? AND expense_id IN (${sqlMarks(ids)}) ORDER BY created_at`,
    )
    .bind(ownerId, ...ids)
    .all<{
      id: string;
      expense_id: string;
      amount_cents: number;
      payment: Payment;
      card_label: string | null;
      installment: string | null;
      created_at: string;
    }>();
  const grouped = new Map<string, PartialPayment[]>();
  for (const row of rows.results ?? []) {
    const partial: PartialPayment = {
      id: row.id,
      amountCents: row.amount_cents,
      payment: coercePayment(row.payment),
      cardLabel: row.card_label,
      installment: row.installment,
      createdAt: row.created_at,
    };
    const list = grouped.get(row.expense_id) ?? [];
    list.push(partial);
    grouped.set(row.expense_id, list);
  }
  return expenses.map((expense) => ({ ...expense, partials: grouped.get(expense.id) ?? [] }));
}

export async function insertPartialPayment(
  db: D1Database,
  input: {
    ownerId: string;
    expenseId: string;
    amountCents: number;
    payment: Payment;
    cardLabel: string | null;
    installment: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO partial_payments
        (id, owner_id, expense_id, amount_cents, payment, card_label, installment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.ownerId, input.expenseId, input.amountCents, input.payment, input.cardLabel, input.installment, new Date().toISOString())
    .run();
  return id;
}

export async function addLivingCardPartial(
  db: D1Database,
  input: {
    ownerId: string;
    expenseId: string;
    amountCents: number;
    cardLabel: string;
    installmentCount: number;
    invoiceMonthId: string;
    name: string;
    purchaseDate?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expense = await getExpense(db, input.ownerId, input.expenseId);
  if (!expense || expense.section !== "fixed") return { ok: false, error: "Gasto não encontrado." };
  if (expense.onCard) return { ok: false, error: "Esta conta já foi inteira para o cartão." };
  if (expense.paid) return { ok: false, error: "Esta despesa já foi encerrada." };
  const count = input.installmentCount;
  const known = await listMonths(db, input.ownerId);
  const plan = planCardPurchase({
    startMonthId: input.invoiceMonthId,
    totalCount: count,
    paidCount: 0,
    amountCents: input.amountCents,
    mode: "total",
  });
  if (!plan.ok) return plan;
  if (plan.plan.schedule.some((part) => !known.some((month) => month.id === part.monthId))) {
    return { ok: false, error: "O parcelamento passa do período gerenciado. Aumente o período ou reduza as parcelas." };
  }
  if (expense.payment === "card" && !isVariableCost(expense.note)) {
    await db
      .prepare("UPDATE expenses SET payment = 'pix', on_card = 0, card_label = NULL, paid = 0 WHERE owner_id = ? AND id = ?")
      .bind(input.ownerId, expense.id)
      .run();
  }
  const partialId = await insertPartialPayment(db, {
    ownerId: input.ownerId,
    expenseId: expense.id,
    amountCents: input.amountCents,
    payment: "card",
    cardLabel: input.cardLabel,
    installment: count > 1 ? `${count} parcelas` : null,
  });
  const created = await insertCardPurchase(db, {
    ownerId: input.ownerId,
    startMonthId: input.invoiceMonthId,
    name: input.name,
    section: "card",
    payment: "card",
    cardLabel: input.cardLabel,
    note: noteWithSeries(noteWithChargeContext(`origem:${expense.id}\nparcial:${partialId}`, {
      purchaseDate: input.purchaseDate,
      referenceMonthId: expense.monthId,
    }), seriesIdFromNote(expense.note)),
    totalCount: count,
    paidCount: 0,
    amountCents: input.amountCents,
    mode: "total",
  });
  if (!created.ok) {
    await deletePartialPayment(db, input.ownerId, expense.id, partialId);
    return created;
  }
  return { ok: true };
}

export async function deletePartialPayment(db: D1Database, ownerId: string, expenseId: string, partialId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM partial_payments WHERE owner_id = ? AND expense_id = ? AND id = ?")
    .bind(ownerId, expenseId, partialId)
    .first<{ id: string }>();
  if (!row) return false;
  await db.prepare("DELETE FROM expenses WHERE owner_id = ? AND note LIKE ?").bind(ownerId, `%parcial:${partialId}%`).run();
  await db.prepare("DELETE FROM partial_payments WHERE owner_id = ? AND id = ?").bind(ownerId, partialId).run();
  await db
    .prepare("UPDATE expenses SET paid = 0 WHERE owner_id = ? AND id = ? AND section = 'fixed'")
    .bind(ownerId, expenseId)
    .run();
  return true;
}

export async function undoExpensePayments(
  db: D1Database,
  ownerId: string,
  expenseId: string,
  scope: "last" | "all",
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const expense = await getExpense(db, ownerId, expenseId);
  if (!expense || expense.section !== "fixed" || expense.onCard) {
    return { ok: false, error: "Este pagamento não se desfaz por aqui." };
  }
  const rows = await db
    .prepare(
      "SELECT id FROM partial_payments WHERE owner_id = ? AND expense_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(ownerId, expenseId)
    .all<{ id: string }>();
  const partialIds = (rows.results ?? []).map((row) => row.id);
  if (!partialIds.length) {
    if (!expense.paid) return { ok: false, error: "Não há pagamento para desfazer." };
    await db.prepare("UPDATE expenses SET paid = 0 WHERE owner_id = ? AND id = ?").bind(ownerId, expenseId).run();
    return { ok: true, count: 1 };
  }
  const targets = scope === "all" ? partialIds : partialIds.slice(0, 1);
  for (const partialId of targets) {
    await deletePartialPayment(db, ownerId, expenseId, partialId);
  }
  return { ok: true, count: targets.length };
}

export async function deletePartialsForExpenses(db: D1Database, ownerId: string, expenseIds: readonly string[]): Promise<void> {
  if (!expenseIds.length) return;
  await runStatements(
    db,
    expenseIds.map((id) => db.prepare("DELETE FROM expenses WHERE owner_id = ? AND note LIKE ?").bind(ownerId, `%origem:${id}%`)),
  );
  await db
    .prepare(`DELETE FROM partial_payments WHERE owner_id = ? AND expense_id IN (${sqlMarks(expenseIds)})`)
    .bind(ownerId, ...expenseIds)
    .run();
}

async function clearOrphanCardPartials(db: D1Database, ownerId: string): Promise<void> {
  const partials = await db
    .prepare("SELECT id, expense_id FROM partial_payments WHERE owner_id = ? AND payment = 'card'")
    .bind(ownerId)
    .all<{ id: string; expense_id: string }>();
  const rows = partials.results ?? [];
  if (!rows.length) return;
  const notes = await db
    .prepare("SELECT note FROM expenses WHERE owner_id = ? AND note LIKE '%parcial:%'")
    .bind(ownerId)
    .all<{ note: string | null }>();
  const live = new Set((notes.results ?? []).map((row) => partialIdFromNote(row.note)).filter(Boolean));
  for (const partial of rows) {
    if (live.has(partial.id)) continue;
    await deletePartialPayment(db, ownerId, partial.expense_id, partial.id);
  }
}

async function livingInvoiceCharges(
  db: D1Database,
  ownerId: string,
  expenseIds: string[],
): Promise<Map<string, Array<{ monthId: string; amountCents: number }>>> {
  const grouped = new Map<string, Array<{ monthId: string; amountCents: number }>>();
  if (!expenseIds.length) return grouped;
  const wanted = new Set(expenseIds);
  const result = await db
    .prepare("SELECT month_id, amount_cents, note FROM expenses WHERE owner_id = ? AND section = 'card' AND note LIKE '%origem:%'")
    .bind(ownerId)
    .all<{ month_id: string; amount_cents: number; note: string | null }>();
  for (const row of result.results ?? []) {
    const origin = originExpenseId(row.note);
    if (!wanted.has(origin)) continue;
    const list = grouped.get(origin) ?? [];
    list.push({ monthId: row.month_id, amountCents: row.amount_cents });
    grouped.set(origin, list);
  }
  return grouped;
}

export async function monthPayload(db: D1Database, ownerId: string, monthId: string) {
  const month = await getMonth(db, ownerId, monthId);
  if (!month) return null;
  await clearOrphanCardPartials(db, ownerId);
  const expenses = await attachPartials(db, ownerId, await listExpenses(db, ownerId, monthId));
  const charges = await livingInvoiceCharges(db, ownerId, expenses.filter((expense) => expense.section === "fixed").map((expense) => expense.id));
  const expensesWithCharges = expenses.map((expense) => ({ ...expense, charges: charges.get(expense.id) ?? [] }));
  const cards = await listCards(db, ownerId);
  const incomeExtras = await listIncomeExtras(db, ownerId);
  const extraIncomeCents = incomeExtras
    .filter((extra) => extra.monthId === monthId)
    .reduce((sum, extra) => sum + extra.amountCents, 0);
  const incomeCents = month.income_cents + extraIncomeCents;
  const totals = computeTotals(expensesWithCharges, incomeCents);
  const settled = monthCanSettle(totals);
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
    expenses: expensesWithCharges,
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
  const taken = new Set(destination.map((expense) => accountKey(expense)));
  const nextSort = destination.reduce((max, expense) => Math.max(max, expense.sortOrder), 0);
  const createdAt = new Date().toISOString();
  const inserts: D1PreparedStatement[] = [];
  for (const expense of source) {
    const carried = carryForward(expense);
    if (!carried) continue;
    const key = accountKey(expense);
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

function accountKey(expense: { id: string; section: string; name: string; note?: string | null; createdAt?: string | null }): string {
  const series = seriesIdFromNote(expense.note);
  if (series) return `serie:${series}`;
  if (expense.createdAt) return `criado:${expense.createdAt}|${expense.section}|${expense.name.trim().toLocaleLowerCase("pt-BR")}`;
  return `id:${expense.id}`;
}

function payoffMarker(cardId: string, monthId: string): string {
  return `quitado-cartao:${cardId}:${monthId}`;
}

function planMarker(cardId: string, monthId: string): string {
  return `parcelamento:${cardId}:${monthId}`;
}

function noteWithMarker(note: string | null, marker: string): string {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.includes(marker)) lines.push(marker);
  return lines.join("\n");
}

function noteWithoutMarker(note: string | null, marker: string): string | null {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter((line) => line && line !== marker);
  return lines.length ? lines.join("\n") : null;
}

function hasMarker(note: string | null, marker: string): boolean {
  return String(note || "").split("\n").map((line) => line.trim()).includes(marker);
}

export async function payCardInvoice(
  db: D1Database,
  input: {
    ownerId: string;
    cardId: string;
    monthId: string;
    cardName: string;
    mode: "pix" | "installments";
    downCents?: number;
    count?: number;
    installmentCents?: number;
    startMonthId?: string;
    knownMonths: readonly string[];
  },
): Promise<{ ok: true; paidCents: number } | { ok: false; error: string }> {
  const expenses = await listExpenses(db, input.ownerId, input.monthId);
  const open = cardOpenExpenses(expenses, input.cardName);
  const balance = open.reduce((sum, expense) => sum + expense.amountCents, 0);
  if (balance <= 0) return { ok: false, error: "Este cartão não tem valor em aberto neste mês." };
  const plan = input.mode === "installments"
    ? planCardPayoff({
      balanceCents: balance,
      downCents: input.downCents ?? 0,
      count: input.count ?? 0,
      installmentCents: input.installmentCents ?? 0,
      startMonthId: input.startMonthId ?? "",
    })
    : null;
  if (plan && !plan.ok) return plan;
  if (plan?.ok) {
    const missing = plan.schedule.find((part) => !input.knownMonths.includes(part.monthId));
    if (missing) {
      return { ok: false, error: "O parcelamento passa do período gerenciado. Aumente o período ou reduza as parcelas." };
    }
  }
  const settled = payoffMarker(input.cardId, input.monthId);
  const statements: D1PreparedStatement[] = open.map((expense) =>
    db.prepare("UPDATE expenses SET paid = 1, note = ? WHERE owner_id = ? AND id = ?")
      .bind(noteWithMarker(expense.note, settled), input.ownerId, expense.id),
  );
  if (plan?.ok) {
    const createdAt = new Date().toISOString();
    const name = `Parcelamento ${input.cardName}`.slice(0, 120);
    const marker = planMarker(input.cardId, input.monthId);
    const used = await nextSorts(db, input.ownerId, plan.schedule.map((part) => part.monthId));
    for (const part of plan.schedule) {
      const sort = (used.get(part.monthId) ?? 0) + 1;
      used.set(part.monthId, sort);
      statements.push(
        db
          .prepare(
            `INSERT INTO expenses
              (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
             VALUES (?, ?, ?, ?, 'card', ?, 'card', 0, ?, 0, ?, ?, ?, 'user', ?)`,
          )
          .bind(crypto.randomUUID(), input.ownerId, part.monthId, name, part.amountCents, input.cardName, marker, part.installment, sort, createdAt),
      );
    }
  }
  await runStatements(db, statements);
  return { ok: true, paidCents: balance };
}

export async function undoCardInvoice(
  db: D1Database,
  input: { ownerId: string; cardId: string; cardName: string; monthId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.prepare(
    "SELECT id, month_id, note, name, card_label FROM expenses WHERE owner_id = ?",
  ).bind(input.ownerId).all<{ id: string; month_id: string; note: string | null; name: string; card_label: string | null }>();
  const all = rows.results ?? [];
  const settled = payoffMarker(input.cardId, input.monthId);
  const planned = planMarker(input.cardId, input.monthId);
  const tagged = all.filter((row) => hasMarker(row.note, settled));
  const installments = all.filter((row) => hasMarker(row.note, planned));
  if (tagged.length || installments.length) {
    await runStatements(db, [
      ...tagged.map((row) =>
        db.prepare("UPDATE expenses SET paid = 0, note = ? WHERE owner_id = ? AND id = ?")
          .bind(noteWithoutMarker(row.note, settled), input.ownerId, row.id),
      ),
      ...installments.map((row) =>
        db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, row.id),
      ),
    ]);
    return { ok: true };
  }
  const monthExpenses = await listExpenses(db, input.ownerId, input.monthId);
  const paidLines = monthExpenses.filter((expense) => (
    cardKey(expense.cardLabel) === cardKey(input.cardName)
    && expense.paid
    && expense.amountCents > 0
    && !(expense.section === "fixed" && (expense.onCard || expense.payment === "card"))
  ));
  const legacy = all.filter((row) => row.name === `Parcelamento ${input.cardName}` && cardKey(row.card_label) === cardKey(input.cardName));
  if (!paidLines.length && !legacy.length) {
    return { ok: false, error: "Não há pagamento deste cartão para desfazer neste mês." };
  }
  await runStatements(db, [
    ...paidLines.map((expense) =>
      db.prepare("UPDATE expenses SET paid = 0 WHERE owner_id = ? AND id = ?").bind(input.ownerId, expense.id),
    ),
    ...legacy.map((row) =>
      db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, row.id),
    ),
  ]);
  return { ok: true };
}

function sqlMarks(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

async function runStatements(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
}

async function nextSorts(db: D1Database, ownerId: string, monthIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(monthIds)];
  if (!ids.length) return new Map();
  const sorts = await db
    .prepare(
      `SELECT month_id, COALESCE(MAX(sort_order), 0) AS max_sort
       FROM expenses WHERE owner_id = ? AND month_id IN (${sqlMarks(ids)}) GROUP BY month_id`,
    )
    .bind(ownerId, ...ids)
    .all<{ month_id: string; max_sort: number }>();
  return new Map((sorts.results ?? []).map((row) => [row.month_id, Number(row.max_sort) || 0]));
}

export async function ensureMonths(db: D1Database, ownerId: string, monthIds: readonly string[]): Promise<void> {
  const ids = [...new Set(monthIds)];
  if (!ids.length) return;
  const known = await db
    .prepare(`SELECT id FROM months WHERE owner_id = ? AND id IN (${sqlMarks(ids)})`)
    .bind(ownerId, ...ids)
    .all<{ id: string }>();
  const have = new Set((known.results ?? []).map((row) => row.id));
  const missing = ids.filter((id) => !have.has(id));
  if (!missing.length) return;
  const base = await getSetting(db, baseIncomeKey(ownerId));
  const income = base === null ? 0 : Number(base);
  const cents = Number.isFinite(income) ? income : 0;
  await runStatements(
    db,
    missing.map((monthId) =>
      db
        .prepare(
          "INSERT INTO months (owner_id, id, label, income_cents, settled, sort_order, income_locked) VALUES (?, ?, ?, ?, 0, ?, 0)",
        )
        .bind(ownerId, monthId, monthLabel(monthId), cents, monthSortOrder(monthId)),
    ),
  );
}

export async function ensureMonth(db: D1Database, ownerId: string, monthId: string): Promise<void> {
  await ensureMonths(db, ownerId, [monthId]);
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
  const dropping = existing.filter((month) => !keep.has(month.id));
  if (dropping.length) {
    const blocked = await busyMonthLabel(db, ownerId, dropping);
    if (blocked) return { ok: false, error: `Há dados em ${blocked}. Apague esses dados antes de tirar o mês do período.` };
    const ids = dropping.map((month) => month.id);
    const marks = sqlMarks(ids);
    await db.batch([
      db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND month_id IN (${marks})`).bind(ownerId, ...ids),
      db.prepare(`DELETE FROM income_extras WHERE owner_id = ? AND month_id IN (${marks})`).bind(ownerId, ...ids),
      db.prepare(`DELETE FROM months WHERE owner_id = ? AND id IN (${marks})`).bind(ownerId, ...ids),
    ]);
  }
  await ensureMonths(db, ownerId, range.months);
  return { ok: true, startMonthId: range.months[0] };
}

async function busyMonthLabel(
  db: D1Database,
  ownerId: string,
  months: Array<{ id: string; label: string; incomeLocked: boolean }>,
): Promise<string | null> {
  const ids = months.map((month) => month.id);
  const marks = sqlMarks(ids);
  const expenses = await db
    .prepare(`SELECT month_id FROM expenses WHERE owner_id = ? AND month_id IN (${marks}) GROUP BY month_id`)
    .bind(ownerId, ...ids)
    .all<{ month_id: string }>();
  const extras = await db
    .prepare(`SELECT month_id FROM income_extras WHERE owner_id = ? AND month_id IN (${marks}) GROUP BY month_id`)
    .bind(ownerId, ...ids)
    .all<{ month_id: string }>();
  const busy = new Set([
    ...(expenses.results ?? []).map((row) => row.month_id),
    ...(extras.results ?? []).map((row) => row.month_id),
  ]);
  const found = months.find((month) => month.incomeLocked || busy.has(month.id));
  return found ? found.label : null;
}

export async function resetOwnerData(
  db: D1Database,
  ownerId: string,
  input: { scope: string; year?: number; monthId?: string },
): Promise<{ ok: true; ids: string[]; wiped?: boolean } | { ok: false; error: string }> {
  if (input.scope === "all") {
    await db.batch([
      db.prepare("DELETE FROM partial_payments WHERE owner_id = ?").bind(ownerId),
      db.prepare("DELETE FROM expenses WHERE owner_id = ?").bind(ownerId),
      db.prepare("DELETE FROM income_extras WHERE owner_id = ?").bind(ownerId),
      db.prepare("DELETE FROM months WHERE owner_id = ?").bind(ownerId),
      db.prepare("DELETE FROM cards WHERE owner_id = ?").bind(ownerId),
      db.prepare("DELETE FROM settings WHERE key = ? OR key = ?").bind(baseIncomeKey(ownerId), themeKey(ownerId)),
    ]);
    return { ok: true, ids: [], wiped: true };
  }
  const months = await listMonths(db, ownerId);
  const targets = resetTargets(months.map((month) => month.id), input);
  if (!targets.ok) return targets;
  const base = await getSetting(db, baseIncomeKey(ownerId));
  const income = base === null ? 0 : Number(base);
  const incomeCents = Number.isFinite(income) ? income : 0;
  const ids = targets.ids;
  const marks = sqlMarks(ids);
  const parents = await db
    .prepare(`SELECT id FROM expenses WHERE owner_id = ? AND month_id IN (${marks})`)
    .bind(ownerId, ...ids)
    .all<{ id: string }>();
  await deletePartialsForExpenses(db, ownerId, (parents.results ?? []).map((row) => row.id));
  await db.batch([
    db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND month_id IN (${marks})`).bind(ownerId, ...ids),
    db.prepare(`DELETE FROM income_extras WHERE owner_id = ? AND month_id IN (${marks})`).bind(ownerId, ...ids),
    db.prepare(`UPDATE months SET income_cents = ?, income_locked = 0, settled = 0 WHERE owner_id = ? AND id IN (${marks})`).bind(incomeCents, ownerId, ...ids),
  ]);
  return { ok: true, ids };
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
  const note = noteWithSeries(input.note, seriesIdFromNote(input.note) || crypto.randomUUID());
  const monthIds = plan.plan.schedule.map((part) => part.monthId);
  await ensureMonths(db, input.ownerId, monthIds);
  const used = await nextSorts(db, input.ownerId, monthIds);
  const inserts: D1PreparedStatement[] = [];
  for (const part of plan.plan.schedule) {
    const sort = (used.get(part.monthId) ?? 0) + 1;
    used.set(part.monthId, sort);
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
          note,
          part.installment,
          sort,
          createdAt,
        ),
    );
  }
  await runStatements(db, inserts);
  return { ok: true };
}

export async function reclassifyExpense(
  db: D1Database,
  input: {
    ownerId: string;
    expenseId: string;
    track: ExpenseTrack;
    name: string;
    amountCents: number;
    cardLabel: string;
    note: string;
  },
): Promise<{ ok: true; monthId: string } | { ok: false; error: string }> {
  const current = await getExpense(db, input.ownerId, input.expenseId);
  if (!current) return { ok: false, error: "Gasto não encontrado." };
  const rawNote = String(current.note || "");
  if (rawNote.includes("parcelamento:") || rawNote.includes("quitado-cartao:")) {
    return { ok: false, error: "Este lançamento é da fatura e não muda de aba." };
  }
  if (input.amountCents <= 0) return { ok: false, error: "Informe um valor maior que zero." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Dê um nome ao gasto." };
  const cardLines = await listSectionExpenses(db, input.ownerId, "card");
  const statements: D1PreparedStatement[] = [];
  const standalone = (base: string | null | undefined) => noteForTrack(noteWithVisibleText(base, input.note), input.track);

  const updateExpense = (
    id: string,
    fields: {
      name: string;
      section: Section;
      amountCents: number;
      payment: Payment;
      onCard: boolean;
      cardLabel: string | null;
      paid: boolean;
      note: string;
      installment: string | null;
    },
  ) => {
    statements.push(
      db.prepare(
        `UPDATE expenses
         SET name = ?, section = ?, amount_cents = ?, payment = ?, on_card = ?, card_label = ?, paid = ?, note = ?, installment = ?
         WHERE owner_id = ? AND id = ?`,
      ).bind(
        fields.name,
        fields.section,
        fields.amountCents,
        fields.payment,
        fields.onCard ? 1 : 0,
        fields.cardLabel,
        fields.paid ? 1 : 0,
        fields.note,
        fields.installment,
        input.ownerId,
        id,
      ),
    );
  };

  if (current.section === "extra") {
    if (input.track === "casa") {
      updateExpense(current.id, {
        name,
        section: "fixed",
        amountCents: input.amountCents,
        payment: "card",
        onCard: true,
        cardLabel: input.cardLabel,
        paid: true,
        note: standalone(current.note),
        installment: null,
      });
      const used = await nextSorts(db, input.ownerId, [current.monthId]);
      const sort = (used.get(current.monthId) ?? 0) + 1;
      statements.push(
        db.prepare(
          `INSERT INTO expenses
            (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
           VALUES (?, ?, ?, ?, 'card', ?, 'card', 0, ?, 0, ?, ?, ?, 'user', ?)`,
        ).bind(
          crypto.randomUUID(),
          input.ownerId,
          current.monthId,
          name,
          input.amountCents,
          input.cardLabel,
          noteWithOrigin(seriesIdFromNote(current.note) ? `serie:${seriesIdFromNote(current.note)}` : "", current.id),
          current.installment,
          sort,
          new Date().toISOString(),
        ),
      );
    } else {
      updateExpense(current.id, {
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: standalone(current.note),
        installment: current.installment,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
  }

  if (current.section === "fixed") {
    const mirrors = cardLines.filter((line) => originExpenseId(line.note) === current.id);
    if (input.track === "casa") {
      updateExpense(current.id, {
        name,
        section: "fixed",
        amountCents: input.amountCents,
        payment: "card",
        onCard: true,
        cardLabel: input.cardLabel,
        paid: true,
        note: standalone(current.note),
        installment: null,
      });
      const full = mirrors.filter((line) => !partialIdFromNote(line.note) && line.monthId === current.monthId);
      for (const line of full) {
        updateExpense(line.id, {
          name,
          section: "card",
          amountCents: input.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: input.cardLabel,
          paid: line.paid,
          note: line.note || "",
          installment: line.installment,
        });
      }
      if (!mirrors.length) {
        const used = await nextSorts(db, input.ownerId, [current.monthId]);
        const sort = (used.get(current.monthId) ?? 0) + 1;
        statements.push(
          db.prepare(
            `INSERT INTO expenses
              (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
             VALUES (?, ?, ?, ?, 'card', ?, 'card', 0, ?, 0, ?, NULL, ?, 'user', ?)`,
          ).bind(
            crypto.randomUUID(),
            input.ownerId,
            current.monthId,
            name,
            input.amountCents,
            input.cardLabel,
            noteWithOrigin("", current.id),
            sort,
            new Date().toISOString(),
          ),
        );
      }
    } else {
      for (const line of mirrors) {
        statements.push(db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, line.id));
      }
      statements.push(db.prepare("DELETE FROM partial_payments WHERE owner_id = ? AND expense_id = ?").bind(input.ownerId, current.id));
      updateExpense(current.id, {
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: standalone(current.note),
        installment: null,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
  }

  const originId = originExpenseId(current.note);
  const partialId = partialIdFromNote(current.note);
  if (!originId) {
    if (input.track === "casa") {
      const fixedId = crypto.randomUUID();
      const used = await nextSorts(db, input.ownerId, [current.monthId]);
      const sort = (used.get(current.monthId) ?? 0) + 1;
      statements.push(
        db.prepare(
          `INSERT INTO expenses
            (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
           VALUES (?, ?, ?, ?, 'fixed', ?, 'card', 1, ?, 1, ?, NULL, ?, 'user', ?)`,
        ).bind(
          fixedId,
          input.ownerId,
          current.monthId,
          name,
          input.amountCents,
          input.cardLabel,
          standalone(current.note),
          sort,
          new Date().toISOString(),
        ),
      );
      updateExpense(current.id, {
        name,
        section: "card",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: noteWithOrigin(noteWithVisibleText(current.note, input.note), fixedId),
        installment: current.installment,
      });
    } else {
      updateExpense(current.id, {
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: standalone(current.note),
        installment: current.installment,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
  }

  if (partialId) {
    const siblings = cardLines.filter((line) => partialIdFromNote(line.note) === partialId);
    if (input.track === "casa") {
      updateExpense(current.id, {
        name,
        section: "card",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: current.note || "",
        installment: current.installment,
      });
      const total = siblings.reduce((sum, line) => sum + (line.id === current.id ? input.amountCents : line.amountCents), 0);
      statements.push(
        db.prepare("UPDATE partial_payments SET amount_cents = ?, card_label = ? WHERE owner_id = ? AND id = ?")
          .bind(total, input.cardLabel, input.ownerId, partialId),
      );
      await runStatements(db, statements);
      return { ok: true, monthId: current.monthId };
    }
    let moved = 0;
    for (const line of siblings) {
      const amount = line.id === current.id ? input.amountCents : line.amountCents;
      moved += amount;
      updateExpense(line.id, {
        name: line.id === current.id ? name : line.name,
        section: "extra",
        amountCents: amount,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: noteForTrack(line.id === current.id ? noteWithVisibleText(line.note, input.note) : line.note, input.track),
        installment: line.installment,
      });
    }
    statements.push(db.prepare("DELETE FROM partial_payments WHERE owner_id = ? AND id = ?").bind(input.ownerId, partialId));
    const origin = await getExpense(db, input.ownerId, originId);
    if (origin && origin.section === "fixed") {
      statements.push(
        db.prepare("UPDATE expenses SET amount_cents = ? WHERE owner_id = ? AND id = ?")
          .bind(Math.max(0, origin.amountCents - moved), input.ownerId, origin.id),
      );
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
  }

  const origin = originId ? await getExpense(db, input.ownerId, originId) : null;
  if (input.track === "casa") {
    updateExpense(current.id, {
      name,
      section: "card",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: current.paid,
      note: current.note || "",
      installment: current.installment,
    });
    if (origin) {
      updateExpense(origin.id, {
        name,
        section: "fixed",
        amountCents: input.amountCents,
        payment: "card",
        onCard: true,
        cardLabel: input.cardLabel,
        paid: true,
        note: origin.note || "",
        installment: null,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
  }

  if (origin && origin.section === "fixed") {
    updateExpense(origin.id, {
      name,
      section: "extra",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: false,
      note: standalone(origin.note),
      installment: current.installment,
    });
    for (const line of cardLines) {
      if (originExpenseId(line.note) === origin.id && !partialIdFromNote(line.note)) {
        statements.push(db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, line.id));
      }
    }
  } else {
    updateExpense(current.id, {
      name,
      section: "extra",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: false,
      note: standalone(current.note),
      installment: current.installment,
    });
  }
  await runStatements(db, statements);
  return { ok: true, monthId: current.monthId };
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
    purchaseDate?: string | null;
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
    note: noteWithSeries(noteWithChargeContext(recurringOriginNote(input.expenseId), {
      purchaseDate: input.purchaseDate,
      referenceMonthId: expense.monthId,
    }), seriesIdFromNote(expense.note)),
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

async function chargeLivingRowsOnCard(
  db: D1Database,
  input: {
    ownerId: string;
    rows: Array<Expense & { hasPartials?: boolean }>;
    anchorId: string;
    cardLabel: string;
    alias: string;
    amountCents: number;
    startMonthId: string;
    purchaseDate?: string | null;
  },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const alias = input.alias.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!alias) return { ok: false, error: "Escolha o apelido que vai aparecer na fatura." };
  const charges: Array<{ id: string; name: string; monthId: string; amountCents: number; note: string }> = [];
  for (const row of input.rows) {
    const own = row.id !== input.anchorId;
    const amount = own ? row.amountCents : input.amountCents;
    if (amount <= 0) continue;
    const startMonthId = own ? row.monthId : input.startMonthId || row.monthId;
    const plan = planCardPurchase({
      startMonthId,
      totalCount: 1,
      paidCount: 0,
      amountCents: amount,
      mode: "installment",
    });
    if (!plan.ok) return plan;
    const part = plan.plan.schedule[0];
    if (!part) continue;
    charges.push({
      id: row.id,
      name: own ? row.name : alias,
      monthId: part.monthId,
      amountCents: part.amountCents,
      note: noteWithSeries(noteWithChargeContext(recurringOriginNote(row.id), {
        purchaseDate: row.id === input.anchorId ? input.purchaseDate : "",
        referenceMonthId: row.monthId,
      }), seriesIdFromNote(row.note)),
    });
  }
  if (!charges.length) return { ok: false, error: "Não há valor para lançar no cartão." };
  await ensureMonths(db, input.ownerId, charges.map((charge) => charge.monthId));
  const used = await nextSorts(db, input.ownerId, charges.map((charge) => charge.monthId));
  const createdAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const charge of charges) {
    const marker = recurringOriginNote(charge.id);
    statements.push(
      db.prepare("DELETE FROM expenses WHERE owner_id = ? AND (note = ? OR note LIKE ?)").bind(input.ownerId, marker, `${marker}\n%`),
    );
    statements.push(
      db.prepare("UPDATE expenses SET payment = 'card', on_card = 1, card_label = ?, paid = 1 WHERE owner_id = ? AND id = ?")
        .bind(input.cardLabel, input.ownerId, charge.id),
    );
    const sort = (used.get(charge.monthId) ?? 0) + 1;
    used.set(charge.monthId, sort);
    statements.push(
      db.prepare(
        `INSERT INTO expenses
          (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
         VALUES (?, ?, ?, ?, 'card', ?, 'card', 0, ?, 0, ?, NULL, ?, 'user', ?)`,
      ).bind(crypto.randomUUID(), input.ownerId, charge.monthId, charge.name, charge.amountCents, input.cardLabel, charge.note, sort, createdAt),
    );
  }
  await runStatements(db, statements);
  return { ok: true, count: charges.length };
}

export async function payLivingSeriesOnCard(
  db: D1Database,
  input: {
    ownerId: string;
    expenseId: string;
    scope: "month" | "following";
    cardLabel: string;
    alias: string;
    amountCents: number;
    totalCount: number;
    startMonthId?: string;
    mode?: "installment" | "total";
    purchaseDate?: string | null;
  },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const scope = input.totalCount > 1 ? "month" : input.scope;
  const all = await listFixedExpenses(db, input.ownerId);
  const ids = livingCardSendTargets(all, input.expenseId, scope);
  if (!ids.length) return { ok: false, error: "Gasto não encontrado." };
  if (input.totalCount <= 1) {
    const rows = ids.flatMap((id) => {
      const row = all.find((item) => item.id === id);
      return row ? [row] : [];
    });
    return chargeLivingRowsOnCard(db, {
      ownerId: input.ownerId,
      rows,
      anchorId: input.expenseId,
      cardLabel: input.cardLabel,
      alias: input.alias,
      amountCents: input.amountCents,
      startMonthId: input.startMonthId || rows.find((row) => row.id === input.expenseId)?.monthId || "",
      purchaseDate: input.purchaseDate,
    });
  }
  let count = 0;
  for (const id of ids) {
    const row = all.find((item) => item.id === id);
    if (!row) continue;
    const own = id !== input.expenseId;
    const amount = own ? row.amountCents : input.amountCents;
    if (amount <= 0) continue;
    const paid = await payRecurringOnCard(db, {
      ownerId: input.ownerId,
      expenseId: id,
      cardLabel: input.cardLabel,
      alias: own ? row.name : input.alias,
      amountCents: amount,
      totalCount: own ? 1 : input.totalCount,
      startMonthId: own ? row.monthId : input.startMonthId || row.monthId,
      mode: own ? "installment" : input.mode,
      purchaseDate: own ? "" : input.purchaseDate,
    });
    if (!paid.ok) return paid;
    count += 1;
  }
  if (!count) return { ok: false, error: "Não há valor para lançar no cartão." };
  return { ok: true, count };
}

export async function clearLivingCardCharges(
  db: D1Database,
  ownerId: string,
  expenseId: string,
  scope: "month" | "series",
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const all = await listFixedExpenses(db, ownerId);
  const ids = livingCardUndoTargets(all, expenseId, scope);
  if (!ids.length) return { ok: false, error: "Este gasto não está no cartão." };
  for (const id of ids) {
    const cleared = await clearRecurringCardCharge(db, ownerId, id);
    if (!cleared.ok) return cleared;
  }
  return { ok: true, count: ids.length };
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
