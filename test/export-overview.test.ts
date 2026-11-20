import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { createTestEnv } from "./helpers/d1-memory.ts";

const ORIGIN = "https://gastos.example.test";

const dummyCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

function createClient(env: Env, ip = "198.51.100.30") {
  let cookie = "";
  return {
    async request(method: string, path: string, body?: unknown) {
      const headers = new Headers({ Origin: ORIGIN, "CF-Connecting-IP": ip });
      if (cookie) headers.set("Cookie", cookie);
      let payload: string | undefined;
      if (body !== undefined) {
        headers.set("Content-Type", "application/json");
        payload = JSON.stringify(body);
      }
      const req = new Request(`${ORIGIN}${path}`, { method, headers, body: payload });
      const res = await worker.fetch(req as Parameters<typeof worker.fetch>[0], env, dummyCtx);
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const pair = setCookie.split(";")[0] ?? "";
        cookie = pair.endsWith("=") ? "" : pair;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder("utf-8").decode(bytes);
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        json = {};
      }
      return { status: res.status, headers: res.headers, bytes, text, json };
    },
  };
}

test("GET /api/export gera JSON e CSV com BOM UTF-8, filtro de mês, isolamento e proteção contra CSV injection", async () => {
  const env = createTestEnv();
  const alice = createClient(env, "198.51.100.31");
  const bob = createClient(env, "198.51.100.32");

  // Sem autenticação retorna 401
  assert.equal((await alice.request("GET", "/api/export?format=json")).status, 401);

  assert.equal((await alice.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "alice@export.test",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await alice.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-01",
  })).status, 200);
  assert.equal((await alice.request("POST", "/api/income/base", { amountCents: 600_000, monthId: "2026-11" })).status, 200);
  assert.equal((await alice.request("POST", "/api/cards", { name: "Nubank", dueDay: 10, closingDay: 1 })).status, 201);

  // Gasto com nome malicioso para validar neutralização de CSV injection
  assert.equal((await alice.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "=SUM(A1:A2) Aluguel",
    amountCents: 150_000,
    section: "fixed",
    payment: "pix",
    onCard: false,
    note: "apartamento",
  })).status, 201);

  assert.equal((await alice.request("POST", "/api/card-spend", {
    name: "Café especial",
    amountCents: 4_500,
    cardLabel: "Nubank",
    classification: "planejado",
    invoiceMonthId: "2026-12",
    costMonthId: "2026-11",
    purchaseDate: "2026-11-15",
    installmentCount: 1,
    installmentsPaid: 0,
    amountMode: "total",
  })).status, 201);

  // Outro usuário não vê nada da Alice
  assert.equal((await bob.request("POST", "/api/register", {
    cpf: "11144477735",
    email: "bob@export.test",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  const bobExport = await bob.request("GET", "/api/export?format=json");
  assert.equal(bobExport.status, 200);
  assert.deepEqual(bobExport.json.months, []);

  // Export JSON completo da Alice
  const jsonExport = await alice.request("GET", "/api/export?format=json");
  assert.equal(jsonExport.status, 200);
  assert.match(jsonExport.headers.get("content-disposition") || "", /attachment; filename="gastos-.*\.json"/);
  assert.equal(jsonExport.headers.get("cache-control"), "no-store");
  const months = jsonExport.json.months as Array<{ id: string; expenses: Array<{ name: string }> }>;
  assert.equal(months.length, 3);
  assert.equal(months[0]?.id, "2026-11");

  // Export CSV de um único mês
  const csvExport = await alice.request("GET", "/api/export?format=csv&monthId=2026-11");
  assert.equal(csvExport.status, 200);
  assert.match(csvExport.headers.get("content-type") || "", /text\/csv/);
  assert.deepEqual([...csvExport.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "CSV deve iniciar com UTF-8 BOM (EF BB BF)");
  assert.ok(csvExport.text.includes("'=SUM(A1:A2) Aluguel"), "CSV deve neutralizar células iniciando com =");
  assert.ok(csvExport.text.includes("1500,00"));
  assert.equal(csvExport.text.includes("2026-12;"), false, "filtro monthId deve limitar ao mês escolhido");

  // Mês inválido retorna 400
  assert.equal((await alice.request("GET", "/api/export?format=csv&monthId=invalido")).status, 400);
});

test("GET /api/overview agrega visão anual e filtra busca por texto sem acento, cartão e tarja", async () => {
  const env = createTestEnv();
  const alice = createClient(env, "198.51.100.33");

  assert.equal((await alice.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "alice@overview.test",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await alice.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-01",
  })).status, 200);
  assert.equal((await alice.request("POST", "/api/income/base", { amountCents: 500_000, monthId: "2026-11" })).status, 200);
  assert.equal((await alice.request("POST", "/api/cards", { name: "Nubank", dueDay: 10, closingDay: 1 })).status, 201);
  assert.equal((await alice.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "Farmácia",
    amountCents: 12_000,
    section: "extra",
    payment: "pix",
    onCard: false,
    kind: "imprevisto",
  })).status, 201);
  assert.equal((await alice.request("POST", "/api/card-spend", {
    name: "Curso Técnico",
    amountCents: 30_000,
    cardLabel: "Nubank",
    classification: "planejado",
    invoiceMonthId: "2027-01",
    costMonthId: "2027-01",
    purchaseDate: "2027-01-05",
    installmentCount: 1,
    installmentsPaid: 0,
    amountMode: "total",
  })).status, 201);

  // Visão geral sem filtro
  const full = await alice.request("GET", "/api/overview");
  assert.equal(full.status, 200);
  assert.deepEqual(full.json.years, ["2026", "2027"]);
  assert.deepEqual(full.json.cards, ["Nubank"]);
  assert.equal(full.json.hasFilter, false);
  const annual = full.json.annualTotals as { monthCount: number; incomeCents: number };
  assert.equal(annual.monthCount, 3);
  assert.equal(annual.incomeCents, 1_500_000);

  // Filtro por texto sem acento ("farmacia" encontra "Farmácia")
  const byQuery = await alice.request("GET", "/api/overview?q=farmacia");
  assert.equal(byQuery.status, 200);
  assert.equal(byQuery.json.hasFilter, true);
  assert.equal(byQuery.json.totalMatches, 1);
  const matchesQ = byQuery.json.matches as Array<{ name: string; track: string }>;
  assert.equal(matchesQ[0]?.name, "Farmácia");
  assert.equal(matchesQ[0]?.track, "imprevisto");

  // Filtro por ano + cartão + tarja planejado
  const byCombo = await alice.request("GET", "/api/overview?year=2027&card=Nubank&track=planejado");
  assert.equal(byCombo.status, 200);
  assert.equal(byCombo.json.selectedYear, "2027");
  assert.equal((byCombo.json.months as unknown[]).length, 1);
  assert.equal(byCombo.json.totalMatches, 1);
  const matchesCombo = byCombo.json.matches as Array<{ name: string; monthId: string }>;
  assert.equal(matchesCombo[0]?.name, "Curso Técnico");
  assert.equal(matchesCombo[0]?.monthId, "2027-01");
});

test("GET /sw.js é servido com Cache-Control no-store e CSP estrito", async () => {
  const env = createTestEnv();
  const req = new Request(`${ORIGIN}/sw.js`, { method: "GET" });
  const res = await worker.fetch(req as Parameters<typeof worker.fetch>[0], env, dummyCtx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
});
