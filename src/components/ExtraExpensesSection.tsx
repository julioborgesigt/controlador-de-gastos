import React, { useState } from 'react';
import {
  CreditCard,
  Plus,
  PlusCircle,
  QrCode,
  Trash2,
  Edit3,
  Check,
  X
} from 'lucide-react';
import { ExtraExpense, PaymentMethod } from '../types/finance';
import { formatBRL, parseCurrencyInput } from '../utils/calculations';

interface ExtraExpensesSectionProps {
  items: ExtraExpense[];
  totalExtras: number;
  extrasPix: number;
  extrasCartao: number;
  onAddExtra: (expense: Omit<ExtraExpense, 'id'>) => void;
  onTogglePaymentMethod: (id: string) => void;
  onUpdateExtra: (id: string, updates: Partial<ExtraExpense>) => void;
  onDeleteExtra: (id: string) => void;
}

export const ExtraExpensesSection: React.FC<ExtraExpensesSectionProps> = ({
  items,
  totalExtras,
  extrasPix,
  extrasCartao,
  onAddExtra,
  onTogglePaymentMethod,
  onUpdateExtra,
  onDeleteExtra
}) => {
  const [nome, setNome] = useState('');
  const [valor, setValor] = useState('');
  const [formaPagamento, setFormaPagamento] = useState<PaymentMethod>('pix');
  const [observacao, setObservacao] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editValor, setEditValor] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedValor = parseCurrencyInput(valor);
    if (!nome.trim() || parsedValor <= 0) return;

    const hoje = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    });

    onAddExtra({
      nome: nome.trim(),
      valor: parsedValor,
      formaPagamento,
      data: hoje,
      pago: true,
      observacao: observacao.trim() || undefined
    });

    setNome('');
    setValor('');
    setObservacao('');
  };

  const startEditing = (item: ExtraExpense) => {
    setEditingId(item.id);
    setEditNome(item.nome);
    setEditValor(String(item.valor));
  };

  const saveEdit = (id: string) => {
    const parsedValor = parseCurrencyInput(editValor);
    if (editNome.trim() && parsedValor > 0) {
      onUpdateExtra(id, { nome: editNome.trim(), valor: parsedValor });
    }
    setEditingId(null);
  };

  return (
    <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-4 shadow-md">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
              <PlusCircle className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-white">Gastos Extras</h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Adicione gastos extras nomeados e informe se foram pagos via{' '}
            <strong className="text-teal-300">Pix</strong> ou{' '}
            <strong className="text-violet-300">Cartão</strong>.
          </p>
        </div>

        <div className="text-right text-xs">
          <div className="text-slate-400">Total Extras</div>
          <div className="text-sm font-bold text-emerald-300">{formatBRL(totalExtras)}</div>
        </div>
      </div>

      {/* Formulário Rápido de Gasto Extra (sempre visível para uso rápido no celular) */}
      <form
        onSubmit={handleAdd}
        data-testid="form-add-extra"
        className="rounded-xl bg-slate-950/90 border border-slate-800 p-3.5 space-y-3"
      >
        <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Novo Gasto Extra
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="sm:col-span-2">
            <label className="block text-[11px] text-slate-400 mb-1">
              Nome do gasto extra
            </label>
            <input
              type="text"
              data-testid="input-extra-nome"
              placeholder="Ex: Farmácia, iFood, Uber, Padaria..."
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Valor (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              data-testid="input-extra-valor"
              placeholder="Ex: 45,90"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              required
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Seletor Tátil: Foi via Pix ou para o Cartão? */}
        <div className="space-y-1.5">
          <span className="block text-[11px] text-slate-400">
            Como foi pago este gasto extra?
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="select-extra-pix"
              onClick={() => setFormaPagamento('pix')}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-bold border transition-all ${
                formaPagamento === 'pix'
                  ? 'bg-teal-500/25 border-teal-400 text-teal-200 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <QrCode className="w-4 h-4" />
              Via Pix
            </button>

            <button
              type="button"
              data-testid="select-extra-cartao"
              onClick={() => setFormaPagamento('cartao')}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-bold border transition-all ${
                formaPagamento === 'cartao'
                  ? 'bg-violet-500/25 border-violet-400 text-violet-200 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              Foi p/ o Cartão
            </button>
          </div>
        </div>

        <button
          type="submit"
          data-testid="btn-submit-extra"
          className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-950 transition-all shadow-sm"
        >
          + Adicionar Gasto Extra ({formaPagamento === 'cartao' ? 'No Cartão' : 'Via Pix'})
        </button>
      </form>

      {/* Sub-resumo Pix vs Cartão nos Extras */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-teal-950/30 border border-teal-500/25 px-3 py-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-teal-300">
            <QrCode className="w-3.5 h-3.5" />
            Extras no Pix:
          </span>
          <strong className="text-white">{formatBRL(extrasPix)}</strong>
        </div>

        <div className="rounded-xl bg-violet-950/30 border border-violet-500/25 px-3 py-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-violet-300">
            <CreditCard className="w-3.5 h-3.5" />
            Extras no Cartão:
          </span>
          <strong className="text-white">{formatBRL(extrasCartao)}</strong>
        </div>
      </div>

      {/* Lista de Gastos Extras */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-4 text-center text-xs text-slate-500">
            Nenhum gasto extra registrado neste mês.
          </div>
        ) : (
          items.map((item) => {
            const isEditing = editingId === item.id;
            const isCard = item.formaPagamento === 'cartao';

            return (
              <div
                key={item.id}
                data-testid={`extra-item-${item.id}`}
                className={`rounded-xl border p-3 transition-all ${
                  isCard
                    ? 'bg-violet-950/15 border-violet-500/35'
                    : 'bg-teal-950/15 border-teal-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="text"
                          value={editNome}
                          onChange={(e) => setEditNome(e.target.value)}
                          className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white w-36"
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editValor}
                          onChange={(e) => setEditValor(e.target.value)}
                          className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white w-24"
                        />
                        <button
                          type="button"
                          onClick={() => saveEdit(item.id)}
                          className="p-1 rounded-lg bg-emerald-600 text-white"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded-lg bg-slate-800 text-slate-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-white">
                            {item.nome}
                          </span>
                          <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                            {item.data}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px]">
                          {isCard ? (
                            <span className="inline-flex items-center gap-1 text-violet-300 font-medium">
                              <CreditCard className="w-3 h-3" />
                              Contabilizado na fatura do Cartão
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-teal-300 font-medium">
                              <QrCode className="w-3 h-3" />
                              Pago via Pix
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-sm sm:text-base font-bold text-white">
                      {formatBRL(item.valor)}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onTogglePaymentMethod(item.id)}
                        title="Alternar entre Pix e Cartão"
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
                          isCard
                            ? 'bg-violet-600/30 border-violet-400 text-violet-200'
                            : 'bg-teal-600/30 border-teal-400 text-teal-200'
                        }`}
                      >
                        {isCard ? (
                          <>
                            <CreditCard className="w-3 h-3" />
                            Cartão
                          </>
                        ) : (
                          <>
                            <QrCode className="w-3 h-3" />
                            Pix
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                        title="Editar gasto extra"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteExtra(item.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                        title="Excluir gasto extra"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
