import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import {
  countPasskeys,
  getPasskey,
  insertPasskey,
  listPasskeys,
  matchPasskeyChallenge,
  savePasskeyChallenge,
  updatePasskeyCounter,
  type PasskeyRecord,
} from "./db.ts";

const RP_NAME = "Controle de gastos";
const MAX_PASSKEYS = 5;

export function relyingParty(requestUrl: string): { rpID: string; origin: string } {
  const url = new URL(requestUrl);
  return { rpID: url.hostname, origin: url.origin };
}

export async function registrationOptions(db: D1Database, user: { id: string; email: string }, requestUrl: string) {
  if ((await countPasskeys(db, user.id)) >= MAX_PASSKEYS) {
    return { ok: false as const, error: "Esta conta já tem o máximo de digitais cadastradas." };
  }
  const { rpID } = relyingParty(requestUrl);
  const existing = await listPasskeys(db, user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.email,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.id,
      transports: transportsOf(passkey),
    })),
    timeout: 60_000,
  });
  await savePasskeyChallenge(db, { userId: user.id, challenge: options.challenge, kind: "register" });
  return { ok: true as const, options };
}

export async function registerPasskey(
  db: D1Database,
  userId: string,
  response: RegistrationResponseJSON,
  requestUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { rpID, origin } = relyingParty(requestUrl);
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => matchPasskeyChallenge(db, challenge, "register", userId),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "passkey_register_failed", error: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, error: "Não foi possível cadastrar a digital. Tente de novo." };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "Não foi possível cadastrar a digital. Tente de novo." };
  }
  const credential = verification.registrationInfo.credential;
  if (await getPasskey(db, credential.id)) return { ok: false, error: "Esta digital já está cadastrada." };
  if ((await countPasskeys(db, userId)) >= MAX_PASSKEYS) {
    return { ok: false, error: "Esta conta já tem o máximo de digitais cadastradas." };
  }
  await insertPasskey(db, {
    id: credential.id,
    userId,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: response.response.transports ?? [],
  });
  return { ok: true };
}

export async function loginOptions(db: D1Database, requestUrl: string) {
  const { rpID } = relyingParty(requestUrl);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    timeout: 60_000,
  });
  await savePasskeyChallenge(db, { userId: null, challenge: options.challenge, kind: "login" });
  return options;
}

export async function loginWithPasskey(
  db: D1Database,
  response: AuthenticationResponseJSON,
  requestUrl: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const passkey = await getPasskey(db, response.id);
  if (!passkey) return { ok: false, error: "Nenhuma digital cadastrada combina com este celular." };
  const { rpID, origin } = relyingParty(requestUrl);
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => matchPasskeyChallenge(db, challenge, "login"),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: transportsOf(passkey),
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "passkey_login_failed", error: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, error: "Não foi possível confirmar a digital. Entre com CPF e senha." };
  }
  if (!verification.verified) return { ok: false, error: "Não foi possível confirmar a digital. Entre com CPF e senha." };
  await updatePasskeyCounter(db, passkey.id, verification.authenticationInfo.newCounter);
  return { ok: true, userId: passkey.userId };
}

function transportsOf(passkey: PasskeyRecord): AuthenticatorTransportFuture[] | undefined {
  return passkey.transports.length > 0 ? (passkey.transports as AuthenticatorTransportFuture[]) : undefined;
}
