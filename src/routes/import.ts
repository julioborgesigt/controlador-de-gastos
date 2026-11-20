import { importNubankCsv, monthPayload } from "../db.ts";
import { readJson, requireWriter, withAccess, type App } from "../http.ts";

export function registerImportRoutes(app: App): void {
  app.post("/api/import/nubank", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    const csvText = typeof body.csvText === "string" ? body.csvText : "";
    const filename = typeof body.filename === "string" ? body.filename.slice(0, 180) : "";
    const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    const cardName = typeof body.cardName === "string" ? body.cardName.trim().slice(0, 40) : "Nubank";
    const classification = body.classification === "planejado" ? "planejado" : "imprevisto";

    if (!csvText.trim()) return c.json({ error: "Envie o conteúdo da planilha CSV do Nubank." }, 400);
    if (csvText.length > 400_000) return c.json({ error: "Arquivo CSV grande demais." }, 413);

    const result = await importNubankCsv(c.env.DB, {
      ownerId: writer.scope.ownerId,
      csvText,
      filename,
      dueDate,
      cardName,
      classification,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);

    const payload = await monthPayload(c.env.DB, writer.scope.ownerId, result.invoiceMonthId);
    if (!payload) return c.json({ error: "Não foi possível carregar o mês importado." }, 500);
    return c.json({
      ...withAccess(payload, writer.scope),
      summary: {
        cardName: result.cardName,
        cardCreated: result.cardCreated,
        dueDate: result.dueDate,
        invoiceMonthId: result.invoiceMonthId,
        dueDay: result.dueDay,
        insertedCurrent: result.insertedCurrent,
        insertedFuture: result.insertedFuture,
        syncedExisting: result.syncedExisting,
        ignoredPayments: result.ignoredPayments,
        ignoredCredits: result.ignoredCredits,
        totalCents: result.totalCents,
      },
    });
  });
}
