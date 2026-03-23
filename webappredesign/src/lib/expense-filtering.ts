/**
 * Smart expense filtering - excludes expenses that have already been paid
 * and should be reflected in current account balances.
 * 
 * This prevents double-counting: if rent was due on the 1st and today is the 5th,
 * we assume it's been paid and the account balance already reflects it.
 */

/**
 * Filter transactions to only include future/unpaid expenses.
 * Assumes any expense with a date in the past has been paid and is reflected in balances.
 */
export function getUnpaidExpenses(transactions: any[], referenceDate: Date = new Date()): any[] {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  
  return transactions.filter((t: any) => {
    if (t.type !== 'expense') return false;
    if (!t.date) return true; // No date = count it as unpaid to be safe
    
    const txDate = new Date(t.date);
    // Only include expenses dated today or in the future
    return txDate >= today;
  });
}

/**
 * Calculate remaining expenses for the month, excluding past expenses
 * that should already be reflected in account balances.
 */
export function getRemainingMonthExpenses(
  transactions: any[],
  excludeDebtPayments: boolean = true
): number {
  const unpaid = getUnpaidExpenses(transactions);
  
  return unpaid.reduce((sum: number, t: any) => {
    // Optionally exclude debt payment transactions
    if (excludeDebtPayments && (
      (t as any).isDebtPayment || 
      t.category?.toLowerCase().includes('debt') ||
      t.category?.toLowerCase().includes('credit card')
    )) {
      return sum;
    }
    return sum + Number(t.amount || 0);
  }, 0);
}

/**
 * Separate expenses into categories, excluding debt payments.
 */
export function categorizeExpenses(transactions: any[], excludeDebtPayments: boolean = true): Record<string, number> {
  const totals: Record<string, number> = {};
  
  transactions.forEach((t: any) => {
    if (t.type !== 'expense') return;
    
    // Skip debt payments if requested
    if (excludeDebtPayments && (
      (t as any).isDebtPayment || 
      t.category?.toLowerCase().includes('debt') ||
      t.category?.toLowerCase().includes('credit card')
    )) {
      return;
    }
    
    const category = t.category || 'Other';
    totals[category] = (totals[category] || 0) + Number(t.amount || 0);
  });
  
  return totals;
}

/**
 * Get debt payment transactions separately.
 */
export function getDebtPayments(transactions: any[]): any[] {
  return transactions.filter((t: any) => 
    t.type === 'expense' && (
      (t as any).isDebtPayment || 
      t.category?.toLowerCase().includes('debt') ||
      t.category?.toLowerCase().includes('credit card')
    )
  );
}

/**
 * Calculate total debt payments for the month by card.
 */
export function getDebtPaymentsByCard(transactions: any[]): { cardName: string; amount: number }[] {
  const debtTxns = getDebtPayments(transactions);
  const byCard: Record<string, number> = {};
  
  debtTxns.forEach((t: any) => {
    const cardName = (t as any).debtCardName || t.note || 'Other';
    byCard[cardName] = (byCard[cardName] || 0) + Number(t.amount || 0);
  });
  
  return Object.entries(byCard)
    .map(([cardName, amount]) => ({ cardName, amount }))
    .sort((a, b) => b.amount - a.amount);
}
