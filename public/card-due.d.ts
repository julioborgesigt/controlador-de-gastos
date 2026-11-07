export function invoiceDueDate(monthId: string, dueDay: number): string | null;
export function suggestedInvoiceMonth(purchaseDate: string, closingDay: number | null): string;
export function dueDatePassed(monthId: string, dueDay: number, today: string): boolean;
