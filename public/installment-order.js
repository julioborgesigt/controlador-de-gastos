import { noteMarker } from "./shared/note-markers.js";

export const INVOICE_SORT_OPTIONS = [
  { key: "paid", label: "Parcelas pagas", defaultDir: "desc", descHint: "mais pagas", ascHint: "menos pagas" },
  { key: "date", label: "Data da compra", defaultDir: "desc", descHint: "mais recente", ascHint: "mais antiga" },
  { key: "remaining", label: "Parcelas pendentes", defaultDir: "desc", descHint: "mais pendentes", ascHint: "menos pendentes" },
  { key: "amount", label: "Valor", defaultDir: "desc", descHint: "maior valor", ascHint: "menor valor" },
  { key: "total", label: "Total de parcelas", defaultDir: "desc", descHint: "mais parcelas", ascHint: "menos parcelas" },
  { key: "name", label: "Nome", defaultDir: "asc", descHint: "Z → A", ascHint: "A → Z" },
];

export const DEFAULT_INVOICE_SORTS = [
  { key: "paid", dir: "desc" },
  { key: "date", dir: "desc" },
];

const OPTION_MAP = new Map(INVOICE_SORT_OPTIONS.map((option) => [option.key, option]));

export function normalizeInvoiceSorts(raw) {
  if (!Array.isArray(raw)) return DEFAULT_INVOICE_SORTS.map((item) => ({ ...item }));
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const key = typeof item === "string" ? item : item?.key;
    const option = OPTION_MAP.get(key);
    if (!option || seen.has(key)) continue;
    seen.add(key);
    const dir = typeof item === "object" && (item?.dir === "asc" || item?.dir === "desc")
      ? item.dir
      : option.defaultDir;
    out.push({ key, dir });
  }
  return out;
}

export function isDefaultInvoiceSorts(rules) {
  if (!Array.isArray(rules) || rules.length !== DEFAULT_INVOICE_SORTS.length) return false;
  return DEFAULT_INVOICE_SORTS.every((def, index) => rules[index]?.key === def.key && rules[index]?.dir === def.dir);
}

export function installmentRank(installment) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(installment || "").trim());
  if (!match) return { total: 1, paid: 0, remaining: 0, isInstallment: false };
  const left = Number(match[1]);
  const right = Number(match[2]);
  const total = Math.max(left, right);
  const paid = Math.min(left, right);
  return {
    total,
    paid,
    remaining: Math.max(0, total - paid),
    isInstallment: total > 1,
  };
}

export function invoicePurchaseDate(item) {
  const direct = String(item?.purchaseDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const fromNote = noteMarker(item?.note, "compra:");
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromNote)) return fromNote;
  return "";
}

function compareByCriterion(left, right, key, dir) {
  const factor = dir === "asc" ? 1 : -1;
  if (key === "paid") {
    const a = installmentRank(left?.installment);
    const b = installmentRank(right?.installment);
    if (a.paid !== b.paid) return (a.paid - b.paid) * factor;
    return 0;
  }
  if (key === "remaining") {
    const a = installmentRank(left?.installment);
    const b = installmentRank(right?.installment);
    if (a.remaining !== b.remaining) return (a.remaining - b.remaining) * factor;
    return 0;
  }
  if (key === "total") {
    const a = installmentRank(left?.installment);
    const b = installmentRank(right?.installment);
    if (a.total !== b.total) return (a.total - b.total) * factor;
    return 0;
  }
  if (key === "amount") {
    const a = Number(left?.amountCents || 0);
    const b = Number(right?.amountCents || 0);
    if (a !== b) return (a - b) * factor;
    return 0;
  }
  if (key === "date") {
    const a = invoicePurchaseDate(left);
    const b = invoicePurchaseDate(right);
    if (a === b) return 0;
    // Itens sem data sempre ficam após itens com data, independente da direção
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b) * factor;
  }
  if (key === "name") {
    const cmp = String(left?.name || "").localeCompare(String(right?.name || ""), "pt-BR", { sensitivity: "base" });
    if (cmp !== 0) return cmp * factor;
    return 0;
  }
  return 0;
}

export function createInvoiceComparator(rules = DEFAULT_INVOICE_SORTS) {
  const active = Array.isArray(rules) ? rules : DEFAULT_INVOICE_SORTS;
  return (left, right) => {
    for (const rule of active) {
      const cmp = compareByCriterion(left, right, rule.key, rule.dir);
      if (cmp !== 0) return cmp;
    }
    const byName = String(left?.name || "").localeCompare(String(right?.name || ""), "pt-BR", { sensitivity: "base" });
    if (byName !== 0) return byName;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  };
}

export function compareInvoiceItems(left, right, rules = DEFAULT_INVOICE_SORTS) {
  return createInvoiceComparator(rules)(left, right);
}
