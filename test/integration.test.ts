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

type ApiClient = {
  cookie: string;
  request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; json: Record<string, unknown>; headers: Headers; text: string }>;
};

function createClient(env: Env, ip = "198.51.100.10"): ApiClient {
  const client: ApiClient = {
    cookie: "",
    async request(method, path, body, extraHeaders = {}) {
      const headers = new Headers({
        Origin: ORIGIN,
        "CF-Connecting-IP": ip,
        ...extraHeaders,
      });
      if (client.cookie) headers.set("Cookie", client.cookie);
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
        if (pair.endsWith("=")) client.cookie = "";
        else if (pair) client.cookie = pair;
      }
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        json = {};
      }
      return { status: res.status, json, headers: res.headers, text };
    },
  };
  return client;
}

async function registerUser(client: ApiClient, cpf: string, email: string, password = "segredo-forte-123") {
  const res = await client.request("POST", "/api/register", {
    cpf,
    email,
    password,
    passwordConfirmation: password,
  });
  assert.equal(res.status, 201, `register falhou: ${res.text}`);
  const spaces = await client.request("GET", "/api/spaces");
  assert.equal(spaces.status, 200);
  return { ownerId: String(spaces.json.currentOwnerId || "") };
}

test("autenticação: cadastro, login, CSRF 403, bloqueio após 8 erros, troca de senha e logout", async () => {
  const env = createTestEnv();
  const alice = createClient(env, "198.51.100.1");

  const sessionBefore = await alice.request("GET", "/api/session");
  assert.equal(sessionBefore.status, 200);
  assert.equal(sessionBefore.json.authenticated, false);

  await registerUser(alice, "52998224725", "alice@example.com");
  const sessionAuthed = await alice.request("GET", "/api/session");
  assert.equal(sessionAuthed.status, 200);
  assert.equal(sessionAuthed.json.authenticated, true);

  // CSRF bloqueado quando Origin diverge do host
  const csrf = await alice.request(
    "POST",
    "/api/theme",
    { theme: "dark" },
    { Origin: "https://evil.example.net" },
  );
  assert.equal(csrf.status, 403);

  // Troca de senha exige senha atual válida
  const badPwd = await alice.request("POST", "/api/password", {
    currentPassword: "senha-errada",
    nextPassword: "nova-senha-forte-123",
    passwordConfirmation: "nova-senha-forte-123",
  });
  assert.equal(badPwd.status, 401);

  const okPwd = await alice.request("POST", "/api/password", {
    currentPassword: "segredo-forte-123",
    nextPassword: "nova-senha-forte-123",
    passwordConfirmation: "nova-senha-forte-123",
  });
  assert.equal(okPwd.status, 200);

  // Logout limpa sessão
  const out = await alice.request("POST", "/api/logout");
  assert.equal(out.status, 200);
  const afterOut = await alice.request("GET", "/api/session");
  assert.equal(afterOut.json.authenticated, false);

  // Login com senha nova funciona
  const okLogin = await alice.request("POST", "/api/login", {
    cpf: "52998224725",
    password: "nova-senha-forte-123",
  });
  assert.equal(okLogin.status, 200);
  await alice.request("POST", "/api/logout");

  // 8 tentativas inválidas bloqueiam com 429
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    const fail = await alice.request("POST", "/api/login", {
      cpf: "52998224725",
      password: "wrong-password",
    });
    assert.equal(fail.status, 401);
  }
  const locked = await alice.request("POST", "/api/login", {
    cpf: "52998224725",
    password: "wrong-password",
  });
  assert.equal(locked.status, 429);
});

test("headers de segurança e cache diferenciam HTML/manifest de assets estáticos", async () => {
  const env = createTestEnv();
  const client = createClient(env);

  const html = await client.request("GET", "/");
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.equal(html.headers.get("cdn-cache-control"), "no-store");
  assert.equal(html.headers.get("x-frame-options"), "DENY");
  assert.match(html.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  assert.match(html.headers.get("strict-transport-security") ?? "", /max-age=31536000/);

  const js = await client.request("GET", "/app.js");
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(js.headers.get("cdn-cache-control"), null);

  const css = await client.request("GET", "/styles.css");
  assert.equal(css.status, 200);
  assert.equal(css.headers.get("cache-control"), "public, max-age=0, must-revalidate");
});

test("isolamento multi-tenant e compartilhamento: view recebe 403 em mutações, edit pode gravar", async () => {
  const env = createTestEnv();
  const owner = createClient(env, "198.51.100.2");
  const guest = createClient(env, "198.51.100.3");

  const { ownerId } = await registerUser(owner, "52998224725", "dono@example.com");
  await registerUser(guest, "11144477735", "convidado@example.com");

  // Dono configura período e cria cartão
  const period = await owner.request("POST", "/api/period", { startMonthId: "2026-11", endMonthId: "2027-02" });
  assert.equal(period.status, 200);
  const cardRes = await owner.request("POST", "/api/cards", { name: "Nubank", dueDay: 10, closingDay: 3 });
  assert.equal(cardRes.status, 201);

  // Convidado sem compartilhamento não pode trocar escopo para o espaço do dono
  const denied = await guest.request("POST", "/api/scope", { ownerId });
  assert.equal(denied.status, 403);

  // Dono compartilha como somente visualização ("view")
  const shareRes = await owner.request("POST", "/api/shares", { cpf: "11144477735", permission: "view" });
  assert.equal(shareRes.status, 201);
  const shareId = ((shareRes.json.shares as Array<{ id: string }>)[0]!).id;

  // Convidado troca escopo para o espaço do dono e consegue ler, mas recebe 403 em mutações
  assert.equal((await guest.request("POST", "/api/scope", { ownerId })).status, 200);
  const readOk = await guest.request("GET", "/api/months/2026-11");
  assert.equal(readOk.status, 200);
  assert.equal((readOk.json.access as { permission: string }).permission, "view");

  const writeBlocked = await guest.request("POST", "/api/cash-spend", {
    monthId: "2026-11",
    name: "Café",
    amountCents: 1500,
    classification: "imprevisto",
  });
  assert.equal(writeBlocked.status, 403);

  // Dono promove compartilhamento para "edit"
  const upgrade = await owner.request("PATCH", `/api/shares/${shareId}`, { permission: "edit" });
  assert.equal(upgrade.status, 200);

  const writeOk = await guest.request("POST", "/api/cash-spend", {
    monthId: "2026-11",
    name: "Café",
    amountCents: 1500,
    classification: "imprevisto",
  });
  assert.equal(writeOk.status, 201);

  // Dono remove compartilhamento -> escopo cai de volta para o próprio espaço do convidado (isolado)
  const revoked = await owner.request("DELETE", `/api/shares/${shareId}`);
  assert.equal(revoked.status, 200);
  const switchAfterRevoke = await guest.request("POST", "/api/scope", { ownerId });
  assert.equal(switchAfterRevoke.status, 403);
});

test("fluxo financeiro completo: receita, cartões, gastos entre meses, parciais, quitação de fatura, série, reclassificação e reset", async () => {
  const env = createTestEnv();
  const user = createClient(env, "198.51.100.4");
  await registerUser(user, "52998224725", "financeiro@example.com");

  // 1. Período e receitas
  assert.equal((await user.request("POST", "/api/period", { startMonthId: "2026-11", endMonthId: "2027-04" })).status, 200);
  const baseInc = await user.request("POST", "/api/income/base", { amountCents: 600000, scope: "all", monthId: "2026-11" });
  assert.equal(baseInc.status, 200);
  assert.equal((baseInc.json.month as { incomeCents: number }).incomeCents, 600000);

  const extraInc = await user.request("POST", "/api/income/extras", {
    kind: "thirteenth",
    name: "13º salário",
    amountCents: 150000,
    monthId: "2026-11",
  });
  assert.equal(extraInc.status, 201);
  assert.equal((extraInc.json.month as { incomeCents: number }).incomeCents, 750000);

  // 2. Cartões: criar, editar atomicamente (nome + vencimento + fechamento)
  const cardCreate = await user.request("POST", "/api/cards", { name: "Nubank", dueDay: 10, closingDay: 3 });
  assert.equal(cardCreate.status, 201);
  const cardId = ((cardCreate.json.cards as Array<{ id: string }>)[0]!).id;

  const cardEdit = await user.request("PATCH", `/api/cards/${cardId}`, { name: "Nu Roxo", dueDay: 15, closingDay: 8 });
  assert.equal(cardEdit.status, 200);
  const editedCard = (cardEdit.json.cards as Array<{ name: string; dueDay: number; closingDay: number }>)[0]!;
  assert.equal(editedCard.name, "Nu Roxo");
  assert.equal(editedCard.dueDay, 15);
  assert.equal(editedCard.closingDay, 8);

  // 3. Custo de vida recorrente + pagamento parcial (Pix + Cartão) + encerramento atômico
  const fixedCreate = await user.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "Feira",
    section: "fixed",
    amountCents: 100000,
    payment: "pix",
    monthIds: ["2026-11", "2026-12", "2027-01"],
  });
  assert.equal(fixedCreate.status, 201);
  const feiraNov = (fixedCreate.json.expenses as Array<{ id: string; name: string }>).find((e) => e.name === "Feira")!;
  assert.ok(feiraNov);

  // Pagamento parcial no Pix
  const partialPix = await user.request("POST", `/api/expenses/${feiraNov.id}/partials`, {
    payment: "pix",
    amountCents: 30000,
  });
  assert.equal(partialPix.status, 201);

  // Pagamento parcial no cartão com parcelamento em 2x
  const partialCard = await user.request("POST", `/api/expenses/${feiraNov.id}/partials`, {
    payment: "card",
    amountCents: 40000,
    cardLabel: "Nu Roxo",
    installmentCount: 2,
    invoiceMonthId: "2026-11",
  });
  assert.equal(partialCard.status, 201);

  // Encerrar restante no Pix (atômico: cria parcial + marca paid = 1)
  const settled = await user.request("POST", `/api/expenses/${feiraNov.id}/settle`, { useRegistered: true });
  assert.equal(settled.status, 200);
  const feiraSettled = (settled.json.expenses as Array<{ id: string; paid: boolean; partials: unknown[] }>).find(
    (e) => e.id === feiraNov.id,
  )!;
  assert.equal(feiraSettled.paid, true);
  assert.equal(feiraSettled.partials.length, 3);

  // 4. Gasto no cartão em mês diferente da fatura (imprevisto de nov na fatura de dez, em 2x)
  const crossMonth = await user.request("POST", "/api/card-spend", {
    name: "Oficina",
    amountCents: 50000,
    classification: "imprevisto",
    cardLabel: "Nu Roxo",
    invoiceMonthId: "2026-12",
    costMonthId: "2026-11",
    purchaseDate: "2026-11-28",
    installmentCount: 2,
    amountMode: "total",
  });
  assert.equal(crossMonth.status, 201);
  const novExpenses = crossMonth.json.expenses as Array<{ name: string; section: string; amountCents: number }>;
  assert.ok(novExpenses.some((e) => e.name === "Oficina" && e.section === "extra" && e.amountCents === 50000));

  const decMonth = await user.request("GET", "/api/months/2026-12");
  assert.equal(decMonth.status, 200);
  const decExpenses = decMonth.json.expenses as Array<{ id: string; name: string; section: string; amountCents: number; installment: string | null }>;
  assert.ok(decExpenses.some((e) => e.name === "Oficina" && e.section === "card" && e.amountCents === 25000 && e.installment === "1/2"));

  // 5. Reclassificação de gasto no cartão (imprevisto -> planejado)
  const directCard = await user.request("POST", "/api/card-spend", {
    name: "Livro",
    amountCents: 8000,
    classification: "imprevisto",
    cardLabel: "Nu Roxo",
    invoiceMonthId: "2026-12",
  });
  assert.equal(directCard.status, 201);
  const livro = (directCard.json.expenses as Array<{ id: string; name: string }>).find((e) => e.name === "Livro")!;
  const reclassified = await user.request("POST", `/api/expenses/${livro.id}/classification`, {
    classification: "planejado",
    name: "Livro técnico",
    amountCents: 8500,
    cardLabel: "Nu Roxo",
    note: "estudo",
  });
  assert.equal(reclassified.status, 200);
  assert.ok(
    (reclassified.json.expenses as Array<{ id: string; name: string; amountCents: number; note: string | null }>).some(
      (e) => e.id === livro.id && e.name === "Livro técnico" && e.amountCents === 8500 && (e.note ?? "").includes("tipo:planejado"),
    ),
  );

  // 6. Edição de série de custo de vida (forward a partir de dez/2026)
  const feiraDec = decExpenses.find((e) => e.name === "Feira" && e.section === "fixed")!;
  const seriesEdit = await user.request("PATCH", `/api/expenses/${feiraDec.id}`, {
    name: "Mercado",
    section: "fixed",
    amountCents: 120000,
    payment: "pix",
    editScope: "forward",
  });
  assert.equal(seriesEdit.status, 200);
  const janMonth = await user.request("GET", "/api/months/2027-01");
  assert.ok(
    (janMonth.json.expenses as Array<{ name: string; amountCents: number }>).some(
      (e) => e.name === "Mercado" && e.amountCents === 120000,
    ),
  );

  // 7. Quitação e estorno de fatura do cartão
  const payoff = await user.request("POST", `/api/cards/${cardId}/payoff`, {
    monthId: "2026-12",
    mode: "pix",
  });
  assert.equal(payoff.status, 200);
  const undoPayoff = await user.request("POST", `/api/cards/${cardId}/payoff`, {
    monthId: "2026-12",
    mode: "undo",
  });
  assert.equal(undoPayoff.status, 200);

  // 8. Exclusão de série remove todos os meses vinculados
  const delSeries = await user.request("DELETE", `/api/expenses/${feiraDec.id}?scope=series`);
  assert.equal(delSeries.status, 200);
  const janAfterDel = await user.request("GET", "/api/months/2027-01");
  assert.ok(!(janAfterDel.json.expenses as Array<{ name: string }>).some((e) => e.name === "Mercado"));

  // 9. Reset de um mês limpa lançamentos do mês alvo
  const reset = await user.request("POST", "/api/reset", { scope: "month", monthId: "2026-12" });
  assert.equal(reset.status, 200);
  assert.equal((reset.json.expenses as unknown[]).length, 0);
});

test("metadados relacionais indexados: escrita, busca /purchases, exclusão por partial_id, finalized_zero e backfill legado", async () => {
  const env = createTestEnv();
  const user = createClient(env, "198.51.100.5");
  await registerUser(user, "52998224725", "meta@example.com");
  assert.equal((await user.request("POST", "/api/period", { startMonthId: "2026-11", endMonthId: "2027-02" })).status, 200);
  assert.equal((await user.request("POST", "/api/cards", { name: "Itaú", dueDay: 12, closingDay: 5 })).status, 201);

  // Compra entre meses deve popular reference_month_id, invoice_month_id, purchase_date, origin_expense_id, series_id e track
  const spend = await user.request("POST", "/api/card-spend", {
    name: "Pneu",
    amountCents: 60000,
    classification: "planejado",
    cardLabel: "Itaú",
    invoiceMonthId: "2026-12",
    costMonthId: "2026-11",
    purchaseDate: "2026-11-29",
    installmentCount: 2,
    amountMode: "total",
  });
  assert.equal(spend.status, 201);

  const anchorRow = await env.DB.prepare(
    "SELECT id, series_id, track, invoice_month_id, reference_month_id FROM expenses WHERE name = 'Pneu' AND section = 'extra'",
  ).first<{ id: string; series_id: string | null; track: string | null; invoice_month_id: string | null; reference_month_id: string | null }>();
  assert.ok(anchorRow?.series_id);
  assert.equal(anchorRow?.track, "planejado");
  assert.equal(anchorRow?.invoice_month_id, "2026-12");
  assert.equal(anchorRow?.reference_month_id, "2026-11");

  const cardLine = await env.DB.prepare(
    "SELECT origin_expense_id, purchase_date, reference_month_id, track FROM expenses WHERE name = 'Pneu' AND section = 'card' AND month_id = '2026-12'",
  ).first<{ origin_expense_id: string | null; purchase_date: string | null; reference_month_id: string | null; track: string | null }>();
  assert.equal(cardLine?.origin_expense_id, anchorRow?.id);
  assert.equal(cardLine?.purchase_date, "2026-11-29");
  assert.equal(cardLine?.reference_month_id, "2026-11");
  assert.equal(cardLine?.track, "planejado");

  // GET /api/months/:id/purchases usa índice em reference_month_id
  const purchases = await user.request("GET", "/api/months/2026-11/purchases");
  assert.equal(purchases.status, 200);
  assert.ok((purchases.json.items as Array<{ name: string }>).some((p) => p.name === "Pneu"));

  // Custo de vida: parcial no cartão popula partial_id e origin_expense_id; exclusão do parcial remove via partial_id
  const fixedRes = await user.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "Água",
    section: "fixed",
    amountCents: 12000,
    payment: "pix",
  });
  assert.equal(fixedRes.status, 201);
  const agua = (fixedRes.json.expenses as Array<{ id: string; name: string }>).find((e) => e.name === "Água")!;

  const partialRes = await user.request("POST", `/api/expenses/${agua.id}/partials`, {
    payment: "card",
    amountCents: 5000,
    cardLabel: "Itaú",
    installmentCount: 1,
    invoiceMonthId: "2026-11",
  });
  assert.equal(partialRes.status, 201);
  const partialCardLine = await env.DB.prepare(
    "SELECT partial_id, origin_expense_id FROM expenses WHERE section = 'card' AND origin_expense_id = ?",
  ).bind(agua.id).first<{ partial_id: string | null; origin_expense_id: string | null }>();
  assert.ok(partialCardLine?.partial_id);
  assert.equal(partialCardLine?.origin_expense_id, agua.id);

  const delPartial = await user.request("DELETE", `/api/expenses/${agua.id}/partials/${partialCardLine!.partial_id}`);
  assert.equal(delPartial.status, 200);
  const afterDelPartial = await env.DB.prepare(
    "SELECT id FROM expenses WHERE partial_id = ?",
  ).bind(partialCardLine!.partial_id).first();
  assert.equal(afterDelPartial, null);

  // Finalizar sem gasto adicional marca finalized_zero = 1 e desfazer volta para 0
  const zeroSettle = await user.request("POST", `/api/expenses/${agua.id}/settle`, { noAddition: true });
  assert.equal(zeroSettle.status, 200);
  const settledRow = await env.DB.prepare("SELECT finalized_zero FROM expenses WHERE id = ?").bind(agua.id).first<{ finalized_zero: number }>();
  assert.equal(settledRow?.finalized_zero, 1);

  const undoZero = await user.request("DELETE", `/api/expenses/${agua.id}/payments?scope=all`);
  assert.equal(undoZero.status, 200);
  const reopenedRow = await env.DB.prepare("SELECT finalized_zero FROM expenses WHERE id = ?").bind(agua.id).first<{ finalized_zero: number }>();
  assert.equal(reopenedRow?.finalized_zero, 0);

  // Backfill idempotente preenche colunas relacionais de linhas legadas que só tinham note
  const { backfillExpenseMetadata } = await import("../src/db.ts");
  await env.DB.prepare(
    `INSERT INTO expenses
      (id, owner_id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
     VALUES ('legacy-1', 'owner-legacy', '2026-12', 'Legado', 'card', 9900, 'card', 0, 'Itaú', 0, 'serie:s-1\norigem:orig-1\nparcial:p-1\ncompra:2026-11-15\ntipo:planejado', NULL, 1, 'user', '2026-11-15T00:00:00.000Z')`,
  ).run();
  const updatedCount = await backfillExpenseMetadata(env.DB);
  assert.ok(updatedCount >= 1);
  const backfilled = await env.DB.prepare(
    "SELECT series_id, origin_expense_id, partial_id, purchase_date, reference_month_id, track FROM expenses WHERE id = 'legacy-1'",
  ).first<{
    series_id: string | null;
    origin_expense_id: string | null;
    partial_id: string | null;
    purchase_date: string | null;
    reference_month_id: string | null;
    track: string | null;
  }>();
  assert.deepEqual(backfilled, {
    series_id: "s-1",
    origin_expense_id: "orig-1",
    partial_id: "p-1",
    purchase_date: "2026-11-15",
    reference_month_id: "2026-11",
    track: "planejado",
  });
});

test("exclusão em lote de gastos (bulk-delete) e exclusão permanente de cartão mesmo com gastos vinculados", async () => {
  const env = createTestEnv();
  const user = createClient(env, "198.51.100.88");
  assert.equal((await user.request("POST", "/api/register", {
    cpf: "52998224725",
    email: "bulk-delete@teste.com",
    password: "segredo-forte-123",
    passwordConfirmation: "segredo-forte-123",
  })).status, 201);
  assert.equal((await user.request("POST", "/api/period", { startMonthId: "2026-11", endMonthId: "2026-12" })).status, 200);

  const cardRes = await user.request("POST", "/api/cards", { name: "Nubank", dueDay: 10, closingDay: 2 });
  assert.equal(cardRes.status, 201);
  const cardId = (cardRes.json.cards as Array<{ id: string; name: string }>)[0]!.id;

  // Cria 2 custos de vida (um no Pix, um previsto no Nubank) + 3 gastos no cartão
  const fixed1 = await user.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "Água",
    section: "fixed",
    amountCents: 10000,
    payment: "pix",
  });
  assert.equal(fixed1.status, 201);
  const fixed2 = await user.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "Mercado",
    section: "fixed",
    amountCents: 50000,
    payment: "card",
    cardLabel: "Nubank",
  });
  assert.equal(fixed2.status, 201);

  for (const [name, amountCents] of [["Café", 1500], ["Padaria", 2500], ["Farmácia", 8000]] as const) {
    assert.equal((await user.request("POST", "/api/card-spend", {
      name,
      amountCents,
      classification: "imprevisto",
      cardLabel: "Nubank",
      invoiceMonthId: "2026-11",
      costMonthId: "2026-11",
    })).status, 201);
  }

  const novBefore = await user.request("GET", "/api/months/2026-11");
  const all = novBefore.json.expenses as Array<{ id: string; name: string; section: string; cardLabel: string | null }>;
  const agua = all.find((e) => e.name === "Água")!;
  const mercado = all.find((e) => e.name === "Mercado")!;
  const cafe = all.find((e) => e.name === "Café")!;
  const padaria = all.find((e) => e.name === "Padaria")!;
  const farmacia = all.find((e) => e.name === "Farmácia")!;
  assert.ok(agua && mercado && cafe && padaria && farmacia);

  // Vincula um pagamento parcial no cartão Nubank ao Custo de vida Mercado
  const partialRes = await user.request("POST", `/api/expenses/${mercado.id}/partials`, {
    amountCents: 12000,
    payment: "card",
    cardLabel: "Nubank",
    invoiceMonthId: "2026-11",
  });
  assert.equal(partialRes.status, 201);

  // 1) Exclui em lote (bulk-delete): Café + Padaria + Água
  const bulk = await user.request("POST", "/api/expenses/bulk-delete", {
    ids: [cafe.id, padaria.id, agua.id],
    monthId: "2026-11",
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.json.deletedCount, 3);
  const afterBulk = bulk.json.expenses as typeof all;
  assert.ok(!afterBulk.some((e) => e.id === cafe.id || e.id === padaria.id || e.id === agua.id));
  assert.ok(afterBulk.some((e) => e.id === farmacia.id));

  // 2) Exclui o cartão Nubank mesmo ainda contendo gastos (Farmácia + parcial de Mercado)
  const delCard = await user.request("DELETE", `/api/cards/${cardId}?monthId=2026-11`);
  assert.equal(delCard.status, 200);
  assert.equal((delCard.json.cards as unknown[]).length, 0);
  assert.ok(Number(delCard.json.deletedExpenses) >= 2);
  const afterCard = delCard.json.expenses as Array<{
    id: string;
    name: string;
    section: string;
    payment: string;
    cardLabel: string | null;
    partials?: unknown[];
  }>;
  assert.ok(!afterCard.some((e) => e.id === farmacia.id));
  // O custo de vida Mercado permanece salvo, desvinculado do cartão excluído e sem parciais órfãs
  const mercadoAfter = afterCard.find((e) => e.id === mercado.id);
  assert.ok(mercadoAfter);
  assert.equal(mercadoAfter.payment, "pix");
  assert.equal(mercadoAfter.cardLabel, null);
  assert.equal((mercadoAfter.partials || []).length, 0);

  // 3) Confirma inOtherMonths (false para despesa só de um mês, true para recorrente) e bulk-delete de 30 itens em lote único
  const singleRes = await user.request("POST", "/api/expenses", {
    monthId: "2026-11",
    name: "Despesa Única Nov",
    section: "fixed",
    amountCents: 5000,
    payment: "pix",
  });
  assert.equal(singleRes.status, 201);
  const recRes = await user.request("POST", "/api/expenses", {
    monthId: "2026-11",
    monthIds: ["2026-11", "2026-12"],
    name: "Internet Mensal",
    section: "fixed",
    amountCents: 9900,
    payment: "pix",
  });
  assert.equal(recRes.status, 201);

  const novCheck = await user.request("GET", "/api/months/2026-11");
  const novItems = novCheck.json.expenses as Array<{ id: string; name: string; inOtherMonths?: boolean }>;
  assert.equal(novItems.find((e) => e.name === "Despesa Única Nov")?.inOtherMonths, false);
  assert.equal(novItems.find((e) => e.name === "Internet Mensal")?.inOtherMonths, true);

  const manyIds: string[] = [];
  for (let i = 1; i <= 30; i += 1) {
    const r = await user.request("POST", "/api/expenses", {
      monthId: "2026-11",
      name: `Lote ${i}`,
      section: "extra",
      amountCents: 1000,
      payment: "pix",
    });
    assert.equal(r.status, 201);
  }
  const beforeMany = await user.request("GET", "/api/months/2026-11");
  for (const e of beforeMany.json.expenses as Array<{ id: string; name: string }>) {
    if (e.name.startsWith("Lote ")) manyIds.push(e.id);
  }
  assert.equal(manyIds.length, 30);
  const bulkMany = await user.request("POST", "/api/expenses/bulk-delete", { ids: manyIds, monthId: "2026-11" });
  assert.equal(bulkMany.status, 200);
  assert.equal(bulkMany.json.deletedCount, 30);
  assert.ok(!(bulkMany.json.expenses as Array<{ name: string }>).some((e) => e.name.startsWith("Lote ")));
});

