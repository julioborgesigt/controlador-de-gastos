import { dueDatePassed, invoiceDueDate } from "../../card-due.js";
import { extraOnOwnInvoice, money, parseMoney } from "../../format.js";
import { rememberMonth, request } from "../api.js";
import { pulseResetConfirm } from "../dialogs/confirm.js";
import { linkedLivingCost } from "../dialogs/expense-info.js";
import {
  el,
  formatDueDate,
  localToday,
  messageOf,
  monthPhrase,
} from "../dom.js";
import {
  editable,
  render,
  renderSafely,
  setWorking,
  state,
} from "../state.js";
import { swipeRow } from "../swipe.js";

export function cardDueDay(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const day = Number(text);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("O vencimento é um dia de 1 a 31.");
  return day;
}

export function cardClosingDay(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const day = Number(text);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("O fechamento é um dia de 1 a 31.");
  return day;
}

export function monthInvoicesSettled(data) {
  const cards = data.cards || [];
  let any = false;
  let open = openCardBalance(unassignedCardExpenses(data.expenses, cards));
  for (const card of cards) {
    const list = expensesForCardName(data.expenses, card.name);
    if (cardInvoiceCents(data.expenses, card.name) <= 0) continue;
    any = true;
    open += openCardBalance(list);
  }
  return any && open === 0;
}

function cardBadgeGlyph() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.9");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 7h18v10H3zM3 11h18M7 14h4");
  svg.append(path);
  return svg;
}

export function cardManageRow(card, amount, expenses) {
  const count = expenses.filter((expense) => shownExpense(expense) && !linkedLivingCost(expense)).length;
  const balance = openCardBalance(expenses);
  const settled = amount > 0 && balance === 0;
  const tone = settled ? " paid" : amount > 0 ? " open" : " idle";
  const front = el("article", { class: `jump card-manage${tone}` }, [
    el("button", { type: "button", class: "item-main", onclick: () => openCard(card.id) }, [
      el("div", { class: "row-between" }, [
        el("span", { class: "card-title-wrap" }, [
          el("span", { class: "card-chip-icon", "aria-hidden": "true" }, cardBadgeGlyph()),
          el("span", { class: "card-title" }, card.name),
        ]),
        el("div", { class: "item-end" }, [
          amount > 0 ? el("span", { class: settled ? "badge paid" : "badge open" }, settled ? "Pago" : "Em aberto") : "",
          el("strong", { class: "amount" }, money(amount)),
        ]),
      ]),
      el("small", {}, [card.closingDay ? `Fecha dia ${card.closingDay}` : "", card.dueDay ? `Vence dia ${card.dueDay}` : "", count === 0 ? "Nenhum gasto neste mês" : `${count} ${count === 1 ? "gasto" : "gastos"}`].filter(Boolean).join(" · ")),
    ]),
  ]);
  if (!editable()) return front;
  const leads = balance > 0 ? [
    { label: "Pago\nno Pix", tone: "pay", run: () => payCardPix(card) },
    { label: "Pago\nparcelado", tone: "send", run: () => openCardPayoff(card, balance) },
  ] : settled ? [
    { label: "Desfazer", tone: "undo", commit: true, run: () => askUndoCardPayment(card) },
  ] : null;
  return swipeRow(front, {
    card: true,
    leads,
    actions: [
      { label: "Editar", tone: "edit", run: () => openEditCard(card) },
      {
        label: "Excluir",
        tone: "delete",
        title: "Excluir cartão",
        run: () => askDeleteCard(card),
      },
    ],
  });
}

function openEditCard(card) {
  state.error = "";
  state.sheet = { mode: "card", id: card.id, name: card.name, dueDay: card.dueDay ? String(card.dueDay) : "", closingDay: card.closingDay ? String(card.closingDay) : "", previousName: card.name };
  render();
}

function askDeleteCard(card) {
  state.accountMenu = false;
  state.error = "";
  state.confirmCard = card;
  state.confirm = "delete-card";
  state.resetReadyAt = Date.now() + 5000;
  render();
  pulseResetConfirm();
}

export async function removeCard(card) {
  if (!card?.id) return;
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    const query = state.monthId ? `?monthId=${encodeURIComponent(state.monthId)}` : "";
    const data = await request(`/api/cards/${card.id}${query}`, { method: "DELETE" });
    if (data?.month?.id) {
      state.data = data;
      rememberMonth(data);
    } else if (Array.isArray(data?.cards)) {
      state.data.cards = data.cards;
    }
    if (state.cardFocus === card.id) state.cardFocus = null;
    state.notice = `Cartão “${card.name}” excluído permanentemente.`;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export function sameCardName(left, right) {
  return String(left || "").trim().toLocaleLowerCase("pt-BR") === String(right || "").trim().toLocaleLowerCase("pt-BR");
}

export function pastDueWarning(cardName, monthId) {
  const card = (state.data?.cards || []).find((item) => sameCardName(item.name, cardName));
  if (!card?.dueDay || !monthId) return null;
  const due = invoiceDueDate(monthId, card.dueDay);
  if (!due || !dueDatePassed(monthId, card.dueDay, localToday())) return null;
  return {
    key: `${card.name}|${monthId}|${due}`,
    body: `O ${card.name} vence dia ${card.dueDay}. A fatura de ${monthPhrase(monthId)} venceu em ${formatDueDate(due)}. Quer registrar mesmo assim?`,
  };
}

export function acceptPastDue(warning) {
  if (!warning) return true;
  if (state.sheet?.acceptedDueKey === warning.key) return true;
  state.pastDue = warning;
  state.confirm = "past-due";
  return false;
}

export function cardJump(name, amount, expenses, onclick) {
  const count = expenses.filter((expense) => shownExpense(expense) && !linkedLivingCost(expense)).length;
  return el("button", { class: "jump", type: "button", onclick }, [
    el("div", { class: "row-between" }, [el("span", {}, name), el("strong", {}, money(amount))]),
    el("small", {}, count === 0 ? "Nenhum gasto neste mês" : `${count} ${count === 1 ? "gasto" : "gastos"}`),
  ]);
}

export function openCard(cardId) {
  state.cardFocus = cardId;
  state.showEmpty = false;
  state.error = "";
  render();
}

export function shownExpense(expense) {
  return state.showEmpty || expense.amountCents !== 0 || expense.source === "user";
}

export function fixedOnCard(expense) {
  return expense.section === "fixed" && expense.onCard;
}

export function cardMirror(expense, section) {
  if (fixedOnCard(expense) && (section === "fixed" || section === "card")) return true;
  return section === "extra" && expense.section === "extra" && expense.payment === "card";
}

function expenseBelongsToCard(expense) {
  return expense.section === "card" || extraOnOwnInvoice(expense) || fixedOnCard(expense);
}

function cardKey(value) {
  const trimmed = String(value || "").trim().slice(0, 40);
  return trimmed ? trimmed.toLocaleLowerCase("pt-BR") : "";
}

export function expensesForCardName(expenses, cardName) {
  const key = cardKey(cardName);
  if (!key) return [];
  return expenses.filter((expense) => expenseBelongsToCard(expense) && cardKey(expense.cardLabel) === key);
}

export function openCardBalance(expenses) {
  return expenses
    .filter((expense) => !fixedOnCard(expense) && !expense.paid && expense.amountCents > 0)
    .reduce((sum, expense) => sum + expense.amountCents, 0);
}

function askUndoCardPayment(card) {
  state.accountMenu = false;
  state.error = "";
  state.confirmTarget = card;
  state.confirm = "undo-card-payment";
  render();
}

export function undoCardPayment(card) {
  if (!card?.id) return Promise.resolve();
  state.error = "";
  setWorking(true, "Desfazendo...");
  return request(`/api/cards/${card.id}/payoff`, {
    method: "POST",
    body: { mode: "undo", monthId: state.monthId },
  }).then((data) => {
    state.data = data;
    rememberMonth(data);
    state.notice = `Pagamento de ${card.name} desfeito.`;
  }).catch((error) => {
    state.error = messageOf(error);
  }).finally(() => {
    setWorking(false);
    renderSafely();
  });
}

function payCardPix(card) {
  state.error = "";
  setWorking(true, "Quitando...");
  request(`/api/cards/${card.id}/payoff`, {
    method: "POST",
    body: { mode: "pix", monthId: state.monthId },
  }).then((data) => {
    state.data = data;
    rememberMonth(data);
    state.notice = `Fatura de ${card.name} paga no Pix.`;
  }).catch((error) => {
    state.error = messageOf(error);
  }).finally(() => {
    setWorking(false);
    renderSafely();
  });
}

function openCardPayoff(card, balance) {
  const months = state.data?.months || [];
  const index = months.findIndex((month) => month.id === state.monthId);
  state.sheet = {
    mode: "card-payoff",
    cardId: card.id,
    cardName: card.name,
    balance,
    down: "",
    count: "2",
    per: "",
    startMonthId: months[index + 1]?.id || state.monthId,
  };
  state.error = "";
  render();
}

export function cardPayoffPreview(draft) {
  const down = parseMoney(draft.down || "") ?? 0;
  const count = Number(draft.count);
  const per = parseMoney(draft.per || "");
  if (down < 0 || down >= draft.balance) return "A entrada fica em branco quando não houver, e precisa ser menor que a fatura.";
  const financed = draft.balance - down;
  if (!Number.isInteger(count) || count < 2 || per === null || per <= 0) {
    return `Falta parcelar ${money(financed)}.`;
  }
  const base = Math.floor(financed / count);
  const remainder = financed - base * count;
  if (per * count === financed) return `${count} parcelas de ${money(per)} fecham os ${money(financed)}.`;
  if (per === base && remainder > 0 && remainder < count) {
    return `${count - 1} parcelas de ${money(per)} e a última de ${money(per + remainder)}.`;
  }
  return `As parcelas não fecham com ${money(financed)}.`;
}

export function cardInvoiceCents(expenses, cardName) {
  return expensesForCardName(expenses, cardName)
    .filter((expense) => !fixedOnCard(expense))
    .reduce((sum, expense) => sum + expense.amountCents, 0);
}

export function unassignedCardExpenses(expenses, cards) {
  const keys = new Set(cards.map((card) => cardKey(card.name)).filter(Boolean));
  return expenses.filter((expense) => {
    if (!expenseBelongsToCard(expense)) return false;
    const key = cardKey(expense.cardLabel);
    return !key || !keys.has(key);
  });
}

export function firstCardName() {
  return state.data?.cards?.[0]?.name || "";
}

export function openCreateCard() {
  state.sheet = { mode: "card", id: "", name: "", dueDay: "", closingDay: "", previousName: "" };
  render();
}
