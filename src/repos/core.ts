import {
  chargedInvoiceMonth,
  coercePayment,
  expenseTrack,
  invoiceShiftFromNote,
  isFinalizedWithoutSpend,
  isPlannedCost,
  isVariableCost,
  originExpenseId,
  partialIdFromNote,
  purchaseMonthFromNote,
  seriesIdFromNote,
  type Expense,
  type Payment,
  type Section,
} from "../domain.ts";
import { isImprevistoNote, noteMarker } from "../../public/shared/note-markers.js";

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
  series_id?: string | null;
  origin_expense_id?: string | null;
  partial_id?: string | null;
  track?: string | null;
  cost_kind?: string | null;
  invoice_shift?: string | null;
  invoice_month_id?: string | null;
  reference_month_id?: string | null;
  purchase_date?: string | null;
  finalized_zero?: number | null;
  import_batch_id?: string | null;
};

export type ExpenseMetadata = {
  seriesId: string | null;
  originExpenseId: string | null;
  partialId: string | null;
  track: string | null;
  costKind: string | null;
  invoiceShift: "mes" | "seguinte";
  invoiceMonthId: string | null;
  referenceMonthId: string | null;
  purchaseDate: string | null;
  finalizedZero: number;
};

export function extractExpenseMetadata(section: string, note: string | null | undefined): ExpenseMetadata {
  const raw = note ?? null;
  const purchaseRaw = noteMarker(raw, "compra:");
  const purchaseDate = /^\d{4}-\d{2}-\d{2}$/.test(purchaseRaw) ? purchaseRaw : null;
  const refRaw = noteMarker(raw, "ref:");
  const refMonth = /^\d{4}-\d{2}$/.test(refRaw) ? refRaw : null;
  const purchaseMonth = purchaseMonthFromNote(raw) || null;
  const track = isPlannedCost(raw)
    ? "planejado"
    : isImprevistoNote(raw)
      ? "imprevisto"
      : expenseTrack({ section: section as Section, note: raw }) || null;
  return {
    seriesId: seriesIdFromNote(raw) || null,
    originExpenseId: originExpenseId(raw) || null,
    partialId: partialIdFromNote(raw) || null,
    track,
    costKind: isVariableCost(raw) ? "variavel" : null,
    invoiceShift: invoiceShiftFromNote(raw),
    invoiceMonthId: chargedInvoiceMonth(raw) || null,
    referenceMonthId: purchaseMonth ?? refMonth,
    purchaseDate,
    finalizedZero: isFinalizedWithoutSpend(raw) ? 1 : 0,
  };
}

export const EXPENSE_META_SET_SQL =
  "series_id = ?, origin_expense_id = ?, partial_id = ?, track = ?, cost_kind = ?, invoice_shift = ?, invoice_month_id = ?, reference_month_id = ?, purchase_date = ?, finalized_zero = ?";

export function expenseMetaParams(section: string, note: string | null | undefined): Array<string | number | null> {
  const meta = extractExpenseMetadata(section, note);
  return [
    meta.seriesId,
    meta.originExpenseId,
    meta.partialId,
    meta.track,
    meta.costKind,
    meta.invoiceShift,
    meta.invoiceMonthId,
    meta.referenceMonthId,
    meta.purchaseDate,
    meta.finalizedZero,
  ];
}

export function prepareInsertExpense(
  db: D1Database,
  input: {
    id: string;
    ownerId: string;
    monthId: string;
    name: string;
    section: Section;
    amountCents: number;
    payment: Payment;
    onCard: boolean | number;
    cardLabel: string | null;
    paid: boolean | number;
    note: string | null;
    installment: string | null;
    sortOrder: number;
    source?: "user" | "sheet";
    createdAt: string;
    importKey?: string | null;
    importBatchId?: string | null;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO expenses
        (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at,
         series_id, origin_expense_id, partial_id, track, cost_kind, invoice_shift, invoice_month_id, reference_month_id, purchase_date, finalized_zero, import_key, import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.ownerId,
      input.monthId,
      input.name,
      input.section,
      input.amountCents,
      input.payment,
      input.onCard ? 1 : 0,
      input.cardLabel,
      input.paid ? 1 : 0,
      input.note,
      input.installment,
      input.sortOrder,
      input.source ?? "user",
      input.createdAt,
      ...expenseMetaParams(input.section, input.note),
      input.importKey ?? null,
      input.importBatchId ?? null,
    );
}

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

export function lastCsvImportBatchKey(ownerId: string): string {
  return `last_csv_import_batch:${ownerId}`;
}

export async function getOwnerSettings(
  db: D1Database,
  ownerId: string,
): Promise<{ baseIncomeCents: number | null; theme: "light" | "dark"; lastCsvImportBatchId: string | null }> {
  const baseKey = baseIncomeKey(ownerId);
  const tKey = themeKey(ownerId);
  const batchKey = lastCsvImportBatchKey(ownerId);
  const result = await db
    .prepare("SELECT key, value FROM settings WHERE key IN (?, ?, ?)")
    .bind(baseKey, tKey, batchKey)
    .all<{ key: string; value: string }>();
  let baseIncomeCents: number | null = null;
  let theme: "light" | "dark" = "light";
  let lastCsvImportBatchId: string | null = null;
  for (const row of result.results ?? []) {
    if (row.key === baseKey) {
      const parsed = Number(row.value);
      baseIncomeCents = Number.isFinite(parsed) ? parsed : null;
    } else if (row.key === tKey && row.value === "dark") {
      theme = "dark";
    } else if (row.key === batchKey && row.value) {
      lastCsvImportBatchId = row.value;
    }
  }
  return { baseIncomeCents, theme, lastCsvImportBatchId };
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
    importBatchId: row.import_batch_id ?? null,
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
  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
}

export async function nextSorts(db: D1Database, ownerId: string, monthIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(monthIds)];
  const map = new Map<string, number>();
  if (!ids.length) return map;
  for (const part of chunkIds(ids, 80)) {
    const sorts = await db
      .prepare(
        `SELECT month_id, COALESCE(MAX(sort_order), 0) AS max_sort
         FROM expenses WHERE owner_id = ? AND month_id IN (${sqlMarks(part)}) GROUP BY month_id`,
      )
      .bind(ownerId, ...part)
      .all<{ month_id: string; max_sort: number }>();
    for (const row of sorts.results ?? []) {
      map.set(row.month_id, Number(row.max_sort) || 0);
    }
  }
  return map;
}
