import assert from "node:assert/strict";
import test from "node:test";

test("grafo de módulos ES do frontend carrega e inicializa sem erros de importação ou TDZ", async () => {
  const noop = () => {};
  const makeEl = (tag = "div") => ({
    tagName: tag.toUpperCase(),
    style: { setProperty: noop },
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => "",
    append: noop,
    replaceChildren: noop,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    focus: noop,
    scrollTo: noop,
    getClientRects: () => [],
  });
  const appRoot = makeEl("div");
  const liveEl = makeEl("div");
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
    g.Node = class {};
    g.HTMLElement = class {};
    g.HTMLInputElement = class {};
    g.HTMLTextAreaElement = class {};
    g.CSS = { escape: (s: string) => String(s) };
    g.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
    g.sessionStorage = { getItem: () => null, setItem: noop, removeItem: noop };
    g.history = { state: null, length: 1, pushState: noop, back: noop, go: noop };
    g.location = { pathname: "/", href: "https://gastos.example.test/" };
    g.document = {
      documentElement: makeEl("html"),
      body: makeEl("body"),
      activeElement: null,
      querySelector: (sel: string) => (sel === "#app" ? appRoot : sel === "#live-region" ? liveEl : null),
      querySelectorAll: () => [],
      createElement: (tag: string) => makeEl(tag),
      createElementNS: (_ns: string, tag: string) => makeEl(tag),
      createTextNode: (t: string) => ({ textContent: t }),
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
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  }
});
