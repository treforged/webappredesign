// ─── Debt Payment Transaction Generator ──────────────────
// Generates monthly debt payment transactions from the Debt Payoff schedule

import { buildCardData, projectCard, projectCardVariable, simulateVariablePayoff, CardData, CC_DEFAULT_CATEGORIES } from './credit-card-engine';

/** Cash-only monthly expense scalar — excludes CC-tagged rules to avoid double-counting with Step 2.5.
 *  Includes transfer/investment rules since those are real liquid-cash outflows that reduce debt surplus. */
function calcCashOnlyMonthlyExpenses(rules: any[], cards: CardData[]): number {
  const ccPaymentSources = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
  return rules.filter((r: any) => {
    if (!r.active) return false;
    // Savings transfers and investment contributions come out of liquid cash every month
    if (r.rule_type === 'transfer' || r.rule_type === 'investment') return true;
    if (r.rule_type !== 'expense') return false;
    if (r.payment_source && ccPaymentSources.has(r.payment_source)) return false;
    if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false;
    return true;
  }).reduce((s: number, r: any) => {
    const amt = Number(r.amount);
    if (r.frequency === 'weekly') return s + amt * 4.33;
    if (r.frequency === 'biweekly') return s + amt * 2.167;
    if (r.frequency === 'yearly') return s + amt / 12;
    return s + amt;
  }, 0);
}

export type DebtPaymentTransaction = {
  id: string;
  date: string;
  type: 'expense';
  amount: number;
  category: string;
  note: string;
  payment_source: string;
  isGenerated: boolean;
  isDebtPayment: boolean;
  debtCardId: string;
  debtCardName: string;
  monthIndex: number;
};

/**
 * Generate debt payment transactions from the active payoff plan.
 */
export function generateDebtPaymentTransactions(
  accounts: any[],
  transactions: any[],
  rules: any[],
  debts: any[],
  profile: any,
  options: {
    strategy: 'avalanche' | 'snowball';
    paymentMode: 'variable' | 'consistent';
    cashFloor: number;
    overrides: Record<string, Record<number, number>>;
    fundingAccountId?: string;
  },
  monthsAhead = 36,
): DebtPaymentTransaction[] {
  const cards = buildCardData(accounts, transactions, rules, debts);
  if (cards.length === 0) return [];

  const liquidTypes = ['checking', 'business_checking', 'cash'];
  const liquidCash = accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type))
    .reduce((s: number, a: any) => s + Number(a.balance), 0);

  const weeklyGross = Number(profile?.weekly_gross_income) || 1875;
  const taxRate = Number(profile?.tax_rate) || 22;
  const paycheckIncome = weeklyGross * (1 - taxRate / 100) * 4.33;
  const nonPaycheckIncome = rules
    .filter((r: any) =>
      r.active &&
      r.rule_type === 'income' &&
      !['paycheck', 'salary', 'wages', 'pay'].some((kw: string) => r.name?.toLowerCase().includes(kw))
    )
    .reduce((s: number, r: any) => {
      const amt = Number(r.amount);
      if (r.frequency === 'weekly') return s + amt * 4.33;
      if (r.frequency === 'biweekly') return s + amt * 2.167;
      if (r.frequency === 'yearly') return s + amt / 12;
      return s + amt;
    }, 0);
  const monthlyTakeHome = paycheckIncome + nonPaycheckIncome;

  const monthlyExpenses = calcCashOnlyMonthlyExpenses(rules, cards);

  const projections = getCardProjections(cards, liquidCash, options, monthlyTakeHome, monthlyExpenses, monthsAhead);

  const result: DebtPaymentTransaction[] = [];
  const now = new Date();

  // Use selected funding account or default checking
  const fundingAccountId = options.fundingAccountId;
  const checkingAccount = fundingAccountId
    ? accounts.find((a: any) => a.id === fundingAccountId)
    : accounts.find((a: any) => a.account_type === 'checking' && a.active);
  const defaultSource = checkingAccount ? `account:${checkingAccount.id}` : 'bank_account';

  for (const proj of projections) {
    for (let i = 0; i < proj.months.length; i++) {
      const row = proj.months[i];
      if (row.payment <= 0) continue;

      // Use the card's actual due day, falling back to 15
      const cardDueDay = proj.card.dueDay || 15;
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0).getDate();
      const effectiveDay = Math.min(cardDueDay, monthEnd);
      const d = new Date(now.getFullYear(), now.getMonth() + i, effectiveDay);
      const dateStr = d.toISOString().split('T')[0];
      const isAutopay = proj.card.autopayFullBalance || (row.startBalance <= 0 && i > 0);

      result.push({
        id: `debtpay:${proj.card.id}:${i}:${dateStr}`,
        date: dateStr,
        type: 'expense',
        amount: Math.round(row.payment * 100) / 100,
        category: 'Debt Payments',
        note: `${proj.card.name} Payment${isAutopay ? ' (Autopay)' : ''}`,
        payment_source: defaultSource,
        isGenerated: true,
        isDebtPayment: true,
        debtCardId: proj.card.id,
        debtCardName: proj.card.name,
        monthIndex: i,
      });
    }
  }

  return result.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/**
 * Build a per-month, per-card purchase map from non-generated future CC transactions.
 * Index m corresponds to simulation month m (0 = current month).
 * Month 0 uses 0 purchases — the live card balance already includes today's spending.
 */
function buildCardPurchasesPerMonth(
  cards: CardData[],
  transactions: any[],
  months: number,
): { [cardId: string]: number }[] {
  const now = new Date();
  const ccSources = new Map<string, string>(); // payment_source key → card id
  for (const c of cards) {
    ccSources.set(c.id, c.id);
    ccSources.set(`account:${c.id}`, c.id);
  }

  return Array.from({ length: months }, (_, i) => {
    if (i === 0) return {}; // month 0: live balance is ground truth
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const result: { [cardId: string]: number } = {};
    for (const t of transactions) {
      if ((t as any).isGenerated) continue;
      if (t.type !== 'expense') continue;
      if (!t.date?.startsWith(key)) continue;
      const cardId = t.payment_source ? ccSources.get(t.payment_source) : undefined;
      if (!cardId) continue;
      result[cardId] = (result[cardId] || 0) + Number(t.amount);
    }
    return result;
  });
}

function getCardProjections(
  cards: CardData[],
  liquidCash: number,
  options: {
    strategy: 'avalanche' | 'snowball';
    paymentMode: 'variable' | 'consistent';
    cashFloor: number;
    overrides: Record<string, Record<number, number>>;
  },
  monthlyTakeHome: number,
  monthlyExpenses: number,
  months: number,
  oneTimeByMonth?: { income: number; expenses: number }[],
  cardPurchasesPerMonth?: { [cardId: string]: number }[],
) {
  if (options.paymentMode === 'variable') {
    const sim = simulateVariablePayoff(
      cards, liquidCash, options.cashFloor, options.strategy,
      monthlyTakeHome, monthlyExpenses, months,
      undefined, undefined, cardPurchasesPerMonth, undefined, undefined,
      oneTimeByMonth,
    );
    return cards.map(c => {
      const cardOverrides = options.overrides[c.id] || {};
      const basePays = sim.monthlyPayments.get(c.id) || [];
      const payments = basePays.map((p, i) => cardOverrides[i] !== undefined ? cardOverrides[i] : p);
      return projectCardVariable(c, payments, months, true);
    });
  }
  return cards.map(c => {
    const cardOverrides = options.overrides[c.id] || {};
    if (Object.keys(cardOverrides).length > 0) {
      const payments = Array.from({ length: months }, (_, i) => cardOverrides[i] !== undefined ? cardOverrides[i] : c.targetPayment);
      return projectCardVariable(c, payments, months, true);
    }
    return projectCard(c, months);
  });
}

/**
 * Get debt payment amounts aggregated by month key (YYYY-MM) for forecast use.
 */
export function getDebtPaymentsByMonth(
  accounts: any[],
  transactions: any[],
  rules: any[],
  debts: any[],
  profile: any,
  options: {
    strategy: 'avalanche' | 'snowball';
    paymentMode: 'variable' | 'consistent';
    cashFloor: number;
    overrides: Record<string, Record<number, number>>;
  },
  months = 36,
): Record<string, number> {
  const cards = buildCardData(accounts, transactions, rules, debts);
  if (cards.length === 0) return {};

  const liquidTypes = ['checking', 'business_checking', 'cash'];
  const liquidCash = accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type))
    .reduce((s: number, a: any) => s + Number(a.balance), 0);
  const weeklyGross = Number(profile?.weekly_gross_income) || 1875;
  const taxRate = Number(profile?.tax_rate) || 22;
  const paycheckIncome = weeklyGross * (1 - taxRate / 100) * 4.33;
  const nonPaycheckIncome = rules
    .filter((r: any) =>
      r.active &&
      r.rule_type === 'income' &&
      !['paycheck', 'salary', 'wages', 'pay'].some((kw: string) => r.name?.toLowerCase().includes(kw))
    )
    .reduce((s: number, r: any) => {
      const amt = Number(r.amount);
      if (r.frequency === 'weekly') return s + amt * 4.33;
      if (r.frequency === 'biweekly') return s + amt * 2.167;
      if (r.frequency === 'yearly') return s + amt / 12;
      return s + amt;
    }, 0);
  const monthlyTakeHome = paycheckIncome + nonPaycheckIncome;
  const monthlyExpenses = calcCashOnlyMonthlyExpenses(rules, cards);

  // Build per-month one-time cash flows from non-generated transactions so the
  // debt engine knows to drop to minimum payments when a large expense is coming.
  const now = new Date();
  const oneTimeByMonth: { income: number; expenses: number }[] = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let income = 0, expenses = 0;
    for (const t of transactions) {
      if ((t as any).isGenerated) continue;
      if (!t.date?.startsWith(key)) continue;
      if (t.type === 'income') income += Number(t.amount);
      else expenses += Number(t.amount);
    }
    return { income, expenses };
  });

  const cardPurchasesPerMonth = buildCardPurchasesPerMonth(cards, transactions, months);
  const projections = getCardProjections(cards, liquidCash, options, monthlyTakeHome, monthlyExpenses, months, oneTimeByMonth, cardPurchasesPerMonth);
  const byMonth: Record<string, number> = {};

  for (const proj of projections) {
    for (let i = 0; i < proj.months.length; i++) {
      const row = proj.months[i];
      if (row.payment <= 0) continue;
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] || 0) + row.payment;
    }
  }

  return byMonth;
}

/**
 * Get per-card balance projections by month for forecast charts.
 */
export function getDebtBalancesByMonth(
  accounts: any[],
  transactions: any[],
  rules: any[],
  debts: any[],
  profile: any,
  options: {
    strategy: 'avalanche' | 'snowball';
    paymentMode: 'variable' | 'consistent';
    cashFloor: number;
    overrides: Record<string, Record<number, number>>;
  },
  months = 36,
): { monthKey: string; totalBalance: number; totalInterest: number }[] {
  const cards = buildCardData(accounts, transactions, rules, debts);
  if (cards.length === 0) return [];

  const liquidTypes = ['checking', 'business_checking', 'cash'];
  const liquidCash = accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type))
    .reduce((s: number, a: any) => s + Number(a.balance), 0);
  const weeklyGross = Number(profile?.weekly_gross_income) || 1875;
  const taxRate = Number(profile?.tax_rate) || 22;
  const paycheckIncome = weeklyGross * (1 - taxRate / 100) * 4.33;
  const nonPaycheckIncome = rules
    .filter((r: any) =>
      r.active &&
      r.rule_type === 'income' &&
      !['paycheck', 'salary', 'wages', 'pay'].some((kw: string) => r.name?.toLowerCase().includes(kw))
    )
    .reduce((s: number, r: any) => {
      const amt = Number(r.amount);
      if (r.frequency === 'weekly') return s + amt * 4.33;
      if (r.frequency === 'biweekly') return s + amt * 2.167;
      if (r.frequency === 'yearly') return s + amt / 12;
      return s + amt;
    }, 0);
  const monthlyTakeHome = paycheckIncome + nonPaycheckIncome;
  const monthlyExpenses = calcCashOnlyMonthlyExpenses(rules, cards);

  const now = new Date();
  const oneTimeByMonth: { income: number; expenses: number }[] = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let income = 0, expenses = 0;
    for (const t of transactions) {
      if ((t as any).isGenerated) continue;
      if (!t.date?.startsWith(key)) continue;
      if (t.type === 'income') income += Number(t.amount);
      else expenses += Number(t.amount);
    }
    return { income, expenses };
  });

  const cardPurchasesPerMonth = buildCardPurchasesPerMonth(cards, transactions, months);
  const projections = getCardProjections(cards, liquidCash, options, monthlyTakeHome, monthlyExpenses, months, oneTimeByMonth, cardPurchasesPerMonth);
  const result: { monthKey: string; totalBalance: number; totalInterest: number }[] = [];

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let totalBal = 0;
    let totalInt = 0;
    for (const proj of projections) {
      const row = proj.months[i];
      if (row) {
        totalBal += Math.max(0, row.endBalance);
        totalInt += row.interest;
      }
    }
    result.push({ monthKey: key, totalBalance: totalBal, totalInterest: totalInt });
  }

  return result;
}
