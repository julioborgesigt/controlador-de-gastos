import assert from "node:assert/strict";
import test from "node:test";
import { clearFailures, lockedMessage, nextFailure, parseCpf, parseEmail, parsePassword } from "../src/auth.ts";
import {
  cardInvoiceCents,
  planCardPayoff,
  cardLinkRequired,
  carryForward,
  computeTotals,
  monthCanSettle,
  expensesForCard,
  isFixedOnCard,
  livingCostMonths,
  livingCardSendTargets,
  livingCardUndoTargets,
  expenseDeleteTargets,
  normalizeExpense,
  expenseCountForCard,
  listMonthRange,
  parseCardName,
  parseDueDay,
  resetTargets,
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

function unlaunchedFixed(expenses: Expense[]): number {
  return expenses
    .filter((expense) => expense.section === "fixed" && !expense.onCard && !expense.paid && !(expense.partials?.length))
    .reduce((sum, expense) => sum + expense.amountCents, 0);
}

test("planilha de novembro de 2026 a outubro de 2027 fecha com o app", () => {
  seed.months.forEach((month, index) => {
    const expenses = expensesFor(index);
    const held = unlaunchedFixed(expenses);
    const totals = computeTotals(expenses, month.incomeCents);
    const row = expected[index];
    assert.equal(totals.commitmentsCents, (row?.commitments ?? 0) - held, month.id);
    assert.equal(totals.balanceCents, row?.balance, month.id);
    assert.equal(totals.partialBalanceCents, (row?.balance ?? 0) + held, month.id);
    assert.equal(totals.forecastExpenseCents, row?.commitments, month.id);
    assert.equal(totals.partialExpenseCents, (row?.commitments ?? 0) - held, month.id);
    assert.equal(totals.fixedOnCardCents, 0, month.id);
    assert.equal(totals.fixedCashCents + totals.fixedOnCardCents, totals.fixedLaunchedCents, month.id);
    assert.equal(totals.paidCents + totals.remainingCents, totals.forecastExpenseCents, month.id);
    assert.equal(totals.remainingCents, totals.launchedRemainingCents + held, month.id);
    if (held > 0) assert.equal(monthCanSettle(totals), false, month.id);
  });
});

test("novembro quitado não deixa saldo pendente e dezembro fica em aberto", () => {
  const november = computeTotals(expensesFor(0), seed.months[0]!.incomeCents);
  assert.equal(november.remainingCents, 0);
  assert.equal(monthCanSettle(november), true);
  assert.equal(november.paidCents, 708023);
  assert.equal(november.faturaCents, 481023);
  assert.equal(november.fixedCents, 227000);

  const decemberExpenses = expensesFor(1);
  const december = computeTotals(decemberExpenses, seed.months[1]!.incomeCents);
  assert.equal(december.remainingCents, 789766);
  assert.equal(december.launchedRemainingCents, 789766 - unlaunchedFixed(decemberExpenses));
  assert.equal(monthCanSettle(december), false);
  assert.equal(december.faturaCents, 213266);
  assert.equal(december.fixedForecastCents, 576500);
  assert.equal(december.fixedLaunchedCents, 0);
  assert.equal(december.fixedAllSettled, false);
});

test("gasto fixo marcado na fatura continua no indicador e sai do total a pagar", () => {
  const expenses = expensesFor(1);
  const energy = expenses.find((item) => item.name === "Energia Elétrica");
  assert.ok(energy);
  energy.onCard = true;
  energy.payment = "card";
  assert.equal(isFixedOnCard(energy), true);

  const totals = computeTotals(expenses, seed.months[1]!.incomeCents);
  const held = unlaunchedFixed(expenses);
  assert.equal(totals.fixedForecastCents, 576500);
  assert.equal(totals.fixedOnCardCents, 60000);
  assert.equal(totals.fixedLaunchedCents, 60000);
  assert.equal(totals.fixedCashCents, 0);
  assert.equal(totals.commitmentsCents, 789766 - 60000 - held);
  assert.equal(totals.faturaCents, 213266);
  assert.equal(totals.remainingCents, 789766 - 60000);
  assert.equal(totals.launchedRemainingCents, 789766 - 60000 - held);
  assert.equal(monthCanSettle(totals), false);
});

test("pagar a fatura não quita o mês enquanto o custo de vida previsto estiver em aberto", () => {
  const living: Expense = {
    id: "mercado",
    monthId: "2026-11",
    name: "Mercado",
    section: "fixed",
    amountCents: 20000,
    payment: "pix",
    onCard: false,
    cardLabel: null,
    paid: false,
    note: null,
    installment: null,
    sortOrder: 1,
    source: "user",
  };
  const invoice: Expense = {
    ...living,
    id: "fatura",
    name: "Fatura",
    section: "card",
    amountCents: 5000,
    payment: "card",
    paid: true,
  };
  const open = computeTotals([living, invoice], 100000);
  assert.equal(open.launchedRemainingCents, 0);
  assert.equal(open.remainingCents, 20000);
  assert.equal(open.paidCents + open.remainingCents, open.forecastExpenseCents);
  assert.equal(monthCanSettle(open), false);

  living.paid = true;
  const closed = computeTotals([living, invoice], 100000);
  assert.equal(closed.remainingCents, 0);
  assert.equal(monthCanSettle(closed), true);
});

test("pagamento parcial deixa a feira em aberto e não soma o cartão duas vezes", () => {
  const feira: Expense = {
    id: "feira",
    monthId: "2026-11",
    name: "Feira",
    section: "fixed",
    amountCents: 80000,
    payment: "pix",
    onCard: false,
    cardLabel: null,
    paid: false,
    note: null,
    installment: null,
    sortOrder: 1,
    source: "user",
    partials: [
      { id: "1", amountCents: 20000, payment: "pix", cardLabel: null, installment: null, createdAt: "" },
      { id: "2", amountCents: 15000, payment: "card", cardLabel: "Nubank", installment: "3 parcelas", createdAt: "" },
    ],
  };
  const invoice: Expense = {
    ...feira,
    id: "fatura",
    section: "card",
    amountCents: 15000,
    payment: "card",
    cardLabel: "Nubank",
    partials: [],
  };
  const open = computeTotals([feira, invoice], 0);
  assert.equal(open.fixedForecastCents, 80000);
  assert.equal(open.fixedLaunchedCents, 35000);
  assert.equal(open.fixedOnCardCents, 15000);
  assert.equal(open.paidCents, 20000);
  assert.equal(open.remainingCents, 60000);
  assert.equal(open.launchedRemainingCents, 15000);
  assert.equal(monthCanSettle(open), false);
  assert.equal(open.faturaCents, 15000);
  assert.equal(open.commitmentsCents, 35000);
  assert.equal(open.partialBalanceCents, -35000);
  assert.equal(open.balanceCents, -80000);
  assert.equal(open.partialExpenseCents, 35000);
  assert.equal(open.forecastExpenseCents, 80000);
  assert.equal(open.fixedCashCents, 20000);
  assert.equal(open.fixedCashCents + open.fixedOnCardCents, open.fixedLaunchedCents);
  assert.equal(open.fixedAllSettled, false);

  feira.paid = true;
  feira.partials = [
    { id: "1", amountCents: 30000, payment: "cash", cardLabel: null, installment: null, createdAt: "" },
    { id: "2", amountCents: 15000, payment: "card", cardLabel: "Nubank", installment: null, createdAt: "" },
  ];
  const closed = computeTotals([feira, { ...invoice, paid: true }], 0);
  assert.equal(closed.fixedCents, 45000);
  assert.equal(closed.commitmentsCents, 45000);
  assert.equal(closed.remainingCents, 0);
  assert.equal(closed.launchedRemainingCents, 0);
  assert.equal(closed.paidCents, 45000);
  assert.equal(monthCanSettle(closed), true);
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
  assert.equal(totals.fixedForecastCents, 576500);
  assert.equal(totals.commitmentsCents, 213266 + 8000 + 4500);
});

test("normaliza pagamento para não somar gasto fixo duas vezes", () => {
  const fixed = normalizeExpense({ section: "fixed", payment: "pix", onCard: true, cardLabel: " Neon " });
  assert.deepEqual(fixed, { section: "fixed", payment: "card", onCard: true, cardLabel: "Neon" });
  const forecast = normalizeExpense({ section: "fixed", payment: "card", onCard: false, cardLabel: "Nubank" });
  assert.deepEqual(forecast, { section: "fixed", payment: "card", onCard: false, cardLabel: "Nubank" });
  const cash = normalizeExpense({ section: "fixed", payment: "cash", onCard: false, cardLabel: "Nubank" });
  assert.deepEqual(cash, { section: "fixed", payment: "cash", onCard: false, cardLabel: null });

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

test("enviar pro cartão fica neste mês, ou segue os meses seguintes ainda em aberto", () => {
  const costs = [
    { id: "nov", name: "Aluguel", section: "fixed" as const, monthId: "2026-11", onCard: false, paid: false },
    { id: "dez", name: " aluguel ", section: "fixed" as const, monthId: "2026-12", onCard: false, paid: false },
    { id: "jan", name: "Aluguel", section: "fixed" as const, monthId: "2027-01", onCard: true, paid: true },
    { id: "mai", name: "Aluguel", section: "fixed" as const, monthId: "2027-05", onCard: true, paid: true },
    { id: "fev", name: "Aluguel", section: "fixed" as const, monthId: "2027-02", onCard: false, paid: true },
    { id: "mar", name: "Aluguel", section: "fixed" as const, monthId: "2027-03", onCard: false, paid: false, hasPartials: true },
    { id: "luz", name: "Luz", section: "fixed" as const, monthId: "2026-12", onCard: false, paid: false },
  ];
  assert.deepEqual(livingCardSendTargets(costs, "dez", "month"), ["dez"]);
  assert.deepEqual(livingCardSendTargets(costs, "dez", "following"), ["dez"]);
  assert.deepEqual(livingCardSendTargets(costs, "nov", "following"), ["nov", "dez"]);
  assert.deepEqual(livingCardSendTargets(costs, "luz", "following"), ["luz"]);
  assert.deepEqual(livingCardUndoTargets(costs, "jan", "month"), ["jan"]);
  assert.deepEqual(livingCardUndoTargets(costs, "jan", "series"), ["jan", "mai"]);
  assert.deepEqual(livingCardUndoTargets(costs, "nov", "series"), []);
});

test("excluir custo ou gasto no cartão pode ser só deste mês ou de todos", () => {
  const rows = [
    { id: "a1", name: "Aluguel", section: "fixed" as const, monthId: "2026-11", cardLabel: null },
    { id: "a2", name: " aluguel ", section: "fixed" as const, monthId: "2026-12", cardLabel: "Nubank" },
    { id: "luz", name: "Luz", section: "fixed" as const, monthId: "2026-11", cardLabel: null },
    { id: "c1", name: "Farmácia", section: "card" as const, monthId: "2026-11", cardLabel: "Nubank" },
    { id: "c2", name: "Farmácia", section: "card" as const, monthId: "2026-12", cardLabel: " Nubank " },
    { id: "c3", name: "Farmácia", section: "card" as const, monthId: "2026-12", cardLabel: "Neon" },
    { id: "e1", name: "Táxi", section: "extra" as const, monthId: "2026-11", cardLabel: null },
    { id: "e2", name: "Táxi", section: "extra" as const, monthId: "2026-12", cardLabel: null },
  ];
  assert.deepEqual(expenseDeleteTargets(rows, "a1", "month"), ["a1"]);
  assert.deepEqual(expenseDeleteTargets(rows, "a1", "series"), ["a1", "a2"]);
  assert.deepEqual(expenseDeleteTargets(rows, "c1", "series"), ["c1", "c2"]);
  assert.deepEqual(expenseDeleteTargets(rows, "c3", "month"), ["c3"]);
  assert.deepEqual(expenseDeleteTargets(rows, "e1", "series"), ["e1"]);
});

test("custo de vida no cartão começa na primeira fatura escolhida", () => {
  const months = ["2026-11", "2026-12", "2027-01", "2027-02"];
  assert.deepEqual(livingCostMonths(months, "2027-01"), ["2027-01", "2027-02"]);
  assert.deepEqual(livingCostMonths(months, "2026-10"), months);
  assert.deepEqual(livingCostMonths(months, "2027-03"), []);
});

test("período gerenciado aceita uma faixa de até 48 meses", () => {
  const range = listMonthRange("2026-11", "2027-10");
  assert.equal(range.ok, true);
  if (!range.ok) return;
  assert.equal(range.months.length, 12);
  assert.equal(range.months[0], "2026-11");
  assert.equal(range.months[11], "2027-10");
  assert.equal(listMonthRange("2027-02", "2026-11").ok, false);
  assert.equal(listMonthRange("2026-01", "2030-02").ok, false);
  assert.equal(listMonthRange("2026-13", "2026-14").ok, false);
});

test("reset escolhe todos os meses, um ano ou um mês do período", () => {
  const months = ["2026-11", "2026-12", "2027-01"];
  assert.deepEqual(resetTargets(months, { scope: "all" }), { ok: true, ids: months });
  const year = resetTargets(months, { scope: "year", year: 2026 });
  assert.deepEqual(year, { ok: true, ids: ["2026-11", "2026-12"] });
  assert.deepEqual(resetTargets(months, { scope: "month", monthId: "2027-01" }), { ok: true, ids: ["2027-01"] });
  assert.equal(resetTargets(months, { scope: "month", monthId: "2028-01" }).ok, false);
  assert.equal(resetTargets([], { scope: "all" }).ok, false);
});

test("parcelar a fatura do cartão desconta a entrada e fecha as parcelas", () => {
  const exact = planCardPayoff({
    balanceCents: 30000,
    downCents: 6000,
    count: 3,
    installmentCents: 8000,
    startMonthId: "2026-12",
  });
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.financedCents, 24000);
  assert.deepEqual(exact.schedule.map((part) => part.monthId), ["2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(exact.schedule.map((part) => part.amountCents), [8000, 8000, 8000]);

  const remainder = planCardPayoff({
    balanceCents: 10000,
    downCents: 0,
    count: 3,
    installmentCents: 3333,
    startMonthId: "2026-11",
  });
  assert.equal(remainder.ok, true);
  if (!remainder.ok) return;
  assert.equal(remainder.schedule[2]?.amountCents, 3334);
  assert.equal(planCardPayoff({
    balanceCents: 10000,
    downCents: 10000,
    count: 2,
    installmentCents: 1,
    startMonthId: "2026-11",
  }).ok, false);
});

test("cartão só pode ser excluído quando nenhum gasto aponta para ele", () => {
  const labels = [
    { label: "Nubank", count: 2 },
    { label: " nubank ", count: 1 },
    { label: "Neon", count: 0 },
  ];
  assert.equal(expenseCountForCard(labels, "Nubank"), 3);
  assert.equal(expenseCountForCard(labels, "Inter"), 0);
  assert.equal(expenseCountForCard(labels, "Neon"), 0);
});

test("cartão novo exige nome e o gasto no cartão fica vinculado a um cartão cadastrado", () => {
  assert.deepEqual(parseCardName("  Inter  "), { ok: true, name: "Inter" });
  assert.equal(parseCardName("   ").ok, false);
  assert.deepEqual(parseDueDay(10), { ok: true, dueDay: 10 });
  assert.deepEqual(parseDueDay(""), { ok: true, dueDay: null });
  assert.equal(parseDueDay(0).ok, false);
  assert.equal(parseDueDay(32).ok, false);

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
