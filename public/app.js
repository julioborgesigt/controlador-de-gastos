import {
  announceLive,
  applyFocusAfterRender,
  captureFocusSnapshot,
  centerMonthChip,
  initHistoryListeners,
  lockPage,
  syncOverlayHistory,
  unlockPage,
} from "./js/a11y.js";
import { accountButton, accountCpf } from "./js/account.js";
import {
  changeMonth,
  clearMonthCache,
  readMonthCache,
  request,
  storeMonth,
} from "./js/api.js";
import { accessScreen, authScreen, devicePromptScreen, openBudget } from "./js/auth.js";
import { confirmDialog } from "./js/dialogs/confirm.js";
import { expenseInfoDialog } from "./js/dialogs/expense-info.js";
import { costDetailDialog, helpDialog, tabIntroDialog } from "./js/dialogs/info.js";
import {
  applyTheme,
  el,
  glyph,
  messageOf,
  onDesktop,
} from "./js/dom.js";
import { periodGate } from "./js/setup.js";
import { sheet } from "./js/sheets/render.js";
import {
  bootMark,
  maybeOpenTabIntro,
  render,
  root,
  setBootProgress,
  setRenderer,
  state,
  views,
} from "./js/state.js";
import { initSwipeListeners } from "./js/swipe.js";
import { cardDetail, cardsHome, purchaseDetail } from "./js/views/cards.js";
import { cashHome } from "./js/views/cash.js";
import { sectionList } from "./js/views/expenses.js";
import { incomeView } from "./js/views/income.js";
import { summary } from "./js/views/summary.js";

let bootGeneration = 0;

export async function boot() {
  const generation = ++bootGeneration;
  const cached = readMonthCache(state.monthId);
  if (cached) {
    state.data = cached;
    state.monthId = cached.month.id;
    storeMonth(cached);
  } else {
    state.data = null;
  }
  state.booting = true;
  setBootProgress(cached ? 0.45 : 0.3);
  render();
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

function renderApp() {
  const focusBefore = captureFocusSnapshot();
  const lockedScroll = document.body.classList.contains("sheet-open")
    ? Number(document.body.dataset.scrollLock || 0)
    : window.scrollY;
  const contentScroll = document.querySelector(".content")?.scrollTop || 0;
  const sheetScroll = document.querySelector(".sheet")?.scrollTop || 0;
  const viewKey = `${state.authed}:${state.monthId}:${state.view}:${state.cardFocus || ""}`;
  const keepPlace = state.viewKey === viewKey;
  root.replaceChildren();
  root.removeAttribute("aria-busy");
  announceLive(state.error || state.notice || "");
  if (state.booting) {
    root.append(bootMark());
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    applyFocusAfterRender(focusBefore, false);
    syncOverlayHistory();
    return;
  }
  if (state.authed && !state.data && !state.needsPeriod && !state.choosing) {
    root.append(bootMark(true));
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    applyFocusAfterRender(focusBefore, false);
    syncOverlayHistory();
    return;
  }
  if (!state.authed) {
    root.append(authScreen());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    applyFocusAfterRender(focusBefore, false);
    syncOverlayHistory();
    return;
  }
  if (state.needsPeriod || state.setupGuide) {
    root.append(periodGate());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    applyFocusAfterRender(focusBefore, false);
    syncOverlayHistory();
    return;
  }
  if (state.devicePrompt) {
    root.append(devicePromptScreen());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    applyFocusAfterRender(focusBefore, false);
    syncOverlayHistory();
    return;
  }
  if (state.choosing) {
    root.append(accessScreen());
    state.viewKey = viewKey;
    if (document.body.classList.contains("sheet-open")) unlockPage(0);
    applyFocusAfterRender(focusBefore, false);
    syncOverlayHistory();
    return;
  }
  root.append(shell());
  if (state.sheet) root.append(sheet());
  const nextSheet = document.querySelector(".sheet");
  if (nextSheet) nextSheet.scrollTop = sheetScroll;
  if (state.expenseInfo) root.append(expenseInfoDialog());
  if (state.help) root.append(helpDialog());
  if (state.costDetail) root.append(costDetailDialog());
  if (state.tabIntro) root.append(tabIntroDialog());
  if (state.confirm) root.append(confirmDialog());
  if (state.sheet || state.confirm || state.expenseInfo || state.help || state.costDetail || state.tabIntro) lockPage(keepPlace ? lockedScroll : 0);
  else unlockPage(keepPlace ? lockedScroll : 0);
  state.viewKey = viewKey;
  if (keepPlace && onDesktop()) {
    const nextContent = document.querySelector(".content");
    if (nextContent) nextContent.scrollTop = contentScroll;
  }
  applyFocusAfterRender(focusBefore, true);
  queueMicrotask(centerMonthChip);
  syncOverlayHistory();
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
        maybeOpenTabIntro(id);
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

function viewBody(data) {
  if (state.view === "resumo") return summary(data);
  if (state.view === "receita") return incomeView(data);
  if (state.view === "cartoes") {
    if (state.cardFocus === "purchases") return purchaseDetail(data);
    return state.cardFocus ? cardDetail(data) : cardsHome(data);
  }
  if (state.view === "avista") return cashHome(data);
  if (state.view === "casa") return sectionList(data, "fixed");
  return sectionList(data, "extra");
}

applyTheme(localStorage.getItem("theme"));
setRenderer(renderApp);
initHistoryListeners();
initSwipeListeners();
boot();
