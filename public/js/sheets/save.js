import { composeNote, parseMoney } from "../../format.js";
import { loadMonth, rememberMonth, request } from "../api.js";
import { messageOf, monthName } from "../dom.js";
import { renderSafely, setWorking, state } from "../state.js";
import { acceptPastDue, pastDueWarning } from "../views/card-helpers.js";
import { recurringMonthIds } from "./fields.js";
import { saveAccountSheet } from "./save-account.js";
import { savePaymentSheet } from "./save-payments.js";

export async function saveSheet(event) {
  event.preventDefault();
  const draft = state.sheet;
  state.error = "";
  state.notice = "";
  try {
    if (draft.mode === "passkey" || draft.mode === "undo-payments" || draft.mode === "export") return;

    const paymentResult = await savePaymentSheet(draft);
    if (paymentResult) {
      if (paymentResult === "close") state.sheet = null;
      return;
    }

    const accountResult = await saveAccountSheet(draft);
    if (accountResult) {
      if (accountResult === "close") state.sheet = null;
      return;
    }

    if (draft.mode === "cash-spend") {
      const amountCents = parseMoney(draft.amount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe um valor maior que zero.");
      if (!["casa", "imprevisto", "planejado"].includes(draft.expenseKind)) throw new Error("Escolha a classificação.");
      if (!draft.invoiceMonthId) throw new Error("Escolha o mês.");
      if (draft.expenseKind === "casa" && !draft.linkExpenseId) throw new Error("Escolha o custo de vida.");
      if (draft.expenseKind !== "casa" && !draft.linkExpenseId && !draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      setWorking(true, "Lançando...");
      state.data = await request("/api/cash-spend", {
        method: "POST",
        body: {
          name: draft.name.trim(),
          amountCents,
          classification: draft.expenseKind,
          monthId: draft.invoiceMonthId,
          linkExpenseId: draft.linkExpenseId || "",
        },
      });
      if (state.data?.month?.id) {
        state.monthId = state.data.month.id;
        sessionStorage.setItem("monthId", state.monthId);
      }
      rememberMonth(state.data);
      state.notice = draft.expenseKind === "casa"
        ? "Pix lançado no custo de vida."
        : draft.linkExpenseId
          ? "Pix vinculado ao gasto."
          : `Lancei em ${draft.expenseKind === "planejado" ? "Planejado" : "Imprevisto"}, pago no Pix.`;
    } else if (draft.mode === "card-spend") {
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      const amountCents = parseMoney(draft.amount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe um valor maior que zero.");
      if (!draft.cardLabel) throw new Error("Escolha o cartão.");
      if (!["casa", "imprevisto", "planejado"].includes(draft.expenseKind)) throw new Error("Escolha a classificação.");
      if (!draft.invoiceMonthId) throw new Error("Escolha o mês da fatura.");
      if (!(state.data?.months || []).some((month) => month.id === draft.invoiceMonthId)) {
        throw new Error("Essa fatura está fora do período. Aumente o período ou escolha outro mês.");
      }
      draft.costMonthId = draft.costMonthId || state.monthId;
      if (!(state.data?.months || []).some((month) => month.id === draft.costMonthId)) {
        throw new Error(draft.expenseKind === "casa" ? "Escolha o mês do custo de vida." : "Escolha o mês deste gasto.");
      }
      const parcelado = draft.billing === "installments";
      const installmentCount = parcelado ? Number(draft.installmentCount) : 1;
      const installmentsPaid = parcelado ? Number(draft.installmentsPaid) : 0;
      const amountMode = parcelado && draft.amountMode === "total" ? "total" : "installment";
      if (parcelado && (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 48 || !Number.isInteger(installmentsPaid) || installmentsPaid < 0 || installmentsPaid >= installmentCount)) {
        throw new Error("Informe de 2 a 48 parcelas. As já pagas precisam ser menores que o total.");
      }
      if (parcelado && amountMode === "total" && Math.floor(amountCents / installmentCount) <= 0) {
        throw new Error("O valor total não cobre todas as parcelas.");
      }
      setWorking(true, "Lançando...");
      state.data = await request("/api/card-spend", {
        method: "POST",
        body: {
          name: draft.name.trim(),
          amountCents,
          cardLabel: draft.cardLabel,
          classification: draft.expenseKind,
          invoiceMonthId: draft.invoiceMonthId,
          costMonthId: draft.costMonthId,
          purchaseDate: draft.purchaseDate,
          linkExpenseId: draft.expenseKind === "casa" ? draft.linkExpenseId : "",
          installmentCount,
          installmentsPaid,
          amountMode: parcelado ? amountMode : "total",
        },
      });
      if (state.data?.month?.id) {
        state.monthId = state.data.month.id;
        sessionStorage.setItem("monthId", state.monthId);
      }
      rememberMonth(state.data);
      const invoice = monthName(draft.invoiceMonthId);
      const cost = monthName(draft.costMonthId || state.monthId);
      const place = draft.expenseKind === "casa" ? "Custo de vida" : draft.expenseKind === "planejado" ? "Planejado" : "Imprevisto";
      const remaining = installmentCount - installmentsPaid;
      state.notice = remaining > 1
        ? `Lancei ${remaining} parcelas a partir da fatura de ${invoice}. O gasto fica em ${cost}.`
        : draft.expenseKind === "casa" && draft.linkExpenseId
          ? `Vinculei ao custo de vida de ${cost}. O previsto continua e o valor entrou na fatura de ${invoice}.`
          : `Lancei em ${place} de ${cost}, na fatura de ${invoice}.`;
    } else if (draft.fromCard && draft.mode === "edit") {
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      let amountCents = parseMoney(draft.amount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe um valor maior que zero.");
      if (!["imprevisto", "planejado", "casa"].includes(draft.expenseKind)) {
        throw new Error("Escolha a classificação: Custo de vida, Planejado ou Imprevisto.");
      }
      if (!String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão deste gasto.");
      if (!draft.invoiceMonthId) throw new Error("Escolha o mês da fatura.");
      const parcelado = draft.billing === "installments";
      const installmentCount = parcelado ? Number(draft.installmentCount) : 1;
      const installmentsPaid = parcelado ? Number(draft.installmentsPaid) : 0;
      const amountMode = parcelado && draft.amountMode === "total" ? "total" : "installment";
      if (parcelado && (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 48 || !Number.isInteger(installmentsPaid) || installmentsPaid < 0 || installmentsPaid >= installmentCount)) {
        throw new Error("Informe de 2 a 48 parcelas. As já pagas precisam ser menores que o total.");
      }
      if (parcelado && amountMode === "total") {
        const per = Math.floor(amountCents / installmentCount);
        if (per <= 0) throw new Error("O valor total não cobre todas as parcelas.");
        amountCents = per;
      }
      const installment = parcelado ? `${installmentsPaid + 1}/${installmentCount}` : null;
      setWorking(true, "Salvando...");
      state.data = await request(`/api/expenses/${draft.id}/classification`, {
        method: "POST",
        body: {
          classification: draft.expenseKind,
          name: draft.name.trim(),
          amountCents,
          cardLabel: draft.cardLabel,
          note: draft.note || "",
          purchaseDate: draft.purchaseDate || "",
          invoiceMonthId: draft.invoiceMonthId,
          costMonthId: draft.costMonthId || draft.invoiceMonthId,
          linkExpenseId: draft.expenseKind === "casa" ? (draft.linkExpenseId || "") : "",
          installment,
        },
      });
      if (state.data?.month?.id) {
        state.monthId = state.data.month.id;
        sessionStorage.setItem("monthId", state.monthId);
      }
      rememberMonth(state.data);
      const moved = draft.expenseKind === "casa" ? "Custo de vida" : draft.expenseKind === "planejado" ? "Planejado" : "Imprevisto";
      state.notice = draft.expenseKind === "casa" && draft.linkExpenseId
        ? "Gasto atualizado e vinculado ao custo de vida."
        : draft.expenseKind === draft.originalKind
          ? "Gasto atualizado."
          : `Gasto atualizado. A classificação agora é ${moved}.`;
    } else {
      if (draft.cardExpense && draft.mode === "create") {
        draft.section = "card";
        draft.payment = "card";
        draft.onCard = false;
      } else if (draft.cardExpense && draft.section !== "fixed") {
        draft.payment = "card";
        draft.onCard = false;
      }
      let amountCents = parseMoney(draft.amount || "0");
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      if (amountCents === null) throw new Error("Informe o valor. Exemplo: 75,90");
      const variableCard = draft.mode === "create" && draft.section === "fixed" && !draft.cardExpense && draft.payment === "card" && draft.costKind === "variavel";
      if (variableCard && !String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão.");
      if (variableCard && amountCents <= 0) throw new Error("Informe o valor previsto.");
      const editingLiving = draft.mode === "edit" && draft.section === "fixed" && !draft.cardExpense;
      const seriesEdit = (editingLiving || (draft.mode === "edit" && draft.section === "card"))
        && (draft.editScope === "forward" || draft.editScope === "all");
      const wantsCard = editingLiving && draft.payment === "card";
      const chargeChanged = editingLiving && (
        amountCents !== draft.originalAmount
        || String(draft.cardLabel || "") !== String(draft.originalCard || "")
        || draft.name.trim() !== String(draft.originalName || "")
      );
      const relaunch = wantsCard && (!draft.wasOnCard || chargeChanged);
      if (editingLiving && wantsCard && !String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão.");
      if (relaunch && amountCents <= 0) throw new Error("Informe um valor maior que zero para lançar no cartão.");
      const needsCard = (draft.section === "extra" && draft.payment === "card")
        || (draft.section === "fixed" && draft.onCard)
        || (draft.cardExpense && draft.mode === "create");
      if (needsCard && !String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão deste gasto.");
      const onCardPurchase = draft.mode === "create" && !variableCard && draft.section !== "fixed" && (draft.section === "card" || draft.payment === "card");
      const totalCount = Number(draft.installmentCount);
      const paidCount = Number(draft.installmentsPaid);
      if (onCardPurchase && (!Number.isInteger(totalCount) || !Number.isInteger(paidCount))) {
        throw new Error("Informe as parcelas em números inteiros.");
      }
      const recurringMonths = draft.mode === "create" && draft.section === "fixed" && !draft.cardExpense
        ? recurringMonthIds(draft)
        : null;
      if (recurringMonths && !recurringMonths.length) {
        throw new Error("Escolha um período em que o fim não seja antes do início.");
      }
      if (draft.mode === "edit" && draft.section === "card") {
        if (!Number.isInteger(totalCount) || totalCount < 1 || totalCount > 48 || !Number.isInteger(paidCount) || paidCount < 0 || paidCount >= totalCount) {
          throw new Error("Informe as parcelas em números inteiros.");
        }
        if (draft.amountMode === "total") {
          const per = Math.floor(amountCents / totalCount);
          if (per <= 0) throw new Error("O valor total não cobre todas as parcelas.");
          amountCents = per;
        }
        draft.installment = totalCount > 1 ? `${paidCount + 1}/${totalCount}` : "";
        draft.payment = "card";
        draft.onCard = false;
      }
      const surpriseCard = draft.mode === "create" && !draft.cardExpense && draft.section === "extra" && draft.payment === "card";
      const startMonthId = surpriseCard ? (draft.invoiceMonthId || "") : state.monthId;
      if (surpriseCard && !startMonthId) throw new Error("Escolha a fatura em que o valor entra.");
      const invoiceLabel = (state.data?.months || []).find((month) => month.id === startMonthId)?.label || "";
      const dueMonth = relaunch ? draft.monthId : surpriseCard ? startMonthId : onCardPurchase ? state.monthId : "";
      const dueCard = dueMonth ? draft.cardLabel : "";
      if (dueCard && !acceptPastDue(pastDueWarning(dueCard, dueMonth))) return;
      setWorking(true, "Salvando...");
      const nextInvoiceFlag = draft.section === "fixed" && draft.payment === "card" && draft.invoiceTiming === "seguinte";
      const isVariable = draft.section === "fixed"
        ? (draft.payment === "card" && draft.costKind === "variavel")
        : Boolean(draft.variable);
      const body = {
        name: draft.name,
        amountCents,
        section: draft.section,
        payment: (draft.section === "fixed" && draft.onCard) || wantsCard ? "card" : draft.payment,
        onCard: draft.section === "fixed" && draft.onCard && !relaunch,
        cardLabel: draft.cardLabel,
        note: composeNote(draft.originId, draft.note, draft.partialId, draft.seriesId, isVariable, draft.section === "extra" && draft.expenseKind === "planejado", nextInvoiceFlag),
        installment: onCardPurchase ? null : draft.installment,
        paid: draft.paid,
        installmentPlan: onCardPurchase ? { totalCount, paidCount, amountMode: draft.amountMode || "installment" } : undefined,
        costKind: variableCard ? "variavel" : undefined,
        kind: draft.section === "extra" ? (draft.expenseKind === "planejado" ? "planejado" : "imprevisto") : undefined,
      };
      if (onCardPurchase) {
        const remaining = totalCount - paidCount;
        state.notice = surpriseCard
          ? (remaining > 1 ? `Lancei ${remaining} parcelas a partir da fatura de ${invoiceLabel}.` : `Lancei na fatura de ${invoiceLabel}.`)
          : (remaining > 1 ? `Lancei ${remaining} parcelas a partir deste mês.` : "");
      }
      if (draft.mode === "create") {
        state.data = await request("/api/expenses", {
          method: "POST",
          body: {
            ...body,
            monthId: startMonthId,
            monthIds: recurringMonths || undefined,
          },
        });
        if (variableCard) {
          state.notice = nextInvoiceFlag
            ? "Valor previsto para a fatura do mês seguinte. Nada entrou na fatura agora."
            : "Valor previsto. Nada entrou na fatura. Lance o total ou um parcial quando quiser. A despesa só encerra quando você pedir.";
        } else if (recurringMonths) {
          const span = recurringMonths.length > 1 ? ` em ${recurringMonths.length} meses` : "";
          state.notice = draft.payment === "card"
            ? (nextInvoiceFlag
              ? `Valor previsto${span}, marcado para entrar na fatura do mês seguinte.`
              : `Valor previsto${span}. O que faltar fica no cartão e o pagamento é feito em Cartões de crédito.`)
            : `Valor previsto${span}. O que faltar fica no Pix e o pagamento é feito em À vista.`;
        }
        if (surpriseCard && startMonthId !== state.monthId) await loadMonth(state.monthId);
        rememberMonth(state.data);
      } else if (seriesEdit) {
        const payment = draft.section === "card" || draft.payment === "card"
          ? "card"
          : "pix";
        state.data = await request(`/api/expenses/${draft.id}`, {
          method: "PATCH",
          body: {
            ...body,
            payment,
            cardLabel: draft.cardLabel,
            editScope: draft.editScope,
          },
        });
        rememberMonth(state.data);
        state.notice = draft.editScope === "all"
          ? "Alterei todos os registros."
          : "Alterei este mês e os seguintes.";
      } else if (editingLiving) {
        const keepOnCard = draft.wasOnCard && draft.payment === "card" && draft.costKind !== "variavel" && !nextInvoiceFlag;
        state.data = await request(`/api/expenses/${draft.id}`, {
          method: "PATCH",
          body: {
            ...body,
            payment: draft.payment,
            onCard: keepOnCard,
            paid: keepOnCard ? draft.paid : (draft.wasOnCard ? false : draft.paid),
          },
        });
        state.notice = "Atualizei o previsto. O pagamento continua em Cartões de crédito ou À vista.";
        rememberMonth(state.data);
      } else {
        state.data = await request(`/api/expenses/${draft.id}`, { method: "PATCH", body });
        rememberMonth(state.data);
      }
    }
    state.sheet = null;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}
