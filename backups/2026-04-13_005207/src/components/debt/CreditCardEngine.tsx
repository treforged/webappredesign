import { useState, useMemo, useEffect } from 'react';
import { formatCurrency } from '@/lib/calculations';
import {
  buildCardData, projectCard, projectCardVariable, generateRecommendations,
  simulateVariablePayoff, CardData, CardProjection, RecommendationSummary, CC_DEFAULT_CATEGORIES,
} from '@/lib/credit-card-engine';
import {
  buildPayConfig, getPrePaycheckNextMonthBills,
  getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay,
  mergeWithGeneratedTransactions,
} from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import { ChevronDown, ChevronUp, CreditCard, AlertTriangle, TrendingDown, Info, Zap, Target, Edit2, Check, CheckCircle2, RotateCcw, Wallet, ShieldCheck, CalendarDays } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDebts, useAccounts, useProfile, useRecurringRules } from '@/hooks/useSupabaseData';
import { usePersistedState } from '@/hooks/usePersistedState';
import { toast } from 'sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/contexts/AuthContext';
import PremiumGate from '@/components/shared/PremiumGate';

type Props = {
  accounts: any[];
  transactions: any[];
  rules: any[];
  debts: any[];
  profile: any;
};

const STRATEGY_TIPS = {
  avalanche: 'Pays minimums on all cards, then sends extra money to the highest APR card first to reduce total interest fastest. Cash floor and bill reserves are always enforced.',
  snowball: 'Pays minimums on all cards, then sends extra money to the smallest balance first for faster wins and momentum. Cash floor and bill reserves are always enforced.',
};

const PAYMENT_MODE_TIPS = {
  variable: 'Adjusts payments dynamically month to month based on available cash to reduce interest faster.',
  consistent: 'Uses your chosen target payment amount each month for predictable budgeting.',
};

export default function CreditCardEngine({ accounts, transactions, rules, debts, profile }: Props) {
  const { update: updateDebt, add: addDebt } = useDebts();
  const { update: updateAccount } = useAccounts();
  const { update: updateProfile } = useProfile();
  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);
  const { isPremium } = useSubscription();
  const { isDemo } = useAuth();
  const [strategy, setStrategy] = usePersistedState<'avalanche' | 'snowball'>('tre:debt:strategy', 'avalanche');
  const [paymentMode, setPaymentMode] = usePersistedState<'variable' | 'consistent'>('tre:debt:paymentMode', 'variable');
  const [cashFloor, setCashFloorLocal] = useState(() => Number(profile?.cash_floor) ?? 500);
  useEffect(() => {
    if (profile?.cash_floor != null) setCashFloorLocal(Number(profile.cash_floor));
  }, [profile?.cash_floor]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [editingMin, setEditingMin] = useState<string | null>(null);
  const [editingDueDay, setEditingDueDay] = useState<string | null>(null);
  const [targetInput, setTargetInput] = useState('');
  const [minInput, setMinInput] = useState('');
  const [dueDayInput, setDueDayInput] = useState('');
  const [overrides, setOverrides] = useState<Record<string, Record<number, number>>>({});
  const [editingMonth, setEditingMonth] = useState<{ cardId: string; month: number } | null>(null);
  const [monthPayInput, setMonthPayInput] = useState('');

  // Auto-save cash floor to profile on change
  const cashFloorSaveTimer = useState<ReturnType<typeof setTimeout> | null>(null);
  const setCashFloor = (val: number) => {
    setCashFloorLocal(val);
    if (cashFloorSaveTimer[0]) clearTimeout(cashFloorSaveTimer[0]);
    cashFloorSaveTimer[0] = setTimeout(() => {
      updateProfile.mutate({ cash_floor: val } as any);
    }, 1000);
  };

  // Pay config
  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);

  // Merge real DB transactions with generated recurring transactions from rules
  // This is the SINGLE SOURCE OF TRUTH — all transaction-based helpers read from this
  const allTransactions = useMemo(() =>
    mergeWithGeneratedTransactions(transactions, rules, accounts),
    [transactions, rules, accounts],
  );

  // Funding account selection — exclude savings
  const liquidTypes = ['checking', 'business_checking', 'cash'];
  const liquidAccounts = useMemo(() => accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type)), [accounts]);
  const defaultFunding = useMemo(() => {
    const defaultId = (profile as any)?.default_deposit_account;
    if (defaultId) {
      const acct = liquidAccounts.find((a: any) => a.id === defaultId);
      if (acct) return acct.id;
    }
    const checking = liquidAccounts.find((a: any) => a.account_type === 'checking');
    return checking?.id || liquidAccounts[0]?.id || '';
  }, [liquidAccounts, profile]);
  const [fundingAccountId, setFundingAccountIdLocal] = usePersistedState<string>('tre:debt:fundingAccount', defaultFunding);
  const setFundingAccountId = (id: string) => {
    setFundingAccountIdLocal(id);
    updateProfile.mutate({ default_deposit_account: id } as any);
  };

  const liquidCash = liquidAccounts.reduce((s: number, a: any) => s + Number(a.balance), 0);
  const fundingAccount = liquidAccounts.find((a: any) => a.id === fundingAccountId);
  const fundingBalance = fundingAccount ? Number(fundingAccount.balance) : liquidCash;

  const monthlyTakeHome = useMemo(() => {
    const weeklyGross = Number(profile?.weekly_gross_income) || 1875;
    const taxRate = Number(profile?.tax_rate) || 22;
    const paycheckIncome = weeklyGross * (1 - taxRate / 100) * 4.33;
    const nonPaycheckIncome = rules
      .filter((r: any) =>
        r.active &&
        r.rule_type === 'income' &&
        !['paycheck', 'salary', 'wages', 'pay'].some(kw => r.name?.toLowerCase().includes(kw))
      )
      .reduce((s: number, r: any) => {
        const amt = Number(r.amount);
        if (r.frequency === 'weekly') return s + amt * 4.33;
        if (r.frequency === 'biweekly') return s + amt * 2.167;
        if (r.frequency === 'yearly') return s + amt / 12;
        return s + amt;
      }, 0);
    return paycheckIncome + nonPaycheckIncome;
  }, [profile, rules]);

  const cards: CardData[] = useMemo(() => buildCardData(accounts, transactions, rules, debts), [accounts, transactions, rules, debts]);

  const monthlyRecurringExpenses = useMemo(() => {
    // CC-tagged rules are tracked via cardPurchasesPerMonth in the engine (Step 2.5).
    // Including them here AND there would double-count, draining available cash
    // and causing UNSTABLE flags every month → no extra payments ever applied.
    const ccPaymentSources = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
    return rules.filter((r: any) => {
      if (!r.active || r.rule_type !== 'expense') return false;
      // Safety: if no CC accounts loaded yet, include all expenses (no CC data to filter on)
      if (ccPaymentSources.size === 0) return true;
      if (r.payment_source && ccPaymentSources.has(r.payment_source)) return false; // explicit CC
      if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false; // default-card CC
      if (pauseSavings && (r.category === 'Savings' || r.category === 'Investing')) return false;
      return true;
    }).reduce((s: number, r: any) => {
      const amt = Number(r.amount);
      if (r.frequency === 'weekly') return s + amt * 4.33;
      if (r.frequency === 'yearly') return s + amt / 12;
      return s + amt;
    }, 0);
  }, [rules, cards, accounts, pauseSavings]);

  // Pre-paycheck next-month bills
  const prePaycheckBills = useMemo(() => getPrePaycheckNextMonthBills(rules, payConfig, fundingAccountId || null), [rules, payConfig, fundingAccountId]);
  const recommendedSafeMinimum = useMemo(() => Math.max(cashFloor, prePaycheckBills.total), [cashFloor, prePaycheckBills.total]);

  // Use the earliest card due day as the default window for the top-level display
  const primaryDueDay = useMemo(() => {
    const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
    if (revolving.length === 0) return 31;
    // Use the earliest due day among revolving cards
    const dueDays = revolving.map(c => c.dueDay || 15);
    return Math.min(...dueDays);
  }, [cards]);

  // Computed income/expense breakdown for display — uses merged Transactions as single source of truth
  const cashBreakdown = useMemo(() => {
    const transactionIncome = getRemainingTransactionIncomeByDay(allTransactions, primaryDueDay);
    const transactionExpenses = getRemainingTransactionExpensesByDay(allTransactions, primaryDueDay, true);
    return { transactionIncome, transactionExpenses };
  }, [allTransactions, primaryDueDay]);

  // Estimated liquid cash: funding balance + transaction income through due date - transaction expenses through due date
  const estLiquidCash = useMemo(() => {
    const { transactionIncome, transactionExpenses } = cashBreakdown;
    return fundingBalance + transactionIncome - transactionExpenses;
  }, [fundingBalance, cashBreakdown]);

  // Estimated liquid cash per card by due date
  const cardEstimatedCash = useMemo(() => {
    const result: Record<string, number> = {};
    for (const card of cards) {
      const dueDay = card.dueDay || 15;
      const incByDue = getRemainingTransactionIncomeByDay(allTransactions, dueDay);
      const expByDue = getRemainingTransactionExpensesByDay(allTransactions, dueDay, true);
      result[card.id] = fundingBalance + incByDue - expByDue;
    }
    return result;
  }, [cards, fundingBalance, allTransactions]);

  // ── Event-based monthEvents + cardPurchasesPerMonth ──────────────────────────
  // Uses actual scheduled income/expense occurrences instead of flat scalars so
  // that month 0 only counts income from today forward (already-received income
  // is baked into the live checking balance and must not be double-counted).
  const { monthEvents, cardPurchasesPerMonth: ccPurchasesPerMonth } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const scheduledEvents = generateScheduledEvents(rules, accounts, 36);

    const liquidAccountIds = new Set<string>(
      accounts.filter((a: any) => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
        .map((a: any) => a.id),
    );

    const incomeToLiquidRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'income' &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).map((r: any) => r.id),
    );

    const ccPaymentSources = new Set<string>(cards.flatMap(c => [c.id, `account:${c.id}`]));
    const ccExplicitRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' && r.payment_source && ccPaymentSources.has(r.payment_source),
      ).map((r: any) => r.id),
    );
    const highestAprCardId = cards.length > 0 ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : '';
    const ccDefaultRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' && !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map((r: any) => r.id),
    );
    const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);

    const cardRuleIdMap = new Map<string, Set<string>>(
      cards.map(c => {
        const cKey = `account:${c.id}`;
        const ids = new Set<string>(
          rules.filter((r: any) =>
            r.active && r.rule_type === 'expense' &&
            (r.payment_source === c.id || r.payment_source === cKey),
          ).map((r: any) => r.id),
        );
        if (c.id === highestAprCardId) ccDefaultRuleIds.forEach(id => ids.add(id));
        return [c.id, ids];
      }),
    );

    const savingsRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' && (r.category === 'Savings' || r.category === 'Investing'),
      ).map((r: any) => r.id),
    );

    const evMonthEvents: { income: number; expenses: number }[] = [];
    const evCardPurchases: { [cardId: string]: number }[] = [];

    for (let i = 0; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const eventsInMonth = scheduledEvents.filter(e =>
        e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr),
      );

      const income = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
        .reduce((s, e) => s + e.amount, 0);

      const cashExpenses = eventsInMonth
        .filter(e =>
          e.type === 'expense' &&
          !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
          !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId)),
        )
        .reduce((s, e) => s + e.amount, 0);

      evMonthEvents.push({ income, expenses: cashExpenses });

      const cardPurchases: { [cardId: string]: number } = {};
      if (i > 0) {
        for (const card of cards) {
          const ruleIds = cardRuleIdMap.get(card.id) ?? new Set<string>();
          cardPurchases[card.id] = eventsInMonth
            .filter(e => e.type === 'expense' && e.ruleId && ruleIds.has(e.ruleId))
            .reduce((s, e) => s + e.amount, 0);
        }
      }
      evCardPurchases.push(cardPurchases);
    }

    return { monthEvents: evMonthEvents, cardPurchasesPerMonth: evCardPurchases };
  }, [rules, accounts, cards, pauseSavings]);

  const variableSim = useMemo(() => {
    // Derive month 0 remaining income/expenses from allTransactions (today → EOM).
    // allTransactions now contains only future-dated generated transactions (past
    // events are excluded by generateCurrentMonthTransactionsFromRules) plus all
    // real DB transactions. getRemainingTransactionIncomeByDay/ExpensesByDay then
    // filter to txDay >= today, giving the correct month 0 remaining values without
    // double-counting income already reflected in the live account balance.
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const todayStr = now.toISOString().split('T')[0];

    const month0Income = getRemainingTransactionIncomeByDay(allTransactions, 31);

    // Exclude CC-charged expenses from month0 — they're already in card.balance (monthlyNewPurchases).
    // Also exclude Debt Payments (what we're computing), Balance Adjustments, and any
    // future-month transactions (current month ONLY, today forward).
    const ccIds = new Set(
      accounts
        .filter((a: any) => a.account_type === 'credit_card' && a.active)
        .flatMap((a: any) => [a.id, `account:${a.id}`])
    );
    const month0Expenses = allTransactions
      .filter((t: any) => {
        if (t.type !== 'expense') return false;
        if (!t.date || !t.date.startsWith(monthStr)) return false; // current month only
        if (t.date < todayStr) return false; // today forward only
        if (t.category === 'Debt Payments') return false;
        if (t.category === 'Balance Adjustment') return false;
        if (t.payment_source && ccIds.has(t.payment_source)) return false;
        return true;
      })
      .reduce((s: number, t: any) => s + Number(t.amount), 0);

    // One-time (non-generated) transactions per future month — applied AFTER debt allocation
    // in simulateVariablePayoff so they don't cause look-ahead cash hoarding in prior months.
    // Month 0 is handled separately via month0Income/month0Expenses above.
    const oneTimeByMonth: { income: number; expenses: number }[] = [{ income: 0, expenses: 0 }];

    // Augment ccPurchasesPerMonth with one-time (non-generated) CC transactions per card.
    // ccPurchasesPerMonth from the outer useMemo only includes recurring rule events.
    // One-time future CC purchases (e.g. $410 Prime Visa in June) must be added here
    // so the simulation knows that month's purchases on that card.
    const augmentedCCPurchases: { [cardId: string]: number }[] = [{}]; // month 0 = empty

    for (let i = 1; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const txns = (allTransactions as any[]).filter((t: any) =>
        t.date && t.date.startsWith(mk) && !(t as any).isGenerated,
      );
      const inc = txns
        .filter((t: any) => t.type === 'income' && t.category !== 'Balance Adjustment')
        .reduce((s: number, t: any) => s + Number(t.amount), 0);
      const exp = txns
        .filter((t: any) => {
          if (t.type !== 'expense') return false;
          if (t.category === 'Debt Payments' || t.category === 'Balance Adjustment') return false;
          if (t.payment_source && ccIds.has(t.payment_source)) return false;
          return true;
        })
        .reduce((s: number, t: any) => s + Number(t.amount), 0);
      oneTimeByMonth.push({ income: inc, expenses: exp });

      // Build per-card one-time CC purchases for this month
      const baseMonth = ccPurchasesPerMonth[i] ?? {};
      const monthCCPurchases: { [cardId: string]: number } = { ...baseMonth };
      for (const card of cards) {
        const cKey = `account:${card.id}`;
        const oneTimePurchases = txns
          .filter((t: any) =>
            t.type === 'expense' &&
            (t.payment_source === card.id || t.payment_source === cKey),
          )
          .reduce((s: number, t: any) => s + Number(t.amount), 0);
        if (oneTimePurchases > 0) {
          monthCCPurchases[card.id] = (monthCCPurchases[card.id] || 0) + oneTimePurchases;
        }
      }
      augmentedCCPurchases.push(monthCCPurchases);
    }

    const sim = simulateVariablePayoff(
      cards, liquidCash, cashFloor, strategy,
      monthlyTakeHome, monthlyRecurringExpenses, 36,
      monthEvents, undefined, augmentedCCPurchases,
      month0Income, month0Expenses,
      oneTimeByMonth,
    );
    // Return augmentedCCPurchases alongside the sim so projections can use it
    // to pass per-month purchase amounts to projectCardVariable.
    return { ...sim, augmentedCCPurchases };
  }, [cards, liquidCash, cashFloor, strategy, monthlyTakeHome,
      monthlyRecurringExpenses, allTransactions, accounts, ccPurchasesPerMonth, monthEvents]);

  const recommendations: RecommendationSummary = useMemo(
    () => generateRecommendations(
      cards, liquidCash, cashFloor, strategy, monthlyTakeHome, monthlyRecurringExpenses,
      paymentMode, payConfig, rules, fundingAccountId, prePaycheckBills.total, fundingBalance,
      undefined, undefined, allTransactions, primaryDueDay,
    ),
    [cards, liquidCash, cashFloor, strategy, monthlyTakeHome, monthlyRecurringExpenses, paymentMode, payConfig, rules, fundingAccountId, prePaycheckBills.total, fundingBalance, allTransactions, primaryDueDay],
  );

  const projections: CardProjection[] = useMemo(() => {
    const baseProjs = cards.map(c => {
      const cardOverrides = overrides[c.id] || {};
      // Per-month purchases for this card from the augmented sim data.
      // Index matches projectCardVariable's purchasesPerMonth param: index 0 = month 1.
      const cardPurchases = variableSim.augmentedCCPurchases.map(
        (monthData: { [cardId: string]: number }) => monthData[c.id] ?? 0,
      );
      if (paymentMode === 'variable') {
        const basePays = variableSim.monthlyPayments.get(c.id) || [];
        const payments = basePays.map((p, i) => cardOverrides[i] !== undefined ? cardOverrides[i] : p);
        return projectCardVariable(c, payments, 36, true, cardPurchases);
      }
      if (Object.keys(cardOverrides).length > 0) {
        const payments = Array.from({ length: 36 }, (_, i) => cardOverrides[i] !== undefined ? cardOverrides[i] : c.targetPayment);
        return projectCardVariable(c, payments, 36, false, cardPurchases);
      }
      return projectCard(c, 36);
    });

    return baseProjs;
  }, [cards, paymentMode, variableSim, overrides]);

  const totalBalance = cards.reduce((s, c) => s + c.balance, 0);
  const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
  const overallUtil = totalLimit > 0 ? (totalBalance / totalLimit) * 100 : 0;

  const syncDebtAndAccount = (card: CardData, updates: { min_payment?: number; target_payment?: number }) => {
    const matchDebt = debts.find((d: any) => d.name.toLowerCase() === card.name.toLowerCase());
    if (matchDebt) {
      updateDebt.mutate({ id: matchDebt.id, ...updates });
    } else {
      addDebt.mutate({
        name: card.name, balance: card.balance, apr: card.apr,
        min_payment: updates.min_payment ?? card.minPayment,
        target_payment: updates.target_payment ?? card.targetPayment,
        credit_limit: card.creditLimit,
      });
    }
  };

  const handleSaveTarget = (card: CardData) => {
    const newTarget = parseFloat(targetInput);
    if (isNaN(newTarget) || newTarget < card.minPayment) {
      toast.error(`Target must be at least minimum payment (${formatCurrency(card.minPayment, false)})`);
      return;
    }
    syncDebtAndAccount(card, { target_payment: newTarget });
    setEditingTarget(null);
    toast.success(`Target payment for ${card.name} updated to ${formatCurrency(newTarget, false)}`);
  };

  const handleSaveMin = (card: CardData) => {
    const newMin = parseFloat(minInput);
    if (isNaN(newMin) || newMin <= 0) {
      toast.error('Minimum payment must be greater than 0');
      return;
    }
    syncDebtAndAccount(card, { min_payment: newMin });
    setEditingMin(null);
    toast.success(`Minimum payment for ${card.name} updated to ${formatCurrency(newMin, false)}`);
  };

  const handleSaveDueDay = (card: CardData) => {
    const day = parseInt(dueDayInput);
    if (isNaN(day) || day < 1 || day > 31) {
      toast.error('Due day must be between 1 and 31');
      return;
    }
    updateAccount.mutate({ id: card.id, payment_due_day: day } as any);
    setEditingDueDay(null);
    toast.success(`Due date for ${card.name} set to the ${day}${day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month`);
  };

  const handleOverrideMonth = (cardId: string, monthIdx: number) => {
    const val = parseFloat(monthPayInput);
    if (isNaN(val) || val < 0) {
      toast.error('Enter a valid payment amount');
      return;
    }
    setOverrides(prev => ({
      ...prev,
      [cardId]: { ...prev[cardId], [monthIdx]: val },
    }));
    setEditingMonth(null);
    toast.success('Payment override applied — future months recalculated');
  };

  const revertMonth = (cardId: string, monthIdx: number) => {
    setOverrides(prev => {
      const copy = { ...prev };
      if (copy[cardId]) {
        const { [monthIdx]: _, ...rest } = copy[cardId];
        copy[cardId] = rest;
        if (Object.keys(rest).length === 0) delete copy[cardId];
      }
      return copy;
    });
    toast.info('Reverted to recommended payment');
  };

  const revertAllForCard = (cardId: string) => {
    setOverrides(prev => {
      const copy = { ...prev };
      delete copy[cardId];
      return copy;
    });
    toast.info('All overrides reverted for this card');
  };

  // Reset & Recalculate: target ending cash ≈ recommended safe minimum
  const handleAutoAdjust = () => {
    const totalRecPay = recommendations.recommendations
      .filter(r => r.reason !== 'Autopay Full Balance')
      .reduce((s, r) => s + r.payment, 0);
    
    const currentEndingCash = liquidCash - totalRecPay;
    const surplus = currentEndingCash - recommendedSafeMinimum;
    
    if (surplus > 50) {
      toast.success(`Debt payments are safe. Ending cash ${formatCurrency(currentEndingCash, false)} is above minimum ${formatCurrency(recommendedSafeMinimum, false)}.`);
    } else if (surplus < -50) {
      const reduction = Math.abs(surplus);
      toast.warning(`Reduced debt payments by ${formatCurrency(reduction, false)} to meet safe minimum of ${formatCurrency(recommendedSafeMinimum, false)}.`);
    } else {
      toast.success(`Debt payments already aligned with safe minimum of ${formatCurrency(recommendedSafeMinimum, false)}.`);
    }
    
    setOverrides({});
  };

  if (cards.length === 0) {
    return (
      <div className="card-forged p-8 text-center">
        <CreditCard size={32} className="mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No credit card accounts found. Add credit card accounts to use the payoff engine.</p>
      </div>
    );
  }

  const bd = recommendations.breakdown;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 sm:space-y-5">
        {/* Reset & Recalculate Button */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={handleAutoAdjust}
            className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 text-[10px] sm:text-xs font-medium btn-press hover:bg-primary/20" style={{ borderRadius: 'var(--radius)' }}
          >
            <ShieldCheck size={12} /> Reset & Recalculate
          </button>
          <span className="text-[9px] sm:text-[10px] text-muted-foreground">Targets ending cash ≈ safe minimum ({formatCurrency(recommendedSafeMinimum, false)})</span>
        </div>

        <div className="card-forged p-3 sm:p-4">
          <h3 className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-2">
            <ShieldCheck size={12} className="text-primary" /> Recommended Cash Floor
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">User Cash Floor</p>
              <p className="text-xs sm:text-sm font-display font-bold text-foreground">{formatCurrency(cashFloor, false)}</p>
            </div>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Pre-Paycheck Bills</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs sm:text-sm font-display font-bold text-foreground cursor-help">{formatCurrency(prePaycheckBills.total, false)}</p>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                  <p className="font-semibold mb-1">Bills due before first paycheck next month:</p>
                  {prePaycheckBills.items.length > 0 ? prePaycheckBills.items.map((item, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span>{item.name} (day {item.dueDay})</span>
                      <span className="font-bold">{formatCurrency(item.amount, false)}</span>
                    </div>
                  )) : <p>No bills found before next paycheck</p>}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="p-2 sm:p-3 bg-primary/10 border border-primary/20 text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-primary uppercase">Safe Minimum</p>
              <p className="text-xs sm:text-sm font-display font-bold text-primary">{formatCurrency(recommendedSafeMinimum, false)}</p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          <div className="card-forged p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Total CC Balance</p>
            <p className="text-base sm:text-lg font-display font-bold text-destructive">{formatCurrency(totalBalance, false)}</p>
          </div>
          <div className="card-forged p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Total Limit</p>
            <p className="text-base sm:text-lg font-display font-bold text-foreground">{formatCurrency(totalLimit, false)}</p>
          </div>
          <div className="card-forged p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Utilization</p>
            <p className={`text-base sm:text-lg font-display font-bold ${overallUtil > 30 ? 'text-destructive' : overallUtil > 10 ? 'text-primary' : 'text-success'}`}>{overallUtil.toFixed(1)}%</p>
          </div>
          <div className="card-forged p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Monthly Interest</p>
            <p className="text-base sm:text-lg font-display font-bold text-destructive">{formatCurrency(projections.reduce((s, p) => s + p.projectedInterestThisMonth, 0), true)}</p>
          </div>
          <div className="card-forged p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Payoff ETA</p>
            <p className="text-base sm:text-lg font-display font-bold text-primary">
              {(() => {
                // Derive from the per-card projections (same sim as the card detail rows)
                // so this number is always consistent with the per-card "Payoff: X mo" display.
                const eta = Math.max(0, ...projections.map(p => p.payoffMonth ?? 0));
                return eta > 0 ? `${eta} mo` : 'Paid';
              })()}
            </p>
          </div>
        </div>

        {/* Strategy + Controls */}
        <div className="card-forged p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">Strategy:</span>
            {([
              { key: 'avalanche', label: 'Avalanche', icon: TrendingDown },
              { key: 'snowball', label: 'Snowball', icon: ChevronDown },
            ] as const).map(s => (
              <Tooltip key={s.key}>
                <TooltipTrigger asChild>
                  <button onClick={() => setStrategy(s.key)}
                    className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium border btn-press ${strategy === s.key ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
                    style={{ borderRadius: 'var(--radius)' }}>
                    <s.icon size={12} /> {s.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs">{STRATEGY_TIPS[s.key]}</TooltipContent>
              </Tooltip>
            ))}
            <span className="text-[9px] px-2 py-1 bg-success/10 text-success border border-success/20" style={{ borderRadius: 'var(--radius)' }}>
              Cash floor always enforced
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">Payment Mode:</span>
              {([
                { key: 'variable', label: 'Variable', icon: Zap },
                { key: 'consistent', label: 'Consistent', icon: Target },
              ] as const).map(m => (
                <Tooltip key={m.key}>
                  <TooltipTrigger asChild>
                    <button onClick={() => setPaymentMode(m.key)}
                      className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium border btn-press ${paymentMode === m.key ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
                      style={{ borderRadius: 'var(--radius)' }}>
                      <m.icon size={12} /> {m.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[260px] text-xs">{PAYMENT_MODE_TIPS[m.key]}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground uppercase">Cash Floor</label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span><Info size={11} className="text-muted-foreground cursor-help" /></span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-xs">
                  Never recommend payments that push liquid cash below this amount. Also reserves for early next-month bills.
                </TooltipContent>
              </Tooltip>
              <input type="number" value={cashFloor} onChange={e => setCashFloor(Number(e.target.value) || 0)}
                className="w-20 sm:w-24 bg-secondary border border-border px-2 py-1 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="100" min="0" />
            </div>
          </div>

          {/* Funding Account Selector */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 pt-2 border-t border-border/50">
            <Wallet size={13} className="text-primary shrink-0" />
            <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">Funding Account:</span>
            <select
              value={fundingAccountId}
              onChange={e => setFundingAccountId(e.target.value)}
              className="bg-secondary border border-border px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs text-foreground max-w-[200px] sm:max-w-none" style={{ borderRadius: 'var(--radius)' }}
            >
              {liquidAccounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name} ({formatCurrency(Number(a.balance), false)})</option>
              ))}
            </select>
            {fundingAccount && (
              <span className="text-[10px] text-muted-foreground">
                Balance: <span className="font-display font-bold text-foreground">{formatCurrency(fundingBalance, false)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Recommendation Panel */}
        <div className="card-forged p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-3 sm:mb-4 flex-wrap">
            <h3 className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recommended This Month</h3>
            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {recommendations.strategyLabel}
            </span>
            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 bg-muted/30 text-muted-foreground border border-border font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {paymentMode === 'variable' ? 'Variable' : 'Consistent'}
            </span>
          </div>

          {recommendations.cashWarning && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 px-3 py-2 mb-3 sm:mb-4 text-[10px] sm:text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>Estimated liquid cash is below the safe minimum ({formatCurrency(recommendedSafeMinimum, false)}). Not all minimums can be covered. Review cash flow urgently.</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-3 sm:mb-4">
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Est. Liquid Cash</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs sm:text-sm font-display font-bold text-foreground cursor-help">{formatCurrency(estLiquidCash, false)}</p>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                 <p className="font-semibold mb-1">Cash available from today through card due date ({primaryDueDay}{primaryDueDay === 1 ? 'st' : primaryDueDay === 2 ? 'nd' : primaryDueDay === 3 ? 'rd' : 'th'})</p>
                  <div className="space-y-0.5">
                    <div className="flex justify-between gap-3"><span>Funding Balance (now)</span><span className="font-bold">{formatCurrency(bd.fundingBalance, false)}</span></div>
                    <div className="flex justify-between gap-3"><span>+ Income from Transactions (today→due)</span><span className="font-bold">{formatCurrency(bd.remainingPaycheckIncome, false)}</span></div>
                    <div className="flex justify-between gap-3"><span>− Expenses from Transactions (today→due)</span><span className="font-bold">{formatCurrency(bd.remainingExpenses, false)}</span></div>
                    <hr className="my-1 border-border/50" />
                    <div className="flex justify-between gap-3 font-bold"><span>= Est. Liquid Cash</span><span>{formatCurrency(estLiquidCash, false)}</span></div>
                  </div>
                  <p className="text-muted-foreground mt-2">Uses only the funding balance plus income transactions already scheduled/recorded in Transactions between today and the card due date. Income is not counted from Budget Control separately.</p>
                  {cards.filter(c => !c.autopayFullBalance && c.balance > 0).map(c => (
                    <div key={c.id} className="flex justify-between gap-2 mt-1">
                      <span>{c.name} (due {c.dueDay || 15}th)</span>
                      <span className="font-bold">{formatCurrency(cardEstimatedCash[c.id] || 0, false)}</span>
                    </div>
                  ))}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Safe Minimum</p>
              <p className="text-xs sm:text-sm font-display font-bold text-foreground">{formatCurrency(recommendedSafeMinimum, false)}</p>
            </div>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Safe to Pay</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs sm:text-sm font-display font-bold text-primary cursor-help">{formatCurrency(recommendations.totalAvailableCash, false)}</p>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                  <p className="font-semibold mb-1">Safe to Pay (today → due date {primaryDueDay}th):</p>
                  <div className="space-y-0.5">
                    <div className="flex justify-between gap-3"><span>Funding Balance (now)</span><span>{formatCurrency(bd.fundingBalance, false)}</span></div>
                    <div className="flex justify-between gap-3"><span>+ Income from Transactions (today→due)</span><span>{formatCurrency(bd.remainingPaycheckIncome, false)}</span></div>
                    <div className="flex justify-between gap-3"><span>− Expenses from Transactions (today→due)</span><span>{formatCurrency(bd.remainingExpenses, false)}</span></div>
                    <div className="flex justify-between gap-3"><span>− Safe Minimum</span><span>{formatCurrency(bd.safeMinimum, false)}</span></div>
                    {bd.autopayTotal > 0 && <div className="flex justify-between gap-3"><span>− Autopay Cards</span><span>{formatCurrency(bd.autopayTotal, false)}</span></div>}
                    <hr className="my-1 border-border/50" />
                    <div className="flex justify-between gap-3 font-bold"><span>= Safe to Pay</span><span className="text-primary">{formatCurrency(recommendations.totalAvailableCash, false)}</span></div>
                  </div>
                  <p className="text-muted-foreground mt-2">Uses only Transactions as the single source of truth. Income is not double-counted from Budget Control rules. Savings excluded.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Minimums Due</p>
              <p className="text-xs sm:text-sm font-display font-bold text-destructive">{formatCurrency(recommendations.totalMinimumsdue, false)}</p>
            </div>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Interest Avoided</p>
              <p className="text-xs sm:text-sm font-display font-bold text-primary">{formatCurrency(recommendations.interestAvoided, true)}</p>
            </div>
          </div>

          <div className="space-y-2">
            {recommendations.recommendations.map(r => (
              <div key={r.cardId} className="flex items-center justify-between py-2 px-2 sm:px-3 border border-border bg-muted/10 flex-wrap gap-1" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                  <span className="text-[10px] sm:text-xs font-medium">{r.cardName}</span>
                  {r.reason === 'Autopay Full Balance' ? (
                    <span className="text-[9px] sm:text-[10px] text-success bg-success/10 px-1.5 py-0.5 flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                      <CheckCircle2 size={9} /> autopay
                    </span>
                  ) : r.isMinimumOnly ? (
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>min</span>
                  ) : (
                    <span className="text-[9px] sm:text-[10px] text-primary bg-primary/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>priority</span>
                  )}
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground italic truncate">{r.reason}</span>
                  {r.dueDay && (
                    <span className="text-[9px] text-muted-foreground flex items-center gap-0.5"><CalendarDays size={8} /> Due {r.dueDay}th</span>
                  )}
                </div>
                <span className="text-xs sm:text-sm font-display font-bold text-primary shrink-0">{formatCurrency(r.payment, false)}</span>
              </div>
            ))}
          </div>

          {recommendations.utilizationMilestones.length > 0 && (
            <div className="mt-3 sm:mt-4 flex flex-wrap gap-2 sm:gap-3">
              {recommendations.utilizationMilestones.map(m => (
                <span key={m.threshold} className="text-[9px] sm:text-[10px] px-2 py-1 bg-muted/30 border border-border text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>
                  Below {m.threshold}% util: {m.month !== null ? `~${m.month} months` : 'N/A'}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Individual Card Projections */}
        <div className="space-y-3">
          {projections.map(proj => {
            const isExpanded = expandedCard === proj.card.id;
            const isEditingThisMin = editingMin === proj.card.id;
            const cardOverrides = overrides[proj.card.id] || {};
            const hasOverrides = Object.keys(cardOverrides).length > 0;

            return (
              <div key={proj.card.id} className="card-forged overflow-hidden">
                <button onClick={() => setExpandedCard(isExpanded ? null : proj.card.id)}
                  className="w-full p-3 sm:p-4 flex items-start justify-between text-left hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <span className="w-3 sm:w-4 h-3 sm:h-4 rounded-sm shrink-0" style={{ backgroundColor: proj.card.color }} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <h4 className="text-xs sm:text-sm font-semibold">{proj.card.name}</h4>
                        {proj.card.autopayFullBalance && (
                          <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-success/15 text-success border border-success/30 font-medium flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                            <CheckCircle2 size={9} /> Autopay
                          </span>
                        )}
                        {hasOverrides && (
                          <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium" style={{ borderRadius: 'var(--radius)' }}>
                            overrides
                          </span>
                        )}
                      </div>
                      <p className="text-[9px] sm:text-[10px] text-muted-foreground">
                        {proj.card.apr}% APR · Limit {formatCurrency(proj.card.creditLimit, false)} · Util {proj.utilizationNow.toFixed(1)}%
                        {proj.card.dueDay && <span> · <CalendarDays size={9} className="inline" /> Due {proj.card.dueDay}{proj.card.dueDay === 1 ? 'st' : proj.card.dueDay === 2 ? 'nd' : proj.card.dueDay === 3 ? 'rd' : 'th'}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    <div className="text-right">
                      <p className={`text-sm sm:text-lg font-display font-bold ${proj.card.autopayFullBalance ? 'text-success' : 'text-destructive'}`}>
                        {proj.card.autopayFullBalance ? '$0.00' : formatCurrency(proj.card.balance, false)}
                      </p>
                      <p className="text-[9px] sm:text-[10px] text-muted-foreground">
                        {proj.card.autopayFullBalance
                          ? 'Debt free'
                          : `Payoff: ${proj.payoffMonth ? `${proj.payoffMonth} mo` : 'N/A'} · Int: ${formatCurrency(proj.totalInterest, false)}`
                        }
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </div>
                </button>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 px-3 sm:px-4 pb-3 text-center">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Min Payment</p>
                    {isEditingThisMin ? (
                      <div className="flex items-center gap-1 justify-center" onClick={e => e.stopPropagation()}>
                        <input type="number" value={minInput} onChange={e => setMinInput(e.target.value)}
                          className="w-16 bg-secondary border border-primary px-1 py-0.5 text-xs text-foreground font-semibold text-center"
                          style={{ borderRadius: 'var(--radius)' }} autoFocus min={1} step="5"
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveMin(proj.card); if (e.key === 'Escape') setEditingMin(null); }} />
                        <button onClick={(e) => { e.stopPropagation(); handleSaveMin(proj.card); }} className="text-primary hover:text-primary/80"><Check size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-center">
                        <p className="text-xs font-semibold">{formatCurrency(proj.card.minPayment, false)}</p>
                        <button onClick={(e) => { e.stopPropagation(); setEditingMin(proj.card.id); setMinInput(String(proj.card.minPayment)); }} className="text-muted-foreground hover:text-primary"><Edit2 size={10} /></button>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Due Date</p>
                    {editingDueDay === proj.card.id ? (
                      <div className="flex items-center gap-1 justify-center" onClick={e => e.stopPropagation()}>
                        <input type="number" value={dueDayInput} onChange={e => setDueDayInput(e.target.value)}
                          className="w-12 bg-secondary border border-primary px-1 py-0.5 text-xs text-foreground font-semibold text-center"
                          style={{ borderRadius: 'var(--radius)' }} autoFocus min={1} max={31} step="1"
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveDueDay(proj.card); if (e.key === 'Escape') setEditingDueDay(null); }} />
                        <button onClick={(e) => { e.stopPropagation(); handleSaveDueDay(proj.card); }} className="text-primary hover:text-primary/80"><Check size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-center">
                        <p className="text-xs font-semibold">{proj.card.dueDay ? `${proj.card.dueDay}th` : '—'}</p>
                        <button onClick={(e) => { e.stopPropagation(); setEditingDueDay(proj.card.id); setDueDayInput(String(proj.card.dueDay || 15)); }} className="text-muted-foreground hover:text-primary"><Edit2 size={10} /></button>
                      </div>
                    )}
                  </div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Purchases/Mo</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.card.monthlyNewPurchases, false)}</p></div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Interest/Mo</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.projectedInterestThisMonth, true)}</p></div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Total Interest</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.totalInterest, false)}</p></div>
                </div>

                <div className="px-3 sm:px-4 pb-3">
                  <div className="w-full h-2 bg-muted/50 overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                    <div className={`h-full transition-all ${proj.card.autopayFullBalance ? 'bg-success' : proj.utilizationNow > 30 ? 'bg-destructive' : proj.utilizationNow > 10 ? 'bg-primary' : 'bg-success'}`}
                      style={{ width: `${proj.card.autopayFullBalance ? 100 : Math.min(100, proj.utilizationNow)}%` }} />
                  </div>
                </div>

                {isExpanded && (
                  <PremiumGate
                    isPremium={isPremium || isDemo}
                    title="Month-by-month payoff plan"
                    features={[
                      `Exact recommended payment each month for ${proj.card.name}`,
                      proj.payoffMonth
                        ? `Paid off in ${proj.payoffMonth} month${proj.payoffMonth === 1 ? '' : 's'} — see every step`
                        : 'See your full projected payoff timeline',
                      `Save ${formatCurrency(proj.totalInterest, false)} in total interest`,
                      'Override any month\'s payment and watch balances update live',
                    ]}
                    className="border-t border-border"
                  >
                  <div className="px-3 sm:px-4 py-3">
                    {proj.card.autopayFullBalance && (
                      <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-success/10 border border-success/20 text-[10px] sm:text-xs text-success" style={{ borderRadius: 'var(--radius)' }}>
                        <CheckCircle2 size={14} className="shrink-0" />
                        <span>This card is debt-free. All monthly purchases ({formatCurrency(proj.card.monthlyNewPurchases, false)}) are paid in full automatically.</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                      <h5 className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        Monthly Projection ({paymentMode === 'variable' ? 'Variable' : 'Consistent'})
                      </h5>
                      {hasOverrides && (
                        <button onClick={() => revertAllForCard(proj.card.id)} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                          <RotateCcw size={10} /> Revert All
                        </button>
                      )}
                    </div>
                    <div className="overflow-x-auto -mx-3 sm:mx-0">
                      <table className="w-full text-[10px] sm:text-[11px] min-w-[500px]">
                        <thead>
                          <tr className="border-b border-border">
                            {['Month', 'Start', 'Purch.', 'Interest', 'Payment', 'End Bal', 'Util', ''].map(h => (
                              <th key={h} className="py-2 px-1.5 sm:px-2 text-left text-muted-foreground uppercase tracking-wider font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {proj.months.slice(0, 24).map((row, idx) => {
                            const isOverridden = cardOverrides[idx] !== undefined;
                            const isEditingThis = editingMonth?.cardId === proj.card.id && editingMonth?.month === idx;
                            return (
                              <tr key={row.month} className={`border-b border-border/30 hover:bg-muted/10 ${isOverridden ? 'bg-primary/5' : ''}`}>
                                <td className="py-1.5 px-1.5 sm:px-2 font-medium">{row.label}</td>
                                <td className="py-1.5 px-1.5 sm:px-2">{formatCurrency(row.startBalance, false)}</td>
                                <td className="py-1.5 px-1.5 sm:px-2 text-destructive">{row.newPurchases > 0 ? `+${formatCurrency(row.newPurchases, false)}` : '—'}</td>
                                <td className="py-1.5 px-1.5 sm:px-2 text-destructive">{row.interest > 0 ? `+${formatCurrency(row.interest, true)}` : '—'}</td>
                                <td className="py-1.5 px-1.5 sm:px-2">
                                  {isEditingThis ? (
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                      <input type="number" value={monthPayInput} onChange={e => setMonthPayInput(e.target.value)}
                                        className="w-16 bg-secondary border border-primary px-1 py-0.5 text-xs text-foreground font-semibold text-center"
                                        style={{ borderRadius: 'var(--radius)' }} autoFocus min={0} step="10"
                                        onKeyDown={e => { if (e.key === 'Enter') handleOverrideMonth(proj.card.id, idx); if (e.key === 'Escape') setEditingMonth(null); }} />
                                      <button onClick={() => handleOverrideMonth(proj.card.id, idx)} className="text-primary"><Check size={10} /></button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <span className="font-semibold text-primary">
                                        {row.payment > 0 ? `-${formatCurrency(row.payment, false)}` : '—'}
                                      </span>
                                      {isOverridden && <span className="text-[8px] text-primary bg-primary/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>edited</span>}
                                      {!proj.card.autopayFullBalance && row.startBalance > 0 && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setEditingMonth({ cardId: proj.card.id, month: idx }); setMonthPayInput(String(Math.round(row.payment))); }}
                                          className="text-muted-foreground hover:text-primary ml-1">
                                          <Edit2 size={9} />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="py-1.5 px-1.5 sm:px-2 font-semibold">{formatCurrency(Math.max(0, row.endBalance), false)}</td>
                                <td className={`py-1.5 px-1.5 sm:px-2 ${row.utilization > 30 ? 'text-destructive' : row.utilization > 10 ? 'text-primary' : 'text-success'}`}>{row.utilization.toFixed(1)}%</td>
                                <td className="py-1.5 px-1">
                                  {isOverridden && (
                                    <button onClick={() => revertMonth(proj.card.id, idx)} className="text-muted-foreground hover:text-primary" title="Revert">
                                      <RotateCcw size={10} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  </PremiumGate>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
