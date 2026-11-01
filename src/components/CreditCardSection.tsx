import React, { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Home,
  Plus,
  PlusCircle,
  Trash2,
  Edit3,
  Check,
  X
} from 'lucide-react';
import { CardExpense, ExtraExpense, FixedExpense } from '../types/finance';
import { formatBRL, parseCurrencyInput } from '../utils/calculations';

interface CreditCardSectionProps {
  cardExpenses: CardExpense[];
  fixedOnCard: FixedExpense[];
  extrasOnCard: ExtraExpense[];
  totalCartao: number;
  faturaPago: boolean;
  diaVencimentoCartao: number;
  onToggleFaturaPago: () => void;
  onAddCardExpense: (expense: Omit<CardExpense, 'id'>) => void;
  onUpdateCardExpense: (id: string, updates: Partial<CardExpense>) => void;
  onDeleteCardExpense: (id: string) => void;
  onToggleFixedNoCartao: (id: string) => void;
}

export const CreditCardSection: React.FC<CreditCardSectionProps> = ({
  cardExpenses,
  fixedOnCard,
  extrasOnCard,
  totalCartao,
  faturaPago,
  diaVencimentoCartao,
  onToggleFaturaPago,
  onAddCardExpense,
  onUpdateCardExpense,
  onDeleteCardExpense,
  onToggleFixedNoCartao
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [nome, setNome] = useState('');
  const [valor, setValor] = useState('');
  const [parcela, setParcela] = useState('À vista');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editValor, setEditValor] = useState('');
  const [editParcela, setEditParcela] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedValor = parseCurrencyInput(valor);
    if (!nome.trim() || parsedValor <= 0) return;

    const hoje = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    });

    onAddCardExpense({
      nome: nome.trim(),
      valor: parsedValor,
      parcela: parcela.trim() || 'À vista',
      data: hoje
    });

    setNome('');
    setValor('');
    setParcela('À vista');
    setShowAddForm(false);
  };

  const startEditing = (item: CardExpense) => {
    setEditingId(item.id);
    setEditNome(item.nome);
    setEditValor(String(item.valor));
    setEditParcela(item.parcela || 'À vista');
  };

  const saveEdit = (id: string) => {
    const parsedValor = parseCurrencyInput(editValor);
    if (editNome.trim() && parsedValor > 0) {
      onUpdateCardExpense(id, {
        nome: editNome.trim(),
        valor: parsedValor,
        parcela: editParcela.trim() || 'À vista'
      });
    }
    setEditingId(null);
  };

  return (
    <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-4 shadow-md">
      {/* Cabeçalho Fatura do Cartão */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300">
              <CreditCard className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-white">
              Cartão de Crédito (Fatura)
            </h2>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
              Venc. dia {diaVencimentoCartao}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Soma compras parceladas/à vista do cartão + gastos fixos marcados como cartão + gastos extras no cartão.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleFaturaPago}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition-colors ${
              faturaPago
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {faturaPago ? 'Fatura Paga' : 'Marcar Fatura Paga'}
          </button>

          <button
            type="button"
            onClick={() => setShowAddForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 px-3 py-2 text-xs font-semibold text-violet-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Compra Cartão
          </button>
        </div>
      </div>

      {/* Totalizador da Fatura */}
      <div className="rounded-xl bg-violet-950/25 border border-violet-500/30 p-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-violet-200">
          Total Consolidado da Fatura:
        </span>
        <span className="text-lg font-bold text-white">{formatBRL(totalCartao)}</span>
      </div>

      {/* Formulário para adicionar compra exclusiva do cartão */}
      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="rounded-xl bg-slate-950 border border-violet-500/40 p-3.5 space-y-3"
        >
          <div className="text-xs font-semibold text-violet-300">
            Adicionar Compra / Parcela no Cartão
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Descrição da compra
              </label>
              <input
                type="text"
                placeholder="Ex: Supermercado, Roupas..."
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Valor (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Ex: 240,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Parcela (opcional)
              </label>
              <input
                type="text"
                placeholder="Ex: À vista, 2/6, 5/10"
                value={parcela}
                onChange={(e) => setParcela(e.target.value)}
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-violet-500 hover:bg-violet-400 px-4 py-1.5 text-xs font-bold text-white"
            >
              Salvar no Cartão
            </button>
          </div>
        </form>
      )}

      {/* 1. Gastos Fixos de Casa marcados como "No Cartão" */}
      {fixedOnCard.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5" />
            Gastos Fixos de Casa lançados no Cartão ({fixedOnCard.length})
          </div>
          <div className="space-y-1.5">
            {fixedOnCard.map((item) => (
              <div
                key={item.id}
                className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2.5 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-sm font-semibold text-white">{item.nome}</div>
                  <div className="text-[11px] text-amber-200/80">
                    Gasto Fixo da Casa • Contabilizado nesta fatura
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    {formatBRL(item.valor)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleFixedNoCartao(item.id)}
                    className="rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                    title="Retirar do cartão (voltar para Pix/Boleto)"
                  >
                    Tirar do Cartão
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Gastos Extras lançados no Cartão */}
      {extrasOnCard.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
            <PlusCircle className="w-3.5 h-3.5" />
            Gastos Extras pagos no Cartão ({extrasOnCard.length})
          </div>
          <div className="space-y-1.5">
            {extrasOnCard.map((item) => (
              <div
                key={item.id}
                className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2.5 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-sm font-semibold text-white">{item.nome}</div>
                  <div className="text-[11px] text-emerald-200/80">
                    Gasto Extra ({item.data}) • Lançado no Cartão
                  </div>
                </div>
                <span className="text-sm font-bold text-white">
                  {formatBRL(item.valor)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Compras Diretas / Parceladas do Cartão */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5" />
          Compras Diretas / Parceladas no Cartão ({cardExpenses.length})
        </div>

        <div className="space-y-2">
          {cardExpenses.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <div
                key={item.id}
                className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 flex items-center justify-between gap-2"
              >
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
                      <input
                        type="text"
                        value={editParcela}
                        onChange={(e) => setEditParcela(e.target.value)}
                        className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white w-20"
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {item.nome}
                      </span>
                      {item.parcela && (
                        <span className="rounded-md bg-violet-500/20 border border-violet-500/30 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
                          {item.parcela}
                        </span>
                      )}
                      {item.data && (
                        <span className="text-[11px] text-slate-500">{item.data}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-sm font-bold text-white">
                    {formatBRL(item.valor)}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEditing(item)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                    title="Editar compra do cartão"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteCardExpense(item.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                    title="Excluir compra do cartão"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
