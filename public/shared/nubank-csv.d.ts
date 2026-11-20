export declare const BRAZILIAN_CARDS: readonly string[];
export declare const NUBANK_EXPORT_HINT: string;

export declare function isNubankName(name: string | null | undefined): boolean;

export declare function extractDueDateFromFilename(filename: string | null | undefined): {
  dueDate: string;
  invoiceMonthId: string;
  dueDay: number;
} | null;

export declare function parseInstallmentTitle(rawTitle: string): {
  name: string;
  currentInstallment: number;
  totalInstallments: number;
};

export type ParsedNubankItem = {
  purchaseDate: string;
  rawTitle: string;
  name: string;
  normName: string;
  amountCents: number;
  currentInstallment: number;
  totalInstallments: number;
  occurrence: number;
};

export type ParsedNubankCsv =
  | {
      ok: true;
      detectedDueDate: string;
      detectedInvoiceMonthId: string;
      detectedDueDay: number | null;
      items: ParsedNubankItem[];
      totalCents: number;
      installmentItemsCount: number;
      futureInstallmentsCount: number;
      ignoredPayments: number;
      ignoredCredits: number;
      invalidRows: number;
    }
  | {
      ok: false;
      error: string;
    };

export declare function parseNubankCsv(text: string, filename?: string): ParsedNubankCsv;

export type ScheduledNubankEntry = {
  monthId: string;
  isCurrentInvoice: boolean;
  purchaseDate: string;
  name: string;
  amountCents: number;
  installment: string | null;
  seriesId: string;
  importKey: string;
};

export declare function buildNubankSchedule(
  items: readonly ParsedNubankItem[],
  invoiceMonthId: string,
  cardLabel: string,
): ScheduledNubankEntry[];
