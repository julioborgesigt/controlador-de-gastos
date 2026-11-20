import {
  cardDeletionEffects,
  editTargets,
  expenseDeleteTargets,
  invoiceShiftFromNote,
  isVariableCost,
  noteWithInvoiceShift,
  noteWithSeries,
  noteWithVariable,
  noteWithVisibleText,
  originExpenseId,
  planCardPurchase,
  resetTargets,
  sameAccount,
  seriesIdFromNote,
  visibleExpenseNote,
  type EditScope,
  type Payment,
  type Section,
} from "../domain.ts";
import { EXPENSE_META_SET_SQL, baseIncomeKey, chunkIds, expenseMetaParams, getSetting, nextSorts, prepareInsertExpense, runStatements, sqlMarks, themeKey } from "./core.ts";
import { ensureMonths, listMonths } from "./months.ts";
import { getExpense, listFixedExpenses, listSectionExpenses } from "./expenses-read.ts";
import { deletePartialsForExpenses } from "./partials.ts";

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
  const extraIds = selected.filter((item) => item.section === "extra").map((item) => item.id);
  if (extraIds.length) {
    await runStatements(
      db,
      chunkIds(extraIds).map((part) =>
        db
          .prepare(`DELETE FROM expenses WHERE owner_id = ? AND section = 'card' AND origin_expense_id IN (${sqlMarks(part)})`)
          .bind(ownerId, ...part),
      ),
    );
  }
  const fixedIds = selected.filter((item) => item.section === "fixed").map((item) => item.id);
  if (fixedIds.length) {
    await deletePartialsForExpenses(db, ownerId, fixedIds);
  }
  const deletedNotes = selected.map((item) => item.note);
  await runStatements(
    db,
    chunkIds(ids).map((part) =>
      db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
    ),
  );
  const left = await db
    .prepare("SELECT note FROM expenses WHERE owner_id = ? AND note IS NOT NULL")
    .bind(ownerId)
    .all<{ note: string }>();
  const effects = cardDeletionEffects(deletedNotes, (left.results ?? []).map((row) => row.note));
  const cleanupStatements: D1PreparedStatement[] = [];
  const resetOrigins = effects.resetOriginIds.filter((origin) => !ids.includes(origin));
  for (const part of chunkIds(resetOrigins)) {
    cleanupStatements.push(
      db
        .prepare(
          `UPDATE expenses SET payment = 'pix', on_card = 0, card_label = NULL, paid = 0
           WHERE owner_id = ? AND section = 'fixed' AND id IN (${sqlMarks(part)})`,
        )
        .bind(ownerId, ...part),
    );
  }
  if (effects.dropPartialIds.length) {
    const partialRows: Array<{ id: string; expense_id: string }> = [];
    for (const part of chunkIds(effects.dropPartialIds)) {
      const result = await db
        .prepare(`SELECT id, expense_id FROM partial_payments WHERE owner_id = ? AND id IN (${sqlMarks(part)})`)
        .bind(ownerId, ...part)
        .all<{ id: string; expense_id: string }>();
      partialRows.push(...(result.results ?? []));
    }
    const activePartials = partialRows.filter((row) => !ids.includes(row.expense_id));
    if (activePartials.length) {
      const dropIds = activePartials.map((row) => row.id);
      const affectedExpenseIds = [...new Set(activePartials.map((row) => row.expense_id))];
      for (const part of chunkIds(dropIds)) {
        cleanupStatements.push(
          db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND partial_id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
          db.prepare(`DELETE FROM partial_payments WHERE owner_id = ? AND id IN (${sqlMarks(part)})`).bind(ownerId, ...part),
        );
      }
      for (const part of chunkIds(affectedExpenseIds)) {
        cleanupStatements.push(
          db
            .prepare(`UPDATE expenses SET paid = 0 WHERE owner_id = ? AND section = 'fixed' AND id IN (${sqlMarks(part)})`)
            .bind(ownerId, ...part),
        );
      }
    }
  }
  if (cleanupStatements.length) await runStatements(db, cleanupStatements);
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
  const variable = current.section === "fixed" && input.payment === "card" && isVariableCost(input.note);
  const shift = current.section === "fixed" && input.payment === "card" ? invoiceShiftFromNote(input.note) : "mes";
  const statements: D1PreparedStatement[] = [];
  for (const row of targets) {
    let note = noteWithVisibleText(row.note, visible);
    if (current.section === "fixed") {
      note = noteWithInvoiceShift(noteWithVariable(note, variable), shift);
    }
    if (current.section === "card") {
      statements.push(
        db.prepare(
          `UPDATE expenses SET name = ?, amount_cents = ?, card_label = ?, note = ?, installment = ?, ${EXPENSE_META_SET_SQL} WHERE owner_id = ? AND id = ?`,
        ).bind(
          input.name,
          input.amountCents,
          input.cardLabel,
          note,
          row.id === current.id ? input.installment : row.installment,
          ...expenseMetaParams("card", note),
          input.ownerId,
          row.id,
        ),
      );
      continue;
    }
    if (input.payment !== "card") {
      statements.push(
        db.prepare(
          `UPDATE expenses SET name = ?, amount_cents = ?, payment = ?, on_card = 0, card_label = NULL, paid = ?, note = ?, ${EXPENSE_META_SET_SQL} WHERE owner_id = ? AND id = ?`,
        ).bind(
          input.name,
          input.amountCents,
          input.payment,
          row.onCard ? 0 : row.paid ? 1 : 0,
          note,
          ...expenseMetaParams("fixed", note),
          input.ownerId,
          row.id,
        ),
      );
      if (row.onCard) {
        statements.push(
          db.prepare("DELETE FROM expenses WHERE owner_id = ? AND section = 'card' AND origin_expense_id = ?").bind(input.ownerId, row.id),
        );
      }
      continue;
    }
    const clearCard = row.onCard && (variable || shift === "seguinte");
    statements.push(
      db.prepare(
        `UPDATE expenses SET name = ?, amount_cents = ?, payment = 'card', on_card = ?, card_label = ?, note = ?, ${EXPENSE_META_SET_SQL} WHERE owner_id = ? AND id = ?`,
      ).bind(
        input.name,
        input.amountCents,
        clearCard ? 0 : row.onCard ? 1 : 0,
        input.cardLabel,
        note,
        ...expenseMetaParams("fixed", note),
        input.ownerId,
        row.id,
      ),
    );
    if (clearCard) {
      statements.push(
        db.prepare("DELETE FROM expenses WHERE owner_id = ? AND section = 'card' AND origin_expense_id = ? AND partial_id IS NULL").bind(input.ownerId, row.id),
      );
    } else if (row.onCard) {
      statements.push(
        db.prepare("UPDATE expenses SET name = ?, amount_cents = ?, card_label = ? WHERE owner_id = ? AND section = 'card' AND origin_expense_id = ? AND partial_id IS NULL")
          .bind(input.name, input.amountCents, input.cardLabel, input.ownerId, row.id),
      );
    }
  }
  await runStatements(db, statements);
  return { ok: true, count: targets.length };
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
  const section: Section = input.section === "fixed" ? "card" : input.section;
  const inserts: D1PreparedStatement[] = [];
  for (const part of plan.plan.schedule) {
    const sort = (used.get(part.monthId) ?? 0) + 1;
    used.set(part.monthId, sort);
    inserts.push(
      prepareInsertExpense(db, {
        id: crypto.randomUUID(),
        ownerId: input.ownerId,
        monthId: part.monthId,
        name: input.name,
        section,
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
  await runStatements(db, inserts);
  return { ok: true };
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
