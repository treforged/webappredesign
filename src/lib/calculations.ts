export function formatCurrency(amount: number, showCents = true, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(amount);
}

export function calculateMonthlyPayment(principal: number, apr: number, termMonths: number): number {
  if (apr === 0) return principal / termMonths;
  const r = apr / 100 / 12;
  return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

export function calculatePayoffMonths(balance: number, apr: number, monthlyPayment: number): number {
  if (monthlyPayment <= 0) return Infinity;
  if (apr === 0) return Math.ceil(balance / monthlyPayment);
  const r = apr / 100 / 12;
  const interest = balance * r;
  if (monthlyPayment <= interest) return Infinity;
  return Math.ceil(-Math.log(1 - (balance * r) / monthlyPayment) / Math.log(1 + r));
}

export function calculateTotalInterest(balance: number, apr: number, monthlyPayment: number): number {
  if (apr === 0) return 0;
  const months = calculatePayoffMonths(balance, apr, monthlyPayment);
  if (months === Infinity) return Infinity;
  return monthlyPayment * months - balance;
}

export function getMonthName(monthIndex: number): string {
  return new Date(2024, monthIndex).toLocaleString('en', { month: 'short' });
}

// ─── Debt Payoff Rollover Simulation ──────────────────────────────────────────

export interface DebtPayoffDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  min_payment: number;
}

export interface DebtMonthEntry {
  month: number;
  payment: number;
  interest: number;
  remaining: number;
}

export interface DebtPayoffResult {
  debtId: string;
  name: string;
  paidOffMonth: number;
  totalInterest: number;
  schedule: DebtMonthEntry[];
}

export interface PayoffSimulation {
  priorityOrder: string[]; // debt IDs in attack order
  schedule: DebtPayoffResult[];
  totalMonths: number;
  totalInterest: number;
}

/**
 * Simulate debt payoff with rollover.
 * 1. Each month: accrue interest on all active debts.
 * 2. Pay minimums on all active debts.
 * 3. Apply all remaining budget to the current priority debt.
 * 4. When a debt reaches $0, its freed amount rolls over to the next priority debt immediately.
 * 5. totalMonthlyBudget stays constant until remaining debt < budget.
 */
export function simulateDebtPayoff(
  debts: DebtPayoffDebt[],
  strategy: 'snowball' | 'avalanche',
  totalMonthlyBudget: number,
): PayoffSimulation {
  if (debts.length === 0) {
    return { priorityOrder: [], schedule: [], totalMonths: 0, totalInterest: 0 };
  }

  const prioritized = strategy === 'snowball'
    ? [...debts].sort((a, b) => a.balance - b.balance)
    : [...debts].sort((a, b) => b.apr - a.apr);

  const balances: Record<string, number> = {};
  const interestAccum: Record<string, number> = {};
  const schedules: Record<string, DebtMonthEntry[]> = {};
  const paidOffMonths: Record<string, number> = {};

  for (const d of debts) {
    balances[d.id] = d.balance;
    interestAccum[d.id] = 0;
    schedules[d.id] = [];
  }

  const MAX_MONTHS = 600;
  let month = 0;

  while (month < MAX_MONTHS) {
    if (debts.every(d => balances[d.id] <= 0)) break;
    month++;

    // Accrue interest
    const monthInterest: Record<string, number> = {};
    for (const d of debts) {
      if (balances[d.id] > 0) {
        const i = Math.round(balances[d.id] * (d.apr / 100 / 12) * 100) / 100;
        monthInterest[d.id] = i;
        balances[d.id] = Math.round((balances[d.id] + i) * 100) / 100;
      } else {
        monthInterest[d.id] = 0;
      }
    }

    // Budget for this month — capped to total remaining debt
    const totalDebt = debts.reduce((s, d) => s + Math.max(0, balances[d.id]), 0);
    let budget = Math.min(totalMonthlyBudget, totalDebt);

    // Pay minimums first
    const payments: Record<string, number> = {};
    for (const d of debts) {
      if (balances[d.id] > 0) {
        const min = Math.min(d.min_payment, balances[d.id]);
        payments[d.id] = min;
        budget -= min;
      } else {
        payments[d.id] = 0;
      }
    }
    budget = Math.max(0, budget);

    // Apply extra budget to priority debts in order (with rollover)
    for (const d of prioritized) {
      if (budget <= 0) break;
      if (balances[d.id] <= 0) continue;
      const canPay = Math.min(budget, balances[d.id] - payments[d.id]);
      payments[d.id] = Math.round((payments[d.id] + canPay) * 100) / 100;
      budget = Math.round((budget - canPay) * 100) / 100;
    }

    // Apply payments and record
    for (const d of debts) {
      const pay = payments[d.id] || 0;
      balances[d.id] = Math.max(0, Math.round((balances[d.id] - pay) * 100) / 100);
      interestAccum[d.id] = Math.round((interestAccum[d.id] + monthInterest[d.id]) * 100) / 100;
      if (pay > 0 || monthInterest[d.id] > 0) {
        schedules[d.id].push({ month, payment: pay, interest: monthInterest[d.id], remaining: balances[d.id] });
      }
      if (balances[d.id] === 0 && paidOffMonths[d.id] === undefined) {
        paidOffMonths[d.id] = month;
      }
    }
  }

  const schedule: DebtPayoffResult[] = debts.map(d => ({
    debtId: d.id,
    name: d.name,
    paidOffMonth: paidOffMonths[d.id] ?? month,
    totalInterest: interestAccum[d.id],
    schedule: schedules[d.id],
  }));

  return {
    priorityOrder: prioritized.map(d => d.id),
    schedule,
    totalMonths: month,
    totalInterest: Math.round(schedule.reduce((s, r) => s + r.totalInterest, 0) * 100) / 100,
  };
}
