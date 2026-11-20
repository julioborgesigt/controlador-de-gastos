import { money, nextMonthId, passkeyWhen } from "../../format.js";
import { removeShare, setSharePermission } from "../account.js";
import { registerPasskey, removePasskey } from "../auth.js";
import { paymentEntries, paymentEntryLine, removePartial, undoPayments } from "../dialogs/expense-info.js";
import { amountLabel, el, monthName } from "../dom.js";
import { askReset, periodFields, periodSelect } from "../setup.js";
import { editable, state } from "../state.js";
import { attachSheetDrag, isIgnoringSwipeClick } from "../swipe.js";
import { cardPayoffPreview } from "../views/card-helpers.js";
import { cashSpendFields } from "../views/cash.js";
import { openDeleteExpense } from "../views/expenses.js";
import { extraAmountField, openIncomeExtra, useBaseIncome } from "../views/income.js";
import {
  cardPayPreview,
  cardPurchaseFields,
  cardSelect,
  closeAfterField,
  editScopeField,
  field,
  installmentPreview,
  invoiceMonthField,
  livingPay,
  monthChecks,
  monthSelect,
  recurringSpan,
  segmented,
  undoCardPay,
} from "./fields.js";
import { cardSpendFields, closeSheet } from "./openers.js";
import { saveSheet } from "./save.js";

export function sheet() {
  const draft = state.sheet;
  const panel = el("form", { class: "sheet", role: "dialog", "aria-modal": "true", tabindex: "-1" }, [
    el("div", { class: "sheet-grab" }, [el("div", { class: "handle" })]),
  ]);
  panel.addEventListener("submit", saveSheet);
  attachSheetDrag(panel);
  if (state.error) panel.append(el("p", { class: "error" }, state.error));
  if (state.notice) panel.append(el("p", { class: "note" }, state.notice));
  if (draft.mode === "share") {
    panel.append(
      el("h2", {}, "Compartilhar dados"),
      el("p", { class: "muted" }, "Informe o CPF de quem já tem conta. A pessoa escolhe, no login ou em Acesso, se abre os próprios gastos ou os seus."),
      field("CPF", "cpf", draft.cpf, "text", "000.000.000-00"),
      el("div", { class: "field" }, [
        el("label", {}, "Permissão"),
        segmented("permission", [["view", "Só ver"], ["edit", "Ver e editar"]], draft.permission),
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Fechar"),
        el("button", { class: "primary", type: "submit" }, "Compartilhar"),
      ]),
      el("div", { class: "list" }, (state.shares || []).map((share) => el("article", { class: "item" }, [
        el("div", { class: "item-copy" }, [
          el("strong", {}, share.cpf),
          el("small", {}, `${share.email} · ${share.permission === "edit" ? "Pode editar" : "Só visualizar"}`),
        ]),
        el("div", { class: "item-actions" }, [
          el("button", {
            class: "linkish",
            type: "button",
            onclick: () => setSharePermission(share, share.permission === "edit" ? "view" : "edit"),
          }, share.permission === "edit" ? "Só ver" : "Permitir editar"),
          el("button", { class: "linkish danger", type: "button", onclick: () => removeShare(share) }, "Remover"),
        ]),
      ]))),
    );
  } else if (draft.mode === "month-income") {
    panel.append(
      el("h2", {}, draft.label),
      field("Receita base deste mês", "amount", draft.amount, "decimal"),
      el("p", { class: "muted" }, "Este mês deixa de seguir a receita base. Os extras abaixo continuam somados."),
      el("p", { class: "eyebrow group" }, "Extras deste mês"),
      draft.extras?.length
        ? el("div", {}, draft.extras.map((extra, index) => extraAmountField(extra, index)))
        : el("p", { class: "muted" }, "Nenhum extra neste mês."),
      editable()
        ? el("button", {
          class: "linkish",
          type: "button",
          onclick: () => openIncomeExtra([draft.monthId]),
        }, "Adicionar extra neste mês")
        : "",
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Salvar"),
      ]),
      el("button", { class: "quiet", type: "button", onclick: () => useBaseIncome(draft.monthId) }, "Voltar a usar a base"),
    );
  } else if (draft.mode === "income-extra") {
    panel.append(
      el("h2", {}, draft.id ? "Editar receita extra" : "Receita extra"),
      el("div", { class: "field" }, [
        el("label", {}, "Tipo"),
        segmented("kind", [
          ["ir", "Imposto de renda"],
          ["thirteenth", "Décimo terceiro"],
          ["vacation", "Férias"],
          ["other", "Outro"],
        ], draft.kind),
      ]),
      draft.kind === "other" ? field("Nome", "name", draft.name, "text", "Bônus, PLR...") : "",
      field("Valor", "amount", draft.amount, "decimal"),
      draft.id ? monthSelect(draft.monthId) : monthChecks(),
      draft.id ? "" : el("p", { class: "muted" }, "O mesmo valor entra em cada mês marcado."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, draft.id ? "Salvar" : "Adicionar"),
      ]),
    );
  } else if (draft.mode === "passkey") {
    panel.append(
      el("h2", {}, "Cadastrar digital"),
      el("p", { class: "muted" }, "Usa a digital já cadastrada neste celular para entrar. A senha continua valendo."),
      window.PublicKeyCredential
        ? el("button", { class: "primary", type: "button", onclick: registerPasskey }, "Cadastrar digital")
        : el("p", { class: "note" }, "Este navegador não oferece entrada com digital."),
      el("div", { class: "list" }, (state.passkeys || []).map((passkey) => el("article", { class: "item" }, [
        el("div", { class: "item-copy" }, [
          el("strong", {}, "Digital"),
          el("small", {}, passkeyWhen(passkey.createdAt)),
        ]),
        el("button", { class: "linkish danger", type: "button", onclick: () => removePasskey(passkey.id) }, "Remover"),
      ]))),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Fechar"),
      ]),
    );
  } else if (draft.mode === "password") {
    panel.append(
      el("h2", {}, "Alterar senha"),
      el("p", { class: "muted" }, "Trocar a senha remove as digitais cadastradas. Dá para cadastrar de novo neste celular."),
      field("Senha atual", "current", "", "password"),
      field("Nova senha", "next", "", "password"),
      field("Confirmar nova senha", "confirmation", "", "password"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Trocar"),
      ]),
    );
  } else if (draft.mode === "period") {
    panel.append(
      el("h2", {}, "Período gerenciado"),
      el("p", { class: "muted" }, "O período escolhido poderá ser alterado depois, aqui no seu perfil."),
      periodFields(draft),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
    );
  } else if (draft.mode === "reset") {
    const months = state.data?.months || [];
    const years = [...new Set(months.map((month) => month.id.slice(0, 4)))];
    panel.append(
      el("h2", {}, "Resetar meus dados"),
      el("p", { class: "muted" }, draft.scope === "all"
        ? "Desde o início apaga gastos, receitas, cartões e o período. Você sai da conta e, ao entrar de novo, refaz o formulário de primeiro login."
        : "Apaga os gastos e as receitas extras do ano ou do mês escolhido. O período e os cartões continuam."),
      el("div", { class: "field" }, [
        el("label", {}, "Apagar"),
        segmented("scope", [["all", "Desde o início"], ["year", "Um ano"], ["month", "Um mês"]], draft.scope),
      ]),
      draft.scope === "year"
        ? periodSelect(draft, "year", "Ano", years, years)
        : "",
      draft.scope === "month"
        ? periodSelect(draft, "monthId", "Mês", months.map((month) => month.id), months.map((month) => month.label))
        : "",
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "danger", type: "button", onclick: askReset }, "Apagar"),
      ]),
    );
  } else if (draft.mode === "delete-expense") {
    const living = draft.section === "fixed";
    const futureCard = draft.section === "extra";
    panel.append(
      el("h2", {}, futureCard ? "Excluir imprevisto do cartão" : "Excluir despesa"),
      el("p", { class: "muted" }, futureCard
        ? `“${draft.name}” está na fatura. Dá para tirar só desta fatura ou também de todas as faturas seguintes.`
        : living
        ? `“${draft.name}” é um custo de vida. Dá para tirar só deste mês ou de todos os meses em que esta conta existe.`
        : `“${draft.name}” está no cartão. Dá para tirar só desta fatura ou de todos os meses em que esta despesa aparece.`),
      el("div", { class: "field" }, [
        el("label", {}, "Excluir de"),
        segmented("scope", futureCard
          ? [["month", "Só este mês"], ["forward", "Este mês e os seguintes"]]
          : [["month", "Só este mês"], ["series", "Todos os meses"]], draft.scope || "month"),
      ]),
      el("p", { class: "muted" }, futureCard
        ? (draft.scope === "forward"
          ? "Some desta fatura e de todas as faturas seguintes. As faturas anteriores continuam."
          : "As outras faturas continuam com este imprevisto.")
        : draft.scope === "series"
        ? (living
          ? "A conta some de todos os meses. O valor que já estava na fatura desses meses também sai."
          : "A despesa some de todos os meses deste cartão.")
        : "Os outros meses continuam como estão."),
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
      entries.length
        ? el("div", { class: "partial-list" }, entries.map((entry, index) => el("div", { class: "partial-line" }, [
          el("span", {}, index === 0 ? `Último · ${paymentEntryLine(entry)}` : paymentEntryLine(entry)),
          el("button", {
            class: "linkish danger",
            type: "button",
            onclick: () => (entry.synthetic || !entry.id ? undoPayments(draft.id, "last") : removePartial(draft.id, entry.id)),
          }, "Excluir"),
        ])))
        : el("p", {}, "Não há lançamento para desfazer."),
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
      el("div", { class: "field" }, [
        el("label", {}, "Tirar de"),
        segmented("scope", [["month", "Só este mês"], ["series", "Todos os meses"]], draft.scope || "month"),
      ]),
      el("p", { class: "muted" }, draft.scope === "series"
        ? "Cada mês em que este custo está lançado no cartão volta a ficar em aberto."
        : "Os outros meses em que ele já está no cartão continuam na fatura."),
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
      field("Apelido na fatura", "alias", draft.alias, "text", "Faculdade, energia..."),
      draft.amountChoice === "none" ? "" : cardSelect(draft),
      el("div", { class: "field" }, [
        el("label", {}, "O valor cobrado é"),
        segmented("amountChoice", choices, draft.amountChoice),
      ]),
      draft.amountChoice !== "none" && (draft.amountChoice === "other" || draft.billing === "installments")
        ? field("Valor cobrado", "chargedAmount", draft.chargedAmount, "decimal")
        : "",
      draft.amountChoice === "none" ? "" : el("div", { class: "field" }, [
        el("label", {}, "Parcelamento"),
        segmented("billing", [["once", "À vista"], ["installments", "Parcelado"]], draft.billing),
      ]),
      draft.amountChoice !== "none" && draft.billing === "installments"
        ? el("div", { class: "pair" }, [
          field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "2", "numeric"),
          field("Valor da parcela", "installmentAmount", draft.installmentAmount || "", "decimal"),
        ])
        : "",
      draft.amountChoice === "none" ? "" : draft.variable
        ? el("div", { class: "field" }, [
          el("label", {}, "Em qual fatura"),
          segmented("invoiceTiming", [["mes", "Deste mês"], ["seguinte", "Do mês seguinte"]], draft.invoiceTiming === "seguinte" ? "seguinte" : "mes"),
          el("p", { class: "muted" }, draft.invoiceTiming === "seguinte"
            ? `Este gasto entra na fatura de ${monthName(nextMonthId(draft.costMonthId))}.`
            : `Este gasto entra na fatura de ${monthName(draft.costMonthId)}.`),
        ])
        : invoiceMonthField(draft),
      draft.amountChoice === "none" ? "" : el("p", { class: "muted", id: "installment-preview" }, cardPayPreview(draft)),
      !draft.variable && draft.amountChoice !== "none" && draft.billing !== "installments" && !(draft.already > 0)
        ? el("div", { class: "field" }, [
          el("label", {}, "Em quais meses"),
          segmented("cardScope", [["month", "Só este mês"], ["following", "Este mês e os seguintes"]], draft.cardScope || "month"),
        ])
        : "",
      !draft.variable && draft.amountChoice !== "none" && draft.billing !== "installments" && !(draft.already > 0)
        ? el("p", { class: "muted" }, draft.cardScope === "following"
          ? "Os meses seguintes levam o valor cadastrado de cada um, no mesmo cartão. O que já estiver no cartão ou pago não é mexido."
          : "O valor inteiro do previsto entra na fatura e a conta fica com a tarja Tá no cartão, no fundo verde. Um valor menor continua em aberto, com a tarja Parcial no cartão.")
        : "",
      draft.variable
        ? closeAfterField(draft)
        : draft.amountChoice === "none"
        ? el("p", { class: "muted" }, "Encerra com o que já foi lançado. A tarja fica Pago, o nome riscado e o fundo verde.")
        : draft.amountChoice === "same" && !(draft.already > 0) && draft.billing !== "installments"
          ? ""
          : closeAfterField(draft),
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
    select.addEventListener("change", () => { state.sheet.startMonthId = select.value; });
    panel.append(
      el("h2", {}, "Pago parcelado"),
      el("p", { class: "muted" }, `${draft.cardName} está com ${money(draft.balance)} em aberto. A fatura deste mês fica paga e o restante volta nas próximas faturas.`),
      field("Valor da entrada", "down", draft.down, "decimal", "0,00 se não houver"),
      el("div", { class: "pair" }, [
        field("Quantidade de parcelas", "count", draft.count, "numeric"),
        field("Valor da parcela", "per", draft.per, "decimal"),
      ]),
      el("div", { class: "field" }, [
        el("label", { for: "startMonthId" }, "O parcelamento começa em"),
        select,
      ]),
      el("p", { class: "muted", id: "card-payoff-preview" }, cardPayoffPreview(draft)),
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
      el("p", {}, `Ao finalizar “${draft.name}”, apenas a despesa de ${monthLabel} será encerrada (os meses seguintes continuam em aberto).`),
      el("p", {}, `Custo atual considerado para os cálculos: ${money(already)}${breakdown ? ` (${breakdown})` : " (nenhum lançamento neste mês)"} · previsto original ${money(draft.planned || 0)}.`),
      el("p", { class: "muted" }, "Qualquer diferença prevista que ainda estava em aberto deixa de ser reservada nos pagamentos e no custo previsto deste mês. Se precisar lançar algo antes, use Crédito ou À vista no topo."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Finalizando..." : "Finalizar despesa"),
      ]),
    );
  } else if (draft.mode === "partial") {
    panel.append(
      el("h2", {}, "Lançar pagamento"),
      el("p", { class: "muted" }, `“${draft.name}” continua em aberto. Dá para lançar outra ida depois, como na feira do mês.`),
      field("Valor pago agora", "amount", draft.amount, "decimal"),
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
      closeAfterField(draft),
      draft.variable
        ? el("p", { class: "muted" }, "Custo variável. Este lançamento não encerra a despesa, mesmo que passe do previsto. Encerre só se quiser.")
        : "",
      el("p", { class: "muted" }, draft.variable
        ? ""
        : draft.payment === "card"
        ? "Se o valor for o previsto inteiro, a conta fica com a tarja Tá no cartão e o fundo verde. Um valor menor fica em aberto, com Em aberto e Parcial no cartão."
        : "Finalizar só depois do lançamento. A tarja fica Finalizada, com o custo atual consolidado e o fundo verde."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : (draft.closeAfter === "close" ? "Lançar e finalizar" : "Lançar pagamento")),
      ]),
    );
  } else if (draft.fromCard && draft.mode === "edit") {
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
  const overlay = el("div", { class: "overlay", onclick: (event) => {
    if (event.target !== overlay || isIgnoringSwipeClick()) return;
    closeSheet();
  } }, [panel]);
  return overlay;
}
