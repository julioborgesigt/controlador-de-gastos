import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import {
  clearFailures,
  hashPin,
  isValidPin,
  lockedMessage,
  nextFailure,
  randomBytes,
  randomToken,
  safeEqual,
  sessionCookieOptions,
  sessionExpiry,
  sha256,
} from "./auth.ts";
import { countsTowardPayment, normalizeExpense, type Payment, type Section } from "./domain.ts";
import {
  ensureReady,
  getExpense,
  getMonth,
  getSetting,
  monthPayload,
  setSetting,
} from "./db.ts";

const COOKIE = "gastos_session";
const FAILURE_KEY = "login_failures";

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
  const needsSetup = (await getSetting(c.env.DB, "pin_hash")) === null;
  const authenticated = needsSetup ? false : await isAuthenticated(c.env.DB, getCookie(c, COOKIE));
  return c.json({ needsSetup, authenticated });
});

app.post("/api/setup", async (c) => {
  if ((await getSetting(c.env.DB, "pin_hash")) !== null) {
    return c.json({ error: "O PIN já foi criado." }, 409);
  }
  const body = await readJson(c);
  if (!isValidPin(body.pin)) return c.json({ error: "Use um PIN de 4 a 8 dígitos." }, 400);
  const salt = randomBytes(16);
  const hash = await hashPin(body.pin, salt);
  await setSetting(c.env.DB, "pin_salt", toHex(salt));
  await setSetting(c.env.DB, "pin_hash", hash);
  await setSetting(c.env.DB, FAILURE_KEY, JSON.stringify(clearFailures()));
  await startSession(c);
  return c.json({ ok: true });
});

app.post("/api/login", async (c) => {
  const body = await readJson(c);
  const failures = await failureState(c.env.DB);
  const locked = lockedMessage(failures);
  if (locked) return c.json({ error: locked }, 429);
  if (!isValidPin(body.pin)) {
    await setSetting(c.env.DB, FAILURE_KEY, JSON.stringify(nextFailure(failures)));
    return c.json({ error: "PIN incorreto." }, 401);
  }
  const saltHex = await getSetting(c.env.DB, "pin_salt");
  const expected = await getSetting(c.env.DB, "pin_hash");
  if (!saltHex || !expected) return c.json({ error: "Crie um PIN primeiro." }, 409);
  const actual = await hashPin(body.pin, fromHex(saltHex));
  if (!safeEqual(actual, expected)) {
    const updated = nextFailure(failures);
    await setSetting(c.env.DB, FAILURE_KEY, JSON.stringify(updated));
    return c.json({ error: lockedMessage(updated) ?? "PIN incorreto." }, 401);
  }
  await setSetting(c.env.DB, FAILURE_KEY, JSON.stringify(clearFailures()));
  await startSession(c);
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

app.post("/api/pin", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com o PIN." }, 401);
  const body = await readJson(c);
  if (!isValidPin(body.currentPin) || !isValidPin(body.nextPin)) {
    return c.json({ error: "Use um PIN de 4 a 8 dígitos." }, 400);
  }
  const saltHex = await getSetting(c.env.DB, "pin_salt");
  const expected = await getSetting(c.env.DB, "pin_hash");
  if (!saltHex || !expected) return c.json({ error: "Crie um PIN primeiro." }, 409);
  const actual = await hashPin(body.currentPin, fromHex(saltHex));
  if (!safeEqual(actual, expected)) return c.json({ error: "PIN atual incorreto." }, 401);
  const salt = randomBytes(16);
  await setSetting(c.env.DB, "pin_salt", toHex(salt));
  await setSetting(c.env.DB, "pin_hash", await hashPin(body.nextPin, salt));
  await c.env.DB.prepare("DELETE FROM sessions").run();
  await startSession(c);
  return c.json({ ok: true });
});

app.get("/api/months/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com o PIN." }, 401);
  const payload = await monthPayload(c.env.DB, c.req.param("id"));
  if (!payload) return c.json({ error: "Mês não encontrado." }, 404);
  return c.json(payload);
});

app.patch("/api/months/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com o PIN." }, 401);
  const monthId = c.req.param("id");
  const month = await getMonth(c.env.DB, monthId);
  if (!month) return c.json({ error: "Mês não encontrado." }, 404);
  const body = await readJson(c);
  if (!isCents(body.incomeCents)) return c.json({ error: "Informe a receita em centavos." }, 400);
  await c.env.DB.prepare("UPDATE months SET income_cents = ? WHERE id = ?").bind(body.incomeCents, monthId).run();
  return c.json(await monthPayload(c.env.DB, monthId));
});

app.post("/api/months/:id/settle", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com o PIN." }, 401);
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

app.post("/api/expenses", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com o PIN." }, 401);
  const body = await readJson(c);
  const parsed = parseExpenseBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (!isMonthId(body.monthId) || !(await getMonth(c.env.DB, body.monthId))) {
    return c.json({ error: "Mês não encontrado." }, 404);
  }
  const sort = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM expenses WHERE month_id = ?")
    .bind(body.monthId)
    .first<{ next: number }>();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO expenses
      (id, month_id, name, section, amount_cents, payment, on_card, card_label, paid, note, sort_order, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?)`,
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
      sort?.next ?? 1000,
      new Date().toISOString(),
    )
    .run();
  return c.json(await monthPayload(c.env.DB, body.monthId), 201);
});

app.patch("/api/expenses/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com o PIN." }, 401);
  const current = await getExpense(c.env.DB, c.req.param("id"));
  if (!current) return c.json({ error: "Gasto não encontrado." }, 404);
  const body = await readJson(c);
  const parsed = parseExpenseBody({
    name: body.name ?? current.name,
    amountCents: body.amountCents ?? current.amountCents,
    section: body.section ?? current.section,
    payment: body.payment ?? current.payment,
    onCard: body.onCard ?? current.onCard,
    cardLabel: body.cardLabel === undefined ? current.cardLabel : body.cardLabel,
    note: body.note === undefined ? current.note : body.note,
    paid: body.paid ?? current.paid,
  });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  await c.env.DB.prepare(
    `UPDATE expenses
     SET name = ?, section = ?, amount_cents = ?, payment = ?, on_card = ?, card_label = ?, paid = ?, note = ?
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
      current.id,
    )
    .run();
  return c.json(await monthPayload(c.env.DB, current.monthId));
});

app.delete("/api/expenses/:id", async (c) => {
  if (!(await requireAuth(c))) return c.json({ error: "Entre com o PIN." }, 401);
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
  paid: boolean;
};

function parseExpenseBody(body: JsonBody): { ok: true; value: ExpenseDraft } | { ok: false; error: string } {
  if (!isSection(body.section) || !isPayment(body.payment)) {
    return { ok: false, error: "Tipo ou forma de pagamento inválido." };
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.trim().length > 120) {
    return { ok: false, error: "Dê um nome ao gasto, com até 120 caracteres." };
  }
  if (!isCents(body.amountCents)) return { ok: false, error: "Informe um valor válido." };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
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
      paid,
      ...normalized,
    },
  };
}

function isSection(value: unknown): value is Section {
  return value === "card" || value === "fixed" || value === "extra";
}

function isPayment(value: unknown): value is Payment {
  return value === "pix" || value === "card";
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= -100_000_000 && value <= 100_000_000;
}

function isMonthId(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

type FailureState = { count: number; lockedUntil: string | null };

async function failureState(db: D1Database): Promise<FailureState> {
  const raw = await getSetting(db, FAILURE_KEY);
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
  const row = await db.prepare("SELECT expires_at FROM sessions WHERE id = ?").bind(id).first<{ expires_at: string }>();
  if (!row) return false;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return false;
  }
  return true;
}

type AppContext = Context<{ Bindings: Env }>;

async function requireAuth(c: AppContext): Promise<boolean> {
  return isAuthenticated(c.env.DB, getCookie(c, COOKIE));
}

async function startSession(c: AppContext): Promise<void> {
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, ?)").bind(await sha256(token), sessionExpiry()).run();
  setCookie(c, COOKIE, token, sessionCookieOptions(c.req.url));
}

type JsonBody = Record<string, unknown> & {
  pin?: unknown;
  currentPin?: unknown;
  nextPin?: unknown;
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
