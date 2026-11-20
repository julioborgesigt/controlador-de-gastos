import {
  invoiceShiftFromNote,
  isPlannedCost,
  isVariableCost,
  noteWithChargeContext,
  noteWithFinalizedZero,
  noteWithPlanned,
  noteWithVariable,
  planCardPurchase,
  resolveCardLabel,
} from "../domain.ts";
import {
  EXPENSE_META_SET_SQL,
  addLivingCardPartial,
  applySeriesEdit,
  createCardSpendWithAnchor,
  deleteMatchingExpenses,
  expenseMetaParams,
  getExpense,
  getMonth,
  insertCardPurchase,
  insertPartialPayment,
  listCards,
  listMonths,
  monthPayload,
  reclassifyExpense,
} from "../db.ts";
import { isCents, isMonthId, readJson, requireWriter, withAccess, type App } from "../http.ts";
import {
  expenseWithCard,
  insertRepeatedExpenses,
  readCardSpendInstallment,
  readInstallmentPlan,
  recurringMonthIds,
} from "./expense-helpers.ts";

export function registerExpenseRoutes(app: App): void {
  app.post("/api/card-spend", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) return c.json({ error: "Dê um nome ao gasto, com até 120 caracteres." }, 400);
    if (!isCents(body.amountCents) || body.amountCents <= 0) return c.json({ error: "Informe um valor maior que zero." }, 400);
    const kind = body.classification;
    if (kind !== "casa" && kind !== "imprevisto" && kind !== "planejado") {
      return c.json({ error: "Escolha Custo de vida, Imprevisto ou Planejado." }, 400);
    }
    if (!isMonthId(body.invoiceMonthId) || !(await getMonth(c.env.DB, writer.scope.ownerId, body.invoiceMonthId))) {
      return c.json({ error: "Escolha o mês da fatura." }, 400);
    }
    const cards = await listCards(c.env.DB, writer.scope.ownerId);
    const card = resolveCardLabel(cards, typeof body.cardLabel === "string" ? body.cardLabel : null, true);
    if (!card.ok) return c.json({ error: card.error }, 400);
    const purchaseDate = typeof body.purchaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.purchaseDate) ? body.purchaseDate : "";
    const installment = readCardSpendInstallment(body);
    if (!installment.ok) return c.json({ error: installment.error }, 400);
    const plan = installment.totalCount > 1
      ? planCardPurchase({
        startMonthId: body.invoiceMonthId,
        totalCount: installment.totalCount,
        paidCount: installment.paidCount,
        amountCents: body.amountCents,
        mode: installment.mode,
      })
      : null;
    if (plan && !plan.ok) return c.json({ error: plan.error }, 400);
    if (plan?.ok) {
      const known = await listMonths(c.env.DB, writer.scope.ownerId);
      if (plan.plan.schedule.some((part) => !known.some((month) => month.id === part.monthId))) {
        return c.json({ error: "O parcelamento passa do período gerenciado. Aumente o período ou reduza as parcelas." }, 400);
      }
    }
    const scheduledCents = plan?.ok
      ? plan.plan.schedule.reduce((sum, part) => sum + part.amountCents, 0)
      : body.amountCents;
    const costMonthId = isMonthId(body.costMonthId) ? body.costMonthId : "";
    if (costMonthId && !(await getMonth(c.env.DB, writer.scope.ownerId, costMonthId))) {
      return c.json({ error: "Escolha o mês do custo de vida." }, 400);
    }
    const linkId = typeof body.linkExpenseId === "string" ? body.linkExpenseId.trim() : "";
    if (linkId && kind !== "casa") return c.json({ error: "Só um custo de vida pode receber o vínculo." }, 400);
    if (kind === "casa" && linkId) {
      const origin = await getExpense(c.env.DB, writer.scope.ownerId, linkId);
      if (!origin || origin.section !== "fixed") return c.json({ error: "Escolha um custo de vida para vincular." }, 400);
      if (costMonthId && origin.monthId !== costMonthId) return c.json({ error: "Esse custo de vida é de outro mês." }, 400);
      const added = await addLivingCardPartial(c.env.DB, {
        ownerId: writer.scope.ownerId,
        expenseId: origin.id,
        amountCents: body.amountCents,
        cardLabel: card.cardLabel || "",
        installmentCount: installment.totalCount,
        invoiceMonthId: body.invoiceMonthId,
        name,
        purchaseDate,
        mode: installment.mode,
        paidCount: installment.paidCount,
      });
      if (!added.ok) return c.json({ error: added.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, origin.monthId), writer.scope), 201);
    }
    if (kind === "casa") {
      const livingMonthId = costMonthId || body.invoiceMonthId;
      const created = await createCardSpendWithAnchor(c.env.DB, {
        ownerId: writer.scope.ownerId,
        anchor: {
          monthId: livingMonthId,
          name,
          section: "fixed",
          amountCents: scheduledCents,
          payment: "card",
          onCard: true,
          cardLabel: card.cardLabel,
          paid: true,
          note: "",
        },
        charge: {
          startMonthId: body.invoiceMonthId,
          name,
          cardLabel: card.cardLabel || "",
          purchaseDate,
          referenceMonthId: livingMonthId,
          totalCount: installment.totalCount,
          paidCount: installment.paidCount,
          amountCents: body.amountCents,
          mode: installment.mode,
        },
      });
      if (!created.ok) return c.json({ error: created.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, livingMonthId), writer.scope), 201);
    }
    const occurrenceMonthId = costMonthId || body.invoiceMonthId;
    const trackNote = kind === "planejado" ? "tipo:planejado" : "tipo:imprevisto";
    const chargeNote = noteWithChargeContext(kind === "planejado" ? noteWithPlanned("", true) : trackNote, {
      purchaseDate,
      referenceMonthId: occurrenceMonthId,
    });
    if (occurrenceMonthId !== body.invoiceMonthId) {
      const created = await createCardSpendWithAnchor(c.env.DB, {
        ownerId: writer.scope.ownerId,
        anchor: {
          monthId: occurrenceMonthId,
          name,
          section: "extra",
          amountCents: scheduledCents,
          payment: "card",
          onCard: false,
          cardLabel: card.cardLabel,
          paid: false,
          note: [trackNote, `fatura:${body.invoiceMonthId}`, `ref:${occurrenceMonthId}`].join("\n"),
        },
        charge: {
          startMonthId: body.invoiceMonthId,
          name,
          cardLabel: card.cardLabel || "",
          notePrefix: trackNote,
          purchaseDate,
          referenceMonthId: occurrenceMonthId,
          totalCount: installment.totalCount,
          paidCount: installment.paidCount,
          amountCents: body.amountCents,
          mode: installment.mode,
        },
      });
      if (!created.ok) return c.json({ error: created.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, occurrenceMonthId), writer.scope), 201);
    }
    if (installment.totalCount > 1) {
      const created = await insertCardPurchase(c.env.DB, {
        ownerId: writer.scope.ownerId,
        startMonthId: body.invoiceMonthId,
        name,
        section: "extra",
        payment: "card",
        cardLabel: card.cardLabel,
        note: chargeNote,
        totalCount: installment.totalCount,
        paidCount: installment.paidCount,
        amountCents: body.amountCents,
        mode: installment.mode,
      });
      if (!created.ok) return c.json({ error: created.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, body.invoiceMonthId), writer.scope), 201);
    }
    const inserted = await insertRepeatedExpenses(c.env.DB, {
      ownerId: writer.scope.ownerId,
      monthIds: [body.invoiceMonthId],
      name,
      section: "extra",
      amountCents: body.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: card.cardLabel,
      paid: false,
      note: chargeNote,
      installment: null,
      livingCard: false,
    });
    if (!inserted.ok) return c.json({ error: inserted.error }, 400);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, body.invoiceMonthId), writer.scope), 201);
  });

  app.post("/api/expenses", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    const parsed = await expenseWithCard(c.env.DB, writer.scope.ownerId, body);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (!isMonthId(body.monthId) || !(await getMonth(c.env.DB, writer.scope.ownerId, body.monthId))) {
      return c.json({ error: "Mês não encontrado." }, 404);
    }
    const classifiedNote = parsed.value.section === "extra"
      ? noteWithPlanned(parsed.value.note, body.kind === "planejado" || (body.kind !== "imprevisto" && isPlannedCost(parsed.value.note)))
      : parsed.value.note;
    const variableCard = body.costKind === "variavel" && parsed.value.section === "fixed";
    const plan = variableCard ? null : readInstallmentPlan(body.installmentPlan);
    if (plan) {
      if (!plan.ok) return c.json({ error: plan.error }, 400);
      if (parsed.value.section === "card") {
        return c.json({ error: "Lance o gasto em Custo de vida, Imprevisto ou Planejado." }, 400);
      }
      const created = await insertCardPurchase(c.env.DB, {
        ownerId: writer.scope.ownerId,
        startMonthId: body.monthId,
        name: parsed.value.name,
        section: parsed.value.section === "fixed" ? "card" : parsed.value.section,
        payment: "card",
        cardLabel: parsed.value.cardLabel,
        note: classifiedNote,
        totalCount: plan.totalCount,
        paidCount: plan.paidCount,
        amountCents: parsed.value.amountCents,
        mode: plan.mode,
      });
      if (!created.ok) return c.json({ error: created.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, body.monthId), writer.scope), 201);
    }
    const monthIds = recurringMonthIds(body, parsed.value.section);
    if (!monthIds.ok) return c.json({ error: monthIds.error }, 400);
    const intendsCard = parsed.value.section === "fixed" && parsed.value.payment === "card";
    if (intendsCard && !parsed.value.cardLabel) return c.json({ error: "Escolha o cartão." }, 400);
    if (intendsCard && parsed.value.amountCents <= 0) {
      return c.json({ error: "Informe um valor maior que zero." }, 400);
    }
    const inserted = await insertRepeatedExpenses(c.env.DB, {
      ownerId: writer.scope.ownerId,
      monthIds: monthIds.ids,
      name: parsed.value.name,
      section: parsed.value.section,
      amountCents: parsed.value.amountCents,
      payment: parsed.value.payment,
      onCard: parsed.value.section === "fixed" ? false : parsed.value.onCard,
      cardLabel: parsed.value.cardLabel,
      paid: parsed.value.section === "fixed" ? false : parsed.value.paid,
      note: variableCard ? noteWithVariable(classifiedNote, true) : classifiedNote,
      installment: parsed.value.installment,
      livingCard: false,
    });
    if (!inserted.ok) return c.json({ error: inserted.error }, 404);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, body.monthId), writer.scope), 201);
  });

  app.post("/api/cash-spend", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!isCents(body.amountCents) || body.amountCents <= 0) return c.json({ error: "Informe um valor maior que zero." }, 400);
    const kind = body.classification;
    if (kind !== "casa" && kind !== "imprevisto" && kind !== "planejado") {
      return c.json({ error: "Escolha Custo de vida, Imprevisto ou Planejado." }, 400);
    }
    if (!isMonthId(body.monthId) || !(await getMonth(c.env.DB, writer.scope.ownerId, body.monthId))) {
      return c.json({ error: "Escolha o mês." }, 400);
    }
    const linkId = typeof body.linkExpenseId === "string" ? body.linkExpenseId.trim() : "";
    if (kind === "casa") {
      if (!linkId) return c.json({ error: "Escolha o custo de vida que este Pix paga." }, 400);
      const origin = await getExpense(c.env.DB, writer.scope.ownerId, linkId);
      if (!origin || origin.section !== "fixed") return c.json({ error: "Escolha um custo de vida." }, 400);
      if (origin.paid || origin.onCard) return c.json({ error: "Este custo já foi encerrado." }, 400);
      await insertPartialPayment(c.env.DB, {
        ownerId: writer.scope.ownerId,
        expenseId: origin.id,
        amountCents: body.amountCents,
        payment: "pix",
        cardLabel: null,
        installment: null,
      });
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, origin.monthId), writer.scope), 201);
    }
    if (!name || name.length > 120) return c.json({ error: "Dê um nome ao gasto, com até 120 caracteres." }, 400);
    const inserted = await insertRepeatedExpenses(c.env.DB, {
      ownerId: writer.scope.ownerId,
      monthIds: [body.monthId],
      name,
      section: "extra",
      amountCents: body.amountCents,
      payment: "pix",
      onCard: false,
      cardLabel: null,
      paid: true,
      note: noteWithChargeContext(kind === "planejado" ? noteWithPlanned("", true) : "", { referenceMonthId: body.monthId }),
      installment: null,
      livingCard: false,
    });
    if (!inserted.ok) return c.json({ error: inserted.error }, 400);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, body.monthId), writer.scope), 201);
  });

  app.patch("/api/expenses/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const current = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!current) return c.json({ error: "Gasto não encontrado." }, 404);
    const body = await readJson(c);
    const parsed = await expenseWithCard(c.env.DB, writer.scope.ownerId, {
      name: body.name ?? current.name,
      amountCents: body.amountCents ?? current.amountCents,
      section: body.section ?? current.section,
      payment: body.payment ?? current.payment,
      onCard: body.onCard ?? current.onCard,
      cardLabel: body.cardLabel === undefined ? current.cardLabel : body.cardLabel,
      note: body.note === undefined ? current.note : body.note,
      installment: body.installment === undefined ? current.installment : body.installment,
      paid: body.paid ?? current.paid,
    });
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const editScope = body.editScope === "forward" || body.editScope === "all" ? body.editScope : "month";
    if (editScope !== "month" && (current.section === "fixed" || current.section === "card")) {
      const edited = await applySeriesEdit(c.env.DB, {
        ownerId: writer.scope.ownerId,
        expenseId: current.id,
        scope: editScope,
        name: parsed.value.name,
        amountCents: parsed.value.amountCents,
        note: parsed.value.note,
        payment: parsed.value.payment,
        cardLabel: parsed.value.cardLabel,
        installment: parsed.value.installment,
      });
      if (!edited.ok) return c.json({ error: edited.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, current.monthId), writer.scope));
    }
    const nextNote = parsed.value.section === "fixed" && !parsed.value.paid
      ? (noteWithFinalizedZero(parsed.value.note, false) || null)
      : parsed.value.note;
    const clearFixedCard = parsed.value.section === "fixed" && current.onCard && (
      !parsed.value.onCard
      || parsed.value.payment !== "card"
      || isVariableCost(nextNote)
      || invoiceShiftFromNote(nextNote) === "seguinte"
    );
    const nextOnCard = clearFixedCard ? false : parsed.value.onCard;
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE expenses
         SET name = ?, section = ?, amount_cents = ?, payment = ?, on_card = ?, card_label = ?, paid = ?, note = ?, installment = ?,
             ${EXPENSE_META_SET_SQL}
         WHERE owner_id = ? AND id = ?`,
      ).bind(
        parsed.value.name,
        parsed.value.section,
        parsed.value.amountCents,
        parsed.value.payment,
        nextOnCard ? 1 : 0,
        parsed.value.cardLabel,
        parsed.value.paid ? 1 : 0,
        nextNote,
        parsed.value.installment,
        ...expenseMetaParams(parsed.value.section, nextNote),
        writer.scope.ownerId,
        current.id,
      ),
    ];
    if (clearFixedCard) {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM expenses WHERE owner_id = ? AND section = 'card' AND origin_expense_id = ? AND partial_id IS NULL",
        ).bind(writer.scope.ownerId, current.id),
      );
    }
    await c.env.DB.batch(statements);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, current.monthId), writer.scope));
  });

  app.post("/api/expenses/:id/classification", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const current = await getExpense(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!current) return c.json({ error: "Gasto não encontrado." }, 404);
    const body = await readJson(c);
    const track = body.classification;
    if (track !== "imprevisto" && track !== "planejado" && track !== "casa") {
      return c.json({ error: "Escolha Imprevisto, Planejado ou Custo de vida." }, 400);
    }
    if (!isCents(body.amountCents) || body.amountCents <= 0) return c.json({ error: "Informe um valor maior que zero." }, 400);
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      return c.json({ error: "Dê um nome ao gasto, com até 120 caracteres." }, 400);
    }
    const cards = await listCards(c.env.DB, writer.scope.ownerId);
    const card = resolveCardLabel(cards, typeof body.cardLabel === "string" ? body.cardLabel : null, true);
    if (!card.ok) return c.json({ error: card.error }, 400);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
    const saved = await reclassifyExpense(c.env.DB, {
      ownerId: writer.scope.ownerId,
      expenseId: current.id,
      track,
      name: body.name.trim(),
      amountCents: body.amountCents,
      cardLabel: card.cardLabel || "",
      note,
    });
    if (!saved.ok) return c.json({ error: saved.error }, 400);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, saved.monthId), writer.scope));
  });

  app.delete("/api/expenses/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const asked = c.req.query("scope");
    const scope = asked === "series" || asked === "forward" ? asked : "month";
    const removed = await deleteMatchingExpenses(c.env.DB, writer.scope.ownerId, c.req.param("id"), scope);
    if (!removed.ok) return c.json({ error: removed.error }, 404);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, removed.monthId), writer.scope));
  });
}
