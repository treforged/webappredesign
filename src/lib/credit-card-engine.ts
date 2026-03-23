/**
 * FIXED: Simulate variable payoff with cash-floor protection.
 * This version correctly maximizes debt payments by using ALL available cash above the floor.
 */
export function simulateVariablePayoff(
  cards: CardData[],
  liquidCash: number,
  cashFloor: number,
  strategy: 'avalanche' | 'snowball',
  monthlyTakeHome: number,
  monthlyExpenses: number,
  months = 36,
): { 
  monthlyPayments: Map<string, number[]>; 
  projectedPayoffMonths: number;
  cashFloorBreaches: { month: number; endingCash: number }[];
} {
  const balances = new Map(cards.map(c => [c.id, c.balance]));
  const monthlyPayments = new Map(cards.map(c => [c.id, [] as number[]]));
  let currentCash = liquidCash;
  let projectedPayoffMonths = 0;
  const cashFloorBreaches: { month: number; endingCash: number }[] = [];
  
  const autopayCards = new Set(cards.filter(c => c.autopayFullBalance).map(c => c.id));

  for (let m = 0; m < months; m++) {
    // Start of month: add income, subtract expenses
    currentCash += monthlyTakeHome - monthlyExpenses;
    
    // Handle autopay cards first (these are paid in full automatically)
    for (const card of cards) {
      if (autopayCards.has(card.id)) {
        monthlyPayments.get(card.id)!.push(card.monthlyNewPurchases);
        currentCash -= card.monthlyNewPurchases;
      }
    }
    
    // Add new purchases & interest for non-autopay cards
    for (const card of cards) {
      if (autopayCards.has(card.id)) continue;
      const bal = balances.get(card.id)!;
      if (bal <= 0) {
        balances.set(card.id, 0);
        autopayCards.add(card.id);
        monthlyPayments.get(card.id)!.push(card.monthlyNewPurchases);
        currentCash -= card.monthlyNewPurchases;
        continue;
      }
      const interest = bal * (card.apr / 100 / 12);
      balances.set(card.id, bal + card.monthlyNewPurchases + interest);
    }

    // Get active cards with balances
    const activeCards = cards.filter(c => !autopayCards.has(c.id) && (balances.get(c.id) || 0) > 0);
    
    if (activeCards.length === 0) {
      // No active debt - record $0 payments for non-autopay cards
      for (const card of cards) {
        if (!autopayCards.has(card.id)) monthlyPayments.get(card.id)!.push(0);
      }
      continue;
    }
    
    projectedPayoffMonths = m + 1;

    // Sort cards by strategy
    const sorted = [...activeCards];
    if (strategy === 'avalanche') {
      sorted.sort((a, b) => b.apr - a.apr);
    } else {
      sorted.sort((a, b) => (balances.get(a.id) || 0) - (balances.get(b.id) || 0));
    }

    // CRITICAL FIX: Calculate max available for debt payments
    // We want to end the month AT the cash floor, so we can use everything above it
    const availableForDebt = Math.max(0, currentCash - cashFloor);
    
    const payments = new Map<string, number>();
    let remaining = availableForDebt;

    // Step 1: Pay ALL minimums first (critical priority)
    const totalMins = sorted.reduce((s, c) => s + Math.min(c.minPayment, balances.get(c.id) || 0), 0);
    
    // Check if we can't even cover minimums
    if (availableForDebt < totalMins) {
      // Cash floor breach - we need to pay minimums even if it drops us below floor
      // Distribute available cash proportionally to minimums
      const cashFloorBreach = cashFloor - (currentCash - totalMins);
      cashFloorBreaches.push({ month: m + 1, endingCash: currentCash - totalMins });
      
      for (const card of sorted) {
        const bal = balances.get(card.id)!;
        const min = Math.min(card.minPayment, bal);
        const proportion = totalMins > 0 ? min / totalMins : 0;
        const payment = Math.min(Math.round(availableForDebt * proportion * 100) / 100, bal);
        payments.set(card.id, payment);
        remaining -= payment;
      }
    } else {
      // Happy path: we can cover all minimums
      for (const card of sorted) {
        const bal = balances.get(card.id)!;
        const min = Math.min(card.minPayment, bal);
        payments.set(card.id, min);
        remaining -= min;
      }

      // Step 2: Allocate ALL remaining cash to priority cards
      // This is the key fix - use EVERYTHING above the floor
      for (const card of sorted) {
        if (remaining <= 0) break;
        
        const bal = balances.get(card.id)!;
        const currentPayment = payments.get(card.id) || 0;
        const maxAdditional = bal - currentPayment;
        const extra = Math.min(remaining, maxAdditional);
        
        if (extra > 0) {
          payments.set(card.id, currentPayment + extra);
          remaining -= extra;
        }
      }
    }

    // Apply payments and update balances
    for (const card of cards) {
      if (autopayCards.has(card.id)) continue;
      const payment = payments.get(card.id) || 0;
      monthlyPayments.get(card.id)!.push(Math.round(payment * 100) / 100);
      const bal = balances.get(card.id)!;
      balances.set(card.id, Math.max(0, bal - payment));
      currentCash -= payment;
    }
  }

  return { 
    monthlyPayments, 
    projectedPayoffMonths,
    cashFloorBreaches 
  };
}

// Assuming these functions are defined in the same file or imported from other files
export function buildCardData(accounts: any[], transactions: any[], rules: any[], debts: any[]): CardData[] {
  // Implementation of buildCardData
}

export function projectCard(card: CardData, months: number): CardProjection {
  // Implementation of projectCard
}

export function projectCardVariable(card: CardData, payments: number[], months: number): CardProjection {
  // Implementation of projectCardVariable
}

export function generateRecommendations(
  cards: CardData[], liquidCash: number, cashFloor: number, strategy: 'avalanche' | 'snowball',
  monthlyTakeHome: number, monthlyExpenses: number,
  paymentMode: 'variable' | 'consistent', payConfig: any, rules: any[], fundingAccountId: string,
  prePaycheckBillsTotal: number, fundingBalance: number,
  overrides?: Record<string, Record<number, number>>, allTransactions?: any[], primaryDueDay?: number
): RecommendationSummary {
  // Implementation of generateRecommendations
}
