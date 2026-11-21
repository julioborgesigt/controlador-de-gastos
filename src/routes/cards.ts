import { parseCardName, parseDueDay } from "../domain.ts";
import {
  createCard,
  deleteCard,
  getMonth,
  listCards,
  listMonths,
  monthPayload,
  payCardInvoice,
  undoCardInvoice,
  updateCard,
} from "../db.ts";
import { isMonthId, readJson, requireWriter, withAccess, type App } from "../http.ts";

export function registerCardRoutes(app: App): void {
  app.post("/api/cards/:id/payoff", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const cards = await listCards(c.env.DB, writer.scope.ownerId);
    const card = cards.find((item) => item.id === c.req.param("id"));
    if (!card) return c.json({ error: "Cartão não encontrado." }, 404);
    const body = await readJson(c);
    if (!isMonthId(body.monthId) || !(await getMonth(c.env.DB, writer.scope.ownerId, body.monthId))) {
      return c.json({ error: "Mês não encontrado." }, 404);
    }
    const mode = body.mode === "pix" || body.mode === "installments" || body.mode === "undo" ? body.mode : "";
    if (!mode) return c.json({ error: "Escolha Pago no Pix ou Pago parcelado." }, 400);
    if (mode === "undo") {
      const undone = await undoCardInvoice(c.env.DB, {
        ownerId: writer.scope.ownerId,
        cardId: card.id,
        cardName: card.name,
        monthId: body.monthId,
      });
      if (!undone.ok) return c.json({ error: undone.error }, 400);
      return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, body.monthId), writer.scope));
    }
    const months = await listMonths(c.env.DB, writer.scope.ownerId);
    const paid = await payCardInvoice(c.env.DB, {
      ownerId: writer.scope.ownerId,
      cardId: card.id,
      monthId: body.monthId,
      cardName: card.name,
      mode,
      downCents: typeof body.downCents === "number" ? body.downCents : 0,
      count: typeof body.count === "number" ? body.count : undefined,
      installmentCents: typeof body.installmentCents === "number" ? body.installmentCents : undefined,
      startMonthId: typeof body.startMonthId === "string" ? body.startMonthId : undefined,
      knownMonths: months.map((month) => month.id),
    });
    if (!paid.ok) return c.json({ error: paid.error }, 400);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, body.monthId), writer.scope));
  });

  app.post("/api/cards", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    const parsed = parseCardName(body.name);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const due = parseDueDay(body.dueDay);
    if (!due.ok) return c.json({ error: due.error }, 400);
    if (due.dueDay === null) return c.json({ error: "Informe o dia de vencimento, de 1 a 31." }, 400);
    const closing = parseDueDay(body.closingDay);
    if (!closing.ok) return c.json({ error: "O fechamento é um dia de 1 a 31." }, 400);
    if (closing.dueDay === null) return c.json({ error: "Informe o dia de fechamento, de 1 a 31." }, 400);
    const created = await createCard(c.env.DB, writer.scope.ownerId, parsed.name, due.dueDay, closing.dueDay);
    if (!created.ok) return c.json({ error: created.error }, 409);
    return c.json({ cards: await listCards(c.env.DB, writer.scope.ownerId) }, 201);
  });

  app.patch("/api/cards/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    const parsed = parseCardName(body.name);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const due = parseDueDay(body.dueDay);
    if (!due.ok) return c.json({ error: due.error }, 400);
    if (due.dueDay === null) return c.json({ error: "Informe o dia de vencimento, de 1 a 31." }, 400);
    const closing = parseDueDay(body.closingDay);
    if (!closing.ok) return c.json({ error: "O fechamento é um dia de 1 a 31." }, 400);
    if (closing.dueDay === null) return c.json({ error: "Informe o dia de fechamento, de 1 a 31." }, 400);
    const updated = await updateCard(c.env.DB, writer.scope.ownerId, c.req.param("id"), {
      name: parsed.name,
      dueDay: due.dueDay,
      closingDay: closing.dueDay,
    });
    if (!updated.ok) return c.json({ error: updated.error }, updated.error === "Cartão não encontrado." ? 404 : 409);
    return c.json({ cards: await listCards(c.env.DB, writer.scope.ownerId) });
  });

  app.delete("/api/cards/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const removed = await deleteCard(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!removed.ok) return c.json({ error: removed.error }, 404);
    const monthId = c.req.query("monthId");
    if (isMonthId(monthId) && await getMonth(c.env.DB, writer.scope.ownerId, monthId)) {
      return c.json({
        ...withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, monthId), writer.scope),
        deletedExpenses: removed.deletedExpenses,
      });
    }
    return c.json({ cards: await listCards(c.env.DB, writer.scope.ownerId), deletedExpenses: removed.deletedExpenses });
  });
}
