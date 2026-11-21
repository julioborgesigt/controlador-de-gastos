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

      // Confirmando no diálogo, o pagamento da fatura é desfeito
      await page.drag(".card-swipe .swipe-front", 140, 0);
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.clickButton("Desfazer", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForText("Pagamento de Nubank desfeito.");
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

      // Exclui os 2 gastos selecionados com confirmação
      await page.clickButton("Excluir (2)", ".select-bar");
      await page.waitForSelector('.dialog[role="alertdialog"]');
      await page.waitForText("Excluir 2 gastos");
      await page.clickButton("Excluir 2 gastos", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
      await page.waitForText("Excluí 2 gastos selecionados.");
      await page.waitFor('!(document.body?.innerText || "").includes("Padaria")');
      await page.waitForText("Uber");

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
});
