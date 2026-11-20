export declare const NOTE_MARKERS: readonly string[];
export declare const REFERENCE_MONTHS: readonly string[];
export declare function noteMarker(note: string | null | undefined, prefix: string): string;
export declare function originIdFrom(note: string | null | undefined): string;
export declare function partialIdFrom(note: string | null | undefined): string;
export declare function seriesIdFrom(note: string | null | undefined): string;
export declare function isVariableNote(note: string | null | undefined): boolean;
export declare function isPlannedNote(note: string | null | undefined): boolean;
export declare function isImprevistoNote(note: string | null | undefined): boolean;
export declare function isZeroFinalizedNote(note: string | null | undefined): boolean;
export declare function invoiceShift(note: string | null | undefined): "mes" | "seguinte";
export declare function chargedInvoiceMonth(note: string | null | undefined): string;
export declare function purchaseMonthFromNote(note: string | null | undefined): string;
export declare function referenceMonthFrom(note: string | null | undefined): string;
export declare function visibleNote(note: string | null | undefined): string;
export declare function formatCardChargeTitle(
  name: string | null | undefined,
  note: string | null | undefined,
  monthId?: string,
): string;
