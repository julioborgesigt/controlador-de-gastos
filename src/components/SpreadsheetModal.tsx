import React, { useState } from 'react';
import { FileSpreadsheet, Link2, Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  normalizeGoogleSheetsUrl,
  ParsedSpreadsheetResult,
  parseSpreadsheetBuffer
} from '../utils/spreadsheet';

interface SpreadsheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (result: ParsedSpreadsheetResult, mode: 'replace' | 'merge') => void;
}

export const SpreadsheetModal: React.FC<SpreadsheetModalProps> = ({
  isOpen,
  onClose,
  onImport
}) => {
  const [sheetUrl, setSheetUrl] = useState('');
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSpreadsheetBuffer(buffer);
      if (parsed.importedCount === 0) {
        setError(
          'Não encontramos linhas com nome e valor numérico na planilha. Verifique as colunas.'
        );
      } else {
        onImport(parsed, importMode);
        setSuccessMsg(`${parsed.importedCount} lançamentos importados com sucesso!`);
        setTimeout(() => {
          onClose();
        }, 900);
      }
    } catch {
      setError('Não foi possível ler o arquivo. Envie um arquivo .xlsx, .xls ou .csv.');
    } finally {
      setLoading(false);
    }
  };

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const exportUrl = normalizeGoogleSheetsUrl(sheetUrl);
    if (!exportUrl) {
      setError('Cole um link válido do Google Sheets (ex: https://docs.google.com/spreadsheets/d/...).');
      return;
    }

    setLoading(true);
    try {
      // Tenta via proxy da própria Cloudflare Worker (/api/fetch-sheet) ou direto
      let response = await fetch(`/api/fetch-sheet?url=${encodeURIComponent(exportUrl)}`);
      if (!response.ok) {
        response = await fetch(exportUrl);
      }
      if (!response.ok) {
        throw new Error('Planilha privada ou inacessível');
      }
      const buffer = await response.arrayBuffer();
      const parsed = parseSpreadsheetBuffer(buffer);
      if (parsed.importedCount === 0) {
        setError('A planilha foi aberta, mas nenhum gasto com valor numérico foi identificado.');
      } else {
        onImport(parsed, importMode);
        setSuccessMsg(`${parsed.importedCount} gastos importados da planilha!`);
        setTimeout(() => {
          onClose();
        }, 900);
      }
    } catch {
      setError(
        'Não foi possível baixar o link diretamente (verifique se a planilha está pública como "Qualquer pessoa com o link" ou envie o arquivo .xlsx/.csv abaixo).'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">
              Importar Planilha (.xlsx, .csv ou Link)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-300">
          Envie o arquivo da sua planilha de gastos (Excel <code className="text-emerald-300">.xlsx</code> ou{' '}
          <code className="text-emerald-300">.csv</code>) ou cole o link do Google Sheets.
        </p>

        {/* Modo de importação */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            type="button"
            onClick={() => setImportMode('replace')}
            className={`rounded-xl py-2 px-3 font-semibold border ${
              importMode === 'replace'
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            Substituir mês atual
          </button>
          <button
            type="button"
            onClick={() => setImportMode('merge')}
            className={`rounded-xl py-2 px-3 font-semibold border ${
              importMode === 'merge'
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            Somar aos atuais
          </button>
        </div>

        {/* Upload de Arquivo */}
        <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 hover:border-emerald-400 bg-slate-950/60 p-5 cursor-pointer transition-colors">
          <Upload className="w-6 h-6 text-emerald-400 mb-1.5" />
          <span className="text-xs font-semibold text-white">
            Toque para selecionar o arquivo (.xlsx ou .csv)
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5">
            Importa automaticamente Fixos, Cartão e Extras
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        {/* Link do Google Sheets */}
        <form onSubmit={handleUrlImport} className="space-y-2">
          <label className="block text-xs text-slate-300 font-medium">
            Ou cole o link do Google Sheets:
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-3.5 py-2 text-xs font-bold text-slate-950 shrink-0"
            >
              {loading ? 'Lendo...' : 'Importar'}
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-xs text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-3 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
};
