import { describe, expect, it } from 'vitest';
import { calculateSummary, parseCurrencyInput } from './calculations';
import { DEFAULT_MONTHLY_SHEET } from '../data/defaultSheet';
import { MonthlySheet } from '../types/finance';

describe('Controle de Gastos - Regras de Negócio', () => {
  it('mantém o gasto fixo no indicador de Gasto Fixo ao marcá-lo para o Cartão, somando-o na fatura sem duplicar no Total Geral', () => {
    const baseSheet: MonthlySheet = structuredClone(DEFAULT_MONTHLY_SHEET);

    // Garante que o Condomínio (R$ 420) começa fora do cartão
    const condominio = baseSheet.gastosFixos.find((f) => f.id === 'fix-2')!;
    expect(condominio.noCartao).toBe(false);

    const before = calculateSummary(baseSheet);

    // Agora marca o Condomínio (R$ 420) como "Foi para o Cartão"
    const updatedSheet: MonthlySheet = {
      ...baseSheet,
      gastosFixos: baseSheet.gastosFixos.map((f) =>
        f.id === 'fix-2' ? { ...f, noCartao: true } : f
      )
    };

    const after = calculateSummary(updatedSheet);

    // 1. O gasto NÃO some do indicador de Gastos Fixos!
    expect(after.totalGastosFixos).toBe(before.totalGastosFixos);

    // 2. Ele passa a constar como contabilizado no Cartão de Crédito (+420)
    expect(after.fixosNoCartao).toBe(before.fixosNoCartao + 420);
    expect(after.totalCartaoCredito).toBe(before.totalCartaoCredito + 420);
    expect(after.qtdFixosNoCartao).toBe(before.qtdFixosNoCartao + 1);

    // 3. Diminui das saídas diretas via Pix/Boleto (-420)
    expect(after.fixosViaPixBoleto).toBe(before.fixosViaPixBoleto - 420);
    expect(after.totalSaidasPixBoleto).toBe(before.totalSaidasPixBoleto - 420);

    // 4. O Total Geral do Mês permanece idêntico (sem duplicidade!)
    expect(after.totalGeralMes).toBe(before.totalGeralMes);
  });

  it('permite adicionar gastos extras nomeados via Pix ou Cartão, atualizando os respectivos indicadores', () => {
    const baseSheet: MonthlySheet = structuredClone(DEFAULT_MONTHLY_SHEET);
    const before = calculateSummary(baseSheet);

    // Adiciona um gasto extra no Cartão (R$ 100) e outro no Pix (R$ 50)
    const sheetWithExtras: MonthlySheet = {
      ...baseSheet,
      gastosExtras: [
        ...baseSheet.gastosExtras,
        {
          id: 'ext-test-card',
          nome: 'Presente Aniversário',
          valor: 100,
          formaPagamento: 'cartao',
          data: '10/11',
          pago: true
        },
        {
          id: 'ext-test-pix',
          nome: 'Feira Livre',
          valor: 50,
          formaPagamento: 'pix',
          data: '10/11',
          pago: true
        }
      ]
    };

    const after = calculateSummary(sheetWithExtras);

    expect(after.totalGastosExtras).toBe(before.totalGastosExtras + 150);
    expect(after.extrasNoCartao).toBe(before.extrasNoCartao + 100);
    expect(after.extrasViaPix).toBe(before.extrasViaPix + 50);
    expect(after.totalCartaoCredito).toBe(before.totalCartaoCredito + 100);
    expect(after.totalSaidasPixBoleto).toBe(before.totalSaidasPixBoleto + 50);
    expect(after.totalGeralMes).toBe(before.totalGeralMes + 150);
  });

  it('converte valores em formato monetário brasileiro corretamente', () => {
    expect(parseCurrencyInput('1.234,56')).toBe(1234.56);
    expect(parseCurrencyInput('R$ 89,90')).toBe(89.9);
    expect(parseCurrencyInput('250.5')).toBe(250.5);
  });
});
