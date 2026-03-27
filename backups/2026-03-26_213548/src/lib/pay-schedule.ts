// ─── Unified Pay Schedule Engine ─────────────────────────
// Single source of truth for income calculations across all tabs

export type PayFrequency = 'weekly' | 'biweekly' | 'monthly';

export type PayScheduleConfig = {
  weeklyGross: number;
  taxRate: number;
  paycheckDay: number; // 0=Sun..6=Sat for weekly/biweekly, 1-31 for monthly
  frequency: PayFrequency;
};

export type PaycheckInfo = {
  date: Date;
  gross: number;
  net: number;
};

/** Get net (post-tax) amount per paycheck */
export function getPaycheckNet(config: PayScheduleConfig): number {
  const gross = getPaycheckGross(config);
  return gross * (1 - config.taxRate / 100);
}

/** Get gross amount per paycheck based on frequency */
export function getPaycheckGross(config: PayScheduleConfig): number {
  if (config.frequency === 'weekly') return config.weeklyGross;
  if (config.frequency === 'biweekly') return config.weeklyGross * 2;
  // monthly: weeklyGross * 52 / 12
  return config.weeklyGross * 52 / 12;
}

/** Get all paycheck dates within a given month */
export function getPaychecksInMonth(config: PayScheduleConfig, year: number, month: number): PaycheckInfo[] {
  const paychecks: PaycheckInfo[] = [];
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const gross = getPaycheckGross(config);
  const net = gross * (1 - config.taxRate / 100);

  if (config.frequency === 'monthly') {
    const day = Math.min(config.paycheckDay || 1, monthEnd.getDate());
    const d = new Date(year, month, day);
    paychecks.push({ date: d, gross, net });
  } else {
    // weekly or biweekly — find occurrences of paycheckDay (day of week) in the month
    const dayOfWeek = config.paycheckDay;
    const d = new Date(monthStart);
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
    const step = config.frequency === 'biweekly' ? 14 : 7;
    while (d <= monthEnd) {
      paychecks.push({ date: new Date(d), gross, net });
      d.setDate(d.getDate() + step);
    }
  }

  return paychecks;
}

/** Get remaining paychecks in the current month (from today onward) */
export function getRemainingPaychecksThisMonth(config: PayScheduleConfig): PaycheckInfo[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const all = getPaychecksInMonth(config, now.getFullYear(), now.getMonth());
  return all.filter(p => p.date >= today);
}

/** Get total remaining net income for the current month */
export function getRemainingIncomeThisMonth(config: PayScheduleConfig): number {
  return getRemainingPaychecksThisMonth(config).reduce((s, p) => s + p.net, 0);
}

/** Get total net income for a full month */
export function getMonthlyNetIncome(config: PayScheduleConfig): number {
  const now = new Date();
  const paychecks = getPaychecksInMonth(config, now.getFullYear(), now.getMonth());
  return paychecks.reduce((s, p) => s + p.net, 0);
}

/** Get total net income for a specific future month */
export function getMonthNetIncome(config: PayScheduleConfig, year: number, month: number): number {
  return getPaychecksInMonth(config, year, month).reduce((s, p) => s + p.net, 0);
}

/** Build config from profile data */
export function buildPayConfig(profile: any): PayScheduleConfig {
  return {
    weeklyGross: Number(profile?.weekly_gross_income) || 1875,
    taxRate: Number(profile?.tax_rate) || 22,
    paycheckDay: Number(profile?.paycheck_day) ?? 5,
    frequency: (profile?.paycheck_frequency as PayFrequency) || 'weekly',
  };
}

/** Get next paycheck date from today */
export function getNextPaycheckDate(config: PayScheduleConfig): Date {
  const remaining = getRemainingPaychecksThisMonth(config);
  if (remaining.length > 0) return remaining[0].date;
  // First paycheck of next month
  const now = new Date();
  const nextMonth = getPaychecksInMonth(config, now.getFullYear(), now.getMonth() + 1);
  return nextMonth[0]?.date || new Date();
}

/** Get remaining paycheck income from today through a specific day in the current month */
export function getRemainingIncomeByDay(config: PayScheduleConfig, dueDay: number = 31): number {
  const now = new Date();
  const today = now.getDate();
  const paychecks = getPaychecksInMonth(config, now.getFullYear(), now.getMonth());
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const effectiveDueDay = Math.min(dueDay, monthEnd);
  return paychecks
    .filter(p => p.date.getDate() >= today && p.date.getDate() <= effectiveDueDay)
    .reduce((s, p) => s + p.net, 0);
}

/**
 * Get remaining NON-PAYCHECK income from recurring rules before a specific day.
 * This captures: side jobs, recurring transfers IN, freelance income, etc.
 */
export function getRemainingNonPaycheckIncomeByDay(
  rules: any[], dueDay: number, fundingAccountId: string | null
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type !== 'income') continue;
    // Skip the primary paycheck income rule (handled by getRemainingIncomeByDay)
    // We include ALL income rules here — the paycheck config handles gross->net differently
    // but these are additional income sources
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    // If funding account specified, only count income deposited to that account
    if (fundingAccountId && r.deposit_account) {
      const dep = r.deposit_account.replace(/^account:/, '');
      if (dep && dep !== fundingAccountId) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getMonth() === month) {
        if (d.getDate() >= today && d.getDate() <= effectiveDueDay) total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd >= today && rd <= effectiveDueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd >= today && rd <= effectiveDueDay) total += amt;
      }
    }
  }
  return total;
}

/**
 * Get remaining one-time income transactions before a specific day in the current month.
 */
export function getRemainingOneTimeIncomeByDay(
  transactions: any[], dueDay: number = 31
): number {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  const monthEndStr = monthEnd.toISOString().split('T')[0];

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    if ((t as any).isGenerated) continue;
    if (!t.date || t.date < todayStr || t.date > monthEndStr) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= now.getDate() && txDay <= effectiveDueDay) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get remaining one-time expense transactions before a specific day in the current month.
 */
export function getRemainingOneTimeExpensesByDay(
  transactions: any[], dueDay: number = 31
): number {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  const monthEndStr = monthEnd.toISOString().split('T')[0];

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if ((t as any).isGenerated) continue;
    if (!t.date || t.date < todayStr || t.date > monthEndStr) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= now.getDate() && txDay <= effectiveDueDay) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get ALL remaining income from Transactions (both generated and manual) in the due-date window.
 * This is the SINGLE SOURCE OF TRUTH for income in debt-payoff calculations.
 * Includes: paychecks, non-paycheck income, one-time income, gifts, reimbursements.
 * Does NOT double-count with Budget Control rules.
 */
export function getRemainingTransactionIncomeByDay(
  transactions: any[], dueDay: number = 31
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= today && txDay <= effectiveDueDay) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get ALL remaining expenses from Transactions (both generated and manual) in the due-date window.
 * Single source of truth — avoids double-counting with Budget Control rules.
 * Can optionally exclude debt payment transactions (since those are what we're computing).
 */
export function getRemainingTransactionExpensesByDay(
  transactions: any[], dueDay: number = 31, excludeDebtPayments = false
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (excludeDebtPayments && t.category === 'Debt Payments') continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= today && txDay <= effectiveDueDay) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get ALL remaining income from Transactions for the rest of the current month.
 * Single source of truth for Budget Control Remaining Cash On Hand.
 */
export function getRemainingTransactionIncomeThisMonth(transactions: any[]): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= today) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get ALL remaining expenses from Transactions for the rest of the current month.
 * Single source of truth for Budget Control Remaining Cash On Hand.
 */
export function getRemainingTransactionExpensesThisMonth(transactions: any[], excludeDebtPayments = false): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (excludeDebtPayments && t.category === 'Debt Payments') continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= today) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get remaining debt payment transactions for the rest of the current month.
 */
export function getRemainingTransactionDebtPaymentsThisMonth(transactions: any[]): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense' || t.category !== 'Debt Payments') continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= today) {
      total += Number(t.amount);
    }
  }
  return total;
}

/** Get remaining expenses from today through a specific day in the current month */
export function getRemainingExpensesByDay(
  rules: any[], dueDay: number, fundingAccountId: string | null
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;
    if (fundingAccountId) {
      const src = (r.payment_source || '').replace(/^account:/, '');
      if (src && src !== fundingAccountId) continue;
    }
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getMonth() === month) {
        if (d.getDate() >= today && d.getDate() <= effectiveDueDay) total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd >= today && rd <= effectiveDueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd >= today && rd <= effectiveDueDay) total += amt;
      }
    }
  }
  return total;
}

/** Get first paycheck date in a specific month */
export function getFirstPaycheckInMonth(config: PayScheduleConfig, year: number, month: number): Date | null {
  const paychecks = getPaychecksInMonth(config, year, month);
  return paychecks.length > 0 ? paychecks[0].date : null;
}

/**
 * Get bills from a specific funding account that are due between the start of next month
 * and the first paycheck of that next month.
 * These must be reserved from the current month's ending cash.
 */
export function getPrePaycheckNextMonthBills(
  rules: any[],
  config: PayScheduleConfig,
  fundingAccountId: string | null,
  now = new Date(),
): { total: number; items: { name: string; amount: number; dueDay: number }[] } {
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const firstPaycheck = getFirstPaycheckInMonth(config, nextMonthStart.getFullYear(), nextMonthStart.getMonth());
  
  // If no paycheck found, reserve for entire month (conservative)
  const cutoffDate = firstPaycheck || nextMonthEnd;
  
  let total = 0;
  const items: { name: string; amount: number; dueDay: number }[] = [];
  
  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;
    
    // If a funding account is specified, only count bills from that account
    if (fundingAccountId) {
      const ruleSource = r.payment_source || '';
      const normalizedSource = ruleSource.startsWith('account:') ? ruleSource.slice(8) : ruleSource;
      // Include bills with no source (default to funding account) or matching funding account
      if (normalizedSource && normalizedSource !== fundingAccountId) continue;
    }
    
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > nextMonthEnd) continue;
    }
    
    const amt = Number(r.amount);
    
    if (r.frequency === 'weekly') {
      // Count weekly occurrences between month start and cutoff
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(nextMonthStart);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d < cutoffDate) {
        total += amt;
        items.push({ name: r.name, amount: amt, dueDay: d.getDate() });
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const dueDay = Math.min(r.due_day || 1, nextMonthEnd.getDate());
      const d = new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), dueDay);
      if (d >= nextMonthStart && d < cutoffDate) {
        total += amt;
        items.push({ name: r.name, amount: amt, dueDay });
      }
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === nextMonthStart.getMonth()) {
        const dueDay = Math.min(r.due_day || 1, nextMonthEnd.getDate());
        const d = new Date(nextMonthStart.getFullYear(), dueMonth, dueDay);
        if (d < cutoffDate) {
          total += amt;
          items.push({ name: r.name, amount: amt, dueDay });
        }
      }
    }
  }
  
  return { total, items };
}

/**
 * Calculate the minimum safe cash that must remain at month-end.
 * = max(cashFloor, prePaycheckNextMonthBills)
 */
export function getMinSafeCash(
  rules: any[],
  config: PayScheduleConfig,
  cashFloor: number,
  fundingAccountId: string | null,
  now = new Date(),
): number {
  const { total: prePaycheckBills } = getPrePaycheckNextMonthBills(rules, config, fundingAccountId, now);
  return Math.max(cashFloor, prePaycheckBills);
}

/** Get remaining scheduled expenses this month from today onward */
export function getRemainingExpensesThisMonth(rules: any[], accounts: any[], now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(today);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= monthEnd) { total += amt; d.setDate(d.getDate() + 7); }
    } else if (r.frequency === 'monthly') {
      const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
      const d = new Date(now.getFullYear(), now.getMonth(), dueDay);
      if (d >= today && d <= monthEnd) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === now.getMonth()) {
        const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
        const d = new Date(now.getFullYear(), dueMonth, dueDay);
        if (d >= today) total += amt;
      }
    }
  }
  return total;
}

/**
 * Get income received into a funding account before a specific day of month.
 * For weekly/biweekly, counts paychecks with date <= dueDay.
 * For monthly, paycheck on paycheckDay <= dueDay means it's available.
 */
export function getIncomeBeforeDay(config: PayScheduleConfig, year: number, month: number, dueDay: number): number {
  const paychecks = getPaychecksInMonth(config, year, month);
  return paychecks.filter(p => p.date.getDate() <= dueDay).reduce((s, p) => s + p.net, 0);
}

/**
 * Get expenses due from a funding account before a specific day of month (inclusive).
 */
export function getExpensesBeforeDay(rules: any[], year: number, month: number, dueDay: number, fundingAccountId: string | null): number {
  const monthEnd = new Date(year, month + 1, 0);
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;
    if (fundingAccountId) {
      const src = (r.payment_source || '').replace(/^account:/, '');
      if (src && src !== fundingAccountId) continue;
    }
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getDate() <= dueDay && d.getMonth() === month) {
        total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd <= dueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd <= dueDay) total += amt;
      }
    }
  }
  return total;
}

/**
 * Get non-paycheck income from rules before a specific day in a specific month (for future months).
 */
export function getNonPaycheckIncomeBeforeDay(
  rules: any[], year: number, month: number, dueDay: number, fundingAccountId: string | null
): number {
  const monthEnd = new Date(year, month + 1, 0);
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type !== 'income') continue;
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    if (fundingAccountId && r.deposit_account) {
      const dep = r.deposit_account.replace(/^account:/, '');
      if (dep && dep !== fundingAccountId) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getDate() <= dueDay && d.getMonth() === month) {
        total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd <= dueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd <= dueDay) total += amt;
      }
    }
  }
  return total;
}

/**
 * Calculate safe-to-pay for a card by its due date.
 * = funding balance + income before due date - expenses before due date - cash floor - other card mins due before this date
 */
export function getSafeToPayByDueDate(
  config: PayScheduleConfig,
  rules: any[],
  fundingBalance: number,
  cashFloor: number,
  fundingAccountId: string | null,
  dueDay: number,
  year: number,
  month: number,
): number {
  const incBefore = getIncomeBeforeDay(config, year, month, dueDay);
  const expBefore = getExpensesBeforeDay(rules, year, month, dueDay, fundingAccountId);
  return Math.max(0, fundingBalance + incBefore - expBefore - cashFloor);
}

/**
 * Generate current-month transactions from recurring rules.
 * This is the shared utility so all pages (Dashboard, Debt Payoff, Budget Control)
 * produce the same generated transaction set before merging with real DB transactions.
 */
export function generateCurrentMonthTransactionsFromRules(
  rules: any[],
  accounts: any[],
): any[] {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const generated: any[] = [];

  // Build account lookup for source normalization
  const accountMap: Record<string, any> = {};
  accounts.forEach((a: any) => { accountMap[a.id] = a; accountMap[`account:${a.id}`] = a; });

  const normalizeSource = (src: string | null) => {
    if (!src) return '';
    if (src.startsWith('account:')) return src;
    if (accountMap[src]) return `account:${src}`;
    return src;
  };

  rules.filter((r: any) => r.active).forEach((r: any) => {
    const rawSource = r.rule_type === 'income'
      ? (r.deposit_account || r.payment_source)
      : (r.payment_source || r.deposit_account);
    const source = normalizeSource(rawSource);

    if (r.start_date) {
      const startDate = new Date(r.start_date + 'T12:00:00');
      if (startDate > monthEnd) return;
    }

    const txType = r.rule_type === 'income' ? 'income' : 'expense';
    const txCategory = r.rule_type === 'income' ? 'Income' : r.category;

    if (r.frequency === 'weekly') {
      const d = new Date(monthStart);
      const dayOfWeek = r.due_day ?? 5;
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= monthEnd) {
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'biweekly') {
      const d = new Date(monthStart);
      const dayOfWeek = r.due_day ?? 5;
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= monthEnd) {
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
        d.setDate(d.getDate() + 14);
      }
    } else if (r.frequency === 'monthly') {
      const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
      const d = new Date(now.getFullYear(), now.getMonth(), dueDay);
      if (d >= monthStart && d <= monthEnd) {
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
      }
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === now.getMonth()) {
        const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
        const d = new Date(now.getFullYear(), dueMonth, dueDay);
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
      }
    }
  });

  return generated;
}

/**
 * Merge real DB transactions with generated recurring transactions for the current month.
 * Deduplicates by matching date + note + amount to avoid double-counting.
 */
export function mergeWithGeneratedTransactions(
  realTransactions: any[],
  rules: any[],
  accounts: any[],
): any[] {
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthReal = realTransactions.filter(t => t.date?.startsWith(monthStr));
  const generated = generateCurrentMonthTransactionsFromRules(rules, accounts);

  // Deduplicate: if a real transaction matches a generated one (same date + note + amount), skip generated
  const realSet = new Set(currentMonthReal.map(t => `${t.date}:${t.note}:${t.amount}`));
  const uniqueGenerated = generated.filter(g => !realSet.has(`${g.date}:${g.note}:${g.amount}`));

  // Include non-current-month real transactions + current month real + unique generated
  const nonCurrentMonth = realTransactions.filter(t => !t.date?.startsWith(monthStr));
  return [...nonCurrentMonth, ...currentMonthReal, ...uniqueGenerated];
}

/**
 * Create virtual debt payment transaction entries from recommendation results.
 * These are injected into the transaction stream so all current-month helpers see them.
 */
export function createDebtPaymentTransactions(
  recommendations: { cardId: string; cardName: string; payment: number; dueDay?: number | null }[],
  fundingAccountId: string | null,
): any[] {
  const now = new Date();
  const results: any[] = [];
  for (const rec of recommendations) {
    if (rec.payment <= 0) continue;
    const dueDay = rec.dueDay || 15;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const effectiveDay = Math.min(dueDay, monthEnd);
    const d = new Date(now.getFullYear(), now.getMonth(), effectiveDay);
    const dateStr = d.toISOString().split('T')[0];
    results.push({
      id: `debtpay:${rec.cardId}:${dateStr}`,
      date: dateStr,
      type: 'expense',
      amount: Math.round(rec.payment * 100) / 100,
      category: 'Debt Payments',
      note: `${rec.cardName} Payment`,
      payment_source: fundingAccountId ? `account:${fundingAccountId}` : 'bank_account',
      isGenerated: true,
      isDebtPayment: true,
    });
  }
  return results;
}

/**
 * Merge debt payment transactions into the base transaction stream.
 * Removes any previously injected debt payments, then adds new ones.
 * Real (user-entered) debt payment transactions are preserved.
 */
export function mergeDebtPaymentsIntoStream(
  baseTxns: any[],
  debtPaymentTxns: any[],
): any[] {
  const withoutInjected = baseTxns.filter(t => !(t as any).isDebtPayment);
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const realDebtNotes = new Set(
    withoutInjected
      .filter(t => t.category === 'Debt Payments' && t.date?.startsWith(monthStr) && !(t as any).isGenerated)
      .map(t => (t.note || '').toLowerCase())
  );
  const uniqueGenerated = debtPaymentTxns.filter(g => !realDebtNotes.has((g.note || '').toLowerCase()));
  return [...withoutInjected, ...uniqueGenerated];
}

/**
 * Get available cash for a linked account after remaining-month obligations.
 * Used by Savings Goals / Car Fund for linked-account "available after bills" display.
 * Formula: accountBalance + remainingIncome - remainingExpenses (including debt payments)
 * No cash floor subtracted — shows true available amount after all obligations.
 */
export function getAccountRemainingCashThisMonth(
  accountId: string,
  accountType: string,
  allTransactions: any[],
  accountBalance: number,
  _cashFloor?: number,
): number {
  const now = new Date();
  const today = now.getDate();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const acctKey = `account:${accountId}`;
  const isDefault = ['checking', 'business_checking', 'cash'].includes(accountType);
  let income = 0, expenses = 0;
  for (const t of allTransactions) {
    if (!t.date?.startsWith(monthStr)) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay < today) continue;
    const src = t.payment_source || '';
    const matchesAccount = src === accountId || src === acctKey;
    const isUnattributed = !src || src === 'bank_account';
    const isForThisAccount = matchesAccount || (isDefault && isUnattributed);
    if (!isForThisAccount) continue;
    if (t.type === 'income') income += Number(t.amount);
    else if (t.type === 'expense') expenses += Number(t.amount);
  }
  return accountBalance + income - expenses;
}
