export function formatCpf(value: string): string;
export function passkeyWhen(value: string): string;
export function base64UrlToBuffer(value: string): ArrayBuffer;
export function bufferToBase64Url(buffer: ArrayBufferLike | Uint8Array): string;
export function originIdFrom(note: string | null | undefined): string;
export function partialIdFrom(note: string | null | undefined): string;
export function seriesIdFrom(note: string | null | undefined): string;
export function isVariableNote(note: string | null | undefined): boolean;
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
export function isPlannedNote(note: string | null | undefined): boolean;
export function isImprevistoNote(note: string | null | undefined): boolean;
export function chargedInvoiceMonth(note: string | null | undefined): string;
export function extraOnOwnInvoice(expense: {
  section?: string;
  payment?: string;
  monthId?: string | null;
  note?: string | null;
}): boolean;
export function extrasBreakdown(expenses: ReadonlyArray<{
  section?: string;
  payment?: string;
  amountCents: number;
  note?: string | null;
}>): {
  planned: { pix: number; card: number; total: number };
  unexpected: { pix: number; card: number; total: number };
  pix: number;
  card: number;
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
};
