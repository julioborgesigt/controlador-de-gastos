import { passkeyWhen } from "../../format.js";
import { removeShare, setSharePermission } from "../account.js";
import { downloadExport } from "../api.js";
import { registerPasskey, removePasskey } from "../auth.js";
import { el } from "../dom.js";
import { askReset, periodFields, periodSelect } from "../setup.js";
import { editable, state } from "../state.js";
import { extraAmountField, openIncomeExtra, useBaseIncome } from "../views/income.js";
import { field, formSection, monthChecks, monthSelect, segmented } from "./fields.js";
import { renderNubankImportSheet } from "./import-nubank.js";
import { closeSheet } from "./openers.js";

export function renderAccountSheet(panel, draft) {
  if (draft.mode === "import-nubank") {
    renderNubankImportSheet(panel, draft);
    return true;
  }
  if (draft.mode === "export") {
    const scope = draft.scope === "month" ? "month" : "all";
    panel.append(
      el("h2", {}, "Exportar backup"),
      el("p", { class: "muted" }, "Baixe seus lançamentos em planilha (CSV) para conferir no Excel/Sheets ou em backup completo (JSON)."),
      formSection("Abrangência", [
        el("div", { class: "field" }, [
          el("label", {}, "O que exportar"),
          segmented("scope", [["all", "Período inteiro"], ["month", "Somente este mês"]], scope),
        ]),
      ], "export-scope"),
      el("div", { class: "stack-actions" }, [
        el("button", { class: "primary", type: "button", onclick: () => downloadExport("csv", scope) }, "Baixar planilha (CSV)"),
        el("button", { class: "secondary", type: "button", onclick: () => downloadExport("json", scope) }, "Baixar backup completo (JSON)"),
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Fechar"),
      ]),
    );
    return true;
  }
  if (draft.mode === "share") {
    panel.append(
      el("h2", {}, "Compartilhar dados"),
      el("p", { class: "muted" }, "Informe o CPF de quem já tem conta. A pessoa escolhe, no login ou em Acesso, se abre os próprios gastos ou os seus."),
      formSection("Novo acesso", [
        field("CPF", "cpf", draft.cpf, "text", "000.000.000-00"),
        el("div", { class: "field" }, [
          el("label", {}, "Permissão"),
          segmented("permission", [["view", "Só ver"], ["edit", "Ver e editar"]], draft.permission),
        ]),
      ], "share-form"),
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
      formSection("Receita base", [
        field("Receita base deste mês", "amount", draft.amount, "decimal", "0,00"),
        el("p", { class: "muted form-hint" }, "Este mês deixa de seguir a receita base. Os extras abaixo continuam somados."),
      ], "month-income-base"),
      formSection("Extras deste mês", [
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
      ], "month-income-extras"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Salvar"),
      ]),
      el("button", { class: "quiet", type: "button", onclick: () => useBaseIncome(draft.monthId) }, "Voltar a usar a base"),
    );
  } else if (draft.mode === "income-extra") {
    panel.append(
      el("h2", {}, draft.id ? "Editar receita extra" : "Receita extra"),
      formSection("Detalhes", [
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
        field("Valor", "amount", draft.amount, "decimal", "0,00"),
      ], "income-extra-details"),
      formSection(draft.id ? "Mês" : "Meses", [
        draft.id ? monthSelect(draft.monthId) : monthChecks(),
        draft.id ? "" : el("p", { class: "muted form-hint" }, "O mesmo valor entra em cada mês marcado."),
      ], "income-extra-months"),
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
      formSection("Segurança", [
        field("Senha atual", "current", "", "password"),
        field("Nova senha", "next", "", "password"),
        field("Confirmar nova senha", "confirmation", "", "password"),
      ], "password-fields"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Trocar"),
      ]),
    );
  } else if (draft.mode === "period") {
    panel.append(
      el("h2", {}, "Período gerenciado"),
      el("p", { class: "muted" }, "O período escolhido poderá ser alterado depois, aqui no seu perfil."),
      formSection("Intervalo", [periodFields(draft)], "period-fields"),
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
      formSection("O que apagar", [
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
        el("p", { class: "muted form-hint" }, draft.scope === "all"
          ? "Desde o início apaga gastos, receitas, cartões e o período. Você sai da conta e, ao entrar de novo, refaz o formulário de primeiro login."
          : "Apaga os gastos e as receitas extras do ano ou do mês escolhido. O período e os cartões continuam."),
      ], "reset-scope"),
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
