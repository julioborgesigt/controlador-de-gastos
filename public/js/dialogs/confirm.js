import { cardChargeTitle, money, shortMonthLabel } from "../../format.js";
import { leavePage } from "../a11y.js";
import { executeRemoveShare, logout } from "../account.js";
import { executeRemovePasskey } from "../auth.js";
import { el } from "../dom.js";
import { executeReset, settle } from "../setup.js";
import { dismissNubankCardTip } from "../sheets/import-nubank.js";
import { saveSheet } from "../sheets/save.js";
import { render, state } from "../state.js";
import { removeCard, undoCardPayment } from "../views/card-helpers.js";
import { deleteExpenseNow, deleteSelectedExpenses, patchExpense } from "../views/expenses.js";
import { reopenLivingExpense } from "./expense-info.js";

function formatFutureMonths(monthIds) {
  const list = Array.isArray(monthIds) ? monthIds.filter(Boolean) : [];
  if (!list.length) return "";
  if (list.length <= 3) return list.map(shortMonthLabel).join(", ");
  return `${shortMonthLabel(list[0])} a ${shortMonthLabel(list[list.length - 1])}`;
}

function futureCountLabel(count, months) {
  const base = count === 1 ? "+1 parcela nos próximos meses" : `+${count} parcelas nos próximos meses`;
  return months ? `${base} (${months})` : base;
}

export function askConfirm(kind) {
  state.accountMenu = false;
  state.error = "";
  state.confirm = kind;
  render();
}

function confirmCopy() {
  const month = state.data?.month?.label || "este mês";
  if (state.confirm === "reset") {
    return {
      title: "Confirmar exclusão",
      body: state.confirmReset?.text || "Apagar esses dados?",
      action: "Confirmar",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "logout") {
    return {
      title: "Sair da conta?",
      body: "Você volta para a tela de entrada. Dá para entrar de novo com CPF e senha.",
      action: "Sair",
      cancel: "Ficar",
    };
  }
  if (state.confirm === "leave") {
    return {
      title: "Sair do app?",
      body: "Você volta para a tela anterior do navegador.",
      action: "Sair",
      cancel: "Ficar",
    };
  }
  if (state.confirm === "delete-card") {
    const name = state.confirmCard?.name || "este cartão";
    const count = Number(state.confirmCard?.expenseCount || 0);
    return {
      title: "Excluir cartão permanentemente",
      body: count > 0
        ? `Excluir “${name}” e os ${count} ${count === 1 ? "gasto cadastrado" : "gastos cadastrados"} nele em todos os meses (incluindo faturas futuras e parcelas)? Esta exclusão é permanente e não poderá ser desfeita.`
        : `Excluir “${name}”? Esta exclusão é permanente e não poderá ser desfeita.`,
      action: "Confirmar exclusão",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "delete-expenses-bulk") {
    const count = state.selectedExpenses?.size || 0;
    return {
      title: count === 1 ? "Excluir 1 gasto" : `Excluir ${count} gastos`,
      body: count === 1
        ? `Excluir o gasto selecionado em ${month}? Esta exclusão é permanente.`
        : `Excluir os ${count} gastos selecionados em ${month}? Esta exclusão é permanente.`,
      action: count === 1 ? "Excluir 1 gasto" : `Excluir ${count} gastos`,
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "past-due") {
    return {
      title: "Vencimento já passou",
      body: state.pastDue?.body || "O vencimento desta fatura já passou. Quer registrar mesmo assim?",
      action: "Registrar mesmo assim",
      cancel: "Não registrar",
    };
  }
  if (state.confirm === "settle") {
    return {
      title: "Quitar o que falta",
      body: `Marca como pagos a fatura e os imprevistos ainda em aberto em ${month}. O custo de vida previsto continua em falta até você usar Lançar pagamento ou Finalizar despesa. O mês só fica quitado quando esse valor zera.`,
      action: "Quitar",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "remove-passkey") {
    return {
      title: "Remover digital",
      body: "Remover a digital deste celular? Você poderá cadastrar de novo depois.",
      action: "Remover",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "remove-share") {
    const cpf = state.confirmTarget?.cpf || "esta pessoa";
    return {
      title: "Parar de compartilhar",
      body: `Parar de compartilhar seus gastos com ${cpf}?`,
      action: "Remover",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "delete-expense-simple") {
    const name = state.confirmTarget?.name || "este gasto";
    return {
      title: "Excluir gasto",
      body: `Excluir “${name}” deste mês?`,
      action: "Excluir",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "reopen") {
    return {
      title: "Reabrir mês",
      body: `Desmarca os pagamentos de ${month}. A fatura, o Pix e os imprevistos voltam a ficar em aberto.`,
      action: "Reabrir",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "undo-card-payment") {
    const name = state.confirmTarget?.name || "este cartão";
    return {
      title: "Desfazer pagamento da fatura",
      body: `Desfazer o pagamento da fatura de “${name}” em ${month}? A fatura volta a ficar em aberto.`,
      action: "Desfazer",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "reopen-living") {
    const name = state.confirmTarget?.name || "esta despesa";
    return {
      title: "Reabrir despesa",
      body: `Desfazer a finalização de “${name}”? A despesa volta a ficar em aberto.`,
      action: "Reabrir",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "undo-expense-paid") {
    const name = state.confirmTarget?.name || "este lançamento";
    return {
      title: "Desfazer pagamento",
      body: `Desfazer o pagamento de “${name}”? O lançamento volta a ficar em aberto.`,
      action: "Desfazer",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "dismiss-nubank-card-tip") {
    return {
      title: "Não exibir mais esta sugestão?",
      body: "A sugestão de importar CSV do Nubank não aparecerá mais no cadastro de cartão. Você ainda poderá usar essa importação sempre que precisar no menu do usuário (ícone de perfil no topo).",
      action: "Não exibir mais",
      cancel: "Cancelar",
    };
  }
  return {
    title: "Confirmar ação",
    body: "",
    action: "Confirmar",
    cancel: "Cancelar",
  };
}

function hasCountdown(kind) {
  return kind === "reset" || kind === "delete-card";
}

function bulkInstallmentDialog() {
  const flow = state.bulkDeleteFlow;
  if (!flow || !Array.isArray(flow.withFuture) || !flow.withFuture.length) return null;
  const month = state.data?.month?.label || "este mês";
  const totalSelected = flow.allItems.length;
  const futureItems = flow.withFuture;
  const othersCount = Math.max(0, totalSelected - futureItems.length);
  const content = [
    el("button", {
      class: "dialog-close",
      type: "button",
      "aria-label": "Fechar",
      onclick: closeConfirm,
    }, "×"),
  ];

  if (flow.step === "alert") {
    const intro = totalSelected === 1
      ? "O valor selecionado possui parcelas lançadas nos próximos meses:"
      : futureItems.length === 1
        ? `Dos ${totalSelected} valores selecionados, 1 possui parcelas lançadas nos próximos meses:`
        : `Dos ${totalSelected} valores selecionados, ${futureItems.length} possuem parcelas lançadas nos próximos meses:`;
    content.push(
      el("span", { class: "bulk-future-pill warn" }, "Atenção · Parcelas futuras"),
      el("h2", { id: "confirm-title" }, "Parcelas nos próximos meses"),
      el("p", {}, intro),
      el("div", { class: "bulk-future-list" }, futureItems.map((item) => {
        const count = Number(item.futureInstallmentCount || 0);
        const months = formatFutureMonths(item.futureMonthIds);
        return el("div", { class: "bulk-future-row" }, [
          el("div", { class: "bulk-future-copy" }, [
            el("strong", {}, cardChargeTitle(item)),
            el("small", {}, `${item.installment ? `Parcela ${item.installment} · ` : ""}${money(item.amountCents)}`),
          ]),
          el("span", { class: "badge cross-month" }, count === 1 ? `+1 parcela${months ? ` (${months})` : ""}` : `+${count} parcelas${months ? ` (${months})` : ""}`),
        ]);
      })),
      el("p", { class: "muted bulk-future-note" }, "Vamos perguntar um a um se você deseja excluir também as parcelas dos meses seguintes."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeConfirm }, "Cancelar"),
        el("button", {
          class: "primary",
          type: "button",
          onclick: () => {
            flow.step = "ask";
            flow.index = 0;
            render();
          },
        }, "Revisar um a um"),
      ]),
    );
  } else if (flow.step === "ask") {
    const idx = Math.min(Math.max(0, Number(flow.index || 0)), futureItems.length - 1);
    const item = futureItems[idx];
    const count = Number(item.futureInstallmentCount || 0);
    const months = formatFutureMonths(item.futureMonthIds);
    const choose = (decision) => {
      flow.decisions[item.id] = decision;
      if (idx + 1 < futureItems.length) {
        flow.index = idx + 1;
      } else {
        flow.step = "summary";
      }
      render();
    };
    content.push(
      el("span", { class: "bulk-future-pill" }, `Parcelado ${idx + 1} de ${futureItems.length}`),
      el("h2", { id: "confirm-title" }, "Excluir parcelas seguintes?"),
      el("div", { class: "bulk-future-focus" }, [
        el("strong", {}, cardChargeTitle(item)),
        el("small", {}, `${item.installment ? `Parcela ${item.installment} · ` : ""}${money(item.amountCents)}`),
        el("span", { class: "badge cross-month" }, futureCountLabel(count, months)),
      ]),
      el("p", {}, `Deseja excluir também ${count === 1 ? "a parcela do próximo mês" : `as ${count} parcelas dos meses seguintes`} de “${item.name}”, ou apagar somente em ${month}?`),
      el("div", { class: "bulk-future-choices" }, [
        el("button", {
          class: "secondary",
          type: "button",
          onclick: () => choose("month"),
        }, "Somente este mês"),
        el("button", {
          class: "danger",
          type: "button",
          onclick: () => choose("forward"),
        }, "Excluir também as próximas"),
      ]),
      el("div", { class: "bulk-future-foot" }, [
        el("button", {
          class: "linkish",
          type: "button",
          onclick: () => {
            if (idx > 0) flow.index = idx - 1;
            else flow.step = "alert";
            render();
          },
        }, "Voltar"),
        el("button", { class: "linkish", type: "button", onclick: closeConfirm }, "Cancelar"),
      ]),
    );
  } else {
    const forwardIds = futureItems.filter((item) => flow.decisions[item.id] === "forward").map((item) => item.id);
    content.push(
      el("span", { class: "bulk-future-pill" }, "Confirmação final"),
      el("h2", { id: "confirm-title" }, "Resumo da exclusão"),
      el("p", {}, `Confira o que será excluído antes de confirmar (esta ação é permanente):`),
      el("div", { class: "bulk-future-list" }, futureItems.map((item) => {
        const includeFuture = flow.decisions[item.id] === "forward";
        const count = Number(item.futureInstallmentCount || 0);
        return el("div", { class: "bulk-future-row" }, [
          el("div", { class: "bulk-future-copy" }, [
            el("strong", {}, cardChargeTitle(item)),
            el("small", {}, `${item.installment ? `Parcela ${item.installment} · ` : ""}${money(item.amountCents)}`),
          ]),
          el("span", {
            class: includeFuture ? "bulk-scope-tag forward" : "bulk-scope-tag month",
          }, includeFuture
            ? `Este mês + ${count} ${count === 1 ? "seguinte" : "seguintes"}`
            : "Somente este mês"),
        ]);
      })),
      othersCount > 0
        ? el("p", { class: "muted bulk-future-note" }, `+ ${othersCount} ${othersCount === 1 ? "outro valor selecionado" : "outros valores selecionados"} (somente em ${month}).`)
        : "",
      el("div", { class: "actions" }, [
        el("button", {
          class: "secondary",
          type: "button",
          onclick: () => {
            flow.step = "ask";
            flow.index = futureItems.length - 1;
            render();
          },
        }, "Voltar"),
        el("button", {
          class: "danger",
          type: "button",
          disabled: state.busy ? "" : null,
          onclick: async () => {
            state.confirm = null;
            state.confirmTarget = null;
            state.bulkDeleteFlow = null;
            render();
            await deleteSelectedExpenses(forwardIds);
          },
        }, "Confirmar exclusão"),
      ]),
    );
  }

  return el("div", {
    class: "overlay center",
    "data-key": "confirm",
    role: "presentation",
    onclick: (event) => {
      if (event.target === event.currentTarget) closeConfirm();
    },
  }, [
    el("div", {
      class: "dialog bulk-future-dialog",
      role: "alertdialog",
      "aria-modal": "true",
      "aria-labelledby": "confirm-title",
      "data-bulk-step": flow.step,
      tabindex: "-1",
    }, content),
  ]);
}

export function confirmDialog() {
  if (state.confirm === "delete-expenses-bulk-installments") {
    const stepped = bulkInstallmentDialog();
    if (stepped) return stepped;
  }
  const copy = confirmCopy();
  const wait = hasCountdown(state.confirm) ? resetSecondsLeft() : 0;
  const destructive = state.confirm === "reset"
    || state.confirm === "delete-card"
    || state.confirm === "remove-passkey"
    || state.confirm === "remove-share"
    || state.confirm === "delete-expense-simple"
    || state.confirm === "delete-expenses-bulk";
  const overlay = el("div", {
    class: "overlay center",
    "data-key": "confirm",
    role: "presentation",
    onclick: (event) => {
      if (event.target === event.currentTarget) closeConfirm();
    },
  }, [
    el("div", { class: "dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "confirm-title", tabindex: "-1" }, [
      el("h2", { id: "confirm-title" }, copy.title),
      el("p", {}, copy.body),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeConfirm }, copy.cancel),
        el("button", {
          class: destructive ? "danger" : "primary",
          type: "button",
          disabled: wait > 0 ? "" : null,
          onclick: wait > 0 ? () => {} : runConfirm,
        }, wait > 0 ? `Confirmar em ${wait}s` : copy.action),
      ]),
    ]),
  ]);
  return overlay;
}

export function closeConfirm() {
  clearTimeout(state.resetTimer);
  state.confirm = null;
  state.confirmTarget = null;
  state.bulkDeleteFlow = null;
  render();
}

function resetSecondsLeft() {
  return Math.max(0, Math.ceil((state.resetReadyAt - Date.now()) / 1000));
}

export function pulseResetConfirm() {
  clearTimeout(state.resetTimer);
  if (!hasCountdown(state.confirm)) return;
  if (resetSecondsLeft() <= 0) return;
  const left = resetSecondsLeft();
  const delay = state.resetReadyAt - Date.now() - (left - 1) * 1000;
  state.resetTimer = setTimeout(() => {
    if (!hasCountdown(state.confirm)) return;
    render();
    pulseResetConfirm();
  }, Math.max(200, delay));
}

async function runConfirm() {
  const kind = state.confirm;
  const target = state.confirmTarget;
  if (hasCountdown(kind) && resetSecondsLeft() > 0) return;
  clearTimeout(state.resetTimer);
  state.confirm = null;
  state.confirmTarget = null;
  if (kind === "leave") {
    leavePage();
    return;
  }
  render();
  if (kind === "logout") {
    await logout();
    return;
  }
  if (kind === "reset") {
    await executeReset();
    return;
  }
  if (kind === "delete-card") {
    await removeCard(state.confirmCard);
    return;
  }
  if (kind === "delete-expenses-bulk") {
    await deleteSelectedExpenses();
    return;
  }
  if (kind === "remove-passkey") {
    await executeRemovePasskey(target);
    return;
  }
  if (kind === "remove-share") {
    await executeRemoveShare(target);
    return;
  }
  if (kind === "delete-expense-simple") {
    await deleteExpenseNow(target, "month");
    return;
  }
  if (kind === "past-due") {
    if (state.sheet && state.pastDue) state.sheet.acceptedDueKey = state.pastDue.key;
    render();
    await saveSheet({ preventDefault() {} });
    return;
  }
  if (kind === "undo-card-payment") {
    await undoCardPayment(target);
    return;
  }
  if (kind === "reopen-living") {
    await reopenLivingExpense(target);
    return;
  }
  if (kind === "undo-expense-paid") {
    if (target) await patchExpense(target, { paid: false });
    else render();
    return;
  }
  if (kind === "dismiss-nubank-card-tip") {
    dismissNubankCardTip();
    state.notice = "Sugestão ocultada. A importação de CSV do Nubank continua disponível no menu do usuário.";
    render();
    return;
  }
  if (kind === "settle") await settle("pay-remaining");
  else if (kind === "reopen") await settle("reopen");
  else render();
}
