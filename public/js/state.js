import { el } from "./dom.js";

export const root = document.querySelector("#app");

export const liveRegion = document.querySelector("#live-region");

export const TOAST_MS = 3000;

let noticeText = "";
let noticeSeq = 0;
let noticeTimer = 0;

export function dismissNotice() {
  clearTimeout(noticeTimer);
  noticeTimer = 0;
  if (!noticeText) return;
  noticeText = "";
  renderSafely();
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
      noticeTimer = setTimeout(() => {
        if (noticeSeq !== token) return;
        noticeTimer = 0;
        noticeText = "";
        renderSafely();
      }, TOAST_MS);
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
