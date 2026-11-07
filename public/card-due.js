export function invoiceDueDate(monthId, dueDay) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return `${match[1]}-${match[2]}-${String(day).padStart(2, "0")}`;
}

export function suggestedInvoiceMonth(purchaseDate, closingDay) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(purchaseDate || ""));
  if (!match) return "";
  const monthId = `${match[1]}-${match[2]}`;
  const day = Number(match[3]);
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31 || day <= closingDay) return monthId;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function dueDatePassed(monthId, dueDay, today) {
  const due = invoiceDueDate(monthId, dueDay);
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(String(today || ""))) return false;
  return due < today;
}
