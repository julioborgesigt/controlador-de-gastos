import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { ensureReady } from "../../src/db.ts";
import worker from "../../src/index.ts";
import { createMemoryD1 } from "./d1-memory.ts";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const dummyCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

function servePublicAsset(input: RequestInfo | URL): Response {
  const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!resolved.startsWith(PUBLIC_DIR) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    return new Response("Not found", { status: 404 });
  }
  const ext = path.extname(resolved).toLowerCase();
  const body = fs.readFileSync(resolved);
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
  });
}

export type AppServer = {
  baseUrl: string;
  db: D1Database;
  close: () => Promise<void>;
};

export async function startAppServer(): Promise<AppServer> {
  const db = createMemoryD1();
  await ensureReady(db);
  const env = {
    DB: db,
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => servePublicAsset(input),
    },
  } as unknown as Env;

  const server = http.createServer(async (req, res) => {
    try {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}${req.url || "/"}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else {
          headers.set(key, value);
        }
      }
      const chunks: Buffer[] = [];
      if (req.method !== "GET" && req.method !== "HEAD") {
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], env, dummyCtx);
      res.statusCode = response.status;
      const setCookies = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
      for (const [key, value] of response.headers.entries()) {
        if (key.toLowerCase() === "set-cookie") continue;
        res.setHeader(key, value);
      }
      if (setCookies.length) res.setHeader("set-cookie", setCookies);
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : "server error");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    db,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export function findChromeBinary(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

type CdpResponse = {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

export type BrowserPage = {
  errors: string[];
  goto: (urlPath: string) => Promise<void>;
  setViewport: (width: number, height: number, mobile?: boolean) => Promise<void>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  waitFor: (predicateExpr: string, timeoutMs?: number) => Promise<void>;
  waitForSelector: (selector: string, timeoutMs?: number) => Promise<void>;
  waitForText: (text: string, timeoutMs?: number) => Promise<void>;
  click: (selector: string) => Promise<void>;
  clickButton: (text: string, scopeSelector?: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  typeKeys: (text: string) => Promise<void>;
  pressKey: (key: string, code?: string) => Promise<void>;
  selectOption: (selector: string, value: string) => Promise<void>;
  drag: (selector: string, dx: number, dy?: number) => Promise<void>;
  close: () => Promise<void>;
};

export async function launchBrowserPage(baseUrl: string, executablePath: string): Promise<BrowserPage> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gastos-e2e-"));
  const proc: ChildProcess = spawn(
    executablePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-proxy-server",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--window-size=390,844",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const wsUrl = await new Promise<string>((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Timeout iniciando Chromium: ${stderr}`)), 15_000);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium encerrou cedo (code ${code}): ${stderr}`));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Falha ao conectar no DevTools WebSocket")), { once: true });
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (err: Error) => void }>();
  const errors: string[] = [];
  let pageSessionId = "";

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as CdpResponse;
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message || "CDP error"));
      else entry.resolve(msg.result || {});
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const details = (msg.params?.exceptionDetails || {}) as { text?: string; exception?: { description?: string } };
      errors.push(`RuntimeException: ${details.exception?.description || details.text || "unknown"}`);
    } else if (msg.method === "Console.messageAdded") {
      const message = (msg.params?.message || {}) as { level?: string; text?: string };
      if (message.level === "error") errors.push(`ConsoleError: ${message.text || ""}`);
    } else if (msg.method === "Log.entryAdded") {
      const entry = (msg.params?.entry || {}) as { level?: string; text?: string; source?: string };
      if (entry.level === "error") errors.push(`LogError(${entry.source || "browser"}): ${entry.text || ""}`);
    }
  });

  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    const id = nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify(payload));
    });
  };

  const created = await send("Target.createTarget", { url: "about:blank" });
  const targetId = String(created.targetId || "");
  const attached = await send("Target.attachToTarget", { targetId, flatten: true });
  pageSessionId = String(attached.sessionId || "");

  await send("Page.enable", {}, pageSessionId);
  await send("Runtime.enable", {}, pageSessionId);
  await send("Console.enable", {}, pageSessionId);
  await send("Log.enable", {}, pageSessionId);

  const setViewport = async (width: number, height: number, mobile = width < 768) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
    }, pageSessionId);
  };

  await setViewport(390, 844, true);

  const evaluate = async <T = unknown>(expression: string): Promise<T> => {
    const res = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, pageSessionId);
    if (res.exceptionDetails) {
      const details = res.exceptionDetails as { text?: string; exception?: { description?: string } };
      throw new Error(`Erro em evaluate: ${details.exception?.description || details.text || expression}`);
    }
    const result = (res.result || {}) as { value?: T };
    return result.value as T;
  };

  const waitFor = async (predicateExpr: string, timeoutMs = 6000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate<boolean>(`Boolean(${predicateExpr})`)) return;
      await new Promise((r) => setTimeout(r, 35));
    }
    const bodyText = await evaluate<string>("document.body ? document.body.innerText.slice(0, 400) : ''").catch(() => "");
    throw new Error(`Timeout aguardando (${predicateExpr}). Erros: ${JSON.stringify(errors)}. Tela: ${bodyText}`);
  };

  const waitForSelector = (selector: string, timeoutMs = 6000) =>
    waitFor(`document.querySelector(${JSON.stringify(selector)})`, timeoutMs);

  const waitForText = (text: string, timeoutMs = 6000) =>
    waitFor(`(document.body?.innerText || "").includes(${JSON.stringify(text)})`, timeoutMs);

  const goto = async (urlPath: string) => {
    const targetUrl = urlPath.startsWith("http") ? urlPath : `${baseUrl}${urlPath}`;
    await send("Page.navigate", { url: targetUrl }, pageSessionId);
    await waitFor('document.readyState === "complete"');
  };

  const click = async (selector: string) => {
    await waitForSelector(selector);
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Elemento não encontrado: " + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: "center" });
      el.click();
    })()`);
  };

  const clickButton = async (text: string, scopeSelector = "body") => {
    await waitFor(`(() => {
      const scope = document.querySelector(${JSON.stringify(scopeSelector)});
      if (!scope) return false;
      const buttons = [...scope.querySelectorAll("button")];
      return buttons.some((b) => !b.disabled && b.textContent.trim().includes(${JSON.stringify(text)}));
    })()`);
    await evaluate(`(() => {
      const scope = document.querySelector(${JSON.stringify(scopeSelector)});
      const buttons = [...scope.querySelectorAll("button")].filter((b) => !b.disabled);
      const exact = buttons.find((b) => b.textContent.trim() === ${JSON.stringify(text)});
      const target = exact || buttons.find((b) => b.textContent.trim().includes(${JSON.stringify(text)}));
      if (!target) throw new Error("Botão não encontrado: " + ${JSON.stringify(text)});
      target.scrollIntoView({ block: "center" });
      target.click();
    })()`);
  };

  const fill = async (selector: string, value: string) => {
    await waitForSelector(selector);
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Campo não encontrado: " + ${JSON.stringify(selector)});
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
  };

  const typeKeys = async (text: string) => {
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch, key: ch }, pageSessionId);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }, pageSessionId);
    }
  };

  const pressKey = async (key: string, code = key) => {
    const keyCodes: Record<string, number> = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8 };
    const windowsVirtualKeyCode = keyCodes[key] || 0;
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode }, pageSessionId);
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode }, pageSessionId);
  };

  const selectOption = async (selector: string, value: string) => {
    await waitForSelector(selector);
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Select não encontrado: " + ${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
  };

  const drag = async (selector: string, dx: number, dy = 0) => {
    await waitForSelector(selector);
    const box = await evaluate<{ x: number; y: number }>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: "center" });
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }, pageSessionId);
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: box.x + (dx * i) / steps,
        y: box.y + (dy * i) / steps,
        button: "left",
        buttons: 1,
      }, pageSessionId);
    }
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: box.x + dx,
      y: box.y + dy,
      button: "left",
      clickCount: 1,
    }, pageSessionId);
  };

  const close = async () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    const exited = new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
        return;
      }
      proc.once("exit", () => resolve());
    });
    proc.kill("SIGTERM");
    const timeout = setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 2000);
    await exited;
    clearTimeout(timeout);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };

  return {
    errors,
    goto,
    setViewport,
    evaluate,
    waitFor,
    waitForSelector,
    waitForText,
    click,
    clickButton,
    fill,
    typeKeys,
    pressKey,
    selectOption,
    drag,
    close,
  };
}
