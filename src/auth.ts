const PIN_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const LOCK_MS = 5 * 60 * 1000;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{4,8}$/.test(pin);
}

export async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
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

type FailureState = { count: number; lockedUntil: string | null };

export function lockedMessage(state: FailureState, now = Date.now()): string | null {
  if (!state.lockedUntil) return null;
  const until = Date.parse(state.lockedUntil);
  if (Number.isNaN(until) || until <= now) return null;
  const minutes = Math.max(1, Math.ceil((until - now) / 60000));
  return `PIN bloqueado por ${minutes} min depois de várias tentativas.`;
}

export function nextFailure(state: FailureState, now = Date.now()): FailureState {
  const activeLock = state.lockedUntil !== null && Date.parse(state.lockedUntil) > now;
  const count = activeLock ? state.count : state.count + 1;
  if (count >= MAX_FAILURES) {
    return { count, lockedUntil: new Date(now + LOCK_MS).toISOString() };
  }
  return { count, lockedUntil: null };
}

export function clearFailures(): FailureState {
  return { count: 0, lockedUntil: null };
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
