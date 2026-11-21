import { addMonths } from "./months.js";

export const BRAZILIAN_CARDS = [
  "Nubank",
  "Itaú",
  "Bradesco",
  "Santander",
  "Inter",
  "C6 Bank",
  "BTG Pactual",
  "Caixa",
  "Banco do Brasil",
  "Mercado Pago",
  "XP",
  "PicPay",
];

export const NUBANK_EXPORT_HINT =
  "No app do Nubank: abra Cartão de crédito → Fatura → Exportar CSV (ou envie para seu e-mail) e selecione o arquivo aqui.";

export function isNubankName(name) {
  return /\bnubank\b|\bnu\s*bank\b|\broxinho\b/i.test(String(name || "").trim());
}

export function extractDueDateFromFilename(filename) {
  const raw = String(filename || "").trim();
  if (!raw) return null;
  let year = 0;
  let month = 0;
  let day = 0;
  const iso = /(20\d{2})[-_.](\d{2})[-_.](\d{2})/.exec(raw);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const br = /(\d{2})[-_.](\d{2})[-_.](20\d{2})/.exec(raw);
    if (!br) return null;
    day = Number(br[1]);
    month = Number(br[2]);
    year = Number(br[3]);
  }
  if (!isValidCalendarDate(year, month, day)) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return {
    dueDate: `${year}-${mm}-${dd}`,
    invoiceMonthId: `${year}-${mm}`,
    dueDay: day,
  };
}

function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function detectDelimiter(headerLine) {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i += 1) {
    const ch = headerLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ",") commas += 1;
    else if (!inQuotes && ch === ";") semis += 1;
  }
  return semis > commas ? ";" : ",";
}

function parseCsvRows(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = clean.split("\n").find((line) => line.trim().length > 0) || "";
  const delimiter = detectDelimiter(firstLine);
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((item) => item.trim() !== "")) rows.push(row);
  }
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeTextKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function detectSlashDateOrder(rawDates) {
  let firstOver12 = 0;
  let secondOver12 = 0;
  for (const raw of rawDates) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw || "").trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) firstOver12 += 1;
    if (b > 12) secondOver12 += 1;
  }
  if (secondOver12 > firstOver12) return "mdy";
  return "dmy";
}

function parseDateValue(raw, slashOrder) {
  const value = String(raw || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return isValidCalendarDate(y, m, d) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    let m = slashOrder === "mdy" ? a : b;
    let d = slashOrder === "mdy" ? b : a;
    if (!isValidCalendarDate(y, m, d)) {
      m = slashOrder === "mdy" ? b : a;
      d = slashOrder === "mdy" ? a : b;
    }
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function parseCsvAmountCents(raw) {
  let text = String(raw || "").replace(/R\$/gi, "").replace(/\s+/g, "").trim();
  if (!text) return null;
  const negative = text.startsWith("-");
  if (negative || text.startsWith("+")) text = text.slice(1);
  if (!text) return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  let normalized = text;
  if (hasComma && hasDot) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      normalized = text.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = text.replace(",", ".");
  }
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return null;
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  return negative ? -cents : cents;
}

export function parseInstallmentTitle(rawTitle) {
  const cleaned = String(rawTitle || "").replace(/\s+/g, " ").trim();
  const patterns = [
    /^(.*?)\s*[-–—]\s*Parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i,
    /^(.*?)\s*[-–—]\s*Parcela\s+(\d{1,2})\s+de\s+(\d{1,2})\s*$/i,
    /^(.*?)\s+\(?Parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\)?\s*$/i,
  ];
  for (const regex of patterns) {
    const match = regex.exec(cleaned);
    if (!match) continue;
    const baseName = match[1].trim();
    const current = Number(match[2]);
    const total = Number(match[3]);
    if (baseName && current >= 1 && total >= 2 && total <= 48 && current <= total) {
      return { name: baseName.slice(0, 120), currentInstallment: current, totalInstallments: total };
    }
  }
  return { name: cleaned.slice(0, 120), currentInstallment: 1, totalInstallments: 1 };
}

function isInvoicePaymentTitle(title) {
  return /^(pagamento\s+(recebido|de\s+fatura|da\s+fatura)|fatura\s+paga)/i.test(String(title || "").trim());
}

export function parseNubankCsv(text, filename = "") {
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    return { ok: false, error: "Arquivo CSV vazio ou sem lançamentos." };
  }
  const header = rows[0].map(normalizeHeader);
  const dateIdx = header.findIndex((col) => col === "date" || col === "data");
  const titleIdx = header.findIndex((col) => col === "title" || col === "titulo" || col === "descricao" || col === "estabelecimento");
  const amountIdx = header.findIndex((col) => col === "amount" || col === "valor");
  if (dateIdx < 0 || titleIdx < 0 || amountIdx < 0) {
    return {
      ok: false,
      error: "Cabeçalho inválido. Envie o CSV exportado da fatura do Nubank (colunas date, title e amount).",
    };
  }

  const dataRows = rows.slice(1);
  const slashOrder = detectSlashDateOrder(dataRows.map((row) => row[dateIdx]));
  const items = [];
  let ignoredPayments = 0;
  let ignoredCredits = 0;
  let invalidRows = 0;
  const occurrenceCounts = new Map();

  for (const row of dataRows) {
    const rawDate = row[dateIdx];
    const rawTitle = String(row[titleIdx] || "").trim();
    const rawAmount = row[amountIdx];
    if (!rawDate && !rawTitle && !rawAmount) continue;
    const purchaseDate = parseDateValue(rawDate, slashOrder);
    const amountCents = parseCsvAmountCents(rawAmount);
    if (!purchaseDate || !rawTitle || amountCents === null) {
      invalidRows += 1;
      continue;
    }
    if (isInvoicePaymentTitle(rawTitle)) {
      ignoredPayments += 1;
      continue;
    }
    if (amountCents <= 0) {
      ignoredCredits += 1;
      continue;
    }
    const parsedTitle = parseInstallmentTitle(rawTitle);
    const normName = normalizeTextKey(parsedTitle.name);
    const isInstallment = parsedTitle.totalInstallments > 1;
    const occKey = isInstallment
      ? `${normName}|${amountCents}|${parsedTitle.currentInstallment}/${parsedTitle.totalInstallments}`
      : `${purchaseDate}|${normName}|${amountCents}|1/1`;
    const occurrence = (occurrenceCounts.get(occKey) || 0) + 1;
    occurrenceCounts.set(occKey, occurrence);

    items.push({
      purchaseDate,
      rawTitle,
      name: parsedTitle.name,
      normName,
      amountCents,
      currentInstallment: parsedTitle.currentInstallment,
      totalInstallments: parsedTitle.totalInstallments,
      occurrence,
    });
  }

  if (!items.length) {
    return { ok: false, error: "Nenhum lançamento de compra encontrado nesta planilha." };
  }

  const detected = extractDueDateFromFilename(filename);
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const installmentItemsCount = items.filter((item) => item.totalInstallments > 1).length;
  const futureInstallmentsCount = items.reduce(
    (sum, item) => sum + Math.max(0, item.totalInstallments - item.currentInstallment),
    0,
  );

  return {
    ok: true,
    detectedDueDate: detected?.dueDate || "",
    detectedInvoiceMonthId: detected?.invoiceMonthId || "",
    detectedDueDay: detected?.dueDay || null,
    items,
    totalCents,
    installmentItemsCount,
    futureInstallmentsCount,
    ignoredPayments,
    ignoredCredits,
    invalidRows,
  };
}

function monthDiff(fromMonthId, toMonthId) {
  const from = /^(\d{4})-(\d{2})$/.exec(String(fromMonthId || ""));
  const to = /^(\d{4})-(\d{2})$/.exec(String(toMonthId || ""));
  if (!from || !to) return 0;
  return (Number(to[1]) - Number(from[1])) * 12 + (Number(to[2]) - Number(from[2]));
}

function shiftIsoDateMonths(isoDate, deltaMonths) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!match || !deltaMonths) return String(isoDate || "");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  const targetYear = probe.getUTCFullYear();
  const targetMonth = probe.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

export function alignInstallmentPurchaseDate(purchaseDate, invoiceMonthId, currentInstallment) {
  const paidBefore = Math.max(0, Number(currentInstallment || 1) - 1);
  if (paidBefore <= 0) return String(purchaseDate || "");
  const diff = monthDiff(String(purchaseDate || "").slice(0, 7), invoiceMonthId);
  // Quando o Nubank exporta a data de lançamento da parcela atual (ex.: 28/09 na parcela 9/12 de nov/26
  // e 29/10 na parcela 10/12 de dez/26), recuamos pela quantidade de parcelas já pagas para alinhar à 1ª parcela.
  if (diff < paidBefore) {
    return shiftIsoDateMonths(purchaseDate, -paidBefore);
  }
  return String(purchaseDate || "");
}

export function normalizeNubankTextKey(value) {
  return normalizeTextKey(value);
}

export function buildNubankSchedule(items, invoiceMonthId, cardLabel) {
  const cardNorm = normalizeTextKey(cardLabel || "nubank") || "nubank";
  const entries = [];
  for (const item of items) {
    const isInstallment = item.totalInstallments > 1;
    const remaining = Math.max(1, item.totalInstallments - item.currentInstallment + 1);
    const firstInvoiceMonthId = isInstallment
      ? addMonths(invoiceMonthId, -(item.currentInstallment - 1))
      : invoiceMonthId;
    const alignedPurchaseDate = isInstallment
      ? alignInstallmentPurchaseDate(item.purchaseDate, invoiceMonthId, item.currentInstallment)
      : item.purchaseDate;
    const seriesId = isInstallment
      ? `nb-ser:${cardNorm}:${firstInvoiceMonthId}:${item.normName}:${item.amountCents}:${item.totalInstallments}:${item.occurrence}`
      : "";
    for (let offset = 0; offset < remaining; offset += 1) {
      const partNumber = item.currentInstallment + offset;
      const monthId = addMonths(invoiceMonthId, offset);
      const installment = isInstallment ? `${partNumber}/${item.totalInstallments}` : null;
      const importKey = isInstallment
        ? `nb:p:${cardNorm}:${firstInvoiceMonthId}:${item.normName}:${item.amountCents}:${partNumber}/${item.totalInstallments}:${item.occurrence}`
        : `nb:s:${cardNorm}:${invoiceMonthId}:${item.purchaseDate}:${item.normName}:${item.amountCents}:${item.occurrence}`;
      entries.push({
        monthId,
        isCurrentInvoice: offset === 0,
        purchaseDate: alignedPurchaseDate,
        firstInvoiceMonthId,
        name: item.name,
        normName: item.normName,
        amountCents: item.amountCents,
        installment,
        seriesId,
        importKey,
        occurrence: item.occurrence,
      });
    }
  }
  return entries;
}
