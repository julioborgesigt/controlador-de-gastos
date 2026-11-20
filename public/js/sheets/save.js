import { composeNote, money, nextMonthId, parseMoney } from "../../format.js";
import { quoteInstallments } from "../../installment-link.js";
import { loadMonth, rememberMonth, request } from "../api.js";
import { livingChargeIsFull } from "../dialogs/expense-info.js";
import { messageOf, monthName } from "../dom.js";
import { savePeriod } from "../setup.js";
import { renderSafely, setWorking, state } from "../state.js";
import {
  acceptPastDue,
  cardClosingDay,
  cardDueDay,
  pastDueWarning,
  sameCardName,
} from "../views/card-helpers.js";
import { deleteExpenseNow } from "../views/expenses.js";
import { faturaWhen, recurringMonthIds } from "./fields.js";

export async function saveSheet(event) {
  event.preventDefault();
  const draft = state.sheet;
  state.error = "";
  state.notice = "";
  try {
    if (draft.mode === "passkey" || draft.mode === "undo-payments") return;
    if (draft.mode === "close-living") {
      setWorking(true, "Finalizando...");
      state.data = await request(`/api/expenses/${draft.id}/settle`, {
        method: "POST",
        body: { useRegistered: false, noAddition: true, amountCents: 0 },
      });
      rememberMonth(state.data);
      state.notice = `“${draft.name}” finalizada com custo de ${money(draft.already || 0)} neste mês.`;
      state.sheet = null;
      return;
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
        if (!acceptPastDue(pastDueWarning(draft.cardLabel, draft.invoiceMonthId))) return;
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
      state.sheet = null;
      return;
    }
    if (draft.mode === "delete-expense") {
      const scope = draft.scope === "series" || draft.scope === "forward" ? draft.scope : "month";
      await deleteExpenseNow(draft, scope);
      return;
    }
    if (draft.mode === "undo-card") {
      const scope = draft.scope === "series" ? "series" : "month";
      setWorking(true, "Tirando do cartão...");
      state.data = await request(`/api/expenses/${draft.id}/card-payment?scope=${scope}`, { method: "DELETE" });
      rememberMonth(state.data);
      state.notice = scope === "series"
        ? `Tirei “${draft.name}” do cartão em todos os meses em que estava lançado.`
        : `Tirei “${draft.name}” do cartão neste mês.`;
      state.sheet = null;
      return;
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
        state.sheet = null;
        return;
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
      if (!acceptPastDue(pastDueWarning(draft.cardLabel, draft.invoiceMonthId))) return;
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
      state.sheet = null;
      return;
    } else if (draft.mode === "share") {
      setWorking(true, "Salvando...");
      const data = await request("/api/shares", { method: "POST", body: { cpf: draft.cpf, permission: draft.permission } });
      state.shares = data.shares || [];
      draft.cpf = "";
      state.notice = "Compartilhamento salvo.";
      const spaces = await request("/api/spaces");
      state.spaces = spaces.spaces || state.spaces;
      return;
    }
    if (draft.mode === "month-income") {
      const incomeCents = parseMoney(draft.amount);
      if (incomeCents === null) throw new Error("Informe a receita. Exemplo: 9800,00");
      const extras = [];
      for (const extra of draft.extras || []) {
        const amountCents = parseMoney(extra.amount || "");
        if (amountCents === null || amountCents <= 0) throw new Error(`Informe o valor de ${extra.name}. Exemplo: 1200,00`);
        extras.push({ id: extra.id, amountCents });
      }
      setWorking(true, "Salvando...");
      await request(`/api/months/${draft.monthId}`, { method: "PATCH", body: { incomeCents } });
      for (const extra of extras) {
        state.data = await request(`/api/income/extras/${extra.id}`, {
          method: "PATCH",
          body: { amountCents: extra.amountCents, focusMonthId: state.monthId },
        });
      }
      await loadMonth(state.monthId);
    } else if (draft.mode === "income-extra") {
      const amountCents = parseMoney(draft.amount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe o valor da receita extra.");
      if (draft.kind === "other" && !String(draft.name || "").trim()) throw new Error("Dê um nome para essa receita.");
      if (!draft.id && !(draft.monthIds || []).length) throw new Error("Escolha ao menos um mês.");
      setWorking(true, "Salvando...");
      if (draft.id) {
        state.data = await request(`/api/income/extras/${draft.id}`, {
          method: "PATCH",
          body: { kind: draft.kind, name: draft.name, amountCents, monthId: draft.monthId, focusMonthId: state.monthId },
        });
      } else {
        const count = draft.monthIds.length;
        state.data = await request("/api/income/extras", {
          method: "POST",
          body: { kind: draft.kind, name: draft.name, amountCents, monthIds: draft.monthIds, monthId: state.monthId },
        });
        state.notice = count > 1 ? `Receita extra lançada em ${count} meses.` : "";
      }
      rememberMonth(state.data);
    } else if (draft.mode === "period") {
      await savePeriod(draft, false);
      return;
    } else if (draft.mode === "password") {
      if (draft.next !== draft.confirmation) throw new Error("A confirmação da senha não confere.");
      setWorking(true, "Salvando...");
      const data = await request("/api/password", {
        method: "POST",
        body: { currentPassword: draft.current, nextPassword: draft.next, passwordConfirmation: draft.confirmation },
      });
      state.passkeys = [];
      if (data.passkeysRemoved) {
        state.notice = "Senha trocada. As digitais cadastradas foram removidas. Cadastre de novo neste celular se quiser entrar com a digital.";
      }
    } else if (draft.mode === "card-payoff") {
      const hasDown = String(draft.down || "").trim() !== "";
      const downCents = hasDown ? parseMoney(draft.down) : 0;
      const count = Number(draft.count);
      const installmentCents = parseMoney(draft.per || "");
      if (hasDown && (downCents === null || downCents < 0)) throw new Error("Informe a entrada. Exemplo: 200,00. Deixe em branco se não houver.");
      if (!Number.isInteger(count) || count < 2 || count > 48) throw new Error("Informe de 2 a 48 parcelas.");
      if (installmentCents === null || installmentCents <= 0) throw new Error("Informe o valor da parcela.");
      if (!draft.startMonthId) throw new Error("Escolha o mês em que o parcelamento começa.");
      if (!acceptPastDue(pastDueWarning(draft.cardName, draft.startMonthId))) return;
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
    } else if (draft.mode === "cash-spend") {
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
    } else if (draft.mode === "card") {
      if (!draft.name.trim()) throw new Error("Dê um apelido ao cartão.");
      const dueDay = cardDueDay(draft.dueDay);
      const closingDay = cardClosingDay(draft.closingDay);
      if (dueDay === null) throw new Error("Informe o dia de vencimento, de 1 a 31.");
      if (closingDay === null) throw new Error("Informe o dia de fechamento, de 1 a 31.");
      setWorking(true, "Salvando...");
      const data = await request(draft.id ? `/api/cards/${draft.id}` : "/api/cards", {
        method: draft.id ? "PATCH" : "POST",
        body: { name: draft.name, dueDay, closingDay },
      });
      const saved = (data.cards || []).find((card) => card.id === draft.id);
      const nextName = saved?.name || draft.name.trim();
      if (draft.previousName) {
        for (const expense of state.data.expenses || []) {
          if (sameCardName(expense.cardLabel, draft.previousName)) expense.cardLabel = nextName;
          for (const partial of expense.partials || []) {
            if (sameCardName(partial.cardLabel, draft.previousName)) partial.cardLabel = nextName;
          }
        }
      }
      state.data.cards = data.cards;
      rememberMonth(state.data);
    } else if (draft.fromCard && draft.mode === "edit") {
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      const amountCents = parseMoney(draft.amount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe um valor maior que zero.");
      if (!["imprevisto", "planejado", "casa"].includes(draft.expenseKind)) {
        throw new Error("Escolha a tarja: Imprevisto, Planejado ou Custo de vida.");
      }
      if (!String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão deste gasto.");
      setWorking(true, "Salvando...");
      state.data = await request(`/api/expenses/${draft.id}/classification`, {
        method: "POST",
        body: {
          classification: draft.expenseKind,
          name: draft.name.trim(),
          amountCents,
          cardLabel: draft.cardLabel,
          note: draft.note,
        },
      });
      rememberMonth(state.data);
      const moved = draft.expenseKind === "casa" ? "Custo de vida" : draft.expenseKind === "planejado" ? "Planejado" : "Imprevisto";
      state.notice = draft.expenseKind === draft.originalKind
        ? "Gasto atualizado."
        : `Gasto atualizado. A tarja agora é ${moved}.`;
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
