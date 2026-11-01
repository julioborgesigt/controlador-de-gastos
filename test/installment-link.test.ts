import assert from "node:assert/strict";
import test from "node:test";
import { quoteInstallments, solveInstallmentTriple } from "../public/installment-link.js";

test("dois campos preenchem o terceiro", () => {
  const fromTotalAndCount = solveInstallmentTriple(
    { chargedCents: 84000, count: 4, perCents: null },
    "count",
    ["charged"],
  );
  assert.equal(fromTotalAndCount.values.perCents, 21000);
  assert.equal(fromTotalAndCount.remainderCents, 0);

  const fromCountAndParcel = solveInstallmentTriple(
    { chargedCents: null, count: 4, perCents: 75000 },
    "per",
    ["count"],
  );
  assert.equal(fromCountAndParcel.values.chargedCents, 300000);

  const fromTotalAndParcel = solveInstallmentTriple(
    { chargedCents: 84000, count: null, perCents: 21000 },
    "per",
    ["charged"],
  );
  assert.equal(fromTotalAndParcel.values.count, 4);
});

test("o campo que não foi mexido por último é o que se ajusta", () => {
  const keepCount = solveInstallmentTriple(
    { chargedCents: 84000, count: 4, perCents: 21000 },
    "charged",
    ["per", "count"],
  );
  assert.equal(keepCount.values.perCents, 21000);
  assert.equal(keepCount.values.count, 4);

  const keepParcel = solveInstallmentTriple(
    { chargedCents: 300000, count: 6, perCents: 75000 },
    "count",
    ["charged", "per"],
  );
  assert.equal(keepParcel.values.chargedCents, 450000);
  assert.equal(keepParcel.values.perCents, 75000);
  assert.equal(keepParcel.values.count, 6);

  const keepTotal = solveInstallmentTriple(
    { chargedCents: 84000, count: 4, perCents: 75000 },
    "per",
    ["charged", "count"],
  );
  assert.equal(keepTotal.values.chargedCents, 300000);
  assert.equal(keepTotal.values.count, 4);
});

test("com o valor descrito travado, quantidade e parcela se ajustam entre si", () => {
  const per = solveInstallmentTriple(
    { chargedCents: 75000, count: 4, perCents: null },
    "count",
    ["charged"],
    "charged",
  );
  assert.equal(per.values.chargedCents, 75000);
  assert.equal(per.values.perCents, 18750);

  const count = solveInstallmentTriple(
    { chargedCents: 75000, count: 4, perCents: 25000 },
    "per",
    per.edits,
    "charged",
  );
  assert.equal(count.values.chargedCents, 75000);
  assert.equal(count.values.count, 3);
});

test("a sobra de centavos fica na última parcela", () => {
  const solved = solveInstallmentTriple(
    { chargedCents: 10000, count: 3, perCents: null },
    "count",
    ["charged"],
  );
  assert.equal(solved.values.perCents, 3333);
  assert.equal(solved.remainderCents, 1);
  assert.deepEqual(quoteInstallments(10000, 3, 3333), {
    kind: "remainder",
    count: 3,
    perCents: 3333,
    lastCents: 3334,
    chargedCents: 10000,
    statedCents: 10000,
  });
});

test("valores que não fecham continuam visíveis para o usuário corrigir", () => {
  const solved = solveInstallmentTriple(
    { chargedCents: 10000, count: null, perCents: 3000 },
    "per",
    ["charged"],
  );
  assert.equal(solved.values.count, 3);
  assert.equal(quoteInstallments(10000, 3, 3000)?.kind, "mismatch");
});

test("apagar um campo não inventa valor", () => {
  const solved = solveInstallmentTriple(
    { chargedCents: 84000, count: null, perCents: 21000 },
    "count",
    ["charged", "per"],
  );
  assert.equal(solved.values.perCents, 21000);
  assert.equal(solved.values.chargedCents, 84000);
  assert.equal(solved.values.count, null);
});
