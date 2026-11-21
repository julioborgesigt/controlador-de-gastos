import {
  coercePayment,
  isVariableCost,
  noteWithChargeContext,
  noteWithFinalizedZero,
  noteWithSeries,
  planCardPurchase,
  seriesIdFromNote,
  type Expense,
  type PartialPayment,
  type Payment,
} from "../domain.ts";
import { EXPENSE_META_SET_SQL, chunkIds, expenseMetaParams, nextSorts, prepareInsertExpense, runStatements, sqlMarks } from "./core.ts";
import { listMonths } from "./months.ts";
import { getExpense } from "./expenses-read.ts";

export async function attachPartials(db: D1Database, ownerId: string, expenses: Expense[]): Promise<Expense[]> {
  const ids = expenses.map((expense) => expense.id);
  if (!ids.length) return expenses;
  const grouped = new Map<string, PartialPayment[]>();
  for (const part of chunkIds(ids, 80)) {
    const rows = await db
      .prepare(
        `SELECT id, expense_id, amount_cents, payment, card_label, installment, created_at
         FROM partial_payments WHERE owner_id = ? AND expense_id IN (${sqlMarks(part)}) ORDER BY created_at`,
      )
      .bind(ownerId, ...part)
      .all<{
        id: string;
        expense_id: string;
        amount_cents: number;
        payment: Payment;
        card_label: string | null;
        installment: string | null;
        created_at: string;
      }>();
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
    mode?: "installment" | "total";
    paidCount?: number;
    close?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [expense, known] = await Promise.all([
    getExpense(db, input.ownerId, input.expenseId),
    listMonths(db, input.ownerId),
  ]);
  if (!expense || expense.section !== "fixed") return { ok: false, error: "Gasto não encontrado." };
  if (expense.onCard) return { ok: false, error: "Esta conta já foi inteira para o cartão." };
  if (expense.paid) return { ok: false, error: "Esta despesa já foi encerrada." };
  const count = input.installmentCount;
  const paidCount = input.paidCount ?? 0;
  const mode = input.mode === "installment" ? "installment" : "total";
  const plan = planCardPurchase({
    startMonthId: input.invoiceMonthId,
    totalCount: count,
    paidCount,
    amountCents: input.amountCents,
    mode,
  });
  if (!plan.ok) return plan;
  if (plan.plan.schedule.some((part) => !known.some((month) => month.id === part.monthId))) {
    return { ok: false, error: "O parcelamento passa do período gerenciado. Aumente o período ou reduza as parcelas." };
  }
  const charged = plan.plan.schedule.reduce((sum, part) => sum + part.amountCents, 0);
  const partialId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const scheduleMonthIds = plan.plan.schedule.map((part) => part.monthId);
  const used = await nextSorts(db, input.ownerId, scheduleMonthIds);
  const note = noteWithSeries(
    noteWithChargeContext(`origem:${expense.id}\nparcial:${partialId}`, {
      purchaseDate: input.purchaseDate,
      referenceMonthId: expense.monthId,
    }),
    seriesIdFromNote(expense.note) || crypto.randomUUID(),
  );
  const statements: D1PreparedStatement[] = [];
  if (expense.payment === "card" && !isVariableCost(expense.note)) {
    statements.push(
      db
        .prepare("UPDATE expenses SET payment = 'pix', on_card = 0, card_label = NULL, paid = ? WHERE owner_id = ? AND id = ?")
        .bind(input.close ? 1 : 0, input.ownerId, expense.id),
    );
  } else if (input.close) {
    statements.push(
      db.prepare("UPDATE expenses SET paid = 1 WHERE owner_id = ? AND id = ?").bind(input.ownerId, expense.id),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO partial_payments
          (id, owner_id, expense_id, amount_cents, payment, card_label, installment, created_at)
         VALUES (?, ?, ?, ?, 'card', ?, ?, ?)`,
      )
      .bind(partialId, input.ownerId, expense.id, charged, input.cardLabel, count > 1 ? `${count} parcelas` : null, createdAt),
  );
  for (const part of plan.plan.schedule) {
    const sort = (used.get(part.monthId) ?? 0) + 1;
    used.set(part.monthId, sort);
    statements.push(
      prepareInsertExpense(db, {
        id: crypto.randomUUID(),
        ownerId: input.ownerId,
        monthId: part.monthId,
        name: input.name,
        section: "card",
        amountCents: part.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note,
        installment: part.installment,
        sortOrder: sort,
        createdAt,
      }),
    );
  }
  await runStatements(db, statements);
  return { ok: true };
}

export async function deletePartialPayment(db: D1Database, ownerId: string, expenseId: string, partialId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM partial_payments WHERE owner_id = ? AND expense_id = ? AND id = ?")
    .bind(ownerId, expenseId, partialId)
    .first<{ id: string }>();
  if (!row) return false;
  await db.batch([
    db.prepare("DELETE FROM expenses WHERE owner_id = ? AND partial_id = ?").bind(ownerId, partialId),
    db.prepare("DELETE FROM partial_payments WHERE owner_id = ? AND id = ?").bind(ownerId, partialId),
    db
      .prepare("UPDATE expenses SET paid = 0 WHERE owner_id = ? AND id = ? AND section = 'fixed'")
      .bind(ownerId, expenseId),
  ]);
  return true;
}

export async function undoExpensePayments(
  db: D1Database,
  ownerId: string,
  expenseId: string,
  scope: "last" | "all",
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const [expense, rows] = await Promise.all([
    getExpense(db, ownerId, expenseId),
    db
      .prepare("SELECT id FROM partial_payments WHERE owner_id = ? AND expense_id = ? ORDER BY created_at DESC, id DESC")
      .bind(ownerId, expenseId)
      .all<{ id: string }>(),
  ]);
  if (!expense || expense.section !== "fixed" || expense.onCard) {
    return { ok: false, error: "Este pagamento não se desfaz por aqui." };
  }
  const partialIds = (rows.results ?? []).map((row) => row.id);
  if (!partialIds.length) {
    if (!expense.paid) return { ok: false, error: "Não há pagamento para desfazer." };
    const nextNote = noteWithFinalizedZero(expense.note, false) || null;
    await db
      .prepare(`UPDATE expenses SET paid = 0, note = ?, ${EXPENSE_META_SET_SQL} WHERE owner_id = ? AND id = ?`)
      .bind(nextNote, ...expenseMetaParams(expense.section, nextNote), ownerId, expenseId)
      .run();
    return { ok: true, count: 1 };
  }
  const targets = scope === "all" ? partialIds : partialIds.slice(0, 1);
  const statements: D1PreparedStatement[] = [
    ...chunkIds(targets).map((part) =>
      db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND partial_id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
    ),
    ...chunkIds(targets).map((part) =>
      db.prepare(`DELETE FROM partial_payments WHERE owner_id = ? AND id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
    ),
    db
      .prepare("UPDATE expenses SET paid = 0 WHERE owner_id = ? AND id = ? AND section = 'fixed'")
      .bind(ownerId, expenseId),
  ];
  await runStatements(db, statements);
  return { ok: true, count: targets.length };
}

export async function deletePartialsForExpenses(db: D1Database, ownerId: string, expenseIds: readonly string[]): Promise<void> {
  if (!expenseIds.length) return;
  const statements: D1PreparedStatement[] = [
    ...chunkIds(expenseIds).map((part) =>
      db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND origin_expense_id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
    ),
    ...chunkIds(expenseIds).map((part) =>
      db.prepare(`DELETE FROM partial_payments WHERE owner_id = ? AND expense_id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
    ),
  ];
  await runStatements(db, statements);
}
