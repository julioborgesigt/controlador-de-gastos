import { money, shortMonthLabel } from "../../format.js";
import {
  BRAZILIAN_CARDS,
  NUBANK_EXPORT_HINT,
  isNubankName,
  parseNubankCsv,
} from "../../shared/nubank-csv.js";
import { clearMonthCache, rememberMonth, request } from "../api.js";
import { el, on } from "../dom.js";
import { render, renderSafely, setWorking, state } from "../state.js";
import { formSection, segmented } from "./fields.js";
import { closeSheet } from "./openers.js";

function firstNubankCardName() {
  const match = (state.data?.cards || []).find((card) => isNubankName(card.name));
  return match?.name || "Nubank";
}

function formatBrDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function openNubankImport(cardName = "") {
  state.accountMenu = false;
  state.error = "";
  state.notice = "";
  state.sheet = {
    mode: "import-nubank",
    cardName: String(cardName || "").trim() || firstNubankCardName(),
    filename: "",
    csvText: "",
    parsed: null,
    dueDate: "",
    dueDateConfirmed: false,
    classification: "imprevisto",
  };
  render();
}

export function cardPresetsBlock(currentName, onPick) {
  return el("div", { class: "field", "data-key": "card-presets" }, [
    el("label", {}, "Cartões mais usados no Brasil"),
    el("div", { class: "card-presets" }, BRAZILIAN_CARDS.map((name) => {
      const selected = String(currentName || "").trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR");
      return el("button", {
        type: "button",
        class: `card-preset${selected ? " on" : ""}`,
        "aria-pressed": selected ? "true" : "false",
        onclick: () => onPick(name),
      }, name);
    })),
  ]);
}

const NUBANK_CARD_TIP_DISMISSED_KEY = "nubankCardTipDismissed:v1";
let nubankCardTipDismissedMemory = false;

export function isNubankCardTipDismissed() {
  if (nubankCardTipDismissedMemory) return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(NUBANK_CARD_TIP_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissNubankCardTip() {
  nubankCardTipDismissedMemory = true;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(NUBANK_CARD_TIP_DISMISSED_KEY, "1");
    }
  } catch {
    /* segue apenas nesta sessão */
  }
}

export function nubankSuggestionBanner({ onImport = null, onDismiss = null, compact = false } = {}) {
  const hasActions = Boolean(onImport || onDismiss);
  return el("div", { class: "nubank-tip", "data-key": "nubank-tip" }, [
    el("strong", {}, "Importe sua fatura do Nubank em CSV"),
    el("p", { class: "muted" }, NUBANK_EXPORT_HINT),
    !compact
      ? el("p", { class: "muted" }, "O sistema lê a data de vencimento, lança as compras e projeta automaticamente as parcelas nos meses seguintes.")
      : "",
    hasActions
      ? el("div", { class: "nubank-tip-actions" }, [
        onImport
          ? el("button", {
            type: "button",
            class: "secondary",
            onclick: onImport,
          }, "Importar CSV do Nubank")
          : "",
        onDismiss
          ? el("button", {
            type: "button",
            class: "linkish nubank-tip-dismiss",
            onclick: onDismiss,
          }, "Não exibir mais")
          : "",
      ])
      : "",
  ]);
}

export function renderNubankImportSheet(panel, draft) {
  const fileInput = el("input", {
    id: "nubank-csv-file",
    "data-key": "nubank-csv-file",
    type: "file",
    accept: ".csv,text/csv",
  });
  on(fileInput, "change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    state.error = "";
    try {
      const text = await file.text();
      const parsed = parseNubankCsv(text, file.name);
      draft.filename = file.name;
      draft.csvText = text;
      if (!parsed.ok) {
        draft.parsed = null;
        draft.dueDate = "";
        draft.dueDateConfirmed = false;
        state.error = parsed.error;
      } else {
        draft.parsed = parsed;
        draft.dueDate = parsed.detectedDueDate || draft.dueDate || "";
        draft.dueDateConfirmed = false;
      }
    } catch {
      state.error = "Não foi possível ler o arquivo selecionado.";
    }
    renderSafely();
  });

  const dueInput = el("input", {
    id: "nubank-due-date",
    "data-key": "nubank-due-date",
    type: "date",
    value: draft.dueDate || "",
  });
  on(dueInput, "input", (event) => {
    draft.dueDate = event.currentTarget.value;
    draft.dueDateConfirmed = false;
    render();
  });
  on(dueInput, "change", (event) => {
    draft.dueDate = event.currentTarget.value;
    draft.dueDateConfirmed = false;
    render();
  });

  const confirmCheckbox = el("input", {
    id: "nubank-due-confirm",
    "data-key": "nubank-due-confirm",
    type: "checkbox",
    checked: Boolean(draft.dueDateConfirmed),
  });
  on(confirmCheckbox, "change", (event) => {
    draft.dueDateConfirmed = Boolean(event.currentTarget.checked);
    render();
  });

  const cards = state.data?.cards || [];
  const cardOptions = [...new Set([draft.cardName || "Nubank", "Nubank", ...cards.map((card) => card.name)])];
  const cardSelect = el("select", { id: "nubank-card-name", "data-key": "nubank-card-name" }, cardOptions.map((name) => el("option", { value: name }, name)));
  cardSelect.value = draft.cardName || "Nubank";
  on(cardSelect, "change", (event) => {
    draft.cardName = event.currentTarget.value;
  });

  const parsed = draft.parsed;
  const dueBr = formatBrDate(draft.dueDate);
  const dueMonthLabel = draft.dueDate ? shortMonthLabel(draft.dueDate.slice(0, 7)) : "";

  panel.append(
    el("h2", {}, "Importar fatura Nubank (CSV)"),
    el("p", { class: "muted" }, NUBANK_EXPORT_HINT),
    formSection("Arquivo CSV", [
      el("div", { class: "field file-pick", "data-key": "nubank-file-field" }, [
        el("label", { for: "nubank-csv-file" }, draft.filename ? `Arquivo: ${draft.filename}` : "Escolha o arquivo CSV da fatura"),
        fileInput,
      ]),
      parsed ? el("div", { class: "import-preview", "data-key": "nubank-preview" }, [
        el("div", { class: "row-between" }, [
          el("strong", {}, `${parsed.items.length} ${parsed.items.length === 1 ? "lançamento" : "lançamentos"} na fatura`),
          el("strong", {}, money(parsed.totalCents)),
        ]),
        el("small", {}, [
          parsed.futureInstallmentsCount > 0
            ? `${parsed.futureInstallmentsCount} ${parsed.futureInstallmentsCount === 1 ? "parcela futura será projetada" : "parcelas futuras serão projetadas"} nos meses seguintes`
            : "Nenhuma parcela futura a projetar",
          parsed.ignoredPayments > 0 ? `${parsed.ignoredPayments} pagamento de fatura ignorado` : "",
          parsed.ignoredCredits > 0 ? `${parsed.ignoredCredits} estorno/crédito ignorado` : "",
          parsed.invalidRows > 0 ? `${parsed.invalidRows} ${parsed.invalidRows === 1 ? "linha inválida ignorada" : "linhas inválidas ignoradas"}` : "",
        ].filter(Boolean).join(" · ")),
        el("div", { class: "import-sample" }, parsed.items.slice(0, 4).map((item) => el("div", { class: "row-between" }, [
          el("span", {}, item.totalInstallments > 1
            ? `${item.name} (${item.currentInstallment}/${item.totalInstallments})`
            : item.name),
          el("span", {}, money(item.amountCents)),
        ]))),
        parsed.items.length > 4
          ? el("small", { class: "muted" }, `... e mais ${parsed.items.length - 4} lançamentos`)
          : "",
      ]) : "",
    ], "nubank-file-section"),
    parsed ? formSection("Confirmação e destino", [
      el("div", { class: "field", "data-key": "nubank-due-field" }, [
        el("label", { for: "nubank-due-date" }, parsed.detectedDueDate
          ? "Data de vencimento captada do arquivo (confirme ou ajuste)"
          : "Data de vencimento da fatura"),
        dueInput,
      ]),
      dueBr ? el("label", { class: "confirm-check", for: "nubank-due-confirm", "data-key": "nubank-confirm-box" }, [
        confirmCheckbox,
        el("span", {}, `Confirmo que o vencimento desta fatura é ${dueBr} (fatura de ${dueMonthLabel}).`),
      ]) : "",
      el("div", { class: "field", "data-key": "nubank-card-field" }, [
        el("label", { for: "nubank-card-name" }, "Cartão de destino"),
        cardSelect,
      ]),
      el("div", { class: "field", "data-key": "nubank-track-field" }, [
        el("label", {}, "Tarja inicial dos lançamentos"),
        segmented("classification", [["imprevisto", "Imprevisto"], ["planejado", "Planejado"]], draft.classification || "imprevisto", {
          tones: { planejado: "planned", imprevisto: "extra" },
        }),
      ]),
    ], "nubank-target-section") : "",
    el("p", { class: "muted form-hint" }, "Se esta fatura já foi importada antes, o sistema apenas sincroniza os lançamentos novos sem duplicar parcelas."),
    el("div", { class: "actions" }, [
      el("button", { class: "secondary", type: "button", onclick: closeSheet }, "Cancelar"),
      el("button", {
        class: "primary",
        type: "submit",
        disabled: state.busy || !parsed ? "" : null,
      }, state.busy ? "Importando..." : "Importar e sincronizar"),
    ]),
  );
}

export async function saveNubankImportSheet(draft) {
  if (!draft.csvText || !draft.parsed) {
    throw new Error("Escolha a planilha CSV da fatura do Nubank.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.dueDate || "").trim())) {
    throw new Error("Informe a data de vencimento da fatura.");
  }
  if (!draft.dueDateConfirmed) {
    throw new Error("Confirme a data de vencimento captada antes de importar.");
  }
  setWorking(true, "Importando fatura...");
  let data;
  try {
    data = await request("/api/import/nubank", {
      method: "POST",
      body: {
        csvText: draft.csvText,
        filename: draft.filename || "",
        dueDate: draft.dueDate,
        cardName: draft.cardName || "Nubank",
        classification: draft.classification === "planejado" ? "planejado" : "imprevisto",
      },
    });
  } catch (error) {
    // Limpa o cache local para não exibir estado desatualizado se o cartão/lote parcial já tiver sido gravado
    clearMonthCache();
    const detail = error?.message || "Não foi possível importar a fatura.";
    const code = error?.requestId ? ` (cód. ${String(error.requestId).slice(0, 8)})` : "";
    throw new Error(`${detail}${code}`);
  }
  const summary = data.summary || {};
  clearMonthCache();
  state.data = data;
  if (data.month?.id) {
    state.monthId = data.month.id;
    sessionStorage.setItem("monthId", state.monthId);
  }
  rememberMonth(state.data);
  const cur = summary.insertedCurrent || 0;
  const fut = summary.insertedFuture || 0;
  const futLabel = fut === 1 ? "1 parcela futura" : `${fut} parcelas futuras`;
  const invalidNote = summary.invalidRows > 0
    ? ` (${summary.invalidRows} ${summary.invalidRows === 1 ? "linha inválida ignorada" : "linhas inválidas ignoradas"})`
    : "";
  const addedTotal = cur + fut;
  if (addedTotal === 0) {
    state.notice = `Fatura de ${shortMonthLabel(summary.invoiceMonthId)} já estava sincronizada (${summary.syncedExisting || 0} lançamentos conferidos).${invalidNote}`;
  } else if (summary.syncedExisting > 0) {
    state.notice = `Fatura sincronizada: ${cur} ${cur === 1 ? "novo" : "novos"} na fatura de ${shortMonthLabel(summary.invoiceMonthId)}${fut ? ` + ${futLabel}` : ""} (${summary.syncedExisting} já existentes mantidos).${invalidNote}`;
  } else {
    state.notice = `Importei ${cur} ${cur === 1 ? "lançamento" : "lançamentos"} na fatura de ${shortMonthLabel(summary.invoiceMonthId)}${fut ? ` e projetei ${fut === 1 ? "1 parcela" : `${fut} parcelas`} nos meses seguintes` : ""}.${invalidNote}`;
  }
  state.view = "cartoes";
  return "close";
}
