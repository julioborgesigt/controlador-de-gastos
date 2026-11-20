import { passkeyWhen } from "../../format.js";
import { removeShare, setSharePermission } from "../account.js";
import { registerPasskey, removePasskey } from "../auth.js";
import { el } from "../dom.js";
import { askReset, periodFields, periodSelect } from "../setup.js";
import { editable, state } from "../state.js";
import { extraAmountField, openIncomeExtra, useBaseIncome } from "../views/income.js";
import { field, monthChecks, monthSelect, segmented } from "./fields.js";
import { closeSheet } from "./openers.js";

export function renderAccountSheet(panel, draft) {
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
  } else {
    return false;
  }
  return true;
}
