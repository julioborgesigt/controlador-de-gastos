import {
  extrasBreakdown,
  formatMonthList,
  invoiceBreakdown,
  isZeroFinalizedNote,
  livingCrossMonthSummary,
  money,
  monthFinancialSummary,
  nextMonthId,
  previousMonthId,
  shortMonthLabel,
} from "../../format.js";
import { changeMonth, ensureNextInvoices, ensurePurchases } from "../api.js";
import { askConfirm } from "../dialogs/confirm.js";
import { titleWithHelp } from "../dialogs/info.js";
import { el, monthName } from "../dom.js";
import { editable, monthStore, render, state } from "../state.js";

function extraSplit(expenses) {
  return extrasBreakdown(expenses);
}

function cardSplitText(pixCents, cardOwnCents, cardOtherCents, otherMonths, pixLabel = "no Pix", cardLabel = "no cartão") {
  if (cardOtherCents > 0) {
    const monthsLabel = formatMonthList(otherMonths) || "outro mês";
    if (cardOwnCents > 0) {
      return `${money(pixCents)} ${pixLabel} · ${money(cardOwnCents)} nesta fatura · ${money(cardOtherCents)} na fatura de ${monthsLabel}`;
    }
    return `${money(pixCents)} ${pixLabel} · ${money(cardOtherCents)} na fatura de ${monthsLabel}`;
  }
  return `${money(pixCents)} ${pixLabel} · ${money(cardOwnCents)} ${cardLabel}`;
}

function invoiceSummaryDetail(expenses, totals) {
  const inv = invoiceBreakdown(expenses);
  const living = inv.livingCents || totals.fixedOnCardCents || 0;
  const parts = [];
  if (living > 0) parts.push(`Custo de vida ${money(living)}`);
  if (inv.plannedCents > 0) parts.push(`Planejados ${money(inv.plannedCents)}`);
  if (inv.unexpectedCents > 0) parts.push(`Imprevistos ${money(inv.unexpectedCents)}`);
  if (inv.otherCents > 0 && inv.livingCents > 0) parts.push(`Parcelamentos/outros ${money(inv.otherCents)}`);
  if (!parts.length) {
    return totals.faturaCents > 0 ? "Linhas da fatura deste mês" : "Nenhuma cobrança na fatura neste mês";
  }
  const fromOther = inv.fromOtherMonthsCents > 0
    ? ` · inclui ${money(inv.fromOtherMonthsCents)} vindos de ${formatMonthList(inv.originMonths)}`
    : "";
  return `${parts.join(" · ")}${fromOther}`;
}

function pixSummaryDetail(payments, extras) {
  const parts = [];
  if (payments.livingPixTotalCents > 0) {
    parts.push(payments.livingPixDueCents > 0
      ? `Custo de vida ${money(payments.livingPixTotalCents)} (${money(payments.livingPixPaidCents)} pago · ${money(payments.livingPixDueCents)} previsto)`
      : `Custo de vida ${money(payments.livingPixTotalCents)}`);
  }
  if (extras.planned.pix > 0) parts.push(`Planejados ${money(extras.planned.pix)}`);
  if (extras.unexpected.pix > 0) parts.push(`Imprevistos ${money(extras.unexpected.pix)}`);
  if (!parts.length) return "Nenhum pagamento ou previsão no Pix neste mês";
  return parts.join(" · ");
}

function launchesSummaryLines(launches) {
  const parts = [];
  if (launches.livingLaunchedOtherCents > 0) parts.push(`Custo de vida ${money(launches.livingLaunchedOtherCents)}`);
  if (launches.plannedLaunchedOtherCents > 0) parts.push(`Planejados ${money(launches.plannedLaunchedOtherCents)}`);
  if (launches.unexpectedLaunchedOtherCents > 0) parts.push(`Imprevistos ${money(launches.unexpectedLaunchedOtherCents)}`);
  const months = formatMonthList(launches.futureInvoiceMonths) || "próxima fatura";
  const lines = [];
  if (parts.length) lines.push(parts.join(" · "));
  if (launches.launchedFutureCents > 0 && launches.forecastNextInvoiceCents > 0) {
    lines.push(`Fatura de ${months} · +${money(launches.forecastNextInvoiceCents)} previstos no custo de vida (total ${money(launches.totalFutureInvoicesCents)})`);
  } else if (launches.launchedFutureCents > 0) {
    lines.push(`Serão pagos na fatura de ${months}`);
  } else if (launches.forecastNextInvoiceCents > 0) {
    lines.push(`${money(launches.forecastNextInvoiceCents)} previstos no custo de vida p/ fatura de ${months}`);
  } else {
    lines.push("Nenhum gasto deste mês lançado para próximas faturas");
  }
  return lines;
}

function extraCategoryJump(filter, title, bucket, emptyCopy) {
  return el("button", {
    class: "jump",
    type: "button",
    onclick: () => {
      state.view = "extras";
      state.extraFilter = filter;
      render();
    },
  }, [
    el("div", { class: "row-between" }, [el("span", {}, title), el("strong", {}, money(bucket.total))]),
    el("small", {}, bucket.total > 0
      ? cardSplitText(bucket.pix, bucket.cardOwnInvoice, bucket.cardOtherInvoice, bucket.otherInvoiceMonths)
      : emptyCopy),
  ]);
}

export function summary(data) {
  const { month, totals } = data;
  const extras = extraSplit(data.expenses);
  const nextId = nextMonthId(month.id);
  const prevId = previousMonthId(month.id);
  const nextKnown = (data.months || []).some((item) => item.id === nextId);
  if (nextKnown) ensureNextInvoices(month.id);
  ensurePurchases(month.id);
  const nextData = state.nextInvoicesFor === month.id ? state.nextInvoices : (monthStore.get(nextId) || null);
  const prevData = monthStore.get(prevId) || null;
  const purchases = state.purchasesMonthId === month.id ? state.purchases : null;
  const fin = monthFinancialSummary(data, nextData, prevData, purchases);
  const launchesDisplayCents = fin.launches.launchedFutureCents > 0
    ? fin.launches.launchedFutureCents
    : fin.launches.forecastNextInvoiceCents;
  const paidPct = fin.payments.totalCents > 0
    ? Math.min(100, Math.round((fin.payments.paidCents / fin.payments.totalCents) * 100))
    : 100;

  return el("section", {}, [
    el("article", { class: "hero summary-hero" }, [
      titleWithHelp(month.label, "Resumo mensal", [
        "Pagamentos do mês: o que você efetivamente vai precisar pagar durante este mês — soma a fatura do cartão que vence neste mês e as contas previstas ou pagas no Pix.",
        "Valores lançados p/ próximas faturas: gastos feitos neste mês no cartão que só serão pagos na próxima ou nas próximas faturas.",
        "Despesa prevista (mês atual e próximo mês): mostra lado a lado a despesa prevista deste mês e a do próximo mês (já somando a próxima fatura e os gastos previstos para ela).",
      ]),
      el("p", { class: "muted hero-kicker" }, "Falta pagar neste mês (fatura + Pix)"),
      el("p", { class: "money" }, money(fin.payments.remainingCents)),
      el("div", { class: "hero-bar", "aria-hidden": "true" }, [
        el("span", { style: `width:${paidPct}%` }),
      ]),
      el("div", { class: "hero-stats" }, [
        el("div", { class: "hero-stat" }, [
          el("small", {}, "Total do mês"),
          el("strong", {}, money(fin.payments.totalCents)),
        ]),
        el("div", { class: "hero-stat" }, [
          el("small", {}, "Já pago"),
          el("strong", { class: "positive" }, money(fin.payments.paidCents)),
        ]),
        el("div", { class: "hero-stat" }, [
          el("small", {}, "Fatura do mês"),
          el("strong", {}, money(fin.payments.faturaCents)),
        ]),
        el("div", { class: "hero-stat" }, [
          el("small", {}, "Pix do mês"),
          el("strong", {}, money(fin.payments.pixTotalCents)),
        ]),
      ]),
      month.settled ? el("p", { class: "badge paid" }, "Mês quitado") : "",
    ]),
    el("p", { class: "eyebrow group" }, "Receita e despesa prevista"),
    el("div", { class: "grid" }, [
      el("button", { class: "metric wide metric-income", type: "button", onclick: () => { state.view = "receita"; render(); } }, [
        el("div", { class: "row-between" }, [
          el("div", {}, [
            el("small", {}, "Receita mensal"),
            el("strong", {}, money(month.incomeCents)),
          ]),
          el("div", { class: "metric-end" }, [
            el("small", {}, "Saldo dos pagamentos"),
            el("strong", { class: fin.payments.cashBalanceCents < 0 ? "negative" : "positive" }, money(fin.payments.cashBalanceCents)),
          ]),
        ]),
        month.extraIncomeCents ? el("small", { class: "metric-note" }, `Inclui ${money(month.extraIncomeCents)} de receita extra`) : "",
      ]),
      el("div", { class: "metric metric-forecast" }, [
        el("small", {}, `Despesa prevista · ${shortMonthLabel(month.id)}`),
        el("strong", {}, money(fin.forecast.current.expenseCents)),
        el("div", { class: "metric-lines" }, [
          el("small", {}, `Fatura: ${money(fin.forecast.current.invoiceForecastCents)}`),
          el("small", {}, `Pix: ${money(fin.forecast.current.pixForecastCents)}`),
        ]),
        el("div", { class: "metric-footer" }, [
          el("small", {}, `Saldo previsto · ${shortMonthLabel(month.id)}`),
          el("strong", { class: fin.forecast.current.balanceCents < 0 ? "negative" : "positive" }, money(fin.forecast.current.balanceCents)),
        ]),
      ]),
      nextKnown
        ? el("button", {
          class: "metric metric-forecast",
          type: "button",
          "aria-label": `Abrir ${monthName(nextId)}`,
          onclick: () => changeMonth(nextId),
        }, [
          el("small", {}, `Despesa prevista · ${shortMonthLabel(nextId)}`),
          el("strong", {}, fin.forecast.next.ready ? money(fin.forecast.next.expenseCents) : "…"),
          el("div", { class: "metric-lines" }, fin.forecast.next.ready
            ? [
              el("small", {}, `Fatura prev.: ${money(fin.forecast.next.invoiceForecastCents)}`),
              el("small", {}, `Pix: ${money(fin.forecast.next.pixForecastCents)}`),
            ]
            : [el("small", {}, "Calculando próximo mês...")]),
          el("div", { class: "metric-footer" }, [
            el("small", {}, `Saldo previsto · ${shortMonthLabel(nextId)}`),
            el("strong", {
              class: !fin.forecast.next.ready ? "" : fin.forecast.next.balanceCents < 0 ? "negative" : "positive",
            }, fin.forecast.next.ready ? money(fin.forecast.next.balanceCents) : "…"),
          ]),
        ])
        : el("div", { class: "metric metric-forecast" }, [
          el("small", {}, `Próxima fatura · ${shortMonthLabel(nextId)}`),
          el("strong", {}, money(fin.forecast.next.invoiceForecastCents)),
          el("small", { class: "xray-sub" }, fin.forecast.next.invoiceForecastCents > 0
            ? `Já previsto p/ ${shortMonthLabel(nextId)}`
            : "Último mês do período"),
        ]),
    ]),
    el("p", { class: "eyebrow group" }, "Pagamentos deste mês"),
    jump("cartoes", "Fatura do cartão deste mês", money(totals.faturaCents), invoiceSummaryDetail(data.expenses, totals)),
    jump("avista", "Contas no Pix deste mês", money(fin.payments.pixTotalCents), pixSummaryDetail(fin.payments, extras)),
    el("p", { class: "eyebrow group" }, "Lançamentos p/ próximas faturas"),
    el("button", {
      class: "jump",
      type: "button",
      onclick: () => {
        state.view = "cartoes";
        state.cardFocus = "purchases";
        render();
      },
    }, [
      el("div", { class: "row-between" }, [
        el("span", {}, fin.launches.launchedFutureCents === 0 && fin.launches.forecastNextInvoiceCents > 0
          ? "Previstos p/ próxima fatura"
          : "Lançados p/ próximas faturas"),
        el("strong", {}, money(launchesDisplayCents)),
      ]),
      ...launchesSummaryLines(fin.launches).map((line, index) => el("small", { class: index > 0 ? "jump-sub" : "" }, line)),
    ]),
    el("p", { class: "eyebrow group" }, "Categorias do mês"),
    livingJump(totals, data.expenses),
    extraCategoryJump("planejado", "Planejados", extras.planned, "Nenhuma compra ou conta planejada neste mês"),
    extraCategoryJump("imprevisto", "Imprevistos", extras.unexpected, "Nenhum gasto imprevisto neste mês"),
    editable() && totals.launchedRemainingCents > 0
      ? el("button", { class: "primary", type: "button", onclick: () => askConfirm("settle") }, "Quitar o que falta")
      : editable() && month.settled
        ? el("button", { class: "secondary", type: "button", onclick: () => askConfirm("reopen") }, "Reabrir mês")
        : "",
  ]);
}

function jump(view, title, amount, detail) {
  return el("button", {
    class: "jump",
    type: "button",
    onclick: () => {
      state.view = view;
      render();
    },
  }, [
    el("div", { class: "row-between" }, [el("span", {}, title), el("strong", {}, amount)]),
    el("small", {}, detail),
  ]);
}

export function livingOtherChargeMonths(expense) {
  const months = new Set();
  for (const charge of expense?.charges || []) {
    if (charge?.monthId && expense?.monthId && charge.monthId !== expense.monthId) {
      months.add(charge.monthId);
    }
  }
  return [...months].sort();
}

function livingCardPlace(totals, expenses) {
  const base = `${money(totals.fixedCashCents)} fora do cartão · ${money(totals.fixedOnCardCents)} no cartão`;
  const cross = livingCrossMonthSummary(expenses || state.data?.expenses || []);
  const extras = [];
  if (cross.paidCardOtherCents > 0) {
    extras.push(`${money(cross.paidCardOtherCents)} na fatura de ${formatMonthList(cross.paidOtherMonths)}`);
  }
  if (cross.dueCardOtherCents > 0) {
    extras.push(`previsto p/ fatura de ${formatMonthList(cross.dueOtherMonths)}: ${money(cross.dueCardOtherCents)}`);
  }
  return {
    base,
    cross: extras.join(" · "),
  };
}

function livingJump(totals, expenses) {
  const openLiving = () => {
    state.view = "casa";
    render();
  };
  const placeInfo = livingCardPlace(totals, expenses);
  const place = el("small", { class: "jump-place" }, placeInfo.base);
  const crossLine = placeInfo.cross ? el("small", { class: "jump-sub" }, placeInfo.cross) : "";
  if (totals.fixedAllSettled) {
    return el("button", { class: "jump", type: "button", onclick: openLiving }, [
      el("div", { class: "row-between" }, [
        el("span", {}, "Custo de vida"),
        el("strong", {}, money(totals.fixedLaunchedCents)),
      ]),
      el("small", {}, "Valor consolidado"),
      place,
      crossLine,
    ]);
  }
  const effectiveForecast = totals.fixedCents ?? totals.fixedForecastCents;
  const adjusted = effectiveForecast !== totals.fixedForecastCents;
  return el("button", { class: "jump", type: "button", onclick: openLiving }, [
    el("div", { class: "jump-pair" }, [
      el("span", {}, "Custo de vida"),
      el("strong", {}, money(totals.fixedLaunchedCents)),
      el("small", {}, adjusted ? `Previsto atual ${money(effectiveForecast)} (inicial ${money(totals.fixedForecastCents)})` : `Previsto ${money(effectiveForecast)}`),
      el("small", { class: "jump-caption" }, "Parcial"),
    ]),
    place,
    crossLine,
  ]);
}

function costCard(key, label, cents, wide = false, sub = "") {
  return el("button", {
    type: "button",
    class: wide ? "wide" : "",
    "aria-label": `Ver o detalhamento de ${label}`,
    onclick: () => {
      state.costDetail = key;
      render();
    },
  }, [
    el("small", {}, label),
    el("strong", {}, money(cents)),
    sub ? el("small", { class: "xray-sub" }, sub) : "",
  ]);
}

export function costSplit(totals) {
  const paidMonth = (totals.fixedOnCardCents || 0) + (totals.fixedPixPaidCents || 0);
  const cross = livingCrossMonthSummary(state.data?.expenses || []);
  const effectiveForecast = totals.fixedCents ?? totals.fixedForecastCents;
  const forecastSub = effectiveForecast !== totals.fixedForecastCents
    ? `previsto inicial ${money(totals.fixedForecastCents)}`
    : "";
  const cardPaidSub = cross.paidCardOtherCents > 0
    ? `inclui ${money(cross.paidCardOtherCents)} na fatura de ${formatMonthList(cross.paidOtherMonths)}`
    : "";
  const cardDueSub = cross.dueCardOtherCents > 0
    ? `inclui ${money(cross.dueCardOtherCents)} p/ fatura de ${formatMonthList(cross.dueOtherMonths)}`
    : "";
  const pixDueSub = totals.fixedPixForecastCents > 0
    ? "entra nos pagamentos deste mês"
    : "";
  return el("div", { class: "cost-split" }, [
    costCard("previsto", "Previsto", effectiveForecast, true, forecastSub),
    costCard("pago", "Já pago / lançado", paidMonth, true),
    costCard("cartao", "Lançado no cartão", totals.fixedOnCardCents, false, cardPaidSub),
    costCard("pix", "Pago no Pix", totals.fixedPixPaidCents),
    costCard("falta-cartao", "Falta no cartão", totals.fixedCardDueCents || 0, false, cardDueSub),
    costCard("falta-pix", "Falta no Pix", totals.fixedPixForecastCents, false, pixDueSub),
  ]);
}

export function costPortions(expense) {
  const partials = expense.partials || [];
  const cardPaid = partials.filter((item) => item.payment === "card").reduce((sum, item) => sum + item.amountCents, 0);
  const pixPaid = partials.filter((item) => item.payment !== "card").reduce((sum, item) => sum + item.amountCents, 0);
  const onCard = expense.onCard;
  let pagoCartao = 0;
  let pagoPix = 0;
  if (onCard) pagoCartao = expense.amountCents;
  else if (partials.length) {
    pagoCartao = cardPaid;
    pagoPix = pixPaid;
  } else if (expense.paid && !isZeroFinalizedNote(expense.note) && expense.payment === "pix") pagoPix = expense.amountCents;
  const spent = pagoCartao + pagoPix;
  const left = !expense.paid && !onCard ? Math.max(0, expense.amountCents - spent) : 0;
  const previsto = onCard ? expense.amountCents : expense.paid ? spent : Math.max(expense.amountCents, spent);
  return {
    previsto,
    pagoCartao,
    pagoPix,
    faltaCartao: expense.payment === "card" ? left : 0,
    faltaPix: expense.payment === "card" ? 0 : left,
  };
}

export function costPortionAmount(parts, key) {
  if (key === "previsto") return parts.previsto;
  if (key === "pago") return parts.pagoCartao + parts.pagoPix;
  if (key === "cartao") return parts.pagoCartao;
  if (key === "pix") return parts.pagoPix;
  if (key === "falta-cartao") return parts.faltaCartao;
  return parts.faltaPix;
}
