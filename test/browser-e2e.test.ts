import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  findChromeBinary,
  launchBrowser,
  startAppServer,
  type BrowserInstance,
  type BrowserPage,
} from "./helpers/browser-e2e.ts";

const CHROME = findChromeBinary();

async function completeOnboarding(page: BrowserPage) {
  await page.goto("/");
  await page.waitForText("Criar conta");

  await page.fill("#cpf", "52998224725");
  await page.fill("#email", "e2e@exemplo.com");
  await page.fill("#password", "segredo-forte-123");
  await page.fill("#confirmation", "segredo-forte-123");
  await page.click('button[type="submit"]');

  // Passo 1 do onboarding: período
  await page.waitForText("Qual período você quer planejar?");
  await page.clickButton("Continuar");

  // Passo 2: cartão
  await page.waitForText("Você usa cartão?");
  await page.clickButton("Tenho cartão");
  await page.fill("#card-name-0", "Nubank");
  await page.clickButton("Continuar");

  // Passo 3: renda base
  await page.waitForText("Qual é a renda mensal base?");
  await page.fill("#base-setup", "5000,00");
  await page.clickButton("Continuar");

  // Passo 4: tema
  await page.waitForText("Como prefere ver o app?");
  await page.clickButton("Continuar");

  // Passo 5: dispositivo
  await page.waitForText("Cadastrar este dispositivo?");
  await page.clickButton("Agora não");

  // Guia inicial após setup (se aparecer) ou direto no shell
  await page.waitFor('Boolean(document.querySelector(".shell") || document.body.innerText.includes("Começar"))');
  const hasGuide = await page.evaluate<boolean>('Boolean(!document.querySelector(".shell") && document.body.innerText.includes("Começar"))');
  if (hasGuide) {
    await page.clickButton("Começar");
  }
  await page.waitForSelector(".shell");
}

async function dismissTabIntroIfOpen(page: BrowserPage) {
  const open = await page.evaluate<boolean>('Boolean(document.querySelector(".dialog"))');
  if (open) {
    await page.clickButton("Não mostrar novamente", ".dialog");
    await page.waitFor('!document.querySelector(".dialog")');
  }
}

describe("E2E navegador real (Chromium)", { skip: !CHROME }, () => {
  let browser: BrowserInstance | null = null;

  before(async () => {
    browser = await launchBrowser(CHROME!);
  });

  after(async () => {
    if (browser) await browser.close();
  });

  test("onboarding, custo de vida, compra parcelada no cartão, quitação de fatura e zero violações CSP", { timeout: 30_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      const healthRes = await fetch(`${server.baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      const health = (await healthRes.json()) as { ok: boolean; db: string };
      assert.equal(health.ok, true);
      assert.equal(health.db, "ok");

      await completeOnboarding(page);
      await page.waitForText("5.000,00");

      // 1. Cadastrar custo de vida na aba "Custo de vida"
      await page.click('nav.nav button[data-key="casa"]');
      await dismissTabIntroIfOpen(page);
      await page.waitForText("Adicionar custo");
      await page.clickButton("Adicionar custo");
      await page.waitForSelector("form.sheet");
      await page.fill('form.sheet input[name="name"]', "Aluguel");
      await page.fill('form.sheet input[name="amount"]', "1500,00");
      await page.click('form.sheet button[type="submit"]');
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForText("Aluguel");

      // 2. Lançar compra parcelada no cartão na aba "Cartões"
      await page.click('nav.nav button[data-key="cartoes"]');
      await dismissTabIntroIfOpen(page);
      await page.waitForText("+ Gasto no crédito");
      await page.clickButton("+ Gasto no crédito");
      await page.waitForSelector("form.sheet");

      // Classificação deve ser o primeiro bloco e NENHUM dos 3 itens pode vir pré-selecionado
      const initialKindState = await page.evaluate<{
        selectedCount: number;
        hasNameInput: boolean;
        sameRow: boolean;
      }>(`(() => {
        const btns = [...document.querySelectorAll('form.sheet [data-segment="expenseKind"]')];
        const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
        return {
          selectedCount: btns.filter((b) => b.classList.contains("on") || b.getAttribute("aria-pressed") === "true").length,
          hasNameInput: Boolean(document.querySelector('form.sheet input[name="name"]')),
          sameRow: btns.length === 3 && Math.max(...tops) - Math.min(...tops) <= 4,
        };
      })()`);
      assert.equal(initialKindState.selectedCount, 0, "nenhuma classificação pode vir pré-selecionada");
      assert.equal(initialKindState.hasNameInput, false, "campo nome não deve aparecer antes de escolher classificação");
      assert.equal(initialKindState.sameRow, true, "os 3 botões de classificação devem ficar alinhados na mesma linha");

      // Tentar lançar sem escolher classificação deve exibir validação e manter o sheet aberto
      await page.click('form.sheet button[type="submit"]');
      await page.waitForText("Escolha a classificação.");

      // Selecionar "Custo de vida" NÃO deve exibir o campo Nome, e sim a lista de custos previstos
      await page.click('form.sheet [data-segment="expenseKind"][data-value="casa"]');
      await page.waitForSelector('form.sheet select[id="linkExpenseId"]');
      const livingLayout = await page.evaluate<{
        hasNameInput: boolean;
        dateHeight: number;
        invoiceHeight: number;
      }>(`(() => ({
        hasNameInput: Boolean(document.querySelector('form.sheet input[name="name"]')),
        dateHeight: Math.round(document.querySelector('form.sheet #purchaseDate').getBoundingClientRect().height),
        invoiceHeight: Math.round(document.querySelector('form.sheet #invoiceMonthId').getBoundingClientRect().height),
      }))()`);
      assert.equal(livingLayout.hasNameInput, false, "campo nome não deve aparecer para Custo de vida");
      assert.ok(Math.abs(livingLayout.dateHeight - livingLayout.invoiceHeight) <= 2, "Data da compra e Entra na fatura devem ter a mesma altura");

      // Selecionar "Planejado" libera o campo Nome para lançar compra parcelada
      await page.click('form.sheet [data-segment="expenseKind"][data-value="planejado"]');
      await page.waitForSelector('form.sheet input[name="name"]');
      await page.fill('form.sheet input[name="name"]', "Notebook");
      await page.fill('form.sheet input[name="amount"]', "600,00");
      await page.clickButton("Parcelado", "form.sheet");
      await page.fill('form.sheet input[name="installmentCount"]', "2");

      // Garante que a 1ª parcela entra na fatura do mês atual (primeiro mês do período)
      const currentMonthId = await page.evaluate<string>(
        'document.querySelector("div.months button.chip.active")?.getAttribute("data-key") || ""',
      );
      await page.selectOption('form.sheet select[id="invoiceMonthId"]', currentMonthId);
      await page.click('form.sheet button[type="submit"]');
      await page.waitFor('!document.querySelector("form.sheet")');

      // Expande as faturas do mês (se dobrado) e abre detalhe do cartão Nubank
      const cardRowVisible = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
      if (!cardRowVisible) {
        await page.clickButton("Faturas a serem pagas");
      }
      await page.waitForSelector(".card-manage .item-main");
      await page.click(".card-manage .item-main");
      await page.waitForText("Notebook");
      await page.waitForText("1/2");
      // Dentro do detalhe do cartão não deve existir ação de pagar/desfazer item individual
      const cardLeadButtons = await page.evaluate<number>('document.querySelectorAll(".swipe .swipe-lead button").length');
      assert.equal(cardLeadButtons, 0, "itens dentro da fatura do cartão não devem ter swipe-right Pago/Desfazer");

      // Volta para lista de cartões e quita a fatura do Nubank via swipe para a direita ("Pago no Pix")
      const payCardByPix = async () => {
        await page.waitForSelector(".card-swipe .swipe-front");
        await page.drag(".card-swipe .swipe-front", 140, 0);
        const clicked = await page.evaluate<boolean>(`(() => {
          const btn = [...document.querySelectorAll(".card-swipe .swipe-lead button")]
            .find((b) => (b.textContent || "").includes("Pago"));
          if (!btn) return false;
          btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
          return true;
        })()`);
        assert.equal(clicked, true);
        await page.waitForText("Fatura de Nubank paga no Pix.");
        await new Promise((resolve) => setTimeout(resolve, 750));
      };
      await page.clickButton("Todos os cartões");
      await payCardByPix();

      // Mesmo com a fatura paga, dentro do cartão não deve existir Desfazer individual
      await page.click(".card-manage .item-main");
      await page.waitForText("Notebook");
      const paidCardLeadButtons = await page.evaluate<number>('document.querySelectorAll(".swipe .swipe-lead button").length');
      assert.equal(paidCardLeadButtons, 0, "itens de fatura paga não devem ter Desfazer individual");
      await page.clickButton("Todos os cartões");
      await page.waitForSelector(".card-swipe .swipe-front");

      // Arrastar para a direita na fatura paga pede confirmação antes de desfazer
      await page.drag(".card-swipe .swipe-front", 140, 0);
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.waitForText("Desfazer pagamento da fatura");
      await page.clickButton("Cancelar", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForText("Pago");

      // Confirmando no diálogo, o pagamento da fatura é desfeito e o feedback aparece no toast pop-up com barra de progresso
      await page.drag(".card-swipe .swipe-front", 140, 0);
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.clickButton("Desfazer", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForSelector('.toast[role="status"] .toast-progress-fill');
      await page.waitForText("Pagamento de Nubank desfeito.");
      // Garante que não há banner inline de notice na página e que a página de cartões tem painéis e seção de cartões cadastrados
      assert.equal(await page.evaluate<boolean>('Boolean(document.querySelector(\'[data-key="notice"]\'))'), false);
      assert.equal(await page.evaluate<boolean>('Boolean(document.querySelector(".invoice-panel .cards-list-block .card-chip-icon"))'), true);
      // Toast fecha automaticamente após 3 segundos
      await page.waitFor('!document.querySelector(".toast")', 4500);
      await page.waitForText("Em aberto");

      // Quita novamente para validar o Resumo quitado
      await payCardByPix();

      // Volta para Resumo e valida que barra de progresso (CSSOM) foi aplicada sem erro CSP
      await page.click('nav.nav button[data-key="resumo"]');
      await page.waitForSelector(".hero-bar span");
      const barWidth = await page.evaluate<string>('document.querySelector(".hero-bar span")?.style.width || ""');
      assert.ok(barWidth.endsWith("%"), `barra de progresso deve aplicar width via CSSOM, recebeu: "${barWidth}"`);

      assert.deepEqual(page.errors, [], `Erros inesperados no navegador: ${page.errors.join("; ")}`);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("renderização incremental preserva identidade do DOM, foco e valor durante re-renders", { timeout: 30_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      await page.click('nav.nav button[data-key="casa"]');
      await dismissTabIntroIfOpen(page);
      await page.evaluate("window.__shellRef = document.querySelector('.shell');");

      await page.clickButton("Adicionar custo");
      await page.waitForSelector("form.sheet");
      await page.evaluate(`(() => {
        window.__sheetRef = document.querySelector('form.sheet');
        window.__nameInputRef = document.querySelector('form.sheet input[name="name"]');
      })()`);

      await page.evaluate('document.querySelector(\'form.sheet input[name="name"]\').focus()');
      await page.typeKeys("Mercado");

      // Dispara re-render dentro do sheet alternando para pagamento no Crédito
      await page.clickButton("Crédito", "form.sheet");
      await page.waitForSelector('form.sheet select[id="cardLabel"]');

      const preserved = await page.evaluate<{
        sameShell: boolean;
        sameSheet: boolean;
        sameInput: boolean;
        value: string;
      }>(`({
        sameShell: document.querySelector('.shell') === window.__shellRef,
        sameSheet: document.querySelector('form.sheet') === window.__sheetRef,
        sameInput: document.querySelector('form.sheet input[name="name"]') === window.__nameInputRef,
        value: document.querySelector('form.sheet input[name="name"]')?.value || "",
      })`);

      assert.equal(preserved.sameShell, true, ".shell deve permanecer montado in-place");
      assert.equal(preserved.sameSheet, true, "form.sheet deve permanecer montado in-place");
      assert.equal(preserved.sameInput, true, "input[name=name] deve preservar identidade DOM");
      assert.equal(preserved.value, "Mercado");

      // Fecha o sheet com tecla Escape real
      await page.pressKey("Escape");
      await page.waitFor('!document.querySelector("form.sheet")');

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("swipe mobile, tema escuro, busca/visão anual e sheet de exportação", { timeout: 30_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      // Cria um custo de vida para testar swipe real no mobile (390x844)
      await page.click('nav.nav button[data-key="casa"]');
      await dismissTabIntroIfOpen(page);
      await page.clickButton("Adicionar custo");
      await page.waitForSelector("form.sheet");
      await page.fill('form.sheet input[name="name"]', "Energia");
      await page.fill('form.sheet input[name="amount"]', "220,00");
      await page.click('form.sheet button[type="submit"]');
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForSelector(".swipe-front");

      // Arrasta linha para esquerda no viewport mobile e verifica abertura do swipe
      await page.drag(".swipe-front", -120, 0);
      const swipeOpened = await page.evaluate<boolean>('Boolean(document.querySelector(".swipe.swipe-left"))');
      assert.equal(swipeOpened, true, "arrastar .swipe-front para a esquerda deve revelar as ações");

      // Alterna tema escuro pelo menu da conta e valida organização em seções
      await page.click('header.top button[aria-label="Conta"]');
      await page.waitForSelector('.menu[role="menu"]');
      const menuCheck = await page.evaluate<{ labels: string[]; dangerTexts: string[]; dangerAlignedLeft: boolean }>(`(() => {
        const menu = document.querySelector('.menu[role="menu"]');
        const labels = [...menu.querySelectorAll('.menu-label')].map((el) => el.textContent.trim());
        const groups = [...menu.querySelectorAll('.menu-group')];
        const last = groups[groups.length - 1];
        const dangerButtons = last ? [...last.querySelectorAll('.menu-item-danger')] : [];
        const dangerTexts = dangerButtons.map((b) => b.textContent.trim());
        const dangerAlignedLeft = dangerButtons.every((b) => getComputedStyle(b).justifyContent === "flex-start");
        return { labels, dangerTexts, dangerAlignedLeft };
      })()`);
      assert.deepEqual(menuCheck.labels, ["Dados e consultas", "Preferências", "Conta e segurança"]);
      assert.deepEqual(menuCheck.dangerTexts, ["Resetar meus dados", "Sair"]);
      assert.equal(menuCheck.dangerAlignedLeft, true);
      await page.clickButton("Usar modo escuro", '.menu[role="menu"]');
      await page.waitFor('document.documentElement.dataset.theme === "dark"');

      // Alterna para viewport desktop e navega para Resumo
      await page.setViewport(1280, 800, false);
      await page.click('nav.nav button[data-key="resumo"]');
      await dismissTabIntroIfOpen(page);
      await page.waitForText("Resumo mensal");

      // Abre Busca e visão anual pelo Resumo e pesquisa "Energia" preservando foco e barras CSSOM
      await page.clickButton("Busca e visão anual");
      await page.waitForSelector("#overview-q");
      await page.waitForText("Evolução mês a mês");
      await page.evaluate(`(() => {
        window.__searchRef = document.querySelector('#overview-q');
        window.__searchRef.focus();
      })()`);
      await page.typeKeys("Energia");
      await page.waitForText("Resultados da busca (12)");
      const sameSearch = await page.evaluate<boolean>('document.querySelector("#overview-q") === window.__searchRef');
      assert.equal(sameSearch, true, "campo de busca deve preservar identidade DOM durante re-render");

      // Abre sheet de Exportar backup pelo menu da conta
      await page.click('header.top button[aria-label="Conta"]');
      await page.waitForSelector('.menu[role="menu"]');
      await page.clickButton("Exportar backup", '.menu[role="menu"]');
      await page.waitForSelector("form.sheet");
      await page.waitForText("Baixar planilha (CSV)");
      await page.waitForText("Baixar backup completo (JSON)");
      await page.pressKey("Escape");
      await page.waitFor('!document.querySelector("form.sheet")');

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("sugestão de cartões brasileiros + importação e sincronização de CSV Nubank com parcelas futuras", { timeout: 30_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      // Vai para Cartões de crédito e abre "Adicionar cartão" para validar sugestões brasileiras + dica Nubank
      await page.click('nav.nav button[data-key="cartoes"]');
      await dismissTabIntroIfOpen(page);
      await page.clickButton("Adicionar cartão");
      await page.waitForSelector(".card-presets");
      await page.waitForText("Itaú");
      await page.waitForText("Inter");
      await page.clickButton("Nubank", ".card-presets");
      await page.waitForText("Importe sua fatura do Nubank em CSV");

      // Abre a sheet de importação direto pela sugestão do Nubank
      await page.clickButton("Importar CSV do Nubank", ".nubank-tip");
      await page.waitForSelector("#nubank-csv-file");

      const csvContent = [
        "date,title,amount",
        "2026-10-24,Farmacia Central - Parcela 1/2,74.37",
        "2026-10-26,Google Garena,20.99",
        "2026-10-05,Pagamento recebido,-500.00",
      ].join("\n");

      const uploadCsv = async () => {
        await page.evaluate(`(() => {
          const input = document.querySelector("#nubank-csv-file");
          const dt = new DataTransfer();
          dt.items.add(new File([${JSON.stringify(csvContent)}], "Nubank_2026-11-05.csv", { type: "text/csv" }));
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        })()`);
      };

      await uploadCsv();
      await page.waitForSelector("#nubank-due-date");
      const detectedDue = await page.evaluate<string>('document.querySelector("#nubank-due-date")?.value || ""');
      assert.equal(detectedDue, "2026-11-05");
      await page.waitForText("1 parcela futura será projetada");

      // Confirma data de vencimento captada e importa
      await page.click("#nubank-due-confirm");
      await page.clickButton("Importar e sincronizar", "form.sheet");
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForText("projetei 1 parcela nos meses seguintes");

      // Confere 1/2 em nov/26 e 2/2 projetada em dez/26
      const rowVisible = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
      if (!rowVisible) {
        await page.clickButton("Faturas a serem pagas");
      }
      await page.waitForSelector(".card-manage .item-main");
      await page.click(".card-manage .item-main");
      await page.waitForText("Farmacia Central");
      await page.waitForText("1/2");
      assert.equal(await page.evaluate<boolean>('Boolean(document.querySelector(".item-actions"))'), false);

      // Abre Editar em um gasto importado e confirma que a tela é a mesma de "Gasto no crédito"
      const editOpened = await page.evaluate<boolean>(`(() => {
        const rows = [...document.querySelectorAll(".swipe")];
        const row = rows.find((el) => (el.textContent || "").includes("Farmacia Central"));
        const btn = row && [...row.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Editar");
        if (!btn) return false;
        btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
        return true;
      })()`);
      assert.equal(editOpened, true);
      await page.waitForSelector("form.sheet");
      await page.waitForText("Editar gasto no crédito");
      await page.waitForSelector('form.sheet #purchaseDate');
      await page.waitForSelector('form.sheet #invoiceMonthId');
      await page.waitForSelector('form.sheet [data-segment="billing"][data-value="installments"].on');
      await page.waitForSelector('form.sheet [data-segment="expenseKind"][data-value="casa"]');
      await page.click('form.sheet [data-segment="expenseKind"][data-value="planejado"]');
      await page.clickButton("Salvar", "form.sheet");
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForText("Planejado");

      await page.click('div.months button[data-key="2026-12"]');
      await page.waitForText("2/2");

      // Reimporta o mesmo CSV pelo menu do usuário e confirma sincronização sem duplicar
      await page.click('header.top button[aria-label="Conta"]');
      await page.waitForSelector('.menu[role="menu"]');
      await page.clickButton("Importar fatura Nubank (CSV)", '.menu[role="menu"]');
      await page.waitForSelector("#nubank-csv-file");
      await uploadCsv();
      await page.waitForSelector("#nubank-due-confirm");
      await page.click("#nubank-due-confirm");
      await page.clickButton("Importar e sincronizar", "form.sheet");
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForText("já estava sincronizada");

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("seleção múltipla por pressão longa para exclusão e exclusão de cartão com gastos após timer de 5s", { timeout: 35_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      // Vai para Cartões de crédito (Nubank já existe do onboarding) e abre o detalhe do cartão
      await page.click('nav.nav button[data-key="cartoes"]');
      await dismissTabIntroIfOpen(page);
      const initialRowVisible = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
      if (!initialRowVisible) {
        await page.clickButton("Faturas a serem pagas");
      }
      await page.waitForSelector(".card-manage .item-main");
      await page.click(".card-manage .item-main");

      const addCardSpend = async (name: string, amount: string) => {
        await page.clickButton("+ Gasto no crédito");
        await page.waitForSelector("form.sheet");
        await page.click('form.sheet [data-segment="expenseKind"][data-value="imprevisto"]');
        await page.waitForSelector('form.sheet input[name="name"]');
        if (name === "Café") {
          const selectionPolicy = await page.evaluate<{ body: string; input: string }>(`(() => ({
            body: getComputedStyle(document.body).userSelect,
            input: getComputedStyle(document.querySelector('form.sheet input[name="name"]')).userSelect,
          }))()`);
          assert.equal(selectionPolicy.body, "none", "body deve bloquear seleção acidental de texto");
          assert.equal(selectionPolicy.input, "text", "campos de entrada devem manter seleção de texto liberada");
        }
        await page.fill('form.sheet input[name="name"]', name);
        await page.fill('form.sheet input[name="amount"]', amount);
        await page.selectOption("#invoiceMonthId", "2026-11");
        await page.click('form.sheet button[type="submit"]');
        await page.waitFor('!document.querySelector("form.sheet")');
      };

      await addCardSpend("Café", "15,00");
      await addCardSpend("Padaria", "25,00");
      await addCardSpend("Uber", "40,00");
      await page.waitForText("Café");
      await page.waitForText("Padaria");
      await page.waitForText("Uber");

      // Aperta e segura em "Café" (~500ms) para ativar seleção múltipla
      await page.evaluate(`(() => {
        const card = [...document.querySelectorAll("article.item")].find((el) => (el.textContent || "").includes("Café"));
        if (!card) throw new Error("Café não encontrado");
        card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "touch", clientX: 60, clientY: 60 }));
      })()`);
      await page.waitForSelector(".select-bar");
      await page.waitForText("1 selecionado");

      // Solta o dedo e aguarda cooldown de click fantasma, depois toca em "Padaria" para somar 2 selecionados
      await new Promise((resolve) => setTimeout(resolve, 700));
      await page.evaluate(`(() => {
        const card = [...document.querySelectorAll("article.item.selectable")].find((el) => (el.textContent || "").includes("Padaria"));
        if (!card) throw new Error("Padaria não encontrada");
        card.querySelector("button.item-main").click();
      })()`);
      await page.waitForText("2 selecionados");

      // Exclui os 2 gastos selecionados com confirmação (e garante que o overlay borra a barra de seleção)
      await page.clickButton("Excluir (2)", ".select-bar");
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.waitForText("Excluir 2 gastos");
      const overlayAboveSelectBar = await page.evaluate<boolean>(`(() => {
        const ov = document.querySelector('.overlay[data-key="confirm"]');
        const bar = document.querySelector('.select-bar');
        return Boolean(ov && bar && Number(getComputedStyle(ov).zIndex) > Number(getComputedStyle(bar).zIndex));
      })()`);
      assert.equal(overlayAboveSelectBar, true, ".overlay deve ficar acima da .select-bar para borrar todo o fundo");
      await page.clickButton("Excluir 2 gastos", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForText("Excluí 2 gastos selecionados.");
      await page.waitFor('!(document.body?.innerText || "").includes("Padaria")');
      await page.waitForText("Uber");

      // Excluir uma despesa à vista (sem parcelas e sem outros meses) NÃO deve oferecer "Todos os meses"
      const singleDeleteClicked = await page.evaluate<boolean>(`(() => {
        const rows = [...document.querySelectorAll(".swipe")];
        const row = rows.find((el) => (el.textContent || "").includes("Uber"));
        const btn = row && [...row.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Excluir");
        if (!btn) return false;
        btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
        return true;
      })()`);
      assert.equal(singleDeleteClicked, true);
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.waitForText("Excluir gasto");
      assert.equal(await page.evaluate<boolean>('(document.body?.innerText || "").includes("Todos os meses")'), false);
      await page.clickButton("Cancelar", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');

      // Também funciona em outra aba (Custo de vida)
      await page.click('nav.nav button[data-key="casa"]');
      await dismissTabIntroIfOpen(page);
      for (const [name, amount] of [["Água", "80,00"], ["Luz", "120,00"]]) {
        await page.clickButton("Adicionar custo");
        await page.waitForSelector("form.sheet");
        await page.fill('form.sheet input[name="name"]', name);
        await page.fill('form.sheet input[name="amount"]', amount);
        await page.click('form.sheet button[type="submit"]');
        await page.waitFor('!document.querySelector("form.sheet")');
      }
      await page.waitForText("Água");
      await page.waitForText("Luz");
      await page.evaluate(`(() => {
        const card = [...document.querySelectorAll("article.item")].find((el) => (el.textContent || "").includes("Água"));
        card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "touch", clientX: 60, clientY: 60 }));
      })()`);
      await page.waitForSelector(".select-bar");
      await new Promise((resolve) => setTimeout(resolve, 700));
      await page.clickButton("Todos", ".select-bar");
      await page.waitForText("2 selecionados");
      await page.clickButton("Excluir (2)", ".select-bar");
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.clickButton("Excluir 2 gastos", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForText("Excluí 2 gastos selecionados.");

      // Volta em Cartões de crédito e exclui o cartão Nubank mesmo contendo o gasto "Uber", aguardando o timer de 5s
      await page.click('nav.nav button[data-key="cartoes"]');
      const rowVisible = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
      if (!rowVisible) {
        await page.clickButton("Faturas a serem pagas");
      }
      await page.waitForSelector(".card-swipe");
      const deleteTriggered = await page.evaluate<boolean>(`(() => {
        const btn = [...document.querySelectorAll(".card-swipe .swipe-trail button")]
          .find((b) => (b.textContent || "").trim() === "Excluir");
        if (!btn || btn.disabled) return false;
        btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
        return true;
      })()`);
      assert.equal(deleteTriggered, true, "botão Excluir do cartão com gastos deve estar habilitado");
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.waitForText("Excluir cartão permanentemente");
      await page.waitForText("permanente");

      // Botão de confirmação inicia desabilitado com contagem regressiva de 5s
      const initialDisabled = await page.evaluate<boolean>(`(() => {
        const btn = document.querySelector('.dialog button.danger');
        return Boolean(btn && btn.disabled && /Confirmar em \\ds/.test(btn.textContent || ""));
      })()`);
      assert.equal(initialDisabled, true, "botão deve começar bloqueado com timer de 5s");

      // Aguarda o timer de 5s liberar o botão e confirma a exclusão permanente
      await page.waitFor(`(() => {
        const btn = document.querySelector('.dialog button.danger');
        return Boolean(btn && !btn.disabled && (btn.textContent || "").includes("Confirmar exclusão"));
      })()`, 8_000);
      await page.clickButton("Confirmar exclusão", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForText("excluído permanentemente");
      assert.equal(await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage"))'), false);

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("mantém a posição de rolagem ao cancelar ou salvar edição de gasto e de cartão", { timeout: 30_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      // Cria gastos e cartões suficientes para garantir rolagem vertical real no viewport mobile
      await page.evaluate(`(async () => {
        for (let i = 1; i <= 14; i += 1) {
          const res = await fetch("/api/expenses", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              monthId: "2026-11",
              name: "Custo " + String(i).padStart(2, "0"),
              section: "fixed",
              amountCents: 10000 + i * 100,
              payment: "pix",
            }),
          });
          if (!res.ok) throw new Error("Falha ao criar custo " + i);
        }
        for (let i = 1; i <= 8; i += 1) {
          const res = await fetch("/api/cards", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "Cartão Extra " + i,
              dueDay: 10 + i,
              closingDay: 3 + i,
            }),
          });
          if (!res.ok) throw new Error("Falha ao criar cartão " + i);
        }
      })()`);

      await page.goto(server.baseUrl);
      await page.waitForSelector('nav.nav button[data-key="casa"]');
      await page.click('nav.nav button[data-key="casa"]');
      await dismissTabIntroIfOpen(page);
      await page.waitForText("Custo 14");

      // Rola até o fim da lista de gastos
      const expenseScrollBefore = await page.evaluate<number>(`(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollY;
      })()`);
      assert.ok(expenseScrollBefore > 200, `esperava rolagem > 200px em Custo de vida, obteve ${expenseScrollBefore}`);

      const triggerExpenseEdit = async () => {
        const opened = await page.evaluate<boolean>(`(() => {
          const row = [...document.querySelectorAll(".swipe")].find((el) => (el.textContent || "").includes("Custo 14"));
          const btn = row && [...row.querySelectorAll(".swipe-trail button")].find((b) => (b.textContent || "").trim() === "Editar");
          if (!btn) return false;
          btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
          return true;
        })()`);
        assert.equal(opened, true, "deve acionar Editar do Custo 14");
        await page.waitForSelector("form.sheet");
      };

      // Abre edição do último gasto e CANCELA — página não pode subir ao topo após history.back()
      await triggerExpenseEdit();
      await page.clickButton("Cancelar", "form.sheet");
      await page.waitFor('!document.querySelector("form.sheet")');
      await new Promise((resolve) => setTimeout(resolve, 150));
      const expenseScrollAfterCancel = await page.evaluate<number>("window.scrollY");
      assert.ok(
        Math.abs(expenseScrollAfterCancel - expenseScrollBefore) <= 10,
        `rolagem após cancelar edição de gasto deveria ficar perto de ${expenseScrollBefore}, ficou em ${expenseScrollAfterCancel}`,
      );

      // Abre edição do último gasto e SALVA — página também deve permanecer na mesma altura
      await triggerExpenseEdit();
      await page.waitForSelector("form.sheet");
      await page.fill('form.sheet input[name="name"]', "Custo 14 Editado");
      await page.click('form.sheet button[type="submit"]');
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForText("Custo 14 Editado");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const expenseScrollAfterSave = await page.evaluate<number>("window.scrollY");
      assert.ok(
        Math.abs(expenseScrollAfterSave - expenseScrollBefore) <= 10,
        `rolagem após salvar edição de gasto deveria ficar perto de ${expenseScrollBefore}, ficou em ${expenseScrollAfterSave}`,
      );

      // Vai para Cartões de crédito e testa cancelar e salvar edição de um cartão lá embaixo
      await page.click('nav.nav button[data-key="cartoes"]');
      await dismissTabIntroIfOpen(page);
      const cardsExpanded = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
      if (!cardsExpanded) {
        await page.clickButton("Faturas a serem pagas");
      }
      await page.waitForText("Cartão Extra 8");
      const cardScrollBefore = await page.evaluate<number>(`(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollY;
      })()`);
      assert.ok(cardScrollBefore > 200, `esperava rolagem > 200px em Cartões, obteve ${cardScrollBefore}`);

      const triggerCardEdit = async () => {
        const opened = await page.evaluate<boolean>(`(() => {
          const row = [...document.querySelectorAll(".card-swipe")].find((el) => (el.textContent || "").includes("Cartão Extra 8"));
          const btn = row && [...row.querySelectorAll(".swipe-trail button")].find((b) => (b.textContent || "").trim() === "Editar");
          if (!btn) return false;
          btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
          return true;
        })()`);
        assert.equal(opened, true, "deve acionar Editar do Cartão Extra 8");
        await page.waitForSelector("form.sheet");
      };

      await triggerCardEdit();
      await page.clickButton("Cancelar", "form.sheet");
      await page.waitFor('!document.querySelector("form.sheet")');
      await new Promise((resolve) => setTimeout(resolve, 150));
      const cardScrollAfterCancel = await page.evaluate<number>("window.scrollY");
      assert.ok(
        Math.abs(cardScrollAfterCancel - cardScrollBefore) <= 10,
        `rolagem após cancelar edição de cartão deveria ficar perto de ${cardScrollBefore}, ficou em ${cardScrollAfterCancel}`,
      );

      await triggerCardEdit();
      await page.fill('form.sheet input[name="name"]', "Cartão Extra 8 Editado");
      await page.click('form.sheet button[type="submit"]');
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForText("Cartão Extra 8 Editado");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const cardScrollAfterSave = await page.evaluate<number>("window.scrollY");
      assert.ok(
        Math.abs(cardScrollAfterSave - cardScrollBefore) <= 10,
        `rolagem após salvar edição de cartão deveria ficar perto de ${cardScrollBefore}, ficou em ${cardScrollAfterSave}`,
      );

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("gasto no crédito sugere mês pela data de fechamento + data da compra e lança custo de vida pela lista sem campo nome", { timeout: 30_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      // Cadastra um cartão que fecha dia 26 e vence dia 5 (ciclo que vira o mês) + um custo de vida em dez/2026
      await page.evaluate(`(async () => {
        const cardRes = await fetch("/api/cards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Inter Black", dueDay: 5, closingDay: 26 }),
        });
        if (!cardRes.ok) throw new Error("Falha ao criar Inter Black");
        const expRes = await fetch("/api/expenses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            monthId: "2026-12",
            name: "Energia Elétrica",
            section: "fixed",
            amountCents: 32000,
            payment: "card",
            cardLabel: "Inter Black",
          }),
        });
        if (!expRes.ok) throw new Error("Falha ao criar Energia Elétrica");
      })()`);

      await page.goto(server.baseUrl);
      await page.waitForSelector('nav.nav button[data-key="cartoes"]');
      await page.click('nav.nav button[data-key="cartoes"]');
      await dismissTabIntroIfOpen(page);
      await page.waitForText("+ Gasto no crédito");
      await page.clickButton("+ Gasto no crédito");
      await page.waitForSelector("form.sheet");

      // Escolhe Planejado e seleciona o cartão Inter Black (fecha dia 26, vence dia 5)
      await page.click('form.sheet [data-segment="expenseKind"][data-value="planejado"]');
      await page.waitForSelector('form.sheet select[id="cardLabel"]');
      await page.selectOption('form.sheet select[id="cardLabel"]', "Inter Black");

      const setPurchaseDate = async (iso: string) => {
        await page.evaluate(`(() => {
          const input = document.querySelector('form.sheet #purchaseDate');
          input.value = ${JSON.stringify(iso)};
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        })()`);
      };

      // Compra em 21/11 (antes do fechamento dia 26, vence dia 5 do mês seguinte) -> Dezembro 2026
      await setPurchaseDate("2026-11-21");
      const nov21 = await page.evaluate<{ invoice: string; budgetText: string }>(`(() => ({
        invoice: document.querySelector('form.sheet #invoiceMonthId')?.value || "",
        budgetText: document.querySelector('form.sheet #budget-month-label')?.textContent || "",
      }))()`);
      assert.equal(nov21.invoice, "2026-12");
      assert.ok(nov21.budgetText.includes("Dezembro 2026"), `esperava Dezembro 2026, recebeu: ${nov21.budgetText}`);

      // Compra em 27/11 (após fechamento dia 26, vence dia 5 do mês seguinte) -> Janeiro 2027
      await setPurchaseDate("2026-11-27");
      const nov27 = await page.evaluate<{ invoice: string; budgetText: string }>(`(() => ({
        invoice: document.querySelector('form.sheet #invoiceMonthId')?.value || "",
        budgetText: document.querySelector('form.sheet #budget-month-label')?.textContent || "",
      }))()`);
      assert.equal(nov27.invoice, "2027-01");
      assert.ok(nov27.budgetText.includes("Janeiro 2027"), `esperava Janeiro 2027, recebeu: ${nov27.budgetText}`);

      // Volta para 21/11 (Dezembro 2026) e muda classificação para Custo de vida: campo nome some e lista carrega Energia Elétrica
      await setPurchaseDate("2026-11-21");
      await page.click('form.sheet [data-segment="expenseKind"][data-value="casa"]');
      await page.waitForSelector('form.sheet #linkExpenseId');
      await page.waitFor(`(() => {
        const opts = [...document.querySelectorAll('form.sheet #linkExpenseId option')];
        return opts.some((opt) => (opt.textContent || "").includes("Energia Elétrica"));
      })()`);
      assert.equal(await page.evaluate<boolean>('Boolean(document.querySelector(\'form.sheet input[name="name"]\'))'), false);

      const livingId = await page.evaluate<string>(`(() => {
        const opt = [...document.querySelectorAll('form.sheet #linkExpenseId option')]
          .find((o) => (o.textContent || "").includes("Energia Elétrica"));
        return opt?.value || "";
      })()`);
      assert.ok(livingId, "Energia Elétrica deve estar disponível na lista de custos de vida de Dezembro 2026");

      await page.selectOption('form.sheet #linkExpenseId', livingId);
      await page.fill('form.sheet input[name="amount"]', "150,00");
      await page.click('form.sheet button[type="submit"]');
      await page.waitFor('!document.querySelector("form.sheet")');
      await page.waitForText("Vinculei ao custo de vida de Dezembro 2026");

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("filtros cumulativos de ordenação na fatura vêm pré-selecionados e reordenam lançamentos", { timeout: 35_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      // Popula gastos variados na fatura de novembro/2026 do Nubank via API real para validar parcelas pagas, pendentes, data e valor
      await page.evaluate(`(async () => {
        const items = [
          { name: "Notebook", amountCents: 50000, purchaseDate: "2026-02-10", installmentCount: 12, installmentsPaid: 9, amountMode: "installment" },
          { name: "Geladeira", amountCents: 35000, purchaseDate: "2026-02-25", installmentCount: 12, installmentsPaid: 9, amountMode: "installment" },
          { name: "Curso Online", amountCents: 12000, purchaseDate: "2026-08-15", installmentCount: 10, installmentsPaid: 2, amountMode: "installment" },
          { name: "Mercado", amountCents: 80000, purchaseDate: "2026-11-18" },
          { name: "Farmácia", amountCents: 9000, purchaseDate: "2026-11-05" },
        ];
        for (const item of items) {
          const res = await fetch("/api/card-spend", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              classification: "planejado",
              invoiceMonthId: "2026-11",
              cardLabel: "Nubank",
              ...item,
            }),
          });
          if (!res.ok) throw new Error("Falha ao criar " + item.name + ": " + await res.text());
        }
      })()`);

      await page.goto(server.baseUrl);
      await page.waitForSelector('nav.nav button[data-key="cartoes"]');
      await page.click('nav.nav button[data-key="cartoes"]');
      await dismissTabIntroIfOpen(page);
      const rowVisible = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
      if (!rowVisible) {
        await page.clickButton("Faturas a serem pagas");
      }
      await page.waitForSelector(".card-manage .item-main");
      await page.click(".card-manage .item-main");
      await page.waitForSelector(".invoice-sort-bar");

      const readTitles = () => page.evaluate<string[]>(`(() =>
        [...document.querySelectorAll(".list article.item strong")].map((el) => (el.textContent || "").trim())
      )()`);

      const readActiveSorts = () => page.evaluate<Array<{ key: string; dir: string; rank: string }>>(`(() =>
        [...document.querySelectorAll(".invoice-sort-bar .sort-chip.on")].map((el) => ({
          key: el.getAttribute("data-sort-key") || "",
          dir: el.getAttribute("data-sort-dir") || "",
          rank: (el.querySelector(".sort-chip-rank")?.textContent || "").trim(),
        }))
      )()`);

      // Padrão pré-selecionado: 1º Parcelas pagas (↓) + 2º Data da compra (↓)
      assert.deepEqual(await readActiveSorts(), [
        { key: "paid", dir: "desc", rank: "1" },
        { key: "date", dir: "desc", rank: "2" },
      ]);
      assert.deepEqual(await readTitles(), [
        "25/02 Geladeira",
        "10/02 Notebook",
        "15/08 Curso Online",
        "18/11 Mercado",
        "05/11 Farmácia",
      ]);

      // Remove os dois critérios padrão e combina cumulativamente: 1º Parcelas pendentes (↓) + 2º Valor (↓)
      await page.click('.sort-chip[data-sort-key="paid"] .sort-chip-remove');
      await page.click('.sort-chip[data-sort-key="date"] .sort-chip-remove');
      await page.click('button.sort-chip[data-sort-key="remaining"]');
      await page.click('button.sort-chip[data-sort-key="amount"]');

      assert.deepEqual(await readActiveSorts(), [
        { key: "remaining", dir: "desc", rank: "1" },
        { key: "amount", dir: "desc", rank: "2" },
      ]);
      // Pendentes: Curso Online (7), Notebook (2, R$ 500), Geladeira (2, R$ 350), Mercado (0, R$ 800), Farmácia (0, R$ 90)
      assert.deepEqual(await readTitles(), [
        "15/08 Curso Online",
        "10/02 Notebook",
        "25/02 Geladeira",
        "18/11 Mercado",
        "05/11 Farmácia",
      ]);

      // Inverte direção de Valor para menor → maior mantendo Parcelas pendentes como 1º critério
      await page.click('.sort-chip[data-sort-key="amount"] .sort-chip-main');
      assert.deepEqual(await readActiveSorts(), [
        { key: "remaining", dir: "desc", rank: "1" },
        { key: "amount", dir: "asc", rank: "2" },
      ]);
      assert.deepEqual(await readTitles(), [
        "15/08 Curso Online",
        "25/02 Geladeira",
        "10/02 Notebook",
        "05/11 Farmácia",
        "18/11 Mercado",
      ]);

      // Restaura o padrão pelo botão "Padrão"
      await page.clickButton("Padrão", ".invoice-sort-bar");
      assert.deepEqual(await readActiveSorts(), [
        { key: "paid", dir: "desc", rank: "1" },
        { key: "date", dir: "desc", rank: "2" },
      ]);
      assert.deepEqual(await readTitles(), [
        "25/02 Geladeira",
        "10/02 Notebook",
        "15/08 Curso Online",
        "18/11 Mercado",
        "05/11 Farmácia",
      ]);

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("novos valores da sincronização CSV ficam destacados até a próxima sincronização com novos valores", { timeout: 35_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      const syncCsv = async (csvText: string) => {
        await page.evaluate(`(async () => {
          const res = await fetch("/api/import/nubank", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              csvText: ${JSON.stringify(csvText)},
              filename: "Nubank_2026-11-05.csv",
              dueDate: "2026-11-05",
              cardName: "Nubank",
              classification: "imprevisto",
            }),
          });
          if (!res.ok) throw new Error("Falha ao importar CSV: " + await res.text());
        })()`);
      };

      const openNubankInvoice = async () => {
        await page.goto(server.baseUrl);
        await page.waitForSelector('nav.nav button[data-key="cartoes"]');
        await page.click('nav.nav button[data-key="cartoes"]');
        await dismissTabIntroIfOpen(page);
        const rowVisible = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
        if (!rowVisible) {
          await page.clickButton("Faturas a serem pagas");
        }
        await page.waitForSelector(".card-manage .item-main");
        await page.click(".card-manage .item-main");
        await page.waitForSelector(".list article.item");
      };

      const readHighlightedTitles = () => page.evaluate<string[]>(`(() =>
        [...document.querySelectorAll('.list article.item.csv-new[data-csv-new="1"] strong')]
          .map((el) => (el.textContent || "").trim())
      )()`);

      // 1) Primeira sincronização CSV com 2 compras novas
      const csv1 = [
        "date,title,amount",
        "2026-11-02,Café Central,19.90",
        "2026-11-03,Livraria Sol,89.00",
      ].join("\n");
      await syncCsv(csv1);
      await openNubankInvoice();
      assert.deepEqual(await readHighlightedTitles(), ["03/11 Livraria Sol", "02/11 Café Central"]);
      await page.waitForText("Novo no CSV");

      // 2) Sincronização repetida sem valores novos mantém o destaque
      await syncCsv(csv1);
      await openNubankInvoice();
      assert.deepEqual(await readHighlightedTitles(), ["03/11 Livraria Sol", "02/11 Café Central"]);

      // 3) Nova sincronização com 1 valor novo transfere o destaque somente para o novo valor
      const csv2 = [
        "date,title,amount",
        "2026-11-02,Café Central,19.90",
        "2026-11-03,Livraria Sol,89.00",
        "2026-11-04,Mercado Expresso,145.50",
      ].join("\n");
      await syncCsv(csv2);
      await openNubankInvoice();
      assert.deepEqual(await readHighlightedTitles(), ["04/11 Mercado Expresso"]);

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });

  test("exclusão em lote no cartão alerta itens com parcelas futuras e pergunta um a um se deseja excluir as próximas", { timeout: 35_000 }, async () => {
    const server = await startAppServer();
    const page = await browser!.newPage(server.baseUrl);
    try {
      await completeOnboarding(page);

      // Cria 2 compras parceladas (Notebook 1/3 e Curso 1/2) e 1 à vista (Café) em nov/2026 no Nubank
      await page.evaluate(`(async () => {
        const items = [
          { name: "Notebook", amountCents: 30000, classification: "planejado", purchaseDate: "2026-11-02", installmentCount: 3, installmentsPaid: 0, amountMode: "installment" },
          { name: "Curso", amountCents: 15000, classification: "planejado", purchaseDate: "2026-11-03", installmentCount: 2, installmentsPaid: 0, amountMode: "installment" },
          { name: "Café", amountCents: 2000, classification: "planejado", purchaseDate: "2026-11-04" },
        ];
        for (const item of items) {
          const res = await fetch("/api/card-spend", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ invoiceMonthId: "2026-11", cardLabel: "Nubank", ...item }),
          });
          if (!res.ok) throw new Error("Falha ao criar " + item.name + ": " + await res.text());
        }
      })()`);

      await page.goto(server.baseUrl);
      await page.waitForSelector('nav.nav button[data-key="cartoes"]');
      await page.click('nav.nav button[data-key="cartoes"]');
      await dismissTabIntroIfOpen(page);
      const rowVisible = await page.evaluate<boolean>('Boolean(document.querySelector(".card-manage .item-main"))');
      if (!rowVisible) {
        await page.clickButton("Faturas a serem pagas");
      }
      await page.waitForSelector(".card-manage .item-main");
      await page.click(".card-manage .item-main");
      await page.waitForText("Notebook");
      await page.waitForText("Curso");
      await page.waitForText("Café");

      // Ativa seleção múltipla via pressão longa e seleciona todos os 3 itens
      await page.evaluate(`(() => {
        const card = [...document.querySelectorAll("article.item")].find((el) => (el.textContent || "").includes("Notebook"));
        if (!card) throw new Error("Notebook não encontrado");
        card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "touch", clientX: 60, clientY: 60 }));
      })()`);
      await page.waitForSelector(".select-bar");
      await new Promise((resolve) => setTimeout(resolve, 650));
      await page.clickButton("Todos", ".select-bar");
      await page.waitForText("3 selecionados");

      // Clica em Excluir (3) -> deve abrir o alerta listando os 2 itens com parcelas futuras (Notebook e Curso), sem listar Café
      await page.clickButton("Excluir (3)", ".select-bar");
      await page.waitForSelector('.dialog[data-bulk-step="alert"]');
      const alertText = await page.evaluate<string>('document.querySelector(".dialog")?.innerText || ""');
      assert.ok(alertText.includes("Parcelas nos próximos meses"), `esperava alerta de parcelas futuras, recebeu: ${alertText}`);
      assert.ok(alertText.includes("Notebook"), "alerta deve citar Notebook");
      assert.ok(alertText.includes("Curso"), "alerta deve citar Curso");
      assert.equal(alertText.includes("Café"), false, "alerta não deve listar item à vista sem parcelas futuras");

      // Avança para perguntas um a um: exclui futuras de Notebook, mantém futuras de Curso
      await page.clickButton("Revisar um a um", ".dialog");
      for (let i = 0; i < 2; i += 1) {
        await page.waitForSelector('.dialog[data-bulk-step="ask"]');
        const focusTitle = await page.evaluate<string>('document.querySelector(".bulk-future-focus strong")?.textContent || ""');
        if (focusTitle.includes("Notebook")) {
          await page.clickButton("Excluir também as próximas", ".dialog");
        } else if (focusTitle.includes("Curso")) {
          await page.clickButton("Somente este mês", ".dialog");
        } else {
          throw new Error(`Item inesperado no passo ${i + 1}: ${focusTitle}`);
        }
      }

      // Resumo final confirma decisões antes de excluir
      await page.waitForSelector('.dialog[data-bulk-step="summary"]');
      const summaryText = await page.evaluate<string>('document.querySelector(".dialog")?.innerText || ""');
      assert.ok(summaryText.includes("Este mês + 2 seguintes"), `resumo deveria mostrar +2 seguintes para Notebook: ${summaryText}`);
      assert.ok(summaryText.includes("Somente este mês"), `resumo deveria mostrar Somente este mês para Curso: ${summaryText}`);
      assert.ok(summaryText.includes("+ 1 outro valor selecionado"), `resumo deveria mencionar Café: ${summaryText}`);

      await page.clickButton("Confirmar exclusão", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForText("Excluí 3 gastos deste mês e 2 parcelas seguintes.");
      await page.waitForText("Nenhum gasto neste cartão neste mês.");

      // Confirma em Dezembro/2026: Curso (2/2) permanece, Notebook (2/3) foi excluído
      await page.click('div.months button[data-key="2026-12"]');
      await page.waitForText("Curso");
      const decBody = await page.evaluate<string>('document.body?.innerText || ""');
      assert.equal(decBody.includes("Notebook"), false, "Notebook 2/3 deveria ter sido excluído de dez/2026");

      // Confirma em Janeiro/2027: Notebook (3/3) também foi excluído
      await page.click('div.months button[data-key="2027-01"]');
      await page.waitForText("Nenhum gasto neste cartão neste mês.");

      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  });
});
