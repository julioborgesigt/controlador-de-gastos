export type InstallmentField = "charged" | "count" | "per";

export type InstallmentTriple = {
  chargedCents: number | null;
  count: number | null;
  perCents: number | null;
};

export function solveInstallmentTriple(
  current: InstallmentTriple,
  edited: InstallmentField,
  previousEdits?: InstallmentField[],
  locked?: InstallmentField | null,
): { values: InstallmentTriple; edits: InstallmentField[]; remainderCents: number };

export function quoteInstallments(
  chargedCents: number | null,
  count: number | null,
  perCents: number | null,
): {
  kind: "equal" | "remainder" | "mismatch" | "open";
  count: number;
  perCents: number;
  lastCents: number;
  chargedCents: number | null;
  statedCents: number | null;
} | null;
