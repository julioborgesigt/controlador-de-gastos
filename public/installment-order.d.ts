export function installmentRank(installment: string | null | undefined): { total: number; paid: number };
export function compareInvoiceItems(
  left: { name?: string; installment?: string | null },
  right: { name?: string; installment?: string | null },
): number;
