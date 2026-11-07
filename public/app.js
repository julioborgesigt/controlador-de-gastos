import { dueDatePassed, invoiceDueDate } from "./card-due.js";
import { quoteInstallments, solveInstallmentTriple } from "./installment-link.js";

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#121418" : "#f5f6f8");
  try { localStorage.setItem("theme", next); } catch { /* o tema segue só nesta sessão */ }
}

applyTheme(localStorage.getItem("theme"));

const root = document.querySelector("#app");

const state = {
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
  data: null,
  error: "",
  notice: "",
  busy: false,
  bootProgress: 0.12,
  showEmpty: false,
  cardFocus: null,
  sheet: null,
  accountMenu: false,
  confirm: null,
  expenseInfo: null,
  needsPeriod: false,
  devicePrompt: false,
  periodDraft: null,
  confirmReset: null,
  resetReadyAt: 0,
  resetTimer: 0,
};

let overlayPushed = false;
let suppressHistory = false;
let allowLeave = false;

const views = [
  ["resumo", "Resumo mensal"],
  ["cartoes", "Cartões de crédito"],
  ["casa", "Custo de vida"],
  ["extras", "Imprevisto / Planejado"],
  ["receita", "Receita mensal"],
];

let bootGeneration = 0;

const desktopMedia = window.matchMedia("(min-width: 1100px)");

function onDesktop() {
  return desktopMedia.matches;
}

boot();

async function boot() {
  const generation = ++bootGeneration;
  const cached = readMonthCache(state.monthId);
  if (cached) {
    state.data = cached;
    state.monthId = cached.month.id;
    state.authed = true;
    state.booting = false;
    render();
  } else {
    state.booting = true;
    state.data = null;
    setBootProgress(0.3);
    render();
  }
  try {
    const session = await request("/api/session", { attempts: 2 });
    if (generation !== bootGeneration) return;
    setBootProgress(0.62);
    state.needsSetup = session.needsSetup;
    if (session.theme) applyTheme(session.theme);
    if (session.needsSetup) state.authView = "register";
    if (!session.authenticated) {
      state.authed = false;
      state.data = null;
      state.needsPeriod = false;
      state.choosing = false;
      clearMonthCache();
      return;
    }
    state.authed = true;
    setBootProgress(0.84);
    const spacesPromise = request("/api/spaces").then((data) => data.spaces || []).catch(() => []);
    await openBudget();
    setBootProgress(1);
    if (generation !== bootGeneration) return;
    state.spaces = await spacesPromise;
  } catch (error) {
    if (generation !== bootGeneration) return;
    const lostSession = error.status === 401;
    if (!lostSession) state.error = messageOf(error);
    if (lostSession || !state.data) {
      state.authed = false;
      state.data = null;
      state.needsPeriod = false;
      clearMonthCache();
    }
  } finally {
    if (generation !== bootGeneration) return;
    state.booting = false;
    render();
  }
}

async function loadMonth(monthId) {
  let id = monthId || state.monthId;
  if (!id) {
    const period = await request("/api/period");
    id = period.startMonthId || "";
  }
  if (!id) throw new Error("Defina o período para abrir o mês.");
  let data;
  try {
    data = await request(`/api/months/${id}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    const period = await request("/api/period").catch(() => null);
    const fallback = period?.startMonthId && period.startMonthId !== id ? period.startMonthId : "";
    if (!fallback) throw error;
    data = await request(`/api/months/${fallback}`);
  }
  if (!monthId && !sessionStorage.getItem("monthId")) {
    const today = currentMonthId();
    if (today !== data.month.id && data.months.some((month) => month.id === today)) {
      data = await request(`/api/months/${today}`);
    }
  }
  state.data = data;
  if (data.theme) applyTheme(data.theme);
  state.monthId = data.month.id;
  try { sessionStorage.setItem("monthId", data.month.id); } catch { /* o mês segue só nesta aba */ }
  rememberMonth(data);
}

function rememberMonth(data) {
  try {
    sessionStorage.setItem("monthCache:v1", JSON.stringify({ data }));
  } catch {
    sessionStorage.removeItem("monthCache:v1");
  }
}

function readMonthCache(monthId) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem("monthCache:v1") || "");
    const data = parsed?.data;
    if (!data?.month?.id || !Array.isArray(data.months) || !Array.isArray(data.expenses)) return null;
    if (monthId && data.month.id !== monthId) return null;
    return data;
  } catch {
    return null;
  }
}

function clearMonthCache() {
  sessionStorage.removeItem("monthCache:v1");
}

function currentMonthId() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function render() {
  const lockedScroll = document.body.classList.contains("sheet-open")
    ? Number(document.body.dataset.scrollLock || 0)
    : window.scrollY;
  const contentScroll = document.querySelector(".content")?.scrollTop || 0;
  const viewKey = `${state.authed}:${state.monthId}:${state.view}:${state.cardFocus || ""}`;
  const keepPlace = state.viewKey === viewKey;
  root.replaceChildren();
  root.removeAttribute("aria-busy");
  if (state.booting && !state.data) {
    root.append(bootMark());
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    syncOverlayHistory();
    return;
  }
  if (state.authed && !state.data && !state.needsPeriod && !state.choosing) {
    root.append(bootMark(true));
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    syncOverlayHistory();
    return;
  }
  if (!state.authed) {
    root.append(authScreen());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    syncOverlayHistory();
    return;
  }
  if (state.needsPeriod || state.setupGuide) {
    root.append(periodGate());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    syncOverlayHistory();
    return;
  }
  if (state.devicePrompt) {
    root.append(devicePromptScreen());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    syncOverlayHistory();
    return;
  }
  if (state.choosing) {
    root.append(accessScreen());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    syncOverlayHistory();
    return;
  }
  root.append(shell());
  if (state.sheet) root.append(sheet());
  if (state.expenseInfo) root.append(expenseInfoDialog());
  if (state.confirm) root.append(confirmDialog());
  if (state.sheet || state.confirm || state.expenseInfo) lockPage(keepPlace ? lockedScroll : 0);
  else unlockPage(keepPlace ? lockedScroll : 0);
  state.viewKey = viewKey;
  if (keepPlace && onDesktop()) {
    const nextContent = document.querySelector(".content");
    if (nextContent) nextContent.scrollTop = contentScroll;
  }
  queueMicrotask(centerMonthChip);
  syncOverlayHistory();
}

function overlayIsOpen() {
  return Boolean(state.sheet || state.confirm || state.accountMenu || state.expenseInfo);
}

function syncOverlayHistory() {
  if (suppressHistory) return;
  const open = overlayIsOpen();
  if (open && !overlayPushed) {
    history.pushState({ overlay: 1 }, "");
    overlayPushed = true;
    return;
  }
  if (!open && overlayPushed) {
    overlayPushed = false;
    if (history.state && history.state.overlay) {
      suppressHistory = true;
      setTimeout(() => history.back(), 0);
    }
  }
}

function armStay() {
  if (allowLeave) return;
  if (history.state && (history.state.stay || history.state.overlay)) return;
  history.pushState({ stay: 1 }, "");
}

function leavePage() {
  allowLeave = true;
  state.confirm = null;
  state.expenseInfo = null;
  state.sheet = null;
  state.accountMenu = false;
  overlayPushed = false;
  suppressHistory = true;
  history.go(-history.length);
}

window.addEventListener("popstate", () => {
  if (allowLeave) {
    suppressHistory = false;
    overlayPushed = false;
    state.confirm = null;
    state.expenseInfo = null;
    state.sheet = null;
    state.accountMenu = false;
    render();
    return;
  }
  if (suppressHistory) {
    suppressHistory = false;
    return;
  }
  if (overlayPushed) {
    overlayPushed = false;
    if (state.confirm) state.confirm = null;
    else if (state.expenseInfo) state.expenseInfo = null;
    else if (state.accountMenu) state.accountMenu = false;
    else {
      state.sheet = null;
      state.error = "";
    }
    render();
    return;
  }
  if (state.cardFocus) {
    armStay();
    state.cardFocus = null;
    state.showEmpty = false;
    render();
    return;
  }
  armStay();
  state.accountMenu = false;
  state.sheet = null;
  state.error = "";
  state.confirm = "leave";
  render();
});

armStay();

let sheetGuardBound = false;
let sheetTouchY = 0;

function lockPage(scrollY) {
  document.body.dataset.scrollLock = String(scrollY);
  document.body.style.top = `-${scrollY}px`;
  document.documentElement.classList.add("sheet-open");
  document.body.classList.add("sheet-open");
  if (sheetGuardBound) return;
  document.addEventListener("touchstart", rememberSheetTouch, { passive: true });
  document.addEventListener("touchmove", blockBackgroundScroll, { passive: false });
  document.addEventListener("wheel", blockBackgroundWheel, { passive: false });
  document.addEventListener("keydown", blockBackgroundKeys);
  sheetGuardBound = true;
}

function unlockPage(scrollY = Number(document.body.dataset.scrollLock || 0)) {
  if (!document.body.classList.contains("sheet-open")) {
    window.scrollTo(0, scrollY);
    return;
  }
  document.documentElement.classList.remove("sheet-open");
  document.body.classList.remove("sheet-open");
  document.body.style.top = "";
  delete document.body.dataset.scrollLock;
  if (sheetGuardBound) {
    document.removeEventListener("touchstart", rememberSheetTouch);
    document.removeEventListener("touchmove", blockBackgroundScroll);
    document.removeEventListener("wheel", blockBackgroundWheel);
    document.removeEventListener("keydown", blockBackgroundKeys);
    sheetGuardBound = false;
  }
  window.scrollTo(0, scrollY);
}

function rememberSheetTouch(event) {
  sheetTouchY = event.touches[0]?.clientY ?? 0;
}

function blockBackgroundScroll(event) {
  if (!document.body.classList.contains("sheet-open")) return;
  const sheet = event.target.closest?.(".sheet");
  const y = event.touches[0]?.clientY ?? sheetTouchY;
  const dy = y - sheetTouchY;
  sheetTouchY = y;
  if (!sheet || !sheetCanScroll(sheet, dy)) event.preventDefault();
}

function blockBackgroundWheel(event) {
  if (!document.body.classList.contains("sheet-open")) return;
  const sheet = event.target.closest?.(".sheet");
  if (!sheet || !sheetCanScroll(sheet, -event.deltaY)) event.preventDefault();
}

function blockBackgroundKeys(event) {
  if (!document.body.classList.contains("sheet-open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.confirm) closeConfirm();
    else if (state.expenseInfo) closeExpenseInfo();
    else if (state.sheet) closeSheet();
    return;
  }
  if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
  if (event.target.closest?.("input, textarea, select")) return;
  const sheet = event.target.closest?.(".sheet");
  const dy = event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" ? 1 : -1;
  if (!sheet || !sheetCanScroll(sheet, dy)) event.preventDefault();
}

function sheetCanScroll(sheet, dy) {
  if (sheet.scrollHeight - sheet.clientHeight <= 1) return false;
  if (dy > 0 && sheet.scrollTop <= 0) return false;
  if (dy < 0 && sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 1) return false;
  return true;
}

function centerMonthChip() {
  const chip = document.querySelector(".chip.active");
  const scroller = chip?.parentElement;
  if (!chip || !scroller) return;
  const left = chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2;
  scroller.scrollTo({ left: Math.max(0, left) });
}

function setWorking(active, label = "Salvando...") {
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

function authScreen() {
  const registering = state.authView === "register";
  const form = el("form", { class: "lock-card hero" }, [
    el("div", { class: "mark" }, "R$"),
    el("h1", {}, registering ? "Criar conta" : "Entrar"),
    el("p", { class: "lede" }, registering
      ? "Informe CPF, e-mail e senha. O e-mail fica guardado para códigos e avisos futuros."
      : "Entre com CPF e senha para ver a fatura, o custo de vida e os imprevistos."),
    state.error ? el("p", { class: "error" }, state.error) : "",
    authInput("cpf", "CPF", state.auth.cpf, { key: "cpf", inputmode: "numeric", autocomplete: "username", placeholder: "000.000.000-00", mask: "cpf" }),
    registering ? authInput("email", "E-mail", state.auth.email, { key: "email", type: "email", autocomplete: "email", placeholder: "voce@email.com" }) : "",
    authInput("password", "Senha", state.auth.password, { key: "password", type: "password", autocomplete: registering ? "new-password" : "current-password", placeholder: "Mínimo de 8 caracteres" }),
    registering ? authInput("confirmation", "Confirmar senha", state.auth.confirmation, { key: "confirmation", type: "password", autocomplete: "new-password" }) : "",
    el("button", { class: "primary", type: "submit" }, registering ? "Criar conta" : "Entrar"),
    !registering && window.PublicKeyCredential
      ? el("button", { class: "secondary", type: "button", onclick: loginWithPasskey }, "Entrar com digital")
      : "",
    el("p", { class: "auth-switch" }, [
      el("button", {
        class: "linkish",
        type: "button",
        onclick: () => {
          state.authView = registering ? "login" : "register";
          state.error = "";
          state.auth.password = "";
          state.auth.confirmation = "";
          render();
        },
      }, registering ? "Já tenho conta" : "Criar conta"),
    ]),
  ]);
  form.addEventListener("submit", submitAuth);
  return el("main", { class: "screen auth" }, [form]);
}

function authInput(id, label, value, options) {
  const input = el("input", {
    id,
    type: options.type || "text",
    inputmode: options.inputmode || "text",
    autocomplete: options.autocomplete || "off",
    placeholder: options.placeholder || "",
    value,
  });
  input.addEventListener("input", () => {
    const next = options.mask === "cpf" ? formatCpf(input.value) : input.value;
    state.auth[options.key] = next;
    if (next !== input.value) input.value = next;
  });
  return el("div", { class: "field" }, [el("label", { for: id }, label), input]);
}

function formatCpf(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

async function submitAuth(event) {
  event.preventDefault();
  const registering = state.authView === "register";
  state.error = "";
  if (registering && state.auth.password !== state.auth.confirmation) {
    state.error = "A confirmação da senha não confere.";
    render();
    return;
  }
  setWorking(true, registering ? "Criando conta..." : "Entrando...");
  try {
    const body = registering
      ? {
        cpf: state.auth.cpf,
        email: state.auth.email,
        password: state.auth.password,
        passwordConfirmation: state.auth.confirmation,
      }
      : { cpf: state.auth.cpf, password: state.auth.password };
    await request(registering ? "/api/register" : "/api/login", {
      method: "POST",
      body,
      attempts: registering ? 1 : 2,
    });
    state.authed = true;
    state.needsSetup = false;
    state.auth.password = "";
    state.auth.confirmation = "";
    await enterApp();
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function loginWithPasskey() {
  state.error = "";
  setWorking(true, "Aguardando a digital...");
  try {
    const options = await request("/api/passkeys/login/options", { method: "POST", body: {}, attempts: 2 });
    const credential = await navigator.credentials.get({ publicKey: publicKeyRequestOptions(options) });
    if (!credential) throw new DOMException("cancelada", "NotAllowedError");
    await request("/api/passkeys/login", { method: "POST", body: credentialToJSON(credential) });
    state.authed = true;
    state.needsSetup = false;
    await enterApp();
  } catch (error) {
    state.error = passkeyMessage(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function registerPasskey() {
  state.error = "";
  setWorking(true, "Aguardando a digital...");
  try {
    const options = await request("/api/passkeys/register/options", { method: "POST", body: {} });
    const credential = await navigator.credentials.create({ publicKey: publicKeyCreationOptions(options) });
    if (!credential) throw new DOMException("cancelada", "NotAllowedError");
    const data = await request("/api/passkeys/register", { method: "POST", body: credentialToJSON(credential) });
    state.passkeys = data.passkeys || [];
    state.notice = "Digital cadastrada neste celular.";
  } catch (error) {
    state.error = passkeyMessage(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function removePasskey(id) {
  if (!window.confirm("Remover a digital deste celular?")) return;
  state.error = "";
  setWorking(true, "Removendo...");
  try {
    const data = await request(`/api/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.passkeys = data.passkeys || [];
    state.notice = "Digital removida deste celular.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function passkeyMessage(error) {
  if (error && error.name === "NotAllowedError") {
    return "A digital foi cancelada ou não há chave cadastrada neste celular.";
  }
  return messageOf(error);
}

function passkeyWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });
}

function publicKeyCreationOptions(options) {
  if (window.PublicKeyCredential?.parseCreationOptionsFromJSON) {
    return PublicKeyCredential.parseCreationOptionsFromJSON(options);
  }
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    user: { ...options.user, id: base64UrlToBuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: base64UrlToBuffer(item.id) })),
  };
}

function publicKeyRequestOptions(options) {
  if (window.PublicKeyCredential?.parseRequestOptionsFromJSON) {
    return PublicKeyCredential.parseRequestOptionsFromJSON(options);
  }
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: base64UrlToBuffer(item.id) })),
  };
}

function credentialToJSON(credential) {
  if (typeof credential.toJSON === "function") return credential.toJSON();
  const response = credential.response;
  if (response.attestationObject) {
    return {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        attestationObject: bufferToBase64Url(response.attestationObject),
        transports: typeof response.getTransports === "function" ? response.getTransports() : [],
      },
    };
  }
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : undefined,
    },
  };
}

function base64UrlToBuffer(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function openBudget() {
  const period = await request("/api/period");
  if (!period.configured) {
    state.needsPeriod = true;
    state.periodDraft = state.periodDraft || defaultPeriodDraft();
    state.data = null;
    clearMonthCache();
    return;
  }
  state.needsPeriod = false;
  maybeAskDevice();
  if (!state.monthId) state.monthId = period.startMonthId || "";
  const cached = readMonthCache(state.monthId);
  if (cached) {
    state.data = cached;
    state.monthId = cached.month.id;
    state.booting = false;
    render();
  }
  await loadMonth(state.monthId);
}

async function enterApp() {
  const data = await request("/api/spaces");
  state.spaces = data.spaces || [];
  if (state.spaces.length > 1) {
    state.choosing = true;
    state.data = null;
    return;
  }
  state.choosing = false;
  await openBudget();
}

async function chooseSpace(ownerId) {
  state.error = "";
  setWorking(true, "Abrindo...");
  try {
    const data = await request("/api/scope", { method: "POST", body: { ownerId } });
    state.spaces = data.spaces || state.spaces;
    state.choosing = false;
    state.sheet = null;
    state.monthId = "";
    clearMonthCache();
    await openBudget();
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function accessScreen() {
  return el("main", { class: "screen auth" }, [
    el("section", { class: "lock-card hero" }, [
      el("div", { class: "mark" }, "R$"),
      el("h1", {}, "Qual acesso?"),
      el("p", { class: "lede" }, "Escolha os seus gastos ou um orçamento que compartilharam com você."),
      state.data ? el("button", { class: "linkish", type: "button", onclick: () => { state.choosing = false; render(); } }, "Voltar") : "",
      state.error ? el("p", { class: "error" }, state.error) : "",
      el("div", { class: "list" }, state.spaces.map(spaceButton)),
    ]),
  ]);
}

function spaceButton(space) {
  const permission = space.permission === "edit" ? "Pode editar" : space.permission === "view" ? "Só visualizar" : "Seu orçamento";
  return el("button", { class: "jump", type: "button", onclick: () => chooseSpace(space.ownerId) }, [
    el("div", { class: "row-between" }, [el("span", {}, space.label), el("strong", {}, permission)]),
    space.detail ? el("small", {}, space.detail) : "",
  ]);
}

function editable() {
  return state.data?.access?.permission !== "view";
}

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

async function saveShare(event) {
  event.preventDefault();
  const draft = state.sheet;
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    const data = await request("/api/shares", { method: "POST", body: { cpf: draft.cpf, permission: draft.permission } });
    state.shares = data.shares || [];
    state.sheet.cpf = "";
    state.notice = "Compartilhamento salvo.";
    const spaces = await request("/api/spaces");
    state.spaces = spaces.spaces || state.spaces;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function setSharePermission(share, permission) {
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

async function removeShare(share) {
  if (!window.confirm(`Parar de compartilhar com ${share.cpf}?`)) return;
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

function screen(child) {
  return el("main", { class: "screen" }, [child]);
}

function setBootProgress(value) {
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

function bootMark(retry = false) {
  return el("main", { class: "screen boot" }, [
    retry ? el("div", { class: "mark" }, "R$") : el("div", { class: "boot-mark", style: `--progress:${state.bootProgress}` }, [
      bootRing(),
      el("div", { class: "mark" }, "R$"),
    ]),
    retry && state.error ? el("p", { class: "lede" }, state.error) : "",
    retry ? el("button", { class: "primary", type: "button", onclick: () => boot() }, "Tentar de novo") : "",
  ]);
}

function shell() {
  const data = state.data;
  const viewingOther = data?.access?.own === false;
  return el("div", { class: "shell" }, [
    el("header", { class: "top" }, [
      el("div", { class: "top-row" }, [
        el("div", { class: "brand-block" }, [
          el("p", { class: "brand" }, viewingOther ? data.access.label : "Gastos"),
          el("p", { class: "brand-sub" }, viewingOther ? "Dados compartilhados" : accountCpf()),
        ]),
        accountButton(),
      ]),
    ]),
    el("div", { class: "months" }, (data.months || []).map(monthChip)),
    el("main", { class: "content" }, [
      state.error && !state.sheet ? el("p", { class: "error" }, state.error) : "",
      state.notice && !state.sheet ? el("p", { class: "note" }, state.notice) : "",
      data.access?.permission === "view"
        ? el("p", { class: "note" }, `Você está vendo os gastos de ${data.access.label}. Dá para consultar, sem alterar.`)
        : data.access && data.access.own === false
          ? el("p", { class: "note" }, `Você está nos gastos de ${data.access.label} e pode alterar.`)
          : "",
      viewBody(data),
    ]),
    el("nav", { class: "nav" }, views.map(([id, label]) => el("button", {
      type: "button",
      class: state.view === id ? "active" : "",
      onclick: () => {
        state.view = id;
        state.cardFocus = null;
        state.showEmpty = false;
        state.error = "";
        state.notice = "";
        render();
      },
    }, [glyph(id), label]))),
  ]);
}

function monthChip(month) {
  const [year, monthNumber] = month.id.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return el("button", {
    type: "button",
    class: `chip${month.id === state.monthId ? " active" : ""}`,
    onclick: () => changeMonth(month.id),
  }, [
    `${names[Number(monthNumber) - 1]} ${year.slice(2)}`,
    month.settled ? "" : el("span", { class: "dot", title: "Ainda falta pagar" }, ""),
  ]);
}

async function changeMonth(monthId) {
  if (monthId === state.monthId || state.busy) return;
  state.error = "";
  setWorking(true, "Abrindo...");
  try {
    await loadMonth(monthId);
    state.showEmpty = false;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function viewBody(data) {
  if (state.view === "resumo") return summary(data);
  if (state.view === "receita") return incomeView(data);
  if (state.view === "cartoes") return state.cardFocus ? cardDetail(data) : cardsHome(data);
  if (state.view === "casa") return sectionList(data, "fixed");
  return sectionList(data, "extra");
}

function summary(data) {
  const { month, totals } = data;
  return el("section", {}, [
    el("article", { class: "hero" }, [
      el("p", { class: "eyebrow" }, month.label),
      el("p", { class: "muted" }, "Falta pagar"),
      el("p", { class: "money" }, money(totals.remainingCents)),
      el("p", { class: "muted" }, `Total do mês ${money(totals.forecastExpenseCents)} · já pago ${money(totals.paidCents)}`),
      totals.forecastExpenseCents > totals.partialExpenseCents
        ? el("p", { class: "muted" }, "Inclui o custo de vida que ainda está previsto.")
        : "",
      month.settled ? el("p", { class: "badge paid" }, "Mês quitado") : "",
    ]),
    el("div", { class: "grid" }, [
      el("button", { class: "metric wide", type: "button", onclick: () => { state.view = "receita"; render(); } }, [
        el("small", {}, "Receita mensal"),
        el("strong", {}, money(month.incomeCents)),
        month.extraIncomeCents ? el("small", {}, `inclui ${money(month.extraIncomeCents)} extras`) : "",
      ]),
      el("div", { class: "metric" }, [
        el("small", {}, "Despesa prevista"),
        el("strong", {}, money(totals.forecastExpenseCents)),
        el("small", {}, "Despesa parcial"),
        el("strong", {}, money(totals.partialExpenseCents)),
      ]),
      el("div", { class: "metric" }, [
        el("small", {}, "Saldo previsto"),
        el("strong", { class: totals.balanceCents < 0 ? "negative" : "positive" }, money(totals.balanceCents)),
        el("small", {}, "Saldo parcial"),
        el("strong", { class: totals.partialBalanceCents < 0 ? "negative" : "positive" }, money(totals.partialBalanceCents)),
      ]),
    ]),
    jump("cartoes", "Fatura do cartão", money(totals.faturaCents), totals.extrasCardCents
      ? `${money(totals.invoiceCents)} previstos + ${money(totals.extrasCardCents)} em imprevistos`
      : "Nubank, Neon e linhas da fatura"),
    livingJump(totals),
    jump("extras", "Imprevisto / Planejado", money(totals.extrasCardCents + totals.extrasPixCents), `${money(totals.extrasPixCents)} fora do cartão · ${money(totals.extrasCardCents)} no cartão`),
    editable() && totals.launchedRemainingCents > 0
      ? el("button", { class: "primary", type: "button", onclick: () => askConfirm("settle") }, "Quitar o que falta")
      : editable() && month.settled
        ? el("button", { class: "secondary", type: "button", onclick: () => askConfirm("reopen") }, "Reabrir mês")
        : "",
    editable() ? el("button", { class: "secondary", type: "button", onclick: () => askConfirm("copy") }, "Trazer lançamentos do mês anterior") : "",
  ]);
}

function accountCpf() {
  return (state.spaces || []).find((space) => space.permission === "own")?.detail || "";
}

function accountButton() {
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

function personGlyph() {
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

function askConfirm(kind) {
  state.accountMenu = false;
  state.error = "";
  state.confirm = kind;
  render();
}

function confirmCopy() {
  const month = state.data?.month?.label || "este mês";
  if (state.confirm === "reset") {
    return {
      title: "Confirmar exclusão",
      body: state.confirmReset?.text || "Apagar esses dados?",
      action: "Confirmar",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "logout") {
    return {
      title: "Sair da conta?",
      body: "Você volta para a tela de entrada. Dá para entrar de novo com CPF e senha.",
      action: "Sair",
      cancel: "Ficar",
    };
  }
  if (state.confirm === "leave") {
    return {
      title: "Sair do app?",
      body: "Você volta para a tela anterior do navegador.",
      action: "Sair",
      cancel: "Ficar",
    };
  }
  if (state.confirm === "delete-card") {
    const name = state.confirmCard?.name || "este cartão";
    return {
      title: "Excluir cartão",
      body: `Excluir “${name}”? Só dá para excluir um cartão que não tem gastos lançados.`,
      action: "Excluir",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "past-due") {
    return {
      title: "Vencimento já passou",
      body: state.pastDue?.body || "O vencimento desta fatura já passou. Quer registrar mesmo assim?",
      action: "Registrar mesmo assim",
      cancel: "Não registrar",
    };
  }
  if (state.confirm === "settle") {
    return {
      title: "Quitar o que falta",
      body: `Marca como pagos a fatura e os imprevistos ainda em aberto em ${month}. O custo de vida previsto continua em falta até você lançar Pago no Pix, Enviar pro cartão ou Pagamento parcial. O mês só fica quitado quando esse valor zera.`,
      action: "Quitar",
      cancel: "Cancelar",
    };
  }
  if (state.confirm === "reopen") {
    return {
      title: "Reabrir mês",
      body: `Desmarca os pagamentos de ${month}. A fatura, o Pix e os imprevistos voltam a ficar em aberto.`,
      action: "Reabrir",
      cancel: "Cancelar",
    };
  }
  return {
    title: "Trazer lançamentos",
    body: `Copia para ${month} os gastos fixos e as parcelas que ainda continuam no mês anterior. O que já existe aqui, com o mesmo nome e o mesmo tipo, não é duplicado. Os novos lançamentos entram em aberto.`,
    action: "Trazer",
    cancel: "Cancelar",
  };
}

function confirmDialog() {
  const copy = confirmCopy();
  const wait = state.confirm === "reset" ? resetSecondsLeft() : 0;
  const overlay = el("div", {
    class: "overlay center",
    role: "presentation",
    onclick: (event) => {
      if (event.target === overlay) closeConfirm();
    },
  }, [
    el("div", { class: "dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "confirm-title" }, [
      el("h2", { id: "confirm-title" }, copy.title),
      el("p", {}, copy.body),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeConfirm }, copy.cancel),
        el("button", {
          class: "primary",
          type: "button",
          disabled: wait > 0 ? "" : null,
          onclick: wait > 0 ? () => {} : runConfirm,
        }, wait > 0 ? `Confirmar em ${wait}s` : copy.action),
      ]),
    ]),
  ]);
  return overlay;
}

function closeConfirm() {
  clearTimeout(state.resetTimer);
  state.confirm = null;
  render();
}

function resetSecondsLeft() {
  return Math.max(0, Math.ceil((state.resetReadyAt - Date.now()) / 1000));
}

function pulseResetConfirm() {
  clearTimeout(state.resetTimer);
  if (state.confirm !== "reset") return;
  if (resetSecondsLeft() <= 0) return;
  const left = resetSecondsLeft();
  const delay = state.resetReadyAt - Date.now() - (left - 1) * 1000;
  state.resetTimer = setTimeout(() => {
    if (state.confirm !== "reset") return;
    render();
    pulseResetConfirm();
  }, Math.max(200, delay));
}

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function defaultPeriodDraft() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 11, 1);
  return {
    startMonth: String(now.getMonth() + 1).padStart(2, "0"),
    startYear: String(now.getFullYear()),
    endMonth: String(end.getMonth() + 1).padStart(2, "0"),
    endYear: String(end.getFullYear()),
  };
}

function periodParts(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthId || "");
  if (!match) return defaultPeriodDraft();
  return { month: match[2], year: match[1] };
}

function periodYears(draft) {
  const now = new Date().getFullYear();
  const years = new Set();
  for (let year = now - 5; year <= now + 6; year += 1) years.add(String(year));
  if (draft?.startYear) years.add(String(draft.startYear));
  if (draft?.endYear) years.add(String(draft.endYear));
  return [...years].sort();
}

function periodSelect(draft, key, label, values, labels) {
  const select = el("select", { id: key }, values.map((value, index) => el("option", { value }, labels[index])));
  select.value = draft[key];
  select.addEventListener("change", () => {
    draft[key] = select.value;
  });
  return el("div", { class: "field" }, [el("label", { for: key }, label), select]);
}

function periodFields(draft) {
  const months = MONTH_NAMES.map((_, index) => String(index + 1).padStart(2, "0"));
  const years = periodYears(draft);
  return el("div", {}, [
    el("div", { class: "pair" }, [
      periodSelect(draft, "startMonth", "Mês inicial", months, MONTH_NAMES),
      periodSelect(draft, "startYear", "Ano inicial", years, years),
    ]),
    el("div", { class: "pair" }, [
      periodSelect(draft, "endMonth", "Mês final", months, MONTH_NAMES),
      periodSelect(draft, "endYear", "Ano final", years, years),
    ]),
  ]);
}

function cardDueDay(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const day = Number(text);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("O vencimento é um dia de 1 a 31.");
  return day;
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

function rememberDevicePrompt() {
  try { localStorage.setItem("devicePrompt", "1"); } catch { /* segue sem gravar */ }
}

function maybeAskDevice() {
  if (!window.PublicKeyCredential) return;
  try {
    if (localStorage.getItem("devicePrompt") === "1") return;
  } catch {
    return;
  }
  state.devicePrompt = true;
}

function devicePromptScreen() {
  return el("main", { class: "screen auth" }, [
    el("h1", {}, "Cadastrar este dispositivo?"),
    el("p", { class: "lede" }, "Se for um celular ou outro aparelho com leitor biométrico, você entra depois usando só a digital, sem digitar CPF e senha."),
    state.error ? el("p", { class: "error" }, state.error) : "",
    el("button", {
      class: "primary",
      type: "button",
      disabled: state.busy ? "" : null,
      onclick: () => offerDevice(() => {
        state.devicePrompt = false;
        rememberDevicePrompt();
        render();
      }),
    }, state.busy ? "Aguardando..." : "Cadastrar digital"),
    el("button", {
      class: "secondary",
      type: "button",
      onclick: () => {
        state.devicePrompt = false;
        state.error = "";
        rememberDevicePrompt();
        render();
      },
    }, "Agora não"),
  ]);
}

async function offerDevice(after) {
  if (!window.PublicKeyCredential) {
    state.error = "Este aparelho não tem leitor biométrico. Dá para continuar com CPF e senha.";
    render();
    return;
  }
  state.error = "";
  setWorking(true, "Aguardando a digital...");
  render();
  try {
    const options = await request("/api/passkeys/register/options", { method: "POST", body: {} });
    const credential = await navigator.credentials.create({ publicKey: publicKeyCreationOptions(options) });
    if (!credential) throw new DOMException("cancelada", "NotAllowedError");
    const data = await request("/api/passkeys/register", { method: "POST", body: credentialToJSON(credential) });
    state.passkeys = data.passkeys || [];
    state.notice = "Digital cadastrada neste aparelho.";
    rememberDevicePrompt();
  } catch (error) {
    state.error = passkeyMessage(error);
    setWorking(false);
    renderSafely();
    return;
  }
  setWorking(false);
  await after();
}

function ensureSetup() {
  if (!state.setup) {
    const period = defaultPeriodDraft();
    state.setup = {
      step: 0,
      ...period,
      hasCards: "no",
      cards: [{ name: "", dueDay: "10" }],
      income: "",
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    };
  }
  return state.setup;
}

function setupChoice(label, current, options, onpick) {
  return el("div", { class: "field" }, [
    el("label", {}, label),
    el("div", { class: "choice" }, options.map(([value, text]) => el("button", {
      type: "button",
      class: current === value ? "on" : "",
      onclick: () => onpick(value),
    }, text))),
  ]);
}

function setupInput(id, label, value, oninput, placeholder, mode) {
  const input = el("input", {
    id,
    value,
    placeholder,
    inputmode: mode === "decimal" ? "decimal" : mode === "numeric" ? "numeric" : "text",
  });
  input.addEventListener("input", () => oninput(input.value));
  return el("div", { class: "field" }, [el("label", { for: id }, label), input]);
}

function periodGate() {
  if (state.setupGuide) return setupGuide();
  const draft = ensureSetup();
  const titles = [
    "Qual período você quer planejar?",
    "Você usa cartão?",
    "Qual é a renda mensal base?",
    "Como prefere ver o app?",
    "Cadastrar este dispositivo?",
  ];
  const notes = [
    "Escolha o primeiro e o último mês. Dá para alterar depois, no seu perfil.",
    "Se usar, cadastre cada um com um apelido e o dia de vencimento da fatura.",
    "Só o valor que entra todo mês, sem décimo, férias ou outros extras.",
    "Dá para trocar o modo claro ou escuro depois, no seu perfil.",
    "Se for um celular ou outro aparelho com leitor biométrico, você entra depois só com a digital, sem digitar CPF e senha.",
  ];
  const body = [];
  if (draft.step === 0) body.push(periodFields(draft));
  if (draft.step === 1) {
    body.push(setupChoice("Cartão", draft.hasCards, [["no", "Não uso"], ["yes", "Tenho cartão"]], (value) => {
      draft.hasCards = value;
      render();
    }));
    if (draft.hasCards === "yes") {
      draft.cards.forEach((card, index) => {
        body.push(el("div", { class: "pair" }, [
          setupInput(`card-name-${index}`, "Apelido", card.name, (value) => { card.name = value; }, "Nubank, Neon..."),
          setupInput(`card-due-${index}`, "Vencimento", card.dueDay, (value) => { card.dueDay = value; }, "10", "numeric"),
        ]));
      });
      body.push(el("div", { class: "actions" }, [
        draft.cards.length > 1 ? el("button", {
          class: "secondary",
          type: "button",
          onclick: () => { draft.cards.pop(); render(); },
        }, "Remover o último") : "",
        el("button", {
          class: "secondary",
          type: "button",
          onclick: () => { draft.cards.push({ name: "", dueDay: "10" }); render(); },
        }, "Adicionar outro cartão"),
      ]));
    }
  }
  if (draft.step === 2) {
    body.push(setupInput("base-setup", "Renda base", draft.income, (value) => { draft.income = value; }, "8000,00", "decimal"));
  }
  if (draft.step === 3) {
    body.push(setupChoice("Aparência", draft.theme, [["light", "Modo claro"], ["dark", "Modo escuro"]], (value) => {
      draft.theme = value;
      applyTheme(value);
      render();
    }));
  }
  return el("main", { class: "screen auth" }, [
    el("p", { class: "eyebrow" }, `Passo ${draft.step + 1} de 5`),
    el("h1", {}, titles[draft.step] || titles[0]),
    el("p", { class: "lede" }, notes[draft.step] || ""),
    state.error ? el("p", { class: "error" }, state.error) : "",
    ...body,
    el("div", { class: "actions" }, [
      draft.step > 0 ? el("button", { class: "secondary", type: "button", onclick: () => { draft.step -= 1; state.error = ""; render(); } }, "Voltar") : "",
      draft.step === 4 ? el("button", {
        class: "primary",
        type: "button",
        disabled: state.busy ? "" : null,
        onclick: () => offerDevice(() => { rememberDevicePrompt(); saveSetup(draft); }),
      }, state.busy ? "Aguardando..." : "Cadastrar digital") : "",
      draft.step === 4 ? el("button", {
        class: "secondary",
        type: "button",
        onclick: () => { state.error = ""; rememberDevicePrompt(); saveSetup(draft); },
      }, "Agora não") : "",
      draft.step === 4 ? "" : el("button", {
        class: "primary",
        type: "button",
        disabled: state.busy ? "" : null,
        onclick: () => advanceSetup(draft),
      }, state.busy ? "Salvando..." : "Continuar"),
    ]),
  ]);
}

function advanceSetup(draft) {
  state.error = "";
  try {
    if (draft.step === 0) {
      const start = `${draft.startYear}-${draft.startMonth}`;
      const end = `${draft.endYear}-${draft.endMonth}`;
      if (end < start) throw new Error("O último mês precisa ser igual ou posterior ao primeiro.");
    }
    if (draft.step === 1 && draft.hasCards === "yes") {
      const names = new Set();
      for (const card of draft.cards) {
        const name = card.name.trim().toLocaleLowerCase("pt-BR");
        if (!name) throw new Error("Dê um apelido ao cartão.");
        if (names.has(name)) throw new Error("Cada cartão precisa de um apelido diferente.");
        names.add(name);
        cardDueDay(card.dueDay);
        if (!String(card.dueDay || "").trim()) throw new Error("Informe o dia de vencimento, de 1 a 31.");
      }
    }
    if (draft.step === 2) {
      const amount = parseMoney(draft.income || "");
      if (amount === null || amount < 0) throw new Error("Informe a renda base. Exemplo: 8000,00. Use 0 se preferir deixar para depois.");
    }
  } catch (error) {
    state.error = messageOf(error);
    render();
    return;
  }
  if (draft.step < 4) {
    draft.step += 1;
    render();
    return;
  }
  saveSetup(draft);
}

async function saveSetup(draft) {
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    const startMonthId = `${draft.startYear}-${draft.startMonth}`;
    const endMonthId = `${draft.endYear}-${draft.endMonth}`;
    state.data = await request("/api/period", { method: "POST", body: { startMonthId, endMonthId } });
    if (draft.hasCards === "yes") {
      for (const card of draft.cards) {
        await request("/api/cards", { method: "POST", body: { name: card.name.trim(), dueDay: cardDueDay(card.dueDay) } });
      }
    }
    const amountCents = parseMoney(draft.income || "0");
    state.data = await request("/api/income/base", {
      method: "POST",
      body: { amountCents, scope: "all", monthId: state.data.month.id },
    });
    await request("/api/theme", { method: "POST", body: { theme: draft.theme } });
    applyTheme(draft.theme);
    state.needsPeriod = false;
    state.monthId = state.data.month.id;
    sessionStorage.setItem("monthId", state.monthId);
    rememberMonth(state.data);
    state.setup = null;
    state.setupGuide = true;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function setupGuide() {
  const guides = [
    ["Resumo mensal", "O panorama do mês: o que falta pagar, o saldo e o caminho para as outras abas."],
    ["Cartões de crédito", onDesktop()
      ? "A fatura de cada cartão. Clique no cartão para ver os lançamentos. O dia de vencimento aparece junto do apelido."
      : "A fatura de cada cartão. Toque no cartão para ver os lançamentos. O dia de vencimento aparece junto do apelido."],
    ["Custo de vida", onDesktop()
      ? "As contas que voltam todo mês. Use os botões ao lado para pagar no Pix, enviar pro cartão, editar ou excluir."
      : "As contas que voltam todo mês. Puxe para a direita para pagar no Pix ou enviar pro cartão. Puxe para a esquerda para editar ou excluir."],
    ["Imprevisto / Planejado", "Imprevistos e gastos planejados. Os dois podem sair no Pix ou no crédito."],
    ["Receita mensal", "A renda base e os extras do mês, como décimo terceiro ou um valor avulso."],
  ];
  return el("main", { class: "screen auth" }, [
    el("p", { class: "eyebrow" }, "Como usar"),
    el("h1", {}, "Cada aba tem um papel"),
    el("p", { class: "lede" }, "O período, os cartões e a aparência continuam disponíveis no perfil e na aba Cartões de crédito."),
    el("div", { class: "list" }, guides.map(([title, text]) => el("article", { class: "item" }, [
      el("div", { class: "item-copy" }, [
        el("strong", {}, title),
        el("small", {}, text),
      ]),
    ]))),
    el("button", {
      class: "primary",
      type: "button",
      onclick: () => {
        state.setupGuide = false;
        state.notice = "Configuração pronta.";
        render();
      },
    }, "Começar a usar"),
  ]);
}

function openPeriod() {
  state.accountMenu = false;
  state.error = "";
  const months = state.data?.months || [];
  const start = periodParts(months[0]?.id);
  const end = periodParts(months[months.length - 1]?.id || months[0]?.id);
  state.sheet = {
    mode: "period",
    startMonth: start.month,
    startYear: start.year,
    endMonth: end.month,
    endYear: end.year,
  };
  render();
}

function openReset() {
  state.accountMenu = false;
  state.error = "";
  const months = state.data?.months || [];
  const current = months.some((month) => month.id === state.monthId) ? state.monthId : months[0]?.id || "";
  state.sheet = {
    mode: "reset",
    scope: "all",
    year: current.slice(0, 4),
    monthId: current,
  };
  render();
}

async function savePeriod(draft, first) {
  const startMonthId = `${draft.startYear}-${draft.startMonth}`;
  const endMonthId = `${draft.endYear}-${draft.endMonth}`;
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    state.data = await request("/api/period", { method: "POST", body: { startMonthId, endMonthId } });
    state.needsPeriod = false;
    state.sheet = null;
    state.monthId = state.data.month.id;
    sessionStorage.setItem("monthId", state.monthId);
    rememberMonth(state.data);
    state.notice = first
      ? "Período definido. Você pode alterá-lo depois, no seu perfil."
      : "Período atualizado.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function describeReset(draft) {
  if (draft.scope === "year") {
    if (!draft.year) return null;
    return {
      body: { scope: "year", year: Number(draft.year), focusMonthId: state.monthId },
      text: `Isso apaga os gastos e as receitas extras de ${draft.year}. Os meses continuam, zerados.`,
    };
  }
  if (draft.scope === "month") {
    const month = (state.data?.months || []).find((item) => item.id === draft.monthId);
    if (!month) return null;
    return {
      body: { scope: "month", monthId: month.id, focusMonthId: state.monthId },
      text: `Isso apaga os gastos e as receitas extras de ${month.label}. O mês continua, zerado.`,
    };
  }
  return {
    body: { scope: "all", focusMonthId: state.monthId },
    text: "Isso apaga todos os gastos, as receitas, os cartões e o período. Em seguida você sai da conta. Ao entrar de novo, o formulário de primeiro login aparece outra vez.",
  };
}

function askReset() {
  const detail = describeReset(state.sheet || {});
  if (!detail) {
    state.error = "Escolha o período que será apagado.";
    render();
    return;
  }
  state.confirmReset = detail;
  state.sheet = null;
  state.accountMenu = false;
  clearTimeout(state.resetTimer);
  state.resetReadyAt = Date.now() + 5000;
  state.confirm = "reset";
  render();
  pulseResetConfirm();
}

async function executeReset() {
  const detail = state.confirmReset;
  if (!detail) return;
  state.error = "";
  setWorking(true, "Apagando...");
  try {
    const data = await request("/api/reset", { method: "POST", body: detail.body });
    if (data.wiped) {
      state.confirmReset = null;
      state.setup = null;
      state.setupGuide = false;
      state.devicePrompt = false;
      state.monthId = "";
      sessionStorage.removeItem("monthId");
      clearMonthCache();
      applyTheme("light");
      await logout();
      return;
    }
    state.data = data;
    state.monthId = state.data.month.id;
    sessionStorage.setItem("monthId", state.monthId);
    rememberMonth(state.data);
    state.notice = "Dados apagados.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function runConfirm() {
  const kind = state.confirm;
  if (kind === "reset" && resetSecondsLeft() > 0) return;
  clearTimeout(state.resetTimer);
  state.confirm = null;
  if (kind === "leave") {
    leavePage();
    return;
  }
  if (kind === "logout") {
    await logout();
    return;
  }
  if (kind === "reset") {
    await executeReset();
    return;
  }
  if (kind === "delete-card") {
    await removeCard(state.confirmCard);
    return;
  }
  if (kind === "past-due") {
    if (state.sheet && state.pastDue) state.sheet.acceptedDueKey = state.pastDue.key;
    render();
    await saveSheet({ preventDefault() {} });
    return;
  }
  if (kind === "copy") await copyPrevious();
  else if (kind === "settle") await settle("pay-remaining");
  else if (kind === "reopen") await settle("reopen");
  else render();
}

function jump(view, title, amount, detail) {
  return el("button", {
    class: "jump",
    type: "button",
    onclick: () => {
      state.view = view;
      render();
    },
  }, [
    el("div", { class: "row-between" }, [el("span", {}, title), el("strong", {}, amount)]),
    el("small", {}, detail),
  ]);
}

function cardsHome(data) {
  const cards = data.cards || [];
  const children = [
    el("div", { class: "section-head" }, [
      el("p", { class: "eyebrow" }, data.month.label),
      el("h2", {}, money(data.totals.faturaCents)),
      el("p", { class: "muted" }, blurb("card", data.totals)),
    ]),
    el("p", { class: "note" }, onDesktop()
      ? "Clique num cartão para ver o detalhamento. Os botões embaixo editam ou quitam o cartão. Excluir só quando ele não tiver gastos."
      : "Toque num cartão para ver o detalhamento. Dá para editar o cartão. Excluir só quando ele não tiver gastos."),
    el("p", { class: "note" }, "Os gastos entram por Custo de vida, Imprevisto ou Planejado. Aqui a fatura só mostra o que já foi classificado."),
    editable() ? el("div", { class: "stack-actions" }, [
      el("button", { class: "secondary", type: "button", onclick: () => { state.error = ""; openCreateCard(); } }, "Adicionar cartão"),
    ]) : "",
  ];
  if (!cards.length) children.push(el("p", { class: "muted" }, "Nenhum cartão ainda."));
  for (const card of cards) {
    children.push(cardManageRow(card, cardInvoiceCents(data.expenses, card.name), expensesForCardName(data.expenses, card.name)));
  }
  const loose = unassignedCardExpenses(data.expenses, cards);
  if (loose.some(shownExpense)) {
    const amount = loose
      .filter((expense) => !fixedOnCard(expense))
      .reduce((sum, expense) => sum + expense.amountCents, 0);
    children.push(cardJump("Sem cartão", amount, loose, () => openCard("unassigned")));
  }
  return el("section", {}, children);
}

function cardDetail(data) {
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
      el("p", { class: "eyebrow" }, data.month.label),
      el("h2", {}, card ? card.name : "Sem cartão"),
      el("p", { class: "money inline" }, money(total)),
      el("p", { class: "muted" }, card
        ? "Gastos vinculados a este cartão. O custo de vida que já virou lançamento aparece na fatura."
        : "Estes gastos ainda não têm um cartão cadastrado."),
    ]),
    editable() && card ? cardTools(card) : "",
    el("p", { class: "note" }, "Esta fatura reúne custo de vida, imprevisto e planejado. Edite um gasto para mudar o valor e a tarja: ele continua no cartão e passa para a aba escolhida."),
  ];
  const groups = [
    ["Fatura prevista", visible.filter((expense) => expense.section === "card")],
    ["Imprevistos", visible.filter((expense) => expense.section === "extra" && !isPlannedNote(expense.note))],
    ["Planejados", visible.filter((expense) => expense.section === "extra" && isPlannedNote(expense.note))],
    ["Custo de vida, já na fatura", visible.filter((expense) => expense.section === "fixed" && !linkedInvoice(expense))],
  ];
  for (const [title, rows] of groups) {
    if (!rows.length) continue;
    children.push(el("p", { class: "eyebrow group" }, title));
    children.push(el("div", { class: "list" }, rows.map((expense) => expenseRow(expense, "card", { manage: editable(), cardExpense: editable() }))));
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

let openSwipe = null;

desktopMedia.addEventListener("change", () => {
  if (openSwipe) closeSwipe(openSwipe);
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.accountMenu) return;
  if (state.sheet || state.confirm || state.expenseInfo) return;
  state.accountMenu = false;
  render();
});
let ignoreSwipeClickUntil = 0;

function closeSwipe(front) {
  if (!front) return;
  front.classList.remove("dragging");
  front.style.transform = "";
  front.dataset.x = "0";
  if (openSwipe === front) openSwipe = null;
}

function placeSwipe(front, x) {
  front.style.transform = x ? `translateX(${x}px)` : "";
  front.dataset.x = String(x);
  if (x === 0) {
    if (openSwipe === front) openSwipe = null;
    return;
  }
  if (openSwipe && openSwipe !== front) closeSwipe(openSwipe);
  openSwipe = front;
}

function runSwipeAction(front, action, event) {
  if (!action || action.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  ignoreSwipeClickUntil = Date.now() + 700;
  closeSwipe(front);
  action.run();
}

function swipeRow(front, { pay, leads, actions, card }) {
  const leadActions = leads || (pay ? [{ ...pay, tone: pay.undo ? "undo" : "pay", commit: true }] : []);
  const leadBox = el("div", { class: "swipe-lead" }, leadActions.map((action) => {
    const lines = String(action.label).split("\n");
    return el("button", {
      type: "button",
      class: `swipe-act ${action.tone || "pay"}`,
      "aria-label": lines.join(" "),
      onpointerup: (event) => runSwipeAction(front, action, event),
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
    }, lines.map((line) => el("span", {}, line)));
  }));
  const trail = el("div", { class: "swipe-trail" }, (actions || []).map((action) => el("button", {
    type: "button",
    class: `swipe-act ${action.tone}`,
    disabled: action.disabled ? "" : null,
    title: action.title || action.label,
    onpointerup: (event) => runSwipeAction(front, action, event),
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
  }, action.label)));
  const back = el("div", { class: "swipe-back" }, [
    leadBox,
    el("span", { class: "swipe-gap" }),
    trail,
  ]);
  front.classList.add("swipe-front");
  const shell = el("div", { class: card ? "swipe card-swipe" : "swipe" }, [back, front]);
  let startX = 0;
  let startY = 0;
  let base = 0;
  let dragging = false;
  let axis = "";
  let suppressClick = false;

  function widthOfTrail() {
    return trail.getBoundingClientRect().width || (actions || []).length * 88;
  }

  function widthOfLead() {
    return leadBox.getBoundingClientRect().width || leadActions.length * 84;
  }

  function moveTo(x) {
    const next = Math.max(-widthOfTrail(), Math.min(widthOfLead(), x));
    front.style.transform = `translateX(${next}px)`;
    front.dataset.x = String(next);
    return next;
  }

  front.addEventListener("pointerdown", (event) => {
    if (onDesktop() || event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    base = Number(front.dataset.x || 0);
    dragging = true;
    axis = "";
    suppressClick = false;
    front.classList.add("dragging");
    try { front.setPointerCapture(event.pointerId); } catch { /* o navegador segue o ponteiro mesmo assim */ }
  });
  front.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axis !== "x") return;
    event.preventDefault();
    suppressClick = true;
    moveTo(base + dx);
  }, { passive: false });
  function finish() {
    if (!dragging) return;
    dragging = false;
    front.classList.remove("dragging");
    const x = Number(front.dataset.x || 0);
    const trailWidth = widthOfTrail();
    const leadWidth = widthOfLead();
    const solo = leadActions.length === 1 && leadActions[0].commit ? leadActions[0] : null;
    if (suppressClick) ignoreSwipeClickUntil = Date.now() + 700;
    if (solo && x > 72) {
      closeSwipe(front);
      solo.run();
      return;
    }
    if (leadWidth && x > leadWidth * 0.35) {
      placeSwipe(front, leadWidth);
      return;
    }
    if (trailWidth && x < -trailWidth * 0.35) {
      placeSwipe(front, -trailWidth);
      return;
    }
    closeSwipe(front);
  }
  function endDrag(event) {
    try { front.releasePointerCapture(event.pointerId); } catch { /* a captura já terminou */ }
    finish();
  }
  front.addEventListener("pointerup", endDrag);
  front.addEventListener("pointercancel", endDrag);
  front.addEventListener("click", (event) => {
    if (suppressClick || Date.now() < ignoreSwipeClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
      return;
    }
    if (Number(front.dataset.x || 0) === 0) return;
    event.preventDefault();
    event.stopPropagation();
    closeSwipe(front);
  }, true);
  back.addEventListener("click", (event) => {
    if (event.target.closest(".swipe-act")) return;
    if (Date.now() < ignoreSwipeClickUntil) return;
    if (Number(front.dataset.x || 0) === 0) return;
    closeSwipe(front);
  });
  return shell;
}

document.addEventListener("pointerdown", (event) => {
  if (!openSwipe) return;
  const shell = openSwipe.closest(".swipe");
  if (shell && shell.contains(event.target)) return;
  closeSwipe(openSwipe);
});

function cardManageRow(card, amount, expenses) {
  const count = expenses.filter((expense) => shownExpense(expense) && !linkedLivingCost(expense)).length;
  const blocked = Number(card.expenseCount) > 0;
  const balance = openCardBalance(expenses);
  const settled = amount > 0 && balance === 0;
  const front = el("article", { class: `jump card-manage${settled ? " paid" : ""}` }, [
    el("button", { type: "button", class: "item-main", onclick: () => openCard(card.id) }, [
      el("div", { class: "row-between" }, [
        el("span", { class: "card-title" }, card.name),
        el("div", { class: "item-end" }, [
          amount > 0 ? el("span", { class: settled ? "badge paid" : "badge open" }, settled ? "Pago" : "Em aberto") : "",
          el("strong", { class: "amount" }, money(amount)),
        ]),
      ]),
      el("small", {}, [card.dueDay ? `Vence dia ${card.dueDay}` : "", count === 0 ? "Nenhum gasto neste mês" : `${count} ${count === 1 ? "gasto" : "gastos"}`].filter(Boolean).join(" · ")),
    ]),
  ]);
  if (!editable()) return front;
  const leads = balance > 0 ? [
    { label: "Pago\nno Pix", tone: "pay", run: () => payCardPix(card) },
    { label: "Pago\nparcelado", tone: "send", run: () => openCardPayoff(card, balance) },
  ] : settled ? [
    { label: "Desfazer", tone: "undo", commit: true, run: () => undoCardPayment(card) },
  ] : null;
  return swipeRow(front, {
    card: true,
    leads,
    actions: [
      { label: "Editar", tone: "edit", run: () => openEditCard(card) },
      {
        label: "Excluir",
        tone: "delete",
        disabled: blocked,
        title: blocked ? "Este cartão tem gastos lançados." : "Excluir cartão",
        run: () => askDeleteCard(card),
      },
    ],
  });
}

function cardTools(card) {
  const blocked = Number(card.expenseCount) > 0;
  return el("div", { class: "item-actions" }, [
    el("button", { type: "button", class: "linkish", onclick: () => openEditCard(card) }, "Editar"),
    el("button", {
      type: "button",
      class: "linkish danger",
      disabled: blocked ? "" : null,
      title: blocked ? "Este cartão tem gastos lançados." : "Excluir cartão",
      onclick: () => askDeleteCard(card),
    }, "Excluir"),
  ]);
}

function backArrow() {
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

function openEditCard(card) {
  state.error = "";
  state.sheet = { mode: "card", id: card.id, name: card.name, dueDay: card.dueDay ? String(card.dueDay) : "", previousName: card.name };
  render();
}

function askDeleteCard(card) {
  if (Number(card.expenseCount) > 0) {
    state.error = "Este cartão tem gastos lançados. A exclusão só fica disponível quando não houver nenhum.";
    render();
    return;
  }
  state.error = "";
  state.confirmCard = card;
  state.confirm = "delete-card";
  render();
}

async function removeCard(card) {
  if (!card?.id) return;
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    const data = await request(`/api/cards/${card.id}`, { method: "DELETE" });
    state.data.cards = data.cards;
    if (state.cardFocus === card.id) state.cardFocus = null;
    state.notice = `Cartão “${card.name}” excluído.`;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function sameCardName(left, right) {
  return String(left || "").trim().toLocaleLowerCase("pt-BR") === String(right || "").trim().toLocaleLowerCase("pt-BR");
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDueDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function monthPhrase(monthId) {
  const month = (state.data?.months || []).find((item) => item.id === monthId);
  const [name, year] = String(month?.label || "").split(" ");
  return name && year ? `${name.toLowerCase()} de ${year}` : monthId;
}

function pastDueWarning(cardName, monthId) {
  const card = (state.data?.cards || []).find((item) => sameCardName(item.name, cardName));
  if (!card?.dueDay || !monthId) return null;
  const due = invoiceDueDate(monthId, card.dueDay);
  if (!due || !dueDatePassed(monthId, card.dueDay, localToday())) return null;
  return {
    key: `${card.name}|${monthId}|${due}`,
    body: `O ${card.name} vence dia ${card.dueDay}. A fatura de ${monthPhrase(monthId)} venceu em ${formatDueDate(due)}. Quer registrar mesmo assim?`,
  };
}

function acceptPastDue(warning) {
  if (!warning) return true;
  if (state.sheet?.acceptedDueKey === warning.key) return true;
  state.pastDue = warning;
  state.confirm = "past-due";
  return false;
}

function cardJump(name, amount, expenses, onclick) {
  const count = expenses.filter((expense) => shownExpense(expense) && !linkedLivingCost(expense)).length;
  return el("button", { class: "jump", type: "button", onclick }, [
    el("div", { class: "row-between" }, [el("span", {}, name), el("strong", {}, money(amount))]),
    el("small", {}, count === 0 ? "Nenhum gasto neste mês" : `${count} ${count === 1 ? "gasto" : "gastos"}`),
  ]);
}

function openCard(cardId) {
  state.cardFocus = cardId;
  state.showEmpty = false;
  state.error = "";
  render();
}

function shownExpense(expense) {
  return state.showEmpty || expense.amountCents !== 0 || expense.source === "user";
}

function fixedOnCard(expense) {
  return expense.section === "fixed" && expense.onCard;
}

function cardMirror(expense, section) {
  if (fixedOnCard(expense) && (section === "fixed" || section === "card")) return true;
  return section === "extra" && expense.section === "extra" && expense.payment === "card";
}

function expenseBelongsToCard(expense) {
  return expense.section === "card" || (expense.section === "extra" && expense.payment === "card") || fixedOnCard(expense);
}

function cardKey(value) {
  const trimmed = String(value || "").trim().slice(0, 40);
  return trimmed ? trimmed.toLocaleLowerCase("pt-BR") : "";
}

function expensesForCardName(expenses, cardName) {
  const key = cardKey(cardName);
  if (!key) return [];
  return expenses.filter((expense) => expenseBelongsToCard(expense) && cardKey(expense.cardLabel) === key);
}

function openCardBalance(expenses) {
  return expenses
    .filter((expense) => !fixedOnCard(expense) && !expense.paid && expense.amountCents > 0)
    .reduce((sum, expense) => sum + expense.amountCents, 0);
}

function undoCardPayment(card) {
  state.error = "";
  setWorking(true, "Desfazendo...");
  request(`/api/cards/${card.id}/payoff`, {
    method: "POST",
    body: { mode: "undo", monthId: state.monthId },
  }).then((data) => {
    state.data = data;
    rememberMonth(data);
    state.notice = `Pagamento de ${card.name} desfeito.`;
  }).catch((error) => {
    state.error = messageOf(error);
  }).finally(() => {
    setWorking(false);
    renderSafely();
  });
}

function payCardPix(card) {
  state.error = "";
  setWorking(true, "Quitando...");
  request(`/api/cards/${card.id}/payoff`, {
    method: "POST",
    body: { mode: "pix", monthId: state.monthId },
  }).then((data) => {
    state.data = data;
    rememberMonth(data);
    state.notice = `Fatura de ${card.name} paga no Pix.`;
  }).catch((error) => {
    state.error = messageOf(error);
  }).finally(() => {
    setWorking(false);
    renderSafely();
  });
}

function openCardPayoff(card, balance) {
  const months = state.data?.months || [];
  const index = months.findIndex((month) => month.id === state.monthId);
  state.sheet = {
    mode: "card-payoff",
    cardId: card.id,
    cardName: card.name,
    balance,
    down: "",
    count: "2",
    per: "",
    startMonthId: months[index + 1]?.id || state.monthId,
  };
  state.error = "";
  render();
}

function cardPayoffPreview(draft) {
  const down = parseMoney(draft.down || "") ?? 0;
  const count = Number(draft.count);
  const per = parseMoney(draft.per || "");
  if (down < 0 || down >= draft.balance) return "A entrada fica em branco quando não houver, e precisa ser menor que a fatura.";
  const financed = draft.balance - down;
  if (!Number.isInteger(count) || count < 2 || per === null || per <= 0) {
    return `Falta parcelar ${money(financed)}.`;
  }
  const base = Math.floor(financed / count);
  const remainder = financed - base * count;
  if (per * count === financed) return `${count} parcelas de ${money(per)} fecham os ${money(financed)}.`;
  if (per === base && remainder > 0 && remainder < count) {
    return `${count - 1} parcelas de ${money(per)} e a última de ${money(per + remainder)}.`;
  }
  return `As parcelas não fecham com ${money(financed)}.`;
}

function cardInvoiceCents(expenses, cardName) {
  return expensesForCardName(expenses, cardName)
    .filter((expense) => !fixedOnCard(expense))
    .reduce((sum, expense) => sum + expense.amountCents, 0);
}

function unassignedCardExpenses(expenses, cards) {
  const keys = new Set(cards.map((card) => cardKey(card.name)).filter(Boolean));
  return expenses.filter((expense) => {
    if (!expenseBelongsToCard(expense)) return false;
    const key = cardKey(expense.cardLabel);
    return !key || !keys.has(key);
  });
}

function firstCardName() {
  return state.data?.cards?.[0]?.name || "";
}

function sectionList(data, section) {
  const totals = data.totals;
  const all = data.expenses.filter((expense) => belongs(expense, section));
  const visible = all.filter((expense) => state.showEmpty || expense.amountCents !== 0 || expense.source === "user");
  const hidden = all.length - visible.length;
  const total = section === "card"
    ? totals.faturaCents
    : section === "fixed"
      ? (totals.fixedAllSettled ? totals.fixedLaunchedCents : totals.fixedForecastCents)
      : totals.extrasCardCents + totals.extrasPixCents;
  const children = [
    el("div", { class: "section-head" }, [
      el("p", { class: "eyebrow" }, section === "fixed" ? "Custo de vida" : data.month.label),
      section === "fixed" ? el("p", { class: "muted" }, data.month.label) : "",
      section === "fixed" ? "" : el("h2", {}, money(total)),
      section === "fixed" ? costSplit(totals) : el("p", { class: "muted" }, blurb(section, totals)),
    ]),
  ];
  if (section === "fixed") {
    children.push(el("p", { class: "note" }, "O valor cadastrado é previsto. Pague no Pix, envie pro cartão ou lance um parcial para ele entrar na conta. O valor pode ser diferente do cadastrado."));
  }
  if (section === "extra") {
    children.push(el("p", { class: "note" }, "Imprevisto é o que fugiu do plano. Planejado é o gasto que você já contava. Os dois podem sair no Pix ou no crédito."));
  }
  if (editable() && section === "extra") {
    children.push(el("div", { class: "stack-actions" }, [
      el("button", { class: "primary", type: "button", onclick: () => openCreate("extra", "pix", "imprevisto") }, "Adicionar imprevisto"),
      el("button", { class: "secondary", type: "button", onclick: () => openCreate("extra", "pix", "planejado") }, "Adicionar planejado"),
    ]));
  } else if (editable()) {
    children.push(el("button", {
      class: "primary add-top",
      type: "button",
      onclick: () => openCreate(section, "pix"),
    }, "Adicionar custo"));
  }
  children.push(el("div", { class: "list" }, visible.map((expense) => expenseRow(expense, section))));
  if (!visible.length) {
    children.push(el("p", { class: "muted" }, section === "extra" ? "Nenhum imprevisto ou planejado neste mês." : section === "fixed" ? "Nenhum custo de vida neste mês." : "Nada com valor neste mês."));
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

function incomeView(data) {
  const base = data.baseIncomeCents === null ? "" : centsToInput(data.baseIncomeCents);
  const extras = data.incomeExtras || [];
  return el("section", {}, [
    el("div", { class: "section-head" }, [
      el("p", { class: "eyebrow" }, "Receita mensal"),
      el("h2", {}, money(data.month.incomeCents)),
      el("p", { class: "muted" }, `${data.month.label}: ${money(data.month.baseIncomeCents)} de base${data.month.extraIncomeCents ? ` + ${money(data.month.extraIncomeCents)} extras` : ""}.`),
    ]),
    editable() ? el("div", { class: "panel" }, [
      el("label", { for: "base-income" }, "Receita base"),
      el("input", {
        id: "base-income",
        inputmode: "decimal",
        value: base,
        placeholder: "8000,00",
        oninput: (event) => { state.baseIncome = event.target.value; },
      }),
      el("p", { class: "muted" }, "A base entra nos meses que ainda não foram editados à parte. Você pode aplicar em todos se quiser substituir o valor da planilha."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: () => saveBase("unlocked") }, "Replicar nos meses livres"),
        el("button", { class: "primary", type: "button", onclick: () => saveBase("all") }, "Replicar em todos os meses"),
      ]),
    ]) : "",
    el("h2", { class: "subhead" }, "Mês a mês"),
    el("div", { class: "list" }, data.months.map((month) => el("article", { class: "item" }, [
      editable()
        ? el("button", { type: "button", class: "item-main", onclick: () => editMonthIncome(month) }, [
          el("strong", {}, month.label),
          el("small", {}, month.incomeLocked ? "Editado à parte" : "Segue a base"),
        ])
        : el("div", { class: "item-copy" }, [
          el("strong", {}, month.label),
          el("small", {}, month.incomeLocked ? "Editado à parte" : "Segue a base"),
        ]),
      el("span", { class: "amount" }, money(monthIncomeTotal(data, month))),
    ]))),
    el("h2", { class: "subhead" }, "Extras do ano"),
    el("p", { class: "note" }, "Marque um ou mais meses. O mesmo valor entra em cada um e soma na receita daquele mês."),
    editable() ? el("button", { class: "primary add-top", type: "button", onclick: () => openIncomeExtra() }, "Adicionar receita extra") : "",
    el("div", { class: "list" }, extras.map((extra) => el("article", { class: "item" }, [
      el("div", { class: "item-copy" }, [
        editable()
          ? el("button", { type: "button", class: "item-main", onclick: () => openEditIncomeExtra(extra) }, [
            el("strong", {}, extra.name),
            el("small", {}, monthName(extra.monthId)),
          ])
          : el("div", { class: "item-main" }, [el("strong", {}, extra.name), el("small", {}, monthName(extra.monthId))]),
        editable()
          ? el("div", { class: "item-actions" }, [
            el("button", { class: "linkish", type: "button", onclick: () => openEditIncomeExtra(extra) }, "Editar"),
            el("button", { class: "linkish danger", type: "button", onclick: () => removeIncomeExtra(extra) }, "Excluir"),
          ])
          : "",
      ]),
      el("span", { class: "amount" }, money(extra.amountCents)),
    ]))),
  ]);
}

function monthIncomeTotal(data, month) {
  const extras = (data.incomeExtras || []).filter((extra) => extra.monthId === month.id).reduce((sum, extra) => sum + extra.amountCents, 0);
  return month.incomeCents + extras;
}

function monthName(monthId) {
  const month = state.data.months.find((item) => item.id === monthId);
  return month ? month.label : monthId;
}

function amountLabel(draft) {
  if (draft.mode === "create" && draft.section !== "fixed" && (draft.section === "card" || draft.payment === "card")) {
    return draft.amountMode === "total" ? "Valor total da compra" : "Valor da parcela";
  }
  return "Valor";
}

function cardPurchaseFields(draft) {
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

function cardPayPreview(draft) {
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

function faturaWhen(monthId, from = false) {
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

function invoiceMonthField(draft, labelText = "Este valor será pago na fatura de:") {
  const months = state.data?.months || [];
  const select = el("select", { id: "invoiceMonthId", name: "invoiceMonthId" });
  if (draft.invoiceMonthId && !months.some((month) => month.id === draft.invoiceMonthId)) {
    select.append(el("option", { value: draft.invoiceMonthId }, draft.invoiceMonthId));
  }
  for (const month of months) select.append(el("option", { value: month.id }, month.label));
  select.value = draft.invoiceMonthId || "";
  select.addEventListener("change", () => {
    state.sheet.invoiceMonthId = select.value;
    refreshCardPayPreview();
  });
  return el("div", { class: "field" }, [
    el("label", { for: "invoiceMonthId" }, labelText),
    select,
  ]);
}

async function undoCardPay(id) {
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

function installmentPreview(draft) {
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

function installmentDraft(installment) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(installment || "").trim());
  if (!match) return { installmentCount: "1", installmentsPaid: "0" };
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || current < 1 || current > total) return { installmentCount: "1", installmentsPaid: "0" };
  return { installmentCount: String(total), installmentsPaid: String(current - 1) };
}

function monthSelect(selected) {
  const select = el("select", { id: "extra-month" }, state.data.months.map((month) => {
    const option = el("option", { value: month.id }, month.label);
    if (month.id === selected) option.selected = true;
    return option;
  }));
  select.addEventListener("change", () => {
    state.sheet.monthId = select.value;
  });
  return el("div", { class: "field" }, [el("label", { for: "extra-month" }, "Mês"), select]);
}

function monthChecks() {
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

function shortMonth(month) {
  const [year, monthNumber] = month.id.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${names[Number(monthNumber) - 1]} ${year.slice(2)}`;
}

function extrasForMonth(monthId) {
  return (state.data?.incomeExtras || [])
    .filter((extra) => extra.monthId === monthId)
    .map((extra) => ({ id: extra.id, name: extra.name, amount: centsToInput(extra.amountCents) }));
}

function extraAmountField(extra, index) {
  const input = el("input", {
    id: `extra-${extra.id}`,
    inputmode: "decimal",
    value: extra.amount,
  });
  input.addEventListener("input", () => {
    state.sheet.extras[index].amount = input.value;
  });
  return el("div", { class: "field" }, [el("label", { for: `extra-${extra.id}` }, extra.name), input]);
}

async function saveBase(scope) {
  const input = document.querySelector("#base-income");
  const amountCents = parseMoney(input ? input.value : "");
  if (amountCents === null) {
    state.error = "Informe a receita base. Exemplo: 8000,00";
    render();
    return;
  }
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    state.data = await request("/api/income/base", { method: "POST", body: { amountCents, scope, monthId: state.monthId } });
    state.baseIncome = "";
    state.notice = scope === "all"
      ? "Receita base aplicada em todos os meses."
      : "Receita base aplicada nos meses que ainda seguem a base.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

async function useBaseIncome(monthId) {
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    await request(`/api/months/${monthId}/use-base-income`, { method: "POST", body: {} });
    await loadMonth(state.monthId);
    state.sheet = null;
    state.notice = "Este mês voltou a usar a receita base.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

async function removeIncomeExtra(extra) {
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    state.data = await request(`/api/income/extras/${extra.id}`, { method: "DELETE" });
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

function belongs(expense, section) {
  if (section === "card") return expense.section === "card" || (expense.section === "extra" && expense.payment === "card") || (expense.section === "fixed" && expense.onCard);
  if (section === "extra") return expense.section === "extra";
  return expense.section === "fixed";
}

function livingCardPlace(totals) {
  return `${money(totals.fixedCashCents)} fora do cartão · ${money(totals.fixedOnCardCents)} no cartão`;
}

function livingJump(totals) {
  const openLiving = () => {
    state.view = "casa";
    render();
  };
  const place = el("small", { class: "jump-place" }, livingCardPlace(totals));
  if (totals.fixedAllSettled) {
    return el("button", { class: "jump", type: "button", onclick: openLiving }, [
      el("div", { class: "row-between" }, [
        el("span", {}, "Custo de vida"),
        el("strong", {}, money(totals.fixedLaunchedCents)),
      ]),
      el("small", {}, "Valor consolidado"),
      place,
    ]);
  }
  return el("button", { class: "jump", type: "button", onclick: openLiving }, [
    el("div", { class: "jump-pair" }, [
      el("span", {}, "Custo de vida"),
      el("strong", {}, money(totals.fixedLaunchedCents)),
      el("small", {}, `Previsto ${money(totals.fixedForecastCents)}`),
      el("small", { class: "jump-caption" }, "Parcial"),
    ]),
    place,
  ]);
}

function blurb(section, totals) {
  if (section === "card" && totals.fixedOnCardCents) {
    return `${money(totals.fixedOnCardCents)} de custo de vida já foram lançados no cartão e não somam de novo.`;
  }
  if (section === "card") return "Linhas previstas da planilha mais os gastos lançados no cartão.";
  if (section === "fixed" && totals.fixedAllSettled) return "Todas as despesas deste mês foram quitadas.";
  if (section === "fixed") return "O previsto só entra na fatura ou sai da receita quando você lançar o pagamento.";
  return "Imprevistos deste mês, fora da projeção.";
}

function costCard(label, cents, wide = false) {
  return el("div", { class: wide ? "wide" : "" }, [
    el("small", {}, label),
    el("strong", {}, money(cents)),
  ]);
}

function costSplit(totals) {
  return el("div", { class: "cost-split" }, [
    costCard("Previsão geral Pix/cartão", totals.fixedForecastCents, true),
    costCard("Já pago no cartão", totals.fixedOnCardCents),
    costCard("Já pago no Pix", totals.fixedPixPaidCents),
    costCard("Previsto pagar no Pix", totals.fixedPixForecastCents, true),
  ]);
}

function isPlannedNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:planejado");
}

function systemCardLine(expense) {
  const note = String(expense.note || "");
  return note.includes("parcelamento:") || note.includes("quitado-cartao:");
}

function cardTrack(expense) {
  if (systemCardLine(expense)) return "";
  if (expense.section === "extra") return isPlannedNote(expense.note) ? "planejado" : "imprevisto";
  if (expense.section === "fixed" || originIdFrom(expense.note)) return "casa";
  return "";
}

function cardSourceLabel(expense) {
  if (expense.section === "extra") return isPlannedNote(expense.note) ? "Planejado" : "Imprevisto";
  if (expense.section === "fixed" && expense.onCard) return "Custo de vida";
  if (expense.section === "card" && originIdFrom(expense.note)) return "Custo de vida";
  return "";
}

function expenseRow(expense, section, options = {}) {
  const onInvoice = expense.section === "fixed" && expense.onCard;
  const lockedCard = Boolean(options.cardExpense) && expense.section !== "fixed";
  const meta = [];
  if (expense.section === "extra" && section === "card" && !options.manage) meta.push("Imprevisto");
  if (onInvoice && section === "card") meta.push("Custo de vida, já incluído");
  if (expense.payment !== "card" || onInvoice) meta.push(paymentLabel(expense.payment));
  if (expense.payment === "card" && !onInvoice && !options.manage) meta.push(expense.cardLabel ? `Crédito ${expense.cardLabel}` : "Crédito");
  if (section === "fixed" && isVariableNote(expense.note)) meta.push("Variável");
  if (section === "fixed" && isVariableNote(expense.note) && expense.payment === "card") {
    const buckets = invoiceBuckets(expense);
    meta.push(`Fatura de ${monthName(expense.monthId)} ${money(buckets.current)}`);
    meta.push(`Fatura de ${monthName(buckets.nextMonthId)} ${money(buckets.following)}`);
  }
  if (expense.installment) meta.push(expense.installment);
  const partials = expense.partials || [];
  if (section === "fixed" && !onInvoice && partials.length) meta.push(partialSummary(expense));
  const edit = () => {
    if (editable()) openEdit(expense, { cardExpense: lockedCard, fromCard: section === "card" && !systemCardLine(expense) });
  };
  const mirror = cardMirror(expense, section);
  const forecast = section === "fixed" && !onInvoice && !expense.paid && !partials.length;
  const partialOnCard = section === "fixed" && !onInvoice && !expense.paid && cardPartialCents(expense) > 0;
  const fullOnCard = section === "fixed" && onInvoice;
  const tone = fullOnCard ? " on-card-full" : mirror && !(onInvoice && section === "card") ? " on-card" : onInvoice && section === "card" ? " aside" : expense.paid ? " paid" : " open";
  const badges = mirror
    ? [el("span", { class: "badge on-card" }, "Tá no cartão")]
    : expense.paid
      ? [el("span", { class: "badge paid" }, "Pago")]
      : partialOnCard
        ? [el("span", { class: "badge open" }, "Em aberto"), el("span", { class: "badge on-card" }, "Parcial no cartão")]
        : forecast
          ? [el("span", { class: "badge forecast" }, "Previsto")]
          : [el("span", { class: "badge open" }, "Em aberto")];
  if (section === "card" || section === "extra") {
    const source = cardSourceLabel(expense);
    const sourceClass = source === "Planejado" ? "badge source-planned" : source === "Imprevisto" ? "badge source-extra" : "badge source-fixed";
    if (source) badges.unshift(el("span", { class: sourceClass }, source));
  }
  const front = el("article", { class: `item${tone}` }, [
    el("div", { class: "item-copy" }, [
      el("button", { type: "button", class: "item-main", onclick: () => openExpenseInfo(expense, section) }, [
        el("strong", {}, expense.name),
        el("small", {}, meta.filter(Boolean).join(" · ")),
      ]),
      onInvoice && section === "card" ? el("span", { class: "badge" }, "Já contabilizado, não soma de novo") : "",
      expense.section === "extra" && expense.payment !== "card" ? el("span", { class: "badge pix" }, paymentLabel(expense.payment)) : "",
    ]),
    el("div", { class: "item-end" }, [
      el("div", { class: "badges" }, badges),
      el("span", { class: `amount${onInvoice && section === "card" ? " aside" : ""}` }, expense.amountCents === 0 ? "—" : money(expense.amountCents)),
    ]),
  ]);
  if (!editable()) return front;
  const onCardHere = section === "fixed" && expense.onCard;
  const living = section === "fixed" && !expense.onCard;
  const cardFirst = expense.payment === "card" && !expense.onCard;
  const leads = onCardHere
    ? [{ label: "Desfazer", tone: "undo", commit: true, run: () => openUndoCard(expense) }]
    : living
    ? [
      expense.paid
        ? { label: "Desfazer", tone: "undo", commit: true, run: () => openUndoPayments(expense) }
        : cardFirst
          ? { label: "Pago\nno crédito", tone: "send", run: () => openCardPay(expense) }
          : {
            label: "Pago\nno Pix",
            tone: "pay",
            run: () => openCloseLiving(expense),
          },
      expense.paid ? null : cardFirst
        ? { label: "Pago\nno Pix", tone: "pay", run: () => openCloseLiving(expense) }
        : { label: "Enviar pro\ncartão", tone: "send", run: () => openCardPay(expense) },
      !expense.paid && partials.length
        ? { label: "Desfazer", tone: "undo", commit: true, run: () => openUndoPayments(expense) }
        : null,
    ].filter(Boolean)
    : null;
  return swipeRow(front, {
    leads,
    pay: living || onInvoice ? null : {
      label: expense.paid ? "Desfazer" : "Pago",
      undo: expense.paid,
      run: () => patchExpense(expense, { paid: !expense.paid }),
    },
    actions: [
      { label: "Editar", tone: "edit", run: edit },
      { label: "Excluir", tone: "delete", run: () => openDeleteExpense(expense) },
    ],
  });
}

function recurringMonthIds(draft) {
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
  select.addEventListener("change", () => {
    draft[key] = select.value;
  });
  return el("div", { class: "field" }, [el("label", { for: key }, label), select]);
}

function livingPay(draft) {
  const payment = draft.payment === "card" ? "card" : "pix";
  const editing = draft.mode === "edit";
  return el("div", {}, [
    el("div", { class: "field" }, [
      el("label", {}, editing ? "Como fica o pagamento" : "Como pretende pagar"),
      segmented("payment", [["pix", "Pix"], ["card", "Crédito"]], payment),
    ]),
    payment === "card" ? cardSelect(draft) : "",
    !editing && payment === "card"
      ? el("div", { class: "field" }, [
        el("label", {}, "Tipo do custo"),
        segmented("costKind", [["fixo", "Fixo"], ["variavel", "Variável"]], draft.costKind === "variavel" ? "variavel" : "fixo"),
      ])
      : "",
    !editing && payment === "card" && draft.costKind === "variavel"
      ? el("div", { class: "field" }, [
        el("label", {}, "Os gastos entram na fatura"),
        segmented("invoiceTiming", [["mes", "Deste mês"], ["seguinte", "Do mês seguinte"]], draft.invoiceTiming === "seguinte" ? "seguinte" : "mes"),
      ])
      : "",
    el("p", { class: "muted" }, editing
      ? (payment === "card"
        ? "Pix tira este mês da fatura. Crédito lança o valor cadastrado neste mês."
        : "Trocar para crédito lança o valor cadastrado na fatura deste mês.")
      : payment === "card" && draft.costKind === "variavel"
        ? "O valor fica previsto e não entra na fatura agora. Cada gasto lançado depois pode ir para a fatura deste mês ou para a do mês seguinte, como acontece depois do fechamento do cartão."
        : payment === "card"
        ? "O valor entra na fatura dos meses escolhidos abaixo."
        : "O valor fica previsto. Ele só entra na fatura ou sai da receita quando você lançar Pago no Pix, Enviar pro cartão ou Pagamento parcial. Na hora, o valor pode ser outro."),
  ]);
}

function recurringSpan(draft) {
  const span = draft.span || "all";
  const fixedCard = draft.payment === "card" && draft.costKind !== "variavel";
  const copy = span === "period"
    ? (fixedCard ? "O valor entra na fatura de cada mês do intervalo." : "A conta entra em cada mês do intervalo, em aberto.")
    : span === "month"
      ? (fixedCard ? "O valor entra na fatura só deste mês." : "A conta entra só neste mês, em aberto.")
      : span === "following"
        ? (fixedCard ? "O valor entra na fatura deste mês e de cada mês seguinte." : "A conta entra neste mês e nos seguintes, em aberto.")
        : (fixedCard ? "O valor entra na fatura de todos os meses do período." : "A conta entra em todos os meses do período, em aberto.");
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

function openCreate(section, payment, kind = "imprevisto") {
  state.sheet = {
    mode: "create",
    cardExpense: false,
    id: "",
    name: "",
    amount: "",
    section,
    payment,
    onCard: false,
    cardLabel: payment === "card" ? firstCardName() : "",
    note: "",
    installment: "",
    installmentCount: "1",
    installmentsPaid: "0",
    amountMode: "installment",
    invoiceMonthId: section === "extra" ? state.monthId : "",
    repeat: "all",
    span: "all",
    spanChosen: false,
    repeatStart: state.monthId,
    repeatEnd: (state.data?.months || []).at(-1)?.id || state.monthId,
    cardLaunch: "month",
    costKind: "fixo",
    invoiceTiming: "mes",
    expenseKind: kind === "planejado" ? "planejado" : "imprevisto",
    paid: false,
    source: "user",
  };
  state.error = "";
  state.notice = "";
  render();
}

function openCardExpense(cardName = "") {
  const cards = state.data?.cards ?? [];
  if (!cards.length) {
    state.error = "Adicione um cartão antes de lançar o gasto.";
    openCreateCard();
    return;
  }
  const selected = cards.some((card) => card.name === cardName) ? cardName : (cards.length === 1 ? cards[0].name : "");
  state.sheet = {
    mode: "create",
    cardExpense: true,
    id: "",
    name: "",
    amount: "",
    section: "card",
    payment: "card",
    onCard: false,
    cardLabel: selected,
    note: "",
    installment: "",
    installmentCount: "1",
    installmentsPaid: "0",
    amountMode: "installment",
    paid: false,
    source: "user",
  };
  state.error = "";
  render();
}

function openCreateCard() {
  state.sheet = { mode: "card", id: "", name: "", dueDay: "", previousName: "" };
  render();
}

function cardPartialCents(expense) {
  return (expense.partials || [])
    .filter((item) => item.payment === "card")
    .reduce((sum, item) => sum + item.amountCents, 0);
}

function partialSummary(expense) {
  const partials = expense.partials || [];
  const paid = partials.reduce((sum, item) => sum + item.amountCents, 0);
  const card = cardPartialCents(expense);
  const left = expense.amountCents - paid;
  if (card > 0) {
    const bits = [`No cartão ${money(card)}`];
    const other = paid - card;
    if (other > 0) bits.push(`Pago ${money(other)}`);
    if (!expense.paid && left > 0) bits.push(`falta ${money(left)}`);
    else if (!expense.paid && left < 0) bits.push(`passou ${money(-left)}`);
    bits.push(`previsto ${money(expense.amountCents)}`);
    return bits.join(" · ");
  }
  if (!expense.paid && left > 0) return `Pago ${money(paid)} · falta ${money(left)}`;
  if (!expense.paid && left < 0) return `Pago ${money(paid)} · passou ${money(-left)}`;
  const count = `${partials.length} ${partials.length === 1 ? "pagamento" : "pagamentos"}`;
  return `Pago ${money(paid)} em ${count}`;
}

function livingChargeIsFull(planned, already, charged) {
  return already <= 0 && planned > 0 && charged >= planned;
}

function editScopeField(draft) {
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

function closeAfterField(draft) {
  const closeAfter = draft.closeAfter === "close" ? "close" : "open";
  return el("div", { class: "field" }, [
    el("label", {}, "Depois deste lançamento"),
    segmented("closeAfter", [["open", "Deixar em aberto"], ["close", "Encerrar despesa"]], closeAfter),
    el("p", { class: "muted" }, closeAfter === "close"
      ? "Encerrar coloca a tarja Pago, risca o nome e deixa o fundo verde."
      : "A conta continua em aberto. Dá para lançar outro pagamento depois, tocando nela."),
  ]);
}

function partialLine(partial) {
  const method = partial.payment === "card"
    ? `Crédito${partial.cardLabel ? ` ${partial.cardLabel}` : ""}`
    : paymentLabel(partial.payment);
  return `${method} · ${money(partial.amountCents)}${partial.installment ? ` · ${partial.installment}` : ""}`;
}

function openExpenseInfo(expense, section) {
  const mirror = cardMirror(expense, section);
  const living = expense.section === "fixed" && !expense.onCard;
  state.expenseInfo = {
    id: expense.id,
    name: expense.name,
    amount: expense.amountCents === 0 ? "—" : money(expense.amountCents),
    amountCents: expense.amountCents,
    monthId: expense.monthId,
    mirror,
    living,
    paid: expense.paid,
    cardName: expense.cardLabel || "",
    registered: expense.createdAt ? passkeyWhen(expense.createdAt) : "",
    note: visibleNote(expense.note),
    payment: mirror ? "" : paymentLabel(expense.payment),
    paymentKind: expense.payment,
    status: mirror ? "" : (expense.paid ? "Pago" : "Em aberto"),
    installment: expense.installment || "",
    partials: expense.partials || [],
    variable: isVariableNote(expense.note),
    canEdit: editable(),
  };
  state.error = "";
  render();
}

function closeExpenseInfo() {
  state.expenseInfo = null;
  render();
}

function paidPartialCents(expense) {
  return (expense.partials || []).reduce((sum, item) => sum + item.amountCents, 0);
}

function openCloseLiving(expense) {
  const already = paidPartialCents(expense);
  const rest = Math.max(0, expense.amountCents - already);
  state.expenseInfo = null;
  state.sheet = {
    mode: "close-living",
    id: expense.id,
    name: expense.name,
    planned: expense.amountCents,
    described: rest,
    already,
    payment: "pix",
    amountChoice: already > 0 ? (rest > 0 ? "rest" : "none") : "registered",
    amount: "",
    partials: expense.partials || [],
  };
  state.error = "";
  render();
}

function openPartialPayment(info) {
  state.expenseInfo = null;
  const already = (info.partials || []).reduce((sum, item) => sum + item.amountCents, 0);
  state.sheet = {
    mode: "partial",
    id: info.id,
    name: info.name,
    amount: "",
    payment: "pix",
    cardLabel: firstCardName(),
    billing: "once",
    installmentCount: "2",
    invoiceMonthId: info.monthId || state.monthId,
    variable: Boolean(info.variable),
    planned: info.amountCents || 0,
    already,
    closeAfter: "open",
  };
  state.error = "";
  render();
}

function undoPaymentsDraft(expense) {
  const partials = [...(expense.partials || [])].sort((left, right) => {
    const byTime = String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
    if (byTime) return byTime;
    return String(right.id || "").localeCompare(String(left.id || ""));
  });
  return {
    mode: "undo-payments",
    id: expense.id,
    name: expense.name,
    paid: Boolean(expense.paid),
    payment: "pix",
    amountCents: expense.amountCents,
    partials,
  };
}

function openUndoPayments(expense) {
  if (!expense) return;
  state.expenseInfo = null;
  state.sheet = undoPaymentsDraft(expense);
  state.error = "";
  render();
}

function paymentEntries(draft) {
  const partials = draft.partials || [];
  if (partials.length) return partials.map((partial) => ({ ...partial, synthetic: false }));
  if (!draft.paid) return [];
  return [{
    id: "",
    amountCents: draft.amountCents,
    payment: "pix",
    cardLabel: null,
    installment: null,
    createdAt: "",
    synthetic: true,
  }];
}

function paymentEntryLine(entry) {
  const when = entry.createdAt ? passkeyWhen(entry.createdAt) : "";
  return [partialLine(entry), when].filter(Boolean).join(" · ");
}

async function removePartial(expenseId, partialId) {
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    state.data = await request(`/api/expenses/${expenseId}/partials/${partialId}`, { method: "DELETE" });
    rememberMonth(state.data);
    const expense = (state.data.expenses || []).find((item) => item.id === expenseId);
    const backToUndo = state.sheet?.mode === "undo-payments" && state.sheet.id === expenseId;
    if (backToUndo) {
      state.sheet = expense && ((expense.partials || []).length || expense.paid) ? undoPaymentsDraft(expense) : null;
    } else if (expense) {
      openExpenseInfo(expense, "fixed");
    } else {
      state.expenseInfo = null;
    }
    state.notice = "Lançamento excluído.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function undoPayments(expenseId, scope) {
  state.error = "";
  setWorking(true, scope === "all" ? "Desfazendo todos..." : "Desfazendo...");
  try {
    state.data = await request(`/api/expenses/${expenseId}/payments?scope=${scope}`, { method: "DELETE" });
    rememberMonth(state.data);
    const expense = (state.data.expenses || []).find((item) => item.id === expenseId);
    const name = state.sheet?.name || expense?.name || "despesa";
    if (state.sheet?.mode === "undo-payments" && expense && ((expense.partials || []).length || expense.paid)) {
      state.sheet = undoPaymentsDraft(expense);
    } else if (state.sheet?.mode === "undo-payments") {
      state.sheet = null;
    }
    state.notice = scope === "all"
      ? `Desfiz todos os lançamentos de “${name}”.`
      : `Desfiz o último lançamento de “${name}”.`;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function expenseInfoDialog() {
  const info = state.expenseInfo;
  const lines = [];
  if (info.mirror) {
    const card = info.cardName ? ` no cartão ${info.cardName}` : " no cartão";
    lines.push(`Este valor foi lançado${card}. Ele aparece nesta aba como um demonstrativo, para o seu controle. Não soma duas vezes: a cobrança entra só na fatura do cartão.`);
  } else {
    lines.push([info.payment, info.status, info.installment].filter(Boolean).join(" · "));
  }
  if (info.note) lines.push(info.note);
  const tail = [];
  if (info.partials?.length) {
    lines.push(info.paid
      ? "Pagamentos desta despesa:"
      : "Pagamentos parciais, a despesa continua em aberto:");
  }
  if (info.registered) tail.push(`Cadastrado em ${info.registered}.`);
  if (info.canEdit) {
    tail.push(onDesktop()
      ? "Para editar ou excluir, use os botões ao lado do lançamento."
      : "Para editar ou excluir, arraste o card para a esquerda.");
  }
  const partialItems = (info.partials || []).map((partial) => el("div", { class: "partial-line" }, [
    el("span", {}, partialLine(partial)),
    info.canEdit && info.living
      ? el("button", {
        class: "linkish",
        type: "button",
        onclick: () => removePartial(info.id, partial.id),
      }, "Desfazer")
      : "",
  ]));
  const overlay = el("div", {
    class: "overlay center",
    role: "presentation",
    onclick: (event) => {
      if (event.target === overlay) closeExpenseInfo();
    },
  }, [
    el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "expense-info-title" }, [
      el("h2", { id: "expense-info-title" }, info.name),
      el("p", { class: "money inline" }, info.amount),
      ...lines.filter(Boolean).map((line) => el("p", {}, line)),
      partialItems.length ? el("div", { class: "partial-list" }, partialItems) : "",
      ...tail.map((line) => el("p", {}, line)),
      el("div", { class: "actions" }, [
        info.canEdit && info.living && !info.paid
          ? el("button", { class: "secondary", type: "button", onclick: () => openPartialPayment(info) }, "Pagamento parcial")
          : "",
        info.canEdit && info.living && (info.partials?.length || info.paid)
          ? el("button", {
            class: "secondary",
            type: "button",
            onclick: () => openUndoPayments((state.data?.expenses || []).find((item) => item.id === info.id)),
          }, "Desfazer lançamentos")
          : "",
        el("button", { class: "primary", type: "button", onclick: closeExpenseInfo }, "Fechar"),
      ]),
    ]),
  ]);
  return overlay;
}

function openEdit(expense, options = {}) {
  const parts = installmentDraft(expense.installment);
  state.sheet = {
    mode: "edit",
    cardExpense: Boolean(options.cardExpense),
    id: expense.id,
    name: expense.name,
    amount: centsToInput(expense.amountCents),
    section: expense.section,
    payment: expense.payment,
    onCard: expense.onCard,
    cardLabel: expense.cardLabel || "",
    note: visibleNote(expense.note),
    seriesId: seriesIdFrom(expense.note),
    variable: isVariableNote(expense.note),
    fromCard: Boolean(options.fromCard),
    expenseKind: options.fromCard ? cardTrack(expense) : (isPlannedNote(expense.note) ? "planejado" : "imprevisto"),
    originalKind: options.fromCard ? cardTrack(expense) : "",
    originId: originIdFrom(expense.note),
    partialId: partialIdFrom(expense.note),
    installment: expense.installment || "",
    installmentCount: parts.installmentCount,
    installmentsPaid: parts.installmentsPaid,
    amountMode: "installment",
    paid: expense.paid,
    source: expense.source,
    wasOnCard: Boolean(expense.onCard),
    originalAmount: expense.amountCents,
    originalCard: expense.cardLabel || "",
    originalName: expense.name,
    monthId: expense.monthId,
    editScope: "month",
  };
  state.error = "";
  render();
}

function originIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("origem:"));
  return line ? line.slice("origem:".length) : "";
}

function partialIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("parcial:"));
  return line ? line.slice("parcial:".length) : "";
}

function seriesIdFrom(note) {
  const line = String(note || "").split("\n").find((item) => item.startsWith("serie:"));
  return line ? line.slice("serie:".length) : "";
}

function isVariableNote(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "tipo:variavel");
}

function visibleNote(note) {
  return String(note || "").split("\n").filter((item) => item && !item.startsWith("origem:") && !item.startsWith("parcial:") && !item.startsWith("serie:") && !item.startsWith("tipo:") && !item.startsWith("fatura:")).join("\n");
}

function composeNote(originId, note, partialId, seriesId, variable, planned, nextInvoice) {
  const text = String(note || "").trim();
  const lines = [];
  if (seriesId) lines.push(`serie:${seriesId}`);
  if (variable) lines.push("tipo:variavel");
  if (planned) lines.push("tipo:planejado");
  if (nextInvoice) lines.push("fatura:seguinte");
  if (originId) lines.push(`origem:${originId}`);
  if (partialId) lines.push(`parcial:${partialId}`);
  if (text) lines.push(text);
  return lines.join("\n");
}

function nextMonthId(monthId) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function invoiceShift(note) {
  return String(note || "").split("\n").some((item) => item.trim() === "fatura:seguinte") ? "seguinte" : "mes";
}

function invoiceBuckets(expense) {
  const next = nextMonthId(expense.monthId);
  let current = 0;
  let following = 0;
  for (const charge of expense.charges || []) {
    if (charge.monthId === expense.monthId) current += charge.amountCents;
    else if (charge.monthId === next) following += charge.amountCents;
  }
  return { current, following, nextMonthId: next };
}

function linkedLivingCost(expense) {
  return expense.section === "fixed" && expense.onCard && linkedInvoice(expense);
}

function linkedInvoice(expense) {
  return (state.data?.expenses || []).some((item) => originIdFrom(item.note) === expense.id);
}

function openUndoCard(expense) {
  state.expenseInfo = null;
  state.sheet = {
    mode: "undo-card",
    id: expense.id,
    name: expense.name,
    scope: "month",
  };
  state.error = "";
  render();
}

function openCardPay(expense) {
  const cards = state.data?.cards ?? [];
  if (!cards.length) {
    state.error = "Adicione um cartão antes de lançar o pagamento.";
    openCreateCard();
    return;
  }
  const selected = cards.some((card) => card.name === expense.cardLabel) ? expense.cardLabel : (cards.length === 1 ? cards[0].name : "");
  const already = paidPartialCents(expense);
  const rest = Math.max(0, expense.amountCents - already);
  state.sheet = {
    mode: "card-pay",
    id: expense.id,
    described: already > 0 ? rest : expense.amountCents,
    planned: expense.amountCents,
    already,
    closeAfter: "open",
    alias: expense.name,
    cardLabel: selected,
    amountChoice: already > 0 ? (rest > 0 ? "same" : "none") : "same",
    chargedAmount: "",
    billing: "once",
    installmentCount: "2",
    installmentAmount: "",
    amountEdits: [],
    invoiceMonthId: expense.monthId || state.monthId,
    costMonthId: expense.monthId || state.monthId,
    invoiceTiming: invoiceShift(expense.note),
    cardScope: "month",
    variable: isVariableNote(expense.note),
    linked: linkedInvoice(expense) || expense.onCard,
  };
  state.error = "";
  render();
}

function editMonthIncome(month) {
  state.sheet = {
    mode: "month-income",
    monthId: month.id,
    label: month.label,
    amount: centsToInput(month.incomeCents),
    extras: extrasForMonth(month.id),
  };
  render();
}

function openIncomeExtra(monthIds = [state.monthId]) {
  state.sheet = {
    mode: "income-extra",
    id: "",
    kind: "ir",
    name: "",
    amount: "",
    monthId: state.monthId,
    monthIds,
  };
  render();
}

function openEditIncomeExtra(extra) {
  state.sheet = {
    mode: "income-extra",
    id: extra.id,
    kind: extra.kind,
    name: extra.kind === "other" ? extra.name : "",
    amount: centsToInput(extra.amountCents),
    monthId: extra.monthId,
    monthIds: [extra.monthId],
  };
  state.error = "";
  render();
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

function attachSheetDrag(panel) {
  const grab = panel.querySelector(".sheet-grab");
  if (!grab) return;
  let startY = 0;
  let lastY = 0;
  let dragging = false;
  grab.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    startY = event.clientY;
    lastY = startY;
    dragging = true;
    panel.classList.add("dragging");
    try { grab.setPointerCapture(event.pointerId); } catch { /* o arraste segue sem captura */ }
  });
  grab.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    lastY = event.clientY;
    const dy = Math.max(0, event.clientY - startY);
    panel.style.transform = dy ? `translateY(${dy}px)` : "";
  });
  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("dragging");
    try { grab.releasePointerCapture(event.pointerId); } catch { /* a captura já terminou */ }
    const dy = lastY - startY;
    if (dy > 110) closeSheet();
    else panel.style.transform = "";
  };
  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
}

function sheet() {
  const draft = state.sheet;
  const panel = el("form", { class: "sheet" }, [
    el("div", { class: "sheet-grab" }, [el("div", { class: "handle" })]),
  ]);
  panel.addEventListener("submit", saveSheet);
  attachSheetDrag(panel);
  if (state.error) panel.append(el("p", { class: "error" }, state.error));
  if (state.notice) panel.append(el("p", { class: "note" }, state.notice));
  if (draft.mode === "share") {
    panel.append(
      el("h2", {}, "Compartilhar dados"),
      el("p", { class: "muted" }, "Informe o CPF de quem já tem conta. A pessoa escolhe, no login ou em Acesso, se abre os próprios gastos ou os seus."),
      field("CPF", "cpf", draft.cpf, "text", "000.000.000-00"),
      el("div", { class: "field" }, [
        el("label", {}, "Permissão"),
        segmented("permission", [["view", "Só ver"], ["edit", "Ver e editar"]], draft.permission),
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Fechar"),
        el("button", { class: "primary", type: "submit" }, "Compartilhar"),
      ]),
      el("div", { class: "list" }, (state.shares || []).map((share) => el("article", { class: "item" }, [
        el("div", { class: "item-copy" }, [
          el("strong", {}, share.cpf),
          el("small", {}, `${share.email} · ${share.permission === "edit" ? "Pode editar" : "Só visualizar"}`),
        ]),
        el("div", { class: "item-actions" }, [
          el("button", {
            class: "linkish",
            type: "button",
            onclick: () => setSharePermission(share, share.permission === "edit" ? "view" : "edit"),
          }, share.permission === "edit" ? "Só ver" : "Permitir editar"),
          el("button", { class: "linkish danger", type: "button", onclick: () => removeShare(share) }, "Remover"),
        ]),
      ]))),
    );
  } else if (draft.mode === "month-income") {
    panel.append(
      el("h2", {}, draft.label),
      field("Receita base deste mês", "amount", draft.amount, "decimal"),
      el("p", { class: "muted" }, "Este mês deixa de seguir a receita base. Os extras abaixo continuam somados."),
      el("p", { class: "eyebrow group" }, "Extras deste mês"),
      draft.extras?.length
        ? el("div", {}, draft.extras.map((extra, index) => extraAmountField(extra, index)))
        : el("p", { class: "muted" }, "Nenhum extra neste mês."),
      editable()
        ? el("button", {
          class: "linkish",
          type: "button",
          onclick: () => openIncomeExtra([draft.monthId]),
        }, "Adicionar extra neste mês")
        : "",
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Salvar"),
      ]),
      el("button", { class: "quiet", type: "button", onclick: () => useBaseIncome(draft.monthId) }, "Voltar a usar a base"),
    );
  } else if (draft.mode === "income-extra") {
    panel.append(
      el("h2", {}, draft.id ? "Editar receita extra" : "Receita extra"),
      el("div", { class: "field" }, [
        el("label", {}, "Tipo"),
        segmented("kind", [
          ["ir", "Imposto de renda"],
          ["thirteenth", "Décimo terceiro"],
          ["vacation", "Férias"],
          ["other", "Outro"],
        ], draft.kind),
      ]),
      draft.kind === "other" ? field("Nome", "name", draft.name, "text", "Bônus, PLR...") : "",
      field("Valor", "amount", draft.amount, "decimal"),
      draft.id ? monthSelect(draft.monthId) : monthChecks(),
      draft.id ? "" : el("p", { class: "muted" }, "O mesmo valor entra em cada mês marcado."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, draft.id ? "Salvar" : "Adicionar"),
      ]),
    );
  } else if (draft.mode === "passkey") {
    panel.append(
      el("h2", {}, "Cadastrar digital"),
      el("p", { class: "muted" }, "Usa a digital já cadastrada neste celular para entrar. A senha continua valendo."),
      window.PublicKeyCredential
        ? el("button", { class: "secondary", type: "button", onclick: registerPasskey }, "Cadastrar digital")
        : el("p", { class: "note" }, "Este navegador não oferece entrada com digital."),
      el("div", { class: "list" }, (state.passkeys || []).map((passkey) => el("article", { class: "item" }, [
        el("div", { class: "item-copy" }, [
          el("strong", {}, "Digital"),
          el("small", {}, passkeyWhen(passkey.createdAt)),
        ]),
        el("button", { class: "linkish danger", type: "button", onclick: () => removePasskey(passkey.id) }, "Remover"),
      ]))),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Fechar"),
      ]),
    );
  } else if (draft.mode === "password") {
    panel.append(
      el("h2", {}, "Alterar senha"),
      el("p", { class: "muted" }, "Trocar a senha remove as digitais cadastradas. Dá para cadastrar de novo neste celular."),
      field("Senha atual", "current", "", "password"),
      field("Nova senha", "next", "", "password"),
      field("Confirmar nova senha", "confirmation", "", "password"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Trocar"),
      ]),
    );
  } else if (draft.mode === "period") {
    panel.append(
      el("h2", {}, "Período gerenciado"),
      el("p", { class: "muted" }, "O período escolhido poderá ser alterado depois, aqui no seu perfil."),
      periodFields(draft),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
    );
  } else if (draft.mode === "reset") {
    const months = state.data?.months || [];
    const years = [...new Set(months.map((month) => month.id.slice(0, 4)))];
    panel.append(
      el("h2", {}, "Resetar meus dados"),
      el("p", { class: "muted" }, draft.scope === "all"
        ? "Desde o início apaga gastos, receitas, cartões e o período. Você sai da conta e, ao entrar de novo, refaz o formulário de primeiro login."
        : "Apaga os gastos e as receitas extras do ano ou do mês escolhido. O período e os cartões continuam."),
      el("div", { class: "field" }, [
        el("label", {}, "Apagar"),
        segmented("scope", [["all", "Desde o início"], ["year", "Um ano"], ["month", "Um mês"]], draft.scope),
      ]),
      draft.scope === "year"
        ? periodSelect(draft, "year", "Ano", years, years)
        : "",
      draft.scope === "month"
        ? periodSelect(draft, "monthId", "Mês", months.map((month) => month.id), months.map((month) => month.label))
        : "",
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "button", onclick: askReset }, "Apagar"),
      ]),
    );
  } else if (draft.mode === "delete-expense") {
    const living = draft.section === "fixed";
    const futureCard = draft.section === "extra";
    panel.append(
      el("h2", {}, futureCard ? "Excluir imprevisto do cartão" : "Excluir despesa"),
      el("p", { class: "muted" }, futureCard
        ? `“${draft.name}” está na fatura. Dá para tirar só desta fatura ou também de todas as faturas seguintes.`
        : living
        ? `“${draft.name}” é um custo de vida. Dá para tirar só deste mês ou de todos os meses em que esta conta existe.`
        : `“${draft.name}” está no cartão. Dá para tirar só desta fatura ou de todos os meses em que esta despesa aparece.`),
      el("div", { class: "field" }, [
        el("label", {}, "Excluir de"),
        segmented("scope", futureCard
          ? [["month", "Só este mês"], ["forward", "Este mês e os seguintes"]]
          : [["month", "Só este mês"], ["series", "Todos os meses"]], draft.scope || "month"),
      ]),
      el("p", { class: "muted" }, futureCard
        ? (draft.scope === "forward"
          ? "Some desta fatura e de todas as faturas seguintes. As faturas anteriores continuam."
          : "As outras faturas continuam com este imprevisto.")
        : draft.scope === "series"
        ? (living
          ? "A conta some de todos os meses. O valor que já estava na fatura desses meses também sai."
          : "A despesa some de todos os meses deste cartão.")
        : "Os outros meses continuam como estão."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "danger", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Excluindo..." : "Excluir"),
      ]),
    );
  } else if (draft.mode === "undo-payments") {
    const entries = paymentEntries(draft);
    panel.append(
      el("h2", {}, "Desfazer pagamento"),
      el("p", { class: "muted" }, `Estes são os lançamentos de “${draft.name}”. Dá para tirar só o último, todos, ou um lançamento específico.`),
      entries.length
        ? el("div", { class: "partial-list" }, entries.map((entry, index) => el("div", { class: "partial-line" }, [
          el("span", {}, index === 0 ? `Último · ${paymentEntryLine(entry)}` : paymentEntryLine(entry)),
          el("button", {
            class: "linkish danger",
            type: "button",
            onclick: () => (entry.synthetic || !entry.id ? undoPayments(draft.id, "last") : removePartial(draft.id, entry.id)),
          }, "Excluir"),
        ])))
        : el("p", {}, "Não há lançamento para desfazer."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        entries.length
          ? el("button", { class: "danger", type: "button", disabled: state.busy ? "" : null, onclick: () => undoPayments(draft.id, "all") }, "Desfazer todos")
          : "",
        entries.length
          ? el("button", { class: "primary", type: "button", disabled: state.busy ? "" : null, onclick: () => undoPayments(draft.id, "last") }, state.busy ? "Desfazendo..." : "Desfazer o último")
          : "",
      ]),
    );
  } else if (draft.mode === "undo-card") {
    panel.append(
      el("h2", {}, "Tirar do cartão"),
      el("p", { class: "muted" }, `“${draft.name}” sai da fatura e volta a ficar em aberto.`),
      el("div", { class: "field" }, [
        el("label", {}, "Tirar de"),
        segmented("scope", [["month", "Só este mês"], ["series", "Todos os meses"]], draft.scope || "month"),
      ]),
      el("p", { class: "muted" }, draft.scope === "series"
        ? "Cada mês em que este custo está lançado no cartão volta a ficar em aberto."
        : "Os outros meses em que ele já está no cartão continuam na fatura."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Tirar do cartão"),
      ]),
    );
  } else if (draft.mode === "card-pay") {
    const described = money(draft.described || 0);
    const already = draft.already || 0;
    const choices = already > 0
      ? [
        draft.described > 0 ? ["same", `O restante · ${described}`] : null,
        ["other", "Outro valor"],
        ["none", "Sem acréscimo"],
      ].filter(Boolean)
      : [["same", `O descrito · ${described}`], ["other", "Outro valor"]];
    panel.append(
      el("h2", {}, "Enviar pro cartão"),
      el("p", { class: "muted" }, draft.variable
        ? "Custo variável. Lance o total ou uma parte. Pode lançar de novo depois. A despesa continua aberta até você encerrar, mesmo que passe do previsto."
        : already > 0
        ? `Já pago: ${money(already)}. O sugerido é o restante. A fatura só recebe o valor que você confirmar.`
        : `Na lista este gasto está como ${described}. O valor só entra na fatura quando você confirmar, e pode ser diferente do cadastrado.`),
      field("Apelido na fatura", "alias", draft.alias, "text", "Faculdade, energia..."),
      draft.amountChoice === "none" ? "" : cardSelect(draft),
      el("div", { class: "field" }, [
        el("label", {}, "O valor cobrado é"),
        segmented("amountChoice", choices, draft.amountChoice),
      ]),
      draft.amountChoice !== "none" && (draft.amountChoice === "other" || draft.billing === "installments")
        ? field("Valor cobrado", "chargedAmount", draft.chargedAmount, "decimal")
        : "",
      draft.amountChoice === "none" ? "" : el("div", { class: "field" }, [
        el("label", {}, "Parcelamento"),
        segmented("billing", [["once", "À vista"], ["installments", "Parcelado"]], draft.billing),
      ]),
      draft.amountChoice !== "none" && draft.billing === "installments"
        ? el("div", { class: "pair" }, [
          field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "2", "numeric"),
          field("Valor da parcela", "installmentAmount", draft.installmentAmount || "", "decimal"),
        ])
        : "",
      draft.amountChoice === "none" ? "" : draft.variable
        ? el("div", { class: "field" }, [
          el("label", {}, "Em qual fatura"),
          segmented("invoiceTiming", [["mes", "Deste mês"], ["seguinte", "Do mês seguinte"]], draft.invoiceTiming === "seguinte" ? "seguinte" : "mes"),
          el("p", { class: "muted" }, draft.invoiceTiming === "seguinte"
            ? `Este gasto entra na fatura de ${monthName(nextMonthId(draft.costMonthId))}.`
            : `Este gasto entra na fatura de ${monthName(draft.costMonthId)}.`),
        ])
        : invoiceMonthField(draft),
      draft.amountChoice === "none" ? "" : el("p", { class: "muted", id: "installment-preview" }, cardPayPreview(draft)),
      !draft.variable && draft.amountChoice !== "none" && draft.billing !== "installments" && !(draft.already > 0)
        ? el("div", { class: "field" }, [
          el("label", {}, "Em quais meses"),
          segmented("cardScope", [["month", "Só este mês"], ["following", "Este mês e os seguintes"]], draft.cardScope || "month"),
        ])
        : "",
      !draft.variable && draft.amountChoice !== "none" && draft.billing !== "installments" && !(draft.already > 0)
        ? el("p", { class: "muted" }, draft.cardScope === "following"
          ? "Os meses seguintes levam o valor cadastrado de cada um, no mesmo cartão. O que já estiver no cartão ou pago não é mexido."
          : "O valor inteiro do previsto entra na fatura e a conta fica com a tarja Tá no cartão, no fundo verde. Um valor menor continua em aberto, com a tarja Parcial no cartão.")
        : "",
      draft.variable
        ? closeAfterField(draft)
        : draft.amountChoice === "none"
        ? el("p", { class: "muted" }, "Encerra com o que já foi lançado. A tarja fica Pago, o nome riscado e o fundo verde.")
        : draft.amountChoice === "same" && !(draft.already > 0) && draft.billing !== "installments"
          ? ""
          : closeAfterField(draft),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Lançando..." : (draft.amountChoice === "none" ? "Encerrar despesa" : draft.closeAfter === "close" ? "Lançar e encerrar" : "Lançar na fatura")),
      ]),
      draft.linked
        ? el("button", { class: "danger", type: "button", onclick: () => undoCardPay(draft.id) }, "Desfazer pagamento no cartão")
        : "",
    );
  } else if (draft.mode === "card-payoff") {
    const months = state.data?.months || [];
    const select = el("select", { id: "startMonthId" });
    for (const month of months) select.append(el("option", { value: month.id }, month.label));
    select.value = draft.startMonthId || state.monthId;
    select.addEventListener("change", () => { state.sheet.startMonthId = select.value; });
    panel.append(
      el("h2", {}, "Pago parcelado"),
      el("p", { class: "muted" }, `${draft.cardName} está com ${money(draft.balance)} em aberto. A fatura deste mês fica paga e o restante volta nas próximas faturas.`),
      field("Valor da entrada", "down", draft.down, "decimal", "0,00 se não houver"),
      el("div", { class: "pair" }, [
        field("Quantidade de parcelas", "count", draft.count, "numeric"),
        field("Valor da parcela", "per", draft.per, "decimal"),
      ]),
      el("div", { class: "field" }, [
        el("label", { for: "startMonthId" }, "O parcelamento começa em"),
        select,
      ]),
      el("p", { class: "muted", id: "card-payoff-preview" }, cardPayoffPreview(draft)),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Parcelar fatura"),
      ]),
    );
  } else if (draft.mode === "close-living") {
    const method = "no Pix";
    const already = draft.already || 0;
    const choices = already > 0
      ? [
        draft.described > 0 ? ["rest", `O restante · ${money(draft.described)}`] : null,
        ["other", "Outro valor"],
        ["none", "Sem acréscimo"],
      ].filter(Boolean)
      : [["registered", `O cadastrado · ${money(draft.planned)}`], ["other", "Outro valor"]];
    panel.append(
      el("h2", {}, "Encerrar despesa"),
      el("p", {}, `O pagamento ${method} encerra “${draft.name}” neste mês. Só então o valor sai da receita.`),
      el("p", { class: "muted" }, onDesktop()
        ? "Para lançar só uma parte e deixar a despesa aberta, feche esta tela, clique na despesa e escolha Pagamento parcial."
        : "Para lançar só uma parte e deixar a despesa aberta, feche esta tela, toque na despesa e escolha Pagamento parcial."),
      already > 0 ? el("p", {}, `Já pago: ${money(already)}. O sugerido é o que ainda falta do cadastrado.`) : "",
      el("div", { class: "field" }, [
        el("label", {}, already > 0 ? "Quanto entra neste pagamento?" : "O valor pago foi o cadastrado?"),
        segmented("amountChoice", choices, draft.amountChoice),
      ]),
      draft.amountChoice === "other" ? field("Valor pago", "amount", draft.amount, "decimal") : "",
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Encerrar despesa"),
      ]),
    );
  } else if (draft.mode === "partial") {
    panel.append(
      el("h2", {}, "Pagamento parcial"),
      el("p", { class: "muted" }, `“${draft.name}” continua em aberto. Dá para lançar outra ida depois, como na feira do mês.`),
      field("Valor pago agora", "amount", draft.amount, "decimal"),
      el("div", { class: "field" }, [
        el("label", {}, "Como foi pago"),
        segmented("payment", [["pix", "Pix"], ["card", "Crédito"]], draft.payment),
      ]),
      draft.payment === "card" ? cardSelect(draft) : "",
      draft.payment === "card"
        ? el("div", { class: "field" }, [
          el("label", {}, "Parcelamento"),
          segmented("billing", [["once", "À vista"], ["installments", "Parcelado"]], draft.billing),
        ])
        : "",
      draft.payment === "card" && draft.billing === "installments"
        ? field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "2", "numeric")
        : "",
      draft.payment === "card" ? invoiceMonthField(draft, draft.billing === "installments" ? "A primeira fatura em que entra:" : "Este valor entra na fatura de:") : "",
      closeAfterField(draft),
      draft.variable
        ? el("p", { class: "muted" }, "Custo variável. Este lançamento não encerra a despesa, mesmo que passe do previsto. Encerre só se quiser.")
        : "",
      el("p", { class: "muted" }, draft.variable
        ? ""
        : draft.payment === "card"
        ? "Se o valor for o previsto inteiro, a conta fica com a tarja Tá no cartão e o fundo verde. Um valor menor fica em aberto, com Em aberto e Parcial no cartão."
        : "Encerrar só depois do lançamento. A tarja fica Pago, com o nome riscado e o fundo verde."),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : (draft.closeAfter === "close" ? "Lançar e encerrar" : "Lançar parcial")),
      ]),
    );
  } else if (draft.fromCard && draft.mode === "edit") {
    panel.append(
      el("h2", {}, "Editar gasto do cartão"),
      field("Nome", "name", draft.name, "text"),
      field("Valor", "amount", draft.amount, "decimal"),
      el("div", { class: "field" }, [
        el("label", {}, "Tarja"),
        segmented("expenseKind", [
          ["imprevisto", "Imprevisto"],
          ["planejado", "Planejado"],
          ["casa", "Custo de vida"],
        ], draft.expenseKind || ""),
      ]),
      el("p", { class: "muted" }, "A tarja manda este lançamento para a aba correspondente. Ele continua neste cartão, no crédito."),
      cardSelect(draft),
      field("Observação", "note", draft.note, "text"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
      el("button", { class: "danger", type: "button", onclick: () => openDeleteExpense(draft) }, "Excluir gasto"),
    );
  } else if (draft.mode === "card") {
    panel.append(
      el("h2", {}, draft.id ? "Editar cartão" : "Novo cartão"),
      field("Apelido", "name", draft.name, "text", "Nubank, Neon ou outro"),
      field("Dia de vencimento", "dueDay", draft.dueDay || "", "numeric", "10"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
    );
  } else {
    const needsCard = draft.cardExpense || draft.section === "card" || draft.payment === "card" || draft.onCard;
    const cardSpend = (draft.cardExpense && draft.mode === "create") || (draft.mode === "edit" && draft.section === "card");
    const recurring = draft.section === "fixed" && !cardSpend;
    const surprise = draft.section === "extra" && !cardSpend;
    const heading = cardSpend
      ? (draft.mode === "edit" ? "Editar gasto no crédito" : "Gasto no crédito")
      : recurring
        ? (draft.mode === "create" ? "Novo custo de vida" : "Editar custo de vida")
        : surprise
          ? (draft.expenseKind === "planejado"
          ? (draft.mode === "create" ? "Novo planejado" : "Editar planejado")
          : (draft.mode === "create" ? "Novo imprevisto" : "Editar imprevisto"))
          : (draft.mode === "create" ? "Novo gasto" : "Editar gasto");
    panel.append(
      el("h2", {}, heading),
      cardSpend
        ? el("div", { class: "field" }, [
          el("label", {}, "O valor informado é"),
          segmented("amountMode", [["installment", "Da parcela"], ["total", "Da compra toda"]], draft.amountMode || "installment"),
        ])
        : "",
      cardSpend
        ? el("div", { class: "pair" }, [
          field("Nome", "name", draft.name, "text"),
          field(draft.amountMode === "total" ? "Valor da compra" : "Valor da parcela", "amount", draft.amount, "decimal"),
        ])
        : field("Nome", "name", draft.name, "text"),
      surprise
        ? el("div", { class: "field" }, [
          el("label", {}, "Classificação"),
          segmented("expenseKind", [["imprevisto", "Imprevisto"], ["planejado", "Planejado"]], draft.expenseKind === "planejado" ? "planejado" : "imprevisto"),
        ])
        : "",
      surprise
        ? el("div", { class: "field" }, [
          el("label", {}, "Como foi pago"),
          segmented("payment", [["pix", "Pix"], ["card", "Crédito"]], draft.payment),
        ])
        : "",
      recurring ? livingPay(draft) : "",
      cardSpend ? "" : field(amountLabel(draft), "amount", draft.amount, "decimal"),
      recurring && draft.mode === "create" ? recurringSpan(draft) : "",
      cardSpend || recurring || surprise
        ? ""
        : el("div", { class: "field" }, [
          el("label", {}, "Tipo"),
          segmented("section", [
            ["extra", "Imprevisto"],
            ["fixed", "Custo de vida"],
          ], draft.section === "card" ? "extra" : draft.section),
        ]),
      cardSpend
        ? el("div", { class: "pair" }, [
          field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "1", "numeric"),
          field("Parcelas já pagas", "installmentsPaid", draft.installmentsPaid || "0", "numeric"),
        ])
        : "",
      cardSpend ? el("p", { class: "muted", id: "installment-preview" }, installmentPreview(draft)) : cardPurchaseFields(draft),
      draft.mode === "edit" && !cardSpend && draft.section === "extra"
        ? field("Parcela", "installment", draft.installment, "text", "3/10, se houver")
        : "",
      needsCard && !(recurring && draft.payment === "card") ? cardSelect(draft) : "",
      surprise && draft.mode === "create" && draft.payment === "card" ? invoiceMonthField(draft) : "",
      draft.mode === "edit" && (recurring || cardSpend) ? editScopeField(draft) : "",
      field("Observação", "note", draft.note, "text"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
      draft.mode === "edit"
        ? el("button", { class: "danger", type: "button", onclick: () => openDeleteExpense(draft) }, "Excluir gasto")
        : "",
    );
  }
  const overlay = el("div", { class: "overlay", onclick: (event) => {
    if (event.target !== overlay || Date.now() < ignoreSwipeClickUntil) return;
    closeSheet();
  } }, [panel]);
  return overlay;
}

function cardSelect(draft) {
  const cards = state.data?.cards ?? [];
  const required = draft.fromCard || draft.mode === "card-pay" || draft.mode === "partial"
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
  select.addEventListener("change", () => {
    state.sheet.cardLabel = select.value;
    refreshCardPayPreview();
  });
  return el("div", { class: "field" }, [el("label", { for: "cardLabel" }, "Cartão"), select]);
}

function field(labelText, key, value, mode, placeholder = "") {
  const input = el(key === "note" ? "textarea" : "input", {
    id: key,
    name: key,
    type: mode === "password" ? "password" : undefined,
    value,
    placeholder,
    autocomplete: mode === "password" ? "new-password" : undefined,
    inputmode: mode === "decimal" ? "decimal" : mode === "numeric" ? "numeric" : "text",
  });
  input.addEventListener("input", () => {
    state.sheet[key] = input.value;
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

function segmented(key, options, current) {
  return el("div", { class: "choice" }, options.map(([value, label]) => el("button", {
    type: "button",
    class: current === value ? "on" : "",
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
      if (key === "span") state.sheet.spanChosen = true;
      if ((key === "payment" || key === "costKind") && state.sheet.section === "fixed" && state.sheet.mode === "create" && !state.sheet.spanChosen) {
        const payment = key === "payment" ? value : state.sheet.payment;
        const kind = key === "costKind" ? value : state.sheet.costKind;
        state.sheet.span = payment === "card" && kind !== "variavel" ? "month" : "all";
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

async function saveSheet(event) {
  event.preventDefault();
  const draft = state.sheet;
  state.error = "";
  state.notice = "";
  try {
    if (draft.mode === "passkey" || draft.mode === "undo-payments") return;
    if (draft.mode === "close-living") {
      const noAddition = draft.amountChoice === "none";
      const useRegistered = draft.amountChoice === "registered";
      const amountCents = noAddition
        ? 0
        : useRegistered
          ? draft.planned
          : draft.amountChoice === "rest"
            ? draft.described
            : parseMoney(draft.amount || "");
      if (!noAddition && (amountCents === null || amountCents <= 0)) throw new Error("Informe o valor pago. Exemplo: 75,90");
      setWorking(true, "Encerrando...");
      state.data = await request(`/api/expenses/${draft.id}/settle`, {
        method: "POST",
        body: { useRegistered, noAddition, amountCents },
      });
      rememberMonth(state.data);
      state.notice = `“${draft.name}” encerrada neste mês.`;
      state.sheet = null;
      return;
    }
    if (draft.mode === "partial") {
      const amountCents = parseMoney(draft.amount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe o valor pago. Exemplo: 75,90");
      const count = Number(draft.installmentCount);
      if (draft.payment === "card") {
        if (!draft.cardLabel) throw new Error("Escolha o cartão.");
        if (!draft.invoiceMonthId) throw new Error("Escolha o mês da fatura.");
        if (draft.billing === "installments" && (!Number.isInteger(count) || count < 2 || count > 48)) {
          throw new Error("Informe de 2 a 48 parcelas.");
        }
        if (!acceptPastDue(pastDueWarning(draft.cardLabel, draft.invoiceMonthId))) return;
      }
      setWorking(true, draft.closeAfter === "close" ? "Encerrando..." : "Lançando...");
      const cardCount = draft.billing === "installments" ? count : 1;
      const fullCard = !draft.variable && draft.payment === "card" && livingChargeIsFull(draft.planned || 0, draft.already || 0, amountCents);
      if (fullCard) {
        state.data = await request(`/api/expenses/${draft.id}/card-payment`, {
          method: "POST",
          body: {
            cardLabel: draft.cardLabel,
            alias: draft.name,
            amountCents,
            installmentCount: cardCount,
            invoiceMonthId: draft.invoiceMonthId,
            amountMode: "total",
            scope: "month",
          },
        });
        state.notice = `Enviei o valor inteiro de “${draft.name}” para o cartão.`;
      } else {
        state.data = await request(`/api/expenses/${draft.id}/partials`, {
          method: "POST",
          body: {
            amountCents,
            payment: draft.payment,
            cardLabel: draft.payment === "card" ? draft.cardLabel : undefined,
            installmentCount: draft.payment === "card" ? cardCount : 1,
            invoiceMonthId: draft.payment === "card" ? draft.invoiceMonthId : undefined,
          },
        });
        if (draft.closeAfter === "close") {
          state.data = await request(`/api/expenses/${draft.id}/settle`, {
            method: "POST",
            body: { noAddition: true, amountCents: 0, useRegistered: false },
          });
        }
        state.notice = draft.closeAfter === "close"
          ? `Lancei ${money(amountCents)} e encerrei “${draft.name}”.`
          : `Pagamento parcial de ${money(amountCents)} lançado em “${draft.name}”.`;
      }
      rememberMonth(state.data);
      state.sheet = null;
      return;
    }
    if (draft.mode === "delete-expense") {
      const scope = draft.scope === "series" || draft.scope === "forward" ? draft.scope : "month";
      await deleteExpenseNow(draft, scope);
      return;
    }
    if (draft.mode === "undo-card") {
      const scope = draft.scope === "series" ? "series" : "month";
      setWorking(true, "Tirando do cartão...");
      state.data = await request(`/api/expenses/${draft.id}/card-payment?scope=${scope}`, { method: "DELETE" });
      rememberMonth(state.data);
      state.notice = scope === "series"
        ? `Tirei “${draft.name}” do cartão em todos os meses em que estava lançado.`
        : `Tirei “${draft.name}” do cartão neste mês.`;
      state.sheet = null;
      return;
    }
    if (draft.mode === "card-pay") {
      if (draft.amountChoice === "none") {
        setWorking(true, "Encerrando...");
        state.data = await request(`/api/expenses/${draft.id}/settle`, {
          method: "POST",
          body: { noAddition: true, amountCents: 0, useRegistered: false },
        });
        rememberMonth(state.data);
        state.notice = `“${draft.alias || draft.name}” encerrada sem acréscimo.`;
        state.sheet = null;
        return;
      }
      const alias = String(draft.alias || "").trim();
      if (!alias) throw new Error("Escolha o apelido que vai aparecer na fatura.");
      if (!draft.cardLabel) throw new Error("Escolha o cartão.");
      if (draft.variable) {
        const base = draft.costMonthId || state.monthId;
        draft.invoiceMonthId = draft.invoiceTiming === "seguinte" ? nextMonthId(base) : base;
        if (!draft.invoiceMonthId || !(state.data?.months || []).some((month) => month.id === draft.invoiceMonthId)) {
          throw new Error("O mês seguinte está fora do período. Aumente o período para lançar nessa fatura.");
        }
      }
      if (!draft.invoiceMonthId) throw new Error("Escolha o mês da fatura.");
      let amountCents = draft.described;
      let installmentCount = 1;
      let amountMode = "installment";
      if (draft.billing === "installments") {
        const charged = parseMoney(draft.chargedAmount || "");
        installmentCount = Number(draft.installmentCount);
        const per = parseMoney(draft.installmentAmount || "");
        if (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 48) {
          throw new Error("Informe de 2 a 48 parcelas.");
        }
        if (per === null || per <= 0) throw new Error("Informe o valor da parcela.");
        if (charged === null || charged <= 0) throw new Error("Informe o valor cobrado no cartão.");
        const quote = quoteInstallments(charged, installmentCount, per);
        if (!quote || quote.kind === "mismatch") {
          throw new Error("O valor cobrado não fecha com a quantidade e o valor da parcela.");
        }
        if (quote.kind === "remainder") {
          amountCents = charged;
          amountMode = "total";
        } else {
          amountCents = per;
        }
      } else if (draft.amountChoice === "other") {
        amountCents = parseMoney(draft.chargedAmount || "");
        if (amountCents === null || amountCents <= 0) throw new Error("Informe o valor cobrado no cartão.");
      } else if (!amountCents || amountCents <= 0) {
        throw new Error("Este gasto está sem valor. Informe outro valor.");
      }
      if (!acceptPastDue(pastDueWarning(draft.cardLabel, draft.invoiceMonthId))) return;
      const chargedTotal = draft.billing === "installments"
        ? (amountMode === "total" ? amountCents : amountCents * installmentCount)
        : amountCents;
      const fullCard = !draft.variable && livingChargeIsFull(draft.planned || draft.described || 0, draft.already || 0, chargedTotal);
      const close = !fullCard && draft.closeAfter === "close";
      setWorking(true, close ? "Encerrando..." : "Lançando na fatura...");
      state.data = await request(`/api/expenses/${draft.id}/card-payment`, {
        method: "POST",
        body: {
          cardLabel: draft.cardLabel,
          alias,
          amountCents,
          installmentCount,
          invoiceMonthId: draft.invoiceMonthId,
          amountMode,
          scope: !fullCard || installmentCount > 1 ? "month" : (draft.cardScope === "following" ? "following" : "month"),
          close,
        },
      });
      rememberMonth(state.data);
      const several = fullCard && installmentCount === 1 && draft.cardScope === "following";
      state.notice = close
        ? `Lancei ${money(chargedTotal)} no cartão e encerrei “${alias}”.`
        : fullCard
          ? (installmentCount > 1
            ? `Lancei ${installmentCount} parcelas ${faturaWhen(draft.invoiceMonthId, true)}, com o apelido “${alias}”.`
            : several
              ? `Lancei “${alias}” no cartão neste mês e nos seguintes.`
              : `Lancei “${alias}” ${faturaWhen(draft.invoiceMonthId)}.`)
          : `Lancei ${money(chargedTotal)} no cartão. “${alias}” continua em aberto.`;
      state.sheet = null;
      return;
    } else if (draft.mode === "share") {
      setWorking(true, "Salvando...");
      const data = await request("/api/shares", { method: "POST", body: { cpf: draft.cpf, permission: draft.permission } });
      state.shares = data.shares || [];
      draft.cpf = "";
      state.notice = "Compartilhamento salvo.";
      const spaces = await request("/api/spaces");
      state.spaces = spaces.spaces || state.spaces;
      return;
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
    } else if (draft.mode === "income-extra") {
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
    } else if (draft.mode === "period") {
      await savePeriod(draft, false);
      return;
    } else if (draft.mode === "password") {
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
    } else if (draft.mode === "card-payoff") {
      const downCents = parseMoney(draft.down || "") ?? 0;
      const count = Number(draft.count);
      const installmentCents = parseMoney(draft.per || "");
      if (draft.down && downCents === null) throw new Error("Informe a entrada. Exemplo: 200,00. Deixe em branco se não houver.");
      if (!Number.isInteger(count) || count < 2 || count > 48) throw new Error("Informe de 2 a 48 parcelas.");
      if (installmentCents === null || installmentCents <= 0) throw new Error("Informe o valor da parcela.");
      if (!draft.startMonthId) throw new Error("Escolha o mês em que o parcelamento começa.");
      if (!acceptPastDue(pastDueWarning(draft.cardName, draft.startMonthId))) return;
      setWorking(true, "Parcelando...");
      state.data = await request(`/api/cards/${draft.cardId}/payoff`, {
        method: "POST",
        body: {
          mode: "installments",
          monthId: state.monthId,
          downCents: draft.down ? downCents : 0,
          count,
          installmentCents,
          startMonthId: draft.startMonthId,
        },
      });
      rememberMonth(state.data);
      state.notice = `Fatura de ${draft.cardName} parcelada em ${count} vezes.`;
    } else if (draft.mode === "card") {
      if (!draft.name.trim()) throw new Error("Dê um apelido ao cartão.");
      const dueDay = cardDueDay(draft.dueDay);
      setWorking(true, "Salvando...");
      const data = await request(draft.id ? `/api/cards/${draft.id}` : "/api/cards", {
        method: draft.id ? "PATCH" : "POST",
        body: { name: draft.name, dueDay },
      });
      const saved = (data.cards || []).find((card) => card.id === draft.id);
      const nextName = saved?.name || draft.name.trim();
      if (draft.previousName) {
        for (const expense of state.data.expenses || []) {
          if (sameCardName(expense.cardLabel, draft.previousName)) expense.cardLabel = nextName;
        }
      }
      state.data.cards = data.cards;
    } else if (draft.fromCard && draft.mode === "edit") {
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      const amountCents = parseMoney(draft.amount || "");
      if (amountCents === null || amountCents <= 0) throw new Error("Informe um valor maior que zero.");
      if (!["imprevisto", "planejado", "casa"].includes(draft.expenseKind)) {
        throw new Error("Escolha a tarja: Imprevisto, Planejado ou Custo de vida.");
      }
      if (!String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão deste gasto.");
      setWorking(true, "Salvando...");
      state.data = await request(`/api/expenses/${draft.id}/classification`, {
        method: "POST",
        body: {
          classification: draft.expenseKind,
          name: draft.name.trim(),
          amountCents,
          cardLabel: draft.cardLabel,
          note: draft.note,
        },
      });
      rememberMonth(state.data);
      const moved = draft.expenseKind === "casa" ? "Custo de vida" : draft.expenseKind === "planejado" ? "Planejado" : "Imprevisto";
      state.notice = draft.expenseKind === draft.originalKind
        ? "Gasto atualizado."
        : `Gasto atualizado. A tarja agora é ${moved}.`;
    } else {
      if (draft.cardExpense && draft.mode === "create") {
        draft.section = "card";
        draft.payment = "card";
        draft.onCard = false;
      } else if (draft.cardExpense && draft.section !== "fixed") {
        draft.payment = "card";
        draft.onCard = false;
      }
      let amountCents = parseMoney(draft.amount || "0");
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      if (amountCents === null) throw new Error("Informe o valor. Exemplo: 75,90");
      const variableCard = draft.mode === "create" && draft.section === "fixed" && !draft.cardExpense && draft.payment === "card" && draft.costKind === "variavel";
      const livingOnCard = draft.mode === "create" && draft.section === "fixed" && !draft.cardExpense && draft.payment === "card" && !variableCard;
      if (variableCard && !String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão.");
      if (variableCard && amountCents <= 0) throw new Error("Informe o valor previsto.");
      if (livingOnCard) {
        draft.onCard = false;
        draft.paid = false;
        if (!String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão.");
        if (amountCents <= 0) throw new Error("Informe um valor maior que zero para lançar no cartão.");
      }
      const editingLiving = draft.mode === "edit" && draft.section === "fixed" && !draft.cardExpense;
      const seriesEdit = (editingLiving || (draft.mode === "edit" && draft.section === "card"))
        && (draft.editScope === "forward" || draft.editScope === "all");
      const wantsCard = editingLiving && draft.payment === "card";
      const chargeChanged = editingLiving && (
        amountCents !== draft.originalAmount
        || String(draft.cardLabel || "") !== String(draft.originalCard || "")
        || draft.name.trim() !== String(draft.originalName || "")
      );
      const relaunch = wantsCard && (!draft.wasOnCard || chargeChanged);
      if (editingLiving && wantsCard && !String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão.");
      if (relaunch && amountCents <= 0) throw new Error("Informe um valor maior que zero para lançar no cartão.");
      const needsCard = (draft.section === "extra" && draft.payment === "card")
        || (draft.section === "fixed" && draft.onCard)
        || (draft.cardExpense && draft.mode === "create");
      if (needsCard && !String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão deste gasto.");
      const onCardPurchase = draft.mode === "create" && !livingOnCard && !variableCard && draft.section !== "fixed" && (draft.section === "card" || draft.payment === "card");
      const totalCount = Number(draft.installmentCount);
      const paidCount = Number(draft.installmentsPaid);
      if (onCardPurchase && (!Number.isInteger(totalCount) || !Number.isInteger(paidCount))) {
        throw new Error("Informe as parcelas em números inteiros.");
      }
      const recurringMonths = draft.mode === "create" && draft.section === "fixed" && !draft.cardExpense
        ? recurringMonthIds(draft)
        : null;
      if (recurringMonths && !recurringMonths.length) {
        throw new Error(livingOnCard
          ? "A primeira fatura precisa estar dentro dos meses da conta."
          : "Escolha um período em que o fim não seja antes do início.");
      }
      if (draft.mode === "edit" && draft.section === "card") {
        if (!Number.isInteger(totalCount) || totalCount < 1 || totalCount > 48 || !Number.isInteger(paidCount) || paidCount < 0 || paidCount >= totalCount) {
          throw new Error("Informe as parcelas em números inteiros.");
        }
        if (draft.amountMode === "total") {
          const per = Math.floor(amountCents / totalCount);
          if (per <= 0) throw new Error("O valor total não cobre todas as parcelas.");
          amountCents = per;
        }
        draft.installment = totalCount > 1 ? `${paidCount + 1}/${totalCount}` : "";
        draft.payment = "card";
        draft.onCard = false;
      }
      const surpriseCard = draft.mode === "create" && !draft.cardExpense && draft.section === "extra" && draft.payment === "card";
      const startMonthId = surpriseCard ? (draft.invoiceMonthId || "") : state.monthId;
      if (surpriseCard && !startMonthId) throw new Error("Escolha a fatura em que o valor entra.");
      const invoiceLabel = (state.data?.months || []).find((month) => month.id === startMonthId)?.label || "";
      const dueMonth = livingOnCard
        ? (recurringMonths?.[0] || state.monthId)
        : relaunch ? draft.monthId : surpriseCard ? startMonthId : onCardPurchase ? state.monthId : "";
      const dueCard = dueMonth ? draft.cardLabel : "";
      if (dueCard && !acceptPastDue(pastDueWarning(dueCard, dueMonth))) return;
      setWorking(true, "Salvando...");
      const body = {
        name: draft.name,
        amountCents,
        section: draft.section,
        payment: (draft.section === "fixed" && draft.onCard) || livingOnCard || wantsCard ? "card" : draft.payment,
        onCard: draft.section === "fixed" && draft.onCard && !relaunch,
        cardLabel: draft.cardLabel,
        note: composeNote(draft.originId, draft.note, draft.partialId, draft.seriesId, draft.variable || draft.costKind === "variavel", draft.section === "extra" && draft.expenseKind === "planejado", variableCard && draft.invoiceTiming === "seguinte"),
        installment: onCardPurchase ? null : draft.installment,
        paid: draft.paid,
        installmentPlan: onCardPurchase ? { totalCount, paidCount, amountMode: draft.amountMode || "installment" } : undefined,
        cardLaunch: livingOnCard ? (draft.span === "month" ? "month" : "following") : undefined,
        costKind: variableCard ? "variavel" : undefined,
        kind: draft.section === "extra" ? (draft.expenseKind === "planejado" ? "planejado" : "imprevisto") : undefined,
      };
      if (onCardPurchase) {
        const remaining = totalCount - paidCount;
        state.notice = surpriseCard
          ? (remaining > 1 ? `Lancei ${remaining} parcelas a partir da fatura de ${invoiceLabel}.` : `Lancei na fatura de ${invoiceLabel}.`)
          : (remaining > 1 ? `Lancei ${remaining} parcelas a partir deste mês.` : "");
      }
      if (draft.mode === "create") {
        state.data = await request("/api/expenses", {
          method: "POST",
          body: {
            ...body,
            monthId: startMonthId,
            monthIds: recurringMonths || undefined,
          },
        });
        if (variableCard) {
          state.notice = "Valor previsto. Nada entrou na fatura. Lance o total ou um parcial quando quiser. A despesa só encerra quando você pedir.";
        } else if (livingOnCard) {
          state.notice = draft.span === "month"
            ? "Lancei este custo no cartão só deste mês."
            : draft.span === "following"
            ? "Lancei este custo no cartão deste mês e dos seguintes."
            : draft.span === "period"
            ? "Lancei este custo no cartão do período escolhido."
            : "Lancei este custo no cartão de todos os meses.";
        } else if (recurringMonths) {
          const span = recurringMonths.length > 1 ? ` em ${recurringMonths.length} meses` : "";
          state.notice = `Valor previsto${span}. Lance Pago no Pix, Enviar pro cartão ou Pagamento parcial para ele entrar na conta.`;
        }
        if (surpriseCard && startMonthId !== state.monthId) await loadMonth(state.monthId);
        rememberMonth(state.data);
      } else if (seriesEdit) {
        const payment = draft.section === "card" || draft.payment === "card"
          ? "card"
          : "pix";
        state.data = await request(`/api/expenses/${draft.id}`, {
          method: "PATCH",
          body: {
            ...body,
            payment,
            cardLabel: draft.cardLabel,
            editScope: draft.editScope,
          },
        });
        rememberMonth(state.data);
        state.notice = draft.editScope === "all"
          ? "Alterei todos os registros."
          : "Alterei este mês e os seguintes.";
      } else if (editingLiving) {
        if (draft.wasOnCard && (!wantsCard || relaunch)) {
          await request(`/api/expenses/${draft.id}/card-payment?scope=month`, { method: "DELETE" });
        }
        state.data = await request(`/api/expenses/${draft.id}`, {
          method: "PATCH",
          body: {
            ...body,
            payment: wantsCard && !relaunch ? "card" : "pix",
            onCard: Boolean(wantsCard && draft.wasOnCard && !relaunch),
            paid: relaunch ? false : (wantsCard ? true : (draft.wasOnCard ? false : draft.paid)),
          },
        });
        if (relaunch) {
          state.data = await request(`/api/expenses/${draft.id}/card-payment`, {
            method: "POST",
            body: {
              cardLabel: draft.cardLabel,
              alias: draft.name.trim(),
              amountCents,
              installmentCount: 1,
              invoiceMonthId: draft.monthId,
              amountMode: "installment",
              scope: "month",
            },
          });
          state.notice = "Lancei o valor no cartão deste mês.";
        } else if (draft.wasOnCard && !wantsCard) {
          state.notice = "Tirei este mês do cartão. O pagamento ficou no Pix.";
        }
        rememberMonth(state.data);
      } else {
        state.data = await request(`/api/expenses/${draft.id}`, { method: "PATCH", body });
        rememberMonth(state.data);
      }
    }
    state.sheet = null;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function patchExpense(expense, patch) {
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    state.data = await request(`/api/expenses/${expense.id}`, {
      method: "PATCH",
      body: {
        name: expense.name,
        amountCents: expense.amountCents,
        section: expense.section,
        payment: expense.payment,
        onCard: expense.onCard,
        cardLabel: expense.cardLabel,
        note: expense.note,
        installment: expense.installment,
        paid: expense.paid,
        ...patch,
      },
    });
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

function openDeleteExpense(expense) {
  if (!expense?.id) return;
  const cardSurprise = expense.section === "extra" && expense.payment === "card";
  if (expense.section !== "fixed" && expense.section !== "card" && !cardSurprise) {
    if (!window.confirm(`Excluir “${expense.name}” deste mês?`)) return;
    deleteExpenseNow(expense, "month");
    return;
  }
  state.expenseInfo = null;
  state.sheet = {
    mode: "delete-expense",
    id: expense.id,
    name: expense.name,
    section: expense.section,
    scope: cardSurprise ? "forward" : "month",
  };
  state.error = "";
  render();
}

async function deleteExpenseNow(expense, scope = "month") {
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    const query = scope === "month" ? "" : `?scope=${scope}`;
    state.data = await request(`/api/expenses/${expense.id}${query}`, { method: "DELETE" });
    if (state.sheet?.id === expense.id || state.sheet?.mode === "delete-expense") state.sheet = null;
    state.notice = scope === "series"
      ? `Excluí “${expense.name}” de todos os meses.`
      : scope === "forward"
        ? `Tirei “${expense.name}” desta fatura e das seguintes.`
        : `Excluí “${expense.name}” deste mês.`;
    rememberMonth(state.data);
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

async function removeExpense() {
  openDeleteExpense(state.sheet);
}

async function copyPrevious() {
  state.error = "";
  setWorking(true, "Trazendo lançamentos...");
  try {
    const data = await request(`/api/months/${state.monthId}/copy`, { method: "POST", body: {} });
    state.data = data;
    state.notice = data.copied > 0
      ? `Trouxe ${data.copied} ${data.copied === 1 ? "lançamento" : "lançamentos"} do mês anterior.`
      : "Não havia lançamento novo para trazer. A planilha de cada mês já está carregada.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

async function settle(mode) {
  state.error = "";
  setWorking(true, "Atualizando...");
  try {
    state.data = await request(`/api/months/${state.monthId}/settle`, { method: "POST", body: { mode } });
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

async function logout() {
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

function closeSheet() {
  state.sheet = null;
  state.accountMenu = false;
  state.error = "";
  render();
}

function paymentLabel(payment) {
  return payment === "card" ? "Crédito" : "Pix";
}

function money(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function centsToInput(cents) {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.trunc(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

function parseMoney(value) {
  const raw = value.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!raw) return null;
  const negative = raw.startsWith("-");
  const body = raw.replace(/^-/, "");
  let normalized = body;
  if (body.includes(",")) normalized = body.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(body)) normalized = body.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
  return negative ? -cents : cents;
}

async function request(path, options = {}) {
  const attempts = Math.max(1, options.attempts || 1);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestOnce(path, options);
    } catch (error) {
      lastError = error;
      if (!(error instanceof TypeError) || attempt === attempts) throw error;
    }
  }
  throw lastError;
}

async function requestOnce(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/login" && path !== "/api/register" && path !== "/api/passkeys/login") {
      state.booting = false;
      state.authed = false;
      state.authView = "login";
      state.needsPeriod = false;
      state.choosing = false;
      state.data = null;
      state.busy = false;
      clearMonthCache();
      renderSafely();
    }
    if (!response.ok) {
      const error = new Error(data.error || "Não foi possível concluir.");
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("O servidor demorou para responder. Tente de novo.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(error) {
  if (error?.name === "AbortError") return "O servidor demorou para responder. Tente de novo.";
  if (error instanceof TypeError && /fetch|network|Failed/i.test(String(error.message || ""))) {
    return "Sem conexão. Tente de novo em instantes.";
  }
  return error?.message || "Não foi possível concluir.";
}

function renderSafely() {
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

function glyph(name) {
  const paths = {
    resumo: "M4 12h16M4 6h16M4 18h10",
    cartoes: "M3 7h18v10H3zM3 11h18",
    casa: "M4 11l8-7 8 7v8H4z",
    extras: "M12 5v14M5 12h14",
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

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "onclick" || (key.startsWith("on") && typeof value === "function")) node.addEventListener(key.slice(2), value);
    else if (key === "for") node.htmlFor = value;
    else if (key === "value") node.value = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === "") continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
