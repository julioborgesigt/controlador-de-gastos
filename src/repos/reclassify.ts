import {
  noteForTrack,
  noteWithOrigin,
  noteWithVisibleText,
  originExpenseId,
  partialIdFromNote,
  seriesIdFromNote,
  type ExpenseTrack,
  type Payment,
  type Section,
} from "../domain.ts";
import { EXPENSE_META_SET_SQL, expenseMetaParams, nextSorts, prepareInsertExpense, runStatements } from "./core.ts";
import { getExpense, listSectionExpenses } from "./expenses-read.ts";

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
  const cardLines = await listSectionExpenses(db, input.ownerId, "card");
  const statements: D1PreparedStatement[] = [];
  const standalone = (base: string | null | undefined) => noteForTrack(noteWithVisibleText(base, input.note), input.track);

  const updateExpense = (
    id: string,
    fields: {
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

  if (current.section === "extra") {
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
      const used = await nextSorts(db, input.ownerId, [current.monthId]);
      const sort = (used.get(current.monthId) ?? 0) + 1;
      statements.push(
        prepareInsertExpense(db, {
          id: crypto.randomUUID(),
          ownerId: input.ownerId,
          monthId: current.monthId,
          name,
          section: "card",
          amountCents: input.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: input.cardLabel,
          paid: false,
          note: noteWithOrigin(seriesIdFromNote(current.note) ? `serie:${seriesIdFromNote(current.note)}` : "", current.id),
          installment: current.installment,
          sortOrder: sort,
          createdAt: new Date().toISOString(),
        }),
      );
    } else {
      updateExpense(current.id, {
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: standalone(current.note),
        installment: current.installment,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
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
          name,
          section: "card",
          amountCents: input.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: input.cardLabel,
          paid: line.paid,
          note: line.note || "",
          installment: line.installment,
        });
      }
      if (!mirrors.length) {
        const used = await nextSorts(db, input.ownerId, [current.monthId]);
        const sort = (used.get(current.monthId) ?? 0) + 1;
        statements.push(
          prepareInsertExpense(db, {
            id: crypto.randomUUID(),
            ownerId: input.ownerId,
            monthId: current.monthId,
            name,
            section: "card",
            amountCents: input.amountCents,
            payment: "card",
            onCard: false,
            cardLabel: input.cardLabel,
            paid: false,
            note: noteWithOrigin("", current.id),
            installment: null,
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
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: standalone(current.note),
        installment: null,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
  }

  const originId = originExpenseId(current.note);
  const partialId = partialIdFromNote(current.note);
  if (!originId) {
    if (input.track === "casa") {
      const fixedId = crypto.randomUUID();
      const used = await nextSorts(db, input.ownerId, [current.monthId]);
      const sort = (used.get(current.monthId) ?? 0) + 1;
      statements.push(
        prepareInsertExpense(db, {
          id: fixedId,
          ownerId: input.ownerId,
          monthId: current.monthId,
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
        name,
        section: "card",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: noteWithOrigin(noteWithVisibleText(current.note, input.note), fixedId),
        installment: current.installment,
      });
    } else {
      updateExpense(current.id, {
        name,
        section: "extra",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: standalone(current.note),
        installment: current.installment,
      });
    }
    await runStatements(db, statements);
    return { ok: true, monthId: current.monthId };
  }

  if (partialId) {
    const siblings = cardLines.filter((line) => partialIdFromNote(line.note) === partialId);
    if (input.track === "casa") {
      updateExpense(current.id, {
        name,
        section: "card",
        amountCents: input.amountCents,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: current.paid,
        note: current.note || "",
        installment: current.installment,
      });
      const total = siblings.reduce((sum, line) => sum + (line.id === current.id ? input.amountCents : line.amountCents), 0);
      statements.push(
        db.prepare("UPDATE partial_payments SET amount_cents = ?, card_label = ? WHERE owner_id = ? AND id = ?")
          .bind(total, input.cardLabel, input.ownerId, partialId),
      );
      await runStatements(db, statements);
      return { ok: true, monthId: current.monthId };
    }
    let moved = 0;
    for (const line of siblings) {
      const amount = line.id === current.id ? input.amountCents : line.amountCents;
      moved += amount;
      updateExpense(line.id, {
        name: line.id === current.id ? name : line.name,
        section: "extra",
        amountCents: amount,
        payment: "card",
        onCard: false,
        cardLabel: input.cardLabel,
        paid: false,
        note: noteForTrack(line.id === current.id ? noteWithVisibleText(line.note, input.note) : line.note, input.track),
        installment: line.installment,
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
    return { ok: true, monthId: current.monthId };
  }

  const origin = originId ? await getExpense(db, input.ownerId, originId) : null;
  if (input.track === "casa") {
    updateExpense(current.id, {
      name,
      section: "card",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: current.paid,
      note: current.note || "",
      installment: current.installment,
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
    return { ok: true, monthId: current.monthId };
  }

  if (origin && origin.section === "fixed") {
    updateExpense(origin.id, {
      name,
      section: "extra",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: false,
      note: standalone(origin.note),
      installment: current.installment,
    });
    for (const line of cardLines) {
      if (originExpenseId(line.note) === origin.id && !partialIdFromNote(line.note)) {
        statements.push(db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, line.id));
      }
    }
  } else {
    updateExpense(current.id, {
      name,
      section: "extra",
      amountCents: input.amountCents,
      payment: "card",
      onCard: false,
      cardLabel: input.cardLabel,
      paid: false,
      note: standalone(current.note),
      installment: current.installment,
    });
  }
  await runStatements(db, statements);
  return { ok: true, monthId: current.monthId };
}
