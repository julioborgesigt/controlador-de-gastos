import {
  cardChargeTitle,
  formatMonthList,
  invoiceBreakdown,
  money,
  monthFinancialSummary,
  nextMonthId,
  previousMonthId,
  shortMonthLabel,
} from "../../format.js";
import { compareInvoiceItems } from "../../installment-order.js";
import { ensureNextInvoices, openMonthCard, purchasesOf } from "../api.js";
import { linkedInvoice } from "../dialogs/expense-info.js";
import { helpButton, titleWithHelp } from "../dialogs/info.js";
import { backArrow, el, monthPhrase, onDesktop } from "../dom.js";
import { openCardExpense } from "../sheets/openers.js";
import { editable, monthStore, render, state } from "../state.js";
import {
  cardInvoiceCents,
  cardJump,
  cardManageRow,
  cardTools,
  expensesForCardName,
  fixedOnCard,
  monthInvoicesSettled,
  openCard,
  openCardBalance,
  openCreateCard,
  shownExpense,
  unassignedCardExpenses,
} from "./card-helpers.js";
import { cardSourceLabel, cardTrack, expenseRow } from "./expenses.js";

function purchaseGroups(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = item.invoiceMonthId || "";
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([invoiceMonthId, rows]) => ({
      invoiceMonthId,
      totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
      rows: rows.slice().sort(compareInvoiceItems),
    }));
}

export function purchaseDetail(data) {
  const payload = purchasesOf(data.month.id);
  const items = payload?.items || [];
  const nextId = nextMonthId(data.month.id);
  const prevId = previousMonthId(data.month.id);
  const nextData = state.nextInvoicesFor === data.month.id ? state.nextInvoices : (monthStore.get(nextId) || null);
  const prevData = monthStore.get(prevId) || null;
  const fin = monthFinancialSummary(data, nextData, prevData, payload);
  const groups = purchaseGroups(items).sort((left, right) => {
    const leftSame = left.invoiceMonthId === data.month.id ? 1 : 0;
    const rightSame = right.invoiceMonthId === data.month.id ? 1 : 0;
    if (leftSame !== rightSame) return leftSame - rightSame;
    return left.invoiceMonthId.localeCompare(right.invoiceMonthId);
  });
  const futureMonthsLabel = formatMonthList(fin.launches.futureInvoiceMonths) || "próximas faturas";
  const children = [
    el("button", {
      class: "linkish back",
      type: "button",
      onclick: () => {
        state.cardFocus = null;
        render();
      },
    }, [backArrow(), "Faturas"]),
    el("div", { class: "section-head" }, [
      titleWithHelp("Lançamentos feitos", "Lançamentos do mês", [
        "Mostra os gastos deste mês no cartão, separando o que será pago na próxima ou nas próximas faturas do que entrou na fatura deste próprio mês.",
        "Também destaca o custo de vida deste mês que ainda está previsto para entrar na próxima fatura.",
      ]),
      el("h2", {}, payload ? money(fin.launches.launchedFutureCents) : "…"),
      el("p", { class: "muted" }, `Valores lançados em ${monthPhrase(data.month.id)} para pagar na próxima ou nas próximas faturas.`),
      el("div", { class: "cost-split invoice-xray" }, [
        el("div", { class: "xray-item wide" }, [
          el("small", {}, "Lançados p/ próximas faturas"),
          el("strong", {}, money(fin.launches.launchedFutureCents)),
          fin.launches.launchedFutureCents > 0
            ? el("small", { class: "xray-sub" }, `Vai ser pago na fatura de ${futureMonthsLabel}`)
            : "",
        ]),
        el("div", { class: "xray-item" }, [
          el("small", {}, "Previsto p/ próxima fatura"),
          el("strong", {}, money(fin.launches.forecastNextInvoiceCents)),
          fin.launches.forecastNextInvoiceCents > 0
            ? el("small", { class: "xray-sub" }, "Custo de vida ainda não lançado")
            : "",
        ]),
        el("div", { class: "xray-item" }, [
          el("small", {}, "Na fatura deste mês"),
          el("strong", {}, money(fin.launches.launchedOwnInvoiceCents)),
          fin.launches.launchedOwnInvoiceCents > 0
            ? el("small", { class: "xray-sub" }, `Fatura de ${shortMonthLabel(data.month.id)}`)
            : "",
        ]),
      ]),
    ]),
  ];
  if (!payload) {
    children.push(el("p", { class: "muted" }, "Carregando lançamentos..."));
    return el("section", {}, children);
  }
  if (payload.error) children.push(el("p", { class: "error" }, payload.error));
  if (!groups.length && fin.launches.forecastNextInvoiceCents <= 0) {
    children.push(el("p", { class: "muted" }, "Nenhum gasto deste mês lançado no cartão."));
  }
  for (const group of groups) {
    const same = group.invoiceMonthId === data.month.id;
    children.push(el("p", { class: "eyebrow group" }, same
      ? `Cobrado na fatura deste mês (${monthPhrase(group.invoiceMonthId)}) · ${money(group.totalCents)}`
      : `Vai ser pago na fatura de ${monthPhrase(group.invoiceMonthId)} · ${money(group.totalCents)}`));
    children.push(el("div", { class: "list" }, group.rows.map((item) => {
      const source = cardSourceLabel(item);
      const sourceClass = source === "Planejado" ? "badge source-planned" : source === "Imprevisto" ? "badge source-extra" : "badge source-fixed";
      return el("article", { class: "item" }, [
        el("div", { class: "item-copy" }, [
          el("strong", {}, cardChargeTitle(item)),
          ...[item.cardLabel || "Sem cartão", "Crédito"].filter(Boolean).map((line) => el("small", {}, line)),
        ]),
        el("div", { class: "item-end" }, [
          source ? el("div", { class: "badges" }, [el("span", { class: sourceClass }, source)]) : "",
          el("span", { class: "amount" }, money(item.amountCents)),
        ]),
      ]);
    })));
  }
  return el("section", {}, children);
}

function invoiceFold(key, label, amount, helpLines, body) {
  const open = Boolean(state.folds && state.folds[key]);
  return el("section", { class: `fold${open ? " open" : ""}` }, [
    el("div", { class: "fold-bar" }, [
      el("button", {
        class: "fold-toggle",
        type: "button",
        "aria-expanded": open ? "true" : "false",
        onclick: () => {
          state.folds = { ...(state.folds || {}), [key]: !open };
          render();
        },
      }, [
        el("span", { class: "fold-chevron", "aria-hidden": "true" }, ""),
        el("span", { class: "fold-copy" }, [
          el("span", { class: "eyebrow" }, label),
          el("strong", {}, amount),
        ]),
      ]),
      helpLines ? helpButton(label, helpLines) : "",
    ]),
    open ? el("div", { class: "fold-body" }, body) : "",
  ]);
}

function invoiceXray(expenses, fallbackLivingCents = 0) {
  const inv = invoiceBreakdown(expenses);
  if (inv.totalCents <= 0) return "";
  const living = inv.livingCents || fallbackLivingCents || 0;
  const origins = formatMonthList(inv.originMonths);
  const cells = [
    el("div", { class: "xray-item" }, [
      el("small", {}, "Custo de vida na fatura"),
      el("strong", {}, money(living)),
      inv.livingFromOtherCents > 0 ? el("small", { class: "xray-sub" }, `inclui ${money(inv.livingFromOtherCents)} de ${origins}`) : "",
    ]),
    el("div", { class: "xray-item" }, [
      el("small", {}, "Planejados na fatura"),
      el("strong", {}, money(inv.plannedCents)),
      inv.plannedFromOtherCents > 0 ? el("small", { class: "xray-sub" }, `inclui ${money(inv.plannedFromOtherCents)} de ${origins}`) : "",
    ]),
    el("div", { class: "xray-item" }, [
      el("small", {}, "Imprevistos na fatura"),
      el("strong", {}, money(inv.unexpectedCents)),
      inv.unexpectedFromOtherCents > 0 ? el("small", { class: "xray-sub" }, `inclui ${money(inv.unexpectedFromOtherCents)} de ${origins}`) : "",
    ]),
  ];
  if (inv.otherCents > 0 && inv.livingCents > 0) {
    cells.push(el("div", { class: "xray-item" }, [
      el("small", {}, "Parcelamentos / outros"),
      el("strong", {}, money(inv.otherCents)),
    ]));
  }
  return el("div", { class: "cost-split invoice-xray" }, cells);
}

export function cardsHome(data) {
  const cards = data.cards || [];
  const purchases = purchasesOf(data.month.id);
  const phrase = monthPhrase(data.month.id);
  const paidInvoices = monthInvoicesSettled(data);
  const nextId = nextMonthId(data.month.id);
  const prevId = previousMonthId(data.month.id);
  const nextKnown = (data.months || []).some((month) => month.id === nextId);
  if (nextKnown) ensureNextInvoices(data.month.id);
  const nextData = state.nextInvoicesFor === data.month.id ? state.nextInvoices : (monthStore.get(nextId) || null);
  const prevData = monthStore.get(prevId) || null;
  const fin = monthFinancialSummary(data, nextData, prevData, purchases);
  const invoiceRows = [];
  const xray = invoiceXray(data.expenses, data.totals.fixedOnCardCents);
  if (xray) invoiceRows.push(xray);
  if (!cards.length) invoiceRows.push(el("p", { class: "muted" }, "Nenhum cartão ainda."));
  for (const card of cards) {
    invoiceRows.push(cardManageRow(card, cardInvoiceCents(data.expenses, card.name), expensesForCardName(data.expenses, card.name)));
  }
  const loose = unassignedCardExpenses(data.expenses, cards);
  if (loose.some(shownExpense)) {
    const amount = loose
      .filter((expense) => !fixedOnCard(expense))
      .reduce((sum, expense) => sum + expense.amountCents, 0);
    invoiceRows.push(cardJump("Sem cartão", amount, loose, () => openCard("unassigned")));
  }
  const launchesSub = purchases?.error
    || (fin.launches.launchedFutureCents > 0 || fin.launches.forecastNextInvoiceCents > 0
      ? `${money(fin.launches.launchedFutureCents)} lançados p/ ${formatMonthList(fin.launches.futureInvoiceMonths) || "próximas faturas"}${fin.launches.forecastNextInvoiceCents > 0 ? ` · +${money(fin.launches.forecastNextInvoiceCents)} previstos` : ""}${fin.launches.launchedOwnInvoiceCents > 0 ? ` · ${money(fin.launches.launchedOwnInvoiceCents)} nesta fatura` : ""}`
      : fin.launches.launchedOwnInvoiceCents > 0
        ? `${money(fin.launches.launchedOwnInvoiceCents)} lançados na própria fatura deste mês`
        : "Valores lançados neste mês para pagar nas próximas faturas.");
  const children = [
    el("button", {
      class: "jump",
      type: "button",
      onclick: () => {
        state.cardFocus = "purchases";
        render();
      },
    }, [
      el("div", { class: "row-between" }, [
        el("span", {}, `Lançamentos feitos em ${phrase}`),
        el("strong", {}, purchases ? money(fin.launches.launchedFutureCents || fin.launches.totalLaunchedCents || 0) : "…"),
      ]),
      el("small", {}, launchesSub),
    ]),
    editable() ? el("div", { class: "stack-actions" }, [
      el("button", { class: "primary", type: "button", onclick: () => openCardExpense() }, "+ Gasto no crédito"),
      el("button", { class: "secondary", type: "button", onclick: () => { state.error = ""; openCreateCard(); } }, "Adicionar cartão"),
    ]) : "",
    invoiceFold(
      `invoices:${data.month.id}`,
      paidInvoices ? `Faturas pagas em ${phrase}` : `Faturas a serem pagas em ${phrase}`,
      money(data.totals.faturaCents),
      [
        onDesktop()
          ? "Clique num cartão para ver a fatura. Os botões editam ou quitam o cartão. Excluir só quando ele não tiver gastos."
          : "Toque num cartão para ver a fatura. Dá para editar o cartão. Excluir só quando ele não tiver gastos.",
        "O raio-X acima mostra quanto da fatura veio do Custo de vida, de Planejados e de Imprevistos.",
        "Lançamentos feitos no mês mostra os valores que serão pagos na próxima ou nas próximas faturas.",
        data.totals.fixedOnCardCents
          ? `${money(data.totals.fixedOnCardCents)} de custo de vida já foram lançados no cartão e não somam de novo.`
          : "A fatura reúne as cobranças com vencimento neste mês.",
      ],
      invoiceRows,
    ),
  ];
  if (nextKnown) {
    const nextPhrase = monthPhrase(nextId);
    const nextExpenses = nextData?.expenses || [];
    const openCards = cards.flatMap((card) => {
      const list = expensesForCardName(nextExpenses, card.name);
      const balance = openCardBalance(list);
      if (balance <= 0) return [];
      return [{ card, balance, amount: cardInvoiceCents(nextExpenses, card.name), list }];
    });
    const openTotal = openCards.reduce((sum, item) => sum + item.balance, 0);
    const pendingFromCurrent = fin.launches.forecastNextInvoiceCents;
    const projectedNextInvoiceTotal = openTotal + pendingFromCurrent;
    const nextRows = [];
    if (!nextData) nextRows.push(el("p", { class: "muted" }, "Carregando a projeção..."));
    else if (nextData.error) nextRows.push(el("p", { class: "error" }, nextData.error));
    else if (!openCards.length && pendingFromCurrent <= 0) nextRows.push(el("p", { class: "muted" }, `Nenhuma fatura em aberto para ${nextPhrase}.`));
    else {
      for (const item of openCards) {
        nextRows.push(el("button", {
          class: "jump",
          type: "button",
          onclick: () => openMonthCard(nextId, item.card.id),
        }, [
          el("div", { class: "row-between" }, [
            el("span", {}, item.card.name),
            el("strong", {}, money(item.balance)),
          ]),
          el("small", {}, `Já lançado na fatura · total ${money(item.amount)}`),
        ]));
      }
      if (pendingFromCurrent > 0) {
        nextRows.push(el("button", {
          class: "jump",
          type: "button",
          onclick: () => {
            state.view = "casa";
            render();
          },
        }, [
          el("div", { class: "row-between" }, [
            el("span", {}, `Custo de vida previsto p/ ${nextPhrase}`),
            el("strong", {}, money(pendingFromCurrent)),
          ]),
          el("small", {}, `Ainda previsto em ${phrase} · entrará na fatura de ${nextPhrase}`),
        ]));
      }
    }
    children.push(invoiceFold(
      `open:${nextId}`,
      `Faturas previstas para ${nextPhrase}`,
      nextData ? money(projectedNextInvoiceTotal) : "…",
      null,
      nextRows,
    ));
  }
  return el("section", {}, children);
}

export function cardDetail(data) {
  const cards = data.cards || [];
  const card = state.cardFocus === "unassigned" ? null : cards.find((item) => item.id === state.cardFocus);
  if (state.cardFocus !== "unassigned" && !card) {
    state.cardFocus = null;
    return cardsHome(data);
  }
  const all = card ? expensesForCardName(data.expenses, card.name) : unassignedCardExpenses(data.expenses, cards);
  const visible = all.filter(shownExpense);
  const hidden = all.length - visible.length;
  const total = card
    ? cardInvoiceCents(data.expenses, card.name)
    : all.filter((expense) => !fixedOnCard(expense)).reduce((sum, expense) => sum + expense.amountCents, 0);
  const children = [
    el("button", {
      class: "linkish back",
      type: "button",
      onclick: () => {
        state.cardFocus = null;
        state.showEmpty = false;
        render();
      },
    }, [backArrow(), "Todos os cartões"]),
    el("div", { class: "section-head" }, [
      titleWithHelp(data.month.label, card ? card.name : "Sem cartão", [
        card
          ? "Os gastos vinculados a este cartão aparecem aqui, separados entre Custo de vida, Planejados e Imprevistos."
          : "Estes gastos ainda não têm um cartão cadastrado.",
        "O gasto entra na aba da classificação escolhida. O fechamento sugere a fatura e você pode trocar o mês.",
      ]),
      el("h2", {}, card ? card.name : "Sem cartão"),
      el("p", { class: "money inline" }, money(total)),
      invoiceXray(all),
    ]),
    editable() && card ? cardTools(card) : "",
    editable() ? el("div", { class: "stack-actions" }, [
      el("button", { class: "primary", type: "button", onclick: () => openCardExpense(card ? card.name : "") }, "+ Gasto no crédito"),
    ]) : "",
  ];
  const groups = [
    [
      "Custo de vida na fatura",
      visible.filter((expense) => (!fixedOnCard(expense) && cardTrack(expense) === "casa") || (expense.section === "fixed" && !linkedInvoice(expense))),
    ],
    ["Planejados na fatura", visible.filter((expense) => !fixedOnCard(expense) && cardTrack(expense) === "planejado")],
    ["Imprevistos na fatura", visible.filter((expense) => !fixedOnCard(expense) && cardTrack(expense) === "imprevisto")],
    ["Fatura prevista / parcelamentos", visible.filter((expense) => expense.section === "card" && cardTrack(expense) === "")],
  ];
  for (const [title, rows] of groups) {
    if (!rows.length) continue;
    const groupTotal = rows.reduce((sum, row) => sum + row.amountCents, 0);
    children.push(el("p", { class: "eyebrow group" }, `${title} · ${money(groupTotal)}`));
    children.push(el("div", { class: "list" }, rows.slice().sort(compareInvoiceItems).map((expense) => expenseRow(expense, "card", { manage: editable(), cardExpense: editable() }))));
  }
  if (!visible.length) {
    children.push(el("p", { class: "muted" }, card ? "Nenhum gasto neste cartão neste mês." : "Nada sem cartão neste mês."));
  }
  if (hidden > 0) {
    children.push(el("button", {
      class: "linkish",
      type: "button",
      onclick: () => {
        state.showEmpty = true;
        render();
      },
    }, `Mostrar ${hidden} ${hidden === 1 ? "linha sem valor" : "linhas sem valor"}`));
  }
  return el("section", {}, children);
}
