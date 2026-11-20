export const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const SHORT_MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

export function addMonths(monthId, offset) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return String(monthId || "");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonthId(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthId(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return String(monthId || "");
  const label = MONTH_LABELS[Number(match[2]) - 1];
  return label ? `${label} ${match[1]}` : String(monthId || "");
}

export function shortMonthLabel(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || "").trim());
  if (!match) return String(monthId || "");
  const label = SHORT_MONTH_LABELS[Number(match[2]) - 1];
  return label ? `${label}/${match[1].slice(2)}` : String(monthId || "");
}
