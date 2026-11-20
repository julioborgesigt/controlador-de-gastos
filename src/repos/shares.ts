import { formatCpf } from "../auth.ts";
import type { SharePermission, Space } from "./core.ts";
import { findUserByCpf, findUserById } from "./users.ts";

export async function listSpaces(db: D1Database, actorId: string): Promise<Space[]> {
  const me = await findUserById(db, actorId);
  const incoming = await db
    .prepare(
      `SELECT s.permission, u.id, u.cpf, u.email
       FROM shares s JOIN users u ON u.id = s.owner_id
       WHERE s.guest_id = ?
       ORDER BY u.cpf`,
    )
    .bind(actorId)
    .all<{ permission: SharePermission; id: string; cpf: string; email: string }>();
  return [
    { ownerId: actorId, label: "Meus gastos", detail: me ? formatCpf(me.cpf) : "", permission: "own" },
    ...(incoming.results ?? []).map((row) => ({
      ownerId: row.id,
      label: formatCpf(row.cpf),
      detail: row.email,
      permission: row.permission,
    })),
  ];
}

export async function listOutgoingShares(db: D1Database, ownerId: string) {
  const result = await db
    .prepare(
      `SELECT s.id, s.permission, u.cpf, u.email
       FROM shares s JOIN users u ON u.id = s.guest_id
       WHERE s.owner_id = ?
       ORDER BY u.cpf`,
    )
    .bind(ownerId)
    .all<{ id: string; permission: SharePermission; cpf: string; email: string }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    permission: row.permission,
    cpf: formatCpf(row.cpf),
    email: row.email,
  }));
}

export async function shareWithCpf(
  db: D1Database,
  ownerId: string,
  cpf: string,
  permission: SharePermission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guest = await findUserByCpf(db, cpf);
  if (!guest) return { ok: false, error: "Não há conta com esse CPF." };
  if (guest.id === ownerId) return { ok: false, error: "Informe o CPF de outra pessoa." };
  await db
    .prepare(
      `INSERT INTO shares (id, owner_id, guest_id, permission, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, guest_id) DO UPDATE SET permission = excluded.permission`,
    )
    .bind(crypto.randomUUID(), ownerId, guest.id, permission, new Date().toISOString())
    .run();
  return { ok: true };
}

export async function updateSharePermission(
  db: D1Database,
  ownerId: string,
  shareId: string,
  permission: SharePermission,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE shares SET permission = ? WHERE id = ? AND owner_id = ?")
    .bind(permission, shareId, ownerId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteShare(db: D1Database, ownerId: string, shareId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM shares WHERE id = ? AND owner_id = ?").bind(shareId, ownerId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function accessTo(
  db: D1Database,
  actorId: string,
  ownerId: string,
): Promise<{ permission: "own" | SharePermission; label: string } | null> {
  if (actorId === ownerId) {
    const me = await findUserById(db, actorId);
    return { permission: "own", label: me ? "Meus gastos" : "Meus gastos" };
  }
  const row = await db
    .prepare(
      `SELECT s.permission, u.cpf FROM shares s JOIN users u ON u.id = s.owner_id
       WHERE s.owner_id = ? AND s.guest_id = ?`,
    )
    .bind(ownerId, actorId)
    .first<{ permission: SharePermission; cpf: string }>();
  if (!row) return null;
  return { permission: row.permission, label: formatCpf(row.cpf) };
}
