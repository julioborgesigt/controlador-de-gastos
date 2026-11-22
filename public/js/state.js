import { DEFAULT_INVOICE_SORTS, normalizeInvoiceSorts } from "../installment-order.js";
import { el } from "./dom.js";

const INVOICE_SORT_KEY = "invoiceSort:v1";

function readStoredInvoiceSorts() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(INVOICE_SORT_KEY) : null;
    if (!raw) return DEFAULT_INVOICE_SORTS.map((item) => ({ ...item }));
    return normalizeInvoiceSorts(JSON.parse(raw));
  } catch {
    return DEFAULT_INVOICE_SORTS.map((item) => ({ ...item }));
  }
}

export function setInvoiceSorts(next) {
  state.invoiceSorts = normalizeInvoiceSorts(next);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(INVOICE_SORT_KEY, JSON.stringify(state.invoiceSorts));
    }
  } catch {
    /* segue apenas nesta sessão */
  }
}

export const root = document.querySelector("#app");

export const liveRegion = document.querySelector("#live-region");

export const TOAST_MS = 3000;

let noticeText = "";
let noticeSeq = 0;
let noticeTimer = 0;

function toastCheckGlyph() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 13l4 4L19 7");
  svg.append(path);
  return svg;
}

function removeToastNode() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".toast").forEach((node) => node.remove());
}

function mountToastNode(text, seq) {
  if (typeof document === "undefined" || !document.body) return;
  removeToastNode();
  if (!text) return;
  const toast = el("div", {
    class: "toast",
    role: "status",
    "aria-live": "polite",
    "data-key": `toast-${seq}`,
  }, [
    el("div", { class: "toast-row" }, [
      el("span", { class: "toast-icon", "aria-hidden": "true" }, toastCheckGlyph()),
      el("span", { class: "toast-text" }, text),
      el("button", {
        class: "toast-close",
        type: "button",
        "aria-label": "Fechar aviso",
        onclick: dismissNotice,
      }, "×"),
    ]),
    el("div", { class: "toast-progress", "aria-hidden": "true" }, [
      el("span", { class: "toast-progress-fill" }),
    ]),
  ]);
  document.body.append(toast);
}

export function dismissNotice() {
  clearTimeout(noticeTimer);
  noticeTimer = 0;
  noticeText = "";
  removeToastNode();
}

export const state = {
  booting: true,
  needsSetup: false,
  authed: false,
  authView: "login",
  auth: { cpf: "", email: "", password: "", confirmation: "" },
  passkeys: [],
  choosing: false,
  spaces: [],
  shares: [],
  monthId: sessionStorage.getItem("monthId") || "",
  view: "resumo",
  extraFilter: "all",
  invoiceSorts: readStoredInvoiceSorts(),
  data: null,
  error: "",
  get notice() {
    return noticeText;
  },
  set notice(value) {
    clearTimeout(noticeTimer);
    noticeTimer = 0;
    const next = String(value || "").trim();
    noticeText = next;
    if (next) {
      noticeSeq += 1;
      const token = noticeSeq;
      mountToastNode(next, token);
      noticeTimer = setTimeout(() => {
        if (noticeSeq !== token) return;
        noticeTimer = 0;
        noticeText = "";
        removeToastNode();
      }, TOAST_MS);
    } else {
      removeToastNode();
    }
  },
  get noticeSeq() {
    return noticeSeq;
  },
  busy: false,
  bootProgress: 0.12,
  showEmpty: false,
  cardFocus: null,
  sheet: null,
  accountMenu: false,
  confirm: null,
  expenseInfo: null,
  help: null,
  tabIntro: null,
  needsPeriod: false,
  devicePrompt: false,
  periodDraft: null,
  confirmReset: null,
  confirmTarget: null,
  bulkDeleteFlow: null,
  resetReadyAt: 0,
  resetTimer: 0,
  offline: false,
  summaryFocus: null,
  overview: null,
  overviewLoading: false,
  overviewError: "",
  overviewFilter: { year: "", q: "", card: "", track: "" },
  selectedExpenses: new Set(),
  selectableIds: [],
};

export const monthStore = new Map();

export const monthLoads = new Map();

export const views = [
  ["resumo", "Resumo mensal"],
  ["cartoes", "Cartões de crédito"],
  ["avista", "À vista"],
  ["casa", "Custo de vida"],
  ["extras", "Outros gastos"],
  ["receita", "Receita mensal"],
];

const TAB_INFO_KEY = "tabIntroDismissed:v1";

export const TAB_INFO = {
  resumo: {
    title: "Resumo mensal",
    role: "Mostra a saúde financeira do mês atual e uma prévia do próximo mês.",
    display: "Exibe os pagamentos do mês (fatura + Pix previsto), os lançamentos feitos neste mês para próximas faturas e a despesa prevista do mês atual e do seguinte.",
    launches: "Não faz lançamentos diretos — funciona como painel consolidado de acompanhamento.",
  },
  cartoes: {
    title: "Cartões de crédito",
    role: "Centraliza seus cartões, faturas mensais e compras no crédito.",
    display: "Mostra o total e a composição de cada fatura (parcelamentos, Custo de vida, Planejados e Imprevistos cobrados naquele mês).",
    launches: "Permite lançamentos: cadastre ou edite cartões, lance gastos no crédito (à vista ou parcelados), marque a fatura como paga ou parcele a fatura.",
  },
  avista: {
    title: "À vista",
    role: "Controla os gastos pagos diretamente via Pix ou dinheiro no mês.",
    display: "Exibe os lançamentos à vista já realizados no mês (pagamentos de Custo de vida, Planejados e Imprevistos no Pix).",
    launches: "Permite lançamentos: use “Lançar à vista” para registrar um pagamento em Pix/dinheiro e vinculá-lo a um Custo de vida ou criar um novo gasto.",
  },
  casa: {
    title: "Custo de vida",
    role: "Organiza o orçamento mensal das despesas recorrentes e essenciais (água, luz, internet, mercado, etc.).",
    display: "Exibe o valor previsto de cada conta e um demonstrativo do que já foi lançado nela no mês (no Pix ou na fatura de cartão, inclusive em faturas de outros meses).",
    launches: "Aqui você cadastra e edita o previsto (ou desliza para a direita para finalizar apenas o mês atual). Os pagamentos reais entram pelas abas Cartões de crédito e À vista, ou tocando na despesa em “Lançar pagamento”.",
  },
  extras: {
    title: "Outros gastos",
    role: "Agrupa os gastos Planejados e Imprevistos vinculados ao orçamento do mês.",
    display: "Destaca os gastos que entram no mês em visualização (Pix e fatura do mês) e mostra o total lançado de forma acessória (incluindo o que foi para faturas futuras).",
    launches: "Permite lançamentos: cadastre ou edite gastos Planejados e Imprevistos no Pix ou no crédito.",
  },
  receita: {
    title: "Receita mensal",
    role: "Gerencia a renda base e as receitas extras que financiam o mês.",
    display: "Mostra a receita base dos meses, os adicionais cadastrados (13º, férias, bônus, IR) e o total de receita do mês.",
    launches: "Permite lançamentos: defina a receita base, ajuste a receita de um mês específico e adicione ou edite receitas extras.",
  },
};

function readDismissedTabs() {
  try {
    const raw = localStorage.getItem(TAB_INFO_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isTabIntroDismissed(tabId) {
  return Boolean(readDismissedTabs()[tabId]);
}

function dismissTabIntro(tabId) {
  try {
    const current = readDismissedTabs();
    current[tabId] = true;
    localStorage.setItem(TAB_INFO_KEY, JSON.stringify(current));
  } catch {
    /* ignore storage errors */
  }
}

export function maybeOpenTabIntro(tabId) {
  if (!state.authed || !state.data || state.needsPeriod || state.choosing) return;
  if (!TAB_INFO[tabId] || isTabIntroDismissed(tabId)) return;
  state.tabIntro = tabId;
}

export function closeTabIntro(dontShowAgain = false) {
  if (dontShowAgain && state.tabIntro) dismissTabIntro(state.tabIntro);
  state.tabIntro = null;
  render();
}

export function editable() {
  return !state.offline && state.data?.access?.permission !== "view";
}

export function setWorking(active, label = "Salvando...") {
  state.busy = active;
  document.body.classList.toggle("is-working", active);
  document.body.setAttribute("aria-busy", active ? "true" : "false");
  const current = document.querySelector("#working");
  if (!active) {
    current?.remove();
    return;
  }
  if (current) {
    const text = current.querySelector(".working-label");
    if (text) text.textContent = label;
    return;
  }
  document.body.append(el("div", { id: "working", class: "working", role: "status" }, [
    el("span", { class: "spinner", "aria-hidden": "true" }, ""),
    el("span", { class: "working-label" }, label),
  ]));
}

export function setBootProgress(value) {
  state.bootProgress = value;
  document.querySelectorAll(".boot-mark, .boot-ring-value").forEach((node) => {
    node.style.setProperty("--progress", String(value));
  });
}

function bootRing() {
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("class", "boot-ring");
  ring.setAttribute("viewBox", "0 0 88 88");
  ring.setAttribute("aria-hidden", "true");
  for (const name of ["boot-ring-track", "boot-ring-value"]) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", name);
    circle.setAttribute("cx", "44");
    circle.setAttribute("cy", "44");
    circle.setAttribute("r", "38");
    if (name === "boot-ring-value") circle.style.setProperty("--progress", String(state.bootProgress));
    ring.append(circle);
  }
  return ring;
}

export function bootMark(retry = false) {
  return el("main", { class: "screen boot" }, [
    retry ? el("div", { class: "mark" }, "R$") : el("div", { class: "boot-mark", style: { "--progress": String(state.bootProgress) } }, [
      bootRing(),
      el("div", { class: "mark" }, "R$"),
    ]),
    retry && state.error ? el("p", { class: "lede" }, state.error) : "",
    retry ? el("button", { class: "primary", type: "button", onclick: () => retryBoot() }, "Tentar de novo") : "",
  ]);
}

export function renderSafely() {
  try {
    render();
  } catch (error) {
    console.error(error);
    setWorking(false);
    const note = document.createElement("p");
    note.className = "error";
    note.textContent = error?.message || "Não foi possível atualizar a tela.";
    if (!root.querySelector(".shell, .screen")) root.replaceChildren(note);
    else root.prepend(note);
  }
}

let renderHandler = () => {};
let bootHandler = () => {};

export function setRenderer(fn) {
  renderHandler = fn;
}

export function setBooter(fn) {
  bootHandler = fn;
}

export function render() {
  renderHandler();
}

export function retryBoot() {
  bootHandler();
}
