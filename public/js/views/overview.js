import { money, shortMonthLabel } from "../../format.js";
import { changeMonth, loadOverview } from "../api.js";
import { backArrow, el, on } from "../dom.js";
import { render, state } from "../state.js";

let searchTimer = 0;

export function openOverview() {
  state.accountMenu = false;
  state.view = "resumo";
  state.summaryFocus = "overview";
  state.error = "";
  state.notice = "";
  void loadOverview(state.overviewFilter);
  render();
}

function scheduleOverviewReload() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void loadOverview(state.overviewFilter);
  }, 220);
}

function trackTitle(track) {
  if (track === "casa") return "Custo de vida";
  if (track === "planejado") return "Planejado";
  if (track === "imprevisto") return "Imprevisto";
  return "";
}

function trackBadgeClass(track) {
  if (track === "planejado") return "badge source-planned";
  if (track === "imprevisto") return "badge source-extra";
  if (track === "casa") return "badge source-fixed";
  return "badge";
}

function jumpToMatch(item) {
  state.summaryFocus = null;
  if (item.section === "fixed") state.view = "casa";
  else if (item.section === "card") state.view = "cartoes";
  else if (item.payment === "pix") state.view = "avista";
  else state.view = "extras";
  if (item.monthId && item.monthId !== state.monthId) {
    void changeMonth(item.monthId);
  } else {
    render();
  }
}

export function overviewView() {
  const filter = state.overviewFilter;
  const data = state.overview;
  const years = data?.years || [];
  const cards = data?.cards || (state.data?.cards || []).map((card) => card.name);

  const searchInput = el("input", {
    id: "overview-q",
    "data-key": "overview-q",
    type: "search",
    value: filter.q || "",
    placeholder: "Buscar por nome, observação ou cartão...",
    autocomplete: "off",
  });
  on(searchInput, "input", (event) => {
    filter.q = event.currentTarget.value;
    scheduleOverviewReload();
  });

  const cardSelect = el("select", { id: "overview-card", "data-key": "overview-card" }, [
    el("option", { value: "" }, "Todos os cartões"),
    ...cards.map((name) => el("option", { value: name }, name)),
  ]);
  cardSelect.value = filter.card || "";
  on(cardSelect, "change", (event) => {
    filter.card = event.currentTarget.value;
    void loadOverview(filter);
  });

  const tracks = [
    ["", "Todas"],
    ["casa", "Custo de vida"],
    ["planejado", "Planejado"],
    ["imprevisto", "Imprevisto"],
  ];

  const children = [
    el("button", {
      class: "linkish back",
      type: "button",
      onclick: () => {
        state.summaryFocus = null;
        render();
      },
    }, [backArrow(), "Resumo mensal"]),
    el("div", { class: "section-head" }, [
      el("h2", {}, "Busca e visão anual"),
      el("p", { class: "muted" }, "Pesquise lançamentos em todo o período e acompanhe a evolução mês a mês."),
    ]),
    el("div", { class: "overview-filters", "data-key": "overview-filters" }, [
      el("div", { class: "field", "data-key": "overview-search-field" }, [
        el("label", { for: "overview-q" }, "Pesquisar lançamentos"),
        searchInput,
      ]),
      el("div", { class: "field", "data-key": "overview-track-field" }, [
        el("label", {}, "Tarja"),
        el("div", { class: "choice" }, tracks.map(([value, label]) => el("button", {
          type: "button",
          class: (filter.track || "") === value ? "on" : "",
          onclick: () => {
            filter.track = value;
            void loadOverview(filter);
          },
        }, label))),
      ]),
      cards.length
        ? el("div", { class: "field", "data-key": "overview-card-field" }, [
          el("label", { for: "overview-card" }, "Cartão"),
          cardSelect,
        ])
        : "",
      filter.q || filter.card || filter.track
        ? el("button", {
          type: "button",
          class: "linkish",
          onclick: () => {
            filter.q = "";
            filter.card = "";
            filter.track = "";
            void loadOverview(filter);
          },
        }, "Limpar filtros")
        : "",
    ]),
  ];

  if (state.overviewError) {
    children.push(el("p", { class: "error", "data-key": "overview-error" }, state.overviewError));
  }

  if (state.overviewLoading && !data) {
    children.push(el("p", { class: "muted" }, "Carregando visão do período..."));
    return el("section", { "data-key": "overview-section" }, children);
  }

  if (data?.hasFilter) {
    const matches = data.matches || [];
    children.push(
      el("p", { class: "eyebrow group" }, `Resultados da busca (${data.totalMatches})`),
      matches.length
        ? el("div", { class: "list" }, matches.map((item) => el("button", {
          type: "button",
          class: "jump",
          "data-key": `match-${item.id}`,
          onclick: () => jumpToMatch(item),
        }, [
          el("div", { class: "row-between" }, [
            el("strong", {}, item.installment ? `${item.name} (${item.installment})` : item.name),
            el("strong", {}, money(item.amountCents)),
          ]),
          el("div", { class: "row-between overview-meta" }, [
            el("small", {}, [
              shortMonthLabel(item.monthId),
              item.cardLabel ? item.cardLabel : item.payment === "card" ? "Crédito" : "Pix",
              item.note || "",
            ].filter(Boolean).join(" · ")),
            item.track ? el("span", { class: trackBadgeClass(item.track) }, trackTitle(item.track)) : "",
          ]),
        ])))
        : el("p", { class: "muted" }, "Nenhum lançamento encontrado com esses filtros."),
    );
  }

  if (data) {
    const totals = data.annualTotals;
    const months = data.months || [];
    const maxCents = Math.max(1, ...months.map((month) => Math.max(month.incomeCents, month.commitmentsCents)));

    children.push(
      el("p", { class: "eyebrow group" }, data.selectedYear ? `Visão anual · ${data.selectedYear}` : "Visão do período"),
      years.length > 1
        ? el("div", { class: "choice overview-years", "data-key": "overview-years" }, [
          el("button", {
            type: "button",
            class: !filter.year ? "on" : "",
            onclick: () => {
              filter.year = "";
              void loadOverview(filter);
            },
          }, "Todo período"),
          ...years.map((year) => el("button", {
            type: "button",
            class: filter.year === year ? "on" : "",
            onclick: () => {
              filter.year = year;
              void loadOverview(filter);
            },
          }, year)),
        ])
        : "",
      el("div", { class: "grid" }, [
        el("div", { class: "metric" }, [
          el("small", {}, `Receita (${totals.monthCount} ${totals.monthCount === 1 ? "mês" : "meses"})`),
          el("strong", {}, money(totals.incomeCents)),
        ]),
        el("div", { class: "metric" }, [
          el("small", {}, "Total comprometido"),
          el("strong", {}, money(totals.commitmentsCents)),
        ]),
        el("div", { class: "metric" }, [
          el("small", {}, "Saldo acumulado"),
          el("strong", { class: totals.balanceCents < 0 ? "negative" : "positive" }, money(totals.balanceCents)),
        ]),
        el("div", { class: "metric" }, [
          el("small", {}, "Média mensal"),
          el("strong", {}, money(totals.avgCommitmentsCents)),
        ]),
      ]),
      el("p", { class: "eyebrow group" }, "Evolução mês a mês"),
      el("div", { class: "overview-bars" }, months.map((month) => {
        const pct = Math.min(100, Math.round((month.commitmentsCents / maxCents) * 100));
        return el("button", {
          type: "button",
          class: "jump overview-row",
          "data-key": `ov-${month.id}`,
          onclick: () => {
            state.summaryFocus = null;
            void changeMonth(month.id);
          },
        }, [
          el("div", { class: "row-between" }, [
            el("span", {}, month.label),
            el("strong", { class: month.balanceCents < 0 ? "negative" : "positive" }, money(month.balanceCents)),
          ]),
          el("div", { class: "overview-bar-track", "aria-hidden": "true" }, [
            el("span", {
              class: `overview-bar-fill${month.balanceCents < 0 ? " over" : ""}`,
              style: { width: `${pct}%` },
            }),
          ]),
          el("small", {}, `Receita ${money(month.incomeCents)} · Previsto ${money(month.commitmentsCents)} · Fatura ${money(month.faturaCents)}`),
        ]);
      })),
    );
  }

  return el("section", { "data-key": "overview-section" }, children);
}
