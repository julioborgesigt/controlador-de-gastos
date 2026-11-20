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

  // Cartão em uso não pode ser excluído
  const deleteBusyCard = await user.request("DELETE", `/api/cards/${cardId}`);
  assert.equal(deleteBusyCard.status, 409);

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
