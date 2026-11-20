import { closeConfirm } from "./dialogs/confirm.js";
import { closeExpenseInfo } from "./dialogs/expense-info.js";
import { closeCostDetail } from "./dialogs/info.js";
import { closeSheet } from "./sheets/openers.js";
import {
  closeTabIntro,
  liveRegion,
  render,
  root,
  state,
} from "./state.js";

let overlayPushed = false;

let suppressHistory = false;

let allowLeave = false;

let lastAnnouncement = "";

let lastModalKey = "";

let modalTriggerSnapshot = null;

let sheetGuardBound = false;

let sheetTouchY = 0;

export function announceLive(message) {
  if (!liveRegion) return;
  const text = String(message || "").trim();
  if (!text) {
    lastAnnouncement = "";
    liveRegion.textContent = "";
    return;
  }
  if (text === lastAnnouncement) return;
  lastAnnouncement = text;
  liveRegion.textContent = "";
  queueMicrotask(() => {
    if (liveRegion && lastAnnouncement === text) liveRegion.textContent = text;
  });
}

function activeModalKey() {
  if (state.confirm) return `confirm:${typeof state.confirm === "string" ? state.confirm : "custom"}`;
  if (state.tabIntro) return `tabIntro:${state.tabIntro}`;
  if (state.costDetail) return `costDetail:${state.costDetail.id || ""}`;
  if (state.help) return `help:${state.help.title || ""}`;
  if (state.expenseInfo) return `expenseInfo:${state.expenseInfo.id || ""}`;
  if (state.sheet) return `sheet:${state.sheet.mode || ""}`;
  return "";
}

function topmostModal() {
  const modals = root.querySelectorAll(".dialog, .sheet");
  return modals.length ? modals[modals.length - 1] : null;
}

function focusableIn(container) {
  if (!container) return [];
  const selector = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...container.querySelectorAll(selector)].filter(
    (node) => node instanceof HTMLElement && (node.offsetParent !== null || node.getClientRects().length > 0),
  );
}

function escapeAttr(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

export function captureFocusSnapshot() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
  let selectionStart = null;
  let selectionEnd = null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    try {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    } catch {
      /* tipos como date/number não expõem seleção */
    }
  }
  return {
    inModal: Boolean(active.closest(".dialog, .sheet")),
    id: active.id || "",
    segment: active.getAttribute("data-segment") || "",
    value: active.getAttribute("data-value") || "",
    name: active.getAttribute("name") || "",
    tag: active.tagName.toLowerCase(),
    inputValue: active instanceof HTMLInputElement && (active.type === "radio" || active.type === "checkbox") ? active.value : "",
    ariaLabel: active.getAttribute("aria-label") || "",
    text: active.tagName === "BUTTON" ? active.textContent.trim() : "",
    className: typeof active.className === "string" ? active.className.trim() : "",
    selectionStart,
    selectionEnd,
  };
}

function resolveFocusSnapshot(snapshot, scope) {
  if (!snapshot || !scope) return null;
  if (snapshot.id) {
    const byId = scope.querySelector(`#${escapeAttr(snapshot.id)}`);
    if (byId instanceof HTMLElement) return byId;
  }
  if (snapshot.segment && snapshot.value) {
    const bySeg = scope.querySelector(
      `[data-segment="${escapeAttr(snapshot.segment)}"][data-value="${escapeAttr(snapshot.value)}"]`,
    );
    if (bySeg instanceof HTMLElement) return bySeg;
  }
  if (snapshot.name) {
    const selector = snapshot.inputValue
      ? `${snapshot.tag}[name="${escapeAttr(snapshot.name)}"][value="${escapeAttr(snapshot.inputValue)}"]`
      : `${snapshot.tag}[name="${escapeAttr(snapshot.name)}"]`;
    const byName = scope.querySelector(selector);
    if (byName instanceof HTMLElement) return byName;
  }
  if (snapshot.ariaLabel) {
    const byLabel = scope.querySelector(`${snapshot.tag}[aria-label="${escapeAttr(snapshot.ariaLabel)}"]`);
    if (byLabel instanceof HTMLElement) return byLabel;
  }
  if (snapshot.tag === "button" && snapshot.text) {
    const buttons = [...scope.querySelectorAll("button")];
    const exact = buttons.find((btn) => btn.textContent.trim() === snapshot.text && btn.className.trim() === snapshot.className);
    if (exact instanceof HTMLElement) return exact;
    const byText = buttons.find((btn) => btn.textContent.trim() === snapshot.text);
    if (byText instanceof HTMLElement) return byText;
  }
  return null;
}

function focusElement(target, snapshot = null) {
  if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return false;
  target.focus({ preventScroll: true });
  if (
    snapshot
    && snapshot.selectionStart !== null
    && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  ) {
    try {
      target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd ?? snapshot.selectionStart);
    } catch {
      /* ignora tipos sem setSelectionRange */
    }
  }
  return true;
}

export function applyFocusAfterRender(focusBefore, allowModal = true) {
  const nextModalKey = allowModal ? activeModalKey() : "";
  const modal = allowModal ? topmostModal() : null;
  if (!lastModalKey && nextModalKey) {
    if (focusBefore && !focusBefore.inModal) modalTriggerSnapshot = focusBefore;
    if (modal instanceof HTMLElement) modal.focus({ preventScroll: true });
  } else if (lastModalKey && !nextModalKey) {
    const trigger = modalTriggerSnapshot;
    modalTriggerSnapshot = null;
    if (trigger) focusElement(resolveFocusSnapshot(trigger, root));
  } else if (lastModalKey !== nextModalKey) {
    if (modal instanceof HTMLElement) modal.focus({ preventScroll: true });
  } else if (focusBefore) {
    const scope = nextModalKey && modal ? modal : root;
    const restored = resolveFocusSnapshot(focusBefore, scope);
    if (restored) focusElement(restored, focusBefore);
    else if (nextModalKey && modal instanceof HTMLElement) modal.focus({ preventScroll: true });
  }
  lastModalKey = nextModalKey;
}

function overlayIsOpen() {
  return Boolean(state.sheet || state.confirm || state.accountMenu || state.expenseInfo || state.help || state.costDetail || state.tabIntro);
}

export function syncOverlayHistory() {
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

export function leavePage() {
  allowLeave = true;
  const steps = (history.state?.overlay ? 1 : 0) + 2;
  state.confirm = null;
  state.expenseInfo = null;
  state.help = null;
  state.costDetail = null;
  state.tabIntro = null;
  state.sheet = null;
  state.accountMenu = false;
  overlayPushed = false;
  suppressHistory = true;
  history.go(-Math.min(history.length, steps));
}

export function lockPage(scrollY) {
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

export function unlockPage(scrollY = Number(document.body.dataset.scrollLock || 0)) {
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

function overlayScroller(target) {
  return target?.closest?.(".sheet, .dialog") || null;
}

function blockBackgroundScroll(event) {
  if (!document.body.classList.contains("sheet-open")) return;
  const scroller = overlayScroller(event.target);
  const y = event.touches[0]?.clientY ?? sheetTouchY;
  const dy = y - sheetTouchY;
  sheetTouchY = y;
  if (!scroller || !sheetCanScroll(scroller, dy)) event.preventDefault();
}

function blockBackgroundWheel(event) {
  if (!document.body.classList.contains("sheet-open")) return;
  const scroller = overlayScroller(event.target);
  if (!scroller || !sheetCanScroll(scroller, -event.deltaY)) event.preventDefault();
}

function blockBackgroundKeys(event) {
  if (!document.body.classList.contains("sheet-open")) return;
  if (event.key === "Tab") {
    const modal = topmostModal();
    if (!modal) return;
    const items = focusableIn(modal);
    if (!items.length) {
      event.preventDefault();
      if (modal instanceof HTMLElement) modal.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === modal || !modal.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !modal.contains(active)) {
      event.preventDefault();
      first.focus();
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.confirm) closeConfirm();
    else if (state.tabIntro) closeTabIntro(false);
    else if (state.costDetail) closeCostDetail();
    else if (state.help) {
      state.help = null;
      render();
    } else if (state.expenseInfo) closeExpenseInfo();
    else if (state.sheet) closeSheet();
    return;
  }
  if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
  if (event.target.closest?.("input, textarea, select")) return;
  const scroller = overlayScroller(event.target);
  const dy = event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" ? 1 : -1;
  if (!scroller || !sheetCanScroll(scroller, dy)) event.preventDefault();
}

function sheetCanScroll(sheet, dy) {
  if (sheet.scrollHeight - sheet.clientHeight <= 1) return false;
  if (dy > 0 && sheet.scrollTop <= 0) return false;
  if (dy < 0 && sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 1) return false;
  return true;
}

export function centerMonthChip() {
  const chip = document.querySelector(".chip.active");
  const scroller = chip?.parentElement;
  if (!chip || !scroller) return;
  const left = chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2;
  scroller.scrollTo({ left: Math.max(0, left) });
}

export function initHistoryListeners() {
  window.addEventListener("popstate", () => {
    if (allowLeave) {
      suppressHistory = false;
      overlayPushed = false;
      state.confirm = null;
      state.expenseInfo = null;
      state.help = null;
      state.costDetail = null;
      state.tabIntro = null;
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
      else if (state.tabIntro) state.tabIntro = null;
      else if (state.costDetail) state.costDetail = null;
      else if (state.help) state.help = null;
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
}
