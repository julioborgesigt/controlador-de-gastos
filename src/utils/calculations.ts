import { FinancialSummary, MonthlySheet } from '../types/finance';

export function calculateSummary(sheet: MonthlySheet): FinancialSummary {
  const totalGastosFixos = roundCurrency(
    sheet.gastosFixos.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
  );

  const fixosNoCartaoItems = sheet.gastosFixos.filter((item) => item.noCartao);
  const fixosNoCartao = roundCurrency(
    fixosNoCartaoItems.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
  );

  const fixosViaPixBoleto = roundCurrency(totalGastosFixos - fixosNoCartao);
  const qtdFixosNoCartao = fixosNoCartaoItems.length;

  const cartaoDireto = roundCurrency(
    sheet.gastosCartao.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
  );

  const extrasNoCartao = roundCurrency(
    sheet.gastosExtras
      .filter((item) => item.formaPagamento === 'cartao')
      .reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
  );

  const extrasViaPix = roundCurrency(
    sheet.gastosExtras
      .filter((item) => item.formaPagamento === 'pix')
      .reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
  );

  const totalGastosExtras = roundCurrency(extrasNoCartao + extrasViaPix);

  // O cartão soma: lançamentos diretos do cartão + gastos fixos marcados como "No Cartão" + gastos extras no Cartão
  const totalCartaoCredito = roundCurrency(
    cartaoDireto + fixosNoCartao + extrasNoCartao
  );

  // Saídas via Pix/Boleto diretas da conta
  const totalSaidasPixBoleto = roundCurrency(fixosViaPixBoleto + extrasViaPix);

  // Total geral sem duplicar os gastos fixos que estão no cartão
  const totalGeralMes = roundCurrency(
    fixosViaPixBoleto + totalCartaoCredito + extrasViaPix
  );

  // Cálculo de pagos vs pendentes
  const fixosPixPagos = sheet.gastosFixos
    .filter((item) => !item.noCartao && item.pago)
    .reduce((acc, item) => acc + (Number(item.valor) || 0), 0);

  const extrasPixPagos = sheet.gastosExtras
    .filter((item) => item.formaPagamento === 'pix' && item.pago)
    .reduce((acc, item) => acc + (Number(item.valor) || 0), 0);

  const cartaoQuitado = sheet.faturaPago ? totalCartaoCredito : 0;

  const totalPago = roundCurrency(fixosPixPagos + extrasPixPagos + cartaoQuitado);
  const totalPendente = roundCurrency(Math.max(0, totalGeralMes - totalPago));

  const saldoDisponivel = roundCurrency((Number(sheet.rendaMensal) || 0) - totalGeralMes);

  return {
    totalGastosFixos,
    fixosNoCartao,
    fixosViaPixBoleto,
    qtdFixosNoCartao,
    cartaoDireto,
    extrasNoCartao,
    totalCartaoCredito,
    totalGastosExtras,
    extrasViaPix,
    totalSaidasPixBoleto,
    totalGeralMes,
    totalPago,
    totalPendente,
    saldoDisponivel
  };
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number.isFinite(value) ? value : 0);
}

export function parseCurrencyInput(raw: string | number): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? roundCurrency(raw) : 0;
  const cleaned = String(raw)
    .replace(/[R$\s]/g, '')
    .trim();
  if (!cleaned) return 0;

  // Se tiver vírgula como separador decimal (padrão BR: "1.234,56" ou "89,90")
  if (cleaned.includes(',')) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? roundCurrency(parsed) : 0;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? roundCurrency(parsed) : 0;
}
