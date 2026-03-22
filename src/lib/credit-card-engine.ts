import { formatCurrency } from './calculations';
import {
  PayScheduleConfig, getRemainingIncomeByDay, getRemainingExpensesByDay,
  getRemainingNonPaycheckIncomeByDay, getRemainingOneTimeIncomeByDay,
  getRemainingOneTimeExpensesByDay,
  getIncomeBeforeDay, getExpensesBeforeDay, getNonPaycheckIncomeBeforeDay,
  getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay,
  buildPayConfig, getPrePaycheckNextMonthBills, getMonthNetIncome,
} from './pay-schedule';

export type CardData = {
  id: string;
  name: string;
  balance: number;
  apr: number;
  creditLimit: number;
  minPayment: number;
  targetPayment: number;
  monthlyNewPurchases: number;
  monthlyRepayments: number;
  color: string;
  autopayFullBalance: boolean;
  dueDay: number | null;
};

export type CardMonthRow = {
  month: number;
  label: string;
  startBalance: number;
  newPurchases: number;
  interest: number;
  payment: number;
  endBalance: number;
  utilization: number;
};

export type CardProjection = {
  card: CardData;
  months: CardMonthRow[];
  payoffMonth: number | null;
  totalInterest: number;
  projectedInterestThisMonth: number;
  recommendedPayment: number;
  utilizationNow: number;
};

export type PayoffRecommendation = {
  cardId: string;
  cardName: string;
  color: string;
  payment: number;
  isMinimumOnly: boolean;
  reason: string;
  estimatedLiquidCash?: number;
  dueDay?: number | null;
};

export type RecommendationSummary = {
  totalAvailableCash: number;
  totalMinimumsdue: number;
  extraCashAvailable: number;
  recommendations: PayoffRecommendation[];
  interestAvoided: number;
  projectedPayoffMonths: number;
  utilizationMilestones: { threshold: number; month: number | null }[];
  cashWarning: boolean;
  strategyLabel: string;
  recommendedSafeMinimum: number;
  userCashFloor: number;
  prePaycheckBills: number;
  // Breakdown for tooltip display
  breakdown: {
    fundingBalance: number;
    remainingPaycheckIncome: number;
    remainingNonPaycheckIncome: number;
    remainingOneTimeIncome: number;
    remainingExpenses: number;
    remainingOneTimeExpenses: number;
    safeMinimum: number;
    autopayTotal: number;
  };
};

const CARD_COLORS = [
  'hsl(200, 70%, 55%)', 'hsl(280, 55%, 55%)', 'hsl(340, 65%, 50%)',
  'hsl(160, 55%, 45%)', 'hsl(30, 70%, 50%)', 'hsl(60, 55%, 50%)',
];

export const CC_DEFAULT_CATEGORIES = new Set([
  'Groceries', 'Subscriptions', 'Pets', 'Dining', 'Gas', 'Entertainment',
  'Travel', 'Shopping', 'Miscellaneous', 'Other', 'Personal', 'Clothing',
  'Health', 'Fitness', 'Gifts', 'Education',
]);

export const BANK_DEFAULT_CATEGORIES = new Set([
  'Bills', 'Rent', 'Mortgage', 'Utilities', 'Internet', 'Insurance',
  'Debt Payments', 'Transfers', 'Investing', 'Savings',
]);

export function getCardColor(index: number): string {
  return CARD_COLORS[index % CARD_COLORS.length];
}

export function calcMinPayment(balance: number, apr: number): number {
  if (balance <= 0) return 0;
  const interestCharge = (balance * (apr / 100)) / 12;
  const pctMin = balance * 0.01;
  return Math.max(25, Math.ceil(interestCharge + pctMin));
}

export function getDefaultCardForExpense(category: string, accounts: any[]): string | null {
  if (!CC_DEFAULT_CATEGORIES.has(category)) return null;
  const activeCards = accounts
    .filter((a: any) => a.account_type === 'credit_card' && a.active)
    .sort((a: any, b: any) => (Number(b.apr) || 0) - (Number(a.apr) || 0));
  return activeCards.length > 0 ? `account:${activeCards[0].id}` : null;
}

export function buildCardData(
  accounts: any[], transactions: any[], rules: any[], debts: any[], colorStartIndex = 0,
): CardData[] {
  const ccAccounts = accounts.filter((a: any) => a.account_type === 'credit_card' && a.active);

  return ccAccounts.map((acct, i) => {
    const acctKey = `account:${acct.id}`;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthPurchases = transactions
      .filter((t: any) => t.type === 'expense' && (t.payment_source === acctKey || t.payment_source === acct.id) && t.date >= monthStart)
      .reduce((s: number, t: any) => s + Number(t.amount), 0);

    const recurringExplicit = rules
      .filter((r: any) => r.active && r.rule_type === 'expense' && (r.payment_source === acctKey || r.payment_source === acct.id))
      .reduce((s: number, r: any) => {
        const amt = Number(r.amount);
        if (r.frequency === 'weekly') return s + amt * 4.33;
        if (r.frequency === 'yearly') return s + amt / 12;
        return s + amt;
      }, 0);

    const highestAprCard = [...ccAccounts].sort((a: any, b: any) => (Number(b.apr) || 0) - (Number(a.apr) || 0))[0];
    const isDefaultCard = highestAprCard?.id === acct.id;

    const recurringDefault = isDefaultCard ? rules
      .filter((r: any) => r.active && r.rule_type === 'expense' && !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category))
      .reduce((s: number, r: any) => {
        const amt = Number(r.amount);
        if (r.frequency === 'weekly') return s + amt * 4.33;
        if (r.frequency === 'yearly') return s + amt / 12;
        return s + amt;
      }, 0) : 0;

    const monthlyNewPurchases = Math.max(monthPurchases, recurringExplicit + recurringDefault);

    const monthRepayments = transactions
      .filter((t: any) => t.type === 'expense' && t.category === 'Debt Payments' && t.note?.toLowerCase().includes(acct.name.toLowerCase()) && t.date >= monthStart)
      .reduce((s: number, t: any) => s + Number(t.amount), 0);

    const matchDebt = debts.find((d: any) => d.name.toLowerCase() === acct.name.toLowerCase());
    const balance = Number(acct.balance);
    const apr = Number(acct.apr) || 0;
    const creditLimit = Number(acct.credit_limit) || 0;
    const minPay = matchDebt ? Number(matchDebt.min_payment) : calcMinPayment(balance, apr);
    const targetPay = matchDebt ? Number(matchDebt.target_payment) : minPay;
    
    const autopayFullBalance = balance <= 0;

    return {
      id: acct.id, name: acct.name, balance, apr, creditLimit,
      minPayment: minPay,
      targetPayment: Math.max(targetPay, minPay),
      monthlyNewPurchases, monthlyRepayments: monthRepayments,
      color: getCardColor(colorStartIndex + i),
      autopayFullBalance,
      dueDay: acct.payment_due_day ?? null,
    };
  });
}

/** Project a single card with FIXED payment (consistent mode or standalone view) */
export function projectCard(card: CardData, months = 36): CardProjection {
  const rows: CardMonthRow[] = [];
  let bal = card.balance;
  let totalInterest = 0;
  let payoffMonth: number | null = null;
  const monthlyRate = card.apr / 100 / 12;

  for (let m = 1; m <= months; m++) {
    const d = new Date();
    d.setMonth(d.getMonth() + m - 1);
    const label = d.toLocaleString('en', { month: 'short', year: '2-digit' });
    const startBal = bal;
    const newPurchases = card.monthlyNewPurchases;
    
    if (card.autopayFullBalance) {
      const payment = newPurchases;
      rows.push({ month: m, label, startBalance: 0, newPurchases, interest: 0, payment, endBalance: 0, utilization: 0 });
      continue;
    }
    
    const interest = Math.round(Math.max(0, bal) * monthlyRate * 100) / 100;
    const payment = bal <= 0 ? 0 : Math.min(card.targetPayment, bal + newPurchases + interest);
    bal = startBal + newPurchases + interest - payment;
    totalInterest += interest;
    const utilization = card.creditLimit > 0 ? (Math.max(0, bal) / card.creditLimit) * 100 : 0;
    rows.push({ month: m, label, startBalance: Math.round(startBal * 100) / 100, newPurchases, interest, payment, endBalance: Math.round(bal * 100) / 100, utilization });
    if (bal <= 0 && payoffMonth === null && startBal > 0) payoffMonth = m;
  }

  return {
    card, months: rows, payoffMonth, totalInterest: Math.round(totalInterest),
    projectedInterestThisMonth: rows[0]?.interest || 0,
    recommendedPayment: card.autopayFullBalance ? card.monthlyNewPurchases : card.targetPayment,
    utilizationNow: card.creditLimit > 0 ? (card.balance / card.creditLimit) * 100 : 0,
  };
}

export function projectCardVariable(card: CardData, monthlyPayments: number[], months = 36): CardProjection {
  const rows: CardMonthRow[] = [];
  let bal = card.balance;
  let totalInterest = 0;
  let payoffMonth: number | null = null;
  const monthlyRate = card.apr / 100 / 12;

  for (let m = 1; m <= months; m++) {
    const d = new Date();
    d.setMonth(d.getMonth() + m - 1);
    const label = d.toLocaleString('en', { month: 'short', year: '2-digit' });
    const startBal = bal;
    const newPurchases = card.monthlyNewPurchases;

    if (card.autopayFullBalance || (bal <= 0 && payoffMonth !== null)) {
      const payment = newPurchases;
      rows.push({ month: m, label, startBalance: 0, newPurchases, interest: 0, payment, endBalance: 0, utilization: 0 });
      continue;
    }

    const interest = Math.round(Math.max(0, bal) * monthlyRate * 100) / 100;
    const availablePayment = monthlyPayments[m - 1] ?? card.minPayment;
    const payment = bal <= 0 ? 0 : Math.min(availablePayment, bal + newPurchases + interest);
    bal = startBal + newPurchases + interest - payment;
    totalInterest += interest;
    const utilization = card.creditLimit > 0 ? (Math.max(0, bal) / card.creditLimit) * 100 : 0;
    rows.push({ month: m, label, startBalance: Math.round(startBal * 100) / 100, newPurchases, interest, payment: Math.round(payment * 100) / 100, endBalance: Math.round(bal * 100) / 100, utilization });
    if (bal <= 0 && payoffMonth === null && startBal > 0) payoffMonth = m;
  }

  return {
    card, months: rows, payoffMonth, totalInterest: Math.round(totalInterest),
    projectedInterestThisMonth: rows[0]?.interest || 0,
    recommendedPayment: card.autopayFullBalance ? card.monthlyNewPurchases : (monthlyPayments[0] ?? card.targetPayment),
    utilizationNow: card.creditLimit > 0 ? (card.balance / card.creditLimit) * 100 : 0,
  };
}

/**
 * Simulate variable payoff with cash-floor + bill-reserve protection on ALL strategies.
 */
export function simulateVariablePayoff(
  cards: CardData[],
  liquidCash: number,
  cashFloor: number,
  strategy: 'avalanche' | 'snowball',
  monthlyTakeHome: number,
  monthlyExpenses: number,
  months = 36,
): { monthlyPayments: Map<string, number[]>; projectedPayoffMonths: number } {
  const balances = new Map(cards.map(c => [c.id, c.balance]));
  const monthlyPayments = new Map(cards.map(c => [c.id, [] as number[]]));
  let currentCash = liquidCash;
  let projectedPayoffMonths = 0;
  
  const autopayCards = new Set(cards.filter(c => c.autopayFullBalance).map(c => c.id));

  for (let m = 0; m < months; m++) {
    currentCash += monthlyTakeHome - monthlyExpenses;
    
    // Handle autopay cards first
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

    // ALL strategies enforce cash floor — never go below it
    const availableForDebt = Math.max(0, currentCash - cashFloor);
    const activeCards = cards.filter(c => !autopayCards.has(c.id) && (balances.get(c.id) || 0) > 0);
    
    if (activeCards.length === 0) {
      for (const card of cards) {
        if (!autopayCards.has(card.id)) monthlyPayments.get(card.id)!.push(0);
      }
      continue;
    }
    
    projectedPayoffMonths = m + 1;

    const sorted = [...activeCards];
    if (strategy === 'avalanche') {
      sorted.sort((a, b) => b.apr - a.apr);
    } else {
      sorted.sort((a, b) => (balances.get(a.id) || 0) - (balances.get(b.id) || 0));
    }

    let remaining = availableForDebt;
    const payments = new Map<string, number>();

    // Step 1: Allocate ALL minimums first — critical priority
    const totalMins = sorted.reduce((s, c) => s + Math.min(c.minPayment, balances.get(c.id) || 0), 0);
    
    for (const card of sorted) {
      const bal = balances.get(card.id)!;
      const min = Math.min(card.minPayment, bal, remaining);
      payments.set(card.id, min);
      remaining -= min;
    }

    // Step 2: If we couldn't cover all minimums, redistribute proportionally
    if (remaining < 0) remaining = 0;
    const coveredMins = Array.from(payments.values()).reduce((s, v) => s + v, 0);
    if (coveredMins < totalMins && availableForDebt > 0) {
      remaining = availableForDebt;
      for (const card of sorted) {
        const bal = balances.get(card.id)!;
        const min = Math.min(card.minPayment, bal);
        const proportion = totalMins > 0 ? min / totalMins : 0;
        const alloc = Math.min(Math.round(remaining * proportion * 100) / 100, bal);
        payments.set(card.id, alloc);
      }
      remaining = 0;
    }

    // Step 3: Allocate extra to priority card(s) based on strategy
    if (remaining > 0) {
      for (const card of sorted) {
        if (remaining <= 0) break;
        const bal = balances.get(card.id)!;
        const currentPayment = payments.get(card.id) || 0;
        const maxExtra = bal - currentPayment;
        const extra = Math.min(remaining, maxExtra);
        if (extra > 0) {
          payments.set(card.id, currentPayment + extra);
          remaining -= extra;
        }
      }
    }

    for (const card of cards) {
      if (autopayCards.has(card.id)) continue;
      const payment = payments.get(card.id) || 0;
      monthlyPayments.get(card.id)!.push(Math.round(payment * 100) / 100);
      const bal = balances.get(card.id)!;
      balances.set(card.id, Math.max(0, bal - payment));
      currentCash -= payment;
    }
  }

  return { monthlyPayments, projectedPayoffMonths };
}

/**
 * Generate due-date-aware recommendations using estimated liquid cash by each card's due date.
 * Now includes ALL income sources: paycheck, non-paycheck recurring, and one-time income transactions.
 */
export function generateRecommendations(
  cards: CardData[],
  liquidCash: number,
  cashFloor: number,
  strategy: 'avalanche' | 'snowball',
  monthlyTakeHome: number,
  monthlyExpenses: number,
  paymentMode: 'variable' | 'consistent' = 'variable',
  payConfig?: PayScheduleConfig,
  rules?: any[],
  fundingAccountId?: string | null,
  prePaycheckBillsTotal?: number,
  fundingBalance?: number,
  oneTimeExpensesThisMonth?: number,
  oneTimeIncomeThisMonth?: number,
  transactions?: any[],
  primaryDueDay?: number,
): RecommendationSummary {
  const autopayCards = cards.filter(c => c.autopayFullBalance);
  const revolvingCards = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
  
  const totalMinDue = revolvingCards.reduce((s, c) => s + c.minPayment, 0);
  const autopayTotal = autopayCards.reduce((s, c) => s + c.monthlyNewPurchases, 0);

  // Recommended safe minimum = max(user cash floor, pre-paycheck next-month bills)
  const userCashFloor = cashFloor;
  const ppBills = prePaycheckBillsTotal ?? 0;
  const recommendedSafeMinimum = Math.max(userCashFloor, ppBills);

  // Use funding balance if provided, otherwise fall back to total liquid cash
  const effectiveFundingBalance = fundingBalance ?? liquidCash;

  // Use earliest revolving card due day as the window for safe-to-pay calculation
  const effectivePrimaryDueDay = primaryDueDay ?? (() => {
    const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
    if (revolving.length === 0) return 31;
    const dueDays = revolving.map(c => c.dueDay || 15);
    return Math.min(...dueDays);
  })();

  // Use Transactions as the SINGLE SOURCE OF TRUTH for income/expense in the due-date window.
  // This prevents double-counting between Budget Control rules and Transaction rows.
  let remainingTransactionIncome = 0;
  let remainingTransactionExpenses = 0;

  if (transactions && transactions.length > 0) {
    // All income from Transactions dated today → due day (includes paychecks, non-paycheck, one-time)
    remainingTransactionIncome = getRemainingTransactionIncomeByDay(transactions, effectivePrimaryDueDay);
    // All non-debt expenses from Transactions dated today → due day
    remainingTransactionExpenses = getRemainingTransactionExpensesByDay(transactions, effectivePrimaryDueDay, true);
  } else if (payConfig && rules) {
    // Fallback if no transactions available: use rule-based calculations
    remainingTransactionIncome = getRemainingIncomeByDay(payConfig, effectivePrimaryDueDay)
      + getRemainingNonPaycheckIncomeByDay(rules, effectivePrimaryDueDay, fundingAccountId || null);
    remainingTransactionExpenses = getRemainingExpensesByDay(rules, effectivePrimaryDueDay, fundingAccountId || null);
  } else {
    remainingTransactionIncome = monthlyTakeHome;
    remainingTransactionExpenses = monthlyExpenses;
  }

  // For breakdown display, keep labeled fields
  const remainingPaycheckIncome = remainingTransactionIncome; // combined label
  const remainingNonPaycheckIncome = 0; // folded into above
  const remainingOneTimeIncome = 0; // folded into above
  const remainingExpenses = remainingTransactionExpenses; // combined label
  const remainingOneTimeExpenses = 0; // folded into above

  const totalRemainingIncome = remainingTransactionIncome;
  const totalRemainingOutflows = remainingTransactionExpenses;

  // Safe to Pay = funding balance + all remaining income - all remaining outflows - safe minimum - autopay
  const safeToPayTotal = Math.max(0,
    effectiveFundingBalance + totalRemainingIncome - totalRemainingOutflows - recommendedSafeMinimum - autopayTotal
  );

  const cashWarning = safeToPayTotal < totalMinDue;

  // Calculate estimated liquid cash for each card by due date
  const cardEstimatedCash = new Map<string, number>();
  for (const card of revolvingCards) {
    const dueDay = card.dueDay || 15;
    if (transactions && transactions.length > 0) {
      const incByDue = getRemainingTransactionIncomeByDay(transactions, dueDay);
      const expByDue = getRemainingTransactionExpensesByDay(transactions, dueDay, true);
      cardEstimatedCash.set(card.id, effectiveFundingBalance + incByDue - expByDue);
    } else {
      cardEstimatedCash.set(card.id, effectiveFundingBalance + totalRemainingIncome - totalRemainingOutflows);
    }
  }

  const strategyLabels: Record<string, string> = {
    avalanche: 'Highest APR First',
    snowball: 'Smallest Balance First',
  };

  let remaining = safeToPayTotal;
  const recs: PayoffRecommendation[] = [];

  for (const card of autopayCards) {
    recs.push({
      cardId: card.id, cardName: card.name, color: card.color,
      payment: card.monthlyNewPurchases,
      isMinimumOnly: false,
      reason: 'Autopay Full Balance',
      dueDay: card.dueDay,
    });
  }

  const sorted = [...revolvingCards];
  if (strategy === 'avalanche') {
    sorted.sort((a, b) => b.apr - a.apr);
  } else {
    sorted.sort((a, b) => a.balance - b.balance);
  }

  // Step 1: Cover ALL minimums first — critical priority
  for (const card of sorted) {
    const basePayment = Math.max(0, Math.min(card.minPayment, remaining, card.balance));
    recs.push({
      cardId: card.id, cardName: card.name, color: card.color, payment: basePayment,
      isMinimumOnly: true,
      reason: 'Minimum due',
      estimatedLiquidCash: cardEstimatedCash.get(card.id),
      dueDay: card.dueDay,
    });
    remaining -= basePayment;
  }

  // Step 2: Allocate extra based on strategy
  if (remaining > 0) {
    for (let i = 0; i < sorted.length && remaining > 0; i++) {
      const card = sorted[i];
      const rec = recs.find(r => r.cardId === card.id)!;
      const maxExtra = card.balance - rec.payment;
      const extra = Math.min(remaining, maxExtra);
      if (extra > 0) {
        rec.payment += extra;
        rec.isMinimumOnly = false;
        rec.reason = strategy === 'avalanche'
          ? `Highest APR (${card.apr}%)`
          : `Smallest balance (${formatCurrency(card.balance, false)})`;
        remaining -= extra;
      }
    }
  }

  const interestMinOnly = revolvingCards.reduce((s, c) => s + (c.balance * (c.apr / 100 / 12)), 0);
  const interestWithRecs = revolvingCards.reduce((s, c) => {
    const rec = recs.find(r => r.cardId === c.id);
    const afterPayment = Math.max(0, c.balance - (rec?.payment || 0) + c.monthlyNewPurchases);
    return s + afterPayment * (c.apr / 100 / 12);
  }, 0);

  const { projectedPayoffMonths } = simulateVariablePayoff(
    cards, liquidCash, cashFloor, strategy, monthlyTakeHome, monthlyExpenses, 120,
  );

  const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
  const thresholds = [30, 10];
  const milestones = thresholds.map(t => {
    let simB = cards.map(c => c.autopayFullBalance ? 0 : c.balance);
    for (let m = 0; m < 120; m++) {
      const totalBal = simB.reduce((s, b) => s + Math.max(0, b), 0);
      const util = totalLimit > 0 ? (totalBal / totalLimit) * 100 : 0;
      if (util <= t) return { threshold: t, month: m };
      simB = simB.map((bal, i) => {
        if (bal <= 0 || cards[i].autopayFullBalance) return 0;
        const card = cards[i];
        const rec = recs.find(r => r.cardId === card.id);
        return Math.max(0, bal + card.monthlyNewPurchases + bal * (card.apr / 100 / 12) - (rec?.payment || card.minPayment));
      });
    }
    return { threshold: t, month: null };
  });

  return {
    totalAvailableCash: safeToPayTotal,
    totalMinimumsdue: totalMinDue,
    extraCashAvailable: Math.max(0, safeToPayTotal - totalMinDue),
    recommendations: recs.filter(r => r.payment > 0),
    interestAvoided: Math.round((interestMinOnly - interestWithRecs) * 100) / 100,
    projectedPayoffMonths,
    utilizationMilestones: milestones,
    cashWarning,
    strategyLabel: strategyLabels[strategy] || strategy,
    recommendedSafeMinimum,
    userCashFloor,
    prePaycheckBills: ppBills,
    breakdown: {
      fundingBalance: effectiveFundingBalance,
      remainingPaycheckIncome,
      remainingNonPaycheckIncome,
      remainingOneTimeIncome,
      remainingExpenses,
      remainingOneTimeExpenses,
      safeMinimum: recommendedSafeMinimum,
      autopayTotal,
    },
  };
}

/**
 * Shared helper: compute current-month debt payment recommendations.
 * Used by Dashboard, Budget Control, Savings Goals, and Forecast to get
 * the same debt payment values that Debt Payoff displays.
 */
export function getCurrentMonthDebtRecommendations(
  accounts: any[],
  transactions: any[], // merged base transactions (without debt payments)
  rules: any[],
  debts: any[],
  profile: any,
): { cardId: string; cardName: string; payment: number; dueDay: number | null; reason: string }[] {
  const cards = buildCardData(accounts, transactions, rules, debts);
  if (cards.length === 0) return [];

  const liquidTypes = ['checking', 'business_checking', 'cash'];
  const liquidAccounts = accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type));
  const liquidCash = liquidAccounts.reduce((s: number, a: any) => s + Number(a.balance), 0);
  const cashFloor = Number(profile?.cash_floor) || 1000;
  const pc = buildPayConfig(profile);
  const monthlyTakeHome = getMonthNetIncome(pc, new Date().getFullYear(), new Date().getMonth());
  const monthlyExpenses = rules.filter((r: any) => r.active && r.rule_type === 'expense')
    .reduce((s: number, r: any) => {
      const amt = Number(r.amount);
      if (r.frequency === 'weekly') return s + amt * 4.33;
      if (r.frequency === 'yearly') return s + amt / 12;
      return s + amt;
    }, 0);

  // Resolve funding account exactly like CreditCardEngine does
  const defaultId = profile?.default_deposit_account || null;
  let fundingAccountId: string | null = null;
  if (defaultId) {
    const acct = liquidAccounts.find((a: any) => a.id === defaultId);
    if (acct) fundingAccountId = acct.id;
  }
  if (!fundingAccountId) {
    const checking = liquidAccounts.find((a: any) => a.account_type === 'checking');
    fundingAccountId = checking?.id || liquidAccounts[0]?.id || null;
  }

  const fundAcct = liquidAccounts.find((a: any) => a.id === fundingAccountId);
  const fundBal = fundAcct ? Number(fundAcct.balance) : liquidCash;

  // Use funding account for pre-paycheck bills (matches CreditCardEngine)
  const { total: ppBills } = getPrePaycheckNextMonthBills(rules, pc, fundingAccountId);

  // Calculate primaryDueDay same as CreditCardEngine
  const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
  const primaryDueDay = revolving.length > 0
    ? Math.min(...revolving.map(c => c.dueDay || 15))
    : 31;

  const recs = generateRecommendations(
    cards, liquidCash, cashFloor, 'avalanche', monthlyTakeHome, monthlyExpenses,
    'variable', pc, rules, fundingAccountId, ppBills, fundBal,
    undefined, undefined, transactions, primaryDueDay,
  );

  return recs.recommendations.map(r => ({
    cardId: r.cardId,
    cardName: r.cardName,
    payment: r.payment,
    dueDay: r.dueDay || null,
    reason: r.reason,
  }));
}
