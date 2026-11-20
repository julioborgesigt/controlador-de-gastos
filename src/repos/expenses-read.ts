import { chargedInvoiceMonth, type Expense, type Section } from "../domain.ts";
import { mapExpense, type ExpenseRow } from "./core.ts";

export async function listCardPurchasesInMonth(db: D1Database, ownerId: string, monthId: string): Promise<Expense[]> {
  if (!/^\d{4}-\d{2}$/.test(monthId)) return [];
  const result = await db
    .prepare(
      `SELECT * FROM expenses
       WHERE owner_id = ? AND reference_month_id = ?
         AND (section = 'card' OR (section = 'extra' AND payment = 'card'))
       ORDER BY month_id, name`,
    )
    .bind(ownerId, monthId)
    .all<ExpenseRow>();
  return (result.results ?? [])
    .map(mapExpense)
    .filter((expense) => {
      const note = String(expense.note || "");
      if (note.includes("parcelamento:") || note.includes("quitado-cartao:")) return false;
      const invoiceMonth = chargedInvoiceMonth(note);
      if (expense.section === "extra" && invoiceMonth && invoiceMonth !== expense.monthId) return false;
      return true;
    });
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

export async function listSectionExpenses(db: D1Database, ownerId: string, section: Section): Promise<Expense[]> {
  const result = await db
    .prepare("SELECT * FROM expenses WHERE owner_id = ? AND section = ?")
    .bind(ownerId, section)
    .all<ExpenseRow>();
  return (result.results ?? []).map(mapExpense);
}
