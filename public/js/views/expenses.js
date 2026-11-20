import {
  cardChargeTitle,
  chargedInvoiceMonth,
  extraOnOwnInvoice,
  extrasBreakdown,
  formatMonthList,
  invoiceShift,
  isImprevistoNote,
  isPlannedNote,
  isVariableNote,
  money,
  nextMonthId,
  originIdFrom,
  paymentLabel,
  referenceMonthFrom,
  shortMonthLabel,
} from "../../format.js";
import { rememberMonth, request } from "../api.js";
import { askConfirm } from "../dialogs/confirm.js";
import {
  cardPartialCents,
  livingBalance,
  livingBalanceLines,
  openCloseLiving,
  openExpenseInfo,
  openUndoCard,
  reopenLivingExpense,
} from "../dialogs/expense-info.js";
import { titleWithHelp } from "../dialogs/info.js";
import { el, messageOf, monthName } from "../dom.js";
import { openCardExpense, openCreate, openEdit } from "../sheets/openers.js";
import {
  editable,
  render,
  renderSafely,
  setWorking,
  state,
} from "../state.js";
import { swipeRow } from "../swipe.js";
import { cardMirror } from "./card-helpers.js";
import { openCashSpend } from "./cash.js";
import { costSplit, livingOtherChargeMonths } from "./summary.js";

function extraSplitCards(extras, monthId) {
  const active = state.extraFilter || "all";
  const monthLabel = shortMonthLabel(monthId);
  return el("div", { class: "cost-split" }, [
    el("button", {
      type: "button",
      class: `wide${active === "all" ? " on" : ""}`,
      onclick: () => {
        state.extraFilter = "all";
        render();
      },
    }, [
      el("small", {}, `Gastos em ${monthLabel}`),
      el("strong", {}, money(extras.inMonth)),
      el("small", {}, `${money(extras.pix)} no Pix · ${money(extras.cardOwnInvoice)} na fatura do mês`),
      el("small", { class: "cost-aux" }, `Total lançado: ${money(extras.total)}`),
    ]),
    el("button", {
      type: "button",
      class: active === "planejado" ? "on" : "",
      onclick: () => {
        state.extraFilter = active === "planejado" ? "all" : "planejado";
        render();
      },
    }, [
      el("small", {}, "Planejados"),
      el("strong", {}, money(extras.planned.inMonth)),
      el("small", {}, `${money(extras.planned.pix)} Pix · ${money(extras.planned.cardOwnInvoice)} cartão`),
      el("small", { class: "cost-aux" }, `Total: ${money(extras.planned.total)}`),
    ]),
    el("button", {
      type: "button",
      class: active === "imprevisto" ? "on" : "",
      onclick: () => {
        state.extraFilter = active === "imprevisto" ? "all" : "imprevisto";
        render();
      },
    }, [
      el("small", {}, "Imprevistos"),
      el("strong", {}, money(extras.unexpected.inMonth)),
      el("small", {}, `${money(extras.unexpected.pix)} Pix · ${money(extras.unexpected.cardOwnInvoice)} cartão`),
      el("small", { class: "cost-aux" }, `Total: ${money(extras.unexpected.total)}`),
    ]),
  ]);
}

export function sectionList(data, section) {
  const totals = data.totals;
  const all = data.expenses.filter((expense) => belongs(expense, section));
  const visible = all.filter((expense) => state.showEmpty || expense.amountCents !== 0 || expense.source === "user");
  const hidden = all.length - visible.length;
  const extras = section === "extra" ? extrasBreakdown(all, { includeCardExtras: true }) : null;
  const total = section === "card"
    ? totals.faturaCents
    : section === "fixed"
      ? (totals.fixedAllSettled ? totals.fixedLaunchedCents : (totals.fixedCents ?? totals.fixedForecastCents))
      : extras.inMonth;
  const children = [
    el("div", { class: "section-head" }, [
      section === "fixed"
        ? titleWithHelp("Custo de vida", "Custo de vida", [
          "Aqui fica o previsto da casa e o que já foi pago no Pix ou lançado no cartão.",
          "Os lançamentos são feitos pelas abas Cartões de crédito e À vista, vinculando ao custo de vida. Arraste um custo para a direita (ou toque nele) para finalizar a despesa quando não for mais lançar nada nela neste mês.",
          "Ao finalizar uma despesa, o custo atual dela passa a valer para os cálculos do mês e o restante previsto deixa de constar como falta.",
        ])
        : section === "extra"
          ? titleWithHelp("Planejados e imprevistos", "Planejados e imprevistos", [
            "Destaca os gastos que entram no mês em visualização (Pix e fatura do mês) e exibe de forma acessória o total lançado.",
            "Toque nos cartões abaixo para filtrar só Planejados ou só Imprevistos, ou lance um novo gasto no cartão ou no Pix.",
          ])
          : el("p", { class: "eyebrow" }, data.month.label),
      section === "fixed" || section === "extra" ? el("p", { class: "muted" }, data.month.label) : "",
      section === "fixed" || section === "extra" ? "" : el("h2", {}, money(total)),
      section === "fixed" ? costSplit(totals) : "",
      section === "extra" ? extraSplitCards(extras, data.month.id) : "",
    ]),
  ];
  if (editable() && section === "fixed") {
    children.push(el("button", {
      class: "primary add-top",
      type: "button",
      onclick: () => openCreate(section, "pix"),
    }, "Adicionar custo"));
  }
  if (editable() && section === "extra") {
    const kind = state.extraFilter === "planejado" ? "planejado" : "imprevisto";
    children.push(el("div", { class: "stack-actions" }, [
      el("button", {
        class: "primary",
        type: "button",
        onclick: () => openCardExpense("", kind),
      }, "+ Lançar no cartão"),
      el("button", {
        class: "secondary",
        type: "button",
        onclick: () => openCashSpend(kind),
      }, "+ Lançar no Pix"),
    ]));
  }
  if (section === "extra") {
    const active = state.extraFilter || "all";
    const plannedRows = visible.filter((expense) => isPlannedNote(expense.note));
    const unexpectedRows = visible.filter((expense) => !isPlannedNote(expense.note));
    const groups = [
      active !== "imprevisto" ? ["Planejados", plannedRows, extras.planned.inMonth, extras.planned.total] : null,
      active !== "planejado" ? ["Imprevistos", unexpectedRows, extras.unexpected.inMonth, extras.unexpected.total] : null,
    ].filter(Boolean);
    let shownAny = false;
    for (const [title, rows, groupMonth, groupTotal] of groups) {
      if (!rows.length) continue;
      shownAny = true;
      const groupLabel = groupTotal !== groupMonth
        ? `${title} · ${money(groupMonth)} no mês (total ${money(groupTotal)})`
        : `${title} · ${money(groupMonth)}`;
      children.push(el("p", { class: "eyebrow group" }, groupLabel));
      children.push(el("div", { class: "list" }, rows.map((expense) => expenseRow(expense, section))));
    }
    if (!shownAny) {
      children.push(el("p", { class: "muted" }, active === "planejado"
        ? "Nenhum gasto planejado neste mês."
        : active === "imprevisto"
          ? "Nenhum imprevisto neste mês."
          : "Nenhum imprevisto ou planejado neste mês."));
    }
  } else {
    children.push(el("div", { class: "list" }, visible.map((expense) => expenseRow(expense, section))));
    if (!visible.length) {
      children.push(el("p", { class: "muted" }, section === "fixed" ? "Nenhum custo de vida neste mês." : "Nada com valor neste mês."));
    }
  }
  if (hidden > 0) {
    children.push(el("button", {
      class: "linkish",
      type: "button",
      onclick: () => {
        state.showEmpty = true;
        render();
      },
    }, `Mostrar ${hidden} ${hidden === 1 ? "linha sem valor" : "linhas sem valor"}`));
  }
  return el("section", {}, children);
}

function belongs(expense, section) {
  if (section === "card") return expense.section === "card" || extraOnOwnInvoice(expense) || (expense.section === "fixed" && expense.onCard);
  if (section === "extra") {
    return expense.section === "extra" || (expense.section === "card" && (isPlannedNote(expense.note) || isImprevistoNote(expense.note)));
  }
  return expense.section === "fixed";
}

function systemCardLine(expense) {
  const note = String(expense.note || "");
  return note.includes("parcelamento:") || note.includes("quitado-cartao:");
}

export function cardTrack(expense) {
  if (systemCardLine(expense)) return "";
  if (isPlannedNote(expense.note)) return "planejado";
  if (isImprevistoNote(expense.note) || expense.section === "extra") return "imprevisto";
  if (expense.section === "fixed" || originIdFrom(expense.note)) return "casa";
  return "";
}

export function cardSourceLabel(expense) {
  if (isPlannedNote(expense.note)) return "Planejado";
  if (isImprevistoNote(expense.note) || expense.section === "extra") return "Imprevisto";
  if (expense.section === "fixed" && expense.onCard) return "Custo de vida";
  if (expense.section === "card" && originIdFrom(expense.note)) return "Custo de vida";
  return "";
}

export function expenseRow(expense, section, options = {}) {
  const onInvoice = expense.section === "fixed" && expense.onCard;
  const lockedCard = Boolean(options.cardExpense) && expense.section !== "fixed";
  const meta = [];
  if (expense.section === "extra" && section === "card" && !options.manage && !isPlannedNote(expense.note)) meta.push("Imprevisto");
  const extraInvMonth = expense.section === "extra" ? chargedInvoiceMonth(expense.note) : "";
  const extraOtherInvoice = Boolean(extraInvMonth && expense.monthId && extraInvMonth !== expense.monthId);
  const refMonth = section === "card" || (section === "extra" && expense.section === "card") ? referenceMonthFrom(expense.note) : "";
  const cardFromOtherMonth = Boolean(refMonth && expense.monthId && refMonth !== expense.monthId);
  if (section === "extra" && expense.payment === "card") {
    if (extraOtherInvoice) {
      meta.push(`Gasto deste mês · entra na fatura de ${monthName(extraInvMonth)}`);
    } else if (!cardFromOtherMonth) {
      meta.push("Na fatura deste mês");
    }
  } else if (extraOtherInvoice) {
    meta.push(`Na fatura de ${monthName(extraInvMonth)}`);
  }
  if (cardFromOtherMonth) {
    meta.push(`Gasto de ${monthName(refMonth)} cobrado nesta fatura`);
  }
  if (onInvoice && section === "card") meta.push("Custo de vida, já incluído");
  if (expense.payment !== "card" || onInvoice) meta.push(paymentLabel(expense.payment));
  if (expense.payment === "card" && !onInvoice && !options.manage) meta.push(expense.cardLabel ? `Crédito ${expense.cardLabel}` : "Crédito");
  if (section === "fixed" && isVariableNote(expense.note)) meta.push("Variável");
  if (expense.section === "fixed") meta.push(...livingBalanceLines(expense));
  if (expense.installment) meta.push(expense.installment);
  const partials = expense.partials || [];
  const edit = () => {
    if (editable()) openEdit(expense, { cardExpense: lockedCard, fromCard: section === "card" && !systemCardLine(expense) });
  };
  const mirror = cardMirror(expense, section);
  const forecast = section === "fixed" && !onInvoice && !expense.paid && !partials.length;
  const partialOnCard = section === "fixed" && !onInvoice && !expense.paid && cardPartialCents(expense) > 0;
  const fullOnCard = section === "fixed" && onInvoice;
  const tone = fullOnCard ? " on-card-full" : mirror && !(onInvoice && section === "card") ? " on-card" : onInvoice && section === "card" ? " aside" : expense.paid ? " paid" : " open";
  const otherLivingMonths = expense.section === "fixed" ? livingOtherChargeMonths(expense) : [];
  const nextLivingInvoice = section === "fixed" && expense.payment === "card" && invoiceShift(expense.note) === "seguinte"
    ? nextMonthId(expense.monthId)
    : "";
  let badges;
  if (mirror) {
    if (section === "extra") {
      badges = [extraOtherInvoice
        ? el("span", { class: "badge cross-month" }, `Fatura ${shortMonthLabel(extraInvMonth)}`)
        : el("span", { class: "badge on-card" }, "Fatura deste mês")];
    } else if (otherLivingMonths.length) {
      badges = [el("span", { class: "badge cross-month" }, `Fatura ${formatMonthList(otherLivingMonths)}`)];
    } else {
      badges = [el("span", { class: "badge on-card" }, "Tá no cartão")];
    }
  } else if (expense.paid) {
    badges = [el("span", { class: "badge paid" }, section === "fixed" ? "Finalizada" : "Pago")];
  } else if (partialOnCard) {
    badges = [
      el("span", { class: "badge open" }, "Em aberto"),
      otherLivingMonths.length
        ? el("span", { class: "badge cross-month" }, `Parcial · Fatura ${formatMonthList(otherLivingMonths)}`)
        : el("span", { class: "badge on-card" }, "Parcial no cartão"),
    ];
  } else if (forecast) {
    badges = [
      el("span", { class: "badge forecast" }, "Previsto"),
      nextLivingInvoice ? el("span", { class: "badge cross-month" }, `Fatura ${shortMonthLabel(nextLivingInvoice)}`) : "",
    ].filter(Boolean);
  } else {
    badges = [el("span", { class: "badge open" }, "Em aberto")];
  }
  if ((section === "card" || section === "extra") && cardFromOtherMonth) {
    badges.unshift(el("span", { class: "badge cross-month" }, `De ${shortMonthLabel(refMonth)}`));
  }
  if (section === "card" || section === "extra") {
    const source = cardSourceLabel(expense);
    const sourceClass = source === "Planejado" ? "badge source-planned" : source === "Imprevisto" ? "badge source-extra" : "badge source-fixed";
    if (source) badges.unshift(el("span", { class: sourceClass }, source));
  }
  const finalizedLiving = section === "fixed" && expense.paid && !onInvoice;
  const shownAmount = finalizedLiving ? livingBalance(expense).spent : expense.amountCents;
  const front = el("article", { class: `item${tone}` }, [
    el("div", { class: "item-copy" }, [
      el("button", { type: "button", class: "item-main", onclick: () => openExpenseInfo(expense, section) }, [
        el("strong", {}, section === "card" || expense.section === "card" ? cardChargeTitle(expense) : expense.name),
        ...meta.filter(Boolean).map((line) => el("small", {}, line)),
      ]),
      onInvoice && section === "card" ? el("span", { class: "badge" }, "Já contabilizado, não soma de novo") : "",
      expense.section === "extra" && expense.payment !== "card" ? el("span", { class: "badge pix" }, paymentLabel(expense.payment)) : "",
    ]),
    el("div", { class: "item-end" }, [
      el("div", { class: "badges" }, badges),
      el("span", { class: `amount${onInvoice && section === "card" ? " aside" : ""}` }, shownAmount === 0 && !finalizedLiving ? "—" : money(shownAmount)),
    ]),
  ]);
  if (!editable()) return front;
  const informational = section === "extra";
  const onCardHere = section === "fixed" && expense.onCard;
  const living = section === "fixed" && !expense.onCard;
  const leads = informational
    ? null
    : onCardHere
    ? [{ label: "Desfazer", tone: "undo", commit: true, run: () => openUndoCard(expense) }]
    : living
    ? [
      expense.paid
        ? { label: "Reabrir\ndespesa", tone: "undo", commit: true, run: () => reopenLivingExpense(expense) }
        : { label: "Finalizar\ndespesa", tone: "pay", run: () => openCloseLiving(expense) },
    ]
    : null;
  return swipeRow(front, {
    leads,
    pay: informational || living || onInvoice ? null : {
      label: expense.paid ? "Desfazer" : "Pago",
      undo: expense.paid,
      run: () => patchExpense(expense, { paid: !expense.paid }),
    },
    actions: [
      { label: "Editar", tone: "edit", run: edit },
      { label: "Excluir", tone: "delete", run: () => openDeleteExpense(expense) },
    ],
  });
}

export async function patchExpense(expense, patch) {
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    state.data = await request(`/api/expenses/${expense.id}`, {
      method: "PATCH",
      body: {
        name: expense.name,
        amountCents: expense.amountCents,
        section: expense.section,
        payment: expense.payment,
        onCard: expense.onCard,
        cardLabel: expense.cardLabel,
        note: expense.note,
        installment: expense.installment,
        paid: expense.paid,
        ...patch,
      },
    });
    rememberMonth(state.data);
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export function openDeleteExpense(expense) {
  if (!expense?.id) return;
  const cardSurprise = expense.section === "extra" && expense.payment === "card";
  if (expense.section !== "fixed" && expense.section !== "card" && !cardSurprise) {
    state.confirmTarget = expense;
    askConfirm("delete-expense-simple");
    return;
  }
  state.expenseInfo = null;
  state.sheet = {
    mode: "delete-expense",
    id: expense.id,
    name: expense.name,
    section: expense.section,
    scope: cardSurprise ? "forward" : "month",
  };
  state.error = "";
  render();
}

export async function deleteExpenseNow(expense, scope = "month") {
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    const query = scope === "month" ? "" : `?scope=${scope}`;
    state.data = await request(`/api/expenses/${expense.id}${query}`, { method: "DELETE" });
    if (state.sheet?.id === expense.id || state.sheet?.mode === "delete-expense") state.sheet = null;
    state.notice = scope === "series"
      ? `Excluí “${expense.name}” de todos os meses.`
      : scope === "forward"
        ? `Tirei “${expense.name}” desta fatura e das seguintes.`
        : `Excluí “${expense.name}” deste mês.`;
    rememberMonth(state.data);
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}
