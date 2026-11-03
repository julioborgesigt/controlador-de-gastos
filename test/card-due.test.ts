import assert from "node:assert/strict";
import test from "node:test";
import { dueDatePassed, invoiceDueDate } from "../public/card-due.js";

test("vencimento da fatura usa o dia do cartão e o último dia do mês", () => {
  assert.equal(invoiceDueDate("2026-11", 2), "2026-11-02");
  assert.equal(invoiceDueDate("2026-02", 31), "2026-02-28");
  assert.equal(invoiceDueDate("2024-02", 31), "2024-02-29");
  assert.equal(invoiceDueDate("2026-13", 1), null);
  assert.equal(invoiceDueDate("2026-11", 0), null);
  assert.equal(dueDatePassed("2026-11", 2, "2026-11-03"), true);
  assert.equal(dueDatePassed("2026-11", 3, "2026-11-03"), false);
  assert.equal(dueDatePassed("2026-12", 1, "2026-11-03"), false);
  assert.equal(dueDatePassed("2026-11", 31, "2026-12-01"), true);
});
