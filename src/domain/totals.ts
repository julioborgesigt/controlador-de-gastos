import { chargedInvoiceMonth, isZeroFinalizedNote } from "../../public/shared/note-markers.js";
import {
  cleanCardLabel,
  coercePayment,
  partialSplit,
  type Expense,
  type Payment,
  type Section,
  type Totals,
} from "./types.ts";

export function monthCanSettle(totals: Pick<Totals, "remainingCents" | "commitmentsCents">): boolean {
  return totals.remainingCents === 0 && totals.commitmentsCents > 0;
}

export function isFixedOnCard(expense: Pick<Expense, "section" | "onCard">): boolean {
  return expense.section === "fixed" && expense.onCard;
}

export function extraChargesOwnMonth(expense: { section: Section; payment: Payment; monthId?: string; note?: string | null }): boolean {
  if (expense.section !== "extra" || expense.payment !== "card") return false;
  const invoice = chargedInvoiceMonth(expense.note);
  return !invoice || !expense.monthId || invoice === expense.monthId;
}

export function countsTowardPayment(expense: Pick<Expense, "section" | "onCard" | "payment" | "amountCents"> & { monthId?: string; note?: string | null }): boolean {
  if (expense.amountCents === 0 || isFixedOnCard(expense)) return false;
  if (expense.section === "extra" && expense.payment === "card" && !extraChargesOwnMonth(expense)) return false;
  return true;
}

function pixAlreadyPaid(expense: Expense): number {
  if (isFixedOnCard(expense)) return 0;
  const partials = expense.partials ?? [];
  const fromPartials = partials
    .filter((item) => item.payment === "pix")
    .reduce((sum, item) => sum + item.amountCents, 0);
  if (partials.length || isZeroFinalizedNote(expense.note)) return fromPartials;
  if (expense.paid && expense.payment === "pix") return expense.amountCents;
  return 0;
}

function pixStillDue(expense: Expense): number {
  if (expense.paid || isFixedOnCard(expense)) return 0;
  if (expense.payment === "card") return 0;
  const paid = (expense.partials ?? []).reduce((sum, item) => sum + item.amountCents, 0);
  return Math.max(0, expense.amountCents - paid);
}

function cardStillDue(expense: Expense): number {
  if (expense.paid || isFixedOnCard(expense)) return 0;
  if (expense.payment !== "card") return 0;
  const paid = (expense.partials ?? []).reduce((sum, item) => sum + item.amountCents, 0);
  return Math.max(0, expense.amountCents - paid);
}

export function computeTotals(expenses: readonly Expense[], incomeCents: number): Totals {
  let invoiceCents = 0;
  let extrasCardCents = 0;
  let fixedCents = 0;
  let fixedOnCardCents = 0;
  let fixedPixPaidCents = 0;
  let fixedPixForecastCents = 0;
  let fixedCardDueCents = 0;
  let fixedForecastCents = 0;
  let fixedLaunchedCents = 0;
  let fixedHeldCents = 0;
  let fixedOpen = 0;
  let extrasPixCents = 0;
  let paidCents = 0;
  let remainingCents = 0;

  for (const expense of expenses) {
    if (expense.section === "fixed") {
      fixedPixForecastCents += pixStillDue(expense);
      fixedPixPaidCents += pixAlreadyPaid(expense);
      fixedCardDueCents += cardStillDue(expense);
    }
    if (expense.section === "card") invoiceCents += expense.amountCents;
    if (extraChargesOwnMonth(expense)) extrasCardCents += expense.amountCents;
    if (expense.section === "extra" && expense.payment !== "card") extrasPixCents += expense.amountCents;
    const partials = expense.partials ?? [];
    if (expense.section === "fixed" && !isFixedOnCard(expense) && !expense.paid && !partials.length) {
      fixedForecastCents += expense.amountCents;
      fixedCents += expense.amountCents;
      fixedHeldCents += expense.amountCents;
      fixedOpen += 1;
      continue;
    }
    if (expense.section === "fixed" && !isFixedOnCard(expense) && (partials.length || (expense.paid && isZeroFinalizedNote(expense.note)))) {
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
    fixedPixPaidCents,
    fixedPixForecastCents,
    fixedCardDueCents,
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
  payment: Payment | string;
  onCard: boolean;
  cardLabel: string | null;
}): { section: Section; payment: Payment; onCard: boolean; cardLabel: string | null } {
  const cardLabel = cleanCardLabel(input.cardLabel);
  const method = coercePayment(input.payment);
  if (input.section === "card") {
    return { section: "card", payment: "card", onCard: false, cardLabel };
  }
  if (input.section === "extra") {
    return {
      section: "extra",
      payment: method,
      onCard: false,
      cardLabel: method === "card" ? cardLabel : null,
    };
  }
  const payment: Payment = input.onCard || method === "card" ? "card" : "pix";
  return {
    section: "fixed",
    payment,
    onCard: input.onCard,
    cardLabel: payment === "card" ? cardLabel : null,
  };
}
