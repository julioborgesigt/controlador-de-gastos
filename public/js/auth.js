import { base64UrlToBuffer, bufferToBase64Url, formatCpf } from "../format.js";
import {
  clearMonthCache,
  loadMonth,
  preloadAround,
  readMonthCache,
  request,
  storeMonth,
} from "./api.js";
import { askConfirm } from "./dialogs/confirm.js";
import { el, messageOf, on } from "./dom.js";
import { defaultPeriodDraft } from "./setup.js";
import { render, renderSafely, setWorking, state } from "./state.js";

export function authScreen() {
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
  on(form, "submit", submitAuth);
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
  on(input, "input", (event) => {
    const fieldEl = event.currentTarget;
    const next = options.mask === "cpf" ? formatCpf(fieldEl.value) : fieldEl.value;
    state.auth[options.key] = next;
    if (next !== fieldEl.value) fieldEl.value = next;
  });
  return el("div", { class: "field" }, [el("label", { for: id }, label), input]);
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

export async function registerPasskey() {
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

export function removePasskey(id) {
  state.confirmTarget = id;
  askConfirm("remove-passkey");
}

export async function executeRemovePasskey(id) {
  if (!id) return;
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

export async function openBudget() {
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
    storeMonth(cached);
    void preloadAround(cached);
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

export function accessScreen() {
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

export function rememberDevicePrompt() {
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

export function devicePromptScreen() {
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

export async function offerDevice(after) {
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
