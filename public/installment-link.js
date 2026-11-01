const MONEY_MAX = 100_000_000;
const FIELDS = ["charged", "count", "per"];

function isMoney(value) {
  return Number.isInteger(value) && value > 0 && value <= MONEY_MAX;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= 48;
}

function canSolve(target, known) {
  if (target === "charged") return known.count && known.per;
  if (target === "per") return known.charged && known.count;
  if (target === "count") return known.charged && known.per;
  return false;
}

export function solveInstallmentTriple(current, edited, previousEdits = [], locked = null) {
  const values = {
    chargedCents: current.chargedCents,
    count: current.count,
    perCents: current.perCents,
  };
  const known = {
    charged: isMoney(values.chargedCents),
    count: isCount(values.count),
    per: isMoney(values.perCents),
  };
  const kept = previousEdits.filter((key) => key !== edited && known[key]);
  if (!known[edited]) {
    return { values, edits: kept.slice(-2), remainderCents: 0 };
  }
  kept.push(edited);
  const recent = kept.slice(-2);
  const others = FIELDS.filter((key) => key !== edited && known[key]);
  if (others.length === 0) {
    return { values, edits: recent, remainderCents: 0 };
  }

  let target;
  if (locked && locked !== edited && known[locked]) {
    target = FIELDS.find((key) => key !== edited && key !== locked);
  } else if (others.length === 1) {
    target = FIELDS.find((key) => key !== edited && key !== others[0]);
  } else {
    target = FIELDS.find((key) => !recent.includes(key));
    if (!target || target === edited) target = edited === "per" ? "charged" : "per";
  }
  if (!target || target === edited || !canSolve(target, known)) {
    return { values, edits: recent, remainderCents: 0 };
  }

  let remainderCents = 0;
  if (target === "charged") {
    const product = values.count * values.perCents;
    if (isMoney(product)) values.chargedCents = product;
  } else if (target === "per") {
    const base = Math.floor(values.chargedCents / values.count);
    if (isMoney(base)) {
      values.perCents = base;
      remainderCents = values.chargedCents - base * values.count;
    }
  } else {
    const rounded = Math.round(values.chargedCents / values.perCents);
    const count = Math.min(48, Math.max(1, rounded));
    if (isCount(count)) {
      values.count = count;
      const base = Math.floor(values.chargedCents / count);
      if (values.perCents === base) remainderCents = values.chargedCents - values.perCents * count;
    }
  }
  return { values, edits: recent, remainderCents };
}

export function quoteInstallments(chargedCents, count, perCents) {
  if (!isCount(count) || !isMoney(perCents)) return null;
  if (!isMoney(chargedCents)) {
    return { kind: "open", count, perCents, lastCents: perCents, chargedCents: null, statedCents: null };
  }
  if (chargedCents === perCents * count) {
    return { kind: "equal", count, perCents, lastCents: perCents, chargedCents, statedCents: chargedCents };
  }
  const base = Math.floor(chargedCents / count);
  const remainder = chargedCents - base * count;
  if (perCents === base && remainder > 0 && remainder < count) {
    return { kind: "remainder", count, perCents, lastCents: perCents + remainder, chargedCents, statedCents: chargedCents };
  }
  const product = perCents * count;
  if (!isMoney(product)) return null;
  return { kind: "mismatch", count, perCents, lastCents: perCents, chargedCents: product, statedCents: chargedCents };
}
