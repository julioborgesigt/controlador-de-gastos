import { isPlannedNote, money } from "../../format.js";
import { ensureLinkChoices } from "../api.js";
import { titleWithHelp } from "../dialogs/info.js";
import { el, historyWhen, monthName } from "../dom.js";
import { field, segmented } from "../sheets/fields.js";
import { closeSheet, livingLinkSelect, livingLinkStatus, paintLivingLinks } from "../sheets/openers.js";
import { editable, render, state } from "../state.js";

function cashKind(expense) {
  if (expense.section === "fixed") return "Custo de vida";
  return isPlannedNote(expense.note) ? "Planejado" : "Imprevisto";
}

function cashHistoryEntries(data) {
  const entries = [];
  for (const expense of data.expenses || []) {
    const pixPartials = (expense.partials || []).filter((partial) => partial.payment !== "card");
    if (pixPartials.length) {
      for (const partial of pixPartials) {
        entries.push({
          id: partial.id,
          at: partial.createdAt || "",
          name: expense.name,
          kind: cashKind(expense),
          amountCents: partial.amountCents,
        });
      }
      continue;
    }
    const wholePix = expense.amountCents > 0 && expense.payment !== "card" && (
      (expense.section === "extra" && expense.paid)
      || (expense.section === "fixed" && expense.paid)
    );
    if (!wholePix) continue;
    entries.push({
      id: expense.id,
      at: expense.createdAt || "",
      name: expense.name,
      kind: cashKind(expense),
      amountCents: expense.amountCents,
    });
  }
  entries.sort((left, right) => String(right.at).localeCompare(String(left.at)) || right.id.localeCompare(left.id));
  return entries;
}

export function cashHome(data) {
  const entries = cashHistoryEntries(data);
  const total = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  return el("section", {}, [
    el("div", { class: "section-head" }, [
      titleWithHelp(data.month.label, "À vista", [
        "O custo de vida precisa já estar previsto. O Pix lançado aqui abate esse custo.",
        "Imprevisto e planejado nascem nesta aba e já ficam pagos no Pix.",
        "O histórico abaixo reúne os lançamentos à vista deste mês.",
      ]),
      el("h2", {}, money(total)),
      el("p", { class: "muted" }, "Pagamentos à vista deste mês, no Pix."),
    ]),
    editable() ? el("button", { class: "primary add-top", type: "button", onclick: openCashSpend }, "Lançar à vista") : "",
    el("h2", { class: "subhead" }, "Histórico"),
    entries.length
      ? el("div", { class: "list" }, entries.map((entry) => {
        const sourceClass = entry.kind === "Planejado" ? "badge source-planned" : entry.kind === "Imprevisto" ? "badge source-extra" : "badge source-fixed";
        return el("article", { class: "item" }, [
          el("div", { class: "item-copy" }, [
            el("strong", {}, entry.name),
            ...[historyWhen(entry.at), "Pix"].filter(Boolean).map((line) => el("small", {}, line)),
          ]),
          el("div", { class: "item-end" }, [
            entry.kind ? el("div", { class: "badges" }, [el("span", { class: sourceClass }, entry.kind)]) : "",
            el("span", { class: "amount" }, money(entry.amountCents)),
          ]),
        ]);
      }))
      : el("p", { class: "muted" }, "Nenhum lançamento à vista neste mês."),
  ]);
}

export function openCashSpend(kind = "casa") {
  const expenseKind = kind === "planejado" || kind === "imprevisto" || kind === "casa" ? kind : "casa";
  state.sheet = {
    mode: "cash-spend",
    name: "",
    amount: "",
    expenseKind,
    invoiceMonthId: state.monthId,
    invoiceTouched: true,
    linkExpenseId: "",
  };
  state.error = "";
  render();
}

export function cashSpendFields(draft) {
  const months = state.data?.months || [];
  const monthSelect = el("select", { id: "invoiceMonthId" }, months.map((month) => el("option", { value: month.id }, month.label)));
  if (draft.invoiceMonthId) monthSelect.value = draft.invoiceMonthId;
  monthSelect.addEventListener("change", () => {
    if (draft.invoiceMonthId !== monthSelect.value) {
      draft.linkExpenseId = "";
      draft.linkChoices = null;
      draft.linkKey = "";
      draft.linkLoading = "";
      draft.linkError = "";
    }
    draft.invoiceMonthId = monthSelect.value;
    ensureLinkChoices(draft);
    if (!paintLivingLinks(draft)) render();
  });
  if (draft.expenseKind === "casa") ensureLinkChoices(draft);
  const link = livingLinkSelect(draft);
  return [
    el("h2", {}, "Lançar à vista"),
    field("Valor", "amount", draft.amount, "decimal"),
    el("div", { class: "field" }, [
      el("label", {}, "Classificação"),
      segmented("expenseKind", [
        ["casa", "Custo de vida"],
        ["imprevisto", "Imprevisto"],
        ["planejado", "Planejado"],
      ], draft.expenseKind || "casa"),
    ]),
    el("div", { class: "field" }, [el("label", { for: "invoiceMonthId" }, "Mês"), monthSelect]),
    draft.expenseKind === "casa"
      ? el("div", { class: "field" }, [
        el("label", { id: "link-label", for: "linkExpenseId" }, `Custo de vida de ${monthName(draft.invoiceMonthId) || "este mês"}`),
        link,
        el("p", { class: "muted link-status", id: "link-status" }, livingLinkStatus(draft)),
      ])
      : field("Nome", "name", draft.name, "text"),
    draft.expenseKind === "casa"
      ? ""
      : el("p", { class: "muted" }, "Este valor cria o imprevisto ou o planejado e já fica pago no Pix."),
    el("div", { class: "actions" }, [
      el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
      el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Lançando..." : "Lançar"),
    ]),
  ];
}
