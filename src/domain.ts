export type Section = "card" | "fixed" | "extra";
export type Payment = "pix" | "card" | "debit" | "cash";

export type PartialPayment = {
  id: string;
  amountCents: number;
  payment: Payment;
  cardLabel: string | null;
  installment: string | null;
  createdAt: string;
};

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
  createdAt?: string;
  partials?: PartialPayment[];
};

export function partialSplit(partials: readonly PartialPayment[]): { cashPaid: number; cardPaid: number; total: number } {
  let cashPaid = 0;
  let cardPaid = 0;
  for (const partial of partials) {
    if (partial.payment === "card") cardPaid += partial.amountCents;
    else cashPaid += partial.amountCents;
  }
  return { cashPaid, cardPaid, total: cashPaid + cardPaid };
}

export type Totals = {
  invoiceCents: number;
  extrasCardCents: number;
  faturaCents: number;
  fixedCents: number;
  fixedOnCardCents: number;
  fixedCashCents: number;
  fixedForecastCents: number;
  fixedLaunchedCents: number;
  fixedAllSettled: boolean;
  extrasPixCents: number;
  commitmentsCents: number;
  paidCents: number;
  remainingCents: number;
  launchedRemainingCents: number;
  balanceCents: number;
  partialBalanceCents: number;
  forecastExpenseCents: number;
  partialExpenseCents: number;
};

export function monthCanSettle(totals: Pick<Totals, "remainingCents" | "commitmentsCents">): boolean {
  return totals.remainingCents === 0 && totals.commitmentsCents > 0;
}

export function isFixedOnCard(expense: Pick<Expense, "section" | "onCard">): boolean {
  return expense.section === "fixed" && expense.onCard;
}

export function countsTowardPayment(expense: Pick<Expense, "section" | "onCard" | "payment" | "amountCents">): boolean {
  return expense.amountCents !== 0 && !isFixedOnCard(expense);
}

export function computeTotals(expenses: readonly Expense[], incomeCents: number): Totals {
  let invoiceCents = 0;
  let extrasCardCents = 0;
  let fixedCents = 0;
  let fixedOnCardCents = 0;
  let fixedForecastCents = 0;
  let fixedLaunchedCents = 0;
  let fixedHeldCents = 0;
  let fixedOpen = 0;
  let extrasPixCents = 0;
  let paidCents = 0;
  let remainingCents = 0;

  for (const expense of expenses) {
    if (expense.section === "card") invoiceCents += expense.amountCents;
    if (expense.section === "extra" && expense.payment === "card") extrasCardCents += expense.amountCents;
    if (expense.section === "extra" && expense.payment !== "card") extrasPixCents += expense.amountCents;
    const partials = expense.partials ?? [];
    if (expense.section === "fixed" && !isFixedOnCard(expense) && !expense.paid && !partials.length) {
      fixedForecastCents += expense.amountCents;
      fixedCents += expense.amountCents;
      fixedHeldCents += expense.amountCents;
      fixedOpen += 1;
      continue;
    }
    if (expense.section === "fixed" && !isFixedOnCard(expense) && partials.length) {
      const split = partialSplit(partials);
      const shown = expense.paid ? split.total : Math.max(expense.amountCents, split.total);
      fixedForecastCents += expense.amountCents;
      fixedLaunchedCents += split.total;
      fixedCents += shown;
      fixedOnCardCents += split.cardPaid;
      fixedHeldCents += Math.max(0, shown - split.total);
      paidCents += split.cashPaid;
      if (!expense.paid) fixedOpen += 1;
      continue;
    }
    if (expense.section === "fixed") {
      fixedForecastCents += expense.amountCents;
      fixedCents += expense.amountCents;
      if (isFixedOnCard(expense)) fixedOnCardCents += expense.amountCents;
      if (expense.paid || isFixedOnCard(expense)) fixedLaunchedCents += expense.amountCents;
      else {
        fixedHeldCents += expense.amountCents;
        fixedOpen += 1;
      }
    }
    if (!countsTowardPayment(expense)) continue;
    if (expense.paid) paidCents += expense.amountCents;
    else remainingCents += expense.amountCents;
  }

  const fixedCashCents = fixedCents - fixedOnCardCents - fixedHeldCents;
  const faturaCents = invoiceCents + extrasCardCents;
  const commitmentsCents = faturaCents + fixedCashCents + extrasPixCents;
  const partialBalanceCents = incomeCents - commitmentsCents;
  const launchedRemainingCents = remainingCents;

  return {
    invoiceCents,
    extrasCardCents,
    faturaCents,
    fixedCents,
    fixedOnCardCents,
    fixedCashCents,
    fixedForecastCents,
    fixedLaunchedCents,
    fixedAllSettled: fixedForecastCents > 0 && fixedOpen === 0,
    extrasPixCents,
    commitmentsCents,
    paidCents,
    remainingCents: launchedRemainingCents + fixedHeldCents,
    launchedRemainingCents,
    balanceCents: partialBalanceCents - fixedHeldCents,
    partialBalanceCents,
    forecastExpenseCents: commitmentsCents + fixedHeldCents,
    partialExpenseCents: commitmentsCents,
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
  const payment: Payment = input.onCard || input.payment === "card" ? "card" : input.payment === "cash" ? "cash" : "pix";
  return {
    section: "fixed",
    payment,
    onCard: input.onCard,
    cardLabel: payment === "card" ? cardLabel : null,
  };
}

export function livingCostMonths(monthIds: readonly string[], invoiceMonthId: string): string[] {
  return monthIds.filter((monthId) => monthId >= invoiceMonthId);
}

export type LivingCostRef = {
  id: string;
  name: string;
  section: Section;
  monthId: string;
  onCard: boolean;
  paid: boolean;
  hasPartials?: boolean;
};

export function sameLivingName(left: string, right: string): boolean {
  const a = left.trim().toLocaleLowerCase("pt-BR");
  const b = right.trim().toLocaleLowerCase("pt-BR");
  return a.length > 0 && a === b;
}

export function livingCardSendTargets(
  expenses: readonly LivingCostRef[],
  currentId: string,
  scope: "month" | "following",
): string[] {
  const current = expenses.find((item) => item.id === currentId);
  if (!current || current.section !== "fixed") return [];
  if (scope !== "following") return [current.id];
  const later = expenses.filter((item) =>
    item.id !== current.id
    && item.section === "fixed"
    && sameLivingName(item.name, current.name)
    && item.monthId >= current.monthId
    && !item.onCard
    && !item.paid
    && !item.hasPartials,
  );
  return [current, ...later]
    .sort((left, right) => left.monthId.localeCompare(right.monthId) || left.id.localeCompare(right.id))
    .map((item) => item.id);
}

export function livingCardUndoTargets(
  expenses: readonly LivingCostRef[],
  currentId: string,
  scope: "month" | "series",
): string[] {
  const current = expenses.find((item) => item.id === currentId);
  if (!current || current.section !== "fixed" || !current.onCard) return [];
  if (scope !== "series") return [current.id];
  return expenses
    .filter((item) => item.section === "fixed" && item.onCard && sameLivingName(item.name, current.name))
    .sort((left, right) => left.monthId.localeCompare(right.monthId) || left.id.localeCompare(right.id))
    .map((item) => item.id);
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

export function listMonthRange(
  startMonthId: string,
  endMonthId: string,
): { ok: true; months: string[] } | { ok: false; error: string } {
  if (!isCalendarMonth(startMonthId) || !isCalendarMonth(endMonthId)) {
    return { ok: false, error: "Escolha o mês e o ano de início e de fim." };
  }
  const span = monthSortOrder(endMonthId) - monthSortOrder(startMonthId) + 1;
  if (span <= 0) return { ok: false, error: "O fim do período precisa ser o início ou um mês depois." };
  if (span > 48) return { ok: false, error: "Escolha um período de até 48 meses." };
  const months = [];
  for (let offset = 0; offset < span; offset += 1) months.push(addMonths(startMonthId, offset));
  return { ok: true, months };
}

export function resetTargets(
  monthIds: readonly string[],
  input: { scope: string; year?: number; monthId?: string },
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (input.scope === "all") {
    if (!monthIds.length) return { ok: false, error: "Não há período para apagar." };
    return { ok: true, ids: [...monthIds] };
  }
  if (input.scope === "year") {
    const year = input.year;
    if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return { ok: false, error: "Escolha o ano." };
    }
    const ids = monthIds.filter((id) => id.startsWith(`${year}-`));
    if (!ids.length) return { ok: false, error: "Esse ano não está no período." };
    return { ok: true, ids };
  }
  if (input.scope === "month") {
    if (!input.monthId || !monthIds.includes(input.monthId)) {
      return { ok: false, error: "Esse mês não está no período." };
    }
    return { ok: true, ids: [input.monthId] };
  }
  return { ok: false, error: "Escolha o que apagar." };
}

function isCalendarMonth(monthId: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
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

function cleanCardLabel(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 40);
  return trimmed.length > 0 ? trimmed : null;
}
