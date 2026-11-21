import { clearMonthCache, request } from "./api.js";
import { askConfirm } from "./dialogs/confirm.js";
import { applyTheme, el, messageOf, personGlyph } from "./dom.js";
import { openPeriod, openReset } from "./setup.js";
import { openNubankImport } from "./sheets/import-nubank.js";
import {
  editable,
  render,
  renderSafely,
  setWorking,
  state,
} from "./state.js";
import { openOverview } from "./views/overview.js";

async function openShares() {
  if (!editable() || state.data?.access?.own === false) {
    state.error = "Só dá para compartilhar os seus próprios gastos.";
    render();
    return;
  }
  state.error = "";
  setWorking(true, "Abrindo...");
  try {
    const data = await request("/api/shares");
    state.shares = data.shares || [];
    state.sheet = { mode: "share", cpf: "", permission: "view" };
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export async function setSharePermission(share, permission) {
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    const data = await request(`/api/shares/${share.id}`, { method: "PATCH", body: { permission } });
    state.shares = data.shares || [];
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export function removeShare(share) {
  state.confirmTarget = share;
  askConfirm("remove-share");
}

export async function executeRemoveShare(share) {
  if (!share?.id) return;
  state.error = "";
  setWorking(true, "Removendo...");
  try {
    const data = await request(`/api/shares/${share.id}`, { method: "DELETE" });
    state.shares = data.shares || [];
    const spaces = await request("/api/spaces");
    state.spaces = spaces.spaces || state.spaces;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  state.accountMenu = false;
  state.error = "";
  render();
  try {
    await request("/api/theme", { method: "POST", body: { theme: next } });
  } catch (error) {
    state.error = messageOf(error);
    render();
  }
}

export async function logout() {
  state.accountMenu = false;
  state.sheet = null;
  state.confirm = null;
  clearMonthCache();
  state.error = "";
  setWorking(true, "Saindo...");
  render();
  try {
    await request("/api/logout", { method: "POST", body: {} });
    state.authed = false;
    state.authView = "login";
    state.auth.password = "";
    state.auth.confirmation = "";
    state.data = null;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function openPassword() {
  state.accountMenu = false;
  state.error = "";
  state.sheet = { mode: "password", current: "", next: "", confirmation: "" };
  render();
}

async function openPasskeys() {
  state.accountMenu = false;
  state.error = "";
  setWorking(true, "Abrindo...");
  try {
    const data = await request("/api/passkeys");
    state.passkeys = data.passkeys || [];
  } catch (error) {
    state.passkeys = [];
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  state.sheet = { mode: "passkey" };
  render();
}

export function accountCpf() {
  return (state.spaces || []).find((space) => space.permission === "own")?.detail || "";
}

export function accountButton() {
  return el("div", { class: "account" }, [
    state.accountMenu ? menuBackdrop() : "",
    el("button", {
      class: `profile${state.accountMenu ? " open" : ""}`,
      type: "button",
      "aria-label": "Conta",
      "aria-expanded": state.accountMenu ? "true" : "false",
      onclick: (event) => {
        event.stopPropagation();
        state.accountMenu = !state.accountMenu;
        render();
      },
    }, personGlyph()),
    state.accountMenu ? accountMenu() : "",
  ]);
}

function menuGlyph(name) {
  const paths = {
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5.2 12.2L20 20",
    upload: "M12 16V4m0 0-4 4m4-4 4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2",
    download: "M12 4v12m0 0-4-4m4 4 4-4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2",
    calendar: "M4 6h16v14H4zM8 3v4M16 3v4M4 10h16",
    moon: "M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4",
    swap: "M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3-3m-3 3 3 3",
    share: "M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2c2.5 0 5 1.3 5 3.5V19h-6m-7-5c-2.8 0-5 1.4-5 3.5V19h10v-1.5c0-2.1-2.2-3.5-5-3.5Z",
    lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
    passkey: "M12 10a2 2 0 0 1 2 2c0 2.5-.6 4.8-1.8 6.5M9 12a3 3 0 0 1 6 0c0 3.2-.8 6-2.5 8M6.5 11.5a5.5 5.5 0 0 1 11 0M5 15c.6-1 1-2.2 1-3.5",
    trash: "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13",
    logout: "M10 17l5-5-5-5M15 12H4M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "17");
  svg.setAttribute("height", "17");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "menu-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || paths.search);
  svg.append(path);
  return svg;
}

function menuSection(title, items, extraClass = "") {
  const clean = items.filter(Boolean);
  if (!clean.length) return "";
  return el("div", { class: `menu-group${extraClass ? ` ${extraClass}` : ""}`, role: "group", "aria-label": title || undefined }, [
    title ? el("p", { class: "menu-label" }, title) : "",
    ...clean,
  ]);
}

function accountMenu() {
  const cpf = accountCpf();
  const isOwn = state.data?.access?.own === true;
  const isOwner = state.data?.access?.permission === "own";
  const isDark = document.documentElement.dataset.theme === "dark";
  return el("div", { class: "menu", role: "menu" }, [
    el("div", { class: "menu-head" }, [
      el("span", { class: "menu-avatar", "aria-hidden": "true" }, personGlyph()),
      el("div", { class: "menu-head-copy" }, [
        el("strong", {}, "Sua conta"),
        cpf ? el("small", {}, cpf) : "",
      ]),
    ]),
    menuSection("Dados e consultas", [
      menuItem("Busca e visão anual", openOverview, { icon: "search" }),
      editable() ? menuItem("Importar fatura Nubank (CSV)", () => openNubankImport(), { icon: "upload" }) : "",
      menuItem("Exportar backup", () => {
        state.accountMenu = false;
        state.error = "";
        state.notice = "";
        state.sheet = { mode: "export", scope: "all" };
        render();
      }, { icon: "download" }),
    ]),
    menuSection("Preferências", [
      isOwn ? menuItem("Período gerenciado", openPeriod, { icon: "calendar" }) : "",
      isOwn ? menuItem(isDark ? "Usar modo claro" : "Usar modo escuro", toggleTheme, { icon: isDark ? "sun" : "moon" }) : "",
    ]),
    menuSection("Conta e segurança", [
      state.spaces.length > 1 ? menuItem("Trocar acesso", () => { state.accountMenu = false; state.choosing = true; render(); }, { icon: "swap" }) : "",
      isOwner ? menuItem("Compartilhar dados", () => { state.accountMenu = false; openShares(); }, { icon: "share" }) : "",
      menuItem("Alterar senha", () => { state.accountMenu = false; openPassword(); }, { icon: "lock" }),
      menuItem("Cadastrar digital", () => { state.accountMenu = false; openPasskeys(); }, { icon: "passkey" }),
    ]),
    menuSection("", [
      isOwn ? menuItem("Resetar meus dados", openReset, { icon: "trash", danger: true }) : "",
      menuItem("Sair", () => askConfirm("logout"), { icon: "logout", danger: true }),
    ], "menu-group-danger"),
  ]);
}

function menuItem(label, onclick, { icon = "", danger = false } = {}) {
  return el("button", {
    class: `menu-item${danger ? " menu-item-danger" : ""}`,
    type: "button",
    role: "menuitem",
    onclick,
  }, [
    icon ? menuGlyph(icon) : "",
    el("span", {}, label),
  ]);
}

function menuBackdrop() {
  return el("button", {
    class: "menu-backdrop",
    type: "button",
    "aria-label": "Fechar menu",
    onclick: () => {
      state.accountMenu = false;
      render();
    },
  });
}
