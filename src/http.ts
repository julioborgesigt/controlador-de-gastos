import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, Hono } from "hono";
import {
  clearFailures,
  nextRateWindow,
  randomToken,
  sessionCookieOptions,
  sessionExpiry,
  sha256,
  type FailureState,
  type RateWindow,
} from "./auth.ts";
import type { Payment, Section } from "./domain.ts";
import { accessTo, findUserById, getSetting, pruneExpiredAuthSettings, setSetting } from "./db.ts";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};
export type App = Hono<AppEnv>;
export type AppContext = Context<AppEnv>;

export const COOKIE = "gastos_session";
export const AUTH_ERROR = "Entre com CPF e senha.";
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";
export const ASSET_CSP = "default-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export function requestIdOf(c: AppContext): string {
  const existing = c.get("requestId");
  if (existing) return existing;
  const derived = c.req.header("cf-ray")?.trim() || crypto.randomUUID();
  c.set("requestId", derived);
  return derived;
}

export function logError(
  c: AppContext,
  event: string,
  error: unknown,
  extra: Record<string, unknown> = {},
): string {
  const requestId = requestIdOf(c);
  console.error(JSON.stringify({
    level: "error",
    event,
    requestId,
    method: c.req.method,
    path: c.req.path,
    error: error instanceof Error ? error.message : "unknown",
    ...extra,
  }));
  return requestId;
}

export function setApiSecurityHeaders(c: AppContext): void {
  c.header("X-Request-Id", requestIdOf(c));
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", PERMISSIONS_POLICY);
  if (isHttpsRequest(c.req.url)) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

export function isSection(value: unknown): value is Section {
  return value === "card" || value === "fixed" || value === "extra";
}

export function isPayment(value: unknown): value is Payment {
  return value === "pix" || value === "card";
}

export function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= -100_000_000 && value <= 100_000_000;
}

export function isMonthId(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

export function isHttpsRequest(requestUrl: string): boolean {
  try {
    return new URL(requestUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function clientIp(c: AppContext): string {
  return (
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

export function failureKey(cpf: string): string {
  return `login_failures:${cpf}`;
}

export async function failureState(db: D1Database, cpf: string): Promise<FailureState> {
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

export async function consumeRateLimit(db: D1Database, key: string, maxRequests: number, windowMs: number): Promise<string | null> {
  const fullKey = `rate_limit:${key}`;
  const raw = await getSetting(db, fullKey);
  let current: RateWindow | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<RateWindow>;
      if (typeof parsed.count === "number" && typeof parsed.resetAt === "string") {
        current = { count: parsed.count, resetAt: parsed.resetAt };
      }
    } catch {
      current = null;
    }
  }
  const decision = nextRateWindow(current, maxRequests, windowMs);
  if (!decision.allowed) {
    return `Muitas tentativas seguidas. Tente novamente em ${decision.retryMinutes} min.`;
  }
  await setSetting(db, fullKey, JSON.stringify(decision.state));
  return null;
}

export async function isAuthenticated(db: D1Database, token: string | undefined): Promise<boolean> {
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

export async function currentAccount(c: AppContext) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const id = await sha256(token);
  const row = await c.env.DB.prepare("SELECT expires_at, user_id FROM sessions WHERE id = ?").bind(id).first<{
    expires_at: string;
    user_id: string | null;
  }>();
  if (!row?.user_id || Date.parse(row.expires_at) <= Date.now()) {
    deleteCookie(c, COOKIE, { path: "/" });
    return null;
  }
  return findUserById(c.env.DB, row.user_id);
}

export async function startSession(c: AppContext, userId: string): Promise<void> {
  const token = randomToken();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    c.env.DB.prepare("INSERT INTO sessions (id, expires_at, user_id, scope_owner_id) VALUES (?, ?, ?, ?)").bind(
      await sha256(token),
      sessionExpiry(),
      userId,
      userId,
    ),
  ]);
  await pruneExpiredAuthSettings(c.env.DB).catch(() => {});
  setCookie(c, COOKIE, token, sessionCookieOptions(c.req.url));
}

export type Scope = {
  actorId: string;
  ownerId: string;
  permission: "own" | "view" | "edit";
  label: string;
  sessionId: string;
};

export async function requireScope(c: AppContext): Promise<Scope | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const sessionId = await sha256(token);
  const row = await c.env.DB.prepare("SELECT expires_at, user_id, scope_owner_id FROM sessions WHERE id = ?").bind(sessionId).first<{
    expires_at: string;
    user_id: string | null;
    scope_owner_id: string | null;
  }>();
  if (!row?.user_id || Date.parse(row.expires_at) <= Date.now()) {
    deleteCookie(c, COOKIE, { path: "/" });
    return null;
  }
  let ownerId = row.scope_owner_id || row.user_id;
  let access = await accessTo(c.env.DB, row.user_id, ownerId);
  if (!access) {
    ownerId = row.user_id;
    access = await accessTo(c.env.DB, row.user_id, ownerId);
    await c.env.DB.prepare("UPDATE sessions SET scope_owner_id = ? WHERE id = ?").bind(ownerId, sessionId).run();
  }
  if (!access) return null;
  return { actorId: row.user_id, ownerId, permission: access.permission, label: access.label, sessionId };
}

export async function requireWriter(c: AppContext): Promise<{ ok: true; scope: Scope } | { ok: false; status: 401 | 403; error: string }> {
  const scope = await requireScope(c);
  if (!scope) return { ok: false, status: 401, error: AUTH_ERROR };
  if (scope.permission === "view") return { ok: false, status: 403, error: "Este compartilhamento permite só visualizar." };
  return { ok: true, scope };
}

export function withAccess<T>(payload: T, scope: Scope): T & { access: { permission: Scope["permission"]; label: string; own: boolean } } {
  return { ...payload, access: { permission: scope.permission, label: scope.label, own: scope.permission === "own" } };
}

export type JsonBody = Record<string, unknown> & {
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
  ownerId?: unknown;
  permission?: unknown;
  monthIds?: unknown;
  focusMonthId?: unknown;
};

export async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<JsonBody> {
  try {
    const value = await c.req.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonBody;
  } catch {
    return {};
  }
  return {};
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

