import type { Account, PasskeyRecord } from "./core.ts";

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function findUserByCpf(db: D1Database, cpf: string): Promise<Account | null> {
  const row = await db
    .prepare("SELECT id, cpf, email, password_hash, password_salt FROM users WHERE cpf = ?")
    .bind(cpf)
    .first<{ id: string; cpf: string; email: string; password_hash: string; password_salt: string }>();
  return row ? mapAccount(row) : null;
}

export async function findUserByEmail(db: D1Database, email: string): Promise<Account | null> {
  const row = await db
    .prepare("SELECT id, cpf, email, password_hash, password_salt FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; cpf: string; email: string; password_hash: string; password_salt: string }>();
  return row ? mapAccount(row) : null;
}

export async function findUserById(db: D1Database, id: string): Promise<Account | null> {
  const row = await db
    .prepare("SELECT id, cpf, email, password_hash, password_salt FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: string; cpf: string; email: string; password_hash: string; password_salt: string }>();
  return row ? mapAccount(row) : null;
}

export async function createUser(
  db: D1Database,
  input: { cpf: string; email: string; passwordHash: string; passwordSalt: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (await findUserByCpf(db, input.cpf)) return { ok: false, error: "Já existe uma conta com este CPF." };
  if (await findUserByEmail(db, input.email)) return { ok: false, error: "Já existe uma conta com este e-mail." };
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        "INSERT INTO users (id, cpf, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(id, input.cpf, input.email, input.passwordHash, input.passwordSalt, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "Já existe uma conta com este CPF ou e-mail." };
    throw error;
  }
  return { ok: true, id };
}

export async function updatePassword(
  db: D1Database,
  userId: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(passwordHash, passwordSalt, userId)
    .run();
}

export async function listPasskeys(db: D1Database, userId: string): Promise<PasskeyRecord[]> {
  const result = await db
    .prepare("SELECT id, user_id, public_key, counter, transports, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at")
    .bind(userId)
    .all<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null; created_at: string }>();
  return (result.results ?? []).map(mapPasskey);
}

export async function getPasskey(db: D1Database, id: string): Promise<PasskeyRecord | null> {
  const row = await db
    .prepare("SELECT id, user_id, public_key, counter, transports, created_at FROM passkeys WHERE id = ?")
    .bind(id)
    .first<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null; created_at: string }>();
  return row ? mapPasskey(row) : null;
}

export async function countPasskeys(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertPasskey(
  db: D1Database,
  input: { id: string; userId: string; publicKey: string; counter: number; transports: string[] },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO passkeys (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(input.id, input.userId, input.publicKey, input.counter, input.transports.join(","), new Date().toISOString())
    .run();
}

export async function updatePasskeyCounter(db: D1Database, id: string, counter: number): Promise<void> {
  await db.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(counter, id).run();
}

export async function deletePasskey(db: D1Database, id: string, userId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteUserPasskeys(db: D1Database, userId: string): Promise<number> {
  const count = await countPasskeys(db, userId);
  if (count > 0) await db.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(userId).run();
  return count;
}

export async function savePasskeyChallenge(
  db: D1Database,
  input: { userId: string | null; challenge: string; kind: "register" | "login" },
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare("DELETE FROM passkey_challenges WHERE expires_at < ?").bind(now).run();
  await db
    .prepare("INSERT INTO passkey_challenges (id, user_id, challenge, kind, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), input.userId, input.challenge, input.kind, new Date(Date.now() + 5 * 60 * 1000).toISOString())
    .run();
}

export async function matchPasskeyChallenge(
  db: D1Database,
  challenge: string,
  kind: "register" | "login",
  userId?: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT id, user_id, expires_at FROM passkey_challenges WHERE challenge = ? AND kind = ?")
    .bind(challenge, kind)
    .first<{ id: string; user_id: string | null; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return false;
  if (userId && row.user_id !== userId) return false;
  await db.prepare("DELETE FROM passkey_challenges WHERE id = ?").bind(row.id).run();
  return true;
}

function mapPasskey(row: {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: string;
}): PasskeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: row.transports ? row.transports.split(",").filter(Boolean) : [],
    createdAt: row.created_at,
  };
}

function mapAccount(row: { id: string; cpf: string; email: string; password_hash: string; password_salt: string }): Account {
  return {
    id: row.id,
    cpf: row.cpf,
    email: row.email,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
  };
}
