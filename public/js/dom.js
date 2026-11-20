import { state } from "./state.js";

export function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#121418" : "#f5f6f8");
  try { localStorage.setItem("theme", next); } catch { /* o tema segue só nesta sessão */ }
}

export const desktopMedia = window.matchMedia("(min-width: 1100px)");

export function onDesktop() {
  return desktopMedia.matches;
}

export function currentMonthId() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

export const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatDueDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function monthPhrase(monthId) {
  const month = (state.data?.months || []).find((item) => item.id === monthId);
  const [name, year] = String(month?.label || "").split(" ");
  return name && year ? `${name.toLowerCase()} de ${year}` : monthId;
}

export function shortMonth(month) {
  const [year, monthNumber] = month.id.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${names[Number(monthNumber) - 1]} ${year.slice(2)}`;
}

export function monthName(monthId) {
  const month = state.data.months.find((item) => item.id === monthId);
  return month ? month.label : monthId;
}

export function amountLabel(draft) {
  if (draft.mode === "create" && draft.section !== "fixed" && (draft.section === "card" || draft.payment === "card")) {
    return draft.amountMode === "total" ? "Valor total da compra" : "Valor da parcela";
  }
  return "Valor";
}

export function historyWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function messageOf(error) {
  if (error?.name === "AbortError") return "O servidor demorou para responder. Tente de novo.";
  if (error instanceof TypeError && /fetch|network|Failed/i.test(String(error.message || ""))) {
    return "Sem conexão. Tente de novo em instantes.";
  }
  return error?.message || "Não foi possível concluir.";
}

export function glyph(name) {
  const paths = {
    resumo: "M4 19V11M10 19V5M16 19V8M3 19h18",
    cartoes: "M3 7h18v10H3zM3 11h18M7 14h4",
    avista: "M3 7h18v10H3zM7 12h.01M17 12h.01M12 9.5a2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 1 0-5",
    casa: "M4 11l8-7 8 7v8H4z",
    extras: "M8 8h12v12H8zM4 4h12v12H4z",
    receita: "M12 3v18M8 7h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || paths.extras);
  svg.append(path);
  return svg;
}

export function personGlyph() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  head.setAttribute("cx", "12");
  head.setAttribute("cy", "8");
  head.setAttribute("r", "3.2");
  const body = document.createElementNS("http://www.w3.org/2000/svg", "path");
  body.setAttribute("d", "M5.5 19.2c1.2-3 3.4-4.4 6.5-4.4s5.3 1.4 6.5 4.4");
  svg.append(head, body);
  return svg;
}

export function backArrow() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M15 6l-6 6 6 6");
  svg.append(path);
  return svg;
}

const EVENT_HANDLERS = new WeakMap();
const EVENT_DISPATCHERS = new WeakMap();

export function on(node, type, handler) {
  let handlers = EVENT_HANDLERS.get(node);
  if (!handlers) {
    handlers = Object.create(null);
    EVENT_HANDLERS.set(node, handlers);
  }
  handlers[type] = handler;
  let bound = EVENT_DISPATCHERS.get(node);
  if (!bound) {
    bound = new Set();
    EVENT_DISPATCHERS.set(node, bound);
  }
  if (!bound.has(type)) {
    bound.add(type);
    node.addEventListener(type, (event) => {
      const current = EVENT_HANDLERS.get(node)?.[type];
      if (typeof current === "function") current(event);
    });
  }
}

export function syncEvents(target, source) {
  const prev = EVENT_HANDLERS.get(target);
  const next = EVENT_HANDLERS.get(source);
  if (prev) {
    for (const type of Object.keys(prev)) {
      if (!next || !(type in next)) prev[type] = null;
    }
  }
  if (next) {
    for (const [type, handler] of Object.entries(next)) {
      if (typeof handler === "function") on(target, type, handler);
    }
  }
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "onclick" || (key.startsWith("on") && typeof value === "function")) on(node, key.slice(2), value);
    else if (key === "for") node.htmlFor = value;
    else if (key === "value") node.value = value;
    else if (key === "checked") node.checked = Boolean(value);
    else if (key === "selected") node.selected = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === "") continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
