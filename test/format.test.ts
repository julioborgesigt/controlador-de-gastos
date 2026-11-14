import assert from "node:assert/strict";
import test from "node:test";
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  cardChargeTitle,
  centsToInput,
  composeNote,
  extrasBreakdown,
  formatCpf,
  invoiceBreakdown,
  invoiceShift,
  isVariableNote,
  livingCrossMonthSummary,
  nextMonthId,
  originIdFrom,
  parseMoney,
  partialIdFrom,
  paymentLabel,
  referenceMonthFrom,
  seriesIdFrom,
  shortMonthLabel,
  visibleNote,
} from "../public/format.js";

test("parseMoney e centsToInput convertem valores em reais com segurança", () => {
  assert.equal(parseMoney("R$ 1.234,56"), 123456);
  assert.equal(parseMoney("75,90"), 7590);
  assert.equal(parseMoney("1.500"), 150000);
  assert.equal(parseMoney("-42,05"), -4205);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("abc"), null);
  assert.equal(centsToInput(123456), "1234,56");
  assert.equal(centsToInput(-4205), "-42,05");
  assert.equal(paymentLabel("card"), "Crédito");
  assert.equal(paymentLabel("pix"), "Pix");
});

test("formatCpf aplica máscara progressiva e base64Url faz roundtrip exato", () => {
  assert.equal(formatCpf("529"), "529");
  assert.equal(formatCpf("529982"), "529.982");
  assert.equal(formatCpf("529982247"), "529.982.247");
  assert.equal(formatCpf("5299822472599"), "529.982.247-25");

  const sample = "passkey_challenge-123/456=";
  const encoded = bufferToBase64Url(new TextEncoder().encode(sample).buffer);
  const decoded = new TextDecoder().decode(base64UrlToBuffer(encoded));
  assert.equal(decoded, sample);
});

test("visibleNote e composeNote filtram todos os marcadores internos do cliente", () => {
  const raw = "serie:s1\ntipo:variavel\nfatura:seguinte\norigem:o1\nparcial:p1\nquitado-cartao:c1:2026-11\nparcelamento:c1:2026-11\ncompra:2026-11-10\nref:2026-11\nObservação real";
  assert.equal(visibleNote(raw), "Observação real");
  assert.equal(originIdFrom(raw), "o1");
  assert.equal(partialIdFrom(raw), "p1");
  assert.equal(seriesIdFrom(raw), "s1");
  assert.equal(isVariableNote(raw), true);
  assert.equal(invoiceShift(raw), "seguinte");
  assert.equal(nextMonthId("2026-12"), "2027-01");
  assert.equal(shortMonthLabel("2026-12"), "Dez/26");
  assert.equal(referenceMonthFrom(raw), "2026-11");
  assert.equal(referenceMonthFrom("compra:2026-10-28"), "2026-10");
  assert.equal(cardChargeTitle({ name: "Mercado", note: raw, monthId: "2026-11" }), "10/11 Mercado");

  const composed = composeNote("o1", "origem:injetado\nquitado-cartao:falso\nNota limpa", "p1", "s1", true, false, true);
  assert.equal(composed, "serie:s1\ntipo:variavel\nfatura:seguinte\norigem:o1\nparcial:p1\nNota limpa");
});

test("extrasBreakdown e invoiceBreakdown separam Custo de vida, Planejados, Imprevistos e faturas entre meses", () => {
  const expenses = [
    { section: "extra", amountCents: 15000, payment: "pix", monthId: "2026-11", note: "tipo:planejado" },
    { section: "extra", amountCents: 25000, payment: "card", cardLabel: "Nubank", monthId: "2026-11", note: "tipo:planejado" },
    { section: "extra", amountCents: 18000, payment: "card", cardLabel: "Nubank", monthId: "2026-11", note: "tipo:planejado\nfatura:2026-12" },
    { section: "extra", amountCents: 8000, payment: "pix", monthId: "2026-11", note: "" },
    { section: "extra", amountCents: 12000, payment: "card", cardLabel: "Nubank", monthId: "2026-11", note: "tipo:imprevisto" },
    { section: "extra", amountCents: 9000, payment: "card", cardLabel: "Nubank", monthId: "2026-11", note: "tipo:imprevisto\nfatura:2026-12" },
    { section: "card", amountCents: 30000, payment: "card", cardLabel: "Nubank", monthId: "2026-11", note: "origem:f1\nref:2026-10" },
    { section: "card", amountCents: 10000, payment: "card", cardLabel: "Inter", monthId: "2026-11", note: "tipo:planejado\nref:2026-10" },
    { section: "card", amountCents: 5000, payment: "card", cardLabel: "Nubank", monthId: "2026-11", note: "parcelamento:c1:2026-11" },
  ];

  const extras = extrasBreakdown(expenses);
  assert.equal(extras.planned.total, 58000);
  assert.equal(extras.planned.pix, 15000);
  assert.equal(extras.planned.card, 43000);
  assert.equal(extras.planned.cardOwnInvoice, 25000);
  assert.equal(extras.planned.cardOtherInvoice, 18000);
  assert.deepEqual(extras.planned.otherInvoiceMonths, ["2026-12"]);
  assert.equal(extras.unexpected.total, 29000);
  assert.equal(extras.unexpected.pix, 8000);
  assert.equal(extras.unexpected.card, 21000);
  assert.equal(extras.unexpected.cardOwnInvoice, 12000);
  assert.equal(extras.unexpected.cardOtherInvoice, 9000);
  assert.deepEqual(extras.unexpected.otherInvoiceMonths, ["2026-12"]);
  assert.equal(extras.pix, 23000);
  assert.equal(extras.card, 64000);
  assert.equal(extras.cardOwnInvoice, 37000);
  assert.equal(extras.cardOtherInvoice, 27000);
  assert.deepEqual(extras.otherInvoiceMonths, ["2026-12"]);
  assert.equal(extras.total, 87000);

  const invoice = invoiceBreakdown(expenses);
  assert.equal(invoice.livingCents, 30000);
  assert.equal(invoice.plannedCents, 35000);
  assert.equal(invoice.unexpectedCents, 12000);
  assert.equal(invoice.otherCents, 5000);
  assert.equal(invoice.totalCents, 82000);
  assert.equal(invoice.fromOtherMonthsCents, 40000);
  assert.equal(invoice.livingFromOtherCents, 30000);
  assert.equal(invoice.plannedFromOtherCents, 10000);
  assert.equal(invoice.unexpectedFromOtherCents, 0);
  assert.deepEqual(invoice.originMonths, ["2026-10"]);
});

test("livingCrossMonthSummary identifica custo de vida previsto ou lançado na fatura de outro mês", () => {
  const expenses = [
    {
      section: "fixed",
      monthId: "2026-11",
      amountCents: 50000,
      payment: "card",
      paid: false,
      note: "tipo:variavel\nfatura:seguinte",
      charges: [{ monthId: "2026-12", amountCents: 20000 }],
      partials: [],
    },
    {
      section: "fixed",
      monthId: "2026-11",
      amountCents: 15000,
      payment: "card",
      paid: false,
      note: "",
      charges: [{ monthId: "2026-11", amountCents: 15000 }],
      partials: [],
    },
  ];
  const summary = livingCrossMonthSummary(expenses);
  assert.equal(summary.paidCardOwnCents, 15000);
  assert.equal(summary.paidCardOtherCents, 20000);
  assert.deepEqual(summary.paidOtherMonths, ["2026-12"]);
  assert.equal(summary.dueCardOwnCents, 0);
  assert.equal(summary.dueCardOtherCents, 30000);
  assert.deepEqual(summary.dueOtherMonths, ["2026-12"]);
});


