import { centsToInput, money, parseMoney } from "../../format.js";
import { quoteInstallments, solveInstallmentTriple } from "../../installment-link.js";
import { isNubankName } from "../../shared/nubank-csv.js";
import { request } from "../api.js";
import { el, messageOf, on, shortMonth } from "../dom.js";
import { render, renderSafely, setWorking, state } from "../state.js";
import { cardPayoffPreview, firstCardName } from "../views/card-helpers.js";
import { applyInvoiceSuggestion, refreshInvoiceChoice } from "./openers.js";

export function cardPurchaseFields(draft) {
  if (draft.mode !== "create" || draft.section === "fixed" || (draft.section !== "card" && draft.payment !== "card")) return "";
  return el("div", {}, [
    el("div", { class: "pair" }, [
      field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "1", "numeric"),
      field("Parcelas já pagas", "installmentsPaid", draft.installmentsPaid || "0", "numeric"),
    ]),
    el("div", { class: "field" }, [
      el("label", {}, "O valor informado é"),
      segmented("amountMode", [["installment", "Da parcela"], ["total", "Da compra toda"]], draft.amountMode || "installment"),
    ]),
    el("p", { class: "muted", id: "installment-preview" }, installmentPreview(draft)),
  ]);
}

export function cardPayPreview(draft) {
  const alias = String(draft.alias || "").trim() || "o apelido";
  const card = draft.cardLabel ? `do ${draft.cardLabel}` : "do cartão";
  const when = faturaWhen(draft.invoiceMonthId);
  if (draft.billing === "installments") {
    const charged = parseMoney(draft.chargedAmount || "");
    const count = installmentCountOf(draft);
    const per = parseMoney(draft.installmentAmount || "");
    const from = faturaWhen(draft.invoiceMonthId, true);
    if (count === null || count < 2 || per === null || per <= 0) {
      return `As parcelas entram ${from}, com o apelido escolhido.`;
    }
    const quote = quoteInstallments(charged, count, per);
    if (quote?.kind === "remainder") {
      return `${count - 1} ${count - 1 === 1 ? "parcela" : "parcelas"} de ${money(per)} e a última de ${money(quote.lastCents)} ${from} ${card}, como “${alias}”.`;
    }
    if (quote?.kind === "mismatch") {
      return `${count} parcelas de ${money(per)} somam ${money(per * count)}. O valor cobrado está em ${money(charged)}.`;
    }
    return `${count} parcelas de ${money(per)} ${from} ${card}, como “${alias}”.`;
  }
  const amount = draft.amountChoice === "other" ? parseMoney(draft.chargedAmount || "") : draft.described;
  if (amount === null || amount <= 0) return `O valor entra ${when}, com o apelido escolhido.`;
  return `${money(amount)} ${when} ${card}, como “${alias}”.`;
}

export function faturaWhen(monthId, from = false) {
  const month = (state.data?.months || []).find((item) => item.id === monthId);
  const [name, year] = String(month?.label || "").split(" ");
  const when = name && year ? `${name.toLowerCase()} de ${year}` : "este mês";
  return from ? `a partir da fatura de ${when}` : `na fatura de ${when}`;
}

function installmentCountOf(draft) {
  const raw = String(draft.installmentCount || "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const count = Number(raw);
  return count >= 1 && count <= 48 ? count : null;
}

function readInstallmentTriple(draft) {
  return {
    chargedCents: parseMoney(String(draft.chargedAmount || "")),
    count: installmentCountOf(draft),
    perCents: parseMoney(String(draft.installmentAmount || "")),
  };
}

function applySolvedInstallments(draft, solved, edited) {
  draft.amountEdits = solved.edits;
  if (edited !== "charged" && solved.values.chargedCents != null) {
    draft.chargedAmount = centsToInput(solved.values.chargedCents);
  }
  if (edited !== "count" && solved.values.count != null) {
    draft.installmentCount = String(solved.values.count);
  }
  if (edited !== "per" && solved.values.perCents != null) {
    draft.installmentAmount = centsToInput(solved.values.perCents);
  }
}

function prepareCardInstallments(draft) {
  if (!String(draft.chargedAmount || "").trim() && draft.amountChoice === "same" && draft.described > 0) {
    draft.chargedAmount = centsToInput(draft.described);
  }
  if (!String(draft.installmentCount || "").trim()) draft.installmentCount = "2";
  if ((draft.amountEdits || []).includes("per")) return;
  const solved = solveInstallmentTriple(readInstallmentTriple(draft), "count", ["charged"], draft.amountChoice === "same" ? "charged" : null);
  applySolvedInstallments(draft, solved, "count");
}

function linkCardPayAmounts(editedKey) {
  const draft = state.sheet;
  const edited = editedKey === "chargedAmount" ? "charged" : editedKey === "installmentCount" ? "count" : "per";
  if (editedKey === "chargedAmount") draft.amountChoice = "other";
  const locked = draft.amountChoice === "same" ? "charged" : null;
  const solved = solveInstallmentTriple(readInstallmentTriple(draft), edited, draft.amountEdits || [], locked);
  applySolvedInstallments(draft, solved, edited);
  if (draft.amountChoice === "other") reflectSegment("amountChoice", "other");
  reflectInstallmentInputs(editedKey);
  refreshCardPayPreview();
}

function reflectInstallmentInputs(editedKey) {
  const draft = state.sheet;
  const values = {
    chargedAmount: draft.chargedAmount,
    installmentCount: draft.installmentCount,
    installmentAmount: draft.installmentAmount,
  };
  for (const [id, value] of Object.entries(values)) {
    if (id === editedKey || value == null) continue;
    const input = document.getElementById(id);
    if (input && input.value !== value) input.value = value;
  }
}

function reflectSegment(key, value) {
  document.querySelectorAll(`[data-segment="${key}"]`).forEach((button) => {
    button.classList.toggle("on", button.dataset.value === value);
  });
}

function refreshCardPayPreview() {
  const preview = document.querySelector("#installment-preview");
  if (!preview || !state.sheet) return;
  preview.textContent = state.sheet.mode === "card-pay" ? cardPayPreview(state.sheet) : installmentPreview(state.sheet);
}

export function invoiceMonthField(draft, labelText = "Este valor será pago na fatura de:") {
  const months = state.data?.months || [];
  const select = el("select", { id: "invoiceMonthId", name: "invoiceMonthId" });
  if (draft.invoiceMonthId && !months.some((month) => month.id === draft.invoiceMonthId)) {
    select.append(el("option", { value: draft.invoiceMonthId }, draft.invoiceMonthId));
  }
  for (const month of months) select.append(el("option", { value: month.id }, month.label));
  select.value = draft.invoiceMonthId || "";
  on(select, "change", (event) => {
    state.sheet.invoiceMonthId = event.currentTarget.value;
    refreshCardPayPreview();
  });
  return el("div", { class: "field" }, [
    el("label", { for: "invoiceMonthId" }, labelText),
    select,
  ]);
}

export async function undoCardPay(id) {
  state.error = "";
  setWorking(true, "Desfazendo...");
  try {
    state.data = await request(`/api/expenses/${id}/card-payment`, { method: "DELETE" });
    state.sheet = null;
    state.notice = "O pagamento no cartão foi desfeito e saiu da fatura.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export function installmentPreview(draft) {
  const total = Number(draft.installmentCount);
  const paid = Number(draft.installmentsPaid);
  const amount = parseMoney(draft.amount || "");
  const when = draft.invoiceMonthId ? faturaWhen(draft.invoiceMonthId, true) : "";
  const valid = Number.isInteger(total) && total >= 1 && Number.isInteger(paid) && paid >= 0 && paid < total && amount !== null && amount > 0;
  if (draft.mode === "edit") {
    if (!valid) return "A quantidade e as parcelas já pagas descrevem esta linha da fatura.";
    const per = draft.amountMode === "total" ? Math.floor(amount / total) : amount;
    if (per <= 0) return "O valor total não cobre todas as parcelas.";
    if (total <= 1) return `${money(per)} nesta fatura.`;
    return `Esta linha é a parcela ${paid + 1}/${total}, de ${money(per)}.`;
  }
  if (!valid) {
    return when
      ? `O pagamento entra ${when}.`
      : "A parcela deste mês é a primeira que ainda falta pagar. As seguintes entram nos próximos meses.";
  }
  const per = draft.amountMode === "total" ? Math.floor(amount / total) : amount;
  const remaining = total - paid;
  if (when && remaining <= 1) return `${money(per)} ${faturaWhen(draft.invoiceMonthId)}.`;
  if (when) return `${remaining} parcelas de ${money(per)} ${when} (${paid + 1}/${total}).`;
  return `${remaining} ${remaining === 1 ? "parcela" : "parcelas"} de ${money(per)} a partir deste mês (${paid + 1}/${total}).`;
}

export function installmentDraft(installment) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(installment || "").trim());
  if (!match) return { installmentCount: "1", installmentsPaid: "0" };
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || current < 1 || current > total) return { installmentCount: "1", installmentsPaid: "0" };
  return { installmentCount: String(total), installmentsPaid: String(current - 1) };
}

export function monthSelect(selected) {
  const select = el("select", { id: "extra-month" }, state.data.months.map((month) => {
    const option = el("option", { value: month.id }, month.label);
    if (month.id === selected) option.selected = true;
    return option;
  }));
  on(select, "change", (event) => {
    state.sheet.monthId = event.currentTarget.value;
  });
  return el("div", { class: "field" }, [el("label", { for: "extra-month" }, "Mês"), select]);
}

export function monthChecks() {
  const selected = new Set(state.sheet.monthIds || []);
  return el("div", { class: "field" }, [
    el("div", { class: "row-between" }, [
      el("label", {}, "Meses"),
      el("button", {
        class: "linkish",
        type: "button",
        onclick: () => {
          const all = state.data.months.map((month) => month.id);
          state.sheet.monthIds = selected.size === all.length ? [] : all;
          render();
        },
      }, selected.size === state.data.months.length ? "Limpar" : "Todos"),
    ]),
    el("div", { class: "month-picks" }, state.data.months.map((month) => el("button", {
      type: "button",
      class: selected.has(month.id) ? "on" : "",
      onclick: () => {
        const next = new Set(state.sheet.monthIds || []);
        if (next.has(month.id)) next.delete(month.id);
        else next.add(month.id);
        state.sheet.monthIds = [...next];
        render();
      },
    }, shortMonth(month)))),
  ]);
}

export function recurringMonthIds(draft) {
  const months = state.data?.months || [];
  const ids = months.map((month) => month.id);
  const span = draft.span || (draft.repeat === "period" ? "period" : "all");
  if (span === "month") return state.monthId ? [state.monthId] : [];
  if (span === "following") return ids.filter((id) => id >= state.monthId);
  if (span === "period") {
    const start = months.findIndex((month) => month.id === draft.repeatStart);
    const end = months.findIndex((month) => month.id === draft.repeatEnd);
    if (start < 0 || end < 0 || end < start) return [];
    return ids.slice(start, end + 1);
  }
  return ids;
}

function managedMonthSelect(draft, key, label) {
  const months = state.data?.months || [];
  const select = el("select", { id: key }, months.map((month) => el("option", { value: month.id }, month.label)));
  select.value = draft[key] || months[0]?.id || "";
  on(select, "change", (event) => {
    draft[key] = event.currentTarget.value;
  });
  return el("div", { class: "field" }, [el("label", { for: key }, label), select]);
}

export function livingPay(draft) {
  const payment = draft.payment === "card" ? "card" : "pix";
  const costKind = draft.costKind === "variavel" ? "variavel" : "fixo";
  return el("div", {}, [
    el("div", { class: "field" }, [
      el("label", {}, "Como pretende pagar"),
      segmented("payment", [["pix", "Pix"], ["card", "Crédito"]], payment),
    ]),
    payment === "card" ? cardSelect(draft) : "",
    payment === "card"
      ? el("div", { class: "field" }, [
        el("label", {}, "Tipo do custo"),
        segmented("costKind", [["fixo", "Fixo"], ["variavel", "Variável"]], costKind),
      ])
      : "",
    payment === "card"
      ? el("div", { class: "field" }, [
        el("label", {}, "Os gastos entram na fatura"),
        segmented("invoiceTiming", [["mes", "Deste mês"], ["seguinte", "Do mês seguinte"]], draft.invoiceTiming === "seguinte" ? "seguinte" : "mes"),
      ])
      : "",
    el("p", { class: "muted" }, payment === "card" && draft.invoiceTiming === "seguinte"
      ? "O valor fica previsto neste mês e entra em falta no cartão (previsto para a fatura do mês seguinte)."
      : payment === "card" && costKind === "variavel"
      ? "O valor fica previsto. O que faltar entra em falta no cartão. O pagamento é feito em Cartões de crédito."
      : payment === "card"
      ? "O valor fica previsto e entra em falta no cartão. Nada vai para a fatura agora. O pagamento é feito em Cartões de crédito."
      : "O valor fica previsto e entra em falta no Pix. O pagamento é feito em À vista."),
  ]);
}

export function recurringSpan(draft) {
  const span = draft.span || "all";
  const copy = span === "period"
    ? "A conta prevista entra em cada mês do intervalo."
    : span === "month"
      ? "A conta prevista entra só neste mês."
      : span === "following"
        ? "A conta prevista entra neste mês e nos seguintes."
        : "A conta prevista entra em todos os meses do período.";
  return el("div", { class: "field" }, [
    el("label", {}, "Em quais meses"),
    segmented("span", [
      ["month", "Só este mês"],
      ["following", "Este mês e os seguintes"],
      ["all", "Todos os meses"],
      ["period", "Um período"],
    ], span),
    el("p", { class: "muted" }, copy),
    span === "period"
      ? el("div", { class: "pair" }, [
        managedMonthSelect(draft, "repeatStart", "Do mês"),
        managedMonthSelect(draft, "repeatEnd", "Até o mês"),
      ])
      : "",
  ]);
}

export function editScopeField(draft) {
  const scope = draft.editScope === "forward" || draft.editScope === "all" ? draft.editScope : "month";
  const card = draft.section === "card";
  return el("div", { class: "field" }, [
    el("label", {}, "Aplicar a alteração em"),
    segmented("editScope", [
      ["month", "Só este mês"],
      ["forward", "Este mês e os seguintes"],
      ["all", "Todos os meses"],
    ], scope),
    el("p", { class: "muted" }, scope === "all"
      ? (card
        ? "Nome, valor e cartão mudam em todas as parcelas deste gasto."
        : "Nome, valor e forma de pagamento mudam em todos os meses desta conta.")
      : scope === "forward"
        ? "Muda neste mês e nos seguintes. Os meses anteriores ficam como estão."
        : "Muda só o mês que está aberto."),
  ]);
}

export function closeAfterField(draft) {
  const closeAfter = draft.closeAfter === "close" ? "close" : "open";
  return el("div", { class: "field" }, [
    el("label", {}, "Depois deste lançamento"),
    segmented("closeAfter", [["open", "Deixar em aberto"], ["close", "Finalizar despesa"]], closeAfter),
    el("p", { class: "muted" }, closeAfter === "close"
      ? "Finalizar considera o custo atual para o mês e coloca a tarja Finalizada."
      : "A conta continua em aberto. Dá para lançar outro pagamento depois, tocando nela."),
  ]);
}

export function cardSelect(draft) {
  const cards = state.data?.cards ?? [];
  const required = draft.fromCard || draft.mode === "card-spend" || draft.mode === "card-pay" || draft.mode === "partial"
    || (draft.section === "extra" && (draft.payment === "card" || draft.cardExpense))
    || (draft.section === "fixed" && (draft.onCard || draft.payment === "card"))
    || (draft.section === "card" && (draft.cardExpense || draft.mode === "create"));
  const current = draft.cardLabel || "";
  const known = cards.some((card) => card.name === current);
  const select = el("select", { id: "cardLabel", name: "cardLabel" });
  if (!required || !current) select.append(el("option", { value: "" }, required ? "Escolha o cartão" : "Sem cartão"));
  if (current && !known) select.append(el("option", { value: current }, current));
  for (const card of cards) select.append(el("option", { value: card.name }, card.name));
  select.value = current;
  on(select, "change", (event) => {
    state.sheet.cardLabel = event.currentTarget.value;
    if (state.sheet.mode === "card-spend") {
      state.sheet.invoiceTouched = false;
      applyInvoiceSuggestion(state.sheet);
      if (!refreshInvoiceChoice(state.sheet)) render();
      return;
    }
    refreshCardPayPreview();
  });
  return el("div", { class: "field" }, [el("label", { for: "cardLabel" }, "Cartão"), select]);
}

export function field(labelText, key, value, mode, placeholder = "") {
  const input = el(key === "note" ? "textarea" : "input", {
    id: key,
    name: key,
    type: mode === "password" ? "password" : undefined,
    value,
    placeholder,
    autocomplete: mode === "password" ? "new-password" : undefined,
    inputmode: mode === "decimal" ? "decimal" : mode === "numeric" ? "numeric" : "text",
  });
  on(input, "input", (event) => {
    const prevValue = state.sheet[key];
    state.sheet[key] = event.currentTarget.value;
    if (state.sheet.mode === "card" && key === "name" && isNubankName(prevValue) !== isNubankName(state.sheet[key])) {
      render();
      return;
    }
    if (state.sheet.mode === "card-pay" && state.sheet.billing === "installments" && (key === "chargedAmount" || key === "installmentCount" || key === "installmentAmount")) {
      linkCardPayAmounts(key);
      return;
    }
    const preview = document.querySelector("#installment-preview");
    if (preview && state.sheet) {
      preview.textContent = state.sheet.mode === "card-pay" ? cardPayPreview(state.sheet) : installmentPreview(state.sheet);
    }
    const payoff = document.querySelector("#card-payoff-preview");
    if (payoff && state.sheet?.mode === "card-payoff") payoff.textContent = cardPayoffPreview(state.sheet);
  });
  return el("div", { class: "field" }, [el("label", { for: key }, labelText), input]);
}

export function segmented(key, options, current) {
  return el("div", { class: "choice" }, options.map(([value, label]) => el("button", {
    type: "button",
    class: current === value ? "on" : "",
    "aria-pressed": current === value ? "true" : "false",
    "data-segment": key,
    "data-value": value,
    onclick: () => {
      state.sheet[key] = value;
      if (state.sheet.mode === "card-pay" && key === "billing" && value === "installments") prepareCardInstallments(state.sheet);
      if (state.sheet.mode === "card-pay" && key === "amountChoice" && value === "same") {
        state.sheet.chargedAmount = state.sheet.described > 0 ? centsToInput(state.sheet.described) : "";
        if (state.sheet.billing === "installments") {
          const solved = solveInstallmentTriple(readInstallmentTriple(state.sheet), "charged", ["count"]);
          applySolvedInstallments(state.sheet, solved, "charged");
        }
      }
      if (key === "section") {
        if (value === "card") {
          state.sheet.payment = "card";
          state.sheet.onCard = false;
        }
        if (value === "extra") state.sheet.onCard = false;
        if (value === "fixed") state.sheet.payment = state.sheet.onCard ? "card" : "pix";
      }
      if (key === "expenseKind") {
        state.sheet.linkExpenseId = "";
        state.sheet.linkChoices = null;
        state.sheet.linkKey = "";
        state.sheet.linkLoading = "";
        state.sheet.linkError = "";
        if (value === "casa" && !state.sheet.costMonthId) state.sheet.costMonthId = state.monthId;
      }
      if (key === "span") state.sheet.spanChosen = true;
      if (key === "costKind") state.sheet.variable = value === "variavel";
      if ((key === "payment" || key === "costKind") && state.sheet.section === "fixed" && state.sheet.mode === "create" && !state.sheet.spanChosen) {
        const payment = key === "payment" ? value : state.sheet.payment;
        const kind = key === "costKind" ? value : state.sheet.costKind;
        state.sheet.span = payment === "card" && kind !== "variavel" ? "month" : "all";
      }
      if (key === "billing" && value === "installments" && state.sheet.mode === "card-spend") {
        if (Number(state.sheet.installmentCount) < 2) state.sheet.installmentCount = "2";
        if (state.sheet.installmentsPaid == null || state.sheet.installmentsPaid === "") state.sheet.installmentsPaid = "0";
        if (!state.sheet.amountMode) state.sheet.amountMode = "installment";
      }
      if (key === "payment" && value === "card") {
        state.sheet.onCard = state.sheet.section === "fixed" && state.sheet.mode !== "create";
        if (!state.sheet.cardLabel) state.sheet.cardLabel = firstCardName();
        if (!state.sheet.invoiceMonthId) state.sheet.invoiceMonthId = state.monthId;
      }
      if (key === "payment" && value !== "card" && state.sheet.section === "fixed") {
        state.sheet.onCard = false;
      }
      if (key === "section" && value === "card" && !state.sheet.cardLabel) state.sheet.cardLabel = firstCardName();
      render();
    },
  }, label)));
}
