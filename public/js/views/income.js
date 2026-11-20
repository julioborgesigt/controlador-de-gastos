import { centsToInput, money, parseMoney } from "../../format.js";
import { loadMonth, rememberMonth, request } from "../api.js";
import { titleWithHelp } from "../dialogs/info.js";
import { el, messageOf, monthName } from "../dom.js";
import { editable, render, setWorking, state } from "../state.js";

export function incomeView(data) {
  const base = data.baseIncomeCents === null ? "" : centsToInput(data.baseIncomeCents);
  const extras = data.incomeExtras || [];
  return el("section", {}, [
    el("div", { class: "section-head" }, [
      titleWithHelp("Receita mensal", "Receita mensal", [
        "A base entra nos meses que ainda não foram editados à parte.",
        "Replicar em todos substitui também os meses que já foram ajustados.",
        "Um extra marcado em vários meses entra com o mesmo valor em cada um e soma na receita daquele mês.",
      ]),
      el("h2", {}, money(data.month.incomeCents)),
      el("p", { class: "muted" }, `${data.month.label}: ${money(data.month.baseIncomeCents)} de base${data.month.extraIncomeCents ? ` + ${money(data.month.extraIncomeCents)} extras` : ""}.`),
    ]),
    editable() ? el("div", { class: "panel" }, [
      el("label", { for: "base-income" }, "Receita base"),
      el("input", {
        id: "base-income",
        inputmode: "decimal",
        value: base,
        placeholder: "8000,00",
        oninput: (event) => { state.baseIncome = event.target.value; },
      }),
      el("div", { class: "actions" }, [
        el("button", { class: "secondary", type: "button", onclick: () => saveBase("unlocked") }, "Replicar nos meses livres"),
        el("button", { class: "primary", type: "button", onclick: () => saveBase("all") }, "Replicar em todos os meses"),
      ]),
    ]) : "",
    el("h2", { class: "subhead" }, "Mês a mês"),
    el("div", { class: "list" }, data.months.map((month) => el("article", { class: "item" }, [
      editable()
        ? el("button", { type: "button", class: "item-main", onclick: () => editMonthIncome(month) }, [
          el("strong", {}, month.label),
          el("small", {}, month.incomeLocked ? "Editado à parte" : "Segue a base"),
        ])
        : el("div", { class: "item-copy" }, [
          el("strong", {}, month.label),
          el("small", {}, month.incomeLocked ? "Editado à parte" : "Segue a base"),
        ]),
      el("span", { class: "amount" }, money(monthIncomeTotal(data, month))),
    ]))),
    el("h2", { class: "subhead" }, "Extras do ano"),
    editable() ? el("button", { class: "primary add-top", type: "button", onclick: () => openIncomeExtra() }, "Adicionar receita extra") : "",
    el("div", { class: "list" }, extras.map((extra) => el("article", { class: "item" }, [
      el("div", { class: "item-copy" }, [
        editable()
          ? el("button", { type: "button", class: "item-main", onclick: () => openEditIncomeExtra(extra) }, [
            el("strong", {}, extra.name),
            el("small", {}, monthName(extra.monthId)),
          ])
          : el("div", { class: "item-main" }, [el("strong", {}, extra.name), el("small", {}, monthName(extra.monthId))]),
        editable()
          ? el("div", { class: "item-actions" }, [
            el("button", { class: "linkish", type: "button", onclick: () => openEditIncomeExtra(extra) }, "Editar"),
            el("button", { class: "linkish danger", type: "button", onclick: () => removeIncomeExtra(extra) }, "Excluir"),
          ])
          : "",
      ]),
      el("span", { class: "amount" }, money(extra.amountCents)),
    ]))),
  ]);
}

function monthIncomeTotal(data, month) {
  const extras = (data.incomeExtras || []).filter((extra) => extra.monthId === month.id).reduce((sum, extra) => sum + extra.amountCents, 0);
  return month.incomeCents + extras;
}

function extrasForMonth(monthId) {
  return (state.data?.incomeExtras || [])
    .filter((extra) => extra.monthId === monthId)
    .map((extra) => ({ id: extra.id, name: extra.name, amount: centsToInput(extra.amountCents) }));
}

export function extraAmountField(extra, index) {
  const input = el("input", {
    id: `extra-${extra.id}`,
    inputmode: "decimal",
    value: extra.amount,
  });
  input.addEventListener("input", () => {
    state.sheet.extras[index].amount = input.value;
  });
  return el("div", { class: "field" }, [el("label", { for: `extra-${extra.id}` }, extra.name), input]);
}

async function saveBase(scope) {
  const input = document.querySelector("#base-income");
  const amountCents = parseMoney(input ? input.value : "");
  if (amountCents === null) {
    state.error = "Informe a receita base. Exemplo: 8000,00";
    render();
    return;
  }
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    state.data = await request("/api/income/base", { method: "POST", body: { amountCents, scope, monthId: state.monthId } });
    rememberMonth(state.data);
    state.baseIncome = "";
    state.notice = scope === "all"
      ? "Receita base aplicada em todos os meses."
      : "Receita base aplicada nos meses que ainda seguem a base.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

export async function useBaseIncome(monthId) {
  state.error = "";
  setWorking(true, "Salvando...");
  try {
    await request(`/api/months/${monthId}/use-base-income`, { method: "POST", body: {} });
    await loadMonth(state.monthId);
    state.sheet = null;
    state.notice = "Este mês voltou a usar a receita base.";
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

async function removeIncomeExtra(extra) {
  state.error = "";
  setWorking(true, "Excluindo...");
  try {
    state.data = await request(`/api/income/extras/${extra.id}`, { method: "DELETE" });
    rememberMonth(state.data);
  } catch (error) {
    state.error = messageOf(error);
  } finally {
    setWorking(false);
  }
  render();
}

function editMonthIncome(month) {
  state.sheet = {
    mode: "month-income",
    monthId: month.id,
    label: month.label,
    amount: centsToInput(month.incomeCents),
    extras: extrasForMonth(month.id),
  };
  render();
}

export function openIncomeExtra(monthIds = [state.monthId]) {
  state.sheet = {
    mode: "income-extra",
    id: "",
    kind: "ir",
    name: "",
    amount: "",
    monthId: state.monthId,
    monthIds,
  };
  render();
}

function openEditIncomeExtra(extra) {
  state.sheet = {
    mode: "income-extra",
    id: extra.id,
    kind: extra.kind,
    name: extra.kind === "other" ? extra.name : "",
    amount: centsToInput(extra.amountCents),
    monthId: extra.monthId,
    monthIds: [extra.monthId],
  };
  state.error = "";
  render();
}
