import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CreditCard,
  Download,
  FileSpreadsheet,
  Home,
  LayoutList,
  PlusCircle,
  RotateCcw
} from 'lucide-react';
import { DEFAULT_MONTHLY_SHEET } from './data/defaultSheet';
import {
  CardExpense,
  ExtraExpense,
  FixedExpense,
  MonthlySheet
} from './types/finance';
import { calculateSummary } from './utils/calculations';
import {
  exportMonthlySheetToXlsx,
  ParsedSpreadsheetResult
} from './utils/spreadsheet';
import { SummaryIndicators } from './components/SummaryIndicators';
import { FixedExpensesSection } from './components/FixedExpensesSection';
import { ExtraExpensesSection } from './components/ExtraExpensesSection';
import { CreditCardSection } from './components/CreditCardSection';
import { SpreadsheetModal } from './components/SpreadsheetModal';

const STORAGE_KEY = 'controlador_gastos_sheets_v1';

const AVAILABLE_MONTHS: { mesAno: string; tituloMes: string }[] = [
  { mesAno: '2026-10', tituloMes: 'Outubro 2026' },
  { mesAno: '2026-11', tituloMes: 'Novembro 2026' },
  { mesAno: '2026-12', tituloMes: 'Dezembro 2026' },
  { mesAno: '2027-01', tituloMes: 'Janeiro 2027' },
  { mesAno: '2027-02', tituloMes: 'Fevereiro 2027' }
];

type ActiveTab = 'todos' | 'fixos' | 'cartao' | 'extras';

export const App: React.FC = () => {
  const [sheetsByMonth, setSheetsByMonth] = useState<Record<string, MonthlySheet>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback para planilha padrão
    }
    return {
      [DEFAULT_MONTHLY_SHEET.mesAno]: DEFAULT_MONTHLY_SHEET
    };
  });

  const [selectedMonth, setSelectedMonth] = useState<string>('2026-11');
  const [activeTab, setActiveTab] = useState<ActiveTab>('todos');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Garante que o mês selecionado existe (clonando os gastos fixos do mês base se for novo)
  const currentSheet: MonthlySheet = useMemo(() => {
    if (sheetsByMonth[selectedMonth]) {
      return sheetsByMonth[selectedMonth];
    }
    const monthMeta = AVAILABLE_MONTHS.find((m) => m.mesAno === selectedMonth) ?? {
      mesAno: selectedMonth,
      tituloMes: selectedMonth
    };
    return {
      ...DEFAULT_MONTHLY_SHEET,
      mesAno: monthMeta.mesAno,
      tituloMes: monthMeta.tituloMes,
      faturaPago: false,
      gastosFixos: DEFAULT_MONTHLY_SHEET.gastosFixos.map((f) => ({
        ...f,
        pago: false
      })),
      gastosCartao: [],
      gastosExtras: [],
      updatedAt: new Date().toISOString()
    };
  }, [sheetsByMonth, selectedMonth]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sheetsByMonth));
    } catch {
      // Ignora erro de quota
    }
  }, [sheetsByMonth]);

  const updateCurrentSheet = (updater: (prev: MonthlySheet) => MonthlySheet) => {
    setSheetsByMonth((prevMap) => {
      const base = prevMap[selectedMonth] ?? currentSheet;
      const updated = {
        ...updater(base),
        updatedAt: new Date().toISOString()
      };
      return {
        ...prevMap,
        [selectedMonth]: updated
      };
    });
  };

  const summary = useMemo(() => calculateSummary(currentSheet), [currentSheet]);

  const fixedOnCard = useMemo(
    () => currentSheet.gastosFixos.filter((item) => item.noCartao),
    [currentSheet.gastosFixos]
  );

  const extrasOnCard = useMemo(
    () => currentSheet.gastosExtras.filter((item) => item.formaPagamento === 'cartao'),
    [currentSheet.gastosExtras]
  );

  // Handlers Gastos Fixos
  const handleToggleFixedNoCartao = (id: string) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosFixos: sheet.gastosFixos.map((item) =>
        item.id === id ? { ...item, noCartao: !item.noCartao } : item
      )
    }));
  };

  const handleToggleFixedPago = (id: string) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosFixos: sheet.gastosFixos.map((item) =>
        item.id === id ? { ...item, pago: !item.pago } : item
      )
    }));
  };

  const handleAddFixed = (expense: Omit<FixedExpense, 'id'>) => {
    const newId = `fix-${Date.now()}`;
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosFixos: [...sheet.gastosFixos, { ...expense, id: newId }]
    }));
  };

  const handleUpdateFixed = (id: string, updates: Partial<FixedExpense>) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosFixos: sheet.gastosFixos.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      )
    }));
  };

  const handleDeleteFixed = (id: string) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosFixos: sheet.gastosFixos.filter((item) => item.id !== id)
    }));
  };

  // Handlers Gastos Extras
  const handleAddExtra = (expense: Omit<ExtraExpense, 'id'>) => {
    const newId = `ext-${Date.now()}`;
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosExtras: [{ ...expense, id: newId }, ...sheet.gastosExtras]
    }));
  };

  const handleToggleExtraPaymentMethod = (id: string) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosExtras: sheet.gastosExtras.map((item) =>
        item.id === id
          ? {
              ...item,
              formaPagamento: item.formaPagamento === 'cartao' ? 'pix' : 'cartao'
            }
          : item
      )
    }));
  };

  const handleUpdateExtra = (id: string, updates: Partial<ExtraExpense>) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosExtras: sheet.gastosExtras.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      )
    }));
  };

  const handleDeleteExtra = (id: string) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosExtras: sheet.gastosExtras.filter((item) => item.id !== id)
    }));
  };

  // Handlers Cartão de Crédito
  const handleToggleFaturaPago = () => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      faturaPago: !sheet.faturaPago
    }));
  };

  const handleAddCardExpense = (expense: Omit<CardExpense, 'id'>) => {
    const newId = `card-${Date.now()}`;
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosCartao: [{ ...expense, id: newId }, ...sheet.gastosCartao]
    }));
  };

  const handleUpdateCardExpense = (id: string, updates: Partial<CardExpense>) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosCartao: sheet.gastosCartao.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      )
    }));
  };

  const handleDeleteCardExpense = (id: string) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      gastosCartao: sheet.gastosCartao.filter((item) => item.id !== id)
    }));
  };

  const handleUpdateRenda = (novaRenda: number) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      rendaMensal: novaRenda
    }));
  };

  const handleImportSpreadsheet = (
    result: ParsedSpreadsheetResult,
    mode: 'replace' | 'merge'
  ) => {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      rendaMensal: result.rendaMensal ?? sheet.rendaMensal,
      gastosFixos:
        mode === 'replace'
          ? result.gastosFixos
          : [...sheet.gastosFixos, ...result.gastosFixos],
      gastosCartao:
        mode === 'replace'
          ? result.gastosCartao
          : [...sheet.gastosCartao, ...result.gastosCartao],
      gastosExtras:
        mode === 'replace'
          ? result.gastosExtras
          : [...result.gastosExtras, ...sheet.gastosExtras]
    }));
  };

  const handleResetDefault = () => {
    setSheetsByMonth((prev) => ({
      ...prev,
      [selectedMonth]: {
        ...DEFAULT_MONTHLY_SHEET,
        mesAno: selectedMonth,
        tituloMes:
          AVAILABLE_MONTHS.find((m) => m.mesAno === selectedMonth)?.tituloMes ??
          selectedMonth,
        updatedAt: new Date().toISOString()
      }
    }));
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 pb-24">
      {/* Top App Bar Mobile-First */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
        <div className="mx-auto max-w-3xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-slate-950 font-extrabold shadow-sm">
              R$
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold leading-tight text-white">
                Controle de Gastos
              </h1>
              <p className="text-[11px] text-slate-400">
                Casa • Cartão de Crédito • Extras (Pix / Cartão)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Seletor de Mês */}
            <div className="relative flex items-center">
              <Calendar className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 pointer-events-none" />
              <select
                aria-label="Selecionar mês"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-xl bg-slate-900 border border-slate-700 pl-7 pr-2.5 py-1.5 text-xs font-semibold text-white focus:border-emerald-400 focus:outline-none"
              >
                {AVAILABLE_MONTHS.map((m) => (
                  <option key={m.mesAno} value={m.mesAno}>
                    {m.tituloMes}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-emerald-300 transition-colors"
              title="Importar planilha Excel (.xlsx / .csv) ou Google Sheets"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Importar</span>
            </button>

            <button
              type="button"
              onClick={() => exportMonthlySheetToXlsx(currentSheet)}
              className="inline-flex items-center gap-1 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors"
              title="Baixar planilha Excel (.xlsx)"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exportar</span>
            </button>

            <button
              type="button"
              onClick={handleResetDefault}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200"
              title="Restaurar dados padrão do mês"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="mx-auto max-w-3xl px-3.5 sm:px-4 pt-4 space-y-4">
        {/* Indicadores Numéricos (Sem Gráficos) */}
        <SummaryIndicators
          summary={summary}
          rendaMensal={currentSheet.rendaMensal}
          onUpdateRenda={handleUpdateRenda}
          onSelectTab={setActiveTab}
        />

        {/* Abas de Filtro Rápido */}
        <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 p-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('todos')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-xs font-semibold transition-all ${
              activeTab === 'todos'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
            <span>Visão Geral</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('extras')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-xs font-semibold transition-all ${
              activeTab === 'extras'
                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Extras ({currentSheet.gastosExtras.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('fixos')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-xs font-semibold transition-all ${
              activeTab === 'fixos'
                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>Fixos ({currentSheet.gastosFixos.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('cartao')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-xs font-semibold transition-all ${
              activeTab === 'cartao'
                ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Cartão</span>
          </button>
        </div>

        {/* Seções conforme aba ativa */}
        {(activeTab === 'todos' || activeTab === 'extras') && (
          <ExtraExpensesSection
            items={currentSheet.gastosExtras}
            totalExtras={summary.totalGastosExtras}
            extrasPix={summary.extrasViaPix}
            extrasCartao={summary.extrasNoCartao}
            onAddExtra={handleAddExtra}
            onTogglePaymentMethod={handleToggleExtraPaymentMethod}
            onUpdateExtra={handleUpdateExtra}
            onDeleteExtra={handleDeleteExtra}
          />
        )}

        {(activeTab === 'todos' || activeTab === 'fixos') && (
          <FixedExpensesSection
            items={currentSheet.gastosFixos}
            totalFixos={summary.totalGastosFixos}
            fixosNoCartao={summary.fixosNoCartao}
            onToggleNoCartao={handleToggleFixedNoCartao}
            onTogglePago={handleToggleFixedPago}
            onAddFixed={handleAddFixed}
            onUpdateFixed={handleUpdateFixed}
            onDeleteFixed={handleDeleteFixed}
          />
        )}

        {(activeTab === 'todos' || activeTab === 'cartao') && (
          <CreditCardSection
            cardExpenses={currentSheet.gastosCartao}
            fixedOnCard={fixedOnCard}
            extrasOnCard={extrasOnCard}
            totalCartao={summary.totalCartaoCredito}
            faturaPago={currentSheet.faturaPago}
            diaVencimentoCartao={currentSheet.diaVencimentoCartao}
            onToggleFaturaPago={handleToggleFaturaPago}
            onAddCardExpense={handleAddCardExpense}
            onUpdateCardExpense={handleUpdateCardExpense}
            onDeleteCardExpense={handleDeleteCardExpense}
            onToggleFixedNoCartao={handleToggleFixedNoCartao}
          />
        )}
      </main>

      {/* Barra de Navegação Inferior Fixa para Celular */}
      <nav
        aria-label="Navegação Mobile"
        className="fixed bottom-0 inset-x-0 z-30 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 px-3 py-2 sm:hidden"
      >
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('todos')}
            className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-medium ${
              activeTab === 'todos' ? 'text-white bg-slate-800/80' : 'text-slate-400'
            }`}
          >
            <LayoutList className="w-4 h-4 mb-0.5" />
            Todos
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('extras')}
            className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-medium ${
              activeTab === 'extras'
                ? 'text-emerald-300 bg-emerald-500/15'
                : 'text-slate-400'
            }`}
          >
            <PlusCircle className="w-4 h-4 mb-0.5" />
            + Extras
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('fixos')}
            className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-medium ${
              activeTab === 'fixos'
                ? 'text-amber-300 bg-amber-500/15'
                : 'text-slate-400'
            }`}
          >
            <Home className="w-4 h-4 mb-0.5" />
            Fixos Casa
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('cartao')}
            className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-medium ${
              activeTab === 'cartao'
                ? 'text-violet-300 bg-violet-500/15'
                : 'text-slate-400'
            }`}
          >
            <CreditCard className="w-4 h-4 mb-0.5" />
            Cartão
          </button>
        </div>
      </nav>

      {/* Modal de Importação de Planilha */}
      <SpreadsheetModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImportSpreadsheet}
      />
    </div>
  );
};
