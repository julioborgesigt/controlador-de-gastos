import { computeTotals, monthCanSettle } from "../domain.ts";
import { chunkIds, getOwnerSettings, sqlMarks } from "./core.ts";
import { getMonth, listIncomeExtras, listMonths } from "./months.ts";
import { listCards } from "./cards.ts";
import { listExpenses } from "./expenses-read.ts";
import { attachPartials } from "./partials.ts";

async function livingInvoiceCharges(
  db: D1Database,
  ownerId: string,
  expenseIds: string[],
): Promise<Map<string, Array<{ monthId: string; amountCents: number }>>> {
  const grouped = new Map<string, Array<{ monthId: string; amountCents: number }>>();
  if (!expenseIds.length) return grouped;
  for (const part of chunkIds(expenseIds)) {
    const result = await db
      .prepare(
        `SELECT month_id, amount_cents, origin_expense_id
         FROM expenses
         WHERE owner_id = ? AND section = 'card' AND origin_expense_id IN (${sqlMarks(part)})`,
      )
      .bind(ownerId, ...part)
      .all<{ month_id: string; amount_cents: number; origin_expense_id: string | null }>();
    for (const row of result.results ?? []) {
      const origin = row.origin_expense_id;
      if (!origin) continue;
      const list = grouped.get(origin) ?? [];
      list.push({ monthId: row.month_id, amountCents: row.amount_cents });
      grouped.set(origin, list);
    }
  }
  return grouped;
}

export async function monthPayload(db: D1Database, ownerId: string, monthId: string) {
  const month = await getMonth(db, ownerId, monthId);
  if (!month) return null;
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
