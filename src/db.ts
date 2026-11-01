import seed from "./seed-data.json";
import type { Expense, Payment, Section } from "./domain.ts";
import { carryForward, cardKey, computeTotals, previousMonthId } from "./domain.ts";

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_name ON cards (name COLLATE NOCASE);
`;

type MonthRow = {
  id: string;
  label: string;
  income_cents: number;
  settled: number;
  sort_order: number;
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
  await ensureCards(db);

  const seeded = await db.prepare("SELECT value FROM settings WHERE key = 'seeded'").first<{ value: string }>();
  if (seeded?.value === "1") return;

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

export async function listMonths(db: D1Database): Promise<Array<{ id: string; label: string; settled: boolean; sortOrder: number }>> {
  const result = await db
    .prepare("SELECT id, label, settled, sort_order FROM months ORDER BY sort_order")
    .all<MonthRow>();
  return (result.results ?? []).map((month) => ({
    id: month.id,
    label: month.label,
    settled: month.settled === 1,
    sortOrder: month.sort_order,
  }));
}

export async function getMonth(db: D1Database, monthId: string): Promise<MonthRow | null> {
  return db.prepare("SELECT id, label, income_cents, settled, sort_order FROM months WHERE id = ?").bind(monthId).first<MonthRow>();
}

export async function listExpenses(db: D1Database, monthId: string): Promise<Expense[]> {
  const result = await db
    .prepare("SELECT * FROM expenses WHERE month_id = ? ORDER BY sort_order, name")
    .bind(monthId)
    .all<ExpenseRow>();
  return (result.results ?? []).map(mapExpense);
}

export async function getExpense(db: D1Database, id: string): Promise<Expense | null> {
  const row = await db.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<ExpenseRow>();
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

export type CardAccount = { id: string; name: string; sortOrder: number };

export async function listCards(db: D1Database): Promise<CardAccount[]> {
  const result = await db.prepare("SELECT id, name, sort_order FROM cards ORDER BY sort_order, name").all<{
    id: string;
    name: string;
    sort_order: number;
  }>();
  return (result.results ?? []).map((card) => ({ id: card.id, name: card.name, sortOrder: card.sort_order }));
}

export async function createCard(db: D1Database, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db);
  const key = cardKey(name);
  if (key && cards.some((card) => cardKey(card.name) === key)) {
    return { ok: false, error: "Já existe um cartão com esse nome." };
  }
  const sortOrder = cards.reduce((max, card) => Math.max(max, card.sortOrder), -1) + 1;
  try {
    await db
      .prepare("INSERT INTO cards (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), name, sortOrder, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe um cartão com esse nome." };
    throw error;
  }
  return { ok: true };
}

async function ensureCards(db: D1Database): Promise<void> {
  const existing = await listCards(db);
  const known = new Set(existing.map((card) => cardKey(card.name)).filter((key): key is string => key !== null));
  let order = existing.reduce((max, card) => Math.max(max, card.sortOrder), -1);
  const now = new Date().toISOString();
  const inserts: D1PreparedStatement[] = [];
  const defaults = existing.length === 0 ? ["Nubank", "Neon"] : [];
  const labels = await db
    .prepare("SELECT DISTINCT card_label AS name FROM expenses WHERE card_label IS NOT NULL AND TRIM(card_label) != ''")
    .all<{ name: string }>();
  for (const name of [...defaults, ...(labels.results ?? []).map((row) => row.name)]) {
    const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 40);
    const key = cardKey(cleaned);
    if (!cleaned || !key || known.has(key)) continue;
    known.add(key);
    order += 1;
    inserts.push(
      db
        .prepare("INSERT INTO cards (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), cleaned, order, now),
    );
  }
  if (inserts.length) await db.batch(inserts);
}

export async function monthPayload(db: D1Database, monthId: string) {
  const month = await getMonth(db, monthId);
  if (!month) return null;
  const expenses = await listExpenses(db, monthId);
  const cards = await listCards(db);
  const totals = computeTotals(expenses, month.income_cents);
  const settled = totals.remainingCents === 0 && totals.commitmentsCents > 0;
  if (settled !== (month.settled === 1)) {
    await db.prepare("UPDATE months SET settled = ? WHERE id = ?").bind(settled ? 1 : 0, monthId).run();
  }
  const months = await listMonths(db);
  return {
    month: {
      id: month.id,
      label: month.label,
      incomeCents: month.income_cents,
      settled,
      sortOrder: month.sort_order,
    },
    months: months.map((item) => ({ ...item, settled: item.id === monthId ? settled : item.settled })),
    expenses,
    cards,
    totals,
  };
}

export async function syncSettled(db: D1Database, monthId: string): Promise<void> {
  await monthPayload(db, monthId);
}

export async function copyFromPreviousMonth(db: D1Database, monthId: string): Promise<number> {
  const sourceMonth = previousMonthId(monthId);
  if (!sourceMonth) return 0;
  const source = await listExpenses(db, sourceMonth);
  const destination = await listExpenses(db, monthId);
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
            (id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'user', ?)`,
        )
        .bind(
          crypto.randomUUID(),
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
