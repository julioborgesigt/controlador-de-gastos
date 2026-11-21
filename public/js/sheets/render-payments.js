import { money, nextMonthId } from "../../format.js";
import { paymentEntries, paymentEntryLine, removePartial, undoPayments } from "../dialogs/expense-info.js";
import { el, monthName, on } from "../dom.js";
import { state } from "../state.js";
import { cardPayoffPreview } from "../views/card-helpers.js";
import {
  cardPayPreview,
  cardSelect,
  closeAfterField,
  field,
  formSection,
  invoiceMonthField,
  segmented,
  undoCardPay,
} from "./fields.js";
import { closeSheet } from "./openers.js";

export function renderPaymentSheet(panel, draft) {
  if (draft.mode === "delete-expense") {
    const living = draft.section === "fixed";
    const futureCard = draft.section === "extra";
    panel.append(
      el("h2", {}, futureCard ? "Excluir imprevisto do cartão" : "Excluir despesa"),
      el("p", { class: "muted" }, futureCard
        ? `“${draft.name}” está na fatura. Dá para tirar só desta fatura ou também de todas as faturas seguintes.`
        : living
        ? `“${draft.name}” é um custo de vida. Dá para tirar só deste mês ou de todos os meses em que esta conta existe.`
        : `“${draft.name}” está no cartão. Dá para tirar só desta fatura ou de todos os meses em que esta despesa aparece.`),
      formSection("Alcance", [
        el("div", { class: "field" }, [
          el("label", {}, "Excluir de"),
          segmented("scope", futureCard
            ? [["month", "Só este mês"], ["forward", "Este mês e os seguintes"]]
            : [["month", "Só este mês"], ["series", "Todos os meses"]], draft.scope || "month"),
        ]),
        el("p", { class: "muted form-hint" }, futureCard
          ? (draft.scope === "forward"
            ? "Some desta fatura e de todas as faturas seguintes. As faturas anteriores continuam."
            : "As outras faturas continuam com este imprevisto.")
          : draft.scope === "series"
          ? (living
            ? "A conta some de todos os meses. O valor que já estava na fatura desses meses também sai."
            : "A despesa some de todos os meses deste cartão.")
          : "Os outros meses continuam como estão."),
      ], "delete-scope"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "danger", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Excluindo..." : "Excluir"),
      ]),
    );
  } else if (draft.mode === "undo-payments") {
    const entries = paymentEntries(draft);
    panel.append(
      el("h2", {}, "Desfazer pagamento"),
      el("p", { class: "muted" }, `Estes são os lançamentos de “${draft.name}”. Dá para tirar só o último, todos, ou um lançamento específico.`),
      formSection("Lançamentos", [
        entries.length
          ? el("div", { class: "partial-list" }, entries.map((entry, index) => el("div", { class: "partial-line" }, [
            el("span", {}, index === 0 ? `Último · ${paymentEntryLine(entry)}` : paymentEntryLine(entry)),
            el("button", {
              class: "linkish danger",
              type: "button",
              onclick: () => (entry.synthetic || !entry.id ? undoPayments(draft.id, "last") : removePartial(draft.id, entry.id)),
            }, "Excluir"),
          ])))
          : el("p", { class: "muted" }, "Não há lançamento para desfazer."),
      ], "undo-entries"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        entries.length
          ? el("button", { class: "danger", type: "button", disabled: state.busy ? "" : null, onclick: () => undoPayments(draft.id, "all") }, "Desfazer todos")
          : "",
        entries.length
          ? el("button", { class: "primary", type: "button", disabled: state.busy ? "" : null, onclick: () => undoPayments(draft.id, "last") }, state.busy ? "Desfazendo..." : "Desfazer o último")
          : "",
      ]),
    );
  } else if (draft.mode === "undo-card") {
    panel.append(
      el("h2", {}, "Tirar do cartão"),
      el("p", { class: "muted" }, `“${draft.name}” sai da fatura e volta a ficar em aberto.`),
      formSection("Alcance", [
        el("div", { class: "field" }, [
          el("label", {}, "Tirar de"),
          segmented("scope", [["month", "Só este mês"], ["series", "Todos os meses"]], draft.scope || "month"),
        ]),
        el("p", { class: "muted form-hint" }, draft.scope === "series"
          ? "Cada mês em que este custo está lançado no cartão volta a ficar em aberto."
          : "Os outros meses em que ele já está no cartão continuam na fatura."),
      ], "undo-card-scope"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Tirar do cartão"),
      ]),
    );
  } else if (draft.mode === "card-pay") {
    const described = money(draft.described || 0);
    const already = draft.already || 0;
    const choices = already > 0
      ? [
        draft.described > 0 ? ["same", `O restante · ${described}`] : null,
        ["other", "Outro valor"],
        ["none", "Sem acréscimo"],
      ].filter(Boolean)
      : [["same", `O descrito · ${described}`], ["other", "Outro valor"]];
    panel.append(
      el("h2", {}, "Enviar pro cartão"),
      el("p", { class: "muted" }, draft.variable
        ? "Custo variável. Lance o total ou uma parte. Pode lançar de novo depois. A despesa continua aberta até você encerrar, mesmo que passe do previsto."
        : already > 0
        ? `Já pago: ${money(already)}. O sugerido é o restante. A fatura só recebe o valor que você confirmar.`
        : `Na lista este gasto está como ${described}. O valor só entra na fatura quando você confirmar, e pode ser diferente do cadastrado.`),
      formSection("Identificação e valor", [
        field("Apelido na fatura", "alias", draft.alias, "text", "Faculdade, energia..."),
        draft.amountChoice === "none" ? "" : cardSelect(draft),
        el("div", { class: "field" }, [
          el("label", {}, "O valor cobrado é"),
          segmented("amountChoice", choices, draft.amountChoice),
        ]),
        draft.amountChoice !== "none" && (draft.amountChoice === "other" || draft.billing === "installments")
          ? field("Valor cobrado", "chargedAmount", draft.chargedAmount, "decimal", "0,00")
          : "",
      ], "card-pay-amount"),
      draft.amountChoice !== "none"
        ? formSection("Parcelamento e fatura", [
          el("div", { class: "field" }, [
            el("label", {}, "Parcelamento"),
            segmented("billing", [["once", "À vista"], ["installments", "Parcelado"]], draft.billing),
          ]),
          draft.billing === "installments"
            ? el("div", { class: "pair" }, [
              field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "2", "numeric"),
              field("Valor da parcela", "installmentAmount", draft.installmentAmount || "", "decimal", "0,00"),
            ])
            : "",
          draft.variable
            ? el("div", { class: "field" }, [
              el("label", {}, "Em qual fatura"),
              segmented("invoiceTiming", [["mes", "Deste mês"], ["seguinte", "Do mês seguinte"]], draft.invoiceTiming === "seguinte" ? "seguinte" : "mes"),
              el("p", { class: "muted form-hint" }, draft.invoiceTiming === "seguinte"
                ? `Este gasto entra na fatura de ${monthName(nextMonthId(draft.costMonthId))}.`
                : `Este gasto entra na fatura de ${monthName(draft.costMonthId)}.`),
            ])
            : invoiceMonthField(draft),
          el("p", { class: "muted form-hint", id: "installment-preview" }, cardPayPreview(draft)),
        ], "card-pay-invoice")
        : "",
      formSection("Encerramento e alcance", [
        !draft.variable && draft.amountChoice !== "none" && draft.billing !== "installments" && !(draft.already > 0)
          ? el("div", { class: "field" }, [
            el("label", {}, "Em quais meses"),
            segmented("cardScope", [["month", "Só este mês"], ["following", "Este mês e os seguintes"]], draft.cardScope || "month"),
          ])
          : "",
        !draft.variable && draft.amountChoice !== "none" && draft.billing !== "installments" && !(draft.already > 0)
          ? el("p", { class: "muted form-hint" }, draft.cardScope === "following"
            ? "Os meses seguintes levam o valor cadastrado de cada um, no mesmo cartão. O que já estiver no cartão ou pago não é mexido."
            : "O valor inteiro do previsto entra na fatura e a conta fica com a tarja Tá no cartão, no fundo verde. Um valor menor continua em aberto, com a tarja Parcial no cartão.")
          : "",
        draft.variable
          ? closeAfterField(draft)
          : draft.amountChoice === "none"
          ? el("p", { class: "muted form-hint" }, "Encerra com o que já foi lançado. A tarja fica Pago, o nome riscado e o fundo verde.")
          : draft.amountChoice === "same" && !(draft.already > 0) && draft.billing !== "installments"
            ? ""
            : closeAfterField(draft),
      ], "card-pay-close"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Lançando..." : (draft.amountChoice === "none" ? "Encerrar despesa" : draft.closeAfter === "close" ? "Lançar e encerrar" : "Lançar na fatura")),
      ]),
      draft.linked
        ? el("button", { class: "danger", type: "button", onclick: () => undoCardPay(draft.id) }, "Desfazer pagamento no cartão")
        : "",
    );
  } else if (draft.mode === "card-payoff") {
    const months = state.data?.months || [];
    const select = el("select", { id: "startMonthId" });
    for (const month of months) select.append(el("option", { value: month.id }, month.label));
    select.value = draft.startMonthId || state.monthId;
    on(select, "change", (event) => { state.sheet.startMonthId = event.currentTarget.value; });
    panel.append(
      el("h2", {}, "Pago parcelado"),
      el("p", { class: "muted" }, `${draft.cardName} está com ${money(draft.balance)} em aberto. A fatura deste mês fica paga e o restante volta nas próximas faturas.`),
      formSection("Condições do parcelamento", [
        field("Valor da entrada", "down", draft.down, "decimal", "0,00 se não houver"),
        el("div", { class: "pair" }, [
          field("Quantidade de parcelas", "count", draft.count, "numeric"),
          field("Valor da parcela", "per", draft.per, "decimal", "0,00"),
        ]),
        el("div", { class: "field" }, [
          el("label", { for: "startMonthId" }, "O parcelamento começa em"),
          select,
        ]),
        el("p", { class: "muted form-hint", id: "card-payoff-preview" }, cardPayoffPreview(draft)),
      ], "card-payoff-terms"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Parcelar fatura"),
      ]),
    );
  } else if (draft.mode === "close-living") {
    const already = draft.already || 0;
    const breakdown = [
      draft.pix ? `Pix ${money(draft.pix)}` : "",
      draft.credit ? `Crédito ${money(draft.credit)}` : "",
    ].filter(Boolean).join(" · ");
    const monthLabel = monthName(state.monthId) || "deste mês";
    panel.append(
      el("h2", {}, "Finalizar despesa"),
      formSection("Resumo do encerramento", [
        el("p", {}, `Ao finalizar “${draft.name}”, apenas a despesa de ${monthLabel} será encerrada (os meses seguintes continuam em aberto).`),
        el("p", {}, `Custo atual considerado para os cálculos: ${money(already)}${breakdown ? ` (${breakdown})` : " (nenhum lançamento neste mês)"} · previsto original ${money(draft.planned || 0)}.`),
        el("p", { class: "muted form-hint" }, "Qualquer diferença prevista que ainda estava em aberto deixa de ser reservada nos pagamentos e no custo previsto deste mês. Se precisar lançar algo antes, use Crédito ou À vista no topo."),
      ], "close-living-summary"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Finalizando..." : "Finalizar despesa"),
      ]),
    );
  } else if (draft.mode === "partial") {
    panel.append(
      el("h2", {}, "Lançar pagamento"),
      el("p", { class: "muted" }, `“${draft.name}” continua em aberto. Dá para lançar outra ida depois, como na feira do mês.`),
      formSection("Pagamento", [
        field("Valor pago agora", "amount", draft.amount, "decimal", "0,00"),
        el("div", { class: "field" }, [
          el("label", {}, "Como foi pago"),
          segmented("payment", [["pix", "Pix"], ["card", "Crédito"]], draft.payment),
        ]),
        draft.payment === "card" ? cardSelect(draft) : "",
        draft.payment === "card"
          ? el("div", { class: "field" }, [
            el("label", {}, "Parcelamento"),
            segmented("billing", [["once", "À vista"], ["installments", "Parcelado"]], draft.billing),
          ])
          : "",
        draft.payment === "card" && draft.billing === "installments"
          ? field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "2", "numeric")
          : "",
        draft.payment === "card" ? invoiceMonthField(draft, draft.billing === "installments" ? "A primeira fatura em que entra:" : "Este valor entra na fatura de:") : "",
      ], "partial-payment"),
      formSection("Depois do lançamento", [
        closeAfterField(draft),
        draft.variable
          ? el("p", { class: "muted form-hint" }, "Custo variável. Este lançamento não encerra a despesa, mesmo que passe do previsto. Encerre só se quiser.")
          : "",
        !draft.variable
          ? el("p", { class: "muted form-hint" }, draft.payment === "card"
            ? "Se o valor for o previsto inteiro, a conta fica com a tarja Tá no cartão e o fundo verde. Um valor menor fica em aberto, com Em aberto e Parcial no cartão."
            : "Finalizar só depois do lançamento. A tarja fica Finalizada, com o custo atual consolidado e o fundo verde.")
          : "",
      ], "partial-close"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : (draft.closeAfter === "close" ? "Lançar e finalizar" : "Lançar pagamento")),
      ]),
    );
  } else {
    return false;
  }
  return true;
}
