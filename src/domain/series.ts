import { originIdFrom, partialIdFrom, seriesIdFrom } from "../../public/shared/note-markers.js";
import { parseInstallment } from "./cards.ts";
import { noteWithFinalizedZero } from "./notes.ts";
import { cardKey, type EditScope, type Expense, type ExpenseDeleteRef, type LivingCostRef } from "./types.ts";

export function sameLivingName(left: string, right: string): boolean {
  const a = left.trim().toLocaleLowerCase("pt-BR");
  const b = right.trim().toLocaleLowerCase("pt-BR");
  return a.length > 0 && a === b;
}

export function sameAccount(
  current: { id: string; name: string; section?: string; cardLabel?: string | null; note?: string | null; createdAt?: string | null },
  item: { id: string; name: string; section?: string; cardLabel?: string | null; note?: string | null; createdAt?: string | null },
): boolean {
  if (item.id === current.id) return true;
  if (current.section && item.section && current.section !== item.section) return false;
  const left = seriesIdFrom(current.note);
  const right = seriesIdFrom(item.note);
  if (left || right) return left !== "" && left === right;
  const sameBatch = Boolean(current.createdAt && item.createdAt && current.createdAt === item.createdAt);
  const unnamedLegacy = !current.createdAt && !item.createdAt;
  if (!sameBatch && !unnamedLegacy) return false;
  if (!sameLivingName(current.name, item.name)) return false;
  if ((current.section === "card" || item.section === "card") && cardKey(current.cardLabel) !== cardKey(item.cardLabel)) return false;
  return true;
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
    && sameAccount(current, item)
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
    .filter((item) => item.section === "fixed" && item.onCard && sameAccount(current, item))
    .sort((left, right) => left.monthId.localeCompare(right.monthId) || left.id.localeCompare(right.id))
    .map((item) => item.id);
}

export function expenseDeleteTargets(
  expenses: readonly ExpenseDeleteRef[],
  currentId: string,
  scope: "month" | "forward" | "series",
): string[] {
  const current = expenses.find((item) => item.id === currentId);
  if (!current || scope === "month") return current ? [current.id] : [];
  const cardSurprise = current.section === "extra" && current.payment === "card";
  const repeatable = current.section === "fixed" || current.section === "card" || cardSurprise;
  if (!repeatable || (scope !== "series" && scope !== "forward")) return [current.id];
  return expenses
    .filter((item) => {
      if (item.section !== current.section || !sameAccount(current, item)) return false;
      if (cardSurprise && item.payment !== "card") return false;
      if (scope === "forward" && item.monthId < current.monthId) return false;
      return true;
    })
    .sort((left, right) => left.monthId.localeCompare(right.monthId) || left.id.localeCompare(right.id))
    .map((item) => item.id);
}

export function editTargets<T extends ExpenseDeleteRef>(
  expenses: readonly T[],
  currentId: string,
  scope: EditScope,
): T[] {
  const current = expenses.find((item) => item.id === currentId);
  if (!current) return [];
  if (scope === "month" || (current.section !== "fixed" && current.section !== "card")) return [current];
  return expenses
    .filter((item) => {
      if (item.section !== current.section || !sameAccount(current, item)) return false;
      if (scope === "forward" && item.monthId < current.monthId) return false;
      return true;
    })
    .sort((left, right) => left.monthId.localeCompare(right.monthId) || left.id.localeCompare(right.id));
}

export function livingCardChargeKind(input: {
  plannedCents: number;
  alreadyCents: number;
  chargedCents: number;
}): "full" | "partial" {
  if (input.alreadyCents > 0) return "partial";
  if (input.plannedCents > 0 && input.chargedCents >= input.plannedCents) return "full";
  return "partial";
}

export function cardDeletionEffects(
  deletedNotes: readonly (string | null | undefined)[],
  remainingNotes: readonly (string | null | undefined)[],
): { resetOriginIds: string[]; dropPartialIds: string[] } {
  const remainingOrigins = new Set(remainingNotes.map((note) => originIdFrom(note)).filter(Boolean));
  const remainingPartials = new Set(remainingNotes.map((note) => partialIdFrom(note)).filter(Boolean));
  const resetOriginIds: string[] = [];
  const dropPartialIds: string[] = [];
  for (const note of deletedNotes) {
    const origin = originIdFrom(note);
    const partial = partialIdFrom(note);
    if (origin && !partial && !remainingOrigins.has(origin) && !resetOriginIds.includes(origin)) {
      resetOriginIds.push(origin);
    }
    if (partial && !remainingPartials.has(partial) && !dropPartialIds.includes(partial)) {
      dropPartialIds.push(partial);
    }
  }
  return { resetOriginIds, dropPartialIds };
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
    if (next.note) {
      next.note = noteWithFinalizedZero(next.note, false) || null;
    }
  }
  return next;
}
