import { suggestedInvoiceMonth } from "../../card-due.js";
import {
  centsToInput,
  invoiceShift,
  isPlannedNote,
  isVariableNote,
  money,
  originIdFrom,
  partialIdFrom,
  seriesIdFrom,
  visibleNote,
} from "../../format.js";
import { noteMarker, referenceMonthFrom } from "../../shared/note-markers.js";
import { ensureLinkChoices, knownLinks, linkMonthId } from "../api.js";
import { el, localToday, monthName, on } from "../dom.js";
import { render, state } from "../state.js";
import { firstCardName, openCreateCard } from "../views/card-helpers.js";
import { cardTrack } from "../views/expenses.js";
import {
  cardSelect,
  field,
  installmentDraft,
  installmentPreview,
  segmented,
} from "./fields.js";

export function openCreate(section, payment, kind = "imprevisto") {
  state.sheet = {
    mode: "create",
    cardExpense: false,
    id: "",
    name: "",
    amount: "",
    section,
    payment,
    onCard: false,
    cardLabel: payment === "card" ? firstCardName() : "",
    note: "",
    installment: "",
    installmentCount: "1",
    installmentsPaid: "0",
    amountMode: "installment",
    invoiceMonthId: section === "extra" ? state.monthId : "",
    repeat: "all",
    span: "all",
    spanChosen: false,
    repeatStart: state.monthId,
    repeatEnd: (state.data?.months || []).at(-1)?.id || state.monthId,
    cardLaunch: "month",
    costKind: "fixo",
    invoiceTiming: "mes",
    expenseKind: kind === "planejado" ? "planejado" : "imprevisto",
    paid: false,
    source: "user",
  };
  state.error = "";
  state.notice = "";
  render();
}

export function openCardExpense(cardName = "", kind = "imprevisto") {
  const cards = state.data?.cards ?? [];
  if (!cards.length) {
    state.error = "Adicione um cartão antes de lançar o gasto.";
    openCreateCard();
    return;
  }
  const selected = cards.some((card) => card.name === cardName) ? cardName : (cards.length === 1 ? cards[0].name : "");
  const card = cards.find((item) => item.name === selected) || null;
  const purchaseDate = localToday();
  state.sheet = {
    mode: "card-spend",
    name: "",
    amount: "",
    cardLabel: selected,
    expenseKind: kind === "planejado" || kind === "casa" ? kind : "imprevisto",
    purchaseDate,
    invoiceMonthId: state.monthId,
    invoiceTouched: false,
    costMonthId: (state.data?.months || []).some((month) => month.id === purchaseDate.slice(0, 7)) ? purchaseDate.slice(0, 7) : state.monthId,
    costTouched: false,
    showCostMonth: false,
    linkExpenseId: "",
    billing: "once",
    installmentCount: "2",
    installmentsPaid: "0",
    amountMode: "installment",
  };
  applyInvoiceSuggestion(state.sheet, card);
  state.error = "";
  render();
}

export function applyInvoiceSuggestion(draft, card = null) {
  const chosen = card || (state.data?.cards || []).find((item) => item.name === draft.cardLabel) || null;
  const suggested = suggestedInvoiceMonth(draft.purchaseDate, chosen?.closingDay ?? null);
  draft.suggestedMonthId = suggested;
  if (draft.invoiceTouched) return;
  const known = (state.data?.months || []).some((month) => month.id === suggested);
  if (!known || draft.invoiceMonthId === suggested) return;
  draft.invoiceMonthId = suggested;
}

export function matchesLink(expense, kind) {
  if (expense.paid) return false;
  if (kind === "casa") return expense.section === "fixed" && !expense.onCard;
  if (kind === "planejado") return expense.section === "extra" && isPlannedNote(expense.note);
  return expense.section === "extra" && !isPlannedNote(expense.note);
}

export function livingCostsForInvoice(monthId, kind = "casa") {
  return (state.data?.expenses || []).filter((expense) => expense.monthId === monthId && matchesLink(expense, kind));
}

export function livingLinkStatus(draft) {
  const label = monthName(linkMonthId(draft)) || "este mês";
  if (draft.linkLoading) return `Carregando os custos de vida de ${label}.`;
  if (draft.linkError) return draft.linkError;
  const links = knownLinks(draft) || [];
  if (draft.mode === "cash-spend") {
    return links.length
      ? "O Pix abate o custo previsto. O que faltar continua em falta no Pix ou no cartão, conforme o custo foi cadastrado."
      : `Não há custo de vida em aberto em ${label}. Cadastre o previsto em Custo de vida.`;
  }
  return links.length
    ? "A lista é do mês do custo de vida. Se vincular, o previsto continua nesse mês e este valor entra na fatura escolhida."
    : `Não há custo de vida em aberto em ${label}. O gasto cria um custo novo nesse mês.`;
}

export function paintLivingLinks(draft) {
  const select = document.getElementById("linkExpenseId");
  const status = document.getElementById("link-status");
  if (!select || !status || state.sheet !== draft) return false;
  const waiting = Boolean(draft.linkLoading);
  const links = waiting ? [] : (knownLinks(draft) || []);
  const blank = draft.mode === "cash-spend"
    ? "Escolha o custo"
    : draft.mode === "edit"
      ? "Sem vínculo (custo próprio)"
      : "Criar um custo novo";
  select.replaceChildren(
    el("option", { value: "" }, waiting ? "Carregando..." : blank),
    ...links.map((expense) => el("option", {
      value: expense.id,
    }, draft.mode === "cash-spend"
      ? `${expense.name} · ${money(expense.amountCents)}`
      : `${expense.name} · previsto ${money(expense.amountCents)}`)),
  );
  select.disabled = waiting;
  select.setAttribute("aria-busy", waiting ? "true" : "false");
  const selected = !waiting && links.some((expense) => expense.id === draft.linkExpenseId) ? draft.linkExpenseId : "";
  select.value = selected;
  draft.linkExpenseId = selected;
  const label = document.getElementById("link-label");
  if (label) {
    const name = monthName(linkMonthId(draft)) || "este mês";
    label.textContent = draft.mode === "cash-spend"
      ? `Custo de vida de ${name}`
      : `Vincular a um custo previsto de ${name}`;
  }
  status.textContent = livingLinkStatus(draft);
  return true;
}

export function livingLinkSelect(draft) {
  const waiting = Boolean(draft.linkLoading);
  const links = waiting ? [] : (knownLinks(draft) || []);
  const blank = draft.mode === "cash-spend"
    ? "Escolha o custo"
    : draft.mode === "edit"
      ? "Sem vínculo (custo próprio)"
      : "Criar um custo novo";
  const link = el("select", {
    id: "linkExpenseId",
    disabled: waiting ? "" : null,
    "aria-busy": waiting ? "true" : "false",
  }, [
    el("option", { value: "" }, waiting ? "Carregando..." : blank),
    ...links.map((expense) => el("option", {
      value: expense.id,
    }, draft.mode === "cash-spend"
      ? `${expense.name} · ${money(expense.amountCents)}`
      : `${expense.name} · previsto ${money(expense.amountCents)}`)),
  ]);
  link.value = !waiting && links.some((expense) => expense.id === draft.linkExpenseId) ? draft.linkExpenseId : "";
  on(link, "change", (event) => { draft.linkExpenseId = event.currentTarget.value; });
  return link;
}

function useCostMonth(draft, monthId, manual = false) {
  if (manual) draft.costTouched = true;
  if (draft.costMonthId === monthId) return;
  draft.costMonthId = monthId;
  draft.linkExpenseId = "";
  draft.linkChoices = null;
  draft.linkKey = "";
  draft.linkLoading = "";
  draft.linkError = "";
  ensureLinkChoices(draft);
  if (!paintLivingLinks(draft)) render();
}

function invoiceHint(draft) {
  const card = (state.data?.cards || []).find((item) => item.name === draft.cardLabel) || null;
  const suggested = draft.suggestedMonthId || "";
  const knownSuggestion = (state.data?.months || []).some((month) => month.id === suggested);
  if (!card?.closingDay) return "Este cartão ainda não tem dia de fechamento. A sugestão fica no mês da compra e você pode escolher outra fatura.";
  if (!knownSuggestion) return `O fechamento sugere ${monthName(suggested) || suggested}, que está fora do período.`;
  if (draft.invoiceTouched) return "Você escolheu a fatura manualmente.";
  return `Sugerido pelo fechamento no dia ${card.closingDay}. Dá para escolher outra fatura.`;
}

export function refreshInvoiceChoice(draft) {
  const invoice = document.getElementById("invoiceMonthId");
  const hint = document.getElementById("invoice-hint");
  if (!invoice || !hint) return false;
  if (draft.invoiceMonthId) invoice.value = draft.invoiceMonthId;
  hint.textContent = invoiceHint(draft);
  return true;
}

export function cardSpendFields(draft, { onDelete = null } = {}) {
  const editing = draft.mode === "edit";
  const months = state.data?.months || [];
  if (draft.expenseKind === "casa") {
    if (!draft.costMonthId) draft.costMonthId = state.monthId;
    ensureLinkChoices(draft);
  }
  const date = el("input", { id: "purchaseDate", type: "date", value: draft.purchaseDate || "" });
  on(date, "input", (event) => {
    draft.purchaseDate = event.currentTarget.value;
    applyInvoiceSuggestion(draft);
    if (!draft.costTouched) {
      const monthId = String(draft.purchaseDate || "").slice(0, 7);
      if ((state.data?.months || []).some((month) => month.id === monthId)) {
        useCostMonth(draft, monthId);
        const select = document.getElementById("costMonthId");
        if (select) select.value = monthId;
      }
    }
    if (!refreshInvoiceChoice(draft)) render();
  });
  const invoice = el("select", { id: "invoiceMonthId" }, months.map((month) => el("option", { value: month.id }, month.label)));
  if (draft.invoiceMonthId) invoice.value = draft.invoiceMonthId;
  on(invoice, "change", (event) => {
    draft.invoiceMonthId = event.currentTarget.value;
    draft.invoiceTouched = true;
    refreshInvoiceChoice(draft);
  });
  const costMonth = el("select", { id: "costMonthId" }, months.map((month) => el("option", { value: month.id }, month.label)));
  costMonth.value = draft.costMonthId || state.monthId;
  on(costMonth, "change", (event) => useCostMonth(draft, event.currentTarget.value, true));
  const parcelado = draft.billing === "installments";
  const amountName = parcelado && draft.amountMode === "total" ? "Valor da compra" : parcelado ? "Valor da parcela" : "Valor";
  const costLabel = monthName(draft.costMonthId || state.monthId) || "este mês";
  const showBudgetMonth = draft.expenseKind === "casa" || draft.showCostMonth || draft.costTouched;
  return [
    el("h2", {}, editing ? "Editar gasto no crédito" : "Gasto no crédito"),
    field("Nome", "name", draft.name, "text"),
    field(amountName, "amount", draft.amount, "decimal"),
    el("div", { class: "field" }, [
      el("label", {}, "Parcelamento"),
      segmented("billing", [["once", "À vista"], ["installments", "Parcelado"]], parcelado ? "installments" : "once"),
    ]),
    parcelado
      ? el("div", { class: "pair" }, [
        field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "2", "numeric"),
        field("Parcelas já pagas", "installmentsPaid", draft.installmentsPaid || "0", "numeric"),
      ])
      : "",
    parcelado
      ? el("div", { class: "field" }, [
        el("label", {}, "O valor informado é"),
        segmented("amountMode", [["installment", "Da parcela"], ["total", "Da compra toda"]], draft.amountMode === "total" ? "total" : "installment"),
      ])
      : "",
    parcelado ? el("p", { class: "muted", id: "installment-preview" }, installmentPreview(draft)) : "",
    cardSelect(draft),
    el("div", { class: "field" }, [
      el("label", {}, "Classificação"),
      segmented("expenseKind", [
        ["casa", "Custo de vida"],
        ["planejado", "Planejado"],
        ["imprevisto", "Imprevisto"],
      ], draft.expenseKind || "imprevisto"),
    ]),
    el("div", { class: "pair" }, [
      el("div", { class: "field" }, [el("label", { for: "purchaseDate" }, "Data da compra"), date]),
      el("div", { class: "field" }, [el("label", { for: "invoiceMonthId" }, "Entra na fatura de"), invoice]),
    ]),
    el("p", { class: "muted", id: "invoice-hint" }, invoiceHint(draft)),
    showBudgetMonth
      ? el("div", { class: "field" }, [
        el("label", { for: "costMonthId" }, draft.expenseKind === "casa" ? "Custo de vida de" : draft.expenseKind === "planejado" ? "Mês do orçamento (Planejado)" : "Mês do orçamento (Imprevisto)"),
        costMonth,
      ])
      : el("p", { class: "muted" }, [
        `Contabilizado no orçamento de ${costLabel}. `,
        el("button", {
          type: "button",
          class: "linkish",
          onclick: () => {
            draft.showCostMonth = true;
            render();
          },
        }, "Mudar mês do orçamento"),
      ]),
    draft.expenseKind === "casa"
      ? el("div", { class: "field" }, [
        el("label", { id: "link-label", for: "linkExpenseId" }, `Vincular a um custo previsto de ${costLabel}`),
        livingLinkSelect(draft),
        el("p", { class: "muted link-status", id: "link-status" }, livingLinkStatus(draft)),
      ])
      : "",
    editing ? field("Observação", "note", draft.note || "", "text", "Opcional") : "",
    el("div", { class: "actions" }, [
      el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
      el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? (editing ? "Salvando..." : "Lançando...") : (editing ? "Salvar" : "Lançar")),
    ]),
    editing && onDelete ? el("button", { class: "danger", type: "button", onclick: onDelete }, "Excluir gasto") : "",
  ];
}

export function openEdit(expense, options = {}) {
  const parts = installmentDraft(expense.installment);
  const purchaseDate = noteMarker(expense.note, "compra:") || "";
  const refMonth = referenceMonthFrom(expense.note) || (purchaseDate ? purchaseDate.slice(0, 7) : "");
  const knownMonths = state.data?.months || [];
  const costMonthId = refMonth && knownMonths.some((month) => month.id === refMonth) ? refMonth : expense.monthId;
  const fromCard = Boolean(options.fromCard);
  const track = fromCard ? (cardTrack(expense) || "imprevisto") : (isPlannedNote(expense.note) ? "planejado" : "imprevisto");
  state.sheet = {
    mode: "edit",
    cardExpense: Boolean(options.cardExpense),
    id: expense.id,
    name: expense.name,
    amount: centsToInput(expense.amountCents),
    section: expense.section,
    payment: expense.payment,
    onCard: expense.onCard,
    cardLabel: expense.cardLabel || "",
    note: visibleNote(expense.note),
    seriesId: seriesIdFrom(expense.note),
    variable: isVariableNote(expense.note),
    costKind: isVariableNote(expense.note) ? "variavel" : "fixo",
    invoiceTiming: invoiceShift(expense.note),
    fromCard,
    expenseKind: track,
    originalKind: fromCard ? track : "",
    originId: originIdFrom(expense.note),
    partialId: partialIdFrom(expense.note),
    linkExpenseId: originIdFrom(expense.note) || "",
    purchaseDate,
    invoiceMonthId: expense.monthId,
    invoiceTouched: true,
    suggestedMonthId: "",
    costMonthId,
    costTouched: Boolean(refMonth && costMonthId !== expense.monthId),
    showCostMonth: Boolean(refMonth && costMonthId !== expense.monthId),
    billing: Number(parts.installmentCount) > 1 ? "installments" : "once",
    installment: expense.installment || "",
    installmentCount: parts.installmentCount,
    installmentsPaid: parts.installmentsPaid,
    amountMode: "installment",
    paid: expense.paid,
    source: expense.source,
    wasOnCard: Boolean(expense.onCard),
    originalAmount: expense.amountCents,
    originalCard: expense.cardLabel || "",
    originalName: expense.name,
    monthId: expense.monthId,
    inOtherMonths: Boolean(expense.inOtherMonths),
    editScope: "month",
  };
  if (fromCard) applyInvoiceSuggestion(state.sheet);
  state.error = "";
  render();
}

export function closeSheet() {
  state.sheet = null;
  state.accountMenu = false;
  state.error = "";
  render();
}
