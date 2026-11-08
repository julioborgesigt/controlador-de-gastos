import assert from "node:assert/strict";
import test from "node:test";
import { compareInvoiceItems } from "../public/installment-order.js";

test("fatura ordena pelo total de parcelas, depois pelas pagas e pelo nome", () => {
  const rows = [
    { name: "A", installment: "3/4" },
    { name: "B", installment: "9/10" },
    { name: "C", installment: "10/10" },
    { name: "D", installment: "10/10" },
  ];
  const ordered = rows.slice().sort(compareInvoiceItems).map((row) => row.name);
  assert.deepEqual(ordered, ["C", "D", "B", "A"]);
});
