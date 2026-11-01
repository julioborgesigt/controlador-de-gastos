const root = document.querySelector("#app");

const state = {
  booting: true,
  needsSetup: false,
  authed: false,
  monthId: sessionStorage.getItem("monthId") || "",
  view: "resumo",
  data: null,
  error: "",
  busy: false,
  showEmpty: false,
  sheet: null,
};

const views = [
  ["resumo", "Resumo"],
  ["cartoes", "Cartões"],
  ["casa", "Casa"],
  ["extras", "Extras"],
];

boot();

async function boot() {
  try {
    const session = await request("/api/session");
    state.needsSetup = session.needsSetup;
    state.authed = session.authenticated;
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
  root.replaceChildren();
  if (state.booting) {
    root.append(screen(el("p", { class: "lede" }, "Abrindo o mês...")));
    return;
  }
  if (!state.authed) {
    root.append(lockScreen());
    return;
  }
  root.append(shell());
  if (state.sheet) root.append(sheet());
  const viewKey = `${state.authed}:${state.monthId}:${state.view}`;
  if (state.viewKey !== viewKey) {
    state.viewKey = viewKey;
    window.scrollTo(0, 0);
  }
  queueMicrotask(() => {
    document.querySelector(".chip.active")?.scrollIntoView({ inline: "center", block: "nearest" });
  });
}

function lockScreen() {
  const pin = el("input", {
    id: "pin",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    maxlength: "8",
    placeholder: "4 a 8 dígitos",
  });
  const form = el("form", { class: "lock-card hero" }, [
    el("div", { class: "mark" }, "R$"),
    el("h1", {}, state.needsSetup ? "Crie o PIN" : "Controle de gastos"),
    el("p", { class: "lede" }, state.needsSetup
      ? "Este PIN abre o orçamento neste celular. Ele fica só no banco do aplicativo."
      : "Digite o PIN para ver a fatura, a casa e os gastos extras."),
    state.error ? el("p", { class: "error" }, state.error) : "",
    el("div", { class: "field" }, [el("label", { for: "pin" }, "PIN"), pin]),
    el("button", { class: "primary", type: "submit" }, state.needsSetup ? "Criar PIN e entrar" : "Entrar"),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.error = "";
    state.busy = true;
    try {
      await request(state.needsSetup ? "/api/setup" : "/api/login", { method: "POST", body: { pin: pin.value } });
      state.authed = true;
      state.needsSetup = false;
      await loadMonth(state.monthId);
    } catch (error) {
      state.error = messageOf(error);
    } finally {
      state.busy = false;
      render();
    }
  });
  return screen(form);
}

function screen(child) {
  return el("main", { class: "screen" }, [child]);
}

function shell() {
  const data = state.data;
  return el("div", { class: "shell" }, [
    el("header", { class: "top" }, [
      el("div", { class: "top-row" }, [
        el("p", { class: "eyebrow" }, "Orçamento familiar"),
        el("button", { class: "linkish", type: "button", onclick: openPin }, "PIN"),
      ]),
    ]),
    el("div", { class: "months" }, data.months.map(monthChip)),
    el("main", { class: "content" }, [
      state.error ? el("p", { class: "error" }, state.error) : "",
      viewBody(data),
    ]),
    el("nav", { class: "nav" }, views.map(([id, label]) => el("button", {
      type: "button",
      class: state.view === id ? "active" : "",
      onclick: () => {
        state.view = id;
        state.showEmpty = false;
        state.error = "";
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
  state.busy = true;
  try {
    await loadMonth(monthId);
    state.showEmpty = false;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    state.busy = false;
    render();
  }
}

function viewBody(data) {
  if (state.view === "resumo") return summary(data);
  if (state.view === "cartoes") return sectionList(data, "card");
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
      el("button", { class: "metric", type: "button", onclick: editIncome }, [
        el("small", {}, "Receita"),
        el("strong", {}, money(month.incomeCents)),
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
    jump("extras", "Gastos extras", money(totals.extrasCardCents + totals.extrasPixCents), `${money(totals.extrasPixCents)} no Pix · ${money(totals.extrasCardCents)} no cartão`),
    totals.remainingCents > 0
      ? el("button", { class: "primary", type: "button", onclick: () => settle("pay-remaining") }, "Quitar o que falta")
      : el("button", { class: "secondary", type: "button", onclick: () => settle("reopen") }, "Reabrir mês"),
    el("p", { class: "muted" }, "Quitar marca como pagos a fatura, o Pix e os extras. Um gasto fixo marcado na fatura continua na casa, sem ser cobrado outra vez."),
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
    children.push(el("p", { class: "note" }, "Dê um nome ao gasto extra e diga se ele saiu no Pix ou entrou no cartão. No cartão, ele aumenta a fatura. No Pix, entra à parte."));
  }
  if (section === "card") {
    const groups = [
      ["Fatura prevista", visible.filter((expense) => expense.section === "card")],
      ["Extras no cartão", visible.filter((expense) => expense.section === "extra")],
      ["Da casa, já na fatura", visible.filter((expense) => expense.section === "fixed")],
    ];
    for (const [title, rows] of groups) {
      if (!rows.length) continue;
      children.push(el("p", { class: "eyebrow group" }, title));
      children.push(el("div", { class: "list" }, rows.map((expense) => expenseRow(expense, section))));
    }
  } else {
    children.push(el("div", { class: "list" }, visible.map((expense) => expenseRow(expense, section))));
  }
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
  children.push(el("button", {
    class: "primary",
    type: "button",
    onclick: () => openCreate(section === "card" ? "extra" : section, section === "card" ? "card" : "pix"),
  }, section === "fixed" ? "Adicionar gasto fixo" : "Adicionar gasto"));
  return el("section", {}, children);
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

function expenseRow(expense, section) {
  const onInvoice = expense.section === "fixed" && expense.onCard;
  const meta = [];
  if (expense.section === "extra" && section === "card") meta.push("Extra");
  if (onInvoice && section === "card") meta.push("Gasto fixo, já incluído");
  if (expense.payment === "pix") meta.push("Pix");
  if (expense.payment === "card" && !onInvoice) meta.push(expense.cardLabel ? `Cartão ${expense.cardLabel}` : "Cartão");
  if (expense.paid) meta.push("Pago");
  const check = onInvoice
    ? el("span", { class: "check spacer", "aria-hidden": "true" }, "")
    : el("button", {
      type: "button",
      class: `check ${expense.paid ? "on" : "off"}`,
      "aria-label": expense.paid ? "Marcar como não pago" : "Marcar como pago",
      onclick: () => patchExpense(expense, { paid: !expense.paid }),
    }, expense.paid ? "✓" : "");
  const invoiceToggle = section === "fixed"
    ? el("button", {
      type: "button",
      class: `toggle${onInvoice ? " on" : ""}`,
      onclick: () => patchExpense(expense, {
        onCard: !expense.onCard,
        payment: expense.onCard ? "pix" : "card",
        cardLabel: expense.onCard ? null : (expense.cardLabel || "Nubank"),
      }),
    }, onInvoice ? "Na fatura" : "Marcar na fatura")
    : "";
  return el("article", { class: `item${onInvoice && section === "card" ? " aside" : ""}` }, [
    check,
    el("div", { class: "item-copy" }, [
      el("button", { type: "button", class: "item-main", onclick: () => openEdit(expense) }, [
        el("strong", {}, expense.name),
        el("small", {}, meta.filter(Boolean).join(" · ")),
      ]),
      invoiceToggle,
      onInvoice && section === "card" ? el("span", { class: "badge" }, "Já contabilizado, não soma de novo") : "",
      expense.payment === "pix" && expense.section === "extra" ? el("span", { class: "badge pix" }, "Pix") : "",
    ]),
    el("span", { class: `amount${onInvoice && section === "card" ? " aside" : ""}` }, expense.amountCents === 0 ? "—" : money(expense.amountCents)),
  ]);
}

function openCreate(section, payment) {
  state.sheet = {
    mode: "create",
    id: "",
    name: "",
    amount: "",
    section,
    payment,
    onCard: false,
    cardLabel: section === "card" || payment === "card" ? "Nubank" : "",
    note: "",
    paid: false,
    source: "user",
  };
  state.error = "";
  render();
}

function openEdit(expense) {
  state.sheet = {
    mode: "edit",
    id: expense.id,
    name: expense.name,
    amount: centsToInput(expense.amountCents),
    section: expense.section,
    payment: expense.payment,
    onCard: expense.onCard,
    cardLabel: expense.cardLabel || "",
    note: expense.note || "",
    paid: expense.paid,
    source: expense.source,
  };
  state.error = "";
  render();
}

function editIncome() {
  state.sheet = {
    mode: "income",
    amount: centsToInput(state.data.month.incomeCents),
  };
  render();
}

function openPin() {
  state.sheet = { mode: "pin", current: "", next: "" };
  state.error = "";
  render();
}

function sheet() {
  const draft = state.sheet;
  const panel = el("form", { class: "sheet" }, [el("div", { class: "handle" })]);
  panel.addEventListener("submit", saveSheet);
  if (draft.mode === "income") {
    panel.append(
      el("h2", {}, "Receita do mês"),
      field("Valor recebido", "amount", draft.amount, "decimal"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Salvar"),
      ]),
    );
  } else if (draft.mode === "pin") {
    panel.append(
      el("h2", {}, "Trocar PIN"),
      field("PIN atual", "current", "", "numeric"),
      field("PIN novo", "next", "", "numeric"),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
        el("button", { class: "primary", type: "submit" }, "Trocar"),
      ]),
    );
  } else {
    panel.append(
      el("h2", {}, draft.mode === "create" ? "Novo gasto" : "Editar gasto"),
      field("Nome", "name", draft.name, "text"),
      field("Valor", "amount", draft.amount, "decimal"),
      el("div", { class: "field" }, [
        el("label", {}, "Tipo"),
        segmented("section", [
          ["extra", "Extra"],
          ["fixed", "Fixo"],
          ["card", "Fatura"],
        ], draft.section),
      ]),
      draft.section === "fixed"
        ? el("div", { class: "field" }, [
          el("button", {
            type: "button",
            class: `switch${draft.onCard ? " on" : ""}`,
            onclick: () => {
              draft.onCard = !draft.onCard;
              draft.payment = draft.onCard ? "card" : "pix";
              render();
            },
          }, [draft.onCard ? "Na fatura do cartão" : "Ainda não foi para o cartão", draft.onCard ? "Sim" : "Não"]),
          el("small", { class: "muted" }, "Continua nos gastos fixos. O total a pagar deixa de somar este valor outra vez."),
        ])
        : draft.section === "extra"
          ? el("div", { class: "field" }, [
            el("label", {}, "Como foi pago"),
            segmented("payment", [["pix", "Pix"], ["card", "Cartão"]], draft.payment),
          ])
          : "",
      draft.section === "card" || draft.payment === "card" || draft.onCard
        ? field("Cartão", "cardLabel", draft.cardLabel, "text", "Nubank, Neon ou outro")
        : "",
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

function field(labelText, key, value, mode, placeholder = "") {
  const input = el(key === "note" ? "textarea" : "input", {
    id: key,
    name: key,
    value,
    placeholder,
    inputmode: mode === "decimal" ? "decimal" : mode === "numeric" ? "numeric" : "text",
  });
  input.addEventListener("input", () => {
    state.sheet[key] = input.value;
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
      if (key === "payment" && value === "card" && !state.sheet.cardLabel) state.sheet.cardLabel = "Nubank";
      render();
    },
  }, label)));
}

async function saveSheet(event) {
  event.preventDefault();
  const draft = state.sheet;
  state.busy = true;
  state.error = "";
  try {
    if (draft.mode === "income") {
      const incomeCents = parseMoney(draft.amount);
      if (incomeCents === null) throw new Error("Informe a receita. Exemplo: 9800,00");
      state.data = await request(`/api/months/${state.monthId}`, { method: "PATCH", body: { incomeCents } });
    } else if (draft.mode === "pin") {
      await request("/api/pin", { method: "POST", body: { currentPin: draft.current, nextPin: draft.next } });
    } else {
      const amountCents = parseMoney(draft.amount || "0");
      if (!draft.name.trim()) throw new Error("Dê um nome ao gasto.");
      if (amountCents === null) throw new Error("Informe o valor. Exemplo: 75,90");
      const body = {
        name: draft.name,
        amountCents,
        section: draft.section,
        payment: draft.section === "fixed" && draft.onCard ? "card" : draft.payment,
        onCard: draft.section === "fixed" && draft.onCard,
        cardLabel: draft.cardLabel,
        note: draft.note,
        paid: draft.paid,
      };
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
    state.busy = false;
    render();
  }
}

async function patchExpense(expense, patch) {
  state.error = "";
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
        paid: expense.paid,
        ...patch,
      },
    });
  } catch (error) {
    state.error = messageOf(error);
  }
  render();
}

async function removeExpense() {
  const draft = state.sheet;
  if (!window.confirm(`Excluir “${draft.name}” deste mês?`)) return;
  state.busy = true;
  try {
    state.data = await request(`/api/expenses/${draft.id}`, { method: "DELETE" });
    state.sheet = null;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function settle(mode) {
  state.error = "";
  try {
    state.data = await request(`/api/months/${state.monthId}/settle`, { method: "POST", body: { mode } });
  } catch (error) {
    state.error = messageOf(error);
  }
  render();
}

async function logout() {
  await request("/api/logout", { method: "POST", body: {} });
  state.authed = false;
  state.data = null;
  render();
}

function closeSheet() {
  state.sheet = null;
  state.error = "";
  render();
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
  if (response.status === 401 && path !== "/api/login" && path !== "/api/setup") {
    state.authed = false;
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
    else if (key === "onclick") node.addEventListener("click", value);
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
