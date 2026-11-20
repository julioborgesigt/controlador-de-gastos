import { syncEvents } from "./dom.js";

function nodeKey(node) {
  if (!node || node.nodeType !== 1) return "";
  return node.getAttribute("data-key") || node.getAttribute("id") || "";
}

function shouldReplace(existing, next) {
  if (existing.nodeType !== next.nodeType) return true;
  if (existing.nodeType !== 1) return false;
  if (existing.tagName !== next.tagName) return true;
  if (existing.namespaceURI !== next.namespaceURI) return true;
  if (existing.getAttribute("data-patch-replace") === "1" || next.getAttribute("data-patch-replace") === "1") return true;
  const existingKey = nodeKey(existing);
  const nextKey = nodeKey(next);
  if (existingKey !== nextKey) return true;
  return false;
}

function syncStyle(target, source) {
  if (!target.style || !source.style || typeof source.style.length !== "number") return;
  const nextProps = new Set();
  for (let i = 0; i < source.style.length; i += 1) {
    const prop = source.style[i];
    nextProps.add(prop);
    const val = source.style.getPropertyValue(prop);
    const prio = source.style.getPropertyPriority(prop);
    if (target.style.getPropertyValue(prop) !== val || target.style.getPropertyPriority(prop) !== prio) {
      target.style.setProperty(prop, val, prio);
    }
  }
  for (let i = target.style.length - 1; i >= 0; i -= 1) {
    const prop = target.style[i];
    if (!nextProps.has(prop)) target.style.removeProperty(prop);
  }
}

function syncAttributes(target, source) {
  const nextNames = new Set();
  for (const attr of [...source.attributes]) {
    if (attr.name === "style") continue;
    nextNames.add(attr.name);
    if (target.getAttribute(attr.name) !== attr.value) {
      target.setAttribute(attr.name, attr.value);
    }
  }
  for (const attr of [...target.attributes]) {
    if (attr.name === "style") continue;
    if (!nextNames.has(attr.name)) {
      target.removeAttribute(attr.name);
    }
  }
  syncStyle(target, source);
}

function syncFormProperties(target, source) {
  const tag = target.tagName;
  if (tag === "INPUT") {
    if (target.type === "checkbox" || target.type === "radio") {
      if (target.checked !== source.checked) target.checked = source.checked;
    }
    if (target.value !== source.value) target.value = source.value;
    if (target.disabled !== source.disabled) target.disabled = source.disabled;
  } else if (tag === "TEXTAREA") {
    if (target.value !== source.value) target.value = source.value;
    if (target.disabled !== source.disabled) target.disabled = source.disabled;
  } else if (tag === "OPTION") {
    if (target.selected !== source.selected) target.selected = source.selected;
    if (target.value !== source.value) target.value = source.value;
    if (target.disabled !== source.disabled) target.disabled = source.disabled;
  } else if (tag === "BUTTON") {
    if (target.disabled !== source.disabled) target.disabled = source.disabled;
  }
}

export function patchNode(existing, next) {
  if (existing === next) return existing;
  if (existing.nodeType === 3 && next.nodeType === 3) {
    if (existing.nodeValue !== next.nodeValue) existing.nodeValue = next.nodeValue;
    return existing;
  }
  if (shouldReplace(existing, next)) {
    existing.replaceWith(next);
    return next;
  }
  if (existing.nodeType !== 1) return existing;

  syncAttributes(existing, next);
  syncEvents(existing, next);

  if (existing.tagName === "SELECT") {
    patchChildren(existing, [...next.childNodes]);
    if (existing.value !== next.value) existing.value = next.value;
    if (existing.disabled !== next.disabled) existing.disabled = next.disabled;
    return existing;
  }

  syncFormProperties(existing, next);
  patchChildren(existing, [...next.childNodes]);
  return existing;
}

export function patchChildren(parent, rawNext) {
  const nextList = [];
  for (const item of rawNext) {
    if (item === null || item === undefined || item === false || item === "") continue;
    nextList.push(item instanceof Node ? item : document.createTextNode(String(item)));
  }

  const keyedExisting = new Map();
  for (const child of [...parent.childNodes]) {
    const key = nodeKey(child);
    if (key) keyedExisting.set(key, child);
  }

  let index = 0;
  for (const next of nextList) {
    const current = parent.childNodes[index];
    const key = nodeKey(next);

    if (key && keyedExisting.has(key)) {
      const matched = keyedExisting.get(key);
      keyedExisting.delete(key);
      if (matched !== current) {
        parent.insertBefore(matched, current || null);
      }
      patchNode(matched, next);
      index += 1;
      continue;
    }

    if (!current) {
      parent.append(next);
      index += 1;
      continue;
    }

    const currentKey = nodeKey(current);
    if (currentKey && nextList.slice(index + 1).some((later) => nodeKey(later) === currentKey)) {
      parent.insertBefore(next, current);
      index += 1;
      continue;
    }

    patchNode(current, next);
    index += 1;
  }

  while (parent.childNodes.length > nextList.length) {
    parent.lastChild.remove();
  }
}
