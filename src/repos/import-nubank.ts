import { buildNubankSchedule, parseNubankCsv } from "../../public/shared/nubank-csv.js";
import {
  cardKey,
  noteWithChargeContext,
  noteWithPlanned,
  noteWithSeries,
} from "../domain.ts";
import { createCard, listCards } from "./cards.ts";
import { chunkIds, nextSorts, prepareInsertExpense, runStatements, sqlMarks } from "./core.ts";
import { ensureMonths } from "./months.ts";

export type NubankImportResult =
  | {
      ok: true;
      cardName: string;
      cardCreated: boolean;
      dueDate: string;
      invoiceMonthId: string;
      dueDay: number;
      insertedCurrent: number;
      insertedFuture: number;
      syncedExisting: number;
      ignoredPayments: number;
      ignoredCredits: number;
      invalidRows: number;
      totalCents: number;
    }
  | {
      ok: false;
      error: string;
    };

function parseConfirmedDueDate(raw: string): { dueDate: string; invoiceMonthId: string; dueDay: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return {
    dueDate: `${match[1]}-${match[2]}-${match[3]}`,
    invoiceMonthId: `${match[1]}-${match[2]}`,
    dueDay: day,
  };
}

function estimateClosingDay(dueDay: number): number {
  return dueDay > 7 ? dueDay - 7 : Math.max(1, 28 + dueDay - 7);
}

export async function importNubankCsv(
  db: D1Database,
  input: {
    ownerId: string;
    csvText: string;
    filename?: string;
    dueDate: string;
    cardName?: string;
    classification?: "imprevisto" | "planejado";
  },
): Promise<NubankImportResult> {
  const confirmed = parseConfirmedDueDate(input.dueDate);
  if (!confirmed) {
    return { ok: false, error: "Confirme uma data de vencimento válida no formato AAAA-MM-DD." };
  }

  const parsed = parseNubankCsv(input.csvText, input.filename || "");
  if (!parsed.ok) return parsed;
  if (parsed.items.length > 500) {
    return { ok: false, error: "A planilha excede o limite de 500 lançamentos por importação." };
  }

  const requestedCard = String(input.cardName || "").trim() || "Nubank";
  const existingCards = await listCards(db, input.ownerId);
  const existingCard = existingCards.find((card) => cardKey(card.name) === cardKey(requestedCard));

  let cardName = existingCard?.name || requestedCard;
  let cardCreated = false;

  if (!existingCard) {
    const created = await createCard(
      db,
      input.ownerId,
      requestedCard,
      confirmed.dueDay,
      estimateClosingDay(confirmed.dueDay),
    );
    if (!created.ok) return created;
    cardName = requestedCard;
    cardCreated = true;
  } else if (existingCard.dueDay === null) {
    await db
      .prepare("UPDATE cards SET due_day = ?, closing_day = COALESCE(closing_day, ?) WHERE owner_id = ? AND id = ?")
      .bind(confirmed.dueDay, estimateClosingDay(confirmed.dueDay), input.ownerId, existingCard.id)
      .run();
  }

  const schedule = buildNubankSchedule(parsed.items, confirmed.invoiceMonthId, cardName);
  const allMonthIds = [...new Set(schedule.map((entry) => entry.monthId))].sort();
  await ensureMonths(db, input.ownerId, allMonthIds);

  const existingKeys = new Set<string>();
  const allImportKeys = [...new Set(schedule.map((entry) => entry.importKey))];
  for (const chunk of chunkIds(allImportKeys, 80)) {
    const rows = await db
      .prepare(`SELECT import_key FROM expenses WHERE owner_id = ? AND import_key IN (${sqlMarks(chunk)})`)
      .bind(input.ownerId, ...chunk)
      .all<{ import_key: string | null }>();
    for (const row of rows.results ?? []) {
      if (row.import_key) existingKeys.add(row.import_key);
    }
  }

  const toInsert = schedule.filter((entry) => !existingKeys.has(entry.importKey));
  const syncedExisting = schedule.length - toInsert.length;

  let insertedCurrent = 0;
  let insertedFuture = 0;

  if (toInsert.length > 0) {
    const usedSorts = await nextSorts(db, input.ownerId, toInsert.map((entry) => entry.monthId));
    const createdAt = new Date().toISOString();
    const planned = input.classification === "planejado";
    const baseTrack = planned ? noteWithPlanned("", true) : "tipo:imprevisto";
    const statements: D1PreparedStatement[] = [];

    for (const entry of toInsert) {
      const sort = (usedSorts.get(entry.monthId) ?? 0) + 1;
      usedSorts.set(entry.monthId, sort);
      let note = noteWithChargeContext(baseTrack, {
        purchaseDate: entry.purchaseDate,
        referenceMonthId: entry.purchaseDate.slice(0, 7),
      });
      if (entry.seriesId) note = noteWithSeries(note, entry.seriesId);

      statements.push(
        prepareInsertExpense(db, {
          id: crypto.randomUUID(),
          ownerId: input.ownerId,
          monthId: entry.monthId,
          name: entry.name,
          section: "card",
          amountCents: entry.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: cardName,
          paid: false,
          note,
          installment: entry.installment,
          sortOrder: sort,
          createdAt,
          importKey: entry.importKey,
        }),
      );
      if (entry.isCurrentInvoice) insertedCurrent += 1;
      else insertedFuture += 1;
    }

    await runStatements(db, statements);
  }

  return {
    ok: true,
    cardName,
    cardCreated,
    dueDate: confirmed.dueDate,
    invoiceMonthId: confirmed.invoiceMonthId,
    dueDay: confirmed.dueDay,
    insertedCurrent,
    insertedFuture,
    syncedExisting,
    ignoredPayments: parsed.ignoredPayments,
    ignoredCredits: parsed.ignoredCredits,
    invalidRows: parsed.invalidRows,
    totalCents: parsed.totalCents,
  };
}
