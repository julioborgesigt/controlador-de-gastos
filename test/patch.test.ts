import assert from "node:assert/strict";
import test from "node:test";

class MiniNode {
  nodeType: number;
  parentNode: MiniElement | null = null;
  constructor(nodeType: number) {
    this.nodeType = nodeType;
  }
  remove() {
    if (!this.parentNode) return;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
    this.parentNode = null;
  }
  replaceWith(next: MiniNode) {
    if (!this.parentNode) return;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx >= 0) {
      if (next.parentNode) next.remove();
      next.parentNode = this.parentNode;
      this.parentNode.childNodes[idx] = next;
      this.parentNode = null;
    }
  }
}

class MiniText extends MiniNode {
  nodeValue: string;
  constructor(value: string) {
    super(3);
    this.nodeValue = value;
  }
}

type Listener = (event: { type: string; target: MiniElement; currentTarget: MiniElement }) => void;

class MiniElement extends MiniNode {
  tagName: string;
  namespaceURI: string;
  childNodes: MiniNode[] = [];
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<Listener>>();
  value = "";
  checked = false;
  selected = false;
  disabled = false;
  type = "";

  constructor(tag: string, ns = "http://www.w3.org/1999/xhtml") {
    super(1);
    this.tagName = tag.toUpperCase();
    this.namespaceURI = ns;
  }
  get attributes() {
    return [...this.attrs.entries()].map(([name, value]) => ({ name, value }));
  }
  get className() {
    return this.attrs.get("class") ?? "";
  }
  set className(value: string) {
    this.attrs.set("class", String(value));
  }
  get htmlFor() {
    return this.attrs.get("for") ?? "";
  }
  set htmlFor(value: string) {
    this.attrs.set("for", String(value));
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
  setAttribute(name: string, value: string) {
    const str = String(value);
    this.attrs.set(name, str);
    if (name === "type") this.type = str;
    if (name === "value") this.value = str;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  append(...items: Array<MiniNode | string>) {
    for (const item of items) {
      const node = item instanceof MiniNode ? item : new MiniText(String(item));
      if (node.parentNode) node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  insertBefore(node: MiniNode, ref: MiniNode | null) {
    if (node.parentNode) node.remove();
    node.parentNode = this;
    if (!ref) {
      this.childNodes.push(node);
      return node;
    }
    const idx = this.childNodes.indexOf(ref);
    if (idx < 0) this.childNodes.push(node);
    else this.childNodes.splice(idx, 0, node);
    return node;
  }
  addEventListener(type: string, handler: Listener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }
  removeEventListener(type: string, handler: Listener) {
    this.listeners.get(type)?.delete(handler);
  }
  dispatch(type: string) {
    for (const handler of [...(this.listeners.get(type) || [])]) {
      handler({ type, target: this, currentTarget: this });
    }
  }
  listenerCount(type: string) {
    return this.listeners.get(type)?.size || 0;
  }
  text() {
    let out = "";
    for (const child of this.childNodes) {
      if (child instanceof MiniText) out += child.nodeValue;
      else if (child instanceof MiniElement) out += child.text();
    }
    return out;
  }
}

async function withMiniDom<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const keys = ["Node", "document", "window", "localStorage", "sessionStorage"] as const;
  const prev = Object.fromEntries(keys.map((key) => [key, g[key]]));
  const noop = () => {};
  g.Node = MiniNode;
  g.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  g.sessionStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  g.window = { matchMedia: () => ({ matches: false, addEventListener: noop }) };
  g.document = {
    documentElement: new MiniElement("html"),
    querySelector: () => null,
    createElement: (tag: string) => new MiniElement(tag),
    createElementNS: (ns: string, tag: string) => new MiniElement(tag, ns),
    createTextNode: (text: string) => new MiniText(text),
  };
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  }
}

test("patchChildren atualiza texto, atributos e eventos in-place preservando identidade do nó", async () => {
  await withMiniDom(async () => {
    const domPath = "../public/js/dom.js";
    const patchPath = "../public/js/patch.js";
    const { el } = await import(domPath);
    const { patchChildren } = await import(patchPath);

    const root = new MiniElement("div");
    const clicks: string[] = [];
    patchChildren(root, [
      el("button", { class: "primary", "data-state": "a", onclick: () => clicks.push("first") }, "Salvar"),
    ]);

    const firstButton = root.childNodes[0] as MiniElement;
    assert.equal(firstButton.tagName, "BUTTON");
    assert.equal(firstButton.text(), "Salvar");
    assert.equal(firstButton.listenerCount("click"), 1);

    patchChildren(root, [
      el("button", { class: "primary active", onclick: () => clicks.push("second") }, "Salvando..."),
    ]);

    assert.equal(root.childNodes[0], firstButton);
    assert.equal(firstButton.getAttribute("class"), "primary active");
    assert.equal(firstButton.getAttribute("data-state"), null);
    assert.equal(firstButton.text(), "Salvando...");
    assert.equal(firstButton.listenerCount("click"), 1);

    firstButton.dispatch("click");
    assert.deepEqual(clicks, ["second"]);
  });
});

test("patchChildren preserva nós com data-key ao inserir banner acima e reordenar itens", async () => {
  await withMiniDom(async () => {
    const domPath = "../public/js/dom.js";
    const patchPath = "../public/js/patch.js";
    const { el } = await import(domPath);
    const { patchChildren } = await import(patchPath);

    const root = new MiniElement("div");
    patchChildren(root, [
      el("div", { "data-key": "field-a" }, [el("input", { value: "100" })]),
      el("div", { "data-key": "field-b" }, [el("input", { value: "200" })]),
    ]);
    const fieldA = root.childNodes[0] as MiniElement;
    const fieldB = root.childNodes[1] as MiniElement;
    const inputA = fieldA.childNodes[0] as MiniElement;

    // Insere um banner de erro acima e inverte field-b / field-a
    patchChildren(root, [
      el("p", { class: "error", "data-key": "error" }, "Valor inválido"),
      el("div", { "data-key": "field-b" }, [el("input", { value: "250" })]),
      el("div", { "data-key": "field-a" }, [el("input", { value: "150" })]),
    ]);

    assert.equal(root.childNodes.length, 3);
    assert.equal((root.childNodes[0] as MiniElement).tagName, "P");
    assert.equal(root.childNodes[1], fieldB);
    assert.equal(root.childNodes[2], fieldA);
    assert.equal(fieldA.childNodes[0], inputA);
    assert.equal(inputA.value, "150");
  });
});

test("patchChildren sincroniza <select>, checkbox e respeita data-patch-replace=1", async () => {
  await withMiniDom(async () => {
    const domPath = "../public/js/dom.js";
    const patchPath = "../public/js/patch.js";
    const { el, on } = await import(domPath);
    const { patchChildren } = await import(patchPath);

    const root = new MiniElement("div");
    const observed: string[] = [];

    const buildSelect = (selected: string, tag: string) => {
      const sel = el("select", { "data-key": "card" }, [
        el("option", { value: "nubank" }, "Nubank"),
        el("option", { value: "inter" }, "Inter"),
      ]);
      sel.value = selected;
      on(sel, "change", (ev: { currentTarget: MiniElement }) => observed.push(`${tag}:${ev.currentTarget.value}`));
      return sel;
    };

    patchChildren(root, [
      buildSelect("nubank", "v1"),
      el("input", { type: "checkbox", checked: false, "data-key": "flag" }),
      el("div", { class: "swipe", "data-patch-replace": "1" }, "Item 1"),
    ]);

    const selNode = root.childNodes[0] as MiniElement;
    const checkNode = root.childNodes[1] as MiniElement;
    const swipeNode = root.childNodes[2] as MiniElement;

    assert.equal(selNode.value, "nubank");
    assert.equal(checkNode.checked, false);

    patchChildren(root, [
      buildSelect("inter", "v2"),
      el("input", { type: "checkbox", checked: true, "data-key": "flag" }),
      el("div", { class: "swipe", "data-patch-replace": "1" }, "Item 1 atualizado"),
    ]);

    assert.equal(root.childNodes[0], selNode);
    assert.equal(selNode.value, "inter");
    selNode.dispatch("change");
    assert.deepEqual(observed, ["v2:inter"]);

    assert.equal(root.childNodes[1], checkNode);
    assert.equal(checkNode.checked, true);

    assert.notEqual(root.childNodes[2], swipeNode);
    assert.equal((root.childNodes[2] as MiniElement).text(), "Item 1 atualizado");
  });
});
