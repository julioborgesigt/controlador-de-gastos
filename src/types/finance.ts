export type PaymentMethod = 'pix' | 'cartao';

export interface FixedExpense {
  id: string;
  nome: string;
  valor: number;
  diaVencimento?: number;
  pago: boolean;
  /**
   * Quando true, este gasto fixo de casa foi lançado no cartão de crédito.
   * Ele NÃO some do indicador de Gastos Fixos, exibe um aviso visual de que
   * já está contabilizado no cartão, e passa a somar na fatura do cartão
   * (sem duplicar no Total Geral do mês).
   */
  noCartao: boolean;
  observacao?: string;
}

export interface CardExpense {
  id: string;
  nome: string;
  valor: number;
  parcela?: string; // ex: "2/6", "À vista"
  data?: string;
  observacao?: string;
}

export interface ExtraExpense {
  id: string;
  nome: string;
  valor: number;
  formaPagamento: PaymentMethod; // 'cartao' | 'pix'
  data: string;
  pago: boolean;
  observacao?: string;
}

export interface MonthlySheet {
  mesAno: string; // ex: "2026-11"
  tituloMes: string; // ex: "Novembro 2026"
  rendaMensal: number;
  faturaPago: boolean;
  diaVencimentoCartao: number;
  gastosFixos: FixedExpense[];
  gastosCartao: CardExpense[];
  gastosExtras: ExtraExpense[];
  updatedAt: string;
}

export interface FinancialSummary {
  /** Soma de TODOS os gastos fixos (tanto Pix/Boleto quanto os marcados "No Cartão") */
  totalGastosFixos: number;
  /** Parte dos gastos fixos que foi marcada como "No Cartão" */
  fixosNoCartao: number;
  /** Parte dos gastos fixos paga diretamente via Pix / Boleto / Débito */
  fixosViaPixBoleto: number;
  /** Quantidade de gastos fixos marcados como "No Cartão" */
  qtdFixosNoCartao: number;

  /** Compras lançadas diretamente na lista do cartão de crédito */
  cartaoDireto: number;
  /** Gastos extras cuja forma de pagamento é "cartao" */
  extrasNoCartao: number;
  /**
   * Total da fatura do Cartão de Crédito:
   * cartaoDireto + fixosNoCartao + extrasNoCartao
   */
  totalCartaoCredito: number;

  /** Soma de todos os gastos extras (Pix + Cartão) */
  totalGastosExtras: number;
  /** Gastos extras pagos via Pix */
  extrasViaPix: number;

  /** Total que sai diretamente da conta via Pix / Boleto (fixosViaPixBoleto + extrasViaPix) */
  totalSaidasPixBoleto: number;

  /**
   * Total Geral de Gastos do Mês (sem duplicidade!):
   * fixosViaPixBoleto + totalCartaoCredito + extrasViaPix
   * (equivalente a: totalGastosFixos + cartaoDireto + totalGastosExtras)
   */
  totalGeralMes: number;

  /** Total já quitado/pago no mês */
  totalPago: number;
  /** Total ainda pendente de pagamento no mês */
  totalPendente: number;

  /** Renda configurada menos totalGeralMes */
  saldoDisponivel: number;
}
