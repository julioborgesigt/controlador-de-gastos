export function formatCpf(value: string): string;
export function passkeyWhen(value: string): string;
export function base64UrlToBuffer(value: string): ArrayBuffer;
export function bufferToBase64Url(buffer: ArrayBufferLike | Uint8Array): string;
export function originIdFrom(note: string | null | undefined): string;
export function partialIdFrom(note: string | null | undefined): string;
export function seriesIdFrom(note: string | null | undefined): string;
export function isVariableNote(note: string | null | undefined): boolean;
export function isZeroFinalizedNote(note: string | null | undefined): boolean;
export function cardChargeTitle(expense: { name?: string | null; note?: string | null; monthId?: string | null }): string;
export function visibleNote(note: string | null | undefined): string;
export function composeNote(
  originId: string | null | undefined,
  note: string | null | undefined,
  partialId: string | null | undefined,
  seriesId: string | null | undefined,
  variable: boolean,
  planned: boolean,
  nextInvoice: boolean,
): string;
export function nextMonthId(monthId: string | null | undefined): string;
export function invoiceShift(note: string | null | undefined): "seguinte" | "mes";
export function paymentLabel(payment: string): "Crédito" | "Pix";
export function money(cents: number): string;
export function centsToInput(cents: number): string;
export function parseMoney(value: string): number | null;
export function shortMonthLabel(monthId: string | null | undefined): string;
export function referenceMonthFrom(note: string | null | undefined): string;
export function isPlannedNote(note: string | null | undefined): boolean;
export function isImprevistoNote(note: string | null | undefined): boolean;
export function chargedInvoiceMonth(note: string | null | undefined): string;
export function extraOnOwnInvoice(expense: {
  section?: string;
  payment?: string;
  monthId?: string | null;
  note?: string | null;
}): boolean;
export function livingCrossMonthSummary(expenses: ReadonlyArray<{
  section?: string;
  payment?: string;
  monthId?: string | null;
  amountCents: number;
  paid?: boolean;
  onCard?: boolean;
  note?: string | null;
  charges?: ReadonlyArray<{ monthId: string; amountCents: number }>;
  partials?: ReadonlyArray<{ amountCents: number; payment?: string }>;
}>): {
  paidCardOwnCents: number;
  paidCardOtherCents: number;
  paidOtherMonths: string[];
  dueCardOwnCents: number;
  dueCardOtherCents: number;
  dueOtherMonths: string[];
};
export function extrasBreakdown(expenses: ReadonlyArray<{
  section?: string;
  payment?: string;
  monthId?: string | null;
  amountCents: number;
  note?: string | null;
}>, options?: { includeCardExtras?: boolean }): {
  planned: {
    pix: number;
    card: number;
    cardOwnInvoice: number;
    cardOtherInvoice: number;
    otherInvoiceMonths: string[];
    inMonth: number;
    total: number;
  };
  unexpected: {
    pix: number;
    card: number;
    cardOwnInvoice: number;
    cardOtherInvoice: number;
    otherInvoiceMonths: string[];
    inMonth: number;
    total: number;
  };
  pix: number;
  card: number;
  cardOwnInvoice: number;
  cardOtherInvoice: number;
  otherInvoiceMonths: string[];
  inMonth: number;
  total: number;
};
export function invoiceBreakdown(expenses: ReadonlyArray<{
  section?: string;
  payment?: string;
  monthId?: string | null;
  amountCents: number;
  note?: string | null;
}>): {
  livingCents: number;
  plannedCents: number;
  unexpectedCents: number;
  otherCents: number;
  totalCents: number;
  fromOtherMonthsCents: number;
  livingFromOtherCents: number;
  plannedFromOtherCents: number;
  unexpectedFromOtherCents: number;
  originMonths: string[];
};
export function previousMonthId(monthId: string | null | undefined): string;
export interface MonthDataInput {
  month?: { id?: string; incomeCents?: number } | null;
  totals?: {
    faturaCents?: number;
    fixedCashCents?: number;
    fixedPixForecastCents?: number;
    extrasPixCents?: number;
    paidCents?: number;
    fixedAllSettled?: boolean;
    fixedLaunchedCents?: number;
    fixedForecastCents?: number;
  } | null;
  expenses?: ReadonlyArray<{
    section?: string;
    payment?: string;
    monthId?: string | null;
    amountCents: number;
    paid?: boolean;
    onCard?: boolean;
    note?: string | null;
    charges?: ReadonlyArray<{ monthId: string; amountCents: number }>;
    partials?: ReadonlyArray<{ amountCents: number; payment?: string }>;
  }> | null;
  error?: string | null;
}
export function monthFinancialSummary(
  data: MonthDataInput | null | undefined,
  nextData?: MonthDataInput | null,
  prevData?: MonthDataInput | null,
  purchasesPayload?: { items?: ReadonlyArray<{ amountCents?: number; invoiceMonthId?: string }> } | null,
): {
  payments: {
    faturaCents: number;
    livingPixPaidCents: number;
    livingPixDueCents: number;
    livingPixTotalCents: number;
    extrasPixCents: number;
    pixPaidCents: number;
    pixTotalCents: number;
    totalCents: number;
    paidCents: number;
    remainingCents: number;
    cashBalanceCents: number;
  };
  launches: {
    launchedFutureCents: number;
    forecastNextInvoiceCents: number;
    totalFutureInvoicesCents: number;
    launchedOwnInvoiceCents: number;
    totalLaunchedCents: number;
    futureInvoiceMonths: string[];
    livingLaunchedOtherCents: number;
    plannedLaunchedOtherCents: number;
    unexpectedLaunchedOtherCents: number;
  };
  forecast: {
    current: {
      monthId: string;
      invoiceForecastCents: number;
      pixForecastCents: number;
      pendingOwnCardCents: number;
      pendingFromPrevCents: number;
      expenseCents: number;
      incomeCents: number;
      balanceCents: number;
      categoryBudgetCents: number;
    };
    next: {
      monthId: string;
      ready: boolean;
      invoiceLaunchedCents: number;
      invoicePendingFromCurrentCents: number;
      invoicePendingOwnCents: number;
      invoiceForecastCents: number;
      pixForecastCents: number;
      expenseCents: number;
      incomeCents: number;
      balanceCents: number;
    };
  };
};
