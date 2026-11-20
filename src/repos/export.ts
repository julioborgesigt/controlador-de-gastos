import {
  cardKey,
  coercePayment,
  computeTotals,
  expenseTrack,
  monthCanSettle,
  visibleExpenseNote,
  type Expense,
  type ExpenseTrack,
  type PartialPayment,
  type Totals,
} from "../domain.ts";
import { mapExpense, type ExpenseRow, type MonthRow } from "./core.ts";

type ExtraRow = {
  id: string;
  month_id: string;
  kind: string;
  name: string;
  amount_cents: number;
};

type PartialRow = {
  id: string;
  expense_id: string;
  amount_cents: number;
  payment: string;
  card_label: string | null;
  installment: string | null;
  created_at: string;
};

type CardRow = {
  id: string;
  name: string;
  due_day: number | null;
  closing_day: number | null;
  sort_order: number;
};

export type ExportMonthSnapshot = {
  id: string;
  label: string;
  baseIncomeCents: number;
  extrasIncomeCents: number;
  incomeCents: number;
  settled: boolean;
  totals: Totals;
  incomeExtras: Array<{ id: string; kind: string; name: string; amountCents: number }>;
  expenses: Array<{
    id: string;
    name: string;
    section: string;
    track: ExpenseTrack | "";
    payment: string;
    onCard: boolean;
    cardLabel: string | null;
    installment: string | null;
    amountCents: number;
    paid: boolean;
    note: string;
    partials: PartialPayment[];
  }>;
};

export type ExportSnapshot = {
  exportedAt: string;
  period: { start: string | null; end: string | null };
  cards: Array<{ id: string; name: string; dueDay: number | null; closingDay: number | null }>;
  months: ExportMonthSnapshot[];
};

export type OverviewMonth = {
  id: string;
  label: string;
  incomeCents: number;
  commitmentsCents: number;
  paidCents: number;
  remainingCents: number;
  balanceCents: number;
  faturaCents: number;
  fixedCents: number;
  extrasPixCents: number;
  settled: boolean;
};

export type OverviewMatch = {
  id: string;
  monthId: string;
  monthLabel: string;
  name: string;
  amountCents: number;
  section: string;
  payment: string;
  cardLabel: string | null;
  installment: string | null;
  paid: boolean;
  track: ExpenseTrack | "";
  note: string;
};

export type OverviewPayload = {
  years: string[];
  cards: string[];
  selectedYear: string;
  months: OverviewMonth[];
  annualTotals: {
    monthCount: number;
    incomeCents: number;
    commitmentsCents: number;
    paidCents: number;
    remainingCents: number;
    balanceCents: number;
    faturaCents: number;
    avgCommitmentsCents: number;
  };
  hasFilter: boolean;
  totalMatches: number;
  matches: OverviewMatch[];
};

async function loadOwnerDataset(db: D1Database, ownerId: string, onlyMonthId?: string) {
  const monthFilter = onlyMonthId ? " AND id = ?" : "";
  const childFilter = onlyMonthId ? " AND month_id = ?" : "";
  const monthParams = onlyMonthId ? [ownerId, onlyMonthId] : [ownerId];

  const [monthsRes, extrasRes, cardsRes, expensesRes, partialsRes] = await db.batch([
    db
      .prepare(`SELECT id, label, income_cents, settled, sort_order, income_locked FROM months WHERE owner_id = ?${monthFilter} ORDER BY sort_order ASC`)
      .bind(...monthParams),
    db
      .prepare(`SELECT id, month_id, kind, name, amount_cents FROM income_extras WHERE owner_id = ?${childFilter} ORDER BY month_id ASC, created_at ASC`)
      .bind(...monthParams),
    db
      .prepare("SELECT id, name, due_day, closing_day, sort_order FROM cards WHERE owner_id = ? ORDER BY sort_order ASC, name ASC")
      .bind(ownerId),
    db
      .prepare(
        `SELECT id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at
         FROM expenses WHERE owner_id = ?${childFilter} ORDER BY month_id ASC, sort_order ASC, created_at ASC`,
      )
      .bind(...monthParams),
    db
      .prepare(
        `SELECT p.id, p.expense_id, p.amount_cents, p.payment, p.card_label, p.installment, p.created_at
         FROM partial_payments p
         INNER JOIN expenses e ON e.id = p.expense_id
         WHERE p.owner_id = ? AND e.owner_id = ?${onlyMonthId ? " AND e.month_id = ?" : ""}
         ORDER BY p.created_at ASC`,
      )
      .bind(ownerId, ...monthParams),
  ]);

  const months = (monthsRes?.results ?? []) as MonthRow[];
  const extras = (extrasRes?.results ?? []) as ExtraRow[];
  const cards = (cardsRes?.results ?? []) as CardRow[];
  const expenseRows = (expensesRes?.results ?? []) as ExpenseRow[];
  const partialRows = (partialsRes?.results ?? []) as PartialRow[];

  const partialsByExpense = new Map<string, PartialPayment[]>();
  for (const row of partialRows) {
    const list = partialsByExpense.get(row.expense_id) ?? [];
    list.push({
      id: row.id,
      amountCents: Number(row.amount_cents) || 0,
      payment: coercePayment(row.payment),
      cardLabel: row.card_label,
      installment: row.installment ?? null,
      createdAt: row.created_at,
    });
    partialsByExpense.set(row.expense_id, list);
  }

  const extrasByMonth = new Map<string, ExtraRow[]>();
  for (const row of extras) {
    const list = extrasByMonth.get(row.month_id) ?? [];
    list.push(row);
    extrasByMonth.set(row.month_id, list);
  }

  const expensesByMonth = new Map<string, Expense[]>();
  for (const row of expenseRows) {
    const expense = mapExpense(row);
    const partials = partialsByExpense.get(expense.id);
    if (partials?.length) expense.partials = partials;
    const list = expensesByMonth.get(expense.monthId) ?? [];
    list.push(expense);
    expensesByMonth.set(expense.monthId, list);
  }

  return { months, cards, extrasByMonth, expensesByMonth };
}

export async function exportOwnerSnapshot(
  db: D1Database,
  ownerId: string,
  onlyMonthId?: string,
): Promise<ExportSnapshot> {
  const { months, cards, extrasByMonth, expensesByMonth } = await loadOwnerDataset(db, ownerId, onlyMonthId);

  const exportedMonths: ExportMonthSnapshot[] = months.map((month) => {
    const monthExtras = extrasByMonth.get(month.id) ?? [];
    const extrasIncomeCents = monthExtras.reduce((sum, item) => sum + (Number(item.amount_cents) || 0), 0);
    const baseIncomeCents = Number(month.income_cents) || 0;
    const incomeCents = baseIncomeCents + extrasIncomeCents;
    const expenses = expensesByMonth.get(month.id) ?? [];
    const totals = computeTotals(expenses, incomeCents);
    const settled = month.settled === 1 || monthCanSettle(totals);
    return {
      id: month.id,
      label: month.label,
      baseIncomeCents,
      extrasIncomeCents,
      incomeCents,
      settled,
      totals,
      incomeExtras: monthExtras.map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        amountCents: Number(item.amount_cents) || 0,
      })),
      expenses: expenses.map((expense) => ({
        id: expense.id,
        name: expense.name,
        section: expense.section,
        track: expenseTrack(expense),
        payment: expense.payment,
        onCard: expense.onCard,
        cardLabel: expense.cardLabel,
        installment: expense.installment,
        amountCents: expense.amountCents,
        paid: expense.paid,
        note: visibleExpenseNote(expense.note),
        partials: expense.partials ?? [],
      })),
    };
  });

  return {
    exportedAt: new Date().toISOString(),
    period: {
      start: exportedMonths[0]?.id ?? null,
      end: exportedMonths[exportedMonths.length - 1]?.id ?? null,
    },
    cards: cards.map((card) => ({
      id: card.id,
      name: card.name,
      dueDay: card.due_day,
      closingDay: card.closing_day,
    })),
    months: exportedMonths,
  };
}

function formatCentsBr(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${reais},${centavos}`;
}

function escapeCsvCell(value: unknown): string {
  let str = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[;"\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function trackLabel(track: ExpenseTrack | ""): string {
  if (track === "casa") return "Custo de vida";
  if (track === "planejado") return "Planejado";
  if (track === "imprevisto") return "Imprevisto";
  return "";
}

function sectionLabel(section: string): string {
  if (section === "fixed") return "Custo de vida";
  if (section === "card") return "Fatura do cartão";
  if (section === "extra") return "Extra";
  return section;
}

export function formatExportCsv(snapshot: ExportSnapshot): string {
  const rows: string[][] = [[
    "Mês",
    "Tipo",
    "Nome",
    "Tarja",
    "Pagamento",
    "Cartão",
    "Parcela",
    "Valor (R$)",
    "Status",
    "Observação",
  ]];

  for (const month of snapshot.months) {
    if (month.baseIncomeCents > 0) {
      rows.push([
        month.id,
        "Receita base",
        "Renda mensal base",
        "",
        "",
        "",
        "",
        formatCentsBr(month.baseIncomeCents),
        "Recebida",
        "",
      ]);
    }
    for (const extra of month.incomeExtras) {
      rows.push([
        month.id,
        "Receita extra",
        extra.name,
        "",
        "",
        "",
        "",
        formatCentsBr(extra.amountCents),
        "Recebida",
        "",
      ]);
    }
    for (const expense of month.expenses) {
      if (expense.amountCents === 0 && !expense.partials.length) continue;
      rows.push([
        month.id,
        sectionLabel(expense.section),
        expense.name,
        trackLabel(expense.track),
        expense.payment === "card" || expense.onCard ? "Cartão" : "Pix",
        expense.cardLabel ?? "",
        expense.installment ?? "",
        formatCentsBr(expense.amountCents),
        expense.paid ? "Pago" : expense.onCard ? "No cartão" : "Em aberto",
        expense.note,
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(";")).join("\r\n")}\r\n`;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export async function ownerOverview(
  db: D1Database,
  ownerId: string,
  filters: { year?: string; q?: string; card?: string; track?: string } = {},
): Promise<OverviewPayload> {
  const { months, cards, extrasByMonth, expensesByMonth } = await loadOwnerDataset(db, ownerId);
  const years = [...new Set(months.map((month) => month.id.slice(0, 4)))].sort();
  const selectedYear = filters.year && years.includes(filters.year) ? filters.year : "";
  const query = normalizeSearch(filters.q ?? "");
  const cardFilter = cardKey(filters.card ?? "");
  const trackFilter = filters.track === "casa" || filters.track === "planejado" || filters.track === "imprevisto"
    ? filters.track
    : "";
  const hasFilter = Boolean(query || cardFilter || trackFilter);

  const visibleMonths = selectedYear ? months.filter((month) => month.id.startsWith(`${selectedYear}-`)) : months;
  const overviewMonths: OverviewMonth[] = [];
  const allMatches: OverviewMatch[] = [];

  for (const month of visibleMonths) {
    const monthExtras = extrasByMonth.get(month.id) ?? [];
    const extrasIncomeCents = monthExtras.reduce((sum, item) => sum + (Number(item.amount_cents) || 0), 0);
    const incomeCents = (Number(month.income_cents) || 0) + extrasIncomeCents;
    const expenses = expensesByMonth.get(month.id) ?? [];
    const totals = computeTotals(expenses, incomeCents);
    overviewMonths.push({
      id: month.id,
      label: month.label,
      incomeCents,
      commitmentsCents: totals.forecastExpenseCents,
      paidCents: totals.paidCents,
      remainingCents: totals.remainingCents,
      balanceCents: totals.balanceCents,
      faturaCents: totals.faturaCents,
      fixedCents: totals.fixedCents,
      extrasPixCents: totals.extrasPixCents,
      settled: month.settled === 1 || monthCanSettle(totals),
    });

    if (hasFilter) {
      for (const expense of expenses) {
        if (expense.amountCents === 0 && !(expense.partials?.length)) continue;
        const track = expenseTrack(expense);
        if (trackFilter && track !== trackFilter) continue;
        if (cardFilter && cardKey(expense.cardLabel) !== cardFilter) continue;
        const visibleNote = visibleExpenseNote(expense.note);
        if (query) {
          const hay = `${normalizeSearch(expense.name)} ${normalizeSearch(visibleNote)} ${normalizeSearch(expense.cardLabel || "")}`;
          if (!hay.includes(query)) continue;
        }
        allMatches.push({
          id: expense.id,
          monthId: month.id,
          monthLabel: month.label,
          name: expense.name,
          amountCents: expense.amountCents,
          section: expense.section,
          payment: expense.payment,
          cardLabel: expense.cardLabel,
          installment: expense.installment,
          paid: expense.paid,
          track,
          note: visibleNote,
        });
      }
    }
  }

  allMatches.sort((a, b) => b.monthId.localeCompare(a.monthId) || a.name.localeCompare(b.name, "pt-BR"));

  const incomeCents = overviewMonths.reduce((sum, item) => sum + item.incomeCents, 0);
  const commitmentsCents = overviewMonths.reduce((sum, item) => sum + item.commitmentsCents, 0);
  const paidCents = overviewMonths.reduce((sum, item) => sum + item.paidCents, 0);
  const remainingCents = overviewMonths.reduce((sum, item) => sum + item.remainingCents, 0);
  const balanceCents = overviewMonths.reduce((sum, item) => sum + item.balanceCents, 0);
  const faturaCents = overviewMonths.reduce((sum, item) => sum + item.faturaCents, 0);
  const monthCount = overviewMonths.length;

  return {
    years,
    cards: cards.map((card) => card.name),
    selectedYear,
    months: overviewMonths,
    annualTotals: {
      monthCount,
      incomeCents,
      commitmentsCents,
      paidCents,
      remainingCents,
      balanceCents,
      faturaCents,
      avgCommitmentsCents: monthCount > 0 ? Math.round(commitmentsCents / monthCount) : 0,
    },
    hasFilter,
    totalMatches: allMatches.length,
    matches: allMatches.slice(0, 120),
  };
}
