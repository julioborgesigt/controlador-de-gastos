export function formatCpf(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function passkeyWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function base64UrlToBuffer(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function originIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("origem:"));
  return line ? line.slice("origem:".length) : "";
}

export function partialIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("parcial:"));
  return line ? line.slice("parcial:".length) : "";
}

export function seriesIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("serie:"));
  return line ? line.slice("serie:".length) : "";
}

export function isVariableNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:variavel");
}

export function cardChargeTitle(expense) {
  const name = String(expense.name || "").trim();
  const note = String(expense.note || "");
  const purchase = note.split("\n").map((item) => item.trim()).find((item) => item.startsWith("compra:"));
  const date = purchase ? purchase.slice("compra:".length).trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date.slice(8, 10)}/${date.slice(5, 7)} ${name}`;
  const reference = note.split("\n").map((item) => item.trim()).find((item) => item.startsWith("ref:"));
  const monthId = reference ? reference.slice("ref:".length).trim() : expense.monthId;
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const label = /^\d{4}-\d{2}$/.test(String(monthId || "")) ? names[Number(String(monthId).slice(5, 7)) - 1] : "";
  return label ? `${name} ${label}` : name;
}

export function visibleNote(note) {
  return String(note || "")
    .split("\n")
    .map((item) => item.trim())
    .filter((item) =>
      item
      && !item.startsWith("origem:")
      && !item.startsWith("parcial:")
      && !item.startsWith("serie:")
      && !item.startsWith("tipo:")
      && !item.startsWith("fatura:")
      && !item.startsWith("compra:")
      && !item.startsWith("ref:")
      && !item.startsWith("quitado-cartao:")
      && !item.startsWith("parcelamento:"),
    )
    .join("\n");
}

export function composeNote(originId, note, partialId, seriesId, variable, planned, nextInvoice) {
  const text = visibleNote(note).trim();
  const lines = [];
  if (seriesId) lines.push(`serie:${seriesId}`);
  if (variable) lines.push("tipo:variavel");
  if (planned) lines.push("tipo:planejado");
  if (nextInvoice) lines.push("fatura:seguinte");
  if (originId) lines.push(`origem:${originId}`);
  if (partialId) lines.push(`parcial:${partialId}`);
  if (text) lines.push(text);
  return lines.join("\n");
}

export function nextMonthId(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function invoiceShift(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "fatura:seguinte") ? "seguinte" : "mes";
}

export function paymentLabel(payment) {
  return payment === "card" ? "Crédito" : "Pix";
}

export function money(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function centsToInput(cents) {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

export function parseMoney(value) {
  const raw = String(value || "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!raw) return null;
  const negative = raw.startsWith("-");
  const body = raw.replace(/^-/, "");
  let normalized = body;
  if (body.includes(",")) normalized = body.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(body)) normalized = body.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
  return negative ? -cents : cents;
}
