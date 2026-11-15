export function formatCpf(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function passkeyWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function base64UrlToBuffer(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function originIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("origem:"));
  return line ? line.slice("origem:".length) : "";
}

export function partialIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("parcial:"));
  return line ? line.slice("parcial:".length) : "";
}

export function seriesIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("serie:"));
  return line ? line.slice("serie:".length) : "";
}

export function isVariableNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:variavel");
}

export function isZeroFinalizedNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "finalizado:0");
}

export function cardChargeTitle(expense) {
  const name = String(expense.name || "").trim();
  const note = String(expense.note || "");
  const purchase = note.split("\n").map((item) => item.trim()).find((item) => item.startsWith("compra:"));
  const date = purchase ? purchase.slice("compra:".length).trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date.slice(8, 10)}/${date.slice(5, 7)} ${name}`;
  const reference = note.split("\n").map((item) => item.trim()).find((item) => item.startsWith("ref:"));
  const monthId = reference ? reference.slice("ref:".length).trim() : expense.monthId;
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const label = /^\d{4}-\d{2}$/.test(String(monthId || "")) ? names[Number(String(monthId).slice(5, 7)) - 1] : "";
  return label ? `${name} ${label}` : name;
}

export function visibleNote(note) {
  return String(note || "")
    .split("\n")
    .map((item) => item.trim())
    .filter((item) =>
      item
      && !item.startsWith("origem:")
      && !item.startsWith("parcial:")
      && !item.startsWith("serie:")
      && !item.startsWith("tipo:")
      && !item.startsWith("fatura:")
      && !item.startsWith("compra:")
      && !item.startsWith("ref:")
      && !item.startsWith("quitado-cartao:")
      && !item.startsWith("parcelamento:")
      && !item.startsWith("finalizado:"),
    )
    .join("\n");
}

export function composeNote(originId, note, partialId, seriesId, variable, planned, nextInvoice) {
  const text = visibleNote(note).trim();
  const lines = [];
  if (seriesId) lines.push(`serie:${seriesId}`);
  if (variable) lines.push("tipo:variavel");
  if (planned) lines.push("tipo:planejado");
  if (nextInvoice) lines.push("fatura:seguinte");
  if (originId) lines.push(`origem:${originId}`);
  if (partialId) lines.push(`parcial:${partialId}`);
  if (text) lines.push(text);
  return lines.join("\n");
}

export function nextMonthId(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function invoiceShift(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "fatura:seguinte") ? "seguinte" : "mes";
}

export function paymentLabel(payment) {
  return payment === "card" ? "Crédito" : "Pix";
}

export function money(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function centsToInput(cents) {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

export function parseMoney(value) {
  const raw = String(value || "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!raw) return null;
  const negative = raw.startsWith("-");
  const body = raw.replace(/^-/, "");
  let normalized = body;
  if (body.includes(",")) normalized = body.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(body)) normalized = body.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
  return negative ? -cents : cents;
}

export function shortMonthLabel(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || "").trim());
  if (!match) return String(monthId || "");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const monthIndex = Number(match[2]) - 1;
  const label = names[monthIndex];
  if (!label) return String(monthId || "");
  return `${label}/${match[1].slice(2)}`;
}

export function referenceMonthFrom(note) {
  const lines = String(note || "").split("\n").map((item) => item.trim());
  const refLine = lines.find((item) => /^ref:\d{4}-\d{2}$/.test(item));
  if (refLine) return refLine.slice("ref:".length);
  const purchaseLine = lines.find((item) => /^compra:\d{4}-\d{2}-\d{2}$/.test(item));
  if (purchaseLine) return purchaseLine.slice("compra:".length, "compra:".length + 7);
  return "";
}

export function isPlannedNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:planejado");
}

export function isImprevistoNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:imprevisto");
}

export function chargedInvoiceMonth(note) {
  const line = String(note || "").split("\n").map((item) => item.trim()).find((item) => /^fatura:\d{4}-\d{2}$/.test(item));
  return line ? line.slice("fatura:".length) : "";
}

export function extraOnOwnInvoice(expense) {
  if (!expense || expense.section !== "extra" || expense.payment !== "card") return false;
  const invoice = chargedInvoiceMonth(expense.note);
  return !invoice || !expense.monthId || invoice === expense.monthId;
}

export function livingCrossMonthSummary(expenses) {
  let paidCardOwnCents = 0;
  let paidCardOtherCents = 0;
  let dueCardOwnCents = 0;
  let dueCardOtherCents = 0;
  const paidOtherMonths = new Set();
  const dueOtherMonths = new Set();

  for (const expense of expenses || []) {
    if (!expense || expense.section !== "fixed") continue;
    const charges = Array.isArray(expense.charges) ? expense.charges : [];
    const partials = Array.isArray(expense.partials) ? expense.partials : [];
    let creditCents = 0;
    for (const charge of charges) {
      const amount = Number(charge?.amountCents || 0);
      creditCents += amount;
      if (charge?.monthId && expense.monthId && charge.monthId !== expense.monthId) {
        paidCardOtherCents += amount;
        paidOtherMonths.add(charge.monthId);
      } else {
        paidCardOwnCents += amount;
      }
    }
    let creditFromPartials = 0;
    let pixFromPartials = 0;
    for (const partial of partials) {
      const amount = Number(partial?.amountCents || 0);
      if (partial?.payment === "card") creditFromPartials += amount;
      else pixFromPartials += amount;
    }
    const settled = Math.max(creditCents, creditFromPartials) + pixFromPartials;
    const remaining = expense.paid || expense.onCard ? 0 : Math.max(0, Number(expense.amountCents || 0) - settled);
    if (remaining > 0 && expense.payment === "card") {
      if (invoiceShift(expense.note) === "seguinte") {
        dueCardOtherCents += remaining;
        const nextId = nextMonthId(expense.monthId);
        if (nextId) dueOtherMonths.add(nextId);
      } else {
        dueCardOwnCents += remaining;
      }
    }
  }

  return {
    paidCardOwnCents,
    paidCardOtherCents,
    paidOtherMonths: [...paidOtherMonths].sort(),
    dueCardOwnCents,
    dueCardOtherCents,
    dueOtherMonths: [...dueOtherMonths].sort(),
  };
}

export function extrasBreakdown(expenses) {
  const planned = { pix: 0, card: 0, cardOwnInvoice: 0, cardOtherInvoice: 0, otherInvoiceMonths: [], inMonth: 0, total: 0 };
  const unexpected = { pix: 0, card: 0, cardOwnInvoice: 0, cardOtherInvoice: 0, otherInvoiceMonths: [], inMonth: 0, total: 0 };
  const plannedMonths = new Set();
  const unexpectedMonths = new Set();
  for (const expense of expenses || []) {
    if (expense.section !== "extra") continue;
    const isPlanned = isPlannedNote(expense.note);
    const bucket = isPlanned ? planned : unexpected;
    const monthSet = isPlanned ? plannedMonths : unexpectedMonths;
    if (expense.payment === "card") {
      bucket.card += expense.amountCents;
      const invoiceMonth = chargedInvoiceMonth(expense.note);
      if (invoiceMonth && expense.monthId && invoiceMonth !== expense.monthId) {
        bucket.cardOtherInvoice += expense.amountCents;
        monthSet.add(invoiceMonth);
      } else {
        bucket.cardOwnInvoice += expense.amountCents;
      }
    } else {
      bucket.pix += expense.amountCents;
    }
    bucket.total += expense.amountCents;
  }
  planned.inMonth = planned.pix + planned.cardOwnInvoice;
  unexpected.inMonth = unexpected.pix + unexpected.cardOwnInvoice;
  planned.otherInvoiceMonths = [...plannedMonths].sort();
  unexpected.otherInvoiceMonths = [...unexpectedMonths].sort();
  const allOtherMonths = new Set([...planned.otherInvoiceMonths, ...unexpected.otherInvoiceMonths]);
  return {
    planned,
    unexpected,
    pix: planned.pix + unexpected.pix,
    card: planned.card + unexpected.card,
    cardOwnInvoice: planned.cardOwnInvoice + unexpected.cardOwnInvoice,
    cardOtherInvoice: planned.cardOtherInvoice + unexpected.cardOtherInvoice,
    otherInvoiceMonths: [...allOtherMonths].sort(),
    inMonth: planned.inMonth + unexpected.inMonth,
    total: planned.total + unexpected.total,
  };
}

export function invoiceBreakdown(expenses) {
  let livingCents = 0;
  let plannedCents = 0;
  let unexpectedCents = 0;
  let otherCents = 0;
  let livingFromOtherCents = 0;
  let plannedFromOtherCents = 0;
  let unexpectedFromOtherCents = 0;
  let fromOtherMonthsCents = 0;
  const originMonths = new Set();

  for (const expense of expenses || []) {
    if (expense.section !== "card" && !extraOnOwnInvoice(expense)) continue;
    const note = String(expense.note || "");
    const refMonth = referenceMonthFrom(note);
    const isFromOtherMonth = Boolean(refMonth && expense.monthId && refMonth !== expense.monthId);
    if (isFromOtherMonth) {
      fromOtherMonthsCents += expense.amountCents;
      originMonths.add(refMonth);
    }
    if (note.includes("parcelamento:") || note.includes("quitado-cartao:")) {
      otherCents += expense.amountCents;
    } else if (isPlannedNote(note)) {
      plannedCents += expense.amountCents;
      if (isFromOtherMonth) plannedFromOtherCents += expense.amountCents;
    } else if (isImprevistoNote(note) || expense.section === "extra") {
      unexpectedCents += expense.amountCents;
      if (isFromOtherMonth) unexpectedFromOtherCents += expense.amountCents;
    } else if (originIdFrom(note)) {
      livingCents += expense.amountCents;
      if (isFromOtherMonth) livingFromOtherCents += expense.amountCents;
    } else {
      otherCents += expense.amountCents;
    }
  }
  return {
    livingCents,
    plannedCents,
    unexpectedCents,
    otherCents,
    totalCents: livingCents + plannedCents + unexpectedCents + otherCents,
    fromOtherMonthsCents,
    livingFromOtherCents,
    plannedFromOtherCents,
    unexpectedFromOtherCents,
    originMonths: [...originMonths].sort(),
  };
}

export function previousMonthId(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthFinancialSummary(data, nextData = null, prevData = null, purchasesPayload = null) {
  const monthId = String(data?.month?.id || "");
  const incomeCents = Number(data?.month?.incomeCents || 0);
  const totals = data?.totals || {};
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
  const cross = livingCrossMonthSummary(expenses);
  const extras = extrasBreakdown(expenses);

  const faturaCents = Number(totals.faturaCents || 0);
  const livingPixPaidCents = Number(totals.fixedCashCents || 0);
  const livingPixDueCents = Number(totals.fixedPixForecastCents || 0);
  const livingPixTotalCents = livingPixPaidCents + livingPixDueCents;
  const extrasPixCents = Number(totals.extrasPixCents || 0);
  const pixPaidCents = livingPixPaidCents + extrasPixCents;
  const pixTotalCents = livingPixTotalCents + extrasPixCents;
  const paymentsTotalCents = faturaCents + pixTotalCents;
  const paymentsPaidCents = Number(totals.paidCents || 0);
  const paymentsRemainingCents = Math.max(0, paymentsTotalCents - paymentsPaidCents);
  const cashBalanceCents = incomeCents - paymentsTotalCents;

  let purchaseFutureCents = 0;
  let purchaseOwnCents = 0;
  const purchaseFutureMonths = new Set();
  if (Array.isArray(purchasesPayload?.items)) {
    for (const item of purchasesPayload.items) {
      const amount = Number(item?.amountCents || 0);
      const invMonth = String(item?.invoiceMonthId || "");
      if (invMonth && monthId && invMonth !== monthId) {
        purchaseFutureCents += amount;
        purchaseFutureMonths.add(invMonth);
      } else {
        purchaseOwnCents += amount;
      }
    }
  }

  const expensesFutureLaunchedCents = cross.paidCardOtherCents + extras.cardOtherInvoice;
  const expensesOwnLaunchedCents = cross.paidCardOwnCents + extras.cardOwnInvoice;
  const launchedFutureCents = Math.max(expensesFutureLaunchedCents, purchaseFutureCents);
  const launchedOwnInvoiceCents = Math.max(expensesOwnLaunchedCents, purchaseOwnCents);
  const forecastNextInvoiceCents = cross.dueCardOtherCents;
  const totalFutureInvoicesCents = launchedFutureCents + forecastNextInvoiceCents;
  const futureInvoiceMonths = [
    ...new Set([
      ...cross.paidOtherMonths,
      ...extras.otherInvoiceMonths,
      ...cross.dueOtherMonths,
      ...purchaseFutureMonths,
    ]),
  ].sort();

  const prevCross = prevData && Array.isArray(prevData.expenses)
    ? livingCrossMonthSummary(prevData.expenses)
    : null;
  const pendingFromPrevCents = prevCross ? prevCross.dueCardOtherCents : 0;
  const currentInvoiceForecastCents = faturaCents + cross.dueCardOwnCents + pendingFromPrevCents;
  const currentPixForecastCents = pixTotalCents;
  const currentExpenseForecastCents = currentInvoiceForecastCents + currentPixForecastCents;
  const currentBalanceForecastCents = incomeCents - currentExpenseForecastCents;
  const effectiveFixedCents = totals.fixedCents !== undefined
    ? Number(totals.fixedCents || 0)
    : (totals.fixedAllSettled ? Number(totals.fixedLaunchedCents || 0) : Number(totals.fixedForecastCents || 0));
  const currentCategoryBudgetCents = effectiveFixedCents + extras.total;

  const nextId = nextMonthId(monthId);
  const nextReady = Boolean(nextData && !nextData.error && nextData.totals);
  const nextTotals = nextData?.totals || {};
  const nextCross = nextReady && Array.isArray(nextData?.expenses)
    ? livingCrossMonthSummary(nextData.expenses)
    : { dueCardOwnCents: 0, dueCardOtherCents: 0 };
  const nextInvoiceLaunchedCents = nextReady
    ? Number(nextTotals.faturaCents || 0)
    : launchedFutureCents;
  const nextInvoicePendingFromCurrentCents = cross.dueCardOtherCents;
  const nextInvoicePendingOwnCents = nextReady ? nextCross.dueCardOwnCents : 0;
  const nextInvoiceForecastCents = nextInvoiceLaunchedCents + nextInvoicePendingFromCurrentCents + nextInvoicePendingOwnCents;
  const nextPixForecastCents = nextReady
    ? Number(nextTotals.fixedCashCents || 0) + Number(nextTotals.fixedPixForecastCents || 0) + Number(nextTotals.extrasPixCents || 0)
    : 0;
  const nextExpenseForecastCents = nextInvoiceForecastCents + nextPixForecastCents;
  const nextIncomeCents = nextReady ? Number(nextData?.month?.incomeCents || 0) : incomeCents;
  const nextBalanceForecastCents = nextIncomeCents - nextExpenseForecastCents;

  return {
    payments: {
      faturaCents,
      livingPixPaidCents,
      livingPixDueCents,
      livingPixTotalCents,
      extrasPixCents,
      pixPaidCents,
      pixTotalCents,
      totalCents: paymentsTotalCents,
      paidCents: paymentsPaidCents,
      remainingCents: paymentsRemainingCents,
      cashBalanceCents,
    },
    launches: {
      launchedFutureCents,
      forecastNextInvoiceCents,
      totalFutureInvoicesCents,
      launchedOwnInvoiceCents,
      totalLaunchedCents: launchedFutureCents + launchedOwnInvoiceCents,
      futureInvoiceMonths,
      livingLaunchedOtherCents: cross.paidCardOtherCents,
      plannedLaunchedOtherCents: extras.planned.cardOtherInvoice,
      unexpectedLaunchedOtherCents: extras.unexpected.cardOtherInvoice,
    },
    forecast: {
      current: {
        monthId,
        invoiceForecastCents: currentInvoiceForecastCents,
        pixForecastCents: currentPixForecastCents,
        pendingOwnCardCents: cross.dueCardOwnCents,
        pendingFromPrevCents,
        expenseCents: currentExpenseForecastCents,
        incomeCents,
        balanceCents: currentBalanceForecastCents,
        categoryBudgetCents: currentCategoryBudgetCents,
      },
      next: {
        monthId: nextId,
        ready: nextReady,
        invoiceLaunchedCents: nextInvoiceLaunchedCents,
        invoicePendingFromCurrentCents: nextInvoicePendingFromCurrentCents,
        invoicePendingOwnCents: nextInvoicePendingOwnCents,
        invoiceForecastCents: nextInvoiceForecastCents,
        pixForecastCents: nextPixForecastCents,
        expenseCents: nextExpenseForecastCents,
        incomeCents: nextIncomeCents,
        balanceCents: nextBalanceForecastCents,
      },
    },
  };
}
