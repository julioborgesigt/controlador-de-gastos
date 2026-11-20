import type { Expense, Section } from "../domain.ts";
import { coercePayment } from "../domain.ts";

export type MonthRow = {
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

export type ExpenseRow = {
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

export type Account = {
  id: string;
  cpf: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

export type PasskeyRecord = {
  id: string;
  userId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  createdAt: string;
};

export type CardAccount = { id: string; name: string; sortOrder: number; expenseCount: number; dueDay: number | null; closingDay: number | null };

export type SharePermission = "view" | "edit";

export type Space = {
  ownerId: string;
  label: string;
  detail: string;
  permission: "own" | SharePermission;
};

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

export async function pruneExpiredAuthSettings(db: D1Database, now = Date.now()): Promise<void> {
  const result = await db
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'login_failures:%' OR key LIKE 'rate_limit:%'")
    .all<{ key: string; value: string }>();
  const staleKeys: string[] = [];
  const staleCutoff = now - 60 * 60 * 1000;
  for (const row of result.results ?? []) {
    try {
      const parsed = JSON.parse(row.value) as {
        count?: number;
        lockedUntil?: string | null;
        updatedAt?: string;
        resetAt?: string;
      };
      if (row.key.startsWith("rate_limit:")) {
        const resetAt = parsed.resetAt ? Date.parse(parsed.resetAt) : Number.NaN;
        if (Number.isNaN(resetAt) || resetAt <= now) staleKeys.push(row.key);
        continue;
      }
      const lockedUntil = parsed.lockedUntil ? Date.parse(parsed.lockedUntil) : Number.NaN;
      const activeLock = !Number.isNaN(lockedUntil) && lockedUntil > now;
      if (activeLock) continue;
      if ((parsed.count ?? 0) === 0) {
        staleKeys.push(row.key);
        continue;
      }
      const updatedAt = parsed.updatedAt ? Date.parse(parsed.updatedAt) : Number.NaN;
      const expiredLock = !Number.isNaN(lockedUntil) && lockedUntil <= now;
      if (expiredLock || (!Number.isNaN(updatedAt) && updatedAt <= staleCutoff)) {
        staleKeys.push(row.key);
      }
    } catch {
      staleKeys.push(row.key);
    }
  }
  if (!staleKeys.length) return;
  await runStatements(
    db,
    staleKeys.map((key) => db.prepare("DELETE FROM settings WHERE key = ?").bind(key)),
  );
}

export async function getTheme(db: D1Database, ownerId: string): Promise<"light" | "dark"> {
  return (await getSetting(db, themeKey(ownerId))) === "dark" ? "dark" : "light";
}

export async function setTheme(db: D1Database, ownerId: string, theme: "light" | "dark"): Promise<void> {
  await setSetting(db, themeKey(ownerId), theme);
}

export function themeKey(ownerId: string): string {
  return `theme:${ownerId}`;
}

export function baseIncomeKey(ownerId: string): string {
  return `base_income_cents:${ownerId}`;
}

export async function getOwnerSettings(db: D1Database, ownerId: string): Promise<{ baseIncomeCents: number | null; theme: "light" | "dark" }> {
  const baseKey = baseIncomeKey(ownerId);
  const tKey = themeKey(ownerId);
  const result = await db
    .prepare("SELECT key, value FROM settings WHERE key IN (?, ?)")
    .bind(baseKey, tKey)
    .all<{ key: string; value: string }>();
  let baseIncomeCents: number | null = null;
  let theme: "light" | "dark" = "light";
  for (const row of result.results ?? []) {
    if (row.key === baseKey) {
      const parsed = Number(row.value);
      baseIncomeCents = Number.isFinite(parsed) ? parsed : null;
    } else if (row.key === tKey && row.value === "dark") {
      theme = "dark";
    }
  }
  return { baseIncomeCents, theme };
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

export function recurringOriginNote(expenseId: string): string {
  return `origem:${expenseId}`;
}

export function sqlMarks(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

export function chunkIds(ids: readonly string[], size = 80): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

export async function runStatements(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
}

export async function nextSorts(db: D1Database, ownerId: string, monthIds: readonly string[]): Promise<Map<string, number>> {
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
