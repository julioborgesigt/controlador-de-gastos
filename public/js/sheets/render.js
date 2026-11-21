import { isNubankName } from "../../shared/nubank-csv.js";
import { amountLabel, el, on } from "../dom.js";
import { render, state } from "../state.js";
import { attachSheetDrag, isIgnoringSwipeClick } from "../swipe.js";
import { cashSpendFields } from "../views/cash.js";
import { openDeleteExpense } from "../views/expenses.js";
import {
  cardPurchaseFields,
  cardSelect,
  editScopeField,
  field,
  formSection,
  installmentPreview,
  invoiceMonthField,
  livingPay,
  recurringSpan,
  segmented,
} from "./fields.js";
import { cardPresetsBlock, nubankSuggestionBanner, openNubankImport } from "./import-nubank.js";
import { cardSpendFields, closeSheet } from "./openers.js";
import { renderAccountSheet } from "./render-account.js";
import { renderPaymentSheet } from "./render-payments.js";
import { saveSheet } from "./save.js";

export function sheet() {
  const draft = state.sheet;
  const panel = el("form", { class: "sheet", role: "dialog", "aria-modal": "true", tabindex: "-1" }, [
    el("div", { class: "sheet-grab", "data-key": "sheet-grab" }, [el("div", { class: "handle" })]),
    el("button", {
      class: "sheet-close",
      type: "button",
      "aria-label": "Fechar formulário",
      "data-key": "sheet-close",
      onclick: closeSheet,
    }, "×"),
  ]);
  on(panel, "submit", saveSheet);
  attachSheetDrag(panel);
  if (state.error) panel.append(el("p", { class: "error", "data-key": "sheet-error" }, state.error));
  if (!renderAccountSheet(panel, draft) && !renderPaymentSheet(panel, draft)) {
    if (draft.fromCard && draft.mode === "edit") {
      panel.append(...cardSpendFields(draft, { onDelete: () => openDeleteExpense(draft) }).filter(Boolean));
    } else if (draft.mode === "cash-spend") {
      panel.append(...cashSpendFields(draft).filter(Boolean));
    } else if (draft.mode === "card-spend") {
      panel.append(...cardSpendFields(draft).filter(Boolean));
    } else if (draft.mode === "card") {
      const isNubank = isNubankName(draft.name);
      panel.append(
        el("h2", {}, draft.id ? "Editar cartão" : "Novo cartão"),
        formSection("Identificação", [
          !draft.id ? cardPresetsBlock(draft.name, (name) => {
            draft.name = name;
            render();
          }) : "",
          field("Apelido", "name", draft.name, "text", "Nubank, Itaú, Inter..."),
          isNubank ? nubankSuggestionBanner({
            onImport: () => openNubankImport(draft.name.trim() || "Nubank"),
          }) : "",
        ], "card-identity"),
        formSection("Ciclo da fatura", [
          el("div", { class: "pair" }, [
            field("Dia de fechamento", "closingDay", draft.closingDay || "", "numeric", "1"),
            field("Dia de vencimento", "dueDay", draft.dueDay || "", "numeric", "10"),
          ]),
          el("p", { class: "muted form-hint" }, "O fechamento sugere em qual fatura o gasto entra. O vencimento é o dia de pagar a fatura."),
        ], "card-cycle"),
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
        formSection("Detalhes", [
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
              segmented("expenseKind", [["imprevisto", "Imprevisto"], ["planejado", "Planejado"]], draft.expenseKind === "planejado" ? "planejado" : "imprevisto", {
                tones: { planejado: "planned", imprevisto: "extra" },
              }),
            ])
            : "",
          cardSpend ? "" : field(amountLabel(draft), "amount", draft.amount, "decimal"),
          cardSpend || recurring || surprise
            ? ""
            : el("div", { class: "field" }, [
              el("label", {}, "Tipo"),
              segmented("section", [
                ["extra", "Imprevisto"],
                ["fixed", "Custo de vida"],
              ], draft.section === "card" ? "extra" : draft.section),
            ]),
        ], "expense-details"),
        formSection(recurring ? "Pagamento e meses" : "Pagamento", [
          surprise
            ? el("div", { class: "field" }, [
              el("label", {}, "Como foi pago"),
              segmented("payment", [["pix", "Pix"], ["card", "Crédito"]], draft.payment),
            ])
            : "",
          recurring ? livingPay(draft) : "",
          recurring && draft.mode === "create" ? recurringSpan(draft) : "",
          cardSpend
            ? el("div", { class: "pair" }, [
              field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "1", "numeric"),
              field("Parcelas já pagas", "installmentsPaid", draft.installmentsPaid || "0", "numeric"),
            ])
            : "",
          cardSpend ? el("p", { class: "muted form-hint", id: "installment-preview" }, installmentPreview(draft)) : cardPurchaseFields(draft),
          draft.mode === "edit" && !cardSpend && draft.section === "extra"
            ? field("Parcela", "installment", draft.installment, "text", "3/10, se houver")
            : "",
          needsCard && !(recurring && draft.payment === "card") ? cardSelect(draft) : "",
          surprise && draft.mode === "create" && draft.payment === "card" ? invoiceMonthField(draft) : "",
          draft.mode === "edit" && (recurring || cardSpend) ? editScopeField(draft) : "",
        ], "expense-payment"),
        formSection("Observação", [
          field("Observação", "note", draft.note, "text", "Opcional"),
        ], "expense-note"),
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
