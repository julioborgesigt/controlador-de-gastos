export type Section = "card" | "fixed" | "extra";
export type Payment = "pix" | "card";

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
    const payment: Payment = input.payment === "card" ? "card" : "pix";
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

function cleanCardLabel(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 40);
  return trimmed.length > 0 ? trimmed : null;
}
