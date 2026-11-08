export function installmentRank(installment) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(installment || "").trim());
  if (!match) return { total: 1, paid: 0 };
  const left = Number(match[1]);
  const right = Number(match[2]);
  return { total: Math.max(left, right), paid: Math.min(left, right) };
}

export function compareInvoiceItems(left, right) {
  const a = installmentRank(left?.installment);
  const b = installmentRank(right?.installment);
  if (b.total !== a.total) return b.total - a.total;
  if (b.paid !== a.paid) return b.paid - a.paid;
  return String(left?.name || "").localeCompare(String(right?.name || ""), "pt-BR", { sensitivity: "base" });
}
