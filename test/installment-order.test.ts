import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INVOICE_SORTS,
  compareInvoiceItems,
  createInvoiceComparator,
  installmentRank,
  invoicePurchaseDate,
  isDefaultInvoiceSorts,
  normalizeInvoiceSorts,
} from "../public/installment-order.js";

test("padrão ordena por parcelas pagas (mais pagas primeiro) e depois por data da compra (mais recente primeiro)", () => {
  const rows = [
    { name: "À vista recente", installment: "", note: "compra:2026-11-18" },
    { name: "À vista antiga", installment: "", note: "compra:2026-11-02" },
    { name: "Parcela 3/10", installment: "3/10", note: "compra:2026-09-10" },
    { name: "Parcela 10/12 antiga", installment: "10/12", note: "compra:2026-02-05" },
    { name: "Parcela 10/12 recente", installment: "10/12", note: "compra:2026-02-20" },
    { name: "Sem data", installment: "" },
  ];
  const ordered = rows.slice().sort((a, b) => compareInvoiceItems(a, b)).map((row) => row.name);
  assert.deepEqual(ordered, [
    "Parcela 10/12 recente",
    "Parcela 10/12 antiga",
    "Parcela 3/10",
    "À vista recente",
    "À vista antiga",
    "Sem data",
  ]);
});

test("filtros cumulativos aplicam desempate em cadeia (pagas + pendentes + valor)", () => {
  const rows = [
    { name: "A", installment: "4/12", amountCents: 10000 },
    { name: "B", installment: "4/6", amountCents: 50000 },
    { name: "C", installment: "4/12", amountCents: 25000 },
    { name: "D", installment: "8/10", amountCents: 5000 },
  ];
  const comparator = createInvoiceComparator([
    { key: "paid", dir: "desc" },
    { key: "remaining", dir: "desc" },
    { key: "amount", dir: "desc" },
  ]);
  assert.deepEqual(rows.slice().sort(comparator).map((row) => row.name), ["D", "C", "A", "B"]);
});

test("parcelas pendentes, total de parcelas, valor e nome respeitam direção asc e desc", () => {
  const rows = [
    { name: "Notebook", installment: "2/12", amountCents: 45000 },
    { name: "Celular", installment: "9/10", amountCents: 30000 },
    { name: "Almoço", installment: "", amountCents: 6000 },
  ];

  const byRemainingDesc = rows.slice().sort(createInvoiceComparator([{ key: "remaining", dir: "desc" }])).map((r) => r.name);
  assert.deepEqual(byRemainingDesc, ["Notebook", "Celular", "Almoço"]);

  const byRemainingAsc = rows.slice().sort(createInvoiceComparator([{ key: "remaining", dir: "asc" }])).map((r) => r.name);
  assert.deepEqual(byRemainingAsc, ["Almoço", "Celular", "Notebook"]);

  const byTotalDesc = rows.slice().sort(createInvoiceComparator([{ key: "total", dir: "desc" }])).map((r) => r.name);
  assert.deepEqual(byTotalDesc, ["Notebook", "Celular", "Almoço"]);

  const byAmountAsc = rows.slice().sort(createInvoiceComparator([{ key: "amount", dir: "asc" }])).map((r) => r.name);
  assert.deepEqual(byAmountAsc, ["Almoço", "Celular", "Notebook"]);

  const byNameDesc = rows.slice().sort(createInvoiceComparator([{ key: "name", dir: "desc" }])).map((r) => r.name);
  assert.deepEqual(byNameDesc, ["Notebook", "Celular", "Almoço"]);
});

test("data da compra mantém itens sem data sempre no final mesmo na ordem crescente", () => {
  const rows = [
    { name: "Sem data", note: "" },
    { name: "Mais recente", purchaseDate: "2026-11-20" },
    { name: "Mais antiga", note: "compra:2026-11-01" },
  ];
  const asc = rows.slice().sort(createInvoiceComparator([{ key: "date", dir: "asc" }])).map((r) => r.name);
  const desc = rows.slice().sort(createInvoiceComparator([{ key: "date", dir: "desc" }])).map((r) => r.name);
  assert.deepEqual(asc, ["Mais antiga", "Mais recente", "Sem data"]);
  assert.deepEqual(desc, ["Mais recente", "Mais antiga", "Sem data"]);
});

test("normalizeInvoiceSorts, isDefaultInvoiceSorts, installmentRank e invoicePurchaseDate", () => {
  assert.equal(isDefaultInvoiceSorts(DEFAULT_INVOICE_SORTS), true);
  assert.equal(isDefaultInvoiceSorts([{ key: "paid", dir: "asc" }, { key: "date", dir: "desc" }]), false);
  assert.deepEqual(normalizeInvoiceSorts(null), DEFAULT_INVOICE_SORTS);
  assert.deepEqual(normalizeInvoiceSorts([]), []);
  assert.deepEqual(
    normalizeInvoiceSorts([{ key: "amount", dir: "asc" }, { key: "amount", dir: "desc" }, { key: "invalido" }, "remaining"]),
    [{ key: "amount", dir: "asc" }, { key: "remaining", dir: "desc" }],
  );
  assert.deepEqual(installmentRank("10/12"), { total: 12, paid: 10, remaining: 2, isInstallment: true });
  assert.deepEqual(installmentRank(""), { total: 1, paid: 0, remaining: 0, isInstallment: false });
  assert.equal(invoicePurchaseDate({ note: "tipo:planejado\ncompra:2026-10-15" }), "2026-10-15");
  assert.equal(invoicePurchaseDate({ purchaseDate: "2026-10-18", note: "compra:2026-10-15" }), "2026-10-18");
});

