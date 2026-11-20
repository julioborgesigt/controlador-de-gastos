import { nextMonthId } from "../format.js";
import { applyTheme, currentMonthId, messageOf } from "./dom.js";
import { livingCostsForInvoice, matchesLink, paintLivingLinks } from "./sheets/openers.js";
import {
  monthLoads,
  monthStore,
  render,
  renderSafely,
  setWorking,
  state,
} from "./state.js";

export async function request(path, options = {}) {
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

export function storeMonth(data) {
  if (!data?.month?.id) return;
  monthStore.set(data.month.id, data);
}

function fetchMonth(monthId) {
  const current = monthLoads.get(monthId);
  if (current) return current;
  const pending = request(`/api/months/${monthId}`).then((data) => {
    storeMonth(data);
    return data;
  }).finally(() => {
    if (monthLoads.get(monthId) === pending) monthLoads.delete(monthId);
  });
  monthLoads.set(monthId, pending);
  return pending;
}

export async function preloadAround(data) {
  const focus = data?.month?.id;
  if (!focus) return;
  const months = data.months || [];
  const index = months.findIndex((month) => month.id === focus);
  const ids = [];
  if (index > 0) ids.push(months[index - 1].id);
  if (index >= 0 && index < months.length - 1) ids.push(months[index + 1].id);
  await Promise.all(ids.map((id) => fetchMonth(id).catch(() => null)));
  if (state.monthId !== focus) return;
  const next = index >= 0 && index < months.length - 1 ? months[index + 1].id : "";
  if (next && monthStore.has(next)) {
    state.nextInvoices = monthStore.get(next);
    state.nextInvoicesFor = focus;
    state.nextInvoicesLoading = "";
  }
  if (ids.length) renderSafely();
}

export function rememberMonth(data, { keepOthers = false, preload = true } = {}) {
  state.nextInvoicesFor = "";
  state.nextInvoices = null;
  state.purchasesMonthId = "";
  state.purchases = null;
  state.offline = false;
  if (!keepOthers) monthStore.clear();
  storeMonth(data);
  const serialized = JSON.stringify({ data });
  try {
    sessionStorage.setItem("monthCache:v1", serialized);
  } catch {
    sessionStorage.removeItem("monthCache:v1");
  }
  try {
    localStorage.setItem("monthOffline:v1", serialized);
  } catch {
    localStorage.removeItem("monthOffline:v1");
  }
  if (preload) void preloadAround(data);
}

export function readMonthCache(monthId) {
  for (const [storage, key] of [[sessionStorage, "monthCache:v1"], [localStorage, "monthOffline:v1"]]) {
    try {
      const parsed = JSON.parse(storage.getItem(key) || "");
      const data = parsed?.data;
      if (!data?.month?.id || !Array.isArray(data.months) || !Array.isArray(data.expenses)) continue;
      if (monthId && data.month.id !== monthId) continue;
      return data;
    } catch {
      /* ignore invalid cache */
    }
  }
  return null;
}

export function clearMonthCache() {
  monthStore.clear();
  state.overview = null;
  sessionStorage.removeItem("monthCache:v1");
  localStorage.removeItem("monthOffline:v1");
}

let overviewSeq = 0;

export async function loadOverview(filter = state.overviewFilter) {
  const seq = ++overviewSeq;
  const params = new URLSearchParams();
  if (filter?.year) params.set("year", filter.year);
  if (filter?.q) params.set("q", filter.q);
  if (filter?.card) params.set("card", filter.card);
  if (filter?.track) params.set("track", filter.track);
  state.overviewLoading = true;
  state.overviewError = "";
  renderSafely();
  try {
    const query = params.toString();
    const data = await request(`/api/overview${query ? `?${query}` : ""}`);
    if (seq !== overviewSeq) return;
    state.overview = data;
    state.overviewError = "";
  } catch (error) {
    if (seq !== overviewSeq) return;
    state.overviewError = messageOf(error);
  } finally {
    if (seq === overviewSeq) {
      state.overviewLoading = false;
      renderSafely();
    }
  }
}

export async function downloadExport(format, scope = "all") {
  state.error = "";
  state.notice = "";
  const params = new URLSearchParams({ format: format === "csv" ? "csv" : "json" });
  if (scope === "month" && state.monthId) params.set("monthId", state.monthId);
  setWorking(true, format === "csv" ? "Gerando CSV..." : "Gerando backup...");
  try {
    const response = await fetch(`/api/export?${params.toString()}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Não foi possível exportar os dados.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] || `gastos-backup.${format === "csv" ? "csv" : "json"}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.notice = format === "csv" ? "Planilha CSV baixada." : "Backup JSON baixado.";
    state.sheet = null;
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
    renderSafely();
  }
}

export async function loadMonth(monthId) {
  let id = monthId || state.monthId;
  if (!id) {
    const period = await request("/api/period");
    id = period.startMonthId || "";
  }
  if (!id) throw new Error("Defina o período para abrir o mês.");
  let data;
  try {
    data = await fetchMonth(id);
  } catch (error) {
    if (error.status !== 404) throw error;
    const period = await request("/api/period").catch(() => null);
    const fallback = period?.startMonthId && period.startMonthId !== id ? period.startMonthId : "";
    if (!fallback) throw error;
    data = await fetchMonth(fallback);
  }
  if (!monthId && !sessionStorage.getItem("monthId")) {
    const today = currentMonthId();
    if (today !== data.month.id && data.months.some((month) => month.id === today)) {
      data = await fetchMonth(today);
    }
  }
  state.data = data;
  if (data.theme) applyTheme(data.theme);
  state.monthId = data.month.id;
  try { sessionStorage.setItem("monthId", data.month.id); } catch { /* o mês segue só nesta aba */ }
  rememberMonth(data, { keepOthers: true, preload: false });
  await preloadAround(data);
}

export async function changeMonth(monthId) {
  if (monthId === state.monthId) return;
  const cached = monthStore.get(monthId);
  if (cached) {
    state.error = "";
    state.showEmpty = false;
    state.data = cached;
    state.monthId = cached.month.id;
    if (cached.theme) applyTheme(cached.theme);
    try { sessionStorage.setItem("monthId", cached.month.id); } catch { /* o mês segue só nesta aba */ }
    rememberMonth(cached, { keepOthers: true });
    render();
    fetchMonth(monthId).then((data) => {
      if (state.monthId !== monthId) return;
      state.data = data;
      state.monthId = data.month.id;
      if (data.theme) applyTheme(data.theme);
      rememberMonth(data, { keepOthers: true });
      renderSafely();
    }).catch(() => {});
    return;
  }
  if (state.busy) return;
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

export function ensurePurchases(monthId) {
  if (!monthId || state.purchasesLoading === monthId || state.purchasesMonthId === monthId) return;
  state.purchasesLoading = monthId;
  request(`/api/months/${monthId}/purchases`).then((payload) => {
    if (state.monthId !== monthId) return;
    state.purchases = payload;
    state.purchasesMonthId = monthId;
    state.purchasesLoading = "";
    render();
  }).catch((error) => {
    if (state.monthId !== monthId) return;
    state.purchases = { monthId, totalCents: 0, items: [], error: messageOf(error) };
    state.purchasesMonthId = monthId;
    state.purchasesLoading = "";
    render();
  });
}

export function purchasesOf(monthId) {
  if (state.purchasesMonthId === monthId && state.purchases) return state.purchases;
  ensurePurchases(monthId);
  return null;
}

export function ensureNextInvoices(monthId) {
  const next = nextMonthId(monthId);
  const known = (state.data?.months || []).some((month) => month.id === next);
  if (!next || !known) {
    state.nextInvoicesFor = monthId;
    state.nextInvoices = null;
    return;
  }
  if (monthStore.has(next)) {
    state.nextInvoices = monthStore.get(next);
    state.nextInvoicesFor = monthId;
    state.nextInvoicesLoading = "";
    return;
  }
  if (state.nextInvoicesLoading === monthId || state.nextInvoicesFor === monthId) return;
  state.nextInvoicesLoading = monthId;
  fetchMonth(next).then((payload) => {
    if (state.monthId !== monthId) return;
    state.nextInvoices = payload;
    state.nextInvoicesFor = monthId;
    state.nextInvoicesLoading = "";
    render();
  }).catch((error) => {
    if (state.monthId !== monthId) return;
    state.nextInvoices = { error: messageOf(error), expenses: [], month: { id: next } };
    state.nextInvoicesFor = monthId;
    state.nextInvoicesLoading = "";
    render();
  });
}

export function openMonthCard(monthId, cardId) {
  state.cardFocus = cardId;
  if (monthId === state.monthId) {
    render();
    return;
  }
  state.error = "";
  setWorking(true, "Abrindo...");
  loadMonth(monthId).catch((error) => {
    state.error = messageOf(error);
  }).finally(() => {
    setWorking(false);
    renderSafely();
  });
}

function rememberLinkChoices(draft, monthId, expenses) {
  draft.linkMonthId = monthId;
  draft.linkKey = `${monthId}:${draft.expenseKind}`;
  draft.linkChoices = (expenses || []).filter((expense) => matchesLink(expense, draft.expenseKind));
  draft.linkLoading = "";
  draft.linkError = "";
  if (draft.linkExpenseId && !draft.linkChoices.some((expense) => expense.id === draft.linkExpenseId)) draft.linkExpenseId = "";
}

export function linkMonthId(draft) {
  if (draft.mode === "card-spend") return draft.costMonthId || state.monthId;
  return draft.invoiceMonthId;
}

function linkCacheKey(draft, monthId = linkMonthId(draft)) {
  return `${monthId}:${draft.expenseKind || "casa"}`;
}

export function knownLinks(draft) {
  const monthId = linkMonthId(draft);
  if (!monthId || (draft.mode === "card-spend" && draft.expenseKind !== "casa")) return [];
  if (monthId === state.monthId) return livingCostsForInvoice(monthId, draft.expenseKind || "casa");
  if (draft.linkKey === linkCacheKey(draft, monthId) && Array.isArray(draft.linkChoices)) return draft.linkChoices;
  return null;
}

export function ensureLinkChoices(draft) {
  const monthId = linkMonthId(draft);
  if (!monthId || (draft.mode === "card-spend" && draft.expenseKind !== "casa")) return;
  if (monthId === state.monthId) {
    draft.linkLoading = "";
    draft.linkError = "";
    return;
  }
  const cacheKey = linkCacheKey(draft, monthId);
  if (draft.linkKey === cacheKey && Array.isArray(draft.linkChoices)) {
    draft.linkLoading = "";
    return;
  }
  if (draft.linkLoading === cacheKey) return;
  draft.linkLoading = cacheKey;
  draft.linkError = "";
  request(`/api/months/${monthId}`).then((data) => {
    if (!state.sheet || linkMonthId(state.sheet) !== monthId || linkCacheKey(state.sheet, monthId) !== cacheKey) return;
    rememberLinkChoices(state.sheet, monthId, data.expenses || []);
    if (!paintLivingLinks(state.sheet)) renderSafely();
  }).catch((error) => {
    if (!state.sheet || linkMonthId(state.sheet) !== monthId) return;
    state.sheet.linkLoading = "";
    state.sheet.linkKey = cacheKey;
    state.sheet.linkMonthId = monthId;
    state.sheet.linkChoices = [];
    state.sheet.linkError = messageOf(error);
    if (!paintLivingLinks(state.sheet)) renderSafely();
  });
}
