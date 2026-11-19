import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFailures,
  lockedMessage,
  nextFailure,
  nextRateWindow,
  parseCpf,
  parseEmail,
  parsePassword,
  safeEqual,
} from "../src/auth.ts";

test("nextFailure bloqueia na oitava falha e reinicia contador após expirar o bloqueio", () => {
  const start = Date.parse("2026-11-19T12:00:00.000Z");
  let state = clearFailures();
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    state = nextFailure(state, start + attempt * 1000);
    assert.equal(state.count, attempt);
    assert.equal(state.lockedUntil, null);
    assert.equal(lockedMessage(state, start + attempt * 1000), null);
  }
  state = nextFailure(state, start + 8000);
  assert.equal(state.count, 8);
  assert.ok(state.lockedUntil);
  assert.ok(state.updatedAt);
  assert.match(lockedMessage(state, start + 9000) ?? "", /bloqueado por 5 min/i);

  const afterExpiry = Date.parse(state.lockedUntil) + 1000;
  assert.equal(lockedMessage(state, afterExpiry), null);
  const reset = nextFailure(state, afterExpiry);
  assert.equal(reset.count, 1);
  assert.equal(reset.lockedUntil, null);
});

test("nextRateWindow limita requisições por janela e libera ao expirar", () => {
  const t0 = Date.parse("2026-11-19T12:00:00.000Z");
  const windowMs = 5 * 60 * 1000;
  let window = null;
  for (let i = 1; i <= 3; i += 1) {
    const decision = nextRateWindow(window, 3, windowMs, t0 + i * 1000);
    assert.equal(decision.allowed, true);
    assert.equal(decision.state.count, i);
    window = decision.state;
  }
  const blocked = nextRateWindow(window, 3, windowMs, t0 + 10_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryMinutes >= 1);

  const reopened = nextRateWindow(window, 3, windowMs, t0 + windowMs + 2000);
  assert.equal(reopened.allowed, true);
  assert.equal(reopened.state.count, 1);
});

test("validadores de CPF, e-mail, senha e comparação segura", () => {
  assert.equal(parseCpf("529.982.247-25").ok, true);
  assert.equal(parseCpf("111.111.111-11").ok, false);
  assert.equal(parseEmail("Pessoa@Exemplo.com ").ok, true);
  assert.equal(parseEmail("invalido").ok, false);
  assert.equal(parsePassword("1234567").ok, false);
  assert.equal(parsePassword("12345678").ok, true);
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});
