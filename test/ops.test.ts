import assert from "node:assert/strict";
import test from "node:test";
import { ensureReady } from "../src/db.ts";
import worker from "../src/index.ts";
import { createTestEnv } from "./helpers/d1-memory.ts";

const ORIGIN = "https://gastos.example.test";

const dummyCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

function callWorker(env: Env, path: string, headers: Record<string, string> = {}) {
  const req = new Request(`${ORIGIN}${path}`, { method: "GET", headers });
  return worker.fetch(req as Parameters<typeof worker.fetch>[0], env, dummyCtx);
}

test("GET /api/health retorna 200 com db ok, X-Request-Id e headers de segurança", async () => {
  const env = createTestEnv();
  await ensureReady(env.DB);
  const res = await callWorker(env, "/api/health");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; db: string; requestId: string };
  assert.equal(body.ok, true);
  assert.equal(body.db, "ok");
  assert.ok(body.requestId.length > 0);
  assert.equal(res.headers.get("x-request-id"), body.requestId);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("X-Request-Id reutiliza cf-ray quando presente", async () => {
  const env = createTestEnv();
  await ensureReady(env.DB);
  const res = await callWorker(env, "/api/health", { "cf-ray": "9a8b7c6d5e4f-GRU" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { requestId: string };
  assert.equal(body.requestId, "9a8b7c6d5e4f-GRU");
  assert.equal(res.headers.get("x-request-id"), "9a8b7c6d5e4f-GRU");
});

test("GET /api/health retorna 503 e registra log estruturado quando o D1 falha ou falta schema", async () => {
  const logs: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const brokenDb = {
      prepare() {
        return {
          async first() {
            throw new Error("D1_NETWORK_ERROR: segredo interno");
          },
        };
      },
    } as unknown as D1Database;
    const brokenEnv = { ...createTestEnv(), DB: brokenDb } as Env;
    const res = await callWorker(brokenEnv, "/api/health", { "cf-ray": "ray-health-fail" });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { ok: boolean; db: string; requestId: string };
    assert.equal(body.ok, false);
    assert.equal(body.db, "error");
    assert.equal(body.requestId, "ray-health-fail");
    assert.equal(res.headers.get("x-request-id"), "ray-health-fail");
    assert.equal(JSON.stringify(body).includes("segredo interno"), false);

    const parsedLog = JSON.parse(logs[0] || "{}") as Record<string, unknown>;
    assert.equal(parsedLog.level, "error");
    assert.equal(parsedLog.event, "healthcheck_failed");
    assert.equal(parsedLog.requestId, "ray-health-fail");
    assert.equal(parsedLog.path, "/api/health");

    const emptySchemaDb = {
      prepare() {
        return {
          async first() {
            return null;
          },
        };
      },
    } as unknown as D1Database;
    const emptyEnv = { ...createTestEnv(), DB: emptySchemaDb } as Env;
    const resMissing = await callWorker(emptyEnv, "/api/health");
    assert.equal(resMissing.status, 503);
    const bodyMissing = (await resMissing.json()) as { ok: boolean; db: string };
    assert.equal(bodyMissing.ok, false);
    assert.equal(bodyMissing.db, "schema_missing");
  } finally {
    console.error = origError;
  }
});

test("erro 500 em rota de API devolve requestId, oculta detalhe interno e grava log estruturado", async () => {
  const logs: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const failingDb = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            throw new Error("SQLITE_BUSY: detalhe interno");
          },
          async all() {
            throw new Error("SQLITE_BUSY: detalhe interno");
          },
          async run() {
            throw new Error("SQLITE_BUSY: detalhe interno");
          },
        };
      },
      async batch() {
        throw new Error("SQLITE_BUSY: detalhe interno");
      },
      async exec() {
        throw new Error("SQLITE_BUSY: detalhe interno");
      },
    } as unknown as D1Database;
    const env = { ...createTestEnv(), DB: failingDb } as Env;
    const res = await callWorker(env, "/api/session", { "cf-ray": "ray-500-check" });
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("x-request-id"), "ray-500-check");
    const body = (await res.json()) as { error: string; requestId: string };
    assert.equal(body.requestId, "ray-500-check");
    assert.equal(body.error.includes("SQLITE_BUSY"), false);
    assert.ok(logs.length >= 1);
    const parsed = JSON.parse(logs[0] || "{}") as Record<string, unknown>;
    assert.equal(parsed.level, "error");
    assert.equal(parsed.requestId, "ray-500-check");
  } finally {
    console.error = origError;
  }
});
