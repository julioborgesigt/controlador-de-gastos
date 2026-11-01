import * as XLSX from 'xlsx';
import { CardExpense, ExtraExpense, FixedExpense, MonthlySheet } from '../types/finance';
import { parseCurrencyInput } from './calculations';

export interface ParsedSpreadsheetResult {
  gastosFixos: FixedExpense[];
  gastosCartao: CardExpense[];
  gastosExtras: ExtraExpense[];
  rendaMensal?: number;
  importedCount: number;
}

/**
 * Converte um link de visualização do Google Sheets em URL de exportação CSV/XLSX
 */
export function normalizeGoogleSheetsUrl(url: string): string | null {
  const trimmed = url.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;
  const sheetId = match[1];
  const gidMatch = trimmed.match(/[#&?]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

/**
 * Lê um arquivo ArrayBuffer (.xlsx, .xls, .csv) ou texto CSV/TSV e classifica as linhas
 * em Gastos Fixos (Casa), Gastos no Cartão e Gastos Extras.
 */
export function parseSpreadsheetBuffer(buffer: ArrayBuffer): ParsedSpreadsheetResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const gastosFixos: FixedExpense[] = [];
  const gastosCartao: CardExpense[] = [];
  const gastosExtras: ExtraExpense[] = [];
  let rendaMensal: number | undefined;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
      header: 1,
      defval: ''
    });

    const sheetLower = sheetName.toLowerCase();
    let currentSection: 'fixo' | 'cartao' | 'extra' = sheetLower.includes('cart')
      ? 'cartao'
      : sheetLower.includes('extra') || sheetLower.includes('vari')
        ? 'extra'
        : 'fixo';

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r].map((c) => String(c ?? '').trim());
      const nonEmpty = row.filter((c) => c.length > 0);
      if (nonEmpty.length === 0) continue;

      const joinedLower = nonEmpty.join(' ').toLowerCase();

      // Detecta cabeçalhos de seção na planilha
      if (
        nonEmpty.length <= 3 &&
        ! nonEmpty.some((cell) => /\d/.test(cell) && parseCurrencyInput(cell) > 0)
      ) {
        if (joinedLower.includes('cartão') || joinedLower.includes('cartao') || joinedLower.includes('fatura')) {
          currentSection = 'cartao';
          continue;
        }
        if (joinedLower.includes('extra') || joinedLower.includes('variáv') || joinedLower.includes('variav')) {
          currentSection = 'extra';
          continue;
        }
        if (joinedLower.includes('fixo') || joinedLower.includes('casa') || joinedLower.includes('mensal')) {
          currentSection = 'fixo';
          continue;
        }
      }

      // Ignora linhas de cabeçalho de tabela ou de "Total"
      if (
        joinedLower.startsWith('total') ||
        joinedLower.startsWith('subtotal') ||
        (joinedLower.includes('descrição') && joinedLower.includes('valor')) ||
        (joinedLower.includes('nome') && joinedLower.includes('valor'))
      ) {
        continue;
      }

      // Procura um nome/descrição e um valor numérico na linha
      let nome = '';
      let valor = 0;
      let metadata = '';

      for (const cell of nonEmpty) {
        const num = parseCurrencyInput(cell);
        const looksLikeCurrency =
          num > 0 && (/^r\$?\s*[\d.,]+$/i.test(cell) || /^[\d.]+,\d{1,2}$/.test(cell) || /^\d+(\.\d{1,2})?$/.test(cell));

        if (!nome && /[a-zA-ZÀ-ÿ]/.test(cell) && !looksLikeCurrency) {
          nome = cell;
        } else if (valor === 0 && looksLikeCurrency && num < 1000000) {
          valor = num;
        } else if (nome && cell !== nome) {
          metadata += ` ${cell}`;
        }
      }

      if (!nome || valor <= 0) continue;

      const nomeLower = nome.toLowerCase();
      const metaLower = metadata.toLowerCase();

      if (
        nomeLower.includes('salário') ||
        nomeLower.includes('salario') ||
        nomeLower.includes('renda') ||
        nomeLower.includes('receita')
      ) {
        rendaMensal = (rendaMensal || 0) + valor;
        continue;
      }

      const mentionsCard =
        metaLower.includes('cartão') ||
        metaLower.includes('cartao') ||
        metaLower.includes('crédito') ||
        metaLower.includes('credito');
      const mentionsPix = metaLower.includes('pix');
      const mentionsPaid = metaLower.includes('pago') || metaLower.includes('ok') || metaLower.includes('sim');

      if (currentSection === 'cartao' || metaLower.includes('parcela') || /\d+\/\d+/.test(metaLower)) {
        const parcelaMatch = metadata.match(/\b(\d+\/\d+)\b/);
        gastosCartao.push({
          id: `imp-card-${r}-${Math.random().toString(36).slice(2, 6)}`,
          nome,
          valor,
          parcela: parcelaMatch ? parcelaMatch[1] : 'À vista'
        });
      } else if (currentSection === 'extra' || metaLower.includes('extra')) {
        gastosExtras.push({
          id: `imp-ext-${r}-${Math.random().toString(36).slice(2, 6)}`,
          nome,
          valor,
          formaPagamento: mentionsCard && !mentionsPix ? 'cartao' : 'pix',
          data: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          pago: mentionsPaid || true
        });
      } else {
        gastosFixos.push({
          id: `imp-fix-${r}-${Math.random().toString(36).slice(2, 6)}`,
          nome,
          valor,
          pago: mentionsPaid,
          noCartao: mentionsCard
        });
      }
    }
  }

  return {
    gastosFixos,
    gastosCartao,
    gastosExtras,
    rendaMensal,
    importedCount: gastosFixos.length + gastosCartao.length + gastosExtras.length
  };
}

/**
 * Exporta a planilha atual do mês para um arquivo Excel (.xlsx) organizado por abas
 */
export function exportMonthlySheetToXlsx(sheet: MonthlySheet): void {
  const wb = XLSX.utils.book_new();

  const fixosRows = sheet.gastosFixos.map((item) => ({
    'Gasto Fixo / Casa': item.nome,
    'Valor (R$)': item.valor,
    'Dia Vencimento': item.diaVencimento ?? '-',
    'Forma / Alocação': item.noCartao ? 'Cartão de Crédito (Contabilizado no Cartão)' : 'Pix / Boleto',
    Status: item.pago ? 'Pago' : 'Pendente',
    Observação: item.observacao ?? ''
  }));

  const cartaoRows = [
    ...sheet.gastosFixos
      .filter((f) => f.noCartao)
      .map((f) => ({
        Descrição: `[Fixo Casa] ${f.nome}`,
        'Valor (R$)': f.valor,
        Parcela: 'Recorrente Fixo',
        Origem: 'Gasto Fixo no Cartão'
      })),
    ...sheet.gastosCartao.map((c) => ({
      Descrição: c.nome,
      'Valor (R$)': c.valor,
      Parcela: c.parcela ?? 'À vista',
      Origem: 'Compra no Cartão'
    })),
    ...sheet.gastosExtras
      .filter((e) => e.formaPagamento === 'cartao')
      .map((e) => ({
        Descrição: `[Extra] ${e.nome}`,
        'Valor (R$)': e.valor,
        Parcela: 'À vista',
        Origem: 'Gasto Extra no Cartão'
      }))
  ];

  const extrasRows = sheet.gastosExtras.map((e) => ({
    'Gasto Extra': e.nome,
    'Valor (R$)': e.valor,
    'Forma de Pagamento': e.formaPagamento === 'cartao' ? 'Cartão de Crédito' : 'Pix',
    Data: e.data,
    Status: e.pago ? 'Pago' : 'Pendente',
    Observação: e.observacao ?? ''
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fixosRows), 'Gastos Fixos Casa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cartaoRows), 'Cartao de Credito');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extrasRows), 'Gastos Extras');

  XLSX.writeFile(wb, `controle-gastos-${sheet.mesAno}.xlsx`);
}
