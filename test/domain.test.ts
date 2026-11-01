import assert from "node:assert/strict";
import test from "node:test";
import { clearFailures, lockedMessage, nextFailure, parseCpf, parseEmail, parsePassword } from "../src/auth.ts";
import {
  cardInvoiceCents,
  cardLinkRequired,
  carryForward,
  computeTotals,
  expensesForCard,
  isFixedOnCard,
  normalizeExpense,
  parseCardName,
  planCardPurchase,
  resolveCardLabel,
  unassignedCardExpenses,
  type Expense,
} from "../src/domain.ts";
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
    installment: null,
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
      installment: null,
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
      installment: null,
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

test("parcela do cartão avança no mês seguinte e o gasto fixo lançado pelo usuário se repete", () => {
  const card: Expense = {
    id: "1",
    monthId: "2026-12",
    name: "Geladeira",
    section: "card",
    amountCents: 20000,
    payment: "card",
    onCard: false,
    cardLabel: "Nubank",
    paid: true,
    note: null,
    installment: "3/10",
    sortOrder: 1,
    source: "user",
  };
  const carried = carryForward(card);
  assert.equal(carried?.installment, "4/10");
  assert.equal(carried?.paid, false);
  card.installment = "10/10";
  assert.equal(carryForward(card), null);

  const fixed: Expense = { ...card, section: "fixed", installment: null, source: "user", payment: "pix", onCard: false, cardLabel: null };
  assert.equal(carryForward(fixed)?.section, "fixed");
  assert.equal(carryForward({ ...fixed, source: "sheet" }), null);

  const paidOnCard: Expense = { ...fixed, onCard: true, payment: "card", cardLabel: "Nubank", paid: true };
  const nextMonth = carryForward(paidOnCard);
  assert.equal(nextMonth?.onCard, false);
  assert.equal(nextMonth?.payment, "pix");
  assert.equal(nextMonth?.cardLabel, null);
  assert.equal(nextMonth?.paid, false);
});

test("cartão novo exige nome e o gasto no cartão fica vinculado a um cartão cadastrado", () => {
  assert.deepEqual(parseCardName("  Inter  "), { ok: true, name: "Inter" });
  assert.equal(parseCardName("   ").ok, false);

  const cards = [{ name: "Nubank" }, { name: "Neon" }];
  const extra = normalizeExpense({ section: "extra", payment: "card", onCard: false, cardLabel: " nubank " });
  assert.equal(cardLinkRequired(extra), true);
  assert.deepEqual(resolveCardLabel(cards, extra.cardLabel, true), { ok: true, cardLabel: "Nubank" });
  assert.equal(resolveCardLabel(cards, null, true).ok, false);
  assert.equal(resolveCardLabel(cards, "Inter", true).ok, false);

  const invoice = normalizeExpense({ section: "card", payment: "card", onCard: false, cardLabel: null });
  assert.equal(cardLinkRequired(invoice), false);
  assert.deepEqual(resolveCardLabel(cards, invoice.cardLabel, false), { ok: true, cardLabel: null });
});

test("detalhe do cartão soma a fatura daquele cartão e separa o que já veio da casa", () => {
  const expenses = expensesFor(1);
  const energy = expenses.find((item) => item.name === "Energia Elétrica");
  assert.ok(energy);
  energy.onCard = true;
  energy.payment = "card";
  energy.cardLabel = "Neon";
  expenses.push({
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
    installment: null,
    sortOrder: 100,
    source: "user",
  });

  const nubank = expensesForCard(expenses, "nubank").map((item) => item.name);
  assert.ok(nubank.includes("Nubank - Parcelamentos Ativos"));
  assert.ok(nubank.includes("Presente"));
  assert.equal(nubank.includes("Energia Elétrica"), false);
  assert.equal(cardInvoiceCents(expenses, "Nubank"), 181739 + 8000);
  assert.equal(cardInvoiceCents(expenses, "Neon"), 31527);
  assert.equal(expensesForCard(expenses, "Neon").some((item) => item.name === "Energia Elétrica"), true);
  assert.equal(unassignedCardExpenses(expenses, [{ name: "Nubank" }, { name: "Neon" }]).some((item) => item.cardLabel), false);
});

test("compra no cartão reparte o total e começa depois das parcelas já pagas", () => {
  const plan = planCardPurchase({
    startMonthId: "2026-12",
    totalCount: 10,
    paidCount: 3,
    amountCents: 100001,
    mode: "total",
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.plan.schedule.length, 7);
  assert.equal(plan.plan.schedule[0]?.installment, "4/10");
  assert.equal(plan.plan.schedule[0]?.monthId, "2026-12");
  assert.equal(plan.plan.schedule[0]?.amountCents, 10000);
  assert.equal(plan.plan.schedule[6]?.installment, "10/10");
  assert.equal(plan.plan.schedule[6]?.monthId, "2027-06");
  assert.equal(plan.plan.schedule[6]?.amountCents, 10001);
  assert.equal(planCardPurchase({
    startMonthId: "2026-12",
    totalCount: 4,
    paidCount: 4,
    amountCents: 1000,
    mode: "installment",
  }).ok, false);
});

test("conta exige CPF válido, e-mail e senha, e bloqueia depois de oito erros", () => {
  assert.deepEqual(parseCpf("529.982.247-25"), { ok: true, cpf: "52998224725" });
  assert.equal(parseCpf("111.111.111-11").ok, false);
  assert.equal(parseCpf("123").ok, false);
  assert.deepEqual(parseEmail("  Pessoa@Email.com "), { ok: true, email: "pessoa@email.com" });
  assert.equal(parseEmail("sem-arroba").ok, false);
  assert.equal(parsePassword("12345678").ok, true);
  assert.equal(parsePassword("curta").ok, false);
  let state = clearFailures();
  for (let attempt = 0; attempt < 7; attempt += 1) state = nextFailure(state, 0);
  assert.equal(lockedMessage(state, 0), null);
  state = nextFailure(state, 0);
  assert.match(lockedMessage(state, 0) ?? "", /bloqueado/);
});
