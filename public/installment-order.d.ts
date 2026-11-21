export type InvoiceSortKey = "paid" | "date" | "remaining" | "amount" | "total" | "name";
export type InvoiceSortDir = "asc" | "desc";
export type InvoiceSortRule = { key: InvoiceSortKey; dir: InvoiceSortDir };

export type InvoiceSortOption = {
  key: InvoiceSortKey;
  label: string;
  defaultDir: InvoiceSortDir;
  descHint: string;
  ascHint: string;
};

export type InvoiceSortableItem = {
  id?: string;
  name?: string;
  installment?: string | null;
  amountCents?: number;
  note?: string | null;
  purchaseDate?: string | null;
};

export declare const INVOICE_SORT_OPTIONS: readonly InvoiceSortOption[];
export declare const DEFAULT_INVOICE_SORTS: readonly InvoiceSortRule[];

export declare function normalizeInvoiceSorts(raw: unknown): InvoiceSortRule[];
export declare function isDefaultInvoiceSorts(rules: readonly InvoiceSortRule[] | null | undefined): boolean;
export declare function installmentRank(installment: string | null | undefined): {
  total: number;
  paid: number;
  remaining: number;
  isInstallment: boolean;
};
export declare function invoicePurchaseDate(item: InvoiceSortableItem | null | undefined): string;
export declare function createInvoiceComparator(
  rules?: readonly InvoiceSortRule[],
): (left: InvoiceSortableItem, right: InvoiceSortableItem) => number;
export declare function compareInvoiceItems(
  left: InvoiceSortableItem,
  right: InvoiceSortableItem,
  rules?: readonly InvoiceSortRule[],
): number;
