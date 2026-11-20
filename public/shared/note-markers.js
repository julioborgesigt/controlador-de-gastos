export const NOTE_MARKERS = [
  "origem:",
  "parcial:",
  "serie:",
  "tipo:",
  "fatura:",
  "compra:",
  "ref:",
  "quitado-cartao:",
  "parcelamento:",
  "finalizado:",
];

export const REFERENCE_MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function noteMarker(note, prefix) {
  const line = String(note || "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

export function originIdFrom(note) {
  return noteMarker(note, "origem:");
}

export function partialIdFrom(note) {
  return noteMarker(note, "parcial:");
}

export function seriesIdFrom(note) {
  return noteMarker(note, "serie:");
}

export function isVariableNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:variavel");
}

export function isPlannedNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:planejado");
}

export function isImprevistoNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:imprevisto");
}

export function isZeroFinalizedNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "finalizado:0");
}

export function invoiceShift(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "fatura:seguinte") ? "seguinte" : "mes";
}

export function chargedInvoiceMonth(note) {
  const value = noteMarker(note, "fatura:");
  return /^\d{4}-\d{2}$/.test(value) ? value : "";
}

export function purchaseMonthFromNote(note) {
  const purchase = noteMarker(note, "compra:");
  return /^\d{4}-\d{2}-\d{2}$/.test(purchase) ? purchase.slice(0, 7) : "";
}

export function referenceMonthFrom(note) {
  const ref = noteMarker(note, "ref:");
  if (/^\d{4}-\d{2}$/.test(ref)) return ref;
  return purchaseMonthFromNote(note);
}

export function visibleNote(note) {
  return String(note || "")
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item && !NOTE_MARKERS.some((marker) => item.startsWith(marker)))
    .join("\n");
}

export function formatCardChargeTitle(name, note, monthId = "") {
  const clean = String(name || "").trim();
  const purchase = noteMarker(note, "compra:");
  if (/^\d{4}-\d{2}-\d{2}$/.test(purchase)) return `${purchase.slice(8, 10)}/${purchase.slice(5, 7)} ${clean}`;
  const ref = noteMarker(note, "ref:") || String(monthId || "");
  const label = /^\d{4}-\d{2}$/.test(ref) ? REFERENCE_MONTHS[Number(ref.slice(5, 7)) - 1] : "";
  return label ? `${clean} ${label}` : clean;
}
