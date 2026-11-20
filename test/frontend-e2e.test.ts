import assert from "node:assert/strict";
import test from "node:test";

test("acessibilidade e UI: tema escuro, live-region e focus trap de modal funcionam em mobile e desktop", async () => {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  let focusedEl: unknown = null;

  class FakeElement {
    tagName: string;
    attrs: Record<string, string> = {};
    style: Record<string, unknown> = { setProperty: () => {} };
    dataset: Record<string, string> = {};
    children: FakeElement[] = [];
    parentElement: FakeElement | null = null;
    textContent = "";
    className = "";
    private classes = new Set<string>();
    classList = {
      add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
      remove: (...names: string[]) => names.forEach((n) => this.classes.delete(n)),
      toggle: (name: string, force?: boolean) => {
        if (force === true) this.classes.add(name);
        else if (force === false) this.classes.delete(name);
        else if (this.classes.has(name)) this.classes.delete(name);
        else this.classes.add(name);
      },
      contains: (name: string) => this.classes.has(name),
    };
    constructor(tag: string) {
      this.tagName = tag.toUpperCase();
    }
    setAttribute(k: string, v: string) {
      this.attrs[k] = String(v);
      if (k === "class") this.className = String(v);
    }
    removeAttribute(k: string) {
      delete this.attrs[k];
    }
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    }
    hasAttribute(k: string) {
      return k in this.attrs;
    }
    append(...nodes: Array<FakeElement | string>) {
      for (const n of nodes) {
        if (n instanceof FakeElement) {
          n.parentElement = this;
          this.children.push(n);
        }
      }
    }
    replaceChildren(...nodes: Array<FakeElement | string>) {
      this.children = [];
      this.append(...nodes);
    }
    contains(target: unknown): boolean {
      if (target === this) return true;
      return this.children.some((c) => c.contains(target));
    }
    focus() {
      focusedEl = this;
    }
    getClientRects() {
      return [{ width: 100, height: 40 }];
    }
    querySelectorAll(selector: string): FakeElement[] {
      const out: FakeElement[] = [];
      const walk = (node: FakeElement) => {
        for (const child of node.children) {
          if (selector.includes(".dialog") && (child.className.includes("dialog") || child.className.includes("sheet"))) {
            out.push(child);
          } else if (selector.includes("button:not([disabled])") && child.tagName === "BUTTON" && !child.hasAttribute("disabled")) {
            out.push(child);
          }
          walk(child);
        }
      };
      walk(this);
      return out;
    }
    querySelector(selector: string): FakeElement | null {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    closest() {
      return null;
    }
    addEventListener() {}
    removeEventListener() {}
    scrollTo() {}
  }

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
  ] as const;
  const prev = Object.fromEntries(keys.map((key) => [key, g[key]]));
  const storage = new Map<string, string>();
  const appRoot = new FakeElement("div");
  const liveEl = new FakeElement("div");
  const docEl = new FakeElement("html");
  const bodyEl = new FakeElement("body");
  const metaTheme = new FakeElement("meta");
  let desktop = false;

  try {
    g.Node = FakeElement;
    g.HTMLElement = FakeElement;
    g.HTMLInputElement = class extends FakeElement {};
    g.HTMLTextAreaElement = class extends FakeElement {};
    g.CSS = { escape: (s: string) => String(s) };
    g.localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
    };
    g.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    g.history = { state: null, length: 1, pushState: () => {}, back: () => {}, go: () => {} };
    g.location = { pathname: "/", href: "https://gastos.example.test/" };
    g.document = {
      documentElement: docEl,
      body: bodyEl,
      get activeElement() {
        return focusedEl;
      },
      querySelector: (sel: string) => {
        if (sel === "#app") return appRoot;
        if (sel === "#live-region") return liveEl;
        if (sel.includes("theme-color")) return metaTheme;
        return null;
      },
      querySelectorAll: () => [],
      createElement: (tag: string) => new FakeElement(tag),
      createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
      createTextNode: (t: string) => ({ textContent: t }),
      addEventListener: (ev: string, fn: (e: unknown) => void) => {
        const list = listeners.get(ev) ?? [];
        list.push(fn);
        listeners.set(ev, list);
      },
      removeEventListener: () => {},
    };
    g.window = {
      matchMedia: () => ({
        get matches() {
          return desktop;
        },
        addEventListener: () => {},
      }),
      addEventListener: () => {},
      scrollTo: () => {},
      scrollY: 0,
      innerWidth: 390,
    };

    const domMod = "../public/js/dom.js";
    const a11yMod = "../public/js/a11y.js";
    const stateMod = "../public/js/state.js";
    const { applyTheme, onDesktop } = (await import(domMod)) as {
      applyTheme: (t: string) => void;
      onDesktop: () => boolean;
    };
    const { announceLive, lockPage, unlockPage } = (await import(a11yMod)) as {
      announceLive: (msg: string) => void;
      lockPage: (y: number) => void;
      unlockPage: (y?: number) => void;
    };
    const { state } = (await import(stateMod)) as { state: Record<string, unknown> };

    // 1. Mobile vs desktop detection + dark theme persistence
    assert.equal(onDesktop(), false);
    desktop = true;
    assert.equal(onDesktop(), true);

    applyTheme("dark");
    assert.equal(docEl.dataset.theme, "dark");
    assert.equal(metaTheme.getAttribute("content"), "#121418");
    assert.equal(storage.get("theme"), "dark");

    applyTheme("light");
    assert.equal(docEl.dataset.theme, "light");
    assert.equal(metaTheme.getAttribute("content"), "#f5f6f8");

    // 2. Live region announces message asynchronously and avoids stale text
    announceLive("Gasto salvo com sucesso.");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(liveEl.textContent, "Gasto salvo com sucesso.");

    // 3. Modal focus trap cycles Tab and Shift+Tab cleanly within topmost dialog via document keydown
    const dialog = new FakeElement("div");
    dialog.setAttribute("class", "dialog");
    const btn1 = new FakeElement("button");
    const btn2 = new FakeElement("button");
    dialog.append(btn1, btn2);
    appRoot.replaceChildren(dialog);
    lockPage(0);
    focusedEl = btn2;

    const fireKeydown = (ev: Record<string, unknown>) => {
      for (const fn of listeners.get("keydown") ?? []) fn(ev);
    };

    let prevented = false;
    fireKeydown({ key: "Tab", shiftKey: false, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(focusedEl, btn1);

    prevented = false;
    fireKeydown({ key: "Tab", shiftKey: true, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(focusedEl, btn2);

    // 4. Escape fecha modal help aberto
    state.help = { title: "Ajuda", lines: ["Teste"] };
    prevented = false;
    fireKeydown({ key: "Escape", preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(state.help, null);
    unlockPage(0);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  }
});
