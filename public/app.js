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
  showEmpty: false,
  cardFocus: null,
  sheet: null,
};

const views = [
  ["resumo", "Resumo"],
  ["cartoes", "Cartões"],
  ["casa", "Casa"],
  ["extras", "Extras"],
  ["receita", "Receita"],
];

boot();

async function boot() {
  try {
    const session = await request("/api/session");
    state.needsSetup = session.needsSetup;
    state.authed = session.authenticated;
    if (session.needsSetup) state.authView = "register";
    if (state.authed) await loadMonth(state.monthId);
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    state.booting = false;
    render();
  }
}

async function loadMonth(monthId) {
  const path = monthId ? `/api/months/${monthId}` : "/api/months/2026-11";
  let data;
  try {
    data = await request(path);
  } catch (error) {
    if (!monthId && error.status === 404) throw error;
    if (monthId) {
      data = await request("/api/months/2026-11");
    } else {
      throw error;
    }
  }
  if (!monthId && !sessionStorage.getItem("monthId")) {
    const today = currentMonthId();
    if (today !== data.month.id && data.months.some((month) => month.id === today)) {
      data = await request(`/api/months/${today}`);
    }
  }
  state.data = data;
  state.monthId = data.month.id;
  sessionStorage.setItem("monthId", data.month.id);
}

function currentMonthId() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function render() {
  const scrollY = window.scrollY;
  const viewKey = `${state.authed}:${state.monthId}:${state.view}:${state.cardFocus || ""}`;
  const keepPlace = state.viewKey === viewKey;
  root.replaceChildren();
  if (state.booting) {
    root.append(screen(el("p", { class: "lede" }, "Abrindo o mês...")));
    return;
  }
  if (!state.authed) {
    root.append(authScreen());
    state.viewKey = viewKey;
    return;
  }
  if (state.choosing) {
    root.append(accessScreen());
    state.viewKey = viewKey;
    return;
  }
  root.append(shell());
  if (state.sheet) root.append(sheet());
  window.scrollTo(0, keepPlace ? scrollY : 0);
  state.viewKey = viewKey;
  queueMicrotask(centerMonthChip);
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
      : "Entre com CPF e senha para ver a fatura, a casa e os gastos extras."),
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
    await request(registering ? "/api/register" : "/api/login", { method: "POST", body });
    state.authed = true;
    state.needsSetup = false;
    state.auth.password = "";
    state.auth.confirmation = "";
    await enterApp();
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    render();
  }
}

async function loginWithPasskey() {
  state.error = "";
  setWorking(true, "Aguardando a digital...");
  try {
    const options = await request("/api/passkeys/login/options", { method: "POST", body: {} });
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
    render();
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
    render();
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
    render();
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

async function enterApp() {
  const data = await request("/api/spaces");
  state.spaces = data.spaces || [];
  if (state.spaces.length > 1) {
    state.choosing = true;
    state.data = null;
    return;
  }
  state.choosing = false;
  await loadMonth(state.monthId);
}

async function chooseSpace(ownerId) {
  state.error = "";
  setWorking(true, "Abrindo...");
  try {
    const data = await request("/api/scope", { method: "POST", body: { ownerId } });
    state.spaces = data.spaces || state.spaces;
    state.choosing = false;
    state.sheet = null;
    await loadMonth(state.monthId);
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    render();
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
    render();
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
    render();
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
    render();
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
    render();
  }
}

function screen(child) {
  return el("main", { class: "screen" }, [child]);
}

function shell() {
  const data = state.data;
  return el("div", { class: "shell" }, [
    el("header", { class: "top" }, [
      el("div", { class: "top-row" }, [
        el("p", { class: "eyebrow" }, state.data?.access?.own === false ? state.data.access.label : "Meus gastos"),
        el("div", { class: "top-actions" }, [
          state.spaces.length > 1 ? el("button", { class: "linkish", type: "button", onclick: () => { state.choosing = true; render(); } }, "Acesso") : "",
          state.data?.access?.permission === "own" ? el("button", { class: "linkish", type: "button", onclick: openShares }, "Compartilhar") : "",
          el("button", { class: "linkish", type: "button", onclick: openPassword }, "Senha"),
        ]),
      ]),
    ]),
    el("div", { class: "months" }, data.months.map(monthChip)),
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
  state.error = "";
  setWorking(true, "Abrindo o mês...");
  try {
    await loadMonth(monthId);
    state.showEmpty = false;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    render();
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
      el("p", { class: "muted" }, `Total do mês ${money(totals.commitmentsCents)} · já pago ${money(totals.paidCents)}`),
      month.settled ? el("p", { class: "badge paid" }, "Mês quitado") : "",
    ]),
    el("div", { class: "grid" }, [
      el("button", { class: "metric", type: "button", onclick: () => { state.view = "receita"; render(); } }, [
        el("small", {}, "Receita"),
        el("strong", {}, money(month.incomeCents)),
        month.extraIncomeCents ? el("small", {}, `inclui ${money(month.extraIncomeCents)} extras`) : "",
      ]),
      el("div", { class: "metric" }, [
        el("small", {}, "Saldo previsto"),
        el("strong", { class: totals.balanceCents < 0 ? "negative" : "positive" }, money(totals.balanceCents)),
      ]),
    ]),
    jump("cartoes", "Fatura do cartão", money(totals.faturaCents), totals.extrasCardCents
      ? `${money(totals.invoiceCents)} previstos + ${money(totals.extrasCardCents)} em extras`
      : "Nubank, Neon e linhas da fatura"),
    jump("casa", "Gastos fixos", money(totals.fixedCents), totals.fixedOnCardCents
      ? `${money(totals.fixedOnCardCents)} já entram na fatura e não somam de novo`
      : "Casa, Pix e boletos deste mês"),
    jump("extras", "Gastos extras", money(totals.extrasCardCents + totals.extrasPixCents), `${money(totals.extrasPixCents)} fora do cartão · ${money(totals.extrasCardCents)} no cartão`),
    editable() && totals.remainingCents > 0
      ? el("button", { class: "primary", type: "button", onclick: () => settle("pay-remaining") }, "Quitar o que falta")
      : editable()
        ? el("button", { class: "secondary", type: "button", onclick: () => settle("reopen") }, "Reabrir mês")
        : "",
    editable() ? el("button", { class: "secondary", type: "button", onclick: copyPrevious }, "Trazer lançamentos do mês anterior") : "",
    editable() ? el("p", { class: "muted" }, "Quitar marca como pagos a fatura, o Pix e os extras. Um gasto fixo marcado na fatura continua na casa, sem ser cobrado outra vez.") : "",
    el("button", { class: "linkish", type: "button", onclick: logout }, "Sair"),
  ]);
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
    el("p", { class: "note" }, "Toque num cartão para ver o detalhamento. Dá para editar ou excluir cada gasto."),
    editable() ? el("div", { class: "stack-actions" }, [
      el("button", { class: "primary", type: "button", onclick: () => openCardExpense() }, "+ Gasto Cartão"),
      el("button", { class: "secondary", type: "button", onclick: () => { state.error = ""; openCreateCard(); } }, "Adicionar cartão"),
    ]) : "",
  ];
  if (!cards.length) children.push(el("p", { class: "muted" }, "Nenhum cartão ainda."));
  for (const card of cards) {
    children.push(cardJump(card.name, cardInvoiceCents(data.expenses, card.name), expensesForCardName(data.expenses, card.name), () => openCard(card.id)));
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
    }, "Todos os cartões"),
    el("div", { class: "section-head" }, [
      el("p", { class: "eyebrow" }, data.month.label),
      el("h2", {}, card ? card.name : "Sem cartão"),
      el("p", { class: "money inline" }, money(total)),
      el("p", { class: "muted" }, card
        ? "Gastos vinculados a este cartão. O que veio da casa já está na fatura e não soma de novo."
        : "Estes gastos ainda não têm um cartão cadastrado."),
    ]),
    editable() ? el("div", { class: "stack-actions" }, [
      el("button", {
        class: "primary",
        type: "button",
        onclick: () => openCardExpense(card ? card.name : ""),
      }, "+ Gasto Cartão"),
    ]) : "",
  ];
  const groups = [
    ["Fatura prevista", visible.filter((expense) => expense.section === "card")],
    ["Gastos do cartão", visible.filter((expense) => expense.section === "extra")],
    ["Da casa, já na fatura", visible.filter((expense) => expense.section === "fixed")],
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

function cardJump(name, amount, expenses, onclick) {
  const count = expenses.filter(shownExpense).length;
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
  return expense.section === "fixed" && (expense.onCard || expense.payment === "card");
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
  const heading = section === "card" ? "Cartões" : section === "fixed" ? "Casa" : "Extras";
  const total = section === "card" ? totals.faturaCents : section === "fixed" ? totals.fixedCents : totals.extrasCardCents + totals.extrasPixCents;
  const children = [
    el("div", { class: "section-head" }, [
      el("p", { class: "eyebrow" }, data.month.label),
      el("h2", {}, money(total)),
      el("p", { class: "muted" }, blurb(section, totals)),
    ]),
  ];
  if (section === "fixed") {
    children.push(el("p", { class: "note" }, "Marque “Na fatura” quando o gasto fixo foi para o cartão. Ele continua neste total da casa e aparece como já contabilizado, sem entrar de novo no que falta pagar."));
  }
  if (section === "extra") {
    children.push(el("p", { class: "note" }, "Dê um nome ao gasto extra e diga se ele saiu no Pix, débito, dinheiro ou cartão."));
  }
  if (editable()) {
    children.push(el("button", {
      class: "primary add-top",
      type: "button",
      onclick: () => openCreate(section, "pix"),
    }, section === "fixed" ? "Adicionar gasto fixo" : "Adicionar gasto"));
  }
  children.push(el("div", { class: "list" }, visible.map((expense) => expenseRow(expense, section))));
  if (!visible.length) {
    children.push(el("p", { class: "muted" }, section === "extra" ? "Nenhum extra neste mês." : "Nada com valor neste mês."));
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
      el("p", { class: "eyebrow" }, "Receita"),
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
  if (draft.mode === "create" && (draft.section === "card" || draft.payment === "card")) {
    return draft.amountMode === "total" ? "Valor total da compra" : "Valor da parcela";
  }
  return "Valor";
}

function cardPurchaseFields(draft) {
  if (draft.mode !== "create" || (draft.section !== "card" && draft.payment !== "card")) return "";
  return el("div", {}, [
    field("Quantidade de parcelas", "installmentCount", draft.installmentCount || "1", "numeric"),
    field("Parcelas já pagas", "installmentsPaid", draft.installmentsPaid || "0", "numeric"),
    el("div", { class: "field" }, [
      el("label", {}, "O valor informado é"),
      segmented("amountMode", [["installment", "Da parcela"], ["total", "Da compra toda"]], draft.amountMode || "installment"),
    ]),
    el("p", { class: "muted", id: "installment-preview" }, installmentPreview(draft)),
  ]);
}

function installmentPreview(draft) {
  const total = Number(draft.installmentCount);
  const paid = Number(draft.installmentsPaid);
  const amount = parseMoney(draft.amount || "");
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(paid) || paid < 0 || paid >= total || amount === null || amount <= 0) {
    return "A parcela deste mês é a primeira que ainda falta pagar. As seguintes entram nos próximos meses.";
  }
  const per = draft.amountMode === "total" ? Math.floor(amount / total) : amount;
  const remaining = total - paid;
  return `${remaining} ${remaining === 1 ? "parcela" : "parcelas"} de ${money(per)} a partir deste mês (${paid + 1}/${total}).`;
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

function blurb(section, totals) {
  if (section === "card" && totals.fixedOnCardCents) {
    return `${money(totals.fixedOnCardCents)} de gastos da casa já estão dentro desta fatura e não são somados de novo.`;
  }
  if (section === "card") return "Linhas previstas da planilha mais os extras lançados no cartão.";
  if (section === "fixed") {
    return totals.fixedOnCardCents
      ? `${money(totals.fixedCashCents)} ainda saem no Pix ou boleto. ${money(totals.fixedOnCardCents)} já estão na fatura.`
      : "Tudo isto entra no mês, separado da fatura, até você marcar o que foi para o cartão.";
  }
  return "Estes gastos não estavam na projeção e valem só para este mês.";
}

function expenseRow(expense, section, options = {}) {
  const onInvoice = expense.section === "fixed" && expense.onCard;
  const lockedCard = Boolean(options.cardExpense) && expense.section !== "fixed";
  const meta = [];
  if (expense.section === "extra" && section === "card" && !options.manage) meta.push("Extra");
  if (onInvoice && section === "card") meta.push("Gasto fixo, já incluído");
  if (expense.payment !== "card" || onInvoice) meta.push(paymentLabel(expense.payment));
  if (expense.payment === "card" && !onInvoice && !options.manage) meta.push(expense.cardLabel ? `Cartão ${expense.cardLabel}` : "Cartão");
  if (expense.installment) meta.push(expense.installment);
  if (expense.paid) meta.push("Pago");
  const check = !editable() || onInvoice
    ? el("span", { class: "check spacer", "aria-hidden": "true" }, "")
    : el("button", {
      type: "button",
      class: `check ${expense.paid ? "on" : "off"}`,
      "aria-label": expense.paid ? "Marcar como não pago" : "Marcar como pago",
      onclick: () => patchExpense(expense, { paid: !expense.paid }),
    }, expense.paid ? "✓" : "");
  const invoiceToggle = editable() && section === "fixed"
    ? el("button", {
      type: "button",
      class: `toggle${onInvoice ? " on" : ""}`,
      onclick: () => toggleInvoice(expense),
    }, onInvoice ? "Na fatura" : "Marcar na fatura")
    : "";
  const edit = () => {
    if (editable()) openEdit(expense, { cardExpense: lockedCard });
  };
  return el("article", { class: `item${onInvoice && section === "card" ? " aside" : ""}` }, [
    check,
    el("div", { class: "item-copy" }, [
      el("button", { type: "button", class: "item-main", onclick: edit }, [
        el("strong", {}, expense.name),
        el("small", {}, meta.filter(Boolean).join(" · ")),
      ]),
      invoiceToggle,
      options.manage
        ? el("div", { class: "item-actions" }, [
          el("button", { type: "button", class: "linkish", onclick: edit }, "Editar"),
          el("button", { type: "button", class: "linkish danger", onclick: () => deleteExpense(expense) }, "Excluir"),
        ])
        : "",
      onInvoice && section === "card" ? el("span", { class: "badge" }, "Já contabilizado, não soma de novo") : "",
      expense.section === "extra" && expense.payment !== "card" ? el("span", { class: "badge pix" }, paymentLabel(expense.payment)) : "",
    ]),
    el("span", { class: `amount${onInvoice && section === "card" ? " aside" : ""}` }, expense.amountCents === 0 ? "—" : money(expense.amountCents)),
  ]);
}

function openCreate(section, payment) {
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
    paid: false,
    source: "user",
  };
  state.error = "";
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
    section: "extra",
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
  state.sheet = { mode: "card", name: "" };
  render();
}

function openEdit(expense, options = {}) {
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
    note: expense.note || "",
    installment: expense.installment || "",
    paid: expense.paid,
    source: expense.source,
  };
  state.error = "";
  render();
}

function toggleInvoice(expense) {
  if (!expense.onCard) {
    const cardLabel = expense.cardLabel || firstCardName();
    if (!cardLabel) {
      state.error = "Adicione um cartão antes de marcar o gasto na fatura.";
      render();
      return;
    }
    patchExpense(expense, { onCard: true, payment: "card", cardLabel });
    return;
  }
  patchExpense(expense, { onCard: false, payment: "pix", cardLabel: null });
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
  state.sheet = { mode: "password", current: "", next: "", confirmation: "" };
  render();
}

function sheet() {
  const draft = state.sheet;
  const panel = el("form", { class: "sheet" }, [el("div", { class: "handle" })]);
  panel.addEventListener("submit", saveSheet);
  if (state.error) panel.append(el("p", { class: "error" }, state.error));
  if (state.notice) panel.append(el("p", { class: "note" }, state.notice));
  if (draft.mode === "share") {
    panel.append(
      el("h2", {}, "Compartilhar"),
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
  } else if (draft.mode === "password") {
    panel.append(
      el("h2", {}, "Digital deste celular"),
      el("p", { class: "muted" }, "Use a digital já cadastrada no Android para abrir o app neste aparelho. A senha continua valendo."),
      window.PublicKeyCredential
        ? el("button", { class: "secondary", type: "button", onclick: registerPasskey }, "Cadastrar digital")
        : el("p", { class: "note" }, "Este navegador não oferece chave de acesso com digital."),
      el("div", { class: "list" }, (state.passkeys || []).map((passkey) => el("article", { class: "item" }, [
        el("div", { class: "item-copy" }, [
          el("strong", {}, "Digital"),
          el("small", {}, passkeyWhen(passkey.createdAt)),
        ]),
        el("button", { class: "linkish danger", type: "button", onclick: () => removePasskey(passkey.id) }, "Remover"),
      ]))),
      el("h2", { class: "subhead" }, "Trocar senha"),
      field("Senha atual", "current", "", "password"),
      field("Nova senha", "next", "", "password"),
      field("Confirmar nova senha", "confirmation", "", "password"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Trocar"),
      ]),
    );
  } else if (draft.mode === "card") {
    panel.append(
      el("h2", {}, "Novo cartão"),
      field("Nome", "name", draft.name, "text", "Nubank, Neon ou outro"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
    );
  } else {
    const needsCard = draft.cardExpense || draft.section === "card" || draft.payment === "card" || draft.onCard;
    panel.append(
      el("h2", {}, draft.cardExpense && draft.mode === "create" ? "Gasto no cartão" : draft.mode === "create" ? "Novo gasto" : "Editar gasto"),
      field("Nome", "name", draft.name, "text"),
      field(amountLabel(draft), "amount", draft.amount, "decimal"),
      draft.cardExpense
        ? ""
        : el("div", { class: "field" }, [
          el("label", {}, "Tipo"),
          segmented("section", [
            ["extra", "Extra"],
            ["fixed", "Fixo"],
            ["card", "Fatura"],
          ], draft.section),
        ]),
      draft.cardExpense
        ? el("div", { class: "field" }, [
          el("label", {}, "Como foi pago"),
          el("div", { class: "choice" }, [el("div", { class: "static" }, "Cartão")]),
        ])
        : draft.section === "fixed"
          ? el("div", { class: "field" }, [
            el("button", {
              type: "button",
              class: `switch${draft.onCard ? " on" : ""}`,
              onclick: () => {
                draft.onCard = !draft.onCard;
                draft.payment = draft.onCard ? "card" : "pix";
                if (draft.onCard && !draft.cardLabel) draft.cardLabel = firstCardName();
                render();
              },
            }, [draft.onCard ? "Na fatura do cartão" : "Ainda não foi para o cartão", draft.onCard ? "Sim" : "Não"]),
            el("small", { class: "muted" }, "Continua nos gastos fixos. O total a pagar deixa de somar este valor outra vez."),
          ])
          : draft.section === "extra"
            ? el("div", { class: "field" }, [
              el("label", {}, "Como foi pago"),
              segmented("payment", [["pix", "Pix"], ["debit", "Débito"], ["cash", "Dinheiro"], ["card", "Cartão"]], draft.payment),
            ])
            : "",
      cardPurchaseFields(draft),
      draft.mode === "edit" && (draft.section === "card" || draft.section === "extra")
        ? field("Parcela", "installment", draft.installment, "text", "3/10, se houver")
        : "",
      needsCard ? cardSelect(draft) : "",
      field("Observação", "note", draft.note, "text"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit", disabled: state.busy ? "" : null }, state.busy ? "Salvando..." : "Salvar"),
      ]),
      draft.mode === "edit"
        ? el("button", { class: "danger", type: "button", onclick: removeExpense }, "Excluir gasto")
        : "",
    );
  }
  const overlay = el("div", { class: "overlay", onclick: (event) => {
    if (event.target === overlay) closeSheet();
  } }, [panel]);
  return overlay;
}

function cardSelect(draft) {
  const cards = state.data?.cards ?? [];
  const required = (draft.section === "extra" && (draft.payment === "card" || draft.cardExpense))
    || (draft.section === "fixed" && draft.onCard)
    || (draft.cardExpense && draft.mode === "create");
  const current = draft.cardLabel || "";
  const known = cards.some((card) => card.name === current);
  const select = el("select", { id: "cardLabel", name: "cardLabel" });
  if (!required || !current) select.append(el("option", { value: "" }, required ? "Escolha o cartão" : "Sem cartão"));
  if (current && !known) select.append(el("option", { value: current }, current));
  for (const card of cards) select.append(el("option", { value: card.name }, card.name));
  select.value = current;
  select.addEventListener("change", () => {
    state.sheet.cardLabel = select.value;
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
    const preview = document.querySelector("#installment-preview");
    if (preview && state.sheet) preview.textContent = installmentPreview(state.sheet);
  });
  return el("div", { class: "field" }, [el("label", { for: key }, labelText), input]);
}

function segmented(key, options, current) {
  return el("div", { class: "choice" }, options.map(([value, label]) => el("button", {
    type: "button",
    class: current === value ? "on" : "",
    onclick: () => {
      state.sheet[key] = value;
      if (key === "section") {
        if (value === "card") {
          state.sheet.payment = "card";
          state.sheet.onCard = false;
        }
        if (value === "extra") state.sheet.onCard = false;
        if (value === "fixed") state.sheet.payment = state.sheet.onCard ? "card" : "pix";
      }
      if (key === "payment" && value === "card" && !state.sheet.cardLabel) state.sheet.cardLabel = firstCardName();
      if (key === "section" && value === "card" && !state.sheet.cardLabel) state.sheet.cardLabel = firstCardName();
      render();
    },
  }, label)));
}

async function saveSheet(event) {
  event.preventDefault();
  const draft = state.sheet;
  state.error = "";
  try {
    if (draft.mode === "share") {
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
    } else if (draft.mode === "card") {
      if (!draft.name.trim()) throw new Error("Dê um nome ao cartão.");
      setWorking(true, "Salvando...");
      const data = await request("/api/cards", { method: "POST", body: { name: draft.name } });
      state.data.cards = data.cards;
    } else {
      if (draft.cardExpense && draft.mode === "create") {
        draft.section = "extra";
        draft.payment = "card";
        draft.onCard = false;
      } else if (draft.cardExpense && draft.section !== "fixed") {
        draft.payment = "card";
        draft.onCard = false;
      }
      const amountCents = parseMoney(draft.amount || "0");
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      if (amountCents === null) throw new Error("Informe o valor. Exemplo: 75,90");
      const needsCard = (draft.section === "extra" && draft.payment === "card") || (draft.section === "fixed" && draft.onCard);
      if (needsCard && !String(draft.cardLabel || "").trim()) throw new Error("Escolha o cartão deste gasto.");
      const onCardPurchase = draft.mode === "create" && (draft.section === "card" || draft.payment === "card");
      const totalCount = Number(draft.installmentCount);
      const paidCount = Number(draft.installmentsPaid);
      if (onCardPurchase && (!Number.isInteger(totalCount) || !Number.isInteger(paidCount))) {
        throw new Error("Informe as parcelas em números inteiros.");
      }
      setWorking(true, "Salvando...");
      const body = {
        name: draft.name,
        amountCents,
        section: draft.section,
        payment: draft.section === "fixed" && draft.onCard ? "card" : draft.payment,
        onCard: draft.section === "fixed" && draft.onCard,
        cardLabel: draft.cardLabel,
        note: draft.note,
        installment: onCardPurchase ? null : draft.installment,
        paid: draft.paid,
        installmentPlan: onCardPurchase ? { totalCount, paidCount, amountMode: draft.amountMode || "installment" } : undefined,
      };
      if (onCardPurchase) {
        const remaining = totalCount - paidCount;
        state.notice = remaining > 1 ? `Lancei ${remaining} parcelas a partir deste mês.` : "";
      }
      if (draft.mode === "create") {
        state.data = await request("/api/expenses", { method: "POST", body: { ...body, monthId: state.monthId } });
      } else {
        state.data = await request(`/api/expenses/${draft.id}`, { method: "PATCH", body });
      }
    }
    state.sheet = null;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    render();
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
    render();
  }
}

async function deleteExpense(expense) {
  if (!window.confirm(`Excluir “${expense.name}” deste mês?`)) return;
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    state.data = await request(`/api/expenses/${expense.id}`, { method: "DELETE" });
    if (state.sheet?.id === expense.id) state.sheet = null;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    render();
  }
}

async function removeExpense() {
  await deleteExpense(state.sheet);
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
  await request("/api/logout", { method: "POST", body: {} });
  state.authed = false;
  state.authView = "login";
  state.auth.password = "";
  state.auth.confirmation = "";
  state.data = null;
  render();
}

function closeSheet() {
  state.sheet = null;
  state.error = "";
  render();
}

function paymentLabel(payment) {
  if (payment === "card") return "Cartão";
  if (payment === "debit") return "Débito";
  if (payment === "cash") return "Dinheiro";
  return "Pix";
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
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login" && path !== "/api/register" && path !== "/api/passkeys/login") {
    state.authed = false;
    state.authView = "login";
    render();
  }
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function messageOf(error) {
  if (error instanceof TypeError) return "Sem conexão. Tente de novo em instantes.";
  return error.message || "Não foi possível concluir.";
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
