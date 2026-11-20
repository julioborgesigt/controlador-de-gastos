import { listMonthRange, monthLabel, monthSortOrder } from "../domain.ts";
import { baseIncomeKey, getSetting, runStatements, setSetting, sqlMarks, type IncomeExtra, type MonthRow } from "./core.ts";

export async function listMonths(db: D1Database, ownerId: string): Promise<Array<{ id: string; label: string; settled: boolean; sortOrder: number; incomeCents: number; incomeLocked: boolean }>> {
  const result = await db
    .prepare("SELECT id, label, income_cents, settled, sort_order, income_locked FROM months WHERE owner_id = ? ORDER BY sort_order")
    .bind(ownerId)
    .all<MonthRow>();
  return (result.results ?? []).map((month) => ({
    id: month.id,
    label: month.label,
    settled: month.settled === 1,
    sortOrder: month.sort_order,
    incomeCents: month.income_cents,
    incomeLocked: month.income_locked === 1,
  }));
}

export async function getMonth(db: D1Database, ownerId: string, monthId: string): Promise<MonthRow | null> {
  return db
    .prepare("SELECT id, label, income_cents, settled, sort_order, income_locked FROM months WHERE owner_id = ? AND id = ?")
    .bind(ownerId, monthId)
    .first<MonthRow>();
}

export async function listIncomeExtras(db: D1Database, ownerId: string): Promise<IncomeExtra[]> {
  const result = await db
    .prepare("SELECT id, kind, name, amount_cents, month_id FROM income_extras WHERE owner_id = ? ORDER BY month_id, name")
    .bind(ownerId)
    .all<{ id: string; kind: IncomeExtra["kind"]; name: string; amount_cents: number; month_id: string }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    amountCents: row.amount_cents,
    monthId: row.month_id,
  }));
}

export async function ensureMonths(db: D1Database, ownerId: string, monthIds: readonly string[]): Promise<void> {
  const ids = [...new Set(monthIds)];
  if (!ids.length) return;
  const known = await db
    .prepare(`SELECT id FROM months WHERE owner_id = ? AND id IN (${sqlMarks(ids)})`)
    .bind(ownerId, ...ids)
    .all<{ id: string }>();
  const have = new Set((known.results ?? []).map((row) => row.id));
  const missing = ids.filter((id) => !have.has(id));
  if (!missing.length) return;
  const base = await getSetting(db, baseIncomeKey(ownerId));
  const income = base === null ? 0 : Number(base);
  const cents = Number.isFinite(income) ? income : 0;
  await runStatements(
    db,
    missing.map((monthId) =>
      db
        .prepare(
          "INSERT INTO months (owner_id, id, label, income_cents, settled, sort_order, income_locked) VALUES (?, ?, ?, ?, 0, ?, 0)",
        )
        .bind(ownerId, monthId, monthLabel(monthId), cents, monthSortOrder(monthId)),
    ),
  );
}

export async function ensureMonth(db: D1Database, ownerId: string, monthId: string): Promise<void> {
  await ensureMonths(db, ownerId, [monthId]);
}

export async function setManagedPeriod(
  db: D1Database,
  ownerId: string,
  startMonthId: string,
  endMonthId: string,
): Promise<{ ok: true; startMonthId: string } | { ok: false; error: string }> {
  const range = listMonthRange(startMonthId, endMonthId);
  if (!range.ok) return range;
  const existing = await listMonths(db, ownerId);
  const keep = new Set(range.months);
  const dropping = existing.filter((month) => !keep.has(month.id));
  if (dropping.length) {
    const blocked = await busyMonthLabel(db, ownerId, dropping);
    if (blocked) return { ok: false, error: `Há dados em ${blocked}. Apague esses dados antes de tirar o mês do período.` };
    const ids = dropping.map((month) => month.id);
    const marks = sqlMarks(ids);
    await db.batch([
      db.prepare(`DELETE FROM expenses WHERE owner_id = ? AND month_id IN (${marks})`).bind(ownerId, ...ids),
      db.prepare(`DELETE FROM income_extras WHERE owner_id = ? AND month_id IN (${marks})`).bind(ownerId, ...ids),
      db.prepare(`DELETE FROM months WHERE owner_id = ? AND id IN (${marks})`).bind(ownerId, ...ids),
    ]);
  }
  await ensureMonths(db, ownerId, range.months);
  return { ok: true, startMonthId: range.months[0] };
}

async function busyMonthLabel(
  db: D1Database,
  ownerId: string,
  months: Array<{ id: string; label: string; incomeLocked: boolean }>,
): Promise<string | null> {
  const ids = months.map((month) => month.id);
  const marks = sqlMarks(ids);
  const expenses = await db
    .prepare(`SELECT month_id FROM expenses WHERE owner_id = ? AND month_id IN (${marks}) GROUP BY month_id`)
    .bind(ownerId, ...ids)
    .all<{ month_id: string }>();
  const extras = await db
    .prepare(`SELECT month_id FROM income_extras WHERE owner_id = ? AND month_id IN (${marks}) GROUP BY month_id`)
    .bind(ownerId, ...ids)
    .all<{ month_id: string }>();
  const busy = new Set([
    ...(expenses.results ?? []).map((row) => row.month_id),
    ...(extras.results ?? []).map((row) => row.month_id),
  ]);
  const found = months.find((month) => month.incomeLocked || busy.has(month.id));
  return found ? found.label : null;
}

export async function applyBaseIncome(db: D1Database, ownerId: string, amountCents: number, scope: "all" | "unlocked"): Promise<void> {
  await setSetting(db, baseIncomeKey(ownerId), String(amountCents));
  if (scope === "all") {
    await db.prepare("UPDATE months SET income_cents = ?, income_locked = 0 WHERE owner_id = ?").bind(amountCents, ownerId).run();
    return;
  }
  await db.prepare("UPDATE months SET income_cents = ? WHERE owner_id = ? AND income_locked = 0").bind(amountCents, ownerId).run();
}

export async function setMonthIncome(db: D1Database, ownerId: string, monthId: string, amountCents: number): Promise<void> {
  await db
    .prepare("UPDATE months SET income_cents = ?, income_locked = 1 WHERE owner_id = ? AND id = ?")
    .bind(amountCents, ownerId, monthId)
    .run();
}

export async function unlockMonthIncome(db: D1Database, ownerId: string, monthId: string): Promise<void> {
  const base = await getSetting(db, baseIncomeKey(ownerId));
  const amount = base === null ? 0 : Number(base);
  await db
    .prepare("UPDATE months SET income_cents = ?, income_locked = 0 WHERE owner_id = ? AND id = ?")
    .bind(Number.isFinite(amount) ? amount : 0, ownerId, monthId)
    .run();
}
