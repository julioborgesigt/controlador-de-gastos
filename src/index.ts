import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import {
  clearFailures,
  hashSecret,
  lockedMessage,
  nextFailure,
  parseCpf,
  parseEmail,
  parsePassword,
  randomBytes,
  randomToken,
  safeEqual,
  sessionCookieOptions,
  sessionExpiry,
  sha256,
} from "./auth.ts";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { loginOptions, loginWithPasskey, registerPasskey, registrationOptions } from "./passkeys.ts";
import {
  cardLinkRequired,
  countsTowardPayment,
  normalizeExpense,
  parseCardName,
  parseInstallment,
  resolveCardLabel,
  type Payment,
  type Section,
} from "./domain.ts";
import {
  applyBaseIncome,
  copyFromPreviousMonth,
  countUsers,
  createCard,
  createUser,
  deletePasskey,
  deleteUserPasskeys,
  ensureReady,
  findUserByCpf,
  findUserById,
  getExpense,
  getMonth,
  getSetting,
  insertCardPurchase,
  listCards,
  listPasskeys,
  monthPayload,
  setMonthIncome,
  setSetting,
  unlockMonthIncome,
  updatePassword,
} from "./db.ts";

const COOKIE = "gastos_session";
const AUTH_ERROR = "Entre com CPF e senha.";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Origem recusada." }, 403);
    }
    const length = Number(c.req.header("content-length") || 0);
    if (length > 20_000) return c.json({ error: "Pedido grande demais." }, 413);
  }
  try {
    await ensureReady(c.env.DB);
  } catch (error) {
    console.error(JSON.stringify({ message: "database_init_failed", error: error instanceof Error ? error.message : "unknown" }));
    return c.json({ error: "Não foi possível abrir o banco de gastos." }, 500);
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/session", async (c) => {
  const needsSetup = (await countUsers(c.env.DB)) === 0;
  const authenticated = await isAuthenticated(c.env.DB, getCookie(c, COOKIE));
  return c.json({ needsSetup, authenticated });
});

app.post("/api/register", async (c) => {
  const body = await readJson(c);
  const cpf = parseCpf(body.cpf);
  if (!cpf.ok) return c.json({ error: cpf.error }, 400);
  const email = parseEmail(body.email);
  if (!email.ok) return c.json({ error: email.error }, 400);
  const password = parsePassword(body.password);
  if (!password.ok) return c.json({ error: password.error }, 400);
  if (body.passwordConfirmation !== password.password) {
    return c.json({ error: "A confirmação da senha não confere." }, 400);
  }
  const salt = randomBytes(16);
  const created = await createUser(c.env.DB, {
    cpf: cpf.cpf,
    email: email.email,
    passwordHash: await hashSecret(password.password, salt),
    passwordSalt: toHex(salt),
  });
  if (!created.ok) return c.json({ error: created.error }, 409);
  await startSession(c, created.id);
  return c.json({ ok: true }, 201);
});

app.post("/api/login", async (c) => {
  const body = await readJson(c);
  const cpf = parseCpf(body.cpf);
  const password = parsePassword(body.password);
  if (!cpf.ok || !password.ok) return c.json({ error: "CPF ou senha incorretos." }, 401);
  const failures = await failureState(c.env.DB, cpf.cpf);
  const locked = lockedMessage(failures);
  if (locked) return c.json({ error: locked }, 429);
  const user = await findUserByCpf(c.env.DB, cpf.cpf);
  const actual = await hashSecret(password.password, user ? fromHex(user.passwordSalt) : new Uint8Array(16));
  if (!user || !safeEqual(actual, user.passwordHash)) {
    const updated = nextFailure(failures);
    await setSetting(c.env.DB, failureKey(cpf.cpf), JSON.stringify(updated));
    return c.json({ error: lockedMessage(updated) ?? "CPF ou senha incorretos." }, 401);
  }
  await setSetting(c.env.DB, failureKey(cpf.cpf), JSON.stringify(clearFailures()));
  await startSession(c, user.id);
  return c.json({ ok: true });
});

app.post("/api/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  }
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.post("/api/password", async (c) => {
  const user = await currentAccount(c);
  if (!user) return c.json({ error: AUTH_ERROR }, 401);
  const body = await readJson(c);
  const next = parsePassword(body.nextPassword);
  if (!next.ok) return c.json({ error: next.error }, 400);
  if (body.passwordConfirmation !== next.password) {
    return c.json({ error: "A confirmação da senha não confere." }, 400);
  }
  if (typeof body.currentPassword !== "string") return c.json({ error: "Senha atual incorreta." }, 401);
  const actual = await hashSecret(body.currentPassword, fromHex(user.passwordSalt));
  if (!safeEqual(actual, user.passwordHash)) return c.json({ error: "Senha atual incorreta." }, 401);
  const salt = randomBytes(16);
  await updatePassword(c.env.DB, user.id, await hashSecret(next.password, salt), toHex(salt));
  const passkeysRemoved = (await deleteUserPasskeys(c.env.DB, user.id)) > 0;
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  await startSession(c, user.id);
  return c.json({ ok: true, passkeysRemoved });
});

app.get("/api/passkeys", async (c) => {
  const user = await currentAccount(c);
  if (!user) return c.json({ error: AUTH_ERROR }, 401);
  return c.json({ passkeys: publicPasskeys(await listPasskeys(c.env.DB, user.id)) });
});

app.post("/api/passkeys/register/options", async (c) => {
  const user = await currentAccount(c);
  if (!user) return c.json({ error: AUTH_ERROR }, 401);
  const created = await registrationOptions(c.env.DB, user, c.req.url);
  if (!created.ok) return c.json({ error: created.error }, 400);
  return c.json(created.options);
});

app.post("/api/passkeys/register", async (c) => {
  const user = await currentAccount(c);
  if (!user) return c.json({ error: AUTH_ERROR }, 401);
  const body = await readJson(c);
  if (!isRegistrationResponse(body)) return c.json({ error: "Resposta da digital inválida." }, 400);
  const saved = await registerPasskey(c.env.DB, user.id, body, c.req.url);
  if (!saved.ok) return c.json({ error: saved.error }, 400);
  return c.json({ passkeys: publicPasskeys(await listPasskeys(c.env.DB, user.id)) }, 201);
});

app.post("/api/passkeys/login/options", async (c) => {
  return c.json(await loginOptions(c.env.DB, c.req.url));
});

app.post("/api/passkeys/login", async (c) => {
  const body = await readJson(c);
  if (!isAuthenticationResponse(body)) return c.json({ error: "Resposta da digital inválida." }, 400);
  const logged = await loginWithPasskey(c.env.DB, body, c.req.url);
  if (!logged.ok) return c.json({ error: logged.error }, 401);
  await startSession(c, logged.userId);
  return c.json({ ok: true });
});

app.delete("/api/passkeys/:id", async (c) => {
  const user = await currentAccount(c);
  if (!user) return c.json({ error: AUTH_ERROR }, 401);
  const removed = await deletePasskey(c.env.DB, c.req.param("id"), user.id);
  if (!removed) return c.json({ error: "Digital não encontrada." }, 404);
  return c.json({ passkeys: publicPasskeys(await listPasskeys(c.env.DB, user.id)) });
});

app.get("/api/months/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const payload = await monthPayload(c.env.DB, c.req.param("id"));
  if (!payload) return c.json({ error: "Mês não encontrado." }, 404);
  return c.json(payload);
});

app.patch("/api/months/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const monthId = c.req.param("id");
  const month = await getMonth(c.env.DB, monthId);
  if (!month) return c.json({ error: "Mês não encontrado." }, 404);
  const body = await readJson(c);
  if (!isCents(body.incomeCents) || body.incomeCents < 0) return c.json({ error: "Informe a receita em centavos." }, 400);
  await setMonthIncome(c.env.DB, monthId, body.incomeCents);
  return c.json(await monthPayload(c.env.DB, monthId));
});

app.post("/api/months/:id/use-base-income", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const monthId = c.req.param("id");
  if (!(await getMonth(c.env.DB, monthId))) return c.json({ error: "Mês não encontrado." }, 404);
  await unlockMonthIncome(c.env.DB, monthId);
  return c.json(await monthPayload(c.env.DB, monthId));
});

app.post("/api/income/base", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const body = await readJson(c);
  if (!isCents(body.amountCents) || body.amountCents < 0) return c.json({ error: "Informe a receita base." }, 400);
  const scope = body.scope === "all" ? "all" : "unlocked";
  await applyBaseIncome(c.env.DB, body.amountCents, scope);
  const monthId = typeof body.monthId === "string" ? body.monthId : "2026-11";
  return c.json(await monthPayload(c.env.DB, monthId));
});

app.post("/api/income/extras", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const body = await readJson(c);
  const kind = body.kind;
  if (kind !== "ir" && kind !== "thirteenth" && kind !== "vacation" && kind !== "other") {
    return c.json({ error: "Escolha o tipo da receita extra." }, 400);
  }
  if (!isCents(body.amountCents) || body.amountCents <= 0) return c.json({ error: "Informe o valor da receita extra." }, 400);
  if (typeof body.monthId !== "string" || !(await getMonth(c.env.DB, body.monthId))) {
    return c.json({ error: "Escolha o mês previsto." }, 400);
  }
  const name = incomeExtraName(kind, body.name);
  if (!name) return c.json({ error: "Dê um nome para essa receita." }, 400);
  await c.env.DB.prepare(
    "INSERT INTO income_extras (id, kind, name, amount_cents, month_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), kind, name, body.amountCents, body.monthId, new Date().toISOString())
    .run();
  return c.json(await monthPayload(c.env.DB, body.monthId), 201);
});

app.delete("/api/income/extras/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const current = await c.env.DB.prepare("SELECT month_id FROM income_extras WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ month_id: string }>();
  if (!current) return c.json({ error: "Receita extra não encontrada." }, 404);
  await c.env.DB.prepare("DELETE FROM income_extras WHERE id = ?").bind(c.req.param("id")).run();
  return c.json(await monthPayload(c.env.DB, current.month_id));
});

app.post("/api/months/:id/copy", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const monthId = c.req.param("id");
  if (!(await getMonth(c.env.DB, monthId))) return c.json({ error: "Mês não encontrado." }, 404);
  const copied = await copyFromPreviousMonth(c.env.DB, monthId);
  const payload = await monthPayload(c.env.DB, monthId);
  return c.json({ copied, ...payload });
});

app.post("/api/months/:id/settle", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const monthId = c.req.param("id");
  const month = await getMonth(c.env.DB, monthId);
  if (!month) return c.json({ error: "Mês não encontrado." }, 404);
  const body = await readJson(c);
  if (body.mode === "pay-remaining") {
    await c.env.DB.prepare(
      `UPDATE expenses
       SET paid = 1
       WHERE month_id = ?
         AND amount_cents != 0
         AND NOT (section = 'fixed' AND (on_card = 1 OR payment = 'card'))`,
    )
      .bind(monthId)
      .run();
  } else if (body.mode === "reopen") {
    await c.env.DB.prepare("UPDATE expenses SET paid = 0 WHERE month_id = ?").bind(monthId).run();
    await c.env.DB.prepare("UPDATE months SET settled = 0 WHERE id = ?").bind(monthId).run();
  } else {
    return c.json({ error: "Ação de baixa desconhecida." }, 400);
  }
  return c.json(await monthPayload(c.env.DB, monthId));
});

app.post("/api/cards", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const body = await readJson(c);
  const parsed = parseCardName(body.name);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const created = await createCard(c.env.DB, parsed.name);
  if (!created.ok) return c.json({ error: created.error }, 409);
  return c.json({ cards: await listCards(c.env.DB) }, 201);
});

app.post("/api/expenses", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const body = await readJson(c);
  const parsed = await expenseWithCard(c.env.DB, body);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  if (!isMonthId(body.monthId) || !(await getMonth(c.env.DB, body.monthId))) {
    return c.json({ error: "Mês não encontrado." }, 404);
  }
  const plan = readInstallmentPlan(body.installmentPlan);
  if (plan) {
    if (!plan.ok) return c.json({ error: plan.error }, 400);
    const created = await insertCardPurchase(c.env.DB, {
      startMonthId: body.monthId,
      name: parsed.value.name,
      section: parsed.value.section === "fixed" ? "card" : parsed.value.section,
      payment: "card",
      cardLabel: parsed.value.cardLabel,
      note: parsed.value.note,
      totalCount: plan.totalCount,
      paidCount: plan.paidCount,
      amountCents: parsed.value.amountCents,
      mode: plan.mode,
    });
    if (!created.ok) return c.json({ error: created.error }, 400);
    return c.json(await monthPayload(c.env.DB, body.monthId), 201);
  }
  const sort = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM expenses WHERE month_id = ?")
    .bind(body.monthId)
    .first<{ next: number }>();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO expenses
      (id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, installment, sort_order, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?)`,
  )
    .bind(
      id,
      body.monthId,
      parsed.value.name,
      parsed.value.section,
      parsed.value.amountCents,
      parsed.value.payment,
      parsed.value.onCard ? 1 : 0,
      parsed.value.cardLabel,
      parsed.value.paid ? 1 : 0,
      parsed.value.note,
      parsed.value.installment,
      sort?.next ?? 1000,
      new Date().toISOString(),
    )
    .run();
  return c.json(await monthPayload(c.env.DB, body.monthId), 201);
});

app.patch("/api/expenses/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const current = await getExpense(c.env.DB, c.req.param("id"));
  if (!current) return c.json({ error: "Gasto não encontrado." }, 404);
  const body = await readJson(c);
  const parsed = await expenseWithCard(c.env.DB, {
    name: body.name ?? current.name,
    amountCents: body.amountCents ?? current.amountCents,
    section: body.section ?? current.section,
    payment: body.payment ?? current.payment,
    onCard: body.onCard ?? current.onCard,
    cardLabel: body.cardLabel === undefined ? current.cardLabel : body.cardLabel,
    note: body.note === undefined ? current.note : body.note,
    installment: body.installment === undefined ? current.installment : body.installment,
    paid: body.paid ?? current.paid,
  });
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  await c.env.DB.prepare(
    `UPDATE expenses
     SET name = ?, section = ?, amount_cents = ?, payment = ?, on_card = ?, card_label = ?, paid = ?, note = ?, installment = ?
     WHERE id = ?`,
  )
    .bind(
      parsed.value.name,
      parsed.value.section,
      parsed.value.amountCents,
      parsed.value.payment,
      parsed.value.onCard ? 1 : 0,
      parsed.value.cardLabel,
      parsed.value.paid ? 1 : 0,
      parsed.value.note,
      parsed.value.installment,
      current.id,
    )
    .run();
  return c.json(await monthPayload(c.env.DB, current.monthId));
});

app.delete("/api/expenses/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com CPF e senha." }, 401);
  const current = await getExpense(c.env.DB, c.req.param("id"));
  if (!current) return c.json({ error: "Gasto não encontrado." }, 404);
  await c.env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(current.id).run();
  return c.json(await monthPayload(c.env.DB, current.monthId));
});

app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Caminho não encontrado." }, 404);
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(asset.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
});

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;

type ExpenseDraft = {
  name: string;
  amountCents: number;
  section: Section;
  payment: Payment;
  onCard: boolean;
  cardLabel: string | null;
  note: string | null;
  installment: string | null;
  paid: boolean;
};

async function expenseWithCard(
  db: D1Database,
  body: JsonBody,
): Promise<{ ok: true; value: ExpenseDraft } | { ok: false; error: string; status: 400 }> {
  const parsed = parseExpenseBody(body);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const linked = resolveCardLabel(await listCards(db), parsed.value.cardLabel, cardLinkRequired(parsed.value));
  if (!linked.ok) return { ok: false, error: linked.error, status: 400 };
  return { ok: true, value: { ...parsed.value, cardLabel: linked.cardLabel } };
}

function parseExpenseBody(body: JsonBody): { ok: true; value: ExpenseDraft } | { ok: false; error: string } {
  if (!isSection(body.section) || !isPayment(body.payment)) {
    return { ok: false, error: "Tipo ou forma de pagamento inválido." };
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.trim().length > 120) {
    return { ok: false, error: "Dê um nome ao gasto, com até 120 caracteres." };
  }
  if (!isCents(body.amountCents)) return { ok: false, error: "Informe um valor válido." };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const installment = parseInstallment(body.installment);
  if (!installment.ok) return installment;
  const normalized = normalizeExpense({
    section: body.section,
    payment: body.payment,
    onCard: body.onCard === true,
    cardLabel: typeof body.cardLabel === "string" ? body.cardLabel : null,
  });
  const paid = body.paid === true && countsTowardPayment({ ...normalized, amountCents: body.amountCents });
  return {
    ok: true,
    value: {
      name: body.name.trim(),
      amountCents: body.amountCents,
      note: note.length > 0 ? note : null,
      installment: installment.value,
      paid,
      ...normalized,
    },
  };
}

function publicPasskeys(rows: Array<{ id: string; createdAt: string }>) {
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt }));
}

function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const response = record.response;
  if (!response || typeof response !== "object") return false;
  const attestation = response as Record<string, unknown>;
  return record.type === "public-key"
    && typeof record.id === "string"
    && typeof record.rawId === "string"
    && typeof attestation.clientDataJSON === "string"
    && typeof attestation.attestationObject === "string";
}

function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const response = record.response;
  if (!response || typeof response !== "object") return false;
  const assertion = response as Record<string, unknown>;
  return record.type === "public-key"
    && typeof record.id === "string"
    && typeof record.rawId === "string"
    && typeof assertion.clientDataJSON === "string"
    && typeof assertion.authenticatorData === "string"
    && typeof assertion.signature === "string";
}

function isSection(value: unknown): value is Section {
  return value === "card" || value === "fixed" || value === "extra";
}

function incomeExtraName(kind: "ir" | "thirteenth" | "vacation" | "other", name: unknown): string {
  if (kind === "ir") return "Imposto de renda";
  if (kind === "thirteenth") return "Décimo terceiro";
  if (kind === "vacation") return "Férias";
  return typeof name === "string" ? name.trim().slice(0, 80) : "";
}

function readInstallmentPlan(value: unknown): { ok: true; totalCount: number; paidCount: number; mode: "installment" | "total" } | { ok: false; error: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as { totalCount?: unknown; paidCount?: unknown; amountMode?: unknown };
  if (typeof plan.totalCount !== "number" || typeof plan.paidCount !== "number") {
    return { ok: false, error: "Informe a quantidade de parcelas e quantas já foram pagas." };
  }
  if (plan.amountMode !== "installment" && plan.amountMode !== "total") {
    return { ok: false, error: "Diga se o valor é da parcela ou do total." };
  }
  return { ok: true, totalCount: plan.totalCount, paidCount: plan.paidCount, mode: plan.amountMode };
}

function isPayment(value: unknown): value is Payment {
  return value === "pix" || value === "card" || value === "debit" || value === "cash";
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= -100_000_000 && value <= 100_000_000;
}

function isMonthId(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

type FailureState = { count: number; lockedUntil: string | null };

function failureKey(cpf: string): string {
  return `login_failures:${cpf}`;
}

async function failureState(db: D1Database, cpf: string): Promise<FailureState> {
  const raw = await getSetting(db, failureKey(cpf));
  if (!raw) return clearFailures();
  try {
    const parsed = JSON.parse(raw) as FailureState;
    if (typeof parsed.count !== "number") return clearFailures();
    return { count: parsed.count, lockedUntil: typeof parsed.lockedUntil === "string" ? parsed.lockedUntil : null };
  } catch {
    return clearFailures();
  }
}

async function isAuthenticated(db: D1Database, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const id = await sha256(token);
  const row = await db.prepare("SELECT expires_at, user_id FROM sessions WHERE id = ?").bind(id).first<{
    expires_at: string;
    user_id: string | null;
  }>();
  if (!row?.user_id) return false;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return false;
  }
  return true;
}

async function currentAccount(c: AppContext) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const id = await sha256(token);
  const row = await c.env.DB.prepare("SELECT expires_at, user_id FROM sessions WHERE id = ?").bind(id).first<{
    expires_at: string;
    user_id: string | null;
  }>();
  if (!row?.user_id || Date.parse(row.expires_at) <= Date.now()) return null;
  return findUserById(c.env.DB, row.user_id);
}

type AppContext = Context<{ Bindings: Env }>;

async function requireAuth(c: AppContext): Promise<boolean> {
  return isAuthenticated(c.env.DB, getCookie(c, COOKIE));
}

async function startSession(c: AppContext, userId: string): Promise<void> {
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (id, expires_at, user_id) VALUES (?, ?, ?)").bind(
    await sha256(token),
    sessionExpiry(),
    userId,
  ).run();
  setCookie(c, COOKIE, token, sessionCookieOptions(c.req.url));
}

type JsonBody = Record<string, unknown> & {
  cpf?: unknown;
  email?: unknown;
  password?: unknown;
  passwordConfirmation?: unknown;
  currentPassword?: unknown;
  nextPassword?: unknown;
  monthId?: unknown;
  incomeCents?: unknown;
  mode?: unknown;
  name?: unknown;
  amountCents?: unknown;
  section?: unknown;
  payment?: unknown;
  onCard?: unknown;
  cardLabel?: unknown;
  note?: unknown;
  installment?: unknown;
  installmentPlan?: unknown;
  scope?: unknown;
  kind?: unknown;
  paid?: unknown;
};

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<JsonBody> {
  try {
    const value = await c.req.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonBody;
  } catch {
    return {};
  }
  return {};
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
