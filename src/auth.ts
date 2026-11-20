const PIN_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const LOCK_MS = 5 * 60 * 1000;

export function parseCpf(value: unknown): { ok: true; cpf: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Informe um CPF válido." };
  const cpf = value.replace(/\D/g, "");
  if (!isValidCpf(cpf)) return { ok: false, error: "Informe um CPF válido." };
  return { ok: true, cpf };
}

export function parseEmail(value: unknown): { ok: true; email: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Informe um e-mail válido." };
  const email = value.trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Informe um e-mail válido." };
  }
  return { ok: true, email };
}

export function parsePassword(value: unknown): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.length < 8 || value.length > 72) {
    return { ok: false, error: "Use uma senha com 8 a 72 caracteres." };
  }
  return { ok: true, password: value };
}

export function formatCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export async function hashSecret(secret: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBuffer, iterations: PIN_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomToken(): string {
  return toHex(randomBytes(32));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

export function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export function sessionCookieOptions(requestUrl: string): {
  httpOnly: true;
  secure: boolean;
  sameSite: "Lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export type FailureState = { count: number; lockedUntil: string | null; updatedAt?: string };

export function lockedMessage(state: FailureState, now = Date.now()): string | null {
  if (!state.lockedUntil) return null;
  const until = Date.parse(state.lockedUntil);
  if (Number.isNaN(until) || until <= now) return null;
  const minutes = Math.max(1, Math.ceil((until - now) / 60000));
  return `Acesso bloqueado por ${minutes} min depois de várias tentativas.`;
}

export function nextFailure(state: FailureState, now = Date.now()): FailureState {
  const until = state.lockedUntil !== null ? Date.parse(state.lockedUntil) : Number.NaN;
  const activeLock = !Number.isNaN(until) && until > now;
  const expiredLock = !Number.isNaN(until) && until <= now;
  const baseCount = expiredLock ? 0 : state.count;
  const count = activeLock ? state.count : baseCount + 1;
  const updatedAt = new Date(now).toISOString();
  if (count >= MAX_FAILURES) {
    return { count, lockedUntil: new Date(now + LOCK_MS).toISOString(), updatedAt };
  }
  return { count, lockedUntil: null, updatedAt };
}

export function clearFailures(): FailureState {
  return { count: 0, lockedUntil: null };
}

export type RateWindow = { count: number; resetAt: string };

export function nextRateWindow(
  current: RateWindow | null,
  maxRequests: number,
  windowMs: number,
  now = Date.now(),
): { allowed: boolean; state: RateWindow; retryMinutes: number } {
  const resetAtMs = current ? Date.parse(current.resetAt) : Number.NaN;
  if (!current || Number.isNaN(resetAtMs) || resetAtMs <= now) {
    return {
      allowed: true,
      state: { count: 1, resetAt: new Date(now + windowMs).toISOString() },
      retryMinutes: 0,
    };
  }
  if (current.count >= maxRequests) {
    return {
      allowed: false,
      state: current,
      retryMinutes: Math.max(1, Math.ceil((resetAtMs - now) / 60000)),
    };
  }
  return {
    allowed: true,
    state: { count: current.count + 1, resetAt: current.resetAt },
    retryMinutes: 0,
  };
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
