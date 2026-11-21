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
  formSection,
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

export function openCardExpense(cardName = "") {
  const cards = state.data?.cards ?? [];
  if (!cards.length) {
    state.error = "Adicione um cartão antes de lançar o gasto.";
    openCreateCard();
    return;
  }
  const selected = cards.some((card) => card.name === cardName) ? cardName : (cards.length === 1 ? cards[0].name : "");
  const card = cards.find((item) => item.name === selected) || null;
  const purchaseDate = localToday();
  const fallbackMonth = (state.data?.months || []).some((month) => month.id === purchaseDate.slice(0, 7))
    ? purchaseDate.slice(0, 7)
    : state.monthId;
  state.sheet = {
    mode: "card-spend",
    name: "",
    amount: "",
    cardLabel: selected,
    expenseKind: "",
    purchaseDate,
    invoiceMonthId: fallbackMonth,
    invoiceTouched: false,
    costMonthId: fallbackMonth,
    costTouched: false,
    showCostMonth: false,
    linkExpenseId: "",
    billing: "once",
    installmentCount: "2",
    installmentsPaid: "0",
    amountMode: "installment",
  };
  applyInvoiceSuggestion(state.sheet, card, { silent: true });
  state.error = "";
  render();
}

export function applyInvoiceSuggestion(draft, card = null, { silent = false } = {}) {
  const chosen = card || (state.data?.cards || []).find((item) => item.name === draft.cardLabel) || null;
  const suggested = suggestedInvoiceMonth(draft.purchaseDate, chosen?.closingDay ?? null, chosen?.dueDay ?? null);
  draft.suggestedMonthId = suggested;
  const known = (state.data?.months || []).some((month) => month.id === suggested);
  if (!draft.invoiceTouched && known && draft.invoiceMonthId !== suggested) {
    draft.invoiceMonthId = suggested;
  }
  if (!draft.costTouched && known && draft.costMonthId !== suggested) {
    useCostMonth(draft, suggested, false, { silent });
  }
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
  if (draft.mode === "card-spend") {
    return links.length
      ? "Selecione o custo previsto da lista. O valor entra na fatura escolhida e abate este custo."
      : `Não há custo de vida em aberto em ${label}. Cadastre o previsto em Custo de vida ou escolha outro mês.`;
  }
  return links.length
    ? "A lista é do mês do custo de vida. Se vincular, o previsto continua nesse mês e este valor entra na fatura escolhida."
    : `Não há custo de vida em aberto em ${label}.`;
}

export function paintLivingLinks(draft) {
  const select = document.getElementById("linkExpenseId");
  const status = document.getElementById("link-status");
  if (!select || !status || state.sheet !== draft) return false;
  const waiting = Boolean(draft.linkLoading);
  const links = waiting ? [] : (knownLinks(draft) || []);
  const blank = draft.mode === "edit"
    ? "Sem vínculo (custo próprio)"
    : "Escolha o custo";
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
    label.textContent = draft.mode === "edit"
      ? `Vincular a um custo previsto de ${name}`
      : `Custo de vida de ${name}`;
  }
  status.textContent = livingLinkStatus(draft);
  return true;
}

export function livingLinkSelect(draft) {
  const waiting = Boolean(draft.linkLoading);
  const links = waiting ? [] : (knownLinks(draft) || []);
  const blank = draft.mode === "edit"
    ? "Sem vínculo (custo próprio)"
    : "Escolha o custo";
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

function useCostMonth(draft, monthId, manual = false, { silent = false } = {}) {
  if (manual) draft.costTouched = true;
  if (draft.costMonthId === monthId) return;
  draft.costMonthId = monthId;
  draft.linkExpenseId = "";
  draft.linkChoices = null;
  draft.linkKey = "";
  draft.linkLoading = "";
  draft.linkError = "";
  if (draft.expenseKind === "casa") ensureLinkChoices(draft);
  if (silent) return;
  const budgetLabel = document.getElementById("budget-month-label");
  if (budgetLabel) budgetLabel.textContent = `Contabilizado no orçamento de ${monthName(monthId) || "este mês"}.`;
  const select = document.getElementById("costMonthId");
  if (select && select.value !== monthId) select.value = monthId;
  if (draft.expenseKind === "casa" && !paintLivingLinks(draft)) render();
}

function invoiceHint(draft) {
  const card = (state.data?.cards || []).find((item) => item.name === draft.cardLabel) || null;
  if (!card) return "Escolha um cartão para sugerir o mês da fatura conforme o fechamento.";
  const suggested = draft.suggestedMonthId || "";
  const knownSuggestion = (state.data?.months || []).some((month) => month.id === suggested);
  if (!card.closingDay) return "Este cartão ainda não tem dia de fechamento. A sugestão fica no mês da compra e você pode escolher outra fatura.";
  if (!knownSuggestion) return `O fechamento sugere ${monthName(suggested) || suggested}, que está fora do período.`;
  if (draft.invoiceTouched) return "Você escolheu a fatura manualmente.";
  if (card.dueDay && card.closingDay > card.dueDay) {
    return `Sugerido pelo fechamento no dia ${card.closingDay} (vencimento dia ${card.dueDay}). Dá para escolher outra fatura.`;
  }
  return `Sugerido pelo fechamento no dia ${card.closingDay}. Dá para escolher outra fatura.`;
}

export function refreshInvoiceChoice(draft) {
  const invoice = document.getElementById("invoiceMonthId");
  const hint = document.getElementById("invoice-hint");
  if (!invoice || !hint) return false;
  if (draft.invoiceMonthId) invoice.value = draft.invoiceMonthId;
  hint.textContent = invoiceHint(draft);
  const costSelect = document.getElementById("costMonthId");
  if (costSelect && draft.costMonthId) costSelect.value = draft.costMonthId;
  const budgetLabel = document.getElementById("budget-month-label");
  if (budgetLabel) budgetLabel.textContent = `Contabilizado no orçamento de ${monthName(draft.costMonthId || state.monthId) || "este mês"}.`;
  const preview = document.getElementById("installment-preview");
  if (preview) preview.textContent = installmentPreview(draft);
  return true;
}

export function cardSpendFields(draft, { onDelete = null } = {}) {
  const editing = draft.mode === "edit";
  const months = state.data?.months || [];
  const kind = draft.expenseKind || "";
  const hasKind = kind === "casa" || kind === "planejado" || kind === "imprevisto";
  const isLiving = kind === "casa";
  if (isLiving) {
    if (!draft.costMonthId) draft.costMonthId = draft.invoiceMonthId || state.monthId;
    ensureLinkChoices(draft);
  }

  const classificationSection = formSection("Classificação", [
    el("div", { class: "field" }, [
      segmented("expenseKind", [
        ["casa", "Custo de vida"],
        ["planejado", "Planejado"],
        ["imprevisto", "Imprevisto"],
      ], kind, {
        layout: "triple",
        tones: { casa: "fixed", planejado: "planned", imprevisto: "extra" },
      }),
    ]),
  ], "card-spend-kind");

  if (!editing && !hasKind) {
    return [
      el("h2", {}, "Gasto no crédito"),
      classificationSection,
      el("div", { class: "form-empty-step", "data-key": "card-spend-pick-kind" }, [
        el("strong", {}, "Escolha a classificação para continuar"),
        el("p", { class: "muted" }, "Selecione Custo de vida, Planejado ou Imprevisto acima para preencher o restante do lançamento."),
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Lançando..." : "Lançar"),
      ]),
    ];
  }

  const handleDateChange = (event) => {
    draft.purchaseDate = event.currentTarget.value;
    applyInvoiceSuggestion(draft);
    if (!refreshInvoiceChoice(draft)) render();
  };
  const date = el("input", { id: "purchaseDate", type: "date", value: draft.purchaseDate || "" });
  on(date, "input", handleDateChange);
  on(date, "change", handleDateChange);

  const invoice = el("select", { id: "invoiceMonthId" }, months.map((month) => el("option", { value: month.id }, month.label)));
  if (draft.invoiceMonthId) invoice.value = draft.invoiceMonthId;
  on(invoice, "change", (event) => {
    draft.invoiceMonthId = event.currentTarget.value;
    draft.invoiceTouched = true;
    if (!draft.costTouched && months.some((month) => month.id === draft.invoiceMonthId)) {
      useCostMonth(draft, draft.invoiceMonthId, false);
    }
    refreshInvoiceChoice(draft);
  });

  const costMonth = el("select", { id: "costMonthId" }, months.map((month) => el("option", { value: month.id }, month.label)));
  costMonth.value = draft.costMonthId || draft.invoiceMonthId || state.monthId;
  on(costMonth, "change", (event) => useCostMonth(draft, event.currentTarget.value, true));

  const parcelado = draft.billing === "installments";
  const amountName = parcelado && draft.amountMode === "total" ? "Valor da compra" : parcelado ? "Valor da parcela" : "Valor";
  const costLabel = monthName(draft.costMonthId || draft.invoiceMonthId || state.monthId) || "este mês";
  const showBudgetMonth = isLiving || draft.showCostMonth || draft.costTouched;

  const amountFields = [
    !isLiving
      ? field("Nome", "name", draft.name, "text", kind === "planejado" ? "Ex.: Viagem, presente, curso..." : "Ex.: Farmácia, oficina, café...")
      : "",
    field(amountName, "amount", draft.amount, "decimal", "0,00"),
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
    parcelado ? el("p", { class: "muted form-hint", id: "installment-preview" }, installmentPreview(draft)) : "",
  ];

  const livingSection = isLiving
    ? formSection("Custo de vida", [
      el("div", { class: "field" }, [
        el("label", { for: "costMonthId" }, "Custo de vida de"),
        costMonth,
      ]),
      el("div", { class: "field" }, [
        el("label", { id: "link-label", for: "linkExpenseId" }, editing ? `Vincular a um custo previsto de ${costLabel}` : `Custo de vida de ${costLabel}`),
        livingLinkSelect(draft),
        el("p", { class: "muted form-hint link-status", id: "link-status" }, livingLinkStatus(draft)),
      ]),
    ], "card-spend-living")
    : "";

  const detailsSection = formSection(isLiving ? "Valor e parcelamento" : "Detalhes do gasto", amountFields, "card-spend-details");

  const cardAndInvoiceSection = formSection("Cartão e fatura", [
    cardSelect(draft),
    el("div", { class: "pair" }, [
      el("div", { class: "field" }, [el("label", { for: "purchaseDate" }, "Data da compra"), date]),
      el("div", { class: "field" }, [el("label", { for: "invoiceMonthId" }, "Entra na fatura de"), invoice]),
    ]),
    el("p", { class: "muted form-hint", id: "invoice-hint" }, invoiceHint(draft)),
    !isLiving
      ? (showBudgetMonth
        ? el("div", { class: "field form-budget-field" }, [
          el("label", { for: "costMonthId" }, kind === "planejado" ? "Mês do orçamento (Planejado)" : "Mês do orçamento (Imprevisto)"),
          costMonth,
        ])
        : el("div", { class: "form-inline-row" }, [
          el("span", { class: "muted", id: "budget-month-label" }, `Contabilizado no orçamento de ${costLabel}.`),
          el("button", {
            type: "button",
            class: "linkish form-inline-btn",
            onclick: () => {
              draft.showCostMonth = true;
              render();
            },
          }, "Mudar mês do orçamento"),
        ]))
      : "",
  ], "card-spend-invoice");

  const noteSection = editing
    ? formSection("Observação", [field("Observação", "note", draft.note || "", "text", "Opcional")], "card-spend-note")
    : "";

  return [
    el("h2", {}, editing ? "Editar gasto no crédito" : "Gasto no crédito"),
    classificationSection,
    livingSection,
    detailsSection,
    cardAndInvoiceSection,
    noteSection,
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
    costTouched: fromCard || Boolean(refMonth && costMonthId !== expense.monthId),
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
  if (fromCard) applyInvoiceSuggestion(state.sheet, null, { silent: true });
  state.error = "";
  render();
}

export function closeSheet() {
  state.sheet = null;
  state.accountMenu = false;
  state.error = "";
  render();
}
