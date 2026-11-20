import {
  chargedInvoiceMonth,
  computeTotals,
  isPlannedCost,
  monthCanSettle,
  noteWithChargeContext,
  originExpenseId,
  purchaseMonthFromNote,
} from "../domain.ts";
import { getOwnerSettings, mapExpense, type ExpenseRow } from "./core.ts";
import { getMonth, listIncomeExtras, listMonths } from "./months.ts";
import { listCards } from "./cards.ts";
import { listExpenses } from "./expenses-read.ts";
import { attachPartials, clearOrphanCardPartials } from "./partials.ts";
import { insertCardPurchase } from "./expenses.ts";

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

function purchaseDateFromNote(note: string | null | undefined): string {
  const line = String(note || "").split("\n").map((item) => item.trim()).find((item) => item.startsWith("compra:"));
  const value = line ? line.slice("compra:".length) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function placeExtrasOnPurchaseMonth(db: D1Database, ownerId: string): Promise<void> {
  const rows = await db
    .prepare(
      "SELECT * FROM expenses WHERE owner_id = ? AND section = 'extra' AND payment = 'card' AND installment IS NULL AND note LIKE '%compra:%' AND note NOT LIKE '%fatura:%'",
    )
    .bind(ownerId)
    .all<ExpenseRow>();
  for (const row of rows.results ?? []) {
    const expense = mapExpense(row);
    if (expense.installment || chargedInvoiceMonth(expense.note)) continue;
    const purchaseMonth = purchaseMonthFromNote(expense.note);
    if (!purchaseMonth || purchaseMonth === expense.monthId) continue;
    if (!(await getMonth(db, ownerId, purchaseMonth))) continue;
    const marker = isPlannedCost(expense.note) ? "tipo:planejado" : "tipo:imprevisto";
    const nextNote = [marker, `fatura:${expense.monthId}`, `ref:${purchaseMonth}`].join("\n");
    const claimed = await db
      .prepare("UPDATE expenses SET month_id = ?, note = ? WHERE owner_id = ? AND id = ? AND month_id = ? AND (note IS NULL OR note NOT LIKE '%fatura:%')")
      .bind(purchaseMonth, nextNote, ownerId, expense.id, expense.monthId)
      .run();
    if ((claimed.meta.changes ?? 0) === 0) continue;
    const created = await insertCardPurchase(db, {
      ownerId,
      startMonthId: expense.monthId,
      name: expense.name,
      section: "card",
      payment: "card",
      cardLabel: expense.cardLabel,
      note: noteWithChargeContext(`${marker}\norigem:${expense.id}`, {
        purchaseDate: purchaseDateFromNote(expense.note),
        referenceMonthId: purchaseMonth,
      }),
      totalCount: 1,
      paidCount: 0,
      amountCents: expense.amountCents,
      mode: "installment",
    });
    if (!created.ok) {
      await db.prepare("UPDATE expenses SET month_id = ?, note = ? WHERE owner_id = ? AND id = ?").bind(expense.monthId, expense.note, ownerId, expense.id).run();
    }
  }
}

const reconciledByDb = new WeakMap<D1Database, Set<string>>();
const reconcilingByDb = new WeakMap<D1Database, Map<string, Promise<void>>>();

async function reconcileOwnerOnce(db: D1Database, ownerId: string): Promise<void> {
  let done = reconciledByDb.get(db);
  if (!done) {
    done = new Set<string>();
    reconciledByDb.set(db, done);
  }
  if (done.has(ownerId)) return;
  let inflightMap = reconcilingByDb.get(db);
  if (!inflightMap) {
    inflightMap = new Map<string, Promise<void>>();
    reconcilingByDb.set(db, inflightMap);
  }
  const inflight = inflightMap.get(ownerId);
  if (inflight) {
    await inflight;
    return;
  }
  const task = (async () => {
    await placeExtrasOnPurchaseMonth(db, ownerId);
    await clearOrphanCardPartials(db, ownerId);
    done.add(ownerId);
  })().finally(() => {
    inflightMap.delete(ownerId);
  });
  inflightMap.set(ownerId, task);
  await task;
}

export async function monthPayload(db: D1Database, ownerId: string, monthId: string) {
  const month = await getMonth(db, ownerId, monthId);
  if (!month) return null;
  await reconcileOwnerOnce(db, ownerId);
  const [rawExpenses, cards, incomeExtras, months, ownerSettings] = await Promise.all([
    listExpenses(db, ownerId, monthId),
    listCards(db, ownerId),
    listIncomeExtras(db, ownerId),
    listMonths(db, ownerId),
    getOwnerSettings(db, ownerId),
  ]);
  const fixedIds = rawExpenses.filter((expense) => expense.section === "fixed").map((expense) => expense.id);
  const [expenses, charges] = await Promise.all([
    attachPartials(db, ownerId, rawExpenses),
    livingInvoiceCharges(db, ownerId, fixedIds),
  ]);
  const expensesWithCharges = expenses.map((expense) => ({ ...expense, charges: charges.get(expense.id) ?? [] }));
  const extraIncomeCents = incomeExtras
    .filter((extra) => extra.monthId === monthId)
    .reduce((sum, extra) => sum + extra.amountCents, 0);
  const incomeCents = month.income_cents + extraIncomeCents;
  const totals = computeTotals(expensesWithCharges, incomeCents);
  const settled = monthCanSettle(totals);
  if (settled !== (month.settled === 1)) {
    await db.prepare("UPDATE months SET settled = ? WHERE owner_id = ? AND id = ?").bind(settled ? 1 : 0, ownerId, monthId).run();
  }
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
    baseIncomeCents: ownerSettings.baseIncomeCents,
    totals,
    theme: ownerSettings.theme,
  };
}
