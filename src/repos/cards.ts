import { cardKey, cardOpenExpenses, expenseCountForCard, planCardPayoff } from "../domain.ts";
import { EXPENSE_META_SET_SQL, expenseMetaParams, nextSorts, prepareInsertExpense, runStatements, type CardAccount } from "./core.ts";
import { listExpenses } from "./expenses-read.ts";

export async function listCards(db: D1Database, ownerId: string): Promise<CardAccount[]> {
  const [result, labels] = await Promise.all([
    db
      .prepare("SELECT id, name, sort_order, due_day, closing_day FROM cards WHERE owner_id = ? ORDER BY sort_order, name")
      .bind(ownerId)
      .all<{
        id: string;
        name: string;
        sort_order: number;
        due_day: number | null;
        closing_day: number | null;
      }>(),
    cardLabelCounts(db, ownerId),
  ]);
  return (result.results ?? []).map((card) => ({
    id: card.id,
    name: card.name,
    sortOrder: card.sort_order,
    dueDay: card.due_day ?? null,
    closingDay: card.closing_day ?? null,
    expenseCount: expenseCountForCard(labels, card.name),
  }));
}

async function cardLabelCounts(db: D1Database, ownerId: string): Promise<Array<{ label: string | null; count: number }>> {
  const result = await db
    .prepare("SELECT card_label AS label, COUNT(*) AS count FROM expenses WHERE owner_id = ? AND card_label IS NOT NULL GROUP BY card_label")
    .bind(ownerId)
    .all<{ label: string | null; count: number }>();
  return result.results ?? [];
}

export async function updateCard(
  db: D1Database,
  ownerId: string,
  cardId: string,
  input: { name: string; dueDay: number | null; closingDay: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [cards, labels] = await Promise.all([listCards(db, ownerId), cardLabelCounts(db, ownerId)]);
  const current = cards.find((card) => card.id === cardId);
  if (!current) return { ok: false, error: "Cartão não encontrado." };
  const key = cardKey(input.name);
  if (key && cards.some((card) => card.id !== cardId && cardKey(card.name) === key)) {
    return { ok: false, error: "Já existe um cartão com esse nome." };
  }
  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE cards SET name = ?, due_day = ?, closing_day = ? WHERE owner_id = ? AND id = ?")
      .bind(input.name, input.dueDay, input.closingDay, ownerId, cardId),
  ];
  if (current.name !== input.name) {
    for (const item of labels) {
      if (cardKey(item.label) !== cardKey(current.name) || !item.label || item.label === input.name) continue;
      statements.push(
        db
          .prepare("UPDATE expenses SET card_label = ? WHERE owner_id = ? AND card_label = ?")
          .bind(input.name, ownerId, item.label),
      );
    }
    statements.push(
      db
        .prepare("UPDATE partial_payments SET card_label = ? WHERE owner_id = ? AND card_label = ? COLLATE NOCASE")
        .bind(input.name, ownerId, current.name),
    );
  }
  try {
    await runStatements(db, statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe um cartão com esse nome." };
    throw error;
  }
  return { ok: true };
}

export async function deleteCard(
  db: D1Database,
  ownerId: string,
  cardId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  const current = cards.find((card) => card.id === cardId);
  if (!current) return { ok: false, error: "Cartão não encontrado." };
  if (current.expenseCount > 0) {
    return { ok: false, error: "Este cartão tem gastos lançados. A exclusão só fica disponível quando não houver nenhum." };
  }
  await db.prepare("DELETE FROM cards WHERE owner_id = ? AND id = ?").bind(ownerId, cardId).run();
  return { ok: true };
}

export async function createCard(
  db: D1Database,
  ownerId: string,
  name: string,
  dueDay: number | null = null,
  closingDay: number | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cards = await listCards(db, ownerId);
  const key = cardKey(name);
  if (key && cards.some((card) => cardKey(card.name) === key)) {
    return { ok: false, error: "Já existe um cartão com esse nome." };
  }
  const sortOrder = cards.reduce((max, card) => Math.max(max, card.sortOrder), -1) + 1;
  try {
    await db
      .prepare("INSERT INTO cards (id, owner_id, name, sort_order, due_day, closing_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), ownerId, name, sortOrder, dueDay, closingDay, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe um cartão com esse nome." };
    throw error;
  }
  return { ok: true };
}

function payoffMarker(cardId: string, monthId: string): string {
  return `quitado-cartao:${cardId}:${monthId}`;
}

function planMarker(cardId: string, monthId: string): string {
  return `parcelamento:${cardId}:${monthId}`;
}

function noteWithMarker(note: string | null, marker: string): string {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.includes(marker)) lines.push(marker);
  return lines.join("\n");
}

function noteWithoutMarker(note: string | null, marker: string): string | null {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter((line) => line && line !== marker);
  return lines.length ? lines.join("\n") : null;
}

function hasMarker(note: string | null, marker: string): boolean {
  return String(note || "").split("\n").map((line) => line.trim()).includes(marker);
}

export async function payCardInvoice(
  db: D1Database,
  input: {
    ownerId: string;
    cardId: string;
    monthId: string;
    cardName: string;
    mode: "pix" | "installments";
    downCents?: number;
    count?: number;
    installmentCents?: number;
    startMonthId?: string;
    knownMonths: readonly string[];
  },
): Promise<{ ok: true; paidCents: number } | { ok: false; error: string }> {
  const expenses = await listExpenses(db, input.ownerId, input.monthId);
  const open = cardOpenExpenses(expenses, input.cardName);
  const balance = open.reduce((sum, expense) => sum + expense.amountCents, 0);
  if (balance <= 0) return { ok: false, error: "Este cartão não tem valor em aberto neste mês." };
  const plan = input.mode === "installments"
    ? planCardPayoff({
      balanceCents: balance,
      downCents: input.downCents ?? 0,
      count: input.count ?? 0,
      installmentCents: input.installmentCents ?? 0,
      startMonthId: input.startMonthId ?? "",
    })
    : null;
  if (plan && !plan.ok) return plan;
  if (plan?.ok) {
    const missing = plan.schedule.find((part) => !input.knownMonths.includes(part.monthId));
    if (missing) {
      return { ok: false, error: "O parcelamento passa do período gerenciado. Aumente o período ou reduza as parcelas." };
    }
  }
  const settled = payoffMarker(input.cardId, input.monthId);
  const statements: D1PreparedStatement[] = open.map((expense) => {
    const nextNote = noteWithMarker(expense.note, settled);
    return db
      .prepare(`UPDATE expenses SET paid = 1, note = ?, ${EXPENSE_META_SET_SQL} WHERE owner_id = ? AND id = ?`)
      .bind(nextNote, ...expenseMetaParams(expense.section, nextNote), input.ownerId, expense.id);
  });
  if (plan?.ok) {
    const createdAt = new Date().toISOString();
    const name = `Parcelamento ${input.cardName}`.slice(0, 120);
    const marker = planMarker(input.cardId, input.monthId);
    const used = await nextSorts(db, input.ownerId, plan.schedule.map((part) => part.monthId));
    for (const part of plan.schedule) {
      const sort = (used.get(part.monthId) ?? 0) + 1;
      used.set(part.monthId, sort);
      statements.push(
        prepareInsertExpense(db, {
          id: crypto.randomUUID(),
          ownerId: input.ownerId,
          monthId: part.monthId,
          name,
          section: "card",
          amountCents: part.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: input.cardName,
          paid: false,
          note: marker,
          installment: part.installment,
          sortOrder: sort,
          createdAt,
        }),
      );
    }
  }
  await runStatements(db, statements);
  return { ok: true, paidCents: balance };
}

export async function undoCardInvoice(
  db: D1Database,
  input: { ownerId: string; cardId: string; cardName: string; monthId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.prepare(
    "SELECT id, month_id, section, note, name, card_label FROM expenses WHERE owner_id = ?",
  ).bind(input.ownerId).all<{ id: string; month_id: string; section: string; note: string | null; name: string; card_label: string | null }>();
  const all = rows.results ?? [];
  const settled = payoffMarker(input.cardId, input.monthId);
  const planned = planMarker(input.cardId, input.monthId);
  const tagged = all.filter((row) => hasMarker(row.note, settled));
  const installments = all.filter((row) => hasMarker(row.note, planned));
  if (tagged.length || installments.length) {
    await runStatements(db, [
      ...tagged.map((row) => {
        const nextNote = noteWithoutMarker(row.note, settled);
        return db
          .prepare(`UPDATE expenses SET paid = 0, note = ?, ${EXPENSE_META_SET_SQL} WHERE owner_id = ? AND id = ?`)
          .bind(nextNote, ...expenseMetaParams(row.section, nextNote), input.ownerId, row.id);
      }),
      ...installments.map((row) =>
        db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, row.id),
      ),
    ]);
    return { ok: true };
  }
  const monthExpenses = await listExpenses(db, input.ownerId, input.monthId);
  const paidLines = monthExpenses.filter((expense) => (
    cardKey(expense.cardLabel) === cardKey(input.cardName)
    && expense.paid
    && expense.amountCents > 0
    && !(expense.section === "fixed" && (expense.onCard || expense.payment === "card"))
  ));
  const legacy = all.filter((row) => row.name === `Parcelamento ${input.cardName}` && cardKey(row.card_label) === cardKey(input.cardName));
  if (!paidLines.length && !legacy.length) {
    return { ok: false, error: "Não há pagamento deste cartão para desfazer neste mês." };
  }
  await runStatements(db, [
    ...paidLines.map((expense) =>
      db.prepare("UPDATE expenses SET paid = 0 WHERE owner_id = ? AND id = ?").bind(input.ownerId, expense.id),
    ),
    ...legacy.map((row) =>
      db.prepare("DELETE FROM expenses WHERE owner_id = ? AND id = ?").bind(input.ownerId, row.id),
    ),
  ]);
  return { ok: true };
}
