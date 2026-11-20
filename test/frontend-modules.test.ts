import assert from "node:assert/strict";
import test from "node:test";

test("grafo de módulos ES do frontend carrega e inicializa sem erros de importação ou TDZ", async () => {
  const noop = () => {};
  class FakeNode {
    nodeType: number;
    parentNode: FakeElement | null = null;
    constructor(nodeType: number) {
      this.nodeType = nodeType;
    }
    remove() {
      if (!this.parentNode) return;
      const idx = this.parentNode.childNodes.indexOf(this);
      if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
      this.parentNode = null;
    }
    replaceWith(next: FakeNode) {
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
  class FakeText extends FakeNode {
    nodeValue: string;
    constructor(text: string) {
      super(3);
      this.nodeValue = text;
    }
    get textContent() {
      return this.nodeValue;
    }
    set textContent(value: string) {
      this.nodeValue = String(value);
    }
  }
  class FakeElement extends FakeNode {
    tagName: string;
    namespaceURI: string;
    childNodes: FakeNode[] = [];
    private attrs = new Map<string, string>();
    style = { setProperty: noop };
    dataset: Record<string, string> = {};
    value = "";
    checked = false;
    selected = false;
    disabled = false;
    type = "";
    textContent = "";
    scrollTop = 0;
    classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
    constructor(tag = "div", ns = "http://www.w3.org/1999/xhtml") {
      super(1);
      this.tagName = tag.toUpperCase();
      this.namespaceURI = ns;
    }
    get attributes() {
      return [...this.attrs.entries()].map(([name, value]) => ({ name, value }));
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null;
    }
    setAttribute(name: string, value: string) {
      this.attrs.set(name, String(value));
    }
    removeAttribute(name: string) {
      this.attrs.delete(name);
    }
    getAttribute(name: string) {
      return this.attrs.get(name) ?? null;
    }
    append(...nodes: Array<FakeNode | string>) {
      for (const item of nodes) {
        const node = item instanceof FakeNode ? item : new FakeText(String(item));
        if (node.parentNode) node.remove();
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
    insertBefore(node: FakeNode, ref: FakeNode | null) {
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
    replaceChildren(...nodes: Array<FakeNode | string>) {
      for (const child of [...this.childNodes]) child.remove();
      this.append(...nodes);
    }
    addEventListener = noop;
    removeEventListener = noop;
    querySelector = () => null;
    querySelectorAll = () => [];
    closest = () => null;
    contains = () => false;
    focus = noop;
    scrollTo = noop;
    getClientRects = () => [];
  }

  const appRoot = new FakeElement("div");
  const liveEl = new FakeElement("div");
  const g = globalThis as Record<string, unknown>;
  const keys = [
    "Node",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "CSS",
    "localStorage",
    "sessionStorage",
    "history",
    "location",
    "document",
    "window",
    "fetch",
  ] as const;
  const prev = Object.fromEntries(keys.map((key) => [key, g[key]]));
  let sessionFetched = false;
  try {
    g.Node = FakeNode;
    g.HTMLElement = FakeElement;
    g.HTMLInputElement = class {};
    g.HTMLTextAreaElement = class {};
    g.CSS = { escape: (s: string) => String(s) };
    g.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
    g.sessionStorage = { getItem: () => null, setItem: noop, removeItem: noop };
    g.history = { state: null, length: 1, pushState: noop, back: noop, go: noop };
    g.location = { pathname: "/", href: "https://gastos.example.test/" };
    g.document = {
      documentElement: new FakeElement("html"),
      body: new FakeElement("body"),
      activeElement: null,
      querySelector: (sel: string) => (sel === "#app" ? appRoot : sel === "#live-region" ? liveEl : null),
      querySelectorAll: () => [],
      createElement: (tag: string) => new FakeElement(tag),
      createElementNS: (ns: string, tag: string) => new FakeElement(tag, ns),
      createTextNode: (t: string) => new FakeText(t),
      addEventListener: noop,
      removeEventListener: noop,
    };
    g.window = {
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      addEventListener: noop,
      scrollTo: noop,
      scrollY: 0,
      innerWidth: 390,
      PublicKeyCredential: undefined,
    };
    g.fetch = async (url: string) => {
      if (String(url).includes("/api/session")) sessionFetched = true;
      return new Response(JSON.stringify({ needsSetup: false, authenticated: false, theme: "light" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    // Importa o entrypoint real do navegador para validar todo o grafo de módulos ES
    const entrypoint = "../public/app.js";
    await import(entrypoint);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(sessionFetched, true);
    assert.equal(appRoot.childNodes.length, 1);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  }
});
