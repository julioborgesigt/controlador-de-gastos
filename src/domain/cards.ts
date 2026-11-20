import { addMonths, isCalendarMonth } from "./months.ts";
import { extraChargesOwnMonth, isFixedOnCard } from "./totals.ts";
import { cardKey, type CardPurchasePlan, type Expense } from "./types.ts";

export function parseInstallment(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Parcela inválida." };
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  const match = /^(\d{1,3})\/(\d{1,3})$/.exec(text);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) {
    return { ok: false, error: "Use a parcela no formato 3/10." };
  }
  return { ok: true, value: `${Number(match[1])}/${Number(match[2])}` };
}

export function planCardPurchase(input: {
  startMonthId: string;
  totalCount: number;
  paidCount: number;
  amountCents: number;
  mode: "installment" | "total";
}): { ok: true; plan: CardPurchasePlan } | { ok: false; error: string } {
  if (!Number.isInteger(input.totalCount) || input.totalCount < 1 || input.totalCount > 48) {
    return { ok: false, error: "Informe de 1 a 48 parcelas." };
  }
  if (!Number.isInteger(input.paidCount) || input.paidCount < 0 || input.paidCount >= input.totalCount) {
    return { ok: false, error: "As parcelas já pagas precisam ser menores que o total." };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "Informe um valor maior que zero." };
  }
  const installmentCents = input.mode === "total" ? Math.floor(input.amountCents / input.totalCount) : input.amountCents;
  if (installmentCents <= 0) return { ok: false, error: "O valor total não cobre todas as parcelas." };
  const remainder = input.mode === "total" ? input.amountCents - installmentCents * input.totalCount : 0;
  const remaining = input.totalCount - input.paidCount;
  const schedule = [];
  for (let index = 0; index < remaining; index += 1) {
    const number = input.paidCount + 1 + index;
    const isLast = number === input.totalCount;
    schedule.push({
      monthId: addMonths(input.startMonthId, index),
      installment: input.totalCount > 1 ? `${number}/${input.totalCount}` : null,
      amountCents: installmentCents + (isLast ? remainder : 0),
    });
  }
  return { ok: true, plan: { schedule } };
}

export function parseDueDay(value: unknown): { ok: true; dueDay: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, dueDay: null };
  const day = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return { ok: false, error: "O vencimento é um dia de 1 a 31." };
  }
  return { ok: true, dueDay: day };
}

export function parseCardName(value: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Dê um nome ao cartão." };
  const name = value.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return { ok: false, error: "Dê um nome ao cartão." };
  return { ok: true, name };
}

export function expenseCountForCard(
  labels: readonly { label: string | null; count: number }[],
  cardName: string,
): number {
  const key = cardKey(cardName);
  if (!key) return 0;
  return labels.reduce((sum, item) => sum + (cardKey(item.label) === key ? item.count : 0), 0);
}

export function expenseBelongsToCard(expense: Pick<Expense, "section" | "payment" | "onCard"> & { monthId?: string; note?: string | null }): boolean {
  return expense.section === "card" || extraChargesOwnMonth(expense) || isFixedOnCard(expense);
}

export function cardLinkRequired(expense: Pick<Expense, "section" | "payment" | "onCard">): boolean {
  if (expense.section === "extra" && expense.payment === "card") return true;
  if (isFixedOnCard(expense)) return true;
  return false;
}

export function resolveCardLabel(
  cards: readonly { name: string }[],
  cardLabel: string | null,
  required: boolean,
): { ok: true; cardLabel: string | null } | { ok: false; error: string } {
  const key = cardKey(cardLabel);
  if (!key) {
    return required
      ? { ok: false, error: "Escolha o cartão deste gasto." }
      : { ok: true, cardLabel: null };
  }
  const match = cards.find((card) => cardKey(card.name) === key);
  if (!match) return { ok: false, error: "Esse cartão não está cadastrado. Adicione o cartão antes." };
  return { ok: true, cardLabel: match.name };
}

export function expensesForCard(expenses: readonly Expense[], cardName: string): Expense[] {
  const key = cardKey(cardName);
  if (!key) return [];
  return expenses.filter((expense) => expenseBelongsToCard(expense) && cardKey(expense.cardLabel) === key);
}

export function cardInvoiceCents(expenses: readonly Expense[], cardName: string): number {
  return expensesForCard(expenses, cardName)
    .filter((expense) => !isFixedOnCard(expense))
    .reduce((sum, expense) => sum + expense.amountCents, 0);
}

export function cardOpenExpenses(expenses: readonly Expense[], cardName: string): Expense[] {
  return expensesForCard(expenses, cardName).filter(
    (expense) => !isFixedOnCard(expense) && !expense.paid && expense.amountCents > 0,
  );
}

export function planCardPayoff(input: {
  balanceCents: number;
  downCents: number;
  count: number;
  installmentCents: number;
  startMonthId: string;
}): { ok: true; downCents: number; financedCents: number; schedule: Array<{ monthId: string; amountCents: number; installment: string }> } | { ok: false; error: string } {
  if (!Number.isInteger(input.balanceCents) || input.balanceCents <= 0) {
    return { ok: false, error: "Este cartão não tem valor em aberto." };
  }
  if (!Number.isInteger(input.downCents) || input.downCents < 0 || input.downCents >= input.balanceCents) {
    return { ok: false, error: "A entrada precisa ser menor que a fatura em aberto. Para pagar tudo agora, use Pago no Pix." };
  }
  if (!Number.isInteger(input.count) || input.count < 2 || input.count > 48) {
    return { ok: false, error: "Informe de 2 a 48 parcelas." };
  }
  if (!isCalendarMonth(input.startMonthId)) {
    return { ok: false, error: "Escolha o mês em que o parcelamento começa." };
  }
  if (!Number.isInteger(input.installmentCents) || input.installmentCents <= 0) {
    return { ok: false, error: "Informe o valor da parcela." };
  }
  const financedCents = input.balanceCents - input.downCents;
  const base = Math.floor(financedCents / input.count);
  const remainder = financedCents - base * input.count;
  const closes = input.installmentCents * input.count === financedCents
    || (input.installmentCents === base && remainder > 0 && remainder < input.count);
  if (!closes) {
    return { ok: false, error: "O valor das parcelas não fecha com o que falta depois da entrada." };
  }
  const schedule = [];
  for (let index = 0; index < input.count; index += 1) {
    const last = index === input.count - 1;
    schedule.push({
      monthId: addMonths(input.startMonthId, index),
      amountCents: input.installmentCents + (last && input.installmentCents === base ? remainder : 0),
      installment: `${index + 1}/${input.count}`,
    });
  }
  return { ok: true, downCents: input.downCents, financedCents, schedule };
}

export function unassignedCardExpenses(expenses: readonly Expense[], cards: readonly { name: string }[]): Expense[] {
  const keys = new Set(cards.map((card) => cardKey(card.name)).filter((key): key is string => key !== null));
  return expenses.filter((expense) => {
    if (!expenseBelongsToCard(expense)) return false;
    const key = cardKey(expense.cardLabel);
    return key === null || !keys.has(key);
  });
}
