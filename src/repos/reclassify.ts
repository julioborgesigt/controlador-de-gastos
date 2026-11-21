import {
  noteForTrack,
  noteWithChargeContext,
  noteWithOrigin,
  noteWithVisibleText,
  originExpenseId,
  partialIdFromNote,
  purchaseMonthFromNote,
  seriesIdFromNote,
  type ExpenseTrack,
  type Payment,
  type Section,
} from "../domain.ts";
import { noteMarker } from "../../public/shared/note-markers.js";
import { EXPENSE_META_SET_SQL, expenseMetaParams, nextSorts, prepareInsertExpense, runStatements } from "./core.ts";
import { getExpense, listSectionExpenses } from "./expenses-read.ts";
import { getMonth } from "./months.ts";

export async function reclassifyExpense(
  db: D1Database,
  input: {
    ownerId: string;
    expenseId: string;
    track: ExpenseTrack;
    name: string;
    amountCents: number;
    cardLabel: string;
    note: string;
    purchaseDate?: string;
    invoiceMonthId?: string;
    costMonthId?: string;
    linkExpenseId?: string;
    installment?: string | null;
  },
): Promise<{ ok: true; monthId: string } | { ok: false; error: string }> {
  const current = await getExpense(db, input.ownerId, input.expenseId);
  if (!current) return { ok: false, error: "Gasto não encontrado." };
  const rawNote = String(current.note || "");
  if (rawNote.includes("parcelamento:") || rawNote.includes("quitado-cartao:")) {
    return { ok: false, error: "Este lançamento é da fatura e não muda de aba." };
  }
  if (input.amountCents <= 0) return { ok: false, error: "Informe um valor maior que zero." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Dê um nome ao gasto." };

  const targetInvoiceMonthId = input.invoiceMonthId && input.invoiceMonthId !== current.monthId
    ? input.invoiceMonthId
    : current.monthId;
  if (targetInvoiceMonthId !== current.monthId) {
    const exists = await getMonth(db, input.ownerId, targetInvoiceMonthId);
    if (!exists) return { ok: false, error: "Mês da fatura fora do período gerenciado." };
  }

  const existingPurchaseDate = noteMarker(rawNote, "compra:");
  const purchaseDate = input.purchaseDate !== undefined
    ? (/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate) ? input.purchaseDate : "")
    : existingPurchaseDate;
  const existingRefMonth = noteMarker(rawNote, "ref:") || purchaseMonthFromNote(rawNote);
  const costMonthId = input.costMonthId && /^\d{4}-\d{2}$/.test(input.costMonthId)
    ? input.costMonthId
    : (existingRefMonth || targetInvoiceMonthId);
  if (input.costMonthId && input.costMonthId !== current.monthId && !(await getMonth(db, input.ownerId, costMonthId))) {
    return { ok: false, error: "Mês do orçamento fora do período gerenciado." };
  }

  const nextInstallment = input.installment !== undefined ? input.installment : current.installment;
  const withContext = (text: string) => noteWithChargeContext(text, {
    purchaseDate: purchaseDate || null,
    referenceMonthId: costMonthId || null,
  });

  const cardLines = await listSectionExpenses(db, input.ownerId, "card");
  const statements: D1PreparedStatement[] = [];
  const standalone = (base: string | null | undefined) => withContext(noteForTrack(noteWithVisibleText(base, input.note), input.track));

  const updateExpense = (
    id: string,
    fields: {
      monthId?: string;
      name: string;
      section: Section;
      amountCents: number;
      payment: Payment;
      onCard: boolean;
      cardLabel: string | null;
      paid: boolean;
      note: string;
      installment: string | null;
    },
  ) => {
    if (fields.monthId) {
      statements.push(
        db.prepare(
          `UPDATE expenses
           SET month_id = ?, name = ?, section = ?, amount_cents = ?, payment = ?, on_card = ?, card_label = ?, paid = ?, note = ?, installment = ?,
               ${EXPENSE_META_SET_SQL}
           WHERE owner_id = ? AND id = ?`,
        ).bind(
          fields.monthId,
          fields.name,
          fields.section,
          fields.amountCents,
          fields.payment,
          fields.onCard ? 1 : 0,
          fields.cardLabel,
          fields.paid ? 1 : 0,
          fields.note,
          fields.installment,
          ...expenseMetaParams(fields.section, fields.note),
          input.ownerId,
          id,
        ),
      );
      return;
    }
    statements.push(
      db.prepare(
        `UPDATE expenses
         SET name = ?, section = ?, amount_cents = ?, payment = ?, on_card = ?, card_label = ?, paid = ?, note = ?, installment = ?,
             ${EXPENSE_META_SET_SQL}
         WHERE owner_id = ? AND id = ?`,
      ).bind(
        fields.name,
        fields.section,
        fields.amountCents,
        fields.payment,
        fields.onCard ? 1 : 0,
        fields.cardLabel,
        fields.paid ? 1 : 0,
        fields.note,
        fields.installment,
        ...expenseMetaParams(fields.section, fields.note),
        input.ownerId,
        id,
      ),
    );
  };

  const linkId = String(input.linkExpenseId || "").trim();
  const originId = originExpenseId(current.note);
  const partialId = partialIdFromNote(current.note);

  // Vinculação explícita a um custo de vida previsto existente (como pagamento parcial no cartão)
  if (input.track === "casa" && linkId && current.section !== "fixed") {
    const targetLiving = await getExpense(db, input.ownerId, linkId);
    if (!targetLiving || targetLiving.section !== "fixed" || targetLiving.onCard) {
      return { ok: false, error: "Escolha um custo de vida em aberto para vincular." };
    }
    if (partialId && originId === targetLiving.id) {
      const linkedNote = withContext(noteWithVisibleText(current.note, input.note));
      updateExpense(current.id, {
        monthId: targetInvoiceMonthId,
        name,
        section: "card",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: linkedNote,
        installment: nextInstallment,
      });
      const siblings = cardLines.filter((line) => partialIdFromNote(line.note) === partialId);
      const total = siblings.reduce((sum, line) => sum + (line.id === current.id ? input.amountCents : line.amountCents), 0);
      statements.push(
        db.prepare("UPDATE partial_payments SET amount_cents = ?, card_label = ?, installment = ? WHERE owner_id = ? AND id = ?")
          .bind(total, input.cardLabel, nextInstallment, input.ownerId, partialId),
      );
      await runStatements(db, statements);
      return { ok: true, monthId: targetInvoiceMonthId };
    }
    if (partialId) {
      statements.push(db.prepare("DELETE FROM partial_payments WHERE owner_id = ? AND id = ?").bind(input.ownerId, partialId));
    }
    const newPartialId = crypto.randomUUID();
    const series = seriesIdFromNote(current.note);
    const baseNote = [
      series ? `serie:${series}` : "",
      `parcial:${newPartialId}`,
      input.note.trim(),
    ].filter(Boolean).join("\n");
    const linkedNote = withContext(noteWithOrigin(baseNote, targetLiving.id));
    statements.push(
      db.prepare(
        `INSERT INTO partial_payments (id, owner_id, expense_id, amount_cents, payment, card_label, installment, created_at)
         VALUES (?, ?, ?, ?, 'card', ?, ?, ?)`,
      ).bind(
        newPartialId,
        input.ownerId,
        targetLiving.id,
        input.amountCents,
        input.cardLabel,
        nextInstallment,
        new Date().toISOString(),
      ),
    );
    updateExpense(current.id, {
      monthId: targetInvoiceMonthId,
      name,
      section: "card",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: current.paid,
      note: linkedNote,
      installment: nextInstallment,
    });
    await runStatements(db, statements);
    return { ok: true, monthId: targetInvoiceMonthId };
  }

  if (current.section === "extra") {
    if (input.track === "casa") {
      const livingMonthId = costMonthId || targetInvoiceMonthId;
      updateExpense(current.id, {
        monthId: livingMonthId,
        name,
        section: "fixed",
        amountCents: input.amountCents,
        payment: "card",
        onCard: true,
        cardLabel: input.cardLabel,
        paid: true,
        note: standalone(current.note),
        installment: null,
      });
      const used = await nextSorts(db, input.ownerId, [targetInvoiceMonthId]);
      const sort = (used.get(targetInvoiceMonthId) ?? 0) + 1;
      statements.push(
        prepareInsertExpense(db, {
          id: crypto.randomUUID(),
          ownerId: input.ownerId,
          monthId: targetInvoiceMonthId,
          name,
          section: "card",
          amountCents: input.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: input.cardLabel,
          paid: false,
          note: withContext(noteWithOrigin(seriesIdFromNote(current.note) ? `serie:${seriesIdFromNote(current.note)}` : "", current.id)),
          installment: nextInstallment,
          sortOrder: sort,
          createdAt: new Date().toISOString(),
        }),
      );
    } else {
      updateExpense(current.id, {
        monthId: targetInvoiceMonthId,
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: standalone(current.note),
        installment: nextInstallment,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: targetInvoiceMonthId };
  }

  if (current.section === "fixed") {
    const mirrors = cardLines.filter((line) => originExpenseId(line.note) === current.id);
    if (input.track === "casa") {
      updateExpense(current.id, {
        name,
        section: "fixed",
        amountCents: input.amountCents,
        payment: "card",
        onCard: true,
        cardLabel: input.cardLabel,
        paid: true,
        note: standalone(current.note),
        installment: null,
      });
      const full = mirrors.filter((line) => !partialIdFromNote(line.note) && line.monthId === current.monthId);
      for (const line of full) {
        updateExpense(line.id, {
          monthId: targetInvoiceMonthId,
          name,
          section: "card",
          amountCents: input.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: input.cardLabel,
          paid: line.paid,
          note: withContext(line.note || ""),
          installment: nextInstallment,
        });
      }
      if (!mirrors.length) {
        const used = await nextSorts(db, input.ownerId, [targetInvoiceMonthId]);
        const sort = (used.get(targetInvoiceMonthId) ?? 0) + 1;
        statements.push(
          prepareInsertExpense(db, {
            id: crypto.randomUUID(),
            ownerId: input.ownerId,
            monthId: targetInvoiceMonthId,
            name,
            section: "card",
            amountCents: input.amountCents,
            payment: "card",
            onCard: false,
            cardLabel: input.cardLabel,
            paid: false,
            note: withContext(noteWithOrigin("", current.id)),
            installment: nextInstallment,
            sortOrder: sort,
            createdAt: new Date().toISOString(),
          }),
        );
      }
    } else {
      for (const line of mirrors) {
        statements.push(db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, line.id));
      }
      statements.push(db.prepare("DELETE FROM partial_payments WHERE owner_id = ? AND expense_id = ?").bind(input.ownerId, current.id));
      updateExpense(current.id, {
        monthId: targetInvoiceMonthId,
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: standalone(current.note),
        installment: nextInstallment,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: targetInvoiceMonthId };
  }

  if (!originId) {
    if (input.track === "casa") {
      const livingMonthId = costMonthId || targetInvoiceMonthId;
      const fixedId = crypto.randomUUID();
      const used = await nextSorts(db, input.ownerId, [livingMonthId]);
      const sort = (used.get(livingMonthId) ?? 0) + 1;
      statements.push(
        prepareInsertExpense(db, {
          id: fixedId,
          ownerId: input.ownerId,
          monthId: livingMonthId,
          name,
          section: "fixed",
          amountCents: input.amountCents,
          payment: "card",
          onCard: true,
          cardLabel: input.cardLabel,
          paid: true,
          note: standalone(current.note),
          installment: null,
          sortOrder: sort,
          createdAt: new Date().toISOString(),
        }),
      );
      updateExpense(current.id, {
        monthId: targetInvoiceMonthId,
        name,
        section: "card",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: withContext(noteWithOrigin(noteWithVisibleText(current.note, input.note), fixedId)),
        installment: nextInstallment,
      });
    } else {
      updateExpense(current.id, {
        monthId: targetInvoiceMonthId,
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: standalone(current.note),
        installment: nextInstallment,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: targetInvoiceMonthId };
  }

  if (partialId) {
    const siblings = cardLines.filter((line) => partialIdFromNote(line.note) === partialId);
    if (input.track === "casa") {
      updateExpense(current.id, {
        monthId: targetInvoiceMonthId,
        name,
        section: "card",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: withContext(noteWithVisibleText(current.note, input.note)),
        installment: nextInstallment,
      });
      const total = siblings.reduce((sum, line) => sum + (line.id === current.id ? input.amountCents : line.amountCents), 0);
      statements.push(
        db.prepare("UPDATE partial_payments SET amount_cents = ?, card_label = ?, installment = ? WHERE owner_id = ? AND id = ?")
          .bind(total, input.cardLabel, nextInstallment, input.ownerId, partialId),
      );
      await runStatements(db, statements);
      return { ok: true, monthId: targetInvoiceMonthId };
    }
    let moved = 0;
    for (const line of siblings) {
      const amount = line.id === current.id ? input.amountCents : line.amountCents;
      moved += amount;
      updateExpense(line.id, {
        monthId: line.id === current.id ? targetInvoiceMonthId : line.monthId,
        name: line.id === current.id ? name : line.name,
        section: "extra",
        amountCents: amount,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: withContext(noteForTrack(line.id === current.id ? noteWithVisibleText(line.note, input.note) : line.note, input.track)),
        installment: line.id === current.id ? nextInstallment : line.installment,
      });
    }
    statements.push(db.prepare("DELETE FROM partial_payments WHERE owner_id = ? AND id = ?").bind(input.ownerId, partialId));
    const origin = await getExpense(db, input.ownerId, originId);
    if (origin && origin.section === "fixed") {
      statements.push(
        db.prepare("UPDATE expenses SET amount_cents = ? WHERE owner_id = ? AND id = ?")
          .bind(Math.max(0, origin.amountCents - moved), input.ownerId, origin.id),
      );
    }
    await runStatements(db, statements);
    return { ok: true, monthId: targetInvoiceMonthId };
  }

  const origin = originId ? await getExpense(db, input.ownerId, originId) : null;
  if (input.track === "casa") {
    updateExpense(current.id, {
      monthId: targetInvoiceMonthId,
      name,
      section: "card",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: current.paid,
      note: withContext(noteWithVisibleText(current.note, input.note)),
      installment: nextInstallment,
    });
    if (origin) {
      updateExpense(origin.id, {
        name,
        section: "fixed",
        amountCents: input.amountCents,
        payment: "card",
        onCard: true,
        cardLabel: input.cardLabel,
        paid: true,
        note: origin.note || "",
        installment: null,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: targetInvoiceMonthId };
  }

  if (origin && origin.section === "fixed") {
    updateExpense(origin.id, {
      monthId: targetInvoiceMonthId,
      name,
      section: "extra",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: false,
      note: standalone(origin.note),
      installment: nextInstallment,
    });
    for (const line of cardLines) {
      if (originExpenseId(line.note) === origin.id && !partialIdFromNote(line.note)) {
        statements.push(db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, line.id));
      }
    }
  } else {
    updateExpense(current.id, {
      monthId: targetInvoiceMonthId,
      name,
      section: "extra",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: false,
      note: standalone(current.note),
      installment: nextInstallment,
    });
  }
  await runStatements(db, statements);
  return { ok: true, monthId: targetInvoiceMonthId };
}
