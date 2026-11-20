import { lockedMessage, nextFailure, parseCpf } from "../auth.ts";
import {
  accessTo,
  deleteShare,
  listOutgoingShares,
  listSpaces,
  setSetting,
  shareWithCpf,
  updateSharePermission,
} from "../db.ts";
import { AUTH_ERROR, failureKey, failureState, readJson, requireScope, requireWriter, type App } from "../http.ts";

export function registerShareRoutes(app: App): void {
  app.get("/api/spaces", async (c) => {
    const scope = await requireScope(c);
    if (!scope) return c.json({ error: AUTH_ERROR }, 401);
    return c.json({ spaces: await listSpaces(c.env.DB, scope.actorId), currentOwnerId: scope.ownerId });
  });

  app.post("/api/scope", async (c) => {
    const scope = await requireScope(c);
    if (!scope) return c.json({ error: AUTH_ERROR }, 401);
    const body = await readJson(c);
    if (typeof body.ownerId !== "string") return c.json({ error: "Escolha qual acesso abrir." }, 400);
    const access = await accessTo(c.env.DB, scope.actorId, body.ownerId);
    if (!access) return c.json({ error: "Esse compartilhamento não está disponível." }, 403);
    await c.env.DB.prepare("UPDATE sessions SET scope_owner_id = ? WHERE id = ?").bind(body.ownerId, scope.sessionId).run();
    return c.json({ ok: true, spaces: await listSpaces(c.env.DB, scope.actorId), currentOwnerId: body.ownerId });
  });

  app.get("/api/shares", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    if (writer.scope.permission !== "own") return c.json({ error: "Só dá para compartilhar os seus próprios gastos." }, 403);
    return c.json({ shares: await listOutgoingShares(c.env.DB, writer.scope.ownerId) });
  });

  app.post("/api/shares", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    if (writer.scope.permission !== "own") return c.json({ error: "Só dá para compartilhar os seus próprios gastos." }, 403);
    const body = await readJson(c);
    const cpf = parseCpf(body.cpf);
    if (!cpf.ok) return c.json({ error: cpf.error }, 400);
    const permission = body.permission === "edit" ? "edit" : body.permission === "view" ? "view" : null;
    if (!permission) return c.json({ error: "Escolha se a pessoa pode ver ou também editar." }, 400);
    const shareRateKey = `share_lookup:${writer.scope.actorId}`;
    const shareFailures = await failureState(c.env.DB, shareRateKey);
    const shareLocked = lockedMessage(shareFailures);
    if (shareLocked) return c.json({ error: shareLocked }, 429);
    const saved = await shareWithCpf(c.env.DB, writer.scope.ownerId, cpf.cpf, permission);
    if (!saved.ok) {
      const updated = nextFailure(shareFailures);
      await setSetting(c.env.DB, failureKey(shareRateKey), JSON.stringify(updated));
      const lockMsg = lockedMessage(updated);
      return c.json({ error: lockMsg ?? saved.error }, lockMsg ? 429 : 404);
    }
    return c.json({ shares: await listOutgoingShares(c.env.DB, writer.scope.ownerId) }, 201);
  });

  app.patch("/api/shares/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    if (writer.scope.permission !== "own") return c.json({ error: "Só dá para compartilhar os seus próprios gastos." }, 403);
    const body = await readJson(c);
    const permission = body.permission === "edit" ? "edit" : body.permission === "view" ? "view" : null;
    if (!permission) return c.json({ error: "Escolha se a pessoa pode ver ou também editar." }, 400);
    const updated = await updateSharePermission(c.env.DB, writer.scope.ownerId, c.req.param("id"), permission);
    if (!updated) return c.json({ error: "Compartilhamento não encontrado." }, 404);
    return c.json({ shares: await listOutgoingShares(c.env.DB, writer.scope.ownerId) });
  });

  app.delete("/api/shares/:id", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    if (writer.scope.permission !== "own") return c.json({ error: "Só dá para compartilhar os seus próprios gastos." }, 403);
    const removed = await deleteShare(c.env.DB, writer.scope.ownerId, c.req.param("id"));
    if (!removed) return c.json({ error: "Compartilhamento não encontrado." }, 404);
    return c.json({ shares: await listOutgoingShares(c.env.DB, writer.scope.ownerId) });
  });
}
