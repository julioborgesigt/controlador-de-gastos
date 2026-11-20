import {
  livingCardSendTargets,
  livingCardUndoTargets,
  noteWithChargeContext,
  noteWithSeries,
  planCardPurchase,
  seriesIdFromNote,
  type Expense,
  type Payment,
} from "../domain.ts";
import { chunkIds, nextSorts, prepareInsertExpense, recurringOriginNote, runStatements, sqlMarks } from "./core.ts";
import { ensureMonths } from "./months.ts";
import { getExpense, listFixedExpenses } from "./expenses-read.ts";
import { insertCardPurchase } from "./expenses.ts";

export async function clearRecurringCardLines(db: D1Database, ownerId: string, expenseId: string): Promise<void> {
  await db
    .prepare("DELETE FROM expenses WHERE owner_id = ? AND origin_expense_id = ?")
    .bind(ownerId, expenseId)
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
    paidCount?: number;
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
  const paidCount = input.paidCount ?? 0;
  const plan = planCardPurchase({
    startMonthId,
    totalCount: input.totalCount,
    paidCount,
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
    paidCount,
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
    statements.push(
      db.prepare("DELETE FROM expenses WHERE owner_id = ? AND origin_expense_id = ?").bind(input.ownerId, charge.id),
      db.prepare("UPDATE expenses SET payment = 'card', on_card = 1, card_label = ?, paid = 1 WHERE owner_id = ? AND id = ?")
        .bind(input.cardLabel, input.ownerId, charge.id),
    );
    const sort = (used.get(charge.monthId) ?? 0) + 1;
    used.set(charge.monthId, sort);
    statements.push(
      prepareInsertExpense(db, {
        id: crypto.randomUUID(),
        ownerId: input.ownerId,
        monthId: charge.monthId,
        name: charge.name,
        section: "card",
        amountCents: charge.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: charge.note,
        installment: null,
        sortOrder: sort,
        createdAt,
      }),
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
    paidCount?: number;
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
      paidCount: own ? 0 : input.paidCount,
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

export async function createCardSpendWithAnchor(
  db: D1Database,
  input: {
    ownerId: string;
    anchor: {
      monthId: string;
      name: string;
      section: "fixed" | "extra";
      amountCents: number;
      payment: Payment;
      onCard: boolean;
      cardLabel: string | null;
      paid: boolean;
      note: string;
    };
    charge: {
      startMonthId: string;
      name: string;
      cardLabel: string;
      notePrefix?: string;
      purchaseDate?: string | null;
      referenceMonthId: string;
      totalCount: number;
      paidCount: number;
      amountCents: number;
      mode: "installment" | "total";
    };
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = planCardPurchase({
    startMonthId: input.charge.startMonthId,
    totalCount: input.charge.totalCount,
    paidCount: input.charge.paidCount,
    amountCents: input.charge.amountCents,
    mode: input.charge.mode,
  });
  if (!plan.ok) return plan;
  const allMonthIds = [...new Set([input.anchor.monthId, ...plan.plan.schedule.map((part) => part.monthId)])];
  await ensureMonths(db, input.ownerId, allMonthIds);
  const used = await nextSorts(db, input.ownerId, allMonthIds);
  const createdAt = new Date().toISOString();
  const anchorId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  const anchorNote = noteWithSeries(input.anchor.note, seriesId);
  const anchorSort = (used.get(input.anchor.monthId) ?? 0) + 1;
  used.set(input.anchor.monthId, anchorSort);
  const statements: D1PreparedStatement[] = [
    prepareInsertExpense(db, {
      id: anchorId,
      ownerId: input.ownerId,
      monthId: input.anchor.monthId,
      name: input.anchor.name,
      section: input.anchor.section,
      amountCents: input.anchor.amountCents,
      payment: input.anchor.payment,
      onCard: input.anchor.onCard,
      cardLabel: input.anchor.cardLabel,
      paid: input.anchor.paid,
      note: anchorNote,
      installment: null,
      sortOrder: anchorSort,
      createdAt,
    }),
  ];
  const baseChargeNote = [input.charge.notePrefix, recurringOriginNote(anchorId)].filter(Boolean).join("\n");
  const chargeNote = noteWithSeries(
    noteWithChargeContext(baseChargeNote, {
      purchaseDate: input.charge.purchaseDate,
      referenceMonthId: input.charge.referenceMonthId,
    }),
    seriesId,
  );
  for (const part of plan.plan.schedule) {
    const sort = (used.get(part.monthId) ?? 0) + 1;
    used.set(part.monthId, sort);
    statements.push(
      prepareInsertExpense(db, {
        id: crypto.randomUUID(),
        ownerId: input.ownerId,
        monthId: part.monthId,
        name: input.charge.name,
        section: "card",
        amountCents: part.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.charge.cardLabel,
        paid: false,
        note: chargeNote,
        installment: part.installment,
        sortOrder: sort,
        createdAt,
      }),
    );
  }
  await runStatements(db, statements);
  return { ok: true };
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
  const statements: D1PreparedStatement[] = [
    ...chunkIds(ids).map((part) =>
      db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND origin_expense_id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
    ),
    ...chunkIds(ids).map((part) =>
      db
        .prepare(
          `UPDATE expenses SET payment = 'pix', on_card = 0, card_label = NULL, paid = 0
           WHERE owner_id = ? AND id IN (${sqlMarks(part)})`,
        )
        .bind(ownerId, ...part),
    ),
  ];
  await runStatements(db, statements);
  return { ok: true, count: ids.length };
}
