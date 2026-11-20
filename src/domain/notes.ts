import {
  NOTE_MARKERS,
  chargedInvoiceMonth,
  formatCardChargeTitle,
  invoiceShift,
  isPlannedNote,
  isVariableNote,
  isZeroFinalizedNote,
  originIdFrom,
  partialIdFrom,
  purchaseMonthFromNote,
  seriesIdFrom,
  visibleNote,
} from "../../public/shared/note-markers.js";
import type { Expense, ExpenseTrack } from "./types.ts";

export {
  chargedInvoiceMonth,
  purchaseMonthFromNote,
  invoiceShift as invoiceShiftFromNote,
  isPlannedNote as isPlannedCost,
  isVariableNote as isVariableCost,
  isZeroFinalizedNote as isFinalizedWithoutSpend,
  originIdFrom as originExpenseId,
  partialIdFrom as partialIdFromNote,
  seriesIdFrom as seriesIdFromNote,
  visibleNote as visibleExpenseNote,
};

export function noteWithSeries(note: string | null | undefined, seriesId: string): string {
  const id = seriesId.trim();
  const lines = String(note || "").split("\n").map((item) => item.trim()).filter((item) => item && !item.startsWith("serie:"));
  if (!id) return lines.join("\n");
  return [`serie:${id}`, ...lines].join("\n");
}

export function noteWithChargeContext(
  note: string | null | undefined,
  input: { purchaseDate?: string | null; referenceMonthId?: string | null },
): string {
  const lines = String(note || "")
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith("compra:") && !item.startsWith("ref:"));
  if (input.purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) lines.push(`compra:${input.purchaseDate}`);
  if (input.referenceMonthId && /^\d{4}-\d{2}$/.test(input.referenceMonthId)) lines.push(`ref:${input.referenceMonthId}`);
  return lines.join("\n");
}

export function cardChargeTitle(name: string, note: string | null | undefined, monthId = ""): string {
  return formatCardChargeTitle(name, note, monthId);
}

export function noteWithFinalizedZero(note: string | null | undefined, finalized: boolean): string {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("finalizado:"));
  if (!finalized) return lines.join("\n");
  return ["finalizado:0", ...lines].join("\n");
}

export function expenseTrack(expense: Pick<Expense, "section" | "note">): ExpenseTrack | "" {
  const note = String(expense.note || "");
  if (note.includes("parcelamento:") || note.includes("quitado-cartao:")) return "";
  if (expense.section === "extra") return isPlannedNote(note) ? "planejado" : "imprevisto";
  if (expense.section === "fixed") return "casa";
  if (expense.section === "card" && originIdFrom(note)) return "casa";
  return "";
}

export function noteForTrack(note: string | null | undefined, track: ExpenseTrack): string {
  const lines = String(note || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "tipo:planejado" && !line.startsWith("origem:") && !line.startsWith("parcial:"));
  if (track === "planejado") lines.unshift("tipo:planejado");
  return lines.join("\n");
}

export function noteWithOrigin(note: string | null | undefined, originId: string): string {
  const lines = String(note || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("origem:"));
  return [`origem:${originId}`, ...lines].join("\n");
}

export function noteWithPlanned(note: string | null | undefined, planned: boolean): string {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter((line) => line && line !== "tipo:planejado");
  if (!planned) return lines.join("\n");
  return ["tipo:planejado", ...lines].join("\n");
}

export function noteWithVariable(note: string | null | undefined, variable: boolean): string {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter((line) => line && line !== "tipo:variavel");
  if (!variable) return lines.join("\n");
  return ["tipo:variavel", ...lines].join("\n");
}

export function noteWithInvoiceShift(note: string | null | undefined, shift: "mes" | "seguinte"): string {
  const lines = String(note || "").split("\n").map((line) => line.trim()).filter((line) => line && line !== "fatura:seguinte");
  if (shift !== "seguinte") return lines.join("\n");
  return ["fatura:seguinte", ...lines].join("\n");
}

export function noteWithVisibleText(existing: string | null | undefined, visible: string): string {
  const markers = String(existing || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => NOTE_MARKERS.some((marker) => line.startsWith(marker)));
  const text = visibleNote(visible);
  return [...markers, text].filter(Boolean).join("\n");
}
