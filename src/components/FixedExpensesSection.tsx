import React, { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  CreditCard,
  Home,
  Plus,
  QrCode,
  Trash2,
  Edit3,
  Check,
  X,
  Info
} from 'lucide-react';
import { FixedExpense } from '../types/finance';
import { formatBRL, parseCurrencyInput } from '../utils/calculations';

interface FixedExpensesSectionProps {
  items: FixedExpense[];
  totalFixos: number;
  fixosNoCartao: number;
  onToggleNoCartao: (id: string) => void;
  onTogglePago: (id: string) => void;
  onAddFixed: (expense: Omit<FixedExpense, 'id'>) => void;
  onUpdateFixed: (id: string, updates: Partial<FixedExpense>) => void;
  onDeleteFixed: (id: string) => void;
}

export const FixedExpensesSection: React.FC<FixedExpensesSectionProps> = ({
  items,
  totalFixos,
  fixosNoCartao,
  onToggleNoCartao,
  onTogglePago,
  onAddFixed,
  onUpdateFixed,
  onDeleteFixed
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [nome, setNome] = useState('');
  const [valor, setValor] = useState('');
  const [diaVencimento, setDiaVencimento] = useState('10');
  const [noCartao, setNoCartao] = useState(false);
  const [observacao, setObservacao] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editValor, setEditValor] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedValor = parseCurrencyInput(valor);
    if (!nome.trim() || parsedValor <= 0) return;

    onAddFixed({
      nome: nome.trim(),
      valor: parsedValor,
      diaVencimento: Number.parseInt(diaVencimento, 10) || 10,
      pago: false,
      noCartao,
      observacao: observacao.trim() || undefined
    });

    setNome('');
    setValor('');
    setObservacao('');
    setNoCartao(false);
    setShowAddForm(false);
  };

  const startEditing = (item: FixedExpense) => {
    setEditingId(item.id);
    setEditNome(item.nome);
    setEditValor(String(item.valor));
  };

  const saveEdit = (id: string) => {
    const parsedValor = parseCurrencyInput(editValor);
    if (editNome.trim() && parsedValor > 0) {
      onUpdateFixed(id, { nome: editNome.trim(), valor: parsedValor });
    }
    setEditingId(null);
  };

  return (
    <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-3.5 shadow-md">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300">
              <Home className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-white">Gastos Fixos / Casa</h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Marque <strong className="text-violet-300">Foi p/ o Cartão</strong> nos gastos fixos pagos no crédito: eles permanecem no indicador fixo e mostram que já estão na fatura.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Fixo
        </button>
      </div>

      {/* Sub-resumo do Indicador de Gasto Fixo */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2 text-xs">
        <div className="text-slate-300">
          Total Fixo:{' '}
          <strong className="text-white font-bold">{formatBRL(totalFixos)}</strong>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-teal-300">
            Pix/Boleto: <strong>{formatBRL(totalFixos - fixosNoCartao)}</strong>
          </span>
          <span className="text-violet-300">
            No Cartão: <strong>{formatBRL(fixosNoCartao)}</strong>
          </span>
        </div>
      </div>

      {/* Formulário para Adicionar Gasto Fixo */}
      {showAddForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-slate-950 border border-amber-500/40 p-3.5 space-y-3"
        >
          <div className="text-xs font-semibold text-amber-300">
            Adicionar Gasto Fixo da Casa
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">
                Nome do gasto fixo
              </label>
              <input
                type="text"
                placeholder="Ex: Condomínio, Internet, Energia..."
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Valor (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Ex: 189,90"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Dia Venc.:</label>
              <input
                type="number"
                min={1}
                max={31}
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(e.target.value)}
                className="w-16 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white"
              />
            </div>

            <button
              type="button"
              onClick={() => setNoCartao((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium border transition-colors ${
                noCartao
                  ? 'bg-violet-600/30 border-violet-400 text-violet-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              {noCartao ? 'Marcado: Vai para o Cartão' : 'Marcar que vai p/ o Cartão'}
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-1.5 text-xs font-bold text-slate-950"
            >
              Salvar Gasto Fixo
            </button>
          </div>
        </form>
      )}

      {/* Lista de Gastos Fixos */}
      <div className="space-y-2.5">
        {items.map((item) => {
          const isEditing = editingId === item.id;

          return (
            <div
              key={item.id}
              data-testid={`fixed-item-${item.id}`}
              className={`rounded-xl border p-3 transition-all ${
                item.noCartao
                  ? 'bg-violet-950/20 border-violet-500/40'
                  : item.pago
                    ? 'bg-slate-950/50 border-emerald-500/25'
                    : 'bg-slate-950/80 border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  {/* Botão de Pago / Pendente (para itens fora do cartão) */}
                  <button
                    type="button"
                    onClick={() => onTogglePago(item.id)}
                    title={
                      item.noCartao
                        ? 'Contabilizado na fatura do cartão de crédito'
                        : item.pago
                          ? 'Marcar como pendente'
                          : 'Marcar como pago'
                    }
                    className="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-400 transition-colors"
                  >
                    {item.noCartao ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/25 text-violet-300">
                        <CreditCard className="w-3.5 h-3.5" />
                      </span>
                    ) : item.pago ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-500" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="text"
                          value={editNome}
                          onChange={(e) => setEditNome(e.target.value)}
                          className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white w-40"
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
                          <span
                            className={`text-sm font-semibold ${
                              item.pago && !item.noCartao
                                ? 'line-through text-slate-400'
                                : 'text-white'
                            }`}
                          >
                            {item.nome}
                          </span>
                          {item.diaVencimento && (
                            <span className="rounded-md bg-slate-800/90 px-1.5 py-0.5 text-[10px] text-slate-400">
                              Dia {item.diaVencimento}
                            </span>
                          )}
                        </div>

                        {/* Indicador Visual quando o Gasto Fixo foi para o Cartão */}
                        {item.noCartao && (
                          <div
                            data-testid={`badge-no-cartao-${item.id}`}
                            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 border border-violet-400/40 px-2.5 py-1 text-[11px] font-medium text-violet-200"
                          >
                            <Info className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                            <span>
                              Já contabilizado no Cartão de Crédito (mantido no indicador fixo)
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Valor + Ações */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-sm sm:text-base font-bold text-white">
                    {formatBRL(item.valor)}
                  </span>

                  <div className="flex items-center gap-1">
                    {/* Botão principal: Marcar/Desmarcar que foi para o cartão */}
                    <button
                      type="button"
                      data-testid={`toggle-cartao-${item.id}`}
                      onClick={() => onToggleNoCartao(item.id)}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-all ${
                        item.noCartao
                          ? 'bg-violet-600 text-white border-violet-400 shadow-sm shadow-violet-950'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {item.noCartao ? (
                        <>
                          <CreditCard className="w-3 h-3" />
                          No Cartão ✓
                        </>
                      ) : (
                        <>
                          <QrCode className="w-3 h-3 text-teal-400" />
                          Foi p/ Cartão?
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => startEditing(item)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                      title="Editar gasto fixo"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteFixed(item.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                      title="Remover gasto fixo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
