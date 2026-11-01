import React, { useState } from 'react';
import {
  CreditCard,
  Home,
  PlusCircle,
  QrCode,
  Wallet,
  CheckCircle2,
  Edit3,
  Check,
  ShieldCheck
} from 'lucide-react';
import { FinancialSummary } from '../types/finance';
import { formatBRL, parseCurrencyInput } from '../utils/calculations';

interface SummaryIndicatorsProps {
  summary: FinancialSummary;
  rendaMensal: number;
  onUpdateRenda: (novaRenda: number) => void;
  onSelectTab: (tab: 'todos' | 'fixos' | 'cartao' | 'extras') => void;
}

export const SummaryIndicators: React.FC<SummaryIndicatorsProps> = ({
  summary,
  rendaMensal,
  onUpdateRenda,
  onSelectTab
}) => {
  const [editingRenda, setEditingRenda] = useState(false);
  const [rendaInput, setRendaInput] = useState(String(rendaMensal));

  const handleSaveRenda = () => {
    const val = parseCurrencyInput(rendaInput);
    onUpdateRenda(val);
    setEditingRenda(false);
  };

  return (
    <section aria-label="Indicadores de Gastos" className="space-y-3">
      {/* Banner principal de Total do Mês e Saldo (Sem Duplicidade) */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800/90 border border-slate-800 p-4 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              Total Geral de Gastos no Mês
            </span>
            <div className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-white">
              {formatBRL(summary.totalGeralMes)}
            </div>
          </div>

          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            Sem duplicar fixos no cartão
          </span>
        </div>

        {/* Divisão Real de Pagamento: Pix/Boleto vs Fatura Cartão */}
        <div className="mt-3 grid grid-cols-2 gap-2 pt-3 border-t border-slate-800/80 text-xs">
          <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-2.5">
            <div className="flex items-center gap-1.5 text-slate-400">
              <QrCode className="w-3.5 h-3.5 text-teal-400" />
              <span>Saída via Pix / Boleto</span>
            </div>
            <div className="mt-1 text-sm sm:text-base font-semibold text-teal-300">
              {formatBRL(summary.totalSaidasPixBoleto)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              Fixos s/ cartão + Extras Pix
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-2.5">
            <div className="flex items-center gap-1.5 text-slate-400">
              <CreditCard className="w-3.5 h-3.5 text-violet-400" />
              <span>Saída Fatura Cartão</span>
            </div>
            <div className="mt-1 text-sm sm:text-base font-semibold text-violet-300">
              {formatBRL(summary.totalCartaoCredito)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              Cartão + Fixos/Extras no cartão
            </div>
          </div>
        </div>

        {/* Renda Mensal e Saldo Disponível */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-800/70 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Renda / Orçamento:</span>
            {editingRenda ? (
              <div className="inline-flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={rendaInput}
                  onChange={(e) => setRendaInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveRenda()}
                  aria-label="Editar renda mensal"
                  className="w-28 rounded-lg bg-slate-950 border border-emerald-500/50 px-2 py-1 text-xs text-white focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveRenda}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 p-1 text-white"
                  title="Salvar renda"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRendaInput(String(rendaMensal));
                  setEditingRenda(true);
                }}
                className="inline-flex items-center gap-1 font-semibold text-slate-200 hover:text-emerald-300 transition-colors"
              >
                {formatBRL(rendaMensal)}
                <Edit3 className="w-3 h-3 text-slate-400" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Saldo livre:</span>
            <span
              className={`font-bold text-sm ${
                summary.saldoDisponivel >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatBRL(summary.saldoDisponivel)}
            </span>
          </div>
        </div>
      </div>

      {/* 3 Indicadores Principais: Fixos de Casa, Cartão de Crédito e Gastos Extras */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* 1. Indicador de Gasto Fixo (Casa) */}
        <button
          type="button"
          onClick={() => onSelectTab('fixos')}
          className="text-left rounded-2xl bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/40 p-3.5 transition-all shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
              <Home className="w-4 h-4 text-amber-400" />
              Indicador Gastos Fixos
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Casa / Mensal</span>
          </div>

          <div
            data-testid="indicator-total-fixos"
            className="mt-1.5 text-xl font-bold text-white"
          >
            {formatBRL(summary.totalGastosFixos)}
          </div>

          <div className="mt-2 space-y-1 text-[11px]">
            <div className="flex items-center justify-between text-slate-300">
              <span>Pago via Pix / Boleto:</span>
              <span className="font-semibold text-teal-300">
                {formatBRL(summary.fixosViaPixBoleto)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-violet-500/15 border border-violet-500/30 px-2 py-1 text-violet-200">
              <span className="inline-flex items-center gap-1">
                <CreditCard className="w-3 h-3 text-violet-300" />
                Contabilizado no Cartão ({summary.qtdFixosNoCartao}):
              </span>
              <span
                data-testid="indicator-fixos-no-cartao"
                className="font-bold text-violet-200"
              >
                {formatBRL(summary.fixosNoCartao)}
              </span>
            </div>
          </div>
        </button>

        {/* 2. Indicador de Cartão de Crédito */}
        <button
          type="button"
          onClick={() => onSelectTab('cartao')}
          className="text-left rounded-2xl bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-violet-500/40 p-3.5 transition-all shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300">
              <CreditCard className="w-4 h-4 text-violet-400" />
              Indicador Cartão
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Fatura Total</span>
          </div>

          <div
            data-testid="indicator-total-cartao"
            className="mt-1.5 text-xl font-bold text-white"
          >
            {formatBRL(summary.totalCartaoCredito)}
          </div>

          <div className="mt-2 space-y-1 text-[11px] text-slate-300">
            <div className="flex items-center justify-between">
              <span>Compras do Cartão:</span>
              <span className="font-medium text-slate-200">{formatBRL(summary.cartaoDireto)}</span>
            </div>
            <div className="flex items-center justify-between text-violet-300">
              <span>+ Fixos de Casa no Cartão:</span>
              <span className="font-semibold">{formatBRL(summary.fixosNoCartao)}</span>
            </div>
            <div className="flex items-center justify-between text-sky-300">
              <span>+ Extras no Cartão:</span>
              <span className="font-semibold">{formatBRL(summary.extrasNoCartao)}</span>
            </div>
          </div>
        </button>

        {/* 3. Indicador de Gastos Extras */}
        <button
          type="button"
          onClick={() => onSelectTab('extras')}
          className="text-left rounded-2xl bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/40 p-3.5 transition-all shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              <PlusCircle className="w-4 h-4 text-emerald-400" />
              Indicador Gastos Extras
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Avulsos</span>
          </div>

          <div
            data-testid="indicator-total-extras"
            className="mt-1.5 text-xl font-bold text-white"
          >
            {formatBRL(summary.totalGastosExtras)}
          </div>

          <div className="mt-2 space-y-1 text-[11px]">
            <div className="flex items-center justify-between rounded-lg bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 text-teal-200">
              <span className="inline-flex items-center gap-1">
                <QrCode className="w-3 h-3 text-teal-400" />
                Extras via Pix:
              </span>
              <span data-testid="indicator-extras-pix" className="font-semibold">
                {formatBRL(summary.extrasViaPix)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-violet-200">
              <span className="inline-flex items-center gap-1">
                <CreditCard className="w-3 h-3 text-violet-400" />
                Extras no Cartão:
              </span>
              <span data-testid="indicator-extras-cartao" className="font-semibold">
                {formatBRL(summary.extrasNoCartao)}
              </span>
            </div>
          </div>
        </button>
      </div>

      {/* Barra rápida de status Pago vs Pendente */}
      <div className="flex items-center justify-between rounded-xl bg-slate-900/60 border border-slate-800/80 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-1.5 text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Quitado:</span>
          <strong className="font-semibold">{formatBRL(summary.totalPago)}</strong>
        </div>
        <div className="text-slate-400">
          Falta pagar: <strong className="text-amber-300">{formatBRL(summary.totalPendente)}</strong>
        </div>
      </div>
    </section>
  );
};
