import {
  buildNubankSchedule,
  normalizeNubankTextKey,
  parseNubankCsv,
  type ScheduledNubankEntry,
} from "../../public/shared/nubank-csv.js";
import {
  cardKey,
  noteWithChargeContext,
  noteWithPlanned,
  noteWithSeries,
} from "../domain.ts";
import { createCard, listCards } from "./cards.ts";
import {
  EXPENSE_META_SET_SQL,
  chunkIds,
  expenseMetaParams,
  nextSorts,
  prepareInsertExpense,
  runStatements,
  sqlMarks,
} from "./core.ts";
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

const LEGACY_INSTALLMENT_KEY_RE = /^nb:p:[^:]+:\d{4}-\d{2}-\d{2}:/;

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

type ExistingInstallmentRow = {
  id: string;
  month_id: string;
  name: string;
  amount_cents: number;
  card_label: string | null;
  installment: string | null;
  note: string | null;
  import_key: string | null;
  origin_expense_id: string | null;
  partial_id: string | null;
};

function installmentSignature(monthId: string, normName: string, amountCents: number, installment: string): string {
  return `${monthId}|${normName}|${amountCents}|${installment}`;
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

  // Reconcilia parcelas legadas (gravadas com chave baseada na data de lançamento do CSV)
  // para evitar duplicatas e limpar eventuais repetições da mesma parcela no mês.
  const installmentMonthIds = [...new Set(schedule.filter((entry) => entry.installment).map((entry) => entry.monthId))];
  const legacyBySig = new Map<string, ExistingInstallmentRow[]>();
  const targetCardKey = cardKey(cardName);
  for (const chunk of chunkIds(installmentMonthIds, 80)) {
    const rows = await db
      .prepare(
        `SELECT id, month_id, name, amount_cents, card_label, installment, note, import_key, origin_expense_id, partial_id
         FROM expenses
         WHERE owner_id = ? AND section = 'card' AND installment IS NOT NULL AND import_key LIKE 'nb:p:%' AND month_id IN (${sqlMarks(chunk)})
         ORDER BY created_at ASC, id ASC`,
      )
      .bind(input.ownerId, ...chunk)
      .all<ExistingInstallmentRow>();
    for (const row of rows.results ?? []) {
      if (cardKey(row.card_label) !== targetCardKey || !row.installment) continue;
      if (!row.import_key || !LEGACY_INSTALLMENT_KEY_RE.test(row.import_key)) continue;
      const sig = installmentSignature(row.month_id, normalizeNubankTextKey(row.name), row.amount_cents, row.installment);
      const list = legacyBySig.get(sig) ?? [];
      list.push(row);
      legacyBySig.set(sig, list);
    }
  }

  const maintenanceStatements: D1PreparedStatement[] = [];
  const matchedEntries = new Set<ScheduledNubankEntry>();
  const consumedLegacyIds = new Set<string>();

  if (legacyBySig.size > 0) {
    const scheduleBySig = new Map<string, ScheduledNubankEntry[]>();
    for (const entry of schedule) {
      if (!entry.installment) continue;
      const sig = installmentSignature(entry.monthId, entry.normName, entry.amountCents, entry.installment);
      const list = scheduleBySig.get(sig) ?? [];
      list.push(entry);
      scheduleBySig.set(sig, list);
    }

    for (const [sig, entries] of scheduleBySig.entries()) {
      const legacyRows = legacyBySig.get(sig);
      if (!legacyRows?.length) continue;

      // Prioriza preservar linhas já vinculadas pelo usuário (origem/parcial) antes de atualizar/deduplicar.
      legacyRows.sort((left, right) => {
        const leftLinked = left.origin_expense_id || left.partial_id ? 0 : 1;
        const rightLinked = right.origin_expense_id || right.partial_id ? 0 : 1;
        return leftLinked - rightLinked;
      });

      const unmatchedEntries = entries.filter((entry) => !existingKeys.has(entry.importKey));
      let legacyIndex = 0;

      for (const entry of unmatchedEntries) {
        const row = legacyRows[legacyIndex];
        if (!row) break;
        legacyIndex += 1;
        consumedLegacyIds.add(row.id);
        matchedEntries.add(entry);

        const isLinked = Boolean(row.origin_expense_id || row.partial_id);
        let updatedNote = row.note || "";
        if (!isLinked) {
          updatedNote = noteWithChargeContext(updatedNote, {
            purchaseDate: entry.purchaseDate,
            referenceMonthId: entry.purchaseDate.slice(0, 7),
          });
          if (entry.seriesId) updatedNote = noteWithSeries(updatedNote, entry.seriesId);
        }
        maintenanceStatements.push(
          db
            .prepare(
              `UPDATE expenses
               SET import_key = ?, note = ?, ${EXPENSE_META_SET_SQL}
               WHERE owner_id = ? AND id = ?`,
            )
            .bind(
              entry.importKey,
              updatedNote,
              ...expenseMetaParams("card", updatedNote),
              input.ownerId,
              row.id,
            ),
        );
      }

      // Remove excedentes legados não vinculados da mesma parcela duplicada no mesmo mês
      const excessLegacyIds = legacyRows
        .slice(legacyIndex)
        .filter((row) => !consumedLegacyIds.has(row.id) && !row.origin_expense_id && !row.partial_id)
        .map((row) => row.id);
      for (const idChunk of chunkIds(excessLegacyIds, 80)) {
        maintenanceStatements.push(
          db
            .prepare(`DELETE FROM expenses WHERE owner_id = ? AND id IN (${sqlMarks(idChunk)})`)
            .bind(input.ownerId, ...idChunk),
        );
      }
    }
  }

  const toInsert = schedule.filter((entry) => !existingKeys.has(entry.importKey) && !matchedEntries.has(entry));
  const syncedExisting = schedule.length - toInsert.length;

  let insertedCurrent = 0;
  let insertedFuture = 0;

  const statements: D1PreparedStatement[] = [...maintenanceStatements];

  if (toInsert.length > 0) {
    const usedSorts = await nextSorts(db, input.ownerId, toInsert.map((entry) => entry.monthId));
    const createdAt = new Date().toISOString();
    const planned = input.classification === "planejado";
    const baseTrack = planned ? noteWithPlanned("", true) : "tipo:imprevisto";

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
  }

  if (statements.length > 0) {
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
