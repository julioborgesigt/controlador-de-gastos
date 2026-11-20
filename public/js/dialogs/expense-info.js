import {
  chargedInvoiceMonth,
  formatMonthList,
  invoiceShift,
  isVariableNote,
  isZeroFinalizedNote,
  money,
  nextMonthId,
  originIdFrom,
  passkeyWhen,
  paymentLabel,
  referenceMonthFrom,
  visibleNote,
} from "../../format.js";
import { rememberMonth, request } from "../api.js";
import { el, messageOf, monthName, onDesktop } from "../dom.js";
import {
  editable,
  render,
  renderSafely,
  setWorking,
  state,
} from "../state.js";
import { cardMirror, firstCardName } from "../views/card-helpers.js";
import { patchExpense } from "../views/expenses.js";

export function livingBalance(expense) {
  const partials = expense.partials || [];
  let pix = 0;
  let credit = 0;
  for (const partial of partials) {
    if (partial.payment === "card") credit += partial.amountCents;
    else pix += partial.amountCents;
  }
  const charged = (expense.charges || []).reduce((sum, charge) => sum + charge.amountCents, 0);
  if (charged > credit) credit = charged;
  if (!partials.length && expense.paid && !isZeroFinalizedNote(expense.note) && expense.payment !== "card") pix += expense.amountCents;
  if (!partials.length && expense.onCard && credit === 0) credit += expense.amountCents;
  const spent = pix + credit;
  const finalized = Boolean(expense.paid && !expense.onCard);
  return {
    forecast: expense.amountCents,
    pix,
    credit,
    spent,
    finalized,
    remaining: finalized || expense.onCard ? 0 : Math.max(0, expense.amountCents - spent),
    over: Math.max(0, spent - expense.amountCents),
  };
}

export function livingBalanceLines(expense) {
  const balance = livingBalance(expense);
  const lines = [`Previsto ${money(balance.forecast)}`];
  if (balance.pix) lines.push(`Já lançado no Pix ${money(balance.pix)}`);
  if (balance.credit) {
    const charges = Array.isArray(expense.charges) ? expense.charges : [];
    const otherCharges = charges.filter((item) => item?.monthId && expense.monthId && item.monthId !== expense.monthId);
    const ownCharges = charges.filter((item) => !item?.monthId || !expense.monthId || item.monthId === expense.monthId);
    if (otherCharges.length && !ownCharges.length) {
      const months = formatMonthList([...new Set(otherCharges.map((item) => item.monthId))]);
      lines.push(`Já lançado na fatura de ${months}: ${money(balance.credit)}`);
    } else if (otherCharges.length && ownCharges.length) {
      const otherTotal = otherCharges.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
      const months = formatMonthList([...new Set(otherCharges.map((item) => item.monthId))].sort());
      lines.push(`Já lançado no crédito ${money(balance.credit)} (${money(otherTotal)} na fatura de ${months})`);
    } else {
      lines.push(`Já lançado na fatura deste mês ${money(balance.credit)}`);
    }
  }
  if (balance.finalized) {
    lines.push(`Finalizada · custo atual ${money(balance.spent)}`);
  } else if (balance.over > 0) lines.push(`Passou ${money(balance.over)}`);
  else if (balance.remaining > 0 && expense.payment === "card") {
    if (invoiceShift(expense.note) === "seguinte") {
      const nextId = nextMonthId(expense.monthId);
      lines.push(`Entrará na fatura de ${monthName(nextId)}: ${money(balance.remaining)}`);
    } else {
      lines.push(`Previsto no cartão ${money(balance.remaining)}`);
    }
  } else if (balance.remaining > 0) lines.push(`Previsto no Pix ${money(balance.remaining)}`);
  return lines;
}

export function cardPartialCents(expense) {
  return (expense.partials || [])
    .filter((item) => item.payment === "card")
    .reduce((sum, item) => sum + item.amountCents, 0);
}

export function livingChargeIsFull(planned, already, charged) {
  return already <= 0 && planned > 0 && charged >= planned;
}

function partialLine(partial) {
  const method = partial.payment === "card"
    ? `Crédito${partial.cardLabel ? ` ${partial.cardLabel}` : ""}`
    : paymentLabel(partial.payment);
  return `${method} · ${money(partial.amountCents)}${partial.installment ? ` · ${partial.installment}` : ""}`;
}

export function openExpenseInfo(expense, section) {
  const mirror = cardMirror(expense, section);
  const living = expense.section === "fixed" && !expense.onCard;
  const balance = living ? livingBalance(expense) : null;
  state.expenseInfo = {
    id: expense.id,
    name: expense.name,
    amount: expense.amountCents === 0 ? "—" : money(expense.amountCents),
    amountCents: expense.amountCents,
    spentCents: balance ? balance.spent : 0,
    zeroFinalized: isZeroFinalizedNote(expense.note),
    monthId: expense.monthId,
    section: expense.section,
    mirror,
    living,
    paid: expense.paid,
    cardName: expense.cardLabel || "",
    registered: expense.createdAt ? passkeyWhen(expense.createdAt) : "",
    note: visibleNote(expense.note),
    payment: mirror ? "" : paymentLabel(expense.payment),
    paymentKind: expense.payment,
    status: mirror ? "" : (expense.paid ? (living ? "Finalizada" : "Pago") : "Em aberto"),
    installment: expense.installment || "",
    partials: expense.partials || [],
    charges: expense.charges || [],
    invoiceMonth: chargedInvoiceMonth(expense.note),
    refMonth: referenceMonthFrom(expense.note),
    nextInvoice: invoiceShift(expense.note) === "seguinte",
    variable: isVariableNote(expense.note),
    canEdit: editable(),
  };
  state.error = "";
  render();
}

export function closeExpenseInfo() {
  state.expenseInfo = null;
  render();
}

export function openCloseLiving(expense) {
  const balance = livingBalance(expense);
  state.expenseInfo = null;
  state.sheet = {
    mode: "close-living",
    id: expense.id,
    name: expense.name,
    planned: expense.amountCents,
    already: balance.spent,
    pix: balance.pix,
    credit: balance.credit,
    partials: expense.partials || [],
  };
  state.error = "";
  render();
}

export async function reopenLivingExpense(expense) {
  if (!expense?.id) return;
  state.expenseInfo = null;
  await patchExpense(expense, { paid: false });
  if (!state.error && state.data) {
    rememberMonth(state.data);
    state.notice = `“${expense.name}” reaberta neste mês.`;
    renderSafely();
  }
}

function openPartialPayment(info) {
  state.expenseInfo = null;
  const already = (info.partials || []).reduce((sum, item) => sum + item.amountCents, 0);
  const baseMonth = info.monthId || state.monthId;
  const nextId = nextMonthId(baseMonth);
  const hasNext = (state.data?.months || []).some((month) => month.id === nextId);
  state.sheet = {
    mode: "partial",
    id: info.id,
    name: info.name,
    amount: "",
    payment: "pix",
    cardLabel: firstCardName(),
    billing: "once",
    installmentCount: "2",
    invoiceMonthId: info.nextInvoice && hasNext ? nextId : baseMonth,
    variable: Boolean(info.variable),
    planned: info.amountCents || 0,
    already,
    closeAfter: "open",
  };
  state.error = "";
  render();
}

function undoPaymentsDraft(expense) {
  const partials = [...(expense.partials || [])].sort((left, right) => {
    const byTime = String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
    if (byTime) return byTime;
    return String(right.id || "").localeCompare(String(left.id || ""));
  });
  return {
    mode: "undo-payments",
    id: expense.id,
    name: expense.name,
    paid: Boolean(expense.paid),
    payment: "pix",
    amountCents: expense.amountCents,
    partials,
  };
}

function openUndoPayments(expense) {
  if (!expense) return;
  state.expenseInfo = null;
  state.sheet = undoPaymentsDraft(expense);
  state.error = "";
  render();
}

export function paymentEntries(draft) {
  const partials = draft.partials || [];
  if (partials.length) return partials.map((partial) => ({ ...partial, synthetic: false }));
  if (!draft.paid) return [];
  return [{
    id: "",
    amountCents: draft.amountCents,
    payment: "pix",
    cardLabel: null,
    installment: null,
    createdAt: "",
    synthetic: true,
  }];
}

export function paymentEntryLine(entry) {
  const when = entry.createdAt ? passkeyWhen(entry.createdAt) : "";
  return [partialLine(entry), when].filter(Boolean).join(" · ");
}

export async function removePartial(expenseId, partialId) {
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    state.data = await request(`/api/expenses/${expenseId}/partials/${partialId}`, { method: "DELETE" });
    rememberMonth(state.data);
    const expense = (state.data.expenses || []).find((item) => item.id === expenseId);
    const backToUndo = state.sheet?.mode === "undo-payments" && state.sheet.id === expenseId;
    if (backToUndo) {
      state.sheet = expense && ((expense.partials || []).length || expense.paid) ? undoPaymentsDraft(expense) : null;
    } else if (expense) {
      openExpenseInfo(expense, "fixed");
    } else {
      state.expenseInfo = null;
    }
    state.notice = "Lançamento excluído.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export async function undoPayments(expenseId, scope) {
  state.error = "";
  setWorking(true, scope === "all" ? "Desfazendo todos..." : "Desfazendo...");
  try {
    state.data = await request(`/api/expenses/${expenseId}/payments?scope=${scope}`, { method: "DELETE" });
    rememberMonth(state.data);
    const expense = (state.data.expenses || []).find((item) => item.id === expenseId);
    const name = state.sheet?.name || expense?.name || "despesa";
    if (state.sheet?.mode === "undo-payments" && expense && ((expense.partials || []).length || expense.paid)) {
      state.sheet = undoPaymentsDraft(expense);
    } else if (state.sheet?.mode === "undo-payments") {
      state.sheet = null;
    }
    state.notice = scope === "all"
      ? `Desfiz todos os lançamentos de “${name}”.`
      : `Desfiz o último lançamento de “${name}”.`;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export function expenseInfoDialog() {
  const info = state.expenseInfo;
  const lines = [];
  if (info.mirror) {
    const card = info.cardName ? ` no cartão ${info.cardName}` : " no cartão";
    const otherCharges = (info.charges || []).filter((item) => item?.monthId && info.monthId && item.monthId !== info.monthId);
    if (info.invoiceMonth && info.monthId && info.invoiceMonth !== info.monthId) {
      lines.push(`Este gasto pertence ao orçamento de ${monthName(info.monthId)}, mas foi lançado${card} na fatura de ${monthName(info.invoiceMonth)}. Ele aparece aqui como demonstrativo e não soma duas vezes.`);
    } else if (otherCharges.length) {
      const targetMonths = [...new Set(otherCharges.map((item) => monthName(item.monthId)))].join(", ");
      lines.push(`Este custo de vida pertence a ${monthName(info.monthId)}, mas foi lançado${card} na fatura de ${targetMonths}. Ele aparece aqui como demonstrativo e não soma duas vezes.`);
    } else {
      lines.push(`Este valor foi lançado${card} na fatura de ${monthName(info.monthId)}. Ele aparece nesta aba como um demonstrativo, para o seu controle. Não soma duas vezes: a cobrança entra só na fatura do cartão.`);
    }
  } else {
    lines.push(...[info.payment, info.status, info.installment].filter(Boolean));
    if (info.living && info.paid) {
      lines.push(`Custo atual consolidado neste mês: ${money(info.spentCents || 0)}.`);
    } else if (info.living && !info.paid && info.paymentKind === "card" && info.nextInvoice) {
      lines.push(`Previsto para entrar na fatura de ${monthName(nextMonthId(info.monthId))}.`);
    }
    if (info.section === "card" && info.refMonth && info.monthId && info.refMonth !== info.monthId) {
      lines.push(`Gasto referente a ${monthName(info.refMonth)}, cobrado nesta fatura de ${monthName(info.monthId)}.`);
    }
  }
  if (info.note) lines.push(info.note);
  const tail = [];
  if (info.partials?.length) {
    lines.push(info.paid
      ? "Lançamentos desta despesa:"
      : "Lançamentos parciais, a despesa continua em aberto:");
  }
  if (info.registered) tail.push(`Cadastrado em ${info.registered}.`);
  if (info.canEdit) {
    tail.push(onDesktop()
      ? "Para editar ou excluir, use os botões ao lado do lançamento."
      : "Para editar ou excluir, arraste o card para a esquerda.");
  }
  const partialItems = (info.partials || []).map((partial) => el("div", { class: "partial-line" }, [
    el("span", {}, partialLine(partial)),
    info.canEdit && info.living
      ? el("button", {
        class: "linkish",
        type: "button",
        onclick: () => removePartial(info.id, partial.id),
      }, "Desfazer")
      : "",
  ]));
  const dialogActions = [
    info.canEdit && info.living && (info.partials?.length || (info.paid && !info.zeroFinalized))
      ? el("button", {
        class: "secondary",
        type: "button",
        onclick: () => openUndoPayments((state.data?.expenses || []).find((item) => item.id === info.id)),
      }, "Desfazer lançamentos")
      : null,
    info.canEdit && info.living && !info.paid
      ? el("button", { class: "primary", type: "button", onclick: () => openPartialPayment(info) }, "Lançar pagamento")
      : null,
  ].filter(Boolean);
  const overlay = el("div", {
    class: "overlay center",
    "data-key": "expense-info",
    role: "presentation",
    onclick: (event) => {
      if (event.target === event.currentTarget) closeExpenseInfo();
    },
  }, [
    el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "expense-info-title", tabindex: "-1" }, [
      el("button", { class: "dialog-close", type: "button", "aria-label": "Fechar", onclick: closeExpenseInfo }, "×"),
      el("h2", { id: "expense-info-title" }, info.name),
      el("p", { class: "money inline" }, info.amount),
      ...lines.filter(Boolean).map((line) => el("p", {}, line)),
      partialItems.length ? el("div", { class: "partial-list" }, partialItems) : "",
      ...tail.map((line) => el("p", {}, line)),
      dialogActions.length ? el("div", { class: "actions" }, dialogActions) : "",
    ]),
  ]);
  return overlay;
}

export function linkedLivingCost(expense) {
  return expense.section === "fixed" && expense.onCard && linkedInvoice(expense);
}

export function linkedInvoice(expense) {
  return (state.data?.expenses || []).some((item) => originIdFrom(item.note) === expense.id);
}

export function openUndoCard(expense) {
  state.expenseInfo = null;
  state.sheet = {
    mode: "undo-card",
    id: expense.id,
    name: expense.name,
    scope: "month",
  };
  state.error = "";
  render();
}
