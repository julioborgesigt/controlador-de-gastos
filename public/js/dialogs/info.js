import {
  formatMonthList,
  invoiceShift,
  money,
  nextMonthId,
  shortMonthLabel,
} from "../../format.js";
import { el } from "../dom.js";
import { TAB_INFO, closeTabIntro, render, state } from "../state.js";
import { costPortionAmount, costPortions, livingOtherChargeMonths } from "../views/summary.js";
import { openExpenseInfo } from "./expense-info.js";

export function tabIntroDialog() {
  const info = TAB_INFO[state.tabIntro];
  if (!info) return el("div");
  const overlay = el("div", {
    class: "overlay center",
    "data-key": "tab-intro",
    role: "presentation",
    onclick: (event) => {
      if (event.target === event.currentTarget) closeTabIntro(false);
    },
  }, [
    el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "tab-intro-title", tabindex: "-1" }, [
      el("button", { class: "dialog-close", type: "button", "aria-label": "Fechar", onclick: () => closeTabIntro(false) }, "×"),
      el("h2", { id: "tab-intro-title" }, info.title),
      el("div", { class: "tab-info-list" }, [
        el("div", { class: "tab-info-row" }, [
          el("strong", {}, "Função da aba"),
          el("p", {}, info.role),
        ]),
        el("div", { class: "tab-info-row" }, [
          el("strong", {}, "O que exibe"),
          el("p", {}, info.display),
        ]),
        el("div", { class: "tab-info-row" }, [
          el("strong", {}, "Lançamentos"),
          el("p", {}, info.launches),
        ]),
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "primary", type: "button", onclick: () => closeTabIntro(true) }, "Não mostrar novamente"),
      ]),
    ]),
  ]);
  return overlay;
}

export function helpButton(title, lines) {
  return el("button", {
    class: "help",
    type: "button",
    "aria-label": `Ajuda sobre ${title}`,
    onclick: () => {
      state.help = { title, lines };
      render();
    },
  }, "i");
}

export function titleWithHelp(label, title, lines) {
  return el("div", { class: "title-row" }, [
    el("p", { class: "eyebrow" }, label),
    helpButton(title, lines),
  ]);
}

export function helpDialog() {
  const help = state.help;
  const close = () => {
    state.help = null;
    render();
  };
  const overlay = el("div", {
    class: "overlay center",
    "data-key": "help",
    role: "presentation",
    onclick: (event) => {
      if (event.target === event.currentTarget) close();
    },
  }, [
    el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "help-title", tabindex: "-1" }, [
      el("h2", { id: "help-title" }, help.title),
      ...help.lines.map((line) => el("p", {}, line)),
      el("div", { class: "actions" }, [
        el("button", { class: "primary", type: "button", onclick: close }, "Entendi"),
      ]),
    ]),
  ]);
  return overlay;
}

function costDetailCopy(key) {
  if (key === "previsto") return ["Previsto", "Soma do custo considerado em Custo de vida neste mês (despesas finalizadas entram pelo custo atual)."];
  if (key === "pago") return ["Já pago no mês", "O que já foi pago no Pix ou lançado no cartão."];
  if (key === "cartao") return ["Pago no cartão", "Valores deste mês que já entraram numa fatura."];
  if (key === "pix") return ["Pago no Pix", "Valores deste mês já pagos no Pix."];
  if (key === "falta-cartao") return ["Falta no cartão", "O que ainda será pago no crédito."];
  return ["Falta no Pix", "O que ainda será pago no Pix."];
}

function costDetailRows(key) {
  const rows = (state.data?.expenses || [])
    .filter((expense) => expense.section === "fixed")
    .map((expense) => ({ expense, parts: costPortions(expense) }))
    .map((row) => ({ ...row, amount: costPortionAmount(row.parts, key) }))
    .filter((row) => row.amount > 0);
  rows.sort((left, right) => left.expense.name.localeCompare(right.expense.name, "pt-BR", { sensitivity: "base" }));
  return rows;
}

function costDetailNote(row, key) {
  const otherMonths = livingOtherChargeMonths(row.expense);
  const otherSuffix = otherMonths.length ? ` · fatura de ${formatMonthList(otherMonths)}` : "";
  const nextShiftId = row.expense.payment === "card" && invoiceShift(row.expense.note) === "seguinte"
    ? nextMonthId(row.expense.monthId)
    : "";
  if (key === "previsto" && row.expense.paid && !row.expense.onCard && row.parts.previsto !== row.expense.amountCents) {
    return `Finalizada · previsto inicial ${money(row.expense.amountCents)}`;
  }
  if (key === "pago" && row.parts.pagoCartao && row.parts.pagoPix) {
    return `No cartão ${money(row.parts.pagoCartao)}${otherSuffix} · no Pix ${money(row.parts.pagoPix)}`;
  }
  if (key === "cartao" || (key === "pago" && row.parts.pagoCartao)) {
    const label = row.expense.cardLabel ? `Crédito ${row.expense.cardLabel}` : "Crédito";
    return `${label}${otherSuffix}`;
  }
  if (key === "pix" || (key === "pago" && row.parts.pagoPix)) return "Pix";
  if (key === "falta-cartao") {
    return nextShiftId ? `Ainda no crédito · entrará na fatura de ${shortMonthLabel(nextShiftId)}` : "Ainda no crédito · fatura deste mês";
  }
  if (key === "falta-pix") return "Ainda no Pix";
  if (row.expense.payment === "card") {
    return nextShiftId ? `Previsto no crédito · fatura de ${shortMonthLabel(nextShiftId)}` : "Previsto no crédito";
  }
  return "Previsto no Pix";
}

export function closeCostDetail() {
  state.costDetail = null;
  render();
}

export function costDetailDialog() {
  const key = state.costDetail;
  const [title, lede] = costDetailCopy(key);
  const rows = costDetailRows(key);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const overlay = el("div", {
    class: "overlay center",
    "data-key": "cost-detail",
    role: "presentation",
    onclick: (event) => {
      if (event.target === event.currentTarget) closeCostDetail();
    },
  }, [
    el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" }, [
      el("button", { class: "dialog-close", type: "button", "aria-label": "Fechar", onclick: closeCostDetail }, "×"),
      el("h2", {}, title),
      el("p", { class: "muted" }, lede),
      el("p", { class: "money" }, money(total)),
      rows.length
        ? el("div", { class: "list" }, rows.map((row) => el("button", {
          type: "button",
          class: "breakdown",
          onclick: () => {
            state.costDetail = null;
            openExpenseInfo(row.expense, "fixed");
          },
        }, [
          el("div", { class: "item-copy" }, [
            el("strong", {}, row.expense.name),
            el("small", {}, costDetailNote(row, key)),
          ]),
          el("span", { class: "amount" }, money(row.amount)),
        ])))
        : el("p", {}, "Nenhum custo neste grupo."),
    ]),
  ]);
  return overlay;
}
