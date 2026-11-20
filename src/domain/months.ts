import { addMonths, monthLabel, nextMonthId, previousMonthId } from "../../public/shared/months.js";

export { addMonths, monthLabel, nextMonthId, previousMonthId };

export function isCalendarMonth(monthId: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function monthSortOrder(monthId: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!match) return 0;
  return Number(match[1]) * 12 + Number(match[2]);
}

export function listMonthRange(
  startMonthId: string,
  endMonthId: string,
): { ok: true; months: string[] } | { ok: false; error: string } {
  if (!isCalendarMonth(startMonthId) || !isCalendarMonth(endMonthId)) {
    return { ok: false, error: "Escolha o mês e o ano de início e de fim." };
  }
  const span = monthSortOrder(endMonthId) - monthSortOrder(startMonthId) + 1;
  if (span <= 0) return { ok: false, error: "O fim do período precisa ser o início ou um mês depois." };
  if (span > 48) return { ok: false, error: "Escolha um período de até 48 meses." };
  const months = [];
  for (let offset = 0; offset < span; offset += 1) months.push(addMonths(startMonthId, offset));
  return { ok: true, months };
}

export function resetTargets(
  monthIds: readonly string[],
  input: { scope: string; year?: number; monthId?: string },
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (input.scope === "all") {
    if (!monthIds.length) return { ok: false, error: "Não há período para apagar." };
    return { ok: true, ids: [...monthIds] };
  }
  if (input.scope === "year") {
    const year = input.year;
    if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return { ok: false, error: "Escolha o ano." };
    }
    const ids = monthIds.filter((id) => id.startsWith(`${year}-`));
    if (!ids.length) return { ok: false, error: "Esse ano não está no período." };
    return { ok: true, ids };
  }
  if (input.scope === "month") {
    if (!input.monthId || !monthIds.includes(input.monthId)) {
      return { ok: false, error: "Esse mês não está no período." };
    }
    return { ok: true, ids: [input.monthId] };
  }
  return { ok: false, error: "Escolha o que apagar." };
}

export function livingCostMonths(monthIds: readonly string[], invoiceMonthId: string): string[] {
  return monthIds.filter((monthId) => monthId >= invoiceMonthId);
}
