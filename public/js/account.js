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

function accountMenu() {
  const cpf = accountCpf();
  return el("div", { class: "menu", role: "menu" }, [
    el("div", { class: "menu-head" }, [
      el("strong", {}, "Sua conta"),
      cpf ? el("small", {}, cpf) : "",
    ]),
    state.spaces.length > 1 ? menuItem("Trocar acesso", () => { state.accountMenu = false; state.choosing = true; render(); }) : "",
    menuItem("Busca e visão anual", openOverview),
    editable() ? menuItem("Importar fatura Nubank (CSV)", () => openNubankImport()) : "",
    menuItem("Exportar backup", () => {
      state.accountMenu = false;
      state.error = "";
      state.notice = "";
      state.sheet = { mode: "export", scope: "all" };
      render();
    }),
    state.data?.access?.own === true ? menuItem("Período gerenciado", openPeriod) : "",
    state.data?.access?.own === true ? menuItem(document.documentElement.dataset.theme === "dark" ? "Usar modo claro" : "Usar modo escuro", toggleTheme) : "",
    state.data?.access?.own === true ? menuItem("Resetar meus dados", openReset, "danger") : "",
    state.data?.access?.permission === "own" ? menuItem("Compartilhar dados", () => { state.accountMenu = false; openShares(); }) : "",
    menuItem("Alterar senha", () => { state.accountMenu = false; openPassword(); }),
    menuItem("Cadastrar digital", () => { state.accountMenu = false; openPasskeys(); }),
    menuItem("Sair", () => askConfirm("logout"), "danger"),
  ]);
}

function menuItem(label, onclick, extra = "") {
  return el("button", { class: `menu-item${extra ? ` ${extra}` : ""}`, type: "button", role: "menuitem", onclick }, label);
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
