import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAZILIAN_CARDS,
  extractDueDateFromFilename,
  isNubankName,
  parseNubankCsv,
} from "../public/shared/nubank-csv.js";
import worker from "../src/index.ts";
import { createTestEnv } from "./helpers/d1-memory.ts";

const ORIGIN = "https://gastos.example.test";

const dummyCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

function createClient(env: Env, ip = "198.51.100.40") {
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
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        json = {};
      }
      return { status: res.status, text, json };
    },
  };
}

test("parseNubankCsv extrai vencimento do nome do arquivo, parcelas, datas US/ISO e ignora pagamentos", () => {
  assert.ok(BRAZILIAN_CARDS.includes("Nubank"));
  assert.equal(isNubankName("Nubank"), true);
  assert.equal(isNubankName("Meu Nubank Ultravioleta"), true);
  assert.equal(isNubankName("Itaú"), false);

  const due = extractDueDateFromFilename("Nubank_2026-11-05.csv");
  assert.deepEqual(due, { dueDate: "2026-11-05", invoiceMonthId: "2026-11", dueDay: 5 });

  // CSV no estilo do print (datas MM/DD/YYYY vindas do WPS/Excel + parcelas + duplicata no mesmo dia + pagamento)
  const csv = [
    "date,title,amount",
    "10/28/2026,Supermercado Leandro,31.33",
    "10/28/2026,Supermercado Leandro,31.33",
    "10/25/2026,Supermercado Leandro - Parcela 1/3,67.94",
    "10/24/2026,Farmacia Nossa Sra. - Parcela 1/2,74.37",
    "10/8/2026,Google Garena,20.99",
    "10/5/2026,Pagamento recebido,-1500.00",
  ].join("\n");

  const parsed = parseNubankCsv(csv, "Nubank_2026-11-05.csv");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.detectedDueDate, "2026-11-05");
  assert.equal(parsed.detectedInvoiceMonthId, "2026-11");
  assert.equal(parsed.detectedDueDay, 5);
  assert.equal(parsed.items.length, 5);
  assert.equal(parsed.ignoredPayments, 1);
  assert.equal(parsed.futureInstallmentsCount, 3); // 2 futuras do 1/3 + 1 futura do 1/2

  // Compras idênticas no mesmo dia recebem occurrence 1 e 2
  assert.equal(parsed.items[0]?.occurrence, 1);
  assert.equal(parsed.items[1]?.occurrence, 2);

  // 10/8/2026 interpretado como 8 de outubro (coerente com 10/28/2026 no mesmo arquivo)
  assert.equal(parsed.items[4]?.purchaseDate, "2026-10-08");
  assert.equal(parsed.items[2]?.name, "Supermercado Leandro");
  assert.equal(parsed.items[2]?.currentInstallment, 1);
  assert.equal(parsed.items[2]?.totalInstallments, 3);
});

test("POST /api/import/nubank cria cartão, projeta parcelas nos meses seguintes e sincroniza sem duplicar", async () => {
  const env = createTestEnv();
  const alice = createClient(env, "198.51.100.41");

  // Sem autenticação retorna 401
  assert.equal((await alice.request("POST", "/api/import/nubank", { csvText: "date,title,amount", dueDate: "2026-11-05" })).status, 401);

  assert.equal((await alice.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "nubank@teste.com",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await alice.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-01",
  })).status, 200);

  const novCsv = [
    "date,title,amount",
    "2026-10-26,Google Garena,20.99",
    "2026-10-25,Supermercado Leandro - Parcela 1/3,67.94",
    "2026-10-16,Farmacia Nossa Sra. - Parcela 1/2,74.37",
    "2026-10-05,Pagamento recebido,-900.00",
  ].join("\n");

  // 1ª importação da fatura de novembro
  const first = await alice.request("POST", "/api/import/nubank", {
    csvText: novCsv,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
    classification: "imprevisto",
  });
  assert.equal(first.status, 200, first.text);
  const s1 = first.json.summary as Record<string, unknown>;
  assert.equal(s1.cardName, "Nubank");
  assert.equal(s1.cardCreated, true);
  assert.equal(s1.dueDay, 5);
  assert.equal(s1.insertedCurrent, 3);
  assert.equal(s1.insertedFuture, 3); // 2/3, 3/3 e 2/2
  assert.equal(s1.syncedExisting, 0);
  assert.equal(s1.ignoredPayments, 1);

  // Confere que dezembro recebeu 2/2 e 2/3 e janeiro recebeu 3/3
  const dec1 = await alice.request("GET", "/api/months/2026-12");
  const decExpenses1 = dec1.json.expenses as Array<{ name: string; installment: string | null; amountCents: number }>;
  assert.equal(decExpenses1.length, 2);
  assert.ok(decExpenses1.some((item) => item.name === "Farmacia Nossa Sra." && item.installment === "2/2" && item.amountCents === 7437));
  assert.ok(decExpenses1.some((item) => item.name === "Supermercado Leandro" && item.installment === "2/3" && item.amountCents === 6794));

  const jan1 = await alice.request("GET", "/api/months/2027-01");
  const janExpenses1 = jan1.json.expenses as Array<{ name: string; installment: string | null; amountCents: number }>;
  assert.equal(janExpenses1.length, 1);
  assert.equal(janExpenses1[0]?.installment, "3/3");

  // Reimportação da mesma planilha de novembro + 1 nova compra (sincronização idempotente)
  const novCsvUpdated = `${novCsv}\n2026-10-28,Sorveteria Mega Espre,9.00`;
  const second = await alice.request("POST", "/api/import/nubank", {
    csvText: novCsvUpdated,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
  });
  assert.equal(second.status, 200);
  const s2 = second.json.summary as Record<string, unknown>;
  assert.equal(s2.insertedCurrent, 1);
  assert.equal(s2.insertedFuture, 0);
  assert.equal(s2.syncedExisting, 6);

  // Importação da fatura do mês seguinte (dezembro) contendo as parcelas 2/2 e 2/3 já projetadas + 1 compra nova
  const decCsv = [
    "date,title,amount",
    "2026-10-25,Supermercado Leandro - Parcela 2/3,67.94",
    "2026-10-16,Farmacia Nossa Sra. - Parcela 2/2,74.37",
    "2026-11-12,Padaria Central,35.50",
  ].join("\n");
  const third = await alice.request("POST", "/api/import/nubank", {
    csvText: decCsv,
    filename: "Nubank_2026-12-05.csv",
    dueDate: "2026-12-05",
    cardName: "Nubank",
  });
  assert.equal(third.status, 200);
  const s3 = third.json.summary as Record<string, unknown>;
  assert.equal(s3.insertedCurrent, 1); // somente Padaria Central
  assert.equal(s3.insertedFuture, 0); // 3/3 já existe em janeiro
  assert.equal(s3.syncedExisting, 3); // 2/2, 2/3 e 3/3 já sincronizados!

  const decAfter = await alice.request("GET", "/api/months/2026-12");
  assert.equal((decAfter.json.expenses as unknown[]).length, 3);
  const janAfter = await alice.request("GET", "/api/months/2027-01");
  assert.equal((janAfter.json.expenses as unknown[]).length, 1);
});
