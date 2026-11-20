import {
  cardLinkRequired,
  countsTowardPayment,
  normalizeExpense,
  noteWithSeries,
  parseInstallment,
  resolveCardLabel,
  seriesIdFromNote,
  type Payment,
  type Section,
} from "../domain.ts";
import { listCards, prepareInsertExpense } from "../db.ts";
import { isCents, isMonthId, isPayment, isSection, type JsonBody } from "../http.ts";

export type ExpenseDraft = {
  name: string;
  amountCents: number;
  section: Section;
  payment: Payment;
  onCard: boolean;
  cardLabel: string | null;
  note: string | null;
  installment: string | null;
  paid: boolean;
};

export async function expenseWithCard(
  db: D1Database,
  ownerId: string,
  body: JsonBody,
): Promise<{ ok: true; value: ExpenseDraft } | { ok: false; error: string; status: 400 }> {
  const parsed = parseExpenseBody(body);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const linked = resolveCardLabel(await listCards(db, ownerId), parsed.value.cardLabel, cardLinkRequired(parsed.value));
  if (!linked.ok) return { ok: false, error: linked.error, status: 400 };
  return { ok: true, value: { ...parsed.value, cardLabel: linked.cardLabel } };
}

export function parseExpenseBody(body: JsonBody): { ok: true; value: ExpenseDraft } | { ok: false; error: string } {
  if (!isSection(body.section) || !isPayment(body.payment)) {
    return { ok: false, error: "Tipo ou forma de pagamento inválido." };
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.trim().length > 120) {
    return { ok: false, error: "Dê um nome ao gasto, com até 120 caracteres." };
  }
  if (!isCents(body.amountCents)) return { ok: false, error: "Informe um valor válido." };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const installment = parseInstallment(body.installment);
  if (!installment.ok) return installment;
  const normalized = normalizeExpense({
    section: body.section,
    payment: body.payment,
    onCard: body.onCard === true,
    cardLabel: typeof body.cardLabel === "string" ? body.cardLabel : null,
  });
  const paid = body.paid === true && countsTowardPayment({ ...normalized, amountCents: body.amountCents });
  return {
    ok: true,
    value: {
      name: body.name.trim(),
      amountCents: body.amountCents,
      note: note.length > 0 ? note : null,
      installment: installment.value,
      paid,
      ...normalized,
    },
  };
}

export function readCardSpendInstallment(body: Record<string, unknown>): { ok: true; totalCount: number; paidCount: number; mode: "installment" | "total" } | { ok: false; error: string } {
  const totalCount = body.installmentCount === undefined ? 1 : body.installmentCount;
  const paidCount = body.installmentsPaid === undefined ? 0 : body.installmentsPaid;
  if (typeof totalCount !== "number" || !Number.isInteger(totalCount) || typeof paidCount !== "number" || !Number.isInteger(paidCount)) {
    return { ok: false, error: "Informe as parcelas em números inteiros." };
  }
  if (body.amountMode !== undefined && body.amountMode !== "installment" && body.amountMode !== "total") {
    return { ok: false, error: "Diga se o valor é da parcela ou do total." };
  }
  const mode = totalCount <= 1 || body.amountMode === "total" || body.amountMode === undefined ? "total" : "installment";
  return { ok: true, totalCount, paidCount, mode };
}

export function readInstallmentPlan(value: unknown): { ok: true; totalCount: number; paidCount: number; mode: "installment" | "total" } | { ok: false; error: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as { totalCount?: unknown; paidCount?: unknown; amountMode?: unknown };
  if (typeof plan.totalCount !== "number" || typeof plan.paidCount !== "number") {
    return { ok: false, error: "Informe a quantidade de parcelas e quantas já foram pagas." };
  }
  if (plan.amountMode !== "installment" && plan.amountMode !== "total") {
    return { ok: false, error: "Diga se o valor é da parcela ou do total." };
  }
  return { ok: true, totalCount: plan.totalCount, paidCount: plan.paidCount, mode: plan.amountMode };
}

export async function insertRepeatedExpenses(
  db: D1Database,
  input: {
    ownerId: string;
    monthIds: string[];
    name: string;
    section: Section;
    amountCents: number;
    payment: Payment;
    onCard: boolean;
    cardLabel: string | null;
    paid: boolean;
    note: string | null;
    installment: string | null;
    livingCard: boolean;
  },
): Promise<{ ok: true; rows: Array<{ id: string; monthId: string }> } | { ok: false; error: string }> {
  const ids = input.monthIds;
  if (!ids.length) return { ok: false, error: "Mês não encontrado." };
  const marks = ids.map(() => "?").join(", ");
  const known = await db
    .prepare(`SELECT id FROM months WHERE owner_id = ? AND id IN (${marks})`)
    .bind(input.ownerId, ...ids)
    .all<{ id: string }>();
  const knownIds = new Set((known.results ?? []).map((row) => row.id));
  if (ids.some((id) => !knownIds.has(id))) return { ok: false, error: "Mês não encontrado." };
  const sorts = await db
    .prepare(
      `SELECT month_id, COALESCE(MAX(sort_order), 0) AS max_sort
       FROM expenses WHERE owner_id = ? AND month_id IN (${marks}) GROUP BY month_id`,
    )
    .bind(input.ownerId, ...ids)
    .all<{ month_id: string; max_sort: number }>();
  const nextByMonth = new Map((sorts.results ?? []).map((row) => [row.month_id, Number(row.max_sort) || 0]));
  const createdAt = new Date().toISOString();
  const seriesId = seriesIdFromNote(input.note) || crypto.randomUUID();
  const note = noteWithSeries(input.note, seriesId);
  const statements: D1PreparedStatement[] = [];
  const rows: Array<{ id: string; monthId: string }> = [];
  for (const monthId of ids) {
    const nextSort = (nextByMonth.get(monthId) ?? 0) + 1;
    const fixedId = crypto.randomUUID();
    rows.push({ id: fixedId, monthId });
    statements.push(
      prepareInsertExpense(db, {
        id: fixedId,
        ownerId: input.ownerId,
        monthId,
        name: input.name,
        section: input.section,
        amountCents: input.amountCents,
        payment: input.payment,
        onCard: input.onCard,
        cardLabel: input.cardLabel,
        paid: input.paid,
        note,
        installment: input.installment,
        sortOrder: nextSort,
        createdAt,
      }),
    );
    if (input.livingCard) {
      statements.push(
        prepareInsertExpense(db, {
          id: crypto.randomUUID(),
          ownerId: input.ownerId,
          monthId,
          name: input.name,
          section: "card",
          amountCents: input.amountCents,
          payment: "card",
          onCard: false,
          cardLabel: input.cardLabel,
          paid: false,
          note: `origem:${fixedId}`,
          installment: null,
          sortOrder: nextSort + 1,
          createdAt,
        }),
      );
    }
  }
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
  return { ok: true, rows };
}

export function recurringMonthIds(body: JsonBody, section: string): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (section !== "fixed" || !Array.isArray(body.monthIds) || body.monthIds.length === 0) {
    return isMonthId(body.monthId) ? { ok: true, ids: [body.monthId] } : { ok: false, error: "Mês não encontrado." };
  }
  const ids = [...new Set(body.monthIds.filter(isMonthId))];
  if (!ids.length || ids.length > 48) return { ok: false, error: "Escolha até 48 meses." };
  return { ok: true, ids };
}
