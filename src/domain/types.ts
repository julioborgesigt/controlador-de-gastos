export type Section = "card" | "fixed" | "extra";
export type Payment = "pix" | "card";

export function coercePayment(value: unknown): Payment {
  return value === "card" ? "card" : "pix";
}

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
  importBatchId?: string | null;
  recentlyImported?: boolean;
  futureInstallmentCount?: number;
  futureMonthIds?: string[];
  partials?: PartialPayment[];
};

export type Totals = {
  invoiceCents: number;
  extrasCardCents: number;
  faturaCents: number;
  fixedCents: number;
  fixedOnCardCents: number;
  fixedCashCents: number;
  fixedPixPaidCents: number;
  fixedPixForecastCents: number;
  fixedCardDueCents: number;
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

export type LivingCostRef = {
  id: string;
  name: string;
  section: Section;
  monthId: string;
  onCard: boolean;
  paid: boolean;
  hasPartials?: boolean;
  note?: string | null;
  createdAt?: string | null;
  cardLabel?: string | null;
};

export type ExpenseDeleteRef = {
  id: string;
  name: string;
  section: Section;
  monthId: string;
  cardLabel: string | null;
  payment?: Payment | null;
  note?: string | null;
  createdAt?: string | null;
};

export type EditScope = "month" | "forward" | "all";
export type ExpenseTrack = "imprevisto" | "planejado" | "casa";

export type CardPurchasePlan = {
  schedule: Array<{ monthId: string; installment: string | null; amountCents: number }>;
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

export function cleanCardLabel(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 40);
  return trimmed.length > 0 ? trimmed : null;
}

export function cardKey(value: string | null | undefined): string | null {
  const cleaned = cleanCardLabel(value ?? null);
  return cleaned ? cleaned.toLocaleLowerCase("pt-BR") : null;
}
