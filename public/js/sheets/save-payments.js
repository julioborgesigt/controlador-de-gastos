import { money, nextMonthId, parseMoney } from "../../format.js";
import { quoteInstallments } from "../../installment-link.js";
import { rememberMonth, request } from "../api.js";
import { livingChargeIsFull } from "../dialogs/expense-info.js";
import { setWorking, state } from "../state.js";
import { acceptPastDue, pastDueWarning } from "../views/card-helpers.js";
import { deleteExpenseNow } from "../views/expenses.js";
import { faturaWhen } from "./fields.js";

export async function savePaymentSheet(draft) {
  if (draft.mode === "close-living") {
    setWorking(true, "Finalizando...");
    state.data = await request(`/api/expenses/${draft.id}/settle`, {
      method: "POST",
      body: { useRegistered: false, noAddition: true, amountCents: 0 },
    });
    rememberMonth(state.data);
    state.notice = `“${draft.name}” finalizada com custo de ${money(draft.already || 0)} neste mês.`;
    return "close";
  }

  if (draft.mode === "partial") {
    const amountCents = parseMoney(draft.amount || "");
    if (amountCents === null || amountCents <= 0) throw new Error("Informe o valor pago. Exemplo: 75,90");
    const count = Number(draft.installmentCount);
    if (draft.payment === "card") {
      if (!draft.cardLabel) throw new Error("Escolha o cartão.");
      if (!draft.invoiceMonthId) throw new Error("Escolha o mês da fatura.");
      if (draft.billing === "installments" && (!Number.isInteger(count) || count < 2 || count > 48)) {
        throw new Error("Informe de 2 a 48 parcelas.");
      }
      if (!acceptPastDue(pastDueWarning(draft.cardLabel, draft.invoiceMonthId))) return "keep";
    }
    setWorking(true, draft.closeAfter === "close" ? "Encerrando..." : "Lançando...");
    const cardCount = draft.billing === "installments" ? count : 1;
    const fullCard = !draft.variable && draft.payment === "card" && livingChargeIsFull(draft.planned || 0, draft.already || 0, amountCents);
    if (fullCard) {
      state.data = await request(`/api/expenses/${draft.id}/card-payment`, {
        method: "POST",
        body: {
          cardLabel: draft.cardLabel,
          alias: draft.name,
          amountCents,
          installmentCount: cardCount,
          invoiceMonthId: draft.invoiceMonthId,
          amountMode: "total",
          scope: "month",
        },
      });
      state.notice = `Enviei o valor inteiro de “${draft.name}” para o cartão.`;
    } else {
      state.data = await request(`/api/expenses/${draft.id}/partials`, {
        method: "POST",
        body: {
          amountCents,
          payment: draft.payment,
          cardLabel: draft.payment === "card" ? draft.cardLabel : undefined,
          installmentCount: draft.payment === "card" ? cardCount : 1,
          invoiceMonthId: draft.payment === "card" ? draft.invoiceMonthId : undefined,
        },
      });
      if (draft.closeAfter === "close") {
        state.data = await request(`/api/expenses/${draft.id}/settle`, {
          method: "POST",
          body: { noAddition: true, amountCents: 0, useRegistered: false },
        });
      }
      state.notice = draft.closeAfter === "close"
        ? `Lancei ${money(amountCents)} e finalizei “${draft.name}”.`
        : `Pagamento de ${money(amountCents)} lançado em “${draft.name}”.`;
    }
    rememberMonth(state.data);
    return "close";
  }

  if (draft.mode === "delete-expense") {
    const scope = draft.scope === "series" || draft.scope === "forward" ? draft.scope : "month";
    await deleteExpenseNow(draft, scope);
    return "keep";
  }

  if (draft.mode === "undo-card") {
    const scope = draft.scope === "series" ? "series" : "month";
    setWorking(true, "Tirando do cartão...");
    state.data = await request(`/api/expenses/${draft.id}/card-payment?scope=${scope}`, { method: "DELETE" });
    rememberMonth(state.data);
    state.notice = scope === "series"
      ? `Tirei “${draft.name}” do cartão em todos os meses em que estava lançado.`
      : `Tirei “${draft.name}” do cartão neste mês.`;
    return "close";
  }

  if (draft.mode === "card-pay") {
    if (draft.amountChoice === "none") {
      setWorking(true, "Encerrando...");
      state.data = await request(`/api/expenses/${draft.id}/settle`, {
        method: "POST",
        body: { noAddition: true, amountCents: 0, useRegistered: false },
      });
      rememberMonth(state.data);
      state.notice = `“${draft.alias || draft.name}” encerrada sem acréscimo.`;
      return "close";
    }
    const alias = String(draft.alias || "").trim();
    if (!alias) throw new Error("Escolha o apelido que vai aparecer na fatura.");
    if (!draft.cardLabel) throw new Error("Escolha o cartão.");
    if (draft.variable) {
      const base = draft.costMonthId || state.monthId;
      draft.invoiceMonthId = draft.invoiceTiming === "seguinte" ? nextMonthId(base) : base;
      if (!draft.invoiceMonthId || !(state.data?.months || []).some((month) => month.id === draft.invoiceMonthId)) {
        throw new Error("O mês seguinte está fora do período. Aumente o período para lançar nessa fatura.");
      }
    }
    if (!draft.invoiceMonthId) throw new Error("Escolha o mês da fatura.");
    let amountCents = draft.described;
    let installmentCount = 1;
    let amountMode = "installment";
    if (draft.billing === "installments") {
      const charged = parseMoney(draft.chargedAmount || "");
      installmentCount = Number(draft.installmentCount);
      const per = parseMoney(draft.installmentAmount || "");
      if (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 48) {
        throw new Error("Informe de 2 a 48 parcelas.");
      }
      if (per === null || per <= 0) throw new Error("Informe o valor da parcela.");
      if (charged === null || charged <= 0) throw new Error("Informe o valor cobrado no cartão.");
      const quote = quoteInstallments(charged, installmentCount, per);
      if (!quote || quote.kind === "mismatch") {
        throw new Error("O valor cobrado não fecha com a quantidade e o valor da parcela.");
      }
      if (quote.kind === "remainder") {
        amountCents = charged;
        amountMode = "total";
      } else {
        amountCents = per;
      }
    } else if (draft.amountChoice === "other") {
      amountCents = parseMoney(draft.chargedAmount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe o valor cobrado no cartão.");
    } else if (!amountCents || amountCents <= 0) {
      throw new Error("Este gasto está sem valor. Informe outro valor.");
    }
    if (!acceptPastDue(pastDueWarning(draft.cardLabel, draft.invoiceMonthId))) return "keep";
    const chargedTotal = draft.billing === "installments"
      ? (amountMode === "total" ? amountCents : amountCents * installmentCount)
      : amountCents;
    const fullCard = !draft.variable && livingChargeIsFull(draft.planned || draft.described || 0, draft.already || 0, chargedTotal);
    const close = !fullCard && draft.closeAfter === "close";
    setWorking(true, close ? "Encerrando..." : "Lançando na fatura...");
    state.data = await request(`/api/expenses/${draft.id}/card-payment`, {
      method: "POST",
      body: {
        cardLabel: draft.cardLabel,
        alias,
        amountCents,
        installmentCount,
        invoiceMonthId: draft.invoiceMonthId,
        amountMode,
        scope: !fullCard || installmentCount > 1 ? "month" : (draft.cardScope === "following" ? "following" : "month"),
        close,
      },
    });
    rememberMonth(state.data);
    const several = fullCard && installmentCount === 1 && draft.cardScope === "following";
    state.notice = close
      ? `Lancei ${money(chargedTotal)} no cartão e encerrei “${alias}”.`
      : fullCard
        ? (installmentCount > 1
          ? `Lancei ${installmentCount} parcelas ${faturaWhen(draft.invoiceMonthId, true)}, com o apelido “${alias}”.`
          : several
            ? `Lancei “${alias}” no cartão neste mês e nos seguintes.`
            : `Lancei “${alias}” ${faturaWhen(draft.invoiceMonthId)}.`)
        : `Lancei ${money(chargedTotal)} no cartão. “${alias}” continua em aberto.`;
    return "close";
  }

  if (draft.mode === "card-payoff") {
    const hasDown = String(draft.down || "").trim() !== "";
    const downCents = hasDown ? parseMoney(draft.down) : 0;
    const count = Number(draft.count);
    const installmentCents = parseMoney(draft.per || "");
    if (hasDown && (downCents === null || downCents < 0)) throw new Error("Informe a entrada. Exemplo: 200,00. Deixe em branco se não houver.");
    if (!Number.isInteger(count) || count < 2 || count > 48) throw new Error("Informe de 2 a 48 parcelas.");
    if (installmentCents === null || installmentCents <= 0) throw new Error("Informe o valor da parcela.");
    if (!draft.startMonthId) throw new Error("Escolha o mês em que o parcelamento começa.");
    if (!acceptPastDue(pastDueWarning(draft.cardName, draft.startMonthId))) return "keep";
    setWorking(true, "Parcelando...");
    state.data = await request(`/api/cards/${draft.cardId}/payoff`, {
      method: "POST",
      body: {
        mode: "installments",
        monthId: state.monthId,
        downCents,
        count,
        installmentCents,
        startMonthId: draft.startMonthId,
      },
    });
    rememberMonth(state.data);
    state.notice = `Fatura de ${draft.cardName} parcelada em ${count} vezes.`;
    return "close";
  }

  return null;
}
