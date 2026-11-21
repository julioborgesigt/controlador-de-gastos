import { importNubankCsv, monthPayload } from "../db.ts";
import { logError, readJson, requireWriter, withAccess, type App } from "../http.ts";

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
    if (csvText.length > 400_000) return c.json({ error: "Arquivo CSV grande demais (limite de 400 KB)." }, 413);

    let result;
    try {
      result = await importNubankCsv(c.env.DB, {
        ownerId: writer.scope.ownerId,
        csvText,
        filename,
        dueDate,
        cardName,
        classification,
      });
    } catch (error) {
      const requestId = logError(c, "nubank_import_write_failed", error);
      return c.json({
        error: "Não foi possível gravar todos os lançamentos da fatura no banco de dados. Tente importar o mesmo CSV novamente para sincronizar o que faltou sem duplicar.",
        stage: "write",
        requestId,
      }, 500);
    }
    if (!result.ok) return c.json({ error: result.error, stage: "validation" }, 400);

    let payload;
    try {
      payload = await monthPayload(c.env.DB, writer.scope.ownerId, result.invoiceMonthId);
    } catch (error) {
      const requestId = logError(c, "nubank_import_reload_failed", error);
      return c.json({
        error: `A fatura foi importada (${result.insertedCurrent} no mês e ${result.insertedFuture} parcelas futuras), mas houve falha ao recarregar o mês. Atualize a página para ver os lançamentos.`,
        stage: "reload",
        requestId,
      }, 500);
    }
    if (!payload) {
      return c.json({ error: "A fatura foi gravada, mas o mês importado não foi encontrado. Atualize a página.", stage: "reload" }, 500);
    }
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
        invalidRows: result.invalidRows,
        totalCents: result.totalCents,
      },
    });
  });
}
