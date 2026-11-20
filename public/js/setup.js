import { parseMoney } from "../format.js";
import { logout } from "./account.js";
import { clearMonthCache, rememberMonth, request } from "./api.js";
import { offerDevice, rememberDevicePrompt } from "./auth.js";
import { pulseResetConfirm } from "./dialogs/confirm.js";
import {
  MONTH_NAMES,
  applyTheme,
  el,
  messageOf,
  onDesktop,
} from "./dom.js";
import { render, renderSafely, setWorking, state } from "./state.js";
import { cardClosingDay, cardDueDay } from "./views/card-helpers.js";

export function defaultPeriodDraft() {
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

export function periodSelect(draft, key, label, values, labels) {
  const select = el("select", { id: key }, values.map((value, index) => el("option", { value }, labels[index])));
  select.value = draft[key];
  select.addEventListener("change", () => {
    draft[key] = select.value;
  });
  return el("div", { class: "field" }, [el("label", { for: key }, label), select]);
}

export function periodFields(draft) {
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

function ensureSetup() {
  if (!state.setup) {
    const period = defaultPeriodDraft();
    state.setup = {
      step: 0,
      ...period,
      hasCards: "no",
      cards: [{ name: "", dueDay: "10", closingDay: "1" }],
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

export function periodGate() {
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
    "Se usar, cadastre cada um com um apelido, o dia de fechamento e o dia de vencimento.",
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
        body.push(setupInput(`card-name-${index}`, "Apelido", card.name, (value) => { card.name = value; }, "Nubank, Neon..."));
        body.push(el("div", { class: "pair" }, [
          setupInput(`card-close-${index}`, "Fechamento", card.closingDay, (value) => { card.closingDay = value; }, "1", "numeric"),
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
          onclick: () => { draft.cards.push({ name: "", dueDay: "10", closingDay: "1" }); render(); },
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
        class: "secondary",
        type: "button",
        onclick: () => { state.error = ""; rememberDevicePrompt(); saveSetup(draft); },
      }, "Agora não") : "",
      draft.step === 4 ? el("button", {
        class: "primary",
        type: "button",
        disabled: state.busy ? "" : null,
        onclick: () => offerDevice(() => { rememberDevicePrompt(); saveSetup(draft); }),
      }, state.busy ? "Aguardando..." : "Cadastrar digital") : "",
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
        cardClosingDay(card.closingDay);
        if (!String(card.dueDay || "").trim()) throw new Error("Informe o dia de vencimento, de 1 a 31.");
        if (!String(card.closingDay || "").trim()) throw new Error("Informe o dia de fechamento, de 1 a 31.");
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
        await request("/api/cards", { method: "POST", body: { name: card.name.trim(), dueDay: cardDueDay(card.dueDay), closingDay: cardClosingDay(card.closingDay) } });
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
      ? "A fatura de cada cartão. O gasto no crédito nasce aqui e segue para a aba da classificação."
      : "A fatura de cada cartão. O gasto no crédito nasce aqui e segue para a aba da classificação."],
    ["À vista", "O pagamento no Pix nasce aqui, ligado a um custo de vida ou criando um imprevisto ou planejado."],
    ["Custo de vida", "Mostra o previsto, o que já foi pago no cartão e no Pix, e o que ainda falta em cada um. O pagamento é feito em Cartões de crédito ou À vista."],
    ["Outros gastos", "Consulta dos imprevistos e planejados. O gasto novo entra por Cartões de crédito ou À vista."],
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

export function openPeriod() {
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

export function openReset() {
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

export async function savePeriod(draft, first) {
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

export function askReset() {
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

export async function executeReset() {
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

export async function settle(mode) {
  state.error = "";
  setWorking(true, "Atualizando...");
  try {
    state.data = await request(`/api/months/${state.monthId}/settle`, { method: "POST", body: { mode } });
    rememberMonth(state.data);
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}
