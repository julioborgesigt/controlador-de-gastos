import { parseMoney } from "../../format.js";
import { loadMonth, rememberMonth, request } from "../api.js";
import { savePeriod } from "../setup.js";
import { setWorking, state } from "../state.js";
import { cardClosingDay, cardDueDay, sameCardName } from "../views/card-helpers.js";
import { saveNubankImportSheet } from "./import-nubank.js";

export async function saveAccountSheet(draft) {
  if (draft.mode === "import-nubank") {
    return saveNubankImportSheet(draft);
  }
  if (draft.mode === "share") {
    setWorking(true, "Salvando...");
    const data = await request("/api/shares", { method: "POST", body: { cpf: draft.cpf, permission: draft.permission } });
    state.shares = data.shares || [];
    draft.cpf = "";
    state.notice = "Compartilhamento salvo.";
    const spaces = await request("/api/spaces");
    state.spaces = spaces.spaces || state.spaces;
    return "keep";
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
    return "close";
  }

  if (draft.mode === "income-extra") {
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
    return "close";
  }

  if (draft.mode === "period") {
    await savePeriod(draft, false);
    return "keep";
  }

  if (draft.mode === "password") {
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
    return "close";
  }

  if (draft.mode === "card") {
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
    return "close";
  }

  return null;
}
