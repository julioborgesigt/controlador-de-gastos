import { amountLabel, el, on } from "../dom.js";
import { state } from "../state.js";
import { attachSheetDrag, isIgnoringSwipeClick } from "../swipe.js";
import { cashSpendFields } from "../views/cash.js";
import { openDeleteExpense } from "../views/expenses.js";
import {
  cardPurchaseFields,
  cardSelect,
  editScopeField,
  field,
  installmentPreview,
  invoiceMonthField,
  livingPay,
  recurringSpan,
  segmented,
} from "./fields.js";
import { cardSpendFields, closeSheet } from "./openers.js";
import { renderAccountSheet } from "./render-account.js";
import { renderPaymentSheet } from "./render-payments.js";
import { saveSheet } from "./save.js";

export function sheet() {
  const draft = state.sheet;
  const panel = el("form", { class: "sheet", role: "dialog", "aria-modal": "true", tabindex: "-1" }, [
    el("div", { class: "sheet-grab", "data-key": "sheet-grab" }, [el("div", { class: "handle" })]),
  ]);
  on(panel, "submit", saveSheet);
  attachSheetDrag(panel);
  if (state.error) panel.append(el("p", { class: "error", "data-key": "sheet-error" }, state.error));
  if (state.notice) panel.append(el("p", { class: "note", "data-key": "sheet-notice" }, state.notice));
  if (!renderAccountSheet(panel, draft) && !renderPaymentSheet(panel, draft)) {
  if (draft.fromCard && draft.mode === "edit") {
    panel.append(
      el("h2", {}, "Editar gasto do cartão"),
      field("Nome", "name", draft.name, "text"),
      field("Valor", "amount", draft.amount, "decimal"),
      el("div", { class: "field" }, [
        el("label", {}, "Tarja"),
        segmented("expenseKind", [
          ["imprevisto", "Imprevisto"],
          ["planejado", "Planejado"],
          ["casa", "Custo de vida"],
        ], draft.expenseKind || ""),
      ]),
      el("p", { class: "muted" }, "A tarja manda este lançamento para a aba correspondente. Ele continua neste cartão, no crédito."),
      cardSelect(draft),
      field("Observação", "note", draft.note, "text"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
      el("button", { class: "danger", type: "button", onclick: () => openDeleteExpense(draft) }, "Excluir gasto"),
    );
  } else if (draft.mode === "cash-spend") {
    panel.append(...cashSpendFields(draft).filter(Boolean));
  } else if (draft.mode === "card-spend") {
    panel.append(...cardSpendFields(draft).filter(Boolean));
  } else if (draft.mode === "card") {
    panel.append(
      el("h2", {}, draft.id ? "Editar cartão" : "Novo cartão"),
      field("Apelido", "name", draft.name, "text", "Nubank, Neon ou outro"),
      field("Dia de fechamento", "closingDay", draft.closingDay || "", "numeric", "1"),
      field("Dia de vencimento", "dueDay", draft.dueDay || "", "numeric", "10"),
      el("p", { class: "muted" }, "O fechamento sugere em qual fatura o gasto entra. O vencimento é o dia de pagar a fatura."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
    );
  } else {
    const needsCard = draft.cardExpense || draft.section === "card" || draft.payment === "card" || draft.onCard;
    const cardSpend = (draft.cardExpense && draft.mode === "create") || (draft.mode === "edit" && draft.section === "card");
    const recurring = draft.section === "fixed" && !cardSpend;
    const surprise = draft.section === "extra" && !cardSpend;
    const heading = cardSpend
      ? (draft.mode === "edit" ? "Editar gasto no crédito" : "Gasto no crédito")
      : recurring
        ? (draft.mode === "create" ? "Novo custo de vida" : "Editar custo de vida")
        : surprise
          ? (draft.expenseKind === "planejado"
          ? (draft.mode === "create" ? "Novo planejado" : "Editar planejado")
          : (draft.mode === "create" ? "Novo imprevisto" : "Editar imprevisto"))
          : (draft.mode === "create" ? "Novo gasto" : "Editar gasto");
    panel.append(
      el("h2", {}, heading),
      cardSpend
        ? el("div", { class: "field" }, [
          el("label", {}, "O valor informado é"),
          segmented("amountMode", [["installment", "Da parcela"], ["total", "Da compra toda"]], draft.amountMode || "installment"),
        ])
        : "",
      cardSpend
        ? el("div", { class: "pair" }, [
          field("Nome", "name", draft.name, "text"),
          field(draft.amountMode === "total" ? "Valor da compra" : "Valor da parcela", "amount", draft.amount, "decimal"),
        ])
        : field("Nome", "name", draft.name, "text"),
      surprise
        ? el("div", { class: "field" }, [
          el("label", {}, "Classificação"),
          segmented("expenseKind", [["imprevisto", "Imprevisto"], ["planejado", "Planejado"]], draft.expenseKind === "planejado" ? "planejado" : "imprevisto"),
        ])
        : "",
      surprise
        ? el("div", { class: "field" }, [
          el("label", {}, "Como foi pago"),
          segmented("payment", [["pix", "Pix"], ["card", "Crédito"]], draft.payment),
        ])
        : "",
      recurring ? livingPay(draft) : "",
      cardSpend ? "" : field(amountLabel(draft), "amount", draft.amount, "decimal"),
      recurring && draft.mode === "create" ? recurringSpan(draft) : "",
      cardSpend || recurring || surprise
        ? ""
        : el("div", { class: "field" }, [
          el("label", {}, "Tipo"),
          segmented("section", [
            ["extra", "Imprevisto"],
            ["fixed", "Custo de vida"],
          ], draft.section === "card" ? "extra" : draft.section),
        ]),
      cardSpend
        ? el("div", { class: "pair" }, [
          field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "1", "numeric"),
          field("Parcelas já pagas", "installmentsPaid", draft.installmentsPaid || "0", "numeric"),
        ])
        : "",
      cardSpend ? el("p", { class: "muted", id: "installment-preview" }, installmentPreview(draft)) : cardPurchaseFields(draft),
      draft.mode === "edit" && !cardSpend && draft.section === "extra"
        ? field("Parcela", "installment", draft.installment, "text", "3/10, se houver")
        : "",
      needsCard && !(recurring && draft.payment === "card") ? cardSelect(draft) : "",
      surprise && draft.mode === "create" && draft.payment === "card" ? invoiceMonthField(draft) : "",
      draft.mode === "edit" && (recurring || cardSpend) ? editScopeField(draft) : "",
      field("Observação", "note", draft.note, "text"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
      draft.mode === "edit"
        ? el("button", { class: "danger", type: "button", onclick: () => openDeleteExpense(draft) }, "Excluir gasto")
        : "",
    );
  }
  }
  const overlay = el("div", {
    class: "overlay",
    "data-key": "sheet",
    onclick: (event) => {
      if (event.target !== event.currentTarget || isIgnoringSwipeClick()) return;
      closeSheet();
    },
  }, [panel]);
  return overlay;
}
