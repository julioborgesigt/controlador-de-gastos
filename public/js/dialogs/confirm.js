import { leavePage } from "../a11y.js";
import { executeRemoveShare, logout } from "../account.js";
import { executeRemovePasskey } from "../auth.js";
import { el } from "../dom.js";
import { executeReset, settle } from "../setup.js";
import { saveSheet } from "../sheets/save.js";
import { render, state } from "../state.js";
import { removeCard, undoCardPayment } from "../views/card-helpers.js";
import { deleteExpenseNow, deleteSelectedExpenses, patchExpense } from "../views/expenses.js";
import { reopenLivingExpense } from "./expense-info.js";

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
        ? `Excluir “${name}” e os ${count} ${count === 1 ? "gasto cadastrado" : "gastos cadastrados"} nele? Esta exclusão é permanente e não poderá ser desfeita.`
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

export function confirmDialog() {
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
  if (kind === "settle") await settle("pay-remaining");
  else if (kind === "reopen") await settle("reopen");
  else render();
}
