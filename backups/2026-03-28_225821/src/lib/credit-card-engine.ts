import { formatCurrency } from './calculations';
import {
  PayScheduleConfig, getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay,
  getRemainingIncomeByDay, getRemainingExpensesByDay, getRemainingNonPaycheckIncomeByDay,
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
  if (!accounts || !transactions || !rules || !debts) return [];
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

    const autopayFullBalance = false;

    return {
      id: acct.id, name: acct.name, balance, apr, creditLimit,
      minPayment: minPay,
      targetPayment: Math.max(targetPay, minPay),
      monthlyNewPurchases, monthlyRepayments: monthRepayments,
      color: getCardColor(colorStartIndex + i),
      autopayFullBalance,
      dueDay: (acct as any).payment_due_day ?? null,
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

// ─── Simulation output types ──────────────────────────────

/** A projected debt payment emitted by simulateVariablePayoff for Forecast / Transactions rendering. */
export type SimulatedDebtPayment = {
  date: string;           // ISO date — last day of the payment month
  description: string;    // e.g. "Prime Visa Payment"
  amount: number;         // positive outflow amount
  account: string;        // funding account id ('' when unknown)
  category: 'Debt Payments';
  card: string;           // credit card account id
  type: 'debt_payoff';
  projected: true;
};

/** Flags emitted by simulateVariablePayoff describing per-month anomalies. */
export type SimulationFlag = {
  month: number;
  flag: 'UNSTABLE' | 'FLOOR_BREACHED' | 'CARD_AT_RISK';
  /** Set when flag === 'CARD_AT_RISK' — identifies which card missed its minimum. */
  cardId?: string;
};

/**
 * Event-based, cash-floor-aware variable payoff simulation.
 *
 * Algorithm (Steps 1-8, plan debt-engine-v2.md):
 *   Step 1  Initialise balances and currentCash from inputs.
 *   Step 2  Compute available cash from events (or scalar fallback).
 *   Step 3  Pay minimums; handle FLOOR_BREACHED with snowball protection.
 *   Step 4  Allocate extra cash to priority card (avalanche / snowball).
 *           C3: card balance has NOT been reduced yet — do not double-subtract.
 *   Step 5  Deduct payments from balances and currentCash.
 *   Step 6  Apply interest AFTER all payments (C4 — never mid-month).
 *   Step 7  Advance month: currentCash += monthIncome - monthExpenses.
 *   Step 8  Repeat until all balances = 0 or month limit reached.
 *
 * Backward-compatible: existing callers pass 7 positional args (scalars).
 * Event-based callers (TASK 2) additionally pass monthEvents[] and fundingAccountId.
 */
export function simulateVariablePayoff(
  cards: CardData[],
  liquidCash: number,
  cashFloor: number,
  strategy: 'avalanche' | 'snowball',
  /** Scalar fallback — used when monthEvents is not provided. */
  monthlyTakeHome: number,
  /** Scalar fallback — used when monthEvents is not provided. */
  monthlyExpenses: number,
  months = 36,
  /**
   * Optional event-based per-month income/expense sums (C5).
   * monthEvents[0]  = current month scoped today→EOM (scoped by caller, C1).
   * monthEvents[1+] = full future month sums.
   * When omitted, monthlyTakeHome / monthlyExpenses scalars are used for every month.
   */
  monthEvents?: { income: number; expenses: number }[],
  /** Used to populate the `account` field on SimulatedDebtPayment records. */
  fundingAccountId?: string,
  /**
   * Optional per-month per-card CC purchase amounts (T1/T3).
   * cardPurchasesPerMonth[m][cardId] = total CC purchases for that card in month m.
   * Month 0 should be 0 — the live card.balance already includes today's purchases.
   * When omitted, falls back to card.monthlyNewPurchases for months 1+ (legacy callers).
   */
  cardPurchasesPerMonth?: { [cardId: string]: number }[],
  /**
   * Override for month 0 (current month) remaining income from today to month-end.
   * Takes priority over monthEvents[0].income and the monthlyTakeHome scalar.
   * Derived from allTransactions so the live account balance is the ground truth.
   */
  month0RemainingIncome?: number,
  /**
   * Override for month 0 (current month) remaining expenses from today to month-end.
   * Takes priority over monthEvents[0].expenses and the monthlyExpenses scalar.
   */
  month0RemainingExpenses?: number,
): {
  monthlyPayments: Map<string, number[]>;
  projectedPayoffMonths: number;
  cashFloorBreaches: { month: number; endingCash: number }[];
  flags: SimulationFlag[];
  projectedCashByMonth: number[];
  debtPaymentTransactions: SimulatedDebtPayment[];
  warningMessages: { month: number; message: string }[];
} {
  if (cards.length === 0) {
    return {
      monthlyPayments: new Map(),
      projectedPayoffMonths: 0,
      cashFloorBreaches: [],
      flags: [],
      projectedCashByMonth: [],
      debtPaymentTransactions: [],
      warningMessages: [],
    };
  }

  // ── Step 1 — Initialise ────────────────────────────────────
  const balances = new Map<string, number>(cards.map(c => [c.id, c.balance]));
  const monthlyPayments = new Map<string, number[]>(cards.map(c => [c.id, []]));
  let currentCash = liquidCash;
  let projectedPayoffMonths = 0;
  const cashFloorBreaches: { month: number; endingCash: number }[] = [];
  const flags: SimulationFlag[] = [];
  const projectedCashByMonth: number[] = [];
  const debtPaymentTransactions: SimulatedDebtPayment[] = [];
  const warningMessages: { month: number; message: string }[] = [];

  const now = new Date();

  for (let m = 0; m < months; m++) {

    // ── Step 2 — Available Cash ────────────────────────────────
    // Month 0: prefer explicit remaining-income/expenses derived from allTransactions
    // (balance is ground truth; only count income/expenses from today forward).
    // Months 1+: fall back to monthEvents or scalar.
    const monthIncome = (m === 0 && month0RemainingIncome !== undefined)
      ? month0RemainingIncome
      : (monthEvents?.[m]?.income ?? monthlyTakeHome);
    const monthExpenses = (m === 0 && month0RemainingExpenses !== undefined)
      ? month0RemainingExpenses
      : (monthEvents?.[m]?.expenses ?? monthlyExpenses);

    // End-of-month ISO date used for SimulatedDebtPayment records
    const payDate = new Date(now.getFullYear(), now.getMonth() + m + 1, 0);
    const payDateStr = payDate.toISOString().split('T')[0];

    // Helper: monthly CC purchases for a card this month (T1/T3)
    // Month 0 = 0 because live card.balance already includes today's purchases.
    const cardPurchasesThisMonth = (c: CardData): number =>
      cardPurchasesPerMonth?.[m]?.[c.id] ?? (m === 0 ? 0 : c.monthlyNewPurchases);

    // ── Step 2.5 — Add monthly CC purchases to each card's balance (T3) ───────
    // Paid-off cards (bal <= 0) immediately pay new purchases in full without
    // going through the min/extra allocation loop — they stay at $0 and never
    // re-accumulate interest. Cards still carrying a balance have purchases added
    // normally and are handled by Steps 3-4.
    const prePaidThisMonth = new Set<string>();
    for (const card of cards) {
      const bal = balances.get(card.id) ?? 0;
      const purchases = cardPurchasesThisMonth(card);
      if (bal <= 0) {
        const pay = Math.round(purchases * 100) / 100;
        monthlyPayments.get(card.id)!.push(pay);
        currentCash -= pay;
        prePaidThisMonth.add(card.id);
        if (pay > 0) {
          debtPaymentTransactions.push({
            date: payDateStr, description: `${card.name} Payment`,
            amount: pay, account: fundingAccountId ?? '',
            category: 'Debt Payments', card: card.id,
            type: 'debt_payoff', projected: true,
          });
        }
        continue;
      }
      if (purchases > 0) {
        balances.set(card.id, bal + purchases);
      }
    }

    // Active = balance > 0 after adding this month's purchases
    const activeCards = cards.filter(c => (balances.get(c.id) ?? 0) > 0);

    // C8 overpayment guard: only exit early if ALL cards have $0 AND no pending purchases
    const allPaid = cards.every(c =>
      (balances.get(c.id) ?? 0) === 0 && cardPurchasesThisMonth(c) === 0,
    );
    if (allPaid) {
      for (const card of cards) monthlyPayments.get(card.id)!.push(0);
      currentCash += monthIncome - monthExpenses;
      projectedCashByMonth.push(Math.round(currentCash * 100) / 100);
      continue;
    }

    projectedPayoffMonths = m + 1;

    let availableCash = currentCash + monthIncome - monthExpenses - cashFloor;

    if (availableCash < 0) {
      // Edge case: even before minimums we're short
      flags.push({ month: m + 1, flag: 'UNSTABLE' });
      availableCash = 0;
    }

    // ── Step 3 — Pay Minimums ─────────────────────────────────
    const payments = new Map<string, number>(cards.map(c => [c.id, 0]));

    const minDueMap = new Map<string, number>(
      activeCards.map(c => [c.id, Math.min(c.minPayment, balances.get(c.id) ?? 0)]),
    );
    const totalMins = [...minDueMap.values()].reduce((s, v) => s + v, 0);

    if (availableCash < totalMins) {
      // FLOOR_BREACHED: minimums exceed floor-adjusted cash
      // Allow going below floor — minimums override it — but use currentCash as hard limit
      flags.push({ month: m + 1, flag: 'FLOOR_BREACHED' });
      cashFloorBreaches.push({ month: m + 1, endingCash: currentCash - totalMins });

      // Snowball protection: pay smallest balances first so at least some cards
      // stay current when cash is tight
      const sortedForBreached = [...activeCards].sort(
        (a, b) => (balances.get(a.id) ?? 0) - (balances.get(b.id) ?? 0),
      );

      let remainingForMins = currentCash; // floor ignored for minimums
      let atRiskWarningEmitted = false;

      for (const card of sortedForBreached) {
        const min = minDueMap.get(card.id) ?? 0;
        if (remainingForMins >= min) {
          payments.set(card.id, min);
          remainingForMins -= min;
        } else {
          // Cannot cover this card's minimum — mark at risk
          payments.set(card.id, 0);
          flags.push({ month: m + 1, flag: 'CARD_AT_RISK', cardId: card.id });
          if (!atRiskWarningEmitted) {
            warningMessages.push({
              month: m + 1,
              message:
                'Available cash cannot cover all minimum payments. Consider reducing expenses or increasing income.',
            });
            atRiskWarningEmitted = true;
          }
        }
      }
      // No extra payments in floor-breach mode

    } else {
      // Normal path: pay all minimums
      for (const card of activeCards) {
        payments.set(card.id, minDueMap.get(card.id) ?? 0);
      }

      // ── Step 4 — Extra Payment Allocation ──────────────────
      // C3: balances[card.id] is the PRE-PAYMENT balance here.
      //     payments[card.id] already contains the minimum committed.
      //     maxExtra = pre-payment balance − min = remaining balance after minimum.
      //     Do NOT subtract minDue again — that was C3's double-subtraction bug.
      const strategyOrder = [...activeCards].sort((a, b) =>
        strategy === 'avalanche'
          ? b.apr - a.apr
          : (balances.get(a.id) ?? 0) - (balances.get(b.id) ?? 0),
      );

      let remaining = availableCash - totalMins;

      for (const card of strategyOrder) {
        if (remaining <= 0) break;

        const bal = balances.get(card.id) ?? 0;
        const alreadyPaid = payments.get(card.id) ?? 0;
        const maxExtra = bal - alreadyPaid; // remaining balance after min
        if (maxExtra <= 0) continue;

        const extra = Math.min(remaining, maxExtra);
        payments.set(card.id, alreadyPaid + extra);
        remaining -= extra;
      }

      // C8 overpayment guard: clamp each payment to the card's current balance
      for (const card of activeCards) {
        const bal = balances.get(card.id) ?? 0;
        const pay = payments.get(card.id) ?? 0;
        if (pay > bal) payments.set(card.id, bal);
      }

      // Final pass: pay off residual balances under $100 if cash remains
      if (remaining > 0) {
        for (const card of strategyOrder) {
          if (remaining <= 0) break;
          const bal = balances.get(card.id)!;
          const currentPayment = payments.get(card.id) || 0;
          const residual = bal - currentPayment;
          if (residual > 0 && residual < 100) {
            const extra = Math.min(remaining, residual);
            payments.set(card.id, currentPayment + extra);
            remaining -= extra;
          }
        }
      }
    }

    // ── Step 5 — Update Balances and Cash ─────────────────────
    for (const card of cards) {
      if (prePaidThisMonth.has(card.id)) continue; // payment already recorded in Step 2.5
      const payment = Math.round((payments.get(card.id) ?? 0) * 100) / 100;
      monthlyPayments.get(card.id)!.push(payment);

      const bal = balances.get(card.id) ?? 0;
      balances.set(card.id, Math.max(0, bal - payment));
      currentCash -= payment;

      if (payment > 0) {
        debtPaymentTransactions.push({
          date: payDateStr,
          description: `${card.name} Payment`,
          amount: payment,
          account: fundingAccountId ?? '',
          category: 'Debt Payments',
          card: card.id,
          type: 'debt_payoff',
          projected: true,
        });
      }
    }

    // ── Step 6 — Interest AFTER All Payments (C4) ─────────────
    // Interest is never applied mid-month. It is always added to the
    // NEXT month's starting balance only.
    for (const card of cards) {
      const bal = balances.get(card.id) ?? 0;
      if (bal > 0 && card.apr > 0) {
        const interest = (card.apr / 100 / 12) * bal;
        balances.set(card.id, bal + interest);
      }
    }

    // ── Step 7 — Advance Month ────────────────────────────────
    currentCash += monthIncome - monthExpenses;
    projectedCashByMonth.push(Math.round(currentCash * 100) / 100);
  }

  return {
    monthlyPayments,
    projectedPayoffMonths,
    cashFloorBreaches,
    flags,
    projectedCashByMonth,
    debtPaymentTransactions,
    warningMessages,
  };
}

/**
 * Generate due-date-aware recommendations using estimated liquid cash by each card's due date.
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

  const userCashFloor = cashFloor;
  const ppBills = prePaycheckBillsTotal ?? 0;
  const recommendedSafeMinimum = Math.max(userCashFloor, ppBills);

  const effectiveFundingBalance = fundingBalance ?? liquidCash;

  const effectivePrimaryDueDay = primaryDueDay ?? (() => {
    const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
    if (revolving.length === 0) return 31;
    const dueDays = revolving.map(c => c.dueDay || 15);
    return Math.min(...dueDays);
  })();

  let remainingTransactionIncome = 0;
  let remainingTransactionExpenses = 0;

  if (transactions && transactions.length > 0) {
    remainingTransactionIncome = getRemainingTransactionIncomeByDay(transactions, effectivePrimaryDueDay);
    remainingTransactionExpenses = getRemainingTransactionExpensesByDay(transactions, effectivePrimaryDueDay, true);
  } else if (payConfig && rules) {
    remainingTransactionIncome = getRemainingIncomeByDay(payConfig, effectivePrimaryDueDay)
      + getRemainingNonPaycheckIncomeByDay(rules, effectivePrimaryDueDay, fundingAccountId || null);
    remainingTransactionExpenses = getRemainingExpensesByDay(rules, effectivePrimaryDueDay, fundingAccountId || null);
  } else {
    remainingTransactionIncome = monthlyTakeHome;
    remainingTransactionExpenses = monthlyExpenses;
  }

  const remainingPaycheckIncome = remainingTransactionIncome;
  const remainingNonPaycheckIncome = 0;
  const remainingOneTimeIncome = 0;
  const remainingExpenses = remainingTransactionExpenses;
  const remainingOneTimeExpenses = 0;

  const totalRemainingIncome = remainingTransactionIncome;
  const totalRemainingOutflows = remainingTransactionExpenses;

  const safeToPayTotal = Math.max(0,
    effectiveFundingBalance + totalRemainingIncome - totalRemainingOutflows - recommendedSafeMinimum - autopayTotal
  );

  const cashWarning = safeToPayTotal < totalMinDue;

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
  transactions: any[],
  rules: any[],
  debts: any[],
  profile: any,
): { cardId: string; cardName: string; payment: number; dueDay: number | null; reason: string }[] {
  if (!accounts || !transactions || !rules || !debts) return [];
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

  const { total: ppBills } = getPrePaycheckNextMonthBills(rules, pc, fundingAccountId);

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
