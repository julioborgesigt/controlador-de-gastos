import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAZILIAN_CARDS,
  alignInstallmentPurchaseDate,
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

test("editar gasto importado do Nubank suporta campos unificados, vínculo a custo de vida e mantém sincronização idempotente", async () => {
  const env = createTestEnv();
  const bob = createClient(env, "198.51.100.42");
  assert.equal((await bob.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "bob-edit-nubank@example.com",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await bob.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-01",
  })).status, 200);

  const csv = [
    "date,title,amount",
    "2026-10-16,Farmacia Central - Parcela 1/2,74.37",
    "2026-10-20,Google Garena,25.99",
  ].join("\n");

  const imp = await bob.request("POST", "/api/import/nubank", {
    csvText: csv,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
  });
  assert.equal(imp.status, 200);

  // Cria um Custo de vida previsto em novembro para vincular o gasto importado
  const livingRes = await bob.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "Farmácia Mensal",
    section: "fixed",
    amountCents: 20000,
    payment: "card",
    onCard: false,
    cardLabel: "Nubank",
    note: "",
    installment: null,
    paid: false,
  });
  assert.equal(livingRes.status, 201);

  const novBefore = await bob.request("GET", "/api/months/2026-11");
  const expenses = novBefore.json.expenses as Array<{
    id: string;
    name: string;
    section: string;
    amountCents: number;
    installment: string | null;
    note: string | null;
    partials?: Array<{ amountCents: number; payment: string; cardLabel: string | null }>;
  }>;
  const living = expenses.find((item) => item.name === "Farmácia Mensal" && item.section === "fixed");
  const farmacia = expenses.find((item) => item.name === "Farmacia Central" && item.section === "card");
  const garena = expenses.find((item) => item.name === "Google Garena" && item.section === "card");
  assert.ok(living && farmacia && garena);

  // 1) Vincula o gasto importado da Farmácia ao Custo de vida previsto, mantendo parcela e data da compra
  const editLink = await bob.request("POST", `/api/expenses/${farmacia.id}/classification`, {
    classification: "casa",
    name: "Farmacia Central",
    amountCents: 7437,
    cardLabel: "Nubank",
    note: "Remédio",
    purchaseDate: "2026-10-16",
    invoiceMonthId: "2026-11",
    costMonthId: "2026-11",
    linkExpenseId: living.id,
    installment: "1/2",
  });
  assert.equal(editLink.status, 200);

  const novAfterLink = await bob.request("GET", "/api/months/2026-11");
  const afterExpenses = novAfterLink.json.expenses as typeof expenses;
  const updatedLiving = afterExpenses.find((item) => item.id === living.id);
  const updatedFarmacia = afterExpenses.find((item) => item.id === farmacia.id);
  assert.ok(updatedLiving && updatedFarmacia);
  assert.equal(updatedLiving.partials?.length, 1);
  assert.equal(updatedLiving.partials?.[0]?.amountCents, 7437);
  assert.equal(updatedLiving.partials?.[0]?.cardLabel, "Nubank");
  assert.ok((updatedFarmacia.note || "").includes(`origem:${living.id}`));
  assert.ok((updatedFarmacia.note || "").includes("compra:2026-10-16"));
  assert.ok((updatedFarmacia.note || "").includes("Remédio"));
  assert.equal(updatedFarmacia.installment, "1/2");

  // 2) Reclassifica Google Garena para Planejado, move para fatura de dez/2026 e define parcelamento 1/2
  const editMove = await bob.request("POST", `/api/expenses/${garena.id}/classification`, {
    classification: "planejado",
    name: "Google Garena VIP",
    amountCents: 2599,
    cardLabel: "Nubank",
    note: "Presente",
    purchaseDate: "2026-10-21",
    invoiceMonthId: "2026-12",
    costMonthId: "2026-11",
    linkExpenseId: "",
    installment: "1/2",
  });
  assert.equal(editMove.status, 200);
  assert.equal((editMove.json.month as { id: string }).id, "2026-12");

  const decAfterMove = await bob.request("GET", "/api/months/2026-12");
  const decItems = decAfterMove.json.expenses as typeof expenses;
  const movedGarena = decItems.find((item) => item.id === garena.id);
  assert.ok(movedGarena);
  assert.equal(movedGarena.name, "Google Garena VIP");
  assert.equal(movedGarena.installment, "1/2");
  assert.ok((movedGarena.note || "").includes("tipo:planejado"));
  assert.ok((movedGarena.note || "").includes("compra:2026-10-21"));
  assert.ok((movedGarena.note || "").includes("ref:2026-11"));

  // 3) Reimporta a mesma planilha CSV: import_key foi preservado, zero duplicatas!
  const reimp = await bob.request("POST", "/api/import/nubank", {
    csvText: csv,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
  });
  assert.equal(reimp.status, 200);
  const summary = reimp.json.summary as Record<string, unknown>;
  assert.equal(summary.insertedCurrent, 0);
  assert.equal(summary.insertedFuture, 0);
  assert.equal(summary.syncedExisting, 3);
});

test("excluir cartão apaga gastos entre meses (nov->dez) e reimportar CSV grande com >100 gastos no mês respeita o limite de 100 variáveis do D1", async () => {
  const env = createTestEnv();
  const user = createClient(env, "198.51.100.43");
  assert.equal((await user.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "heavy-import@example.com",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await user.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-02",
  })).status, 200);

  // Cria cartão Nubank e lança um gasto feito em novembro para ser pago na fatura de dezembro
  const cardRes = await user.request("POST", "/api/cards", { name: "Nubank", dueDay: 5, closingDay: 28 });
  assert.equal(cardRes.status, 201);
  const cardId = (cardRes.json.cards as Array<{ id: string }>)[0]!.id;

  const crossSpend = await user.request("POST", "/api/card-spend", {
    name: "Compra Nov p/ Dez",
    amountCents: 35000,
    classification: "planejado",
    cardLabel: "Nubank",
    purchaseDate: "2026-11-15",
    invoiceMonthId: "2026-12",
    costMonthId: "2026-11",
  });
  assert.equal(crossSpend.status, 201);

  // Cria 25 custos de vida em novembro (para somar > 100 gastos em novembro após o CSV de 90 itens!)
  for (let i = 1; i <= 25; i += 1) {
    assert.equal((await user.request("POST", "/api/expenses", {
      monthId: "2026-11",
      name: `Conta fixa ${i}`,
      section: "fixed",
      amountCents: 1000 * i,
      payment: "pix",
    })).status, 201);
  }

  // Exclui o cartão Nubank totalmente e confirma que o lançamento de nov->dez foi excluído nos dois meses
  const del = await user.request("DELETE", `/api/cards/${cardId}?monthId=2026-11`);
  assert.equal(del.status, 200);
  const novAfterDel = await user.request("GET", "/api/months/2026-11");
  const decAfterDel = await user.request("GET", "/api/months/2026-12");
  assert.ok(!(novAfterDel.json.expenses as Array<{ name: string }>).some((e) => e.name === "Compra Nov p/ Dez"));
  assert.ok(!(decAfterDel.json.expenses as Array<{ name: string }>).some((e) => e.name === "Compra Nov p/ Dez"));

  // Importa fatura grande do Nubank: 90 lançamentos em nov/26 (totalizando 115 gastos em nov/26!) + 40 parcelas futuras + 1 linha inválida
  const lines = ["date,title,amount"];
  for (let i = 1; i <= 70; i += 1) {
    lines.push(`2026-10-${String((i % 28) + 1).padStart(2, "0")},Loja ${i},${(10 + i * 0.5).toFixed(2)}`);
  }
  for (let i = 1; i <= 20; i += 1) {
    lines.push(`2026-10-${String((i % 28) + 1).padStart(2, "0")},Parcelado ${i} - Parcela 1/3,50.00`);
  }
  lines.push("data-invalida,Linha quebrada,abc");

  const imp = await user.request("POST", "/api/import/nubank", {
    csvText: lines.join("\n"),
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
  });
  assert.equal(imp.status, 200);
  const summary = imp.json.summary as Record<string, unknown>;
  assert.equal(summary.cardCreated, true);
  assert.equal(summary.insertedCurrent, 90);
  assert.equal(summary.insertedFuture, 40);
  assert.equal(summary.invalidRows, 1);

  // Recarrega nov/26 (115 gastos > limite de 100 variáveis do D1) e confirma cartão recriado e todos os 115 gastos presentes
  const novReloaded = await user.request("GET", "/api/months/2026-11");
  assert.equal(novReloaded.status, 200);
  assert.equal((novReloaded.json.cards as Array<{ name: string }>).some((c) => c.name === "Nubank"), true);
  assert.equal((novReloaded.json.expenses as unknown[]).length, 115);
});

test("sincronização CSV alinha data da primeira parcela e não duplica quando Nubank avança data de lançamento entre meses", async () => {
  // Alinhamento da data da primeira parcela
  assert.equal(alignInstallmentPurchaseDate("2026-09-28", "2026-11", 9), "2026-01-28");
  assert.equal(alignInstallmentPurchaseDate("2026-10-29", "2026-12", 10), "2026-01-29");
  assert.equal(alignInstallmentPurchaseDate("2026-10-29", "2026-12", 9), "2026-02-28"); // clamp para fevereiro
  assert.equal(alignInstallmentPurchaseDate("2026-10-16", "2026-12", 2), "2026-10-16"); // data original mantida
  assert.equal(alignInstallmentPurchaseDate("2026-10-16", "2026-11", 1), "2026-10-16");

  const env = createTestEnv();
  const user = createClient(env, "198.51.100.44");
  assert.equal((await user.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "sync-shift@example.com",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await user.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-04",
  })).status, 200);

  // 1) Importa fatura de novembro com datas de lançamento daquela parcela (28/09 para 9/12 e 8/12)
  const novCsv = [
    "date,title,amount",
    "2026-09-28,Lite *Vivoeasyanual - Parcela 9/12,20.00",
    "2026-09-28,Amazon - Parcela 8/12,222.33",
  ].join("\n");

  const impNov = await user.request("POST", "/api/import/nubank", {
    csvText: novCsv,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
    classification: "planejado",
  });
  assert.equal(impNov.status, 200);
  const sNov = impNov.json.summary as Record<string, unknown>;
  assert.equal(sNov.insertedCurrent, 2);
  assert.equal(sNov.insertedFuture, 7); // 3 futuras do Vivoeasy (10,11,12) + 4 futuras da Amazon (9,10,11,12)

  // Confere que em dez/26 as parcelas projetadas têm a data alinhada à 1ª parcela
  const decBefore = await user.request("GET", "/api/months/2026-12");
  const decItemsBefore = decBefore.json.expenses as Array<{ name: string; installment: string | null; note: string | null }>;
  assert.equal(decItemsBefore.length, 2);
  const vivoDec = decItemsBefore.find((e) => e.name === "Lite *Vivoeasyanual");
  const amazonDec = decItemsBefore.find((e) => e.name === "Amazon");
  assert.equal(vivoDec?.installment, "10/12");
  assert.ok((vivoDec?.note || "").includes("compra:2026-01-28"));
  assert.equal(amazonDec?.installment, "9/12");
  assert.ok((amazonDec?.note || "").includes("compra:2026-02-28"));

  // 2) Importa fatura de dezembro onde o Nubank avançou a data para 29/10 (mês +1 e dia +1)
  const decCsv = [
    "date,title,amount",
    "2026-10-29,Lite *Vivoeasyanual - Parcela 10/12,20.00",
    "2026-10-29,Amazon - Parcela 9/12,222.33",
    "2026-11-15,Padaria Nova,42.00",
  ].join("\n");

  const impDec = await user.request("POST", "/api/import/nubank", {
    csvText: decCsv,
    filename: "Nubank_2026-12-05.csv",
    dueDate: "2026-12-05",
    cardName: "Nubank",
    classification: "planejado",
  });
  assert.equal(impDec.status, 200);
  const sDec = impDec.json.summary as Record<string, unknown>;
  assert.equal(sDec.insertedCurrent, 1); // somente Padaria Nova!
  assert.equal(sDec.insertedFuture, 0); // zero duplicatas projetadas!
  assert.equal(sDec.syncedExisting, 7); // 10/12..12/12 + 9/12..12/12 sincronizadas!

  const decAfter = await user.request("GET", "/api/months/2026-12");
  const decItemsAfter = decAfter.json.expenses as Array<{ name: string; installment: string | null }>;
  assert.equal(decItemsAfter.filter((e) => e.name === "Lite *Vivoeasyanual").length, 1);
  assert.equal(decItemsAfter.filter((e) => e.name === "Amazon").length, 1);
  assert.equal(decItemsAfter.length, 3);
});

test("reimportar fatura deduplica automaticamente parcelas legadas gravadas com chaves baseadas em datas diferentes", async () => {
  const env = createTestEnv();
  const user = createClient(env, "198.51.100.45");
  assert.equal((await user.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "legacy-dedup@example.com",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await user.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-02",
  })).status, 200);
  assert.equal((await user.request("POST", "/api/cards", { name: "Nubank", dueDay: 5, closingDay: 26 })).status, 201);

  const ownerRow = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind("legacy-dedup@example.com").first<{ id: string }>();
  assert.ok(ownerRow?.id);

  // Simula 2 linhas legadas duplicadas da mesma parcela 10/12 em dez/2026 (vindas de 28/09 e 29/10 no formato antigo)
  await env.DB.prepare(
    `INSERT INTO expenses (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, source, sort_order, created_at, import_key, track, purchase_date, reference_month_id)
     VALUES (?, ?, '2026-12', 'Lite *Vivoeasyanual', 'card', 2000, 'card', 0, 'Nubank', 0, 'tipo:planejado\ncompra:2026-09-28\nref:2026-09', '10/12', 'user', 1, '2026-11-21T10:00:00Z', 'nb:p:nubank:2026-09-28:lite *vivoeasyanual:2000:10/12:1', 'planejado', '2026-09-28', '2026-09')`,
  ).bind("legacy-1", ownerRow.id).run();
  await env.DB.prepare(
    `INSERT INTO expenses (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, source, sort_order, created_at, import_key, track, purchase_date, reference_month_id)
     VALUES (?, ?, '2026-12', 'Lite *Vivoeasyanual', 'card', 2000, 'card', 0, 'Nubank', 0, 'tipo:planejado\ncompra:2026-10-29\nref:2026-10', '10/12', 'user', 2, '2026-11-21T10:01:00Z', 'nb:p:nubank:2026-10-29:lite *vivoeasyanual:2000:10/12:1', 'planejado', '2026-10-29', '2026-10')`,
  ).bind("legacy-2", ownerRow.id).run();

  const decCsv = [
    "date,title,amount",
    "2026-10-29,Lite *Vivoeasyanual - Parcela 10/12,20.00",
  ].join("\n");

  const reimp = await user.request("POST", "/api/import/nubank", {
    csvText: decCsv,
    filename: "Nubank_2026-12-05.csv",
    dueDate: "2026-12-05",
    cardName: "Nubank",
    classification: "planejado",
  });
  assert.equal(reimp.status, 200);
  const summary = reimp.json.summary as Record<string, unknown>;
  assert.equal(summary.insertedCurrent, 0);
  assert.equal(summary.syncedExisting, 1);

  // Dezembro deve ficar com APENAS 1 lançamento, com chave canônica e data alinhada
  const dec = await user.request("GET", "/api/months/2026-12");
  const decItems = dec.json.expenses as Array<{ id: string; name: string; installment: string | null; note: string | null }>;
  assert.equal(decItems.length, 1);
  assert.equal(decItems[0]?.id, "legacy-1");
  assert.equal(decItems[0]?.installment, "10/12");
  assert.ok((decItems[0]?.note || "").includes("compra:2026-01-29"));

  const upgraded = await env.DB.prepare("SELECT import_key FROM expenses WHERE id = 'legacy-1'").first<{ import_key: string | null }>();
  assert.equal(upgraded?.import_key, "nb:p:nubank:2026-03:lite *vivoeasyanual:2000:10/12:1");
});

test("destaque de novos valores após sincronização de CSV persiste até chegarem novos valores na próxima sincronização", async () => {
  const env = createTestEnv();
  const user = createClient(env, "198.51.100.46");
  assert.equal((await user.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "csv-highlight@example.com",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await user.request("POST", "/api/period", {
    startMonthId: "2026-11",
    endMonthId: "2027-02",
  })).status, 200);
  assert.equal((await user.request("POST", "/api/cards", { name: "Nubank", dueDay: 5, closingDay: 26 })).status, 201);

  // Gasto manual nunca deve receber destaque de CSV
  assert.equal((await user.request("POST", "/api/card-spend", {
    classification: "planejado",
    invoiceMonthId: "2026-11",
    cardLabel: "Nubank",
    name: "Gasto Manual",
    amountCents: 3000,
    purchaseDate: "2026-11-01",
  })).status, 201);

  // 1) Primeira sincronização CSV com 2 gastos (sendo 1 parcelado 1/2 projetando para dez/26)
  const csv1 = [
    "date,title,amount",
    "2026-11-02,Cafeteria Antiga,18.50",
    "2026-11-03,Loja Parcelada - Parcela 1/2,100.00",
  ].join("\n");
  const sync1 = await user.request("POST", "/api/import/nubank", {
    csvText: csv1,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
    classification: "imprevisto",
  });
  assert.equal(sync1.status, 200);
  const nov1 = sync1.json.expenses as Array<{ name: string; recentlyImported?: boolean }>;
  assert.equal(nov1.find((e) => e.name === "Gasto Manual")?.recentlyImported, false);
  assert.equal(nov1.find((e) => e.name === "Cafeteria Antiga")?.recentlyImported, true);
  assert.equal(nov1.find((e) => e.name === "Loja Parcelada")?.recentlyImported, true);

  // Parcela futura projetada em dez/26 e /purchases também recebem destaque
  const dec1 = await user.request("GET", "/api/months/2026-12");
  const dec1Items = dec1.json.expenses as Array<{ name: string; recentlyImported?: boolean }>;
  assert.equal(dec1Items.find((e) => e.name === "Loja Parcelada")?.recentlyImported, true);

  const purchases1 = await user.request("GET", "/api/months/2026-11/purchases");
  const p1Items = purchases1.json.items as Array<{ name: string; recentlyImported?: boolean }>;
  assert.equal(p1Items.find((e) => e.name === "Cafeteria Antiga")?.recentlyImported, true);
  assert.equal(p1Items.find((e) => e.name === "Gasto Manual")?.recentlyImported, false);

  // 2) Re-sincronização com o MESMO CSV (sem novos valores) -> preserva o destaque anterior
  const syncSame = await user.request("POST", "/api/import/nubank", {
    csvText: csv1,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
    classification: "imprevisto",
  });
  assert.equal(syncSame.status, 200);
  assert.equal((syncSame.json.summary as Record<string, unknown>).insertedCurrent, 0);
  const novSame = syncSame.json.expenses as Array<{ name: string; recentlyImported?: boolean }>;
  assert.equal(novSame.find((e) => e.name === "Cafeteria Antiga")?.recentlyImported, true);
  assert.equal(novSame.find((e) => e.name === "Loja Parcelada")?.recentlyImported, true);

  // 3) Nova sincronização CSV trazendo 1 gasto novo -> destaque passa SOMENTE para o valor recém-chegado
  const csv2 = [
    "date,title,amount",
    "2026-11-02,Cafeteria Antiga,18.50",
    "2026-11-03,Loja Parcelada - Parcela 1/2,100.00",
    "2026-11-04,Restaurante Novo,75.00",
  ].join("\n");
  const sync2 = await user.request("POST", "/api/import/nubank", {
    csvText: csv2,
    filename: "Nubank_2026-11-05.csv",
    dueDate: "2026-11-05",
    cardName: "Nubank",
    classification: "imprevisto",
  });
  assert.equal(sync2.status, 200);
  assert.equal((sync2.json.summary as Record<string, unknown>).insertedCurrent, 1);
  const nov2 = sync2.json.expenses as Array<{ name: string; recentlyImported?: boolean }>;
  assert.equal(nov2.find((e) => e.name === "Gasto Manual")?.recentlyImported, false);
  assert.equal(nov2.find((e) => e.name === "Cafeteria Antiga")?.recentlyImported, false);
  assert.equal(nov2.find((e) => e.name === "Loja Parcelada")?.recentlyImported, false);
  assert.equal(nov2.find((e) => e.name === "Restaurante Novo")?.recentlyImported, true);

  // Parcela antiga em dez/26 também perde o destaque após chegarem novos valores
  const dec2 = await user.request("GET", "/api/months/2026-12");
  const dec2Items = dec2.json.expenses as Array<{ name: string; recentlyImported?: boolean }>;
  assert.equal(dec2Items.find((e) => e.name === "Loja Parcelada")?.recentlyImported, false);
});



