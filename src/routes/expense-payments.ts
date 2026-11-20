import {
  isVariableCost,
  livingCardChargeKind,
  noteWithFinalizedZero,
  resolveCardLabel,
} from "../domain.ts";
import {
  addLivingCardPartial,
  clearLivingCardCharges,
  deletePartialPayment,
  getExpense,
  getMonth,
  insertPartialPayment,
  listCards,
  monthPayload,
  payLivingSeriesOnCard,
  undoExpensePayments,
} from "../db.ts";
import { isCents, isMonthId, readJson, requireWriter, withAccess, type App } from "../http.ts";

export function registerExpensePaymentRoutes(app: App): void {
  app.post("/api/expenses/:id/card-payment", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const current = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!current) return c.json({ error: "Gasto não encontrado." }, 404);
    const body = await readJson(c);
    const cards = await listCards(c.env.DB, writer.scope.ownerId);
    const card = resolveCardLabel(cards, typeof body.cardLabel === "string" ? body.cardLabel : null, true);
    if (!card.ok) return c.json({ error: card.error }, 400);
    if (!isCents(body.amountCents) || body.amountCents <= 0) return c.json({ error: "Informe um valor maior que zero." }, 400);
    if (typeof body.installmentCount !== "number" || !Number.isInteger(body.installmentCount)) {
      return c.json({ error: "Informe a quantidade de parcelas." }, 400);
    }
    const invoiceMonthId = isMonthId(body.invoiceMonthId) ? body.invoiceMonthId : current.monthId;
    if (!(await getMonth(c.env.DB, writer.scope.ownerId, invoiceMonthId))) {
      return c.json({ error: "Escolha o mês da fatura." }, 400);
    }
    if (body.amountMode !== undefined && body.amountMode !== "installment" && body.amountMode !== "total") {
      return c.json({ error: "Diga se o valor é da parcela ou do total." }, 400);
    }
    const scope = body.scope === "following" ? "following" : "month";
    const partialRow = await c.env.DB
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM partial_payments WHERE owner_id = ? AND expense_id = ?")
      .bind(writer.scope.ownerId, current.id)
      .first<{ total: number }>();
    const already = Number(partialRow?.total) || 0;
    const charged = body.amountMode === "total" || body.installmentCount <= 1
      ? body.amountCents
      : body.amountCents * body.installmentCount;
    const variable = isVariableCost(current.note);
    if (variable || livingCardChargeKind({ plannedCents: current.amountCents, alreadyCents: already, chargedCents: charged }) === "partial") {
      const added = await addLivingCardPartial(c.env.DB, {
        ownerId: writer.scope.ownerId,
        expenseId: current.id,
        amountCents: charged,
        cardLabel: card.cardLabel || "",
        installmentCount: body.installmentCount,
        invoiceMonthId,
        name: current.name,
        close: body.close === true,
      });
      if (!added.ok) return c.json({ error: added.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, current.monthId), writer.scope));
    }
    const paid = await payLivingSeriesOnCard(c.env.DB, {
      ownerId: writer.scope.ownerId,
      expenseId: current.id,
      scope,
      cardLabel: card.cardLabel || "",
      alias: typeof body.alias === "string" ? body.alias : "",
      amountCents: body.amountCents,
      totalCount: body.installmentCount,
      startMonthId: invoiceMonthId,
      mode: body.amountMode === "total" ? "total" : "installment",
    });
    if (!paid.ok) return c.json({ error: paid.error }, 400);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, current.monthId), writer.scope));
  });

  app.delete("/api/expenses/:id/card-payment", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const scope = c.req.query("scope") === "series" ? "series" : "month";
    const cleared = await clearLivingCardCharges(c.env.DB, writer.scope.ownerId, c.req.param("id"), scope);
    if (!cleared.ok) return c.json({ error: cleared.error }, 404);
    const current = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!current) return c.json({ error: "Gasto não encontrado." }, 404);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, current.monthId), writer.scope));
  });

  app.post("/api/expenses/:id/partials", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const expense = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!expense || expense.section !== "fixed" || expense.onCard) {
      return c.json({ error: "O pagamento parcial é para um custo de vida que ainda não foi inteiro para o cartão." }, 400);
    }
    if (expense.paid) return c.json({ error: "Esta despesa já foi encerrada." }, 400);
    const body = await readJson(c);
    const payment = body.payment === "card" ? "card" : body.payment === "pix" ? "pix" : "";
    if (!payment) return c.json({ error: "Escolha Pix ou crédito." }, 400);
    if (!isCents(body.amountCents) || body.amountCents <= 0) return c.json({ error: "Informe o valor pago." }, 400);
    if (payment === "card") {
      const cards = await listCards(c.env.DB, writer.scope.ownerId);
      const card = resolveCardLabel(cards, typeof body.cardLabel === "string" ? body.cardLabel : null, true);
      if (!card.ok) return c.json({ error: card.error }, 400);
      const count = typeof body.installmentCount === "number" ? body.installmentCount : 1;
      if (!Number.isInteger(count) || count < 1 || count > 48) return c.json({ error: "Informe de 1 a 48 parcelas." }, 400);
      const invoiceMonthId = isMonthId(body.invoiceMonthId) ? body.invoiceMonthId : expense.monthId;
      const added = await addLivingCardPartial(c.env.DB, {
        ownerId: writer.scope.ownerId,
        expenseId: expense.id,
        amountCents: body.amountCents,
        cardLabel: card.cardLabel || "",
        installmentCount: count,
        invoiceMonthId,
        name: expense.name,
      });
      if (!added.ok) return c.json({ error: added.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, expense.monthId), writer.scope), 201);
    }
    await insertPartialPayment(c.env.DB, {
      ownerId: writer.scope.ownerId,
      expenseId: expense.id,
      amountCents: body.amountCents,
      payment,
      cardLabel: null,
      installment: null,
    });
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, expense.monthId), writer.scope), 201);
  });

  app.delete("/api/expenses/:id/partials/:partialId", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const expense = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!expense) return c.json({ error: "Gasto não encontrado." }, 404);
    const removed = await deletePartialPayment(c.env.DB, writer.scope.ownerId, expense.id, c.req.param("partialId"));
    if (!removed) return c.json({ error: "Pagamento parcial não encontrado." }, 404);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, expense.monthId), writer.scope));
  });

  app.delete("/api/expenses/:id/payments", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const expense = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!expense) return c.json({ error: "Gasto não encontrado." }, 404);
    const scope = c.req.query("scope") === "all" ? "all" : "last";
    const undone = await undoExpensePayments(c.env.DB, writer.scope.ownerId, expense.id, scope);
    if (!undone.ok) return c.json({ error: undone.error }, 400);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, expense.monthId), writer.scope));
  });

  app.post("/api/expenses/:id/settle", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const expense = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!expense || expense.section !== "fixed" || expense.onCard) {
      return c.json({ error: "Esta despesa não encerra por aqui." }, 400);
    }
    if (expense.paid) return c.json({ error: "Esta despesa já foi encerrada." }, 400);
    const body = await readJson(c);
    const partials = await c.env.DB
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n FROM partial_payments WHERE owner_id = ? AND expense_id = ?")
      .bind(writer.scope.ownerId, expense.id)
      .first<{ total: number; n: number }>();
    const hasPartials = Number(partials?.n) > 0;
    const already = Number(partials?.total) || 0;
    if (body.noAddition === true) {
      const finalizedNote = hasPartials
        ? (noteWithFinalizedZero(expense.note, false) || null)
        : noteWithFinalizedZero(expense.note, true);
      await c.env.DB.prepare("UPDATE expenses SET paid = 1, note = ? WHERE owner_id = ? AND id = ?").bind(finalizedNote, writer.scope.ownerId, expense.id).run();
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, expense.monthId), writer.scope));
    }
    const amountCents = body.useRegistered === true ? Math.max(0, expense.amountCents - already) : body.amountCents;
    if (!isCents(amountCents) || amountCents <= 0) return c.json({ error: "Informe o valor pago." }, 400);
    const statements: D1PreparedStatement[] = [];
    if (hasPartials || body.useRegistered !== true) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO partial_payments
            (id, owner_id, expense_id, amount_cents, payment, card_label, installment, created_at)
           VALUES (?, ?, ?, ?, 'pix', NULL, NULL, ?)`,
        ).bind(crypto.randomUUID(), writer.scope.ownerId, expense.id, amountCents, new Date().toISOString()),
      );
    }
    statements.push(
      c.env.DB
        .prepare("UPDATE expenses SET paid = 1, amount_cents = ? WHERE owner_id = ? AND id = ?")
        .bind(hasPartials ? expense.amountCents : amountCents, writer.scope.ownerId, expense.id),
    );
    await c.env.DB.batch(statements);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, expense.monthId), writer.scope));
  });
}
