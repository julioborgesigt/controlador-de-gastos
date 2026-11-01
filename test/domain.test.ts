import assert from "node:assert/strict";
import test from "node:test";
import { clearFailures, isValidPin, lockedMessage, nextFailure } from "../src/auth.ts";
import { computeTotals, isFixedOnCard, normalizeExpense, type Expense } from "../src/domain.ts";
import seedJson from "../src/seed-data.json" with { type: "json" };

type Seed = {
  months: Array<{ id: string; incomeCents: number; settled: number }>;
  items: Array<{
    key: string;
    name: string;
    section: Expense["section"];
    payment: Expense["payment"];
    cardLabel: string | null;
    sortOrder: number;
    amounts: number[];
  }>;
};

const seed = seedJson as Seed;

const expected = [
  { commitments: 708023, balance: 382000 },
  { commitments: 789766, balance: 190234 },
  { commitments: 884788, balance: 212 },
  { commitments: 868994, balance: 11006 },
  { commitments: 816661, balance: -16661 },
  { commitments: 1090386, balance: 9614 },
  { commitments: 790386, balance: 9614 },
  { commitments: 784706, balance: 15294 },
  { commitments: 744716, balance: 55284 },
  { commitments: 737196, balance: 62804 },
  { commitments: 693000, balance: 107000 },
  { commitments: 693000, balance: 107000 },
];

function expensesFor(monthIndex: number): Expense[] {
  const month = seed.months[monthIndex];
  if (!month) throw new Error("missing month");
  return seed.items.map((item) => ({
    id: `${item.key}:${month.id}`,
    monthId: month.id,
    name: item.name,
    section: item.section,
    amountCents: item.amounts[monthIndex] ?? 0,
    payment: item.payment,
    onCard: false,
    cardLabel: item.cardLabel,
    paid: month.settled === 1 && (item.amounts[monthIndex] ?? 0) !== 0,
    note: null,
    sortOrder: item.sortOrder,
    source: "sheet",
  }));
}

test("planilha de novembro de 2026 a outubro de 2027 fecha com o app", () => {
  seed.months.forEach((month, index) => {
    const totals = computeTotals(expensesFor(index), month.incomeCents);
    const row = expected[index];
    assert.equal(totals.commitmentsCents, row?.commitments, month.id);
    assert.equal(totals.balanceCents, row?.balance, month.id);
    assert.equal(totals.fixedOnCardCents, 0, month.id);
  });
});

test("novembro quitado não deixa saldo pendente e dezembro fica em aberto", () => {
  const november = computeTotals(expensesFor(0), seed.months[0]!.incomeCents);
  assert.equal(november.remainingCents, 0);
  assert.equal(november.paidCents, 708023);
  assert.equal(november.faturaCents, 481023);
  assert.equal(november.fixedCents, 227000);

  const december = computeTotals(expensesFor(1), seed.months[1]!.incomeCents);
  assert.equal(december.remainingCents, 789766);
  assert.equal(december.faturaCents, 213266);
  assert.equal(december.fixedCents, 576500);
});

test("gasto fixo marcado na fatura continua no indicador e sai do total a pagar", () => {
  const expenses = expensesFor(1);
  const energy = expenses.find((item) => item.name === "Energia Elétrica");
  assert.ok(energy);
  energy.onCard = true;
  energy.payment = "card";
  assert.equal(isFixedOnCard(energy), true);

  const totals = computeTotals(expenses, seed.months[1]!.incomeCents);
  assert.equal(totals.fixedCents, 576500);
  assert.equal(totals.fixedOnCardCents, 60000);
  assert.equal(totals.fixedCashCents, 516500);
  assert.equal(totals.commitmentsCents, 789766 - 60000);
  assert.equal(totals.faturaCents, 213266);
  assert.equal(totals.remainingCents, 789766 - 60000);
});

test("gasto extra no cartão aumenta a fatura e o extra no Pix fica fora dela", () => {
  const expenses = expensesFor(1);
  expenses.push(
    {
      id: "extra-card",
      monthId: "2026-12",
      name: "Presente",
      section: "extra",
      amountCents: 8000,
      payment: "card",
      onCard: false,
      cardLabel: "Nubank",
      paid: false,
      note: null,
      sortOrder: 100,
      source: "user",
    },
    {
      id: "extra-pix",
      monthId: "2026-12",
      name: "Feira extra",
      section: "extra",
      amountCents: 4500,
      payment: "pix",
      onCard: false,
      cardLabel: null,
      paid: false,
      note: null,
      sortOrder: 101,
      source: "user",
    },
  );
  const totals = computeTotals(expenses, seed.months[1]!.incomeCents);
  assert.equal(totals.extrasCardCents, 8000);
  assert.equal(totals.extrasPixCents, 4500);
  assert.equal(totals.faturaCents, 213266 + 8000);
  assert.equal(totals.fixedCents, 576500);
  assert.equal(totals.commitmentsCents, 789766 + 8000 + 4500);
});

test("normaliza pagamento para não somar gasto fixo duas vezes", () => {
  const fixed = normalizeExpense({ section: "fixed", payment: "pix", onCard: true, cardLabel: " Neon " });
  assert.deepEqual(fixed, { section: "fixed", payment: "card", onCard: true, cardLabel: "Neon" });

  const extra = normalizeExpense({ section: "extra", payment: "card", onCard: true, cardLabel: "Nubank" });
  assert.equal(extra.onCard, false);
  assert.equal(extra.payment, "card");

  const invoice = normalizeExpense({ section: "card", payment: "pix", onCard: true, cardLabel: "" });
  assert.deepEqual(invoice, { section: "card", payment: "card", onCard: false, cardLabel: null });
});

test("PIN aceita só dígitos e bloqueia depois de oito erros", () => {
  assert.equal(isValidPin("1234"), true);
  assert.equal(isValidPin("12"), false);
  assert.equal(isValidPin("abcd"), false);
  let state = clearFailures();
  for (let attempt = 0; attempt < 7; attempt += 1) state = nextFailure(state, 0);
  assert.equal(lockedMessage(state, 0), null);
  state = nextFailure(state, 0);
  assert.match(lockedMessage(state, 0) ?? "", /bloqueado/);
});
