export type Section = "card" | "fixed" | "extra";
export type Payment = "pix" | "card" | "debit" | "cash";

export type Expense = {
  id: string;
  monthId: string;
  name: string;
  section: Section;
  amountCents: number;
  payment: Payment;
  onCard: boolean;
  cardLabel: string | null;
  paid: boolean;
  note: string | null;
  installment: string | null;
  sortOrder: number;
  source: "sheet" | "user";
};

export type Totals = {
  invoiceCents: number;
  extrasCardCents: number;
  faturaCents: number;
  fixedCents: number;
  fixedOnCardCents: number;
  fixedCashCents: number;
  extrasPixCents: number;
  commitmentsCents: number;
  paidCents: number;
  remainingCents: number;
  balanceCents: number;
};

export function isFixedOnCard(expense: Pick<Expense, "section" | "onCard" | "payment">): boolean {
  return expense.section === "fixed" && (expense.onCard || expense.payment === "card");
}

export function countsTowardPayment(expense: Pick<Expense, "section" | "onCard" | "payment" | "amountCents">): boolean {
  return expense.amountCents !== 0 && !isFixedOnCard(expense);
}

export function computeTotals(expenses: readonly Expense[], incomeCents: number): Totals {
  let invoiceCents = 0;
  let extrasCardCents = 0;
  let fixedCents = 0;
  let fixedOnCardCents = 0;
  let extrasPixCents = 0;
  let paidCents = 0;
  let remainingCents = 0;

  for (const expense of expenses) {
    if (expense.section === "card") invoiceCents += expense.amountCents;
    if (expense.section === "extra" && expense.payment === "card") extrasCardCents += expense.amountCents;
    if (expense.section === "extra" && expense.payment !== "card") extrasPixCents += expense.amountCents;
    if (expense.section === "fixed") {
      fixedCents += expense.amountCents;
      if (isFixedOnCard(expense)) fixedOnCardCents += expense.amountCents;
    }
    if (!countsTowardPayment(expense)) continue;
    if (expense.paid) paidCents += expense.amountCents;
    else remainingCents += expense.amountCents;
  }

  const fixedCashCents = fixedCents - fixedOnCardCents;
  const faturaCents = invoiceCents + extrasCardCents;
  const commitmentsCents = faturaCents + fixedCashCents + extrasPixCents;

  return {
    invoiceCents,
    extrasCardCents,
    faturaCents,
    fixedCents,
    fixedOnCardCents,
    fixedCashCents,
    extrasPixCents,
    commitmentsCents,
    paidCents,
    remainingCents,
    balanceCents: incomeCents - commitmentsCents,
  };
}

export function normalizeExpense(input: {
  section: Section;
  payment: Payment;
  onCard: boolean;
  cardLabel: string | null;
}): { section: Section; payment: Payment; onCard: boolean; cardLabel: string | null } {
  const cardLabel = cleanCardLabel(input.cardLabel);
  if (input.section === "card") {
    return { section: "card", payment: "card", onCard: false, cardLabel };
  }
  if (input.section === "extra") {
    const payment: Payment =
      input.payment === "card" || input.payment === "debit" || input.payment === "cash" ? input.payment : "pix";
    return {
      section: "extra",
      payment,
      onCard: false,
      cardLabel: payment === "card" ? cardLabel : null,
    };
  }
  const onCard = input.onCard || input.payment === "card";
  return {
    section: "fixed",
    payment: onCard ? "card" : "pix",
    onCard,
    cardLabel: onCard ? cardLabel : null,
  };
}

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

export function previousMonthId(monthId: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function addMonths(monthId: string, offset: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!match) return monthId;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthId: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!match) return monthId;
  return `${MONTH_LABELS[Number(match[2]) - 1]} ${match[1]}`;
}

export function monthSortOrder(monthId: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!match) return 0;
  return Number(match[1]) * 12 + Number(match[2]);
}

export type CardPurchasePlan = {
  schedule: Array<{ monthId: string; installment: string | null; amountCents: number }>;
};

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

export function carryForward(expense: Expense): Expense | null {
  if (expense.source !== "user" || expense.amountCents === 0) return null;
  if (expense.section !== "fixed" && !expense.installment) return null;
  let installment = expense.installment;
  if (installment && expense.section !== "fixed") {
    const parsed = parseInstallment(installment);
    if (!parsed.ok || !parsed.value) return null;
    const [current, total] = parsed.value.split("/").map(Number);
    if (current >= total) return null;
    installment = `${current + 1}/${total}`;
  }
  const next = { ...expense, id: "", paid: false, installment };
  if (expense.section === "fixed") {
    next.onCard = false;
    next.payment = expense.payment === "card" ? "pix" : expense.payment;
    next.cardLabel = null;
  }
  return next;
}

export function parseCardName(value: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Dê um nome ao cartão." };
  const name = value.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return { ok: false, error: "Dê um nome ao cartão." };
  return { ok: true, name };
}

export function cardKey(value: string | null | undefined): string | null {
  const cleaned = cleanCardLabel(value ?? null);
  return cleaned ? cleaned.toLocaleLowerCase("pt-BR") : null;
}

export function expenseBelongsToCard(expense: Pick<Expense, "section" | "payment" | "onCard">): boolean {
  return expense.section === "card" || (expense.section === "extra" && expense.payment === "card") || isFixedOnCard(expense);
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

export function unassignedCardExpenses(expenses: readonly Expense[], cards: readonly { name: string }[]): Expense[] {
  const keys = new Set(cards.map((card) => cardKey(card.name)).filter((key): key is string => key !== null));
  return expenses.filter((expense) => {
    if (!expenseBelongsToCard(expense)) return false;
    const key = cardKey(expense.cardLabel);
    return key === null || !keys.has(key);
  });
}

function cleanCardLabel(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 40);
  return trimmed.length > 0 ? trimmed : null;
}
