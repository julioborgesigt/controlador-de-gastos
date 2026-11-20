import { deleteCookie, getCookie } from "hono/cookie";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  clearFailures,
  hashSecret,
  lockedMessage,
  nextFailure,
  parseCpf,
  parseEmail,
  parsePassword,
  randomBytes,
  safeEqual,
  sha256,
} from "../auth.ts";
import { loginOptions, loginWithPasskey, registerPasskey, registrationOptions } from "../passkeys.ts";
import {
  countUsers,
  createUser,
  deletePasskey,
  deleteUserPasskeys,
  findUserByCpf,
  getTheme,
  listPasskeys,
  setSetting,
  setTheme,
  updatePassword,
} from "../db.ts";
import {
  AUTH_ERROR,
  COOKIE,
  clientIp,
  consumeRateLimit,
  currentAccount,
  failureKey,
  failureState,
  fromHex,
  isAuthenticated,
  readJson,
  requireScope,
  requireWriter,
  startSession,
  toHex,
  type App,
} from "../http.ts";

export function registerAuthRoutes(app: App): void {
  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/session", async (c) => {
    const needsSetup = (await countUsers(c.env.DB)) === 0;
    const token = getCookie(c, COOKIE);
    const authenticated = await isAuthenticated(c.env.DB, token);
    if (token && !authenticated) deleteCookie(c, COOKIE, { path: "/" });
    let theme: "light" | "dark" = "light";
    if (authenticated) {
      const scope = await requireScope(c);
      if (scope) theme = await getTheme(c.env.DB, scope.ownerId);
    }
    return c.json({ needsSetup, authenticated, theme });
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
    const ipKey = `register_ip:${clientIp(c)}`;
    const ipFailures = await failureState(c.env.DB, ipKey);
    const ipLocked = lockedMessage(ipFailures);
    if (ipLocked) return c.json({ error: ipLocked }, 429);
    const salt = randomBytes(16);
    const created = await createUser(c.env.DB, {
      cpf: cpf.cpf,
      email: email.email,
      passwordHash: await hashSecret(password.password, salt),
      passwordSalt: toHex(salt),
    });
    if (!created.ok) {
      const updated = nextFailure(ipFailures);
      await setSetting(c.env.DB, failureKey(ipKey), JSON.stringify(updated));
      const lockMsg = lockedMessage(updated);
      return c.json({ error: lockMsg ?? created.error }, lockMsg ? 429 : 409);
    }
    await startSession(c, created.id);
    return c.json({ ok: true }, 201);
  });

  app.post("/api/login", async (c) => {
    const body = await readJson(c);
    const cpf = parseCpf(body.cpf);
    const password = parsePassword(body.password);
    if (!cpf.ok || !password.ok) return c.json({ error: "CPF ou senha incorretos." }, 401);
    const ipKey = `ip:${clientIp(c)}`;
    const [failures, ipFailures] = await Promise.all([
      failureState(c.env.DB, cpf.cpf),
      failureState(c.env.DB, ipKey),
    ]);
    const locked = lockedMessage(failures) ?? lockedMessage(ipFailures);
    if (locked) return c.json({ error: locked }, 429);
    const user = await findUserByCpf(c.env.DB, cpf.cpf);
    const actual = await hashSecret(password.password, user ? fromHex(user.passwordSalt) : new Uint8Array(16));
    if (!user || !safeEqual(actual, user.passwordHash)) {
      const updated = nextFailure(failures);
      const updatedIp = nextFailure(ipFailures);
      await Promise.all([
        setSetting(c.env.DB, failureKey(cpf.cpf), JSON.stringify(updated)),
        setSetting(c.env.DB, failureKey(ipKey), JSON.stringify(updatedIp)),
      ]);
      const lockMsg = lockedMessage(updated) ?? lockedMessage(updatedIp);
      return c.json({ error: lockMsg ?? "CPF ou senha incorretos." }, lockMsg ? 429 : 401);
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
    const passwordKey = `password:${user.id}`;
    const passwordFailures = await failureState(c.env.DB, passwordKey);
    const passwordLocked = lockedMessage(passwordFailures);
    if (passwordLocked) return c.json({ error: passwordLocked }, 429);
    const body = await readJson(c);
    const next = parsePassword(body.nextPassword);
    if (!next.ok) return c.json({ error: next.error }, 400);
    if (body.passwordConfirmation !== next.password) {
      return c.json({ error: "A confirmação da senha não confere." }, 400);
    }
    if (typeof body.currentPassword !== "string") return c.json({ error: "Senha atual incorreta." }, 401);
    const actual = await hashSecret(body.currentPassword, fromHex(user.passwordSalt));
    if (!safeEqual(actual, user.passwordHash)) {
      const updated = nextFailure(passwordFailures);
      await setSetting(c.env.DB, failureKey(passwordKey), JSON.stringify(updated));
      const lockMsg = lockedMessage(updated);
      return c.json({ error: lockMsg ?? "Senha atual incorreta." }, lockMsg ? 429 : 401);
    }
    await setSetting(c.env.DB, failureKey(passwordKey), JSON.stringify(clearFailures()));
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
    const limited = await consumeRateLimit(c.env.DB, `passkey_login_opts:${clientIp(c)}`, 20, 5 * 60 * 1000);
    if (limited) return c.json({ error: limited }, 429);
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

  app.post("/api/theme", async (c) => {
    const writer = await requireWriter(c);
    if (!writer.ok) return c.json({ error: writer.error }, writer.status);
    const body = await readJson(c);
    if (body.theme !== "light" && body.theme !== "dark") return c.json({ error: "Escolha o modo claro ou o modo escuro." }, 400);
    await setTheme(c.env.DB, writer.scope.ownerId, body.theme);
    return c.json({ theme: body.theme });
  });
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
