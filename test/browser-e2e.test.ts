import assert from "node:assert/strict";
import test from "node:test";
import { findChromeBinary, launchBrowserPage, startAppServer, type BrowserPage } from "./helpers/browser-e2e.ts";

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

test("E2E navegador real: onboarding, custo de vida, compra parcelada no cartão, quitação de fatura e zero violações CSP", { skip: !CHROME }, async () => {
  const server = await startAppServer();
  const page = await launchBrowserPage(server.baseUrl, CHROME!);
  try {
    // Valida /api/health no mesmo servidor HTTP real
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
    const nubankVisible = await page.evaluate<boolean>('document.body.innerText.includes("Nubank")');
    if (!nubankVisible) {
      await page.clickButton("Faturas a serem pagas");
    }
    await page.waitForText("Nubank");
    await page.clickButton("Nubank");
    await page.waitForText("Notebook");
    await page.waitForText("1/2");

    // Volta para lista de cartões e quita a fatura do Nubank via swipe para a direita ("Pago no Pix")
    await page.clickButton("Todos os cartões");
    await page.waitForSelector(".card-swipe .swipe-front");
    await page.drag(".card-swipe .swipe-front", 140, 0);
    await page.clickButton("Pago", ".card-swipe");
    const confirmOpen = await page.evaluate<boolean>('Boolean(document.querySelector(".dialog"))');
    if (confirmOpen) {
      await page.clickButton("Quitar", ".dialog");
      await page.waitFor('!document.querySelector(".dialog")');
    }
    await page.waitForText("Pago");

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

test("E2E navegador real: renderização incremental preserva identidade do DOM, foco e valor durante re-renders", { skip: !CHROME }, async () => {
  const server = await startAppServer();
  const page = await launchBrowserPage(server.baseUrl, CHROME!);
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

    // Foca no campo nome e digita via eventos reais de teclado
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

test("E2E navegador real: swipe mobile, menu da conta, tema escuro e viewport desktop", { skip: !CHROME }, async () => {
  const server = await startAppServer();
  const page = await launchBrowserPage(server.baseUrl, CHROME!);
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

    // Alterna tema escuro pelo menu da conta
    await page.click('header.top button[aria-label="Conta"]');
    await page.waitForSelector('.menu[role="menu"]');
    await page.clickButton("Usar modo escuro", '.menu[role="menu"]');
    await page.waitFor('document.documentElement.dataset.theme === "dark"');

    // Alterna para viewport desktop e navega entre abas
    await page.setViewport(1280, 800, false);
    await page.click('nav.nav button[data-key="resumo"]');
    await page.waitForText("Resumo mensal");

    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
    await server.close();
  }
});
