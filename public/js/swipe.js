import { desktopMedia, el, onDesktop } from "./dom.js";
import { closeSheet } from "./sheets/openers.js";
import { render, state } from "./state.js";

let openSwipe = null;

let ignoreSwipeClickUntil = 0;

export function isIgnoringSwipeClick() {
  return Date.now() < ignoreSwipeClickUntil;
}

function syncSwipeDirection(front, x) {
  const shell = front?.parentElement;
  if (!shell) return;
  shell.classList.toggle("swipe-right", x > 0);
  shell.classList.toggle("swipe-left", x < 0);
}

function closeSwipe(front) {
  if (!front) return;
  front.classList.remove("dragging");
  front.style.transform = "";
  front.dataset.x = "0";
  syncSwipeDirection(front, 0);
  if (openSwipe === front) openSwipe = null;
}

function placeSwipe(front, x) {
  front.style.transform = x ? `translateX(${x}px)` : "";
  front.dataset.x = String(x);
  syncSwipeDirection(front, x);
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

export function swipeRow(front, { pay, leads, actions, card }) {
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
    if (!(actions || []).length) return 0;
    return trail.getBoundingClientRect().width || (actions || []).length * 88;
  }

  function widthOfLead() {
    if (!leadActions.length) return 0;
    return leadBox.getBoundingClientRect().width || leadActions.length * 88;
  }

  function moveTo(x) {
    const next = Math.max(-widthOfTrail(), Math.min(widthOfLead(), x));
    front.style.transform = `translateX(${next}px)`;
    front.dataset.x = String(next);
    syncSwipeDirection(front, next);
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

export function attachSheetDrag(panel) {
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

export function initSwipeListeners() {
  desktopMedia.addEventListener("change", () => {
    if (openSwipe) closeSwipe(openSwipe);
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.accountMenu) return;
    event.preventDefault();
    state.accountMenu = false;
    render();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!openSwipe) return;
    const shellEl = openSwipe.closest(".swipe-row");
    if (shellEl && shellEl.contains(event.target)) return;
    closeSwipe(openSwipe);
  });
}
