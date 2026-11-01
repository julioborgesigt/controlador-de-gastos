import { MonthlySheet } from '../types/finance';

export const DEFAULT_MONTHLY_SHEET: MonthlySheet = {
  mesAno: '2026-11',
  tituloMes: 'Novembro 2026',
  rendaMensal: 6500,
  faturaPago: false,
  diaVencimentoCartao: 10,
  updatedAt: new Date().toISOString(),
  gastosFixos: [
    {
      id: 'fix-1',
      nome: 'Aluguel / Moradia',
      valor: 1800,
      diaVencimento: 5,
      pago: true,
      noCartao: false,
      observacao: 'Transferência Pix'
    },
    {
      id: 'fix-2',
      nome: 'Condomínio',
      valor: 420,
      diaVencimento: 10,
      pago: false,
      noCartao: false,
      observacao: 'Boleto bancário'
    },
    {
      id: 'fix-3',
      nome: 'Energia Elétrica (Luz)',
      valor: 235.5,
      diaVencimento: 12,
      pago: false,
      noCartao: false,
      observacao: 'Pix QR Code'
    },
    {
      id: 'fix-4',
      nome: 'Água / Saneamento',
      valor: 98.4,
      diaVencimento: 12,
      pago: true,
      noCartao: false
    },
    {
      id: 'fix-5',
      nome: 'Internet Fibra + Celular',
      valor: 169.9,
      diaVencimento: 10,
      pago: false,
      noCartao: true,
      observacao: 'Débito automático no cartão'
    },
    {
      id: 'fix-6',
      nome: 'Academia / Saúde',
      valor: 129.9,
      diaVencimento: 10,
      pago: false,
      noCartao: true,
      observacao: 'Recorrência no cartão'
    },
    {
      id: 'fix-7',
      nome: 'Streaming (Netflix / Spotify)',
      valor: 79.8,
      diaVencimento: 10,
      pago: false,
      noCartao: true,
      observacao: 'Assinatura mensal no cartão'
    }
  ],
  gastosCartao: [
    {
      id: 'card-1',
      nome: 'Supermercado Mensal',
      valor: 680.0,
      parcela: 'À vista',
      data: '02/11'
    },
    {
      id: 'card-2',
      nome: 'Eletrodoméstico / Casa',
      valor: 185.0,
      parcela: '3/6',
      data: '15/10'
    },
    {
      id: 'card-3',
      nome: 'Combustível / Transporte',
      valor: 260.0,
      parcela: 'À vista',
      data: '04/11'
    }
  ],
  gastosExtras: [
    {
      id: 'ext-1',
      nome: 'Farmácia',
      valor: 84.5,
      formaPagamento: 'pix',
      data: '03/11',
      pago: true,
      observacao: 'Medicamentos'
    },
    {
      id: 'ext-2',
      nome: 'Jantar / Delivery fim de semana',
      valor: 112.0,
      formaPagamento: 'cartao',
      data: '05/11',
      pago: true,
      observacao: 'iFood no cartão'
    },
    {
      id: 'ext-3',
      nome: 'Manutenção / Reparo Casa',
      valor: 150.0,
      formaPagamento: 'pix',
      data: '06/11',
      pago: true,
      observacao: 'Pago via Pix'
    }
  ]
};
