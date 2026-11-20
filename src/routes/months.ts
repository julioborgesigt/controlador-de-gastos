import {
  applyBaseIncome,
  getMonth,
  listCardPurchasesInMonth,
  listMonths,
  monthPayload,
  resetOwnerData,
  setManagedPeriod,
  setMonthIncome,
  unlockMonthIncome,
} from "../db.ts";
import {
  AUTH_ERROR,
  isCents,
  isMonthId,
  readJson,
  requireScope,
  requireWriter,
  withAccess,
  type App,
  type JsonBody,
} from "../http.ts";

export function registerMonthRoutes(app: App): void {
  app.get("/api/period", async (c) => {
    const scope = await requireScope(c);
    if (!scope) return c.json({ error: AUTH_ERROR }, 401);
    const months = await listMonths(c.env.DB, scope.ownerId);
    if (!months.length) return c.json({ configured: false, startMonthId: null, endMonthId: null });
    return c.json({ configured: true, startMonthId: months[0].id, endMonthId: months[months.length - 1].id });
  });

  app.post("/api/period", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    if (writer.scope.permission !== "own") return c.json({ error: "Só o dono dos dados define o período." }, 403);
    const body = await readJson(c);
    if (!isMonthId(body.startMonthId) || !isMonthId(body.endMonthId)) {
      return c.json({ error: "Escolha o mês e o ano de início e de fim." }, 400);
    }
    const saved = await setManagedPeriod(c.env.DB, writer.scope.ownerId, body.startMonthId, body.endMonthId);
    if (!saved.ok) return c.json({ error: saved.error }, 400);
    const payload = await monthPayload(c.env.DB, writer.scope.ownerId, saved.startMonthId);
    if (!payload) return c.json({ error: "Mês não encontrado." }, 404);
    return c.json(withAccess(payload, writer.scope));
  });

  app.post("/api/reset", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    if (writer.scope.permission !== "own") return c.json({ error: "Só o dono dos dados pode apagá-los." }, 403);
    const body = await readJson(c);
    const scope = body.scope === "all" || body.scope === "year" || body.scope === "month" ? body.scope : "";
    const year = typeof body.year === "number" ? body.year : Number(body.year);
    const reset = await resetOwnerData(c.env.DB, writer.scope.ownerId, {
      scope,
      year: Number.isInteger(year) ? year : undefined,
      monthId: typeof body.monthId === "string" ? body.monthId : undefined,
    });
    if (!reset.ok) return c.json({ error: reset.error }, 400);
    if (reset.wiped) return c.json({ wiped: true });
    const focus = isMonthId(body.focusMonthId) && (await getMonth(c.env.DB, writer.scope.ownerId, body.focusMonthId))
      ? body.focusMonthId
      : reset.ids[0];
    if (!focus) return c.json({ error: "Não há período para apagar." }, 400);
    const payload = await monthPayload(c.env.DB, writer.scope.ownerId, focus);
    if (!payload) return c.json({ error: "Mês não encontrado." }, 404);
    return c.json(withAccess(payload, writer.scope));
  });

  app.get("/api/months/:id/purchases", async (c) => {
    const scope = await requireScope(c);
    if (!scope) return c.json({ error: AUTH_ERROR }, 401);
    const monthId = c.req.param("id");
    if (!(await getMonth(c.env.DB, scope.ownerId, monthId))) return c.json({ error: "Mês não encontrado." }, 404);
    const items = await listCardPurchasesInMonth(c.env.DB, scope.ownerId, monthId);
    const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
    return c.json({
      monthId,
      totalCents,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        amountCents: item.amountCents,
        invoiceMonthId: item.monthId,
        cardLabel: item.cardLabel,
        note: item.note,
        installment: item.installment,
        section: item.section,
        payment: item.payment,
      })),
    });
  });

  app.get("/api/months/:id", async (c) => {
    const scope = await requireScope(c);
    if (!scope) return c.json({ error: AUTH_ERROR }, 401);
    const payload = await monthPayload(c.env.DB, scope.ownerId, c.req.param("id"));
    if (!payload) return c.json({ error: "Mês não encontrado." }, 404);
    return c.json(withAccess(payload, scope));
  });

  app.patch("/api/months/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const monthId = c.req.param("id");
    const month = await getMonth(c.env.DB, writer.scope.ownerId, monthId);
    if (!month) return c.json({ error: "Mês não encontrado." }, 404);
    const body = await readJson(c);
    if (!isCents(body.incomeCents) || body.incomeCents < 0) return c.json({ error: "Informe a receita em centavos." }, 400);
    await setMonthIncome(c.env.DB, writer.scope.ownerId, monthId, body.incomeCents);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, monthId), writer.scope));
  });

  app.post("/api/months/:id/use-base-income", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const monthId = c.req.param("id");
    if (!(await getMonth(c.env.DB, writer.scope.ownerId, monthId))) return c.json({ error: "Mês não encontrado." }, 404);
    await unlockMonthIncome(c.env.DB, writer.scope.ownerId, monthId);
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, monthId), writer.scope));
  });

  app.post("/api/income/base", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    if (!isCents(body.amountCents) || body.amountCents < 0) return c.json({ error: "Informe a receita base." }, 400);
    const incomeScope = body.scope === "all" ? "all" : "unlocked";
    await applyBaseIncome(c.env.DB, writer.scope.ownerId, body.amountCents, incomeScope);
    const requestedMonthId = typeof body.monthId === "string" && isMonthId(body.monthId) ? body.monthId : "";
    const fallbackMonthId = requestedMonthId || (await listMonths(c.env.DB, writer.scope.ownerId))[0]?.id || "2026-11";
    const payload = await monthPayload(c.env.DB, writer.scope.ownerId, fallbackMonthId);
    if (!payload) return c.json({ error: "Mês não encontrado." }, 404);
    return c.json(withAccess(payload, writer.scope));
  });

  app.post("/api/income/extras", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    const kind = body.kind;
    if (kind !== "ir" && kind !== "thirteenth" && kind !== "vacation" && kind !== "other") {
      return c.json({ error: "Escolha o tipo da receita extra." }, 400);
    }
    if (!isCents(body.amountCents) || body.amountCents <= 0) return c.json({ error: "Informe o valor da receita extra." }, 400);
    const monthIds = incomeMonthIds(body);
    if (!monthIds) return c.json({ error: "Escolha ao menos um mês." }, 400);
    const knownMonths = await c.env.DB
      .prepare(`SELECT id FROM months WHERE owner_id = ? AND id IN (${monthIds.map(() => "?").join(", ")})`)
      .bind(writer.scope.ownerId, ...monthIds)
      .all<{ id: string }>();
    if ((knownMonths.results ?? []).length !== monthIds.length) {
      return c.json({ error: "Escolha o mês previsto." }, 400);
    }
    const name = incomeExtraName(kind, body.name);
    if (!name) return c.json({ error: "Dê um nome para essa receita." }, 400);
    const createdAt = new Date().toISOString();
    await c.env.DB.batch(
      monthIds.map((monthId) =>
        c.env.DB.prepare(
          "INSERT INTO income_extras (id, owner_id, kind, name, amount_cents, month_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(crypto.randomUUID(), writer.scope.ownerId, kind, name, body.amountCents, monthId, createdAt),
      ),
    );
    const focus = typeof body.monthId === "string" && isMonthId(body.monthId) ? body.monthId : monthIds[0]!;
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, focus), writer.scope), 201);
  });

  app.patch("/api/income/extras/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const current = await c.env.DB.prepare(
      "SELECT kind, name, amount_cents, month_id FROM income_extras WHERE id = ? AND owner_id = ?",
    )
      .bind(c.req.param("id"), writer.scope.ownerId)
      .first<{ kind: "ir" | "thirteenth" | "vacation" | "other"; name: string; amount_cents: number; month_id: string }>();
    if (!current) return c.json({ error: "Receita extra não encontrada." }, 404);
    const body = await readJson(c);
    const kind = body.kind === undefined ? current.kind : body.kind;
    if (kind !== "ir" && kind !== "thirteenth" && kind !== "vacation" && kind !== "other") {
      return c.json({ error: "Escolha o tipo da receita extra." }, 400);
    }
    const amountCents = body.amountCents === undefined ? current.amount_cents : body.amountCents;
    if (!isCents(amountCents) || amountCents <= 0) return c.json({ error: "Informe o valor da receita extra." }, 400);
    const monthId = typeof body.monthId === "string" ? body.monthId : current.month_id;
    if (!isMonthId(monthId) || !(await getMonth(c.env.DB, writer.scope.ownerId, monthId))) {
      return c.json({ error: "Escolha o mês previsto." }, 400);
    }
    const name = incomeExtraName(kind, body.name === undefined ? current.name : body.name);
    if (!name) return c.json({ error: "Dê um nome para essa receita." }, 400);
    await c.env.DB.prepare(
      "UPDATE income_extras SET kind = ?, name = ?, amount_cents = ?, month_id = ? WHERE id = ? AND owner_id = ?",
    )
      .bind(kind, name, amountCents, monthId, c.req.param("id"), writer.scope.ownerId)
      .run();
    const focus = typeof body.focusMonthId === "string" && isMonthId(body.focusMonthId) ? body.focusMonthId : monthId;
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, focus), writer.scope));
  });

  app.delete("/api/income/extras/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const current = await c.env.DB.prepare("SELECT month_id FROM income_extras WHERE id = ? AND owner_id = ?")
      .bind(c.req.param("id"), writer.scope.ownerId)
      .first<{ month_id: string }>();
    if (!current) return c.json({ error: "Receita extra não encontrada." }, 404);
    await c.env.DB.prepare("DELETE FROM income_extras WHERE id = ? AND owner_id = ?").bind(c.req.param("id"), writer.scope.ownerId).run();
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, current.month_id), writer.scope));
  });

  app.post("/api/months/:id/settle", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const monthId = c.req.param("id");
    const month = await getMonth(c.env.DB, writer.scope.ownerId, monthId);
    if (!month) return c.json({ error: "Mês não encontrado." }, 404);
    const body = await readJson(c);
    if (body.mode === "pay-remaining") {
      await c.env.DB.prepare(
        `UPDATE expenses
         SET paid = 1
         WHERE owner_id = ?
           AND month_id = ?
           AND amount_cents != 0
           AND section != 'fixed'`,
      )
        .bind(writer.scope.ownerId, monthId)
        .run();
    } else if (body.mode === "reopen") {
      await c.env.DB.prepare("UPDATE expenses SET paid = 0 WHERE owner_id = ? AND month_id = ?").bind(writer.scope.ownerId, monthId).run();
      await c.env.DB.prepare("UPDATE months SET settled = 0 WHERE owner_id = ? AND id = ?").bind(writer.scope.ownerId, monthId).run();
    } else {
      return c.json({ error: "Ação de baixa desconhecida." }, 400);
    }
    return c.json(withAccess(await monthPayload(c.env.DB, writer.scope.ownerId, monthId), writer.scope));
  });
}

function incomeMonthIds(body: JsonBody): string[] | null {
  const fromList = Array.isArray(body.monthIds) ? body.monthIds.filter((item): item is string => isMonthId(item)) : [];
  const ids = fromList.length > 0 ? fromList : typeof body.monthId === "string" && isMonthId(body.monthId) ? [body.monthId] : [];
  const unique = [...new Set(ids)];
  return unique.length > 0 ? unique : null;
}

function incomeExtraName(kind: "ir" | "thirteenth" | "vacation" | "other", name: unknown): string {
  if (kind === "ir") return "Imposto de renda";
  if (kind === "thirteenth") return "Décimo terceiro";
  if (kind === "vacation") return "Férias";
  return typeof name === "string" ? name.trim().slice(0, 80) : "";
}
