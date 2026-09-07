import { useState, useMemo, useEffect, useRef } from 'react';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import {
  buildCardData, projectCard, projectCardVariable, m0MinDueSettled,
  simulateVariablePayoff, CardData, CardProjection, CC_DEFAULT_CATEGORIES, PROJECTION_MONTHS,
  openCreditLimitAtMonth, getPlanInterestNextMonth,
} from '@/lib/credit-card-engine';
import { getStrategyPayoffOrder, getUnratedPayoffCards, payoffOrderAsOf } from '@/lib/debt-payoff-order';
import { cardStartMonthOffset, isSimCardOpenAsOf } from '@/lib/card-start-date';
import UtilizationPanel from './UtilizationPanel';
import DebtHero from './DebtHero';
import AvalancheOrderList from './AvalancheOrderList';
import { assetAccountIdsOf, otherAssetSourceId } from '@/lib/other-account-cash';
import CardRateLine from './CardRateLine';
import {
  buildPayConfig, getNormalizedMonthNetIncome, getPrePaycheckNextMonthBills, getMinSafeCash,
  getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay,
  getRemainingTransactionIncomeItemsByDay, getRemainingTransactionExpenseItemsByDay,
  mergeWithGeneratedTransactions, generateMonthTransactionsFromRules,
  type TransactionLineItem,
} from '@/lib/pay-schedule';
import { generateScheduledEvents, countWeekdayInMonth, countRuleOccurrencesInMonth, getCalendarYearMonthRange, getCalendarYearLabel } from '@/lib/scheduling';
import { getTotalCarLoanMonthly } from '@/lib/vehicle-loan-engine';
import { cumulativeSurplusesByCard, adjustedDisplayBalance } from '@/lib/step3-display';
import { ordinal } from '@/lib/ordinal';
import { formatNextDue, NEXT_PAYMENT_UNKNOWN, NEXT_DUE_UNKNOWN } from '@/lib/next-card-payment';
import { type Month0Result } from '@/hooks/useCardProjection';
import { buildCardRecRows, buildLoanRecommendations, buildOtherDebtRecommendations } from '@/lib/month0-debt-breakdown';
import { linkedLoanAccountIds } from '@/lib/vehicle-loan-link';
import type { LiabilityDebtInput } from '@/lib/non-cc-liabilities';
import { type PaymentPlan, getPaymentDates, deriveUpfrontPlanFields } from '@/lib/payment-plan-generator';
import { ChevronDown, ChevronUp, CreditCard, AlertTriangle, TrendingDown, Info, Zap, Target, Edit2, Check, CheckCircle2, RotateCcw, Wallet, ShieldCheck, CalendarDays, X, Car, Landmark } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDebts, useAccounts, useProfile, useRecurringRules, type AccountRow, type RuleRow, type DebtRow } from '@/hooks/useSupabaseData';
import { useMatchedOccurrences } from '@/hooks/useMatchedOccurrences';
import type { EnrichedTransaction } from '@/lib/pay-schedule';
import type { CarFund } from '@/lib/types';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { usePersistedState } from '@/hooks/usePersistedState';
import { toast } from 'sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import PremiumGate from '@/components/shared/PremiumGate';
import { FUNDING_ACCOUNT_TYPES, resolveFundingAccountId } from '@/lib/funding-account';
import { resolveSyncCutoffDate } from '@/lib/sync-cutoff';
import { buildGoalTransferCutoffs, buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';

import type { Tables } from '@/integrations/supabase/types';
import { displayedManualCashFloor, isManualCashFloor } from '@/lib/cash-floor';
import { automaticFloorComponents } from '@/lib/auto-cash-floor';
import { toLocalDateStr } from '@/lib/scheduling';
import { buildCashFloorWarning } from '@/lib/cash-floor-warning';
import { selectPointOnTouch } from '@/lib/chart-touch';

const LIQUID_ACCOUNT_TYPES = FUNDING_ACCOUNT_TYPES;

type Props = {
  accounts: AccountRow[];
  transactions: EnrichedTransaction[];
  rules: RuleRow[];
  debts: DebtRow[];
  profile: Partial<Tables<'profiles'>>;
  goals: Partial<Tables<'savings_goals'>>[];
  carFunds: CarFund[];
  incomeGrowthEnabled?: boolean;
  incomeGrowth?: number;
  raiseMonth?: number;
  raiseMode?: 'pct' | 'flat';
  bonusEnabled?: boolean;
  bonusAmount?: number;
  bonusMode?: 'flat' | 'pct';
  bonusMonth?: number;
  bonusRecurring?: boolean;
  taxReturnEnabled?: boolean;
  taxReturnAmountOverride?: number;
  taxReturnMonth?: number;
  /** Pass-3 simulation result — drives all month 0 recommendation display (payments, safe-to-pay, floor). */
  month0?: Month0Result | null;
  /** Full PROJECTION_MONTHS-length payment arrays from useCardProjection — when provided, projections use Forecast's sim instead of the internal variableSim. */
  perCardPayments?: { id: string; payments: number[] }[] | null;
  /** Cash-floor-constrained version of perCardPayments (pass-3 scaled). Preferred over perCardPayments when provided. */
  perCardPaymentsScaled?: { id: string; payments: number[]; surpluses?: number[] }[] | null;
  /** Sim revolving balances from useCardProjection — passed to projectCardVariable to fix cycling detection for statement cards. */
  monthlyRevolvingBalances?: Map<string, number[]> | null;
  /** True amount owed per cycling billing cycle (principal + carried interest) from
   * useCardProjection's sim — preferred over the internal variableSim's own copy so the
   * accordion's Start/End/interest figures come from the SAME simulation as perCardPaymentsScaled,
   * instead of disagreeing with it. */
  monthlyCyclingOwed?: Map<string, number[]> | null;
  /** Interest charged on a cycling card's carried-forward unpaid balance, from useCardProjection's sim. */
  monthlyCyclingInterest?: Map<string, number[]> | null;
  /** True end-of-month balance per month from useCardProjection's sim (the engine's actual
   * cascade output) — preferred over the internal variableSim's own copy so a revolving card's
   * Start/End/interest figures always reconcile to the same simulation that decided the
   * payment, instead of projectCardVariable's own simplified flat-APR balance walk drifting
   * from it over several months. */
  monthlyBalances?: Map<string, number[]> | null;
  /** Interest actually charged on a revolving (non-cycling) card's starting balance each month,
   * from useCardProjection's sim (Step 3's real calc). Used directly instead of back-solving
   * interest from the displayed payment, which may be a cash-floor-scaled amount (PASS-3) that
   * differs from the payment that actually produced monthlyBalances — back-solving against a
   * mismatched payment can produce a nonsensical (often deeply negative) interest figure. */
  monthlyInterest?: Map<string, number[]> | null;
  /** Payment plans with CC payment_source — charges are injected into per-month CC purchases so the accordion reflects installment spending. */
  paymentPlans?: PaymentPlan[];
  /** Forecast-aligned revolving payoff month (1-indexed) from useCardProjection's pass-3
   * simulation — when provided, replaces the simulation-only PAYOFF ETA so the Debt Payoff tab
   * matches the Forecast's CC Debt Free milestone. Null if not yet paid within PROJECTION_MONTHS. */
  forecastRevolvingPayoffMonth?: number | null;
  /** SIM-based revolving payoff month (1-indexed) — first month activeSim's total revolving
   * balance hits $0. Aligns PAYOFF ETA with when "full" pref cards (e.g. Discover) are truly
   * at $0, matching the Forecast's CC Debt Free milestone condition (ccEngRevBalEnd <= 0). */
  simRevolvingPayoffMonth?: number | null;
  /** From CardProjectionContext via the parent page — passed as a prop (not read via its own
   * usePersistedState here) so toggling the switch on DebtPayoff.tsx updates this component's own
   * calculations immediately, instead of only after the Cards tab unmounts/remounts. */
  pauseSavings: boolean;
};

const STRATEGY_TIPS = {
  avalanche: 'Pays minimums on all cards, then sends extra money to the highest APR card first to reduce total interest fastest. Cash floor and bill reserves are always enforced.',
  snowball: 'Pays minimums on all cards, then sends extra money to the smallest balance first for faster wins and momentum. Cash floor and bill reserves are always enforced.',
};

const PAYMENT_MODE_TIPS = {
  variable: 'Adjusts payments dynamically month to month based on available cash to reduce interest faster.',
  consistent: 'Uses your chosen target payment amount each month for predictable budgeting.',
};

export default function CreditCardEngine({ accounts, transactions, rules, debts, profile, goals, carFunds, incomeGrowthEnabled, incomeGrowth, raiseMonth, raiseMode, bonusEnabled, bonusAmount, bonusMode, bonusMonth, bonusRecurring, taxReturnEnabled, taxReturnAmountOverride, taxReturnMonth, month0, perCardPayments, perCardPaymentsScaled, monthlyRevolvingBalances, monthlyCyclingOwed, monthlyCyclingInterest, monthlyBalances, monthlyInterest, paymentPlans, forecastRevolvingPayoffMonth, simRevolvingPayoffMonth, pauseSavings }: Props) {
  const { update: updateDebt, add: addDebt } = useDebts();
  const { forecastInputsBundle, debtCashConverged, cardProjection: convergedCardProjection, projections: convergedProjections } = useCardProjectionContext();
  const { update: updateAccount } = useAccounts();
  const { update: updateProfile } = useProfile();
  const { items: plaidItems } = usePlaidItems();
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  // §1B — occurrences a real payment has already answered: the ones the user confirmed AND the ones
  // the bank proves on its own. This ran on the confirmed half only, so a bill `useCardProjection`
  // had already captured was still charged against this panel's month-0 cash.
  const { occurrences: confirmedOccurrences } = useMatchedOccurrences();
  const [strategy, setStrategy] = usePersistedState<'avalanche' | 'snowball'>('tre:debt:strategy', 'avalanche');
  const [paymentMode, setPaymentMode] = usePersistedState<'variable' | 'consistent'>('tre:debt:paymentMode', 'variable');
  // The user's SAVED figure, shown in the input whichever mode is in force — keeping it visible is
  // what makes the toggle reversible rather than a one-way door (see cash-floor.ts).
  const [manualFloorValue, setManualFloorValue] = useState(() => displayedManualCashFloor(profile));
  const [manualFloor, setManualFloor] = useState(() => isManualCashFloor(profile));
  // The floor the ENGINE uses. Automatic (the default) resolves to 0, and `getMinSafeCash` then
  // takes the greater of it and the pre-paycheck bills — so the floor becomes the bills themselves.
  const cashFloor = useMemo(() => (manualFloor ? manualFloorValue : 0), [manualFloor, manualFloorValue]);
  // Re-hydrates the locally editable cash floor when the server value arrives or
  // changes. The lazy initializer above covers the case where profile is already
  // cached; this covers the first load, where the query resolves after mount.
  // The value is user-editable, so it cannot simply be read from `profile`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (profile?.cash_floor != null) setManualFloorValue(displayedManualCashFloor(profile));
  }, [profile?.cash_floor, profile]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManualFloor(isManualCashFloor(profile));
  }, [profile?.cash_floor_is_manual, profile]);
  // Only one card's accordion open at a time — prevents the page from getting overcrowded
  // when several cards' month-by-month projections are all expanded simultaneously.
  const [expandedCard, setExpandedCard] = usePersistedState<string | null>('tre:debt:expanded-card', null);
  // Shared across cards (only one is ever expanded) — lets the user page through the full
  // 5-year projection one year at a time instead of everything rendering at once.
  const [accordionYear, setAccordionYear] = usePersistedState<'1' | '2' | '3' | '4' | '5'>('tre:debt:accordion-year', '1');
  // Trajectory chart horizon, in years. Defaults to '5' so the chart looks exactly as it did
  // before this filter existed; the other options just trim months off the tail.
  const [chartYears, setChartYears] = usePersistedState<'1' | '2' | '3' | '5'>('tre:debt:chart-years', '5');
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [editingStatementBal, setEditingStatementBal] = useState<string | null>(null);
  const [statementBalInput, setStatementBalInput] = useState('');

  const [targetInput, setTargetInput] = useState('');
  // Pinned per-month payments, persisted: these are deliberate user edits that the engine
  // re-converges around (Anomaly B), so losing them on reload/navigation/mobile-resume silently
  // threw away intentional planning work. Same store as 'tre:debt:paymentMode' above.
  const [overrides, setOverrides] = usePersistedState<Record<string, Record<number, number>>>('tre:debt:overrides', {});
  const [editingMonth, setEditingMonth] = useState<{ cardId: string; month: number } | null>(null);
  const [monthPayInput, setMonthPayInput] = useState('');
  const [liquidCashOpen, setLiquidCashOpen] = useState(false);
  const [safeToPayOpen, setSafeToPayOpen] = useState(false);

  // Auto-save cash floor to profile on change
  const cashFloorSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCashFloor = (val: number) => {
    setManualFloorValue(val);
    if (cashFloorSaveTimer.current) clearTimeout(cashFloorSaveTimer.current);
    cashFloorSaveTimer.current = setTimeout(() => {
      updateProfile.mutate({ cash_floor: val });
    }, 1000);
  };
  /** ⚠️ Switching to automatic writes only the FLAG. `cash_floor` keeps the user's number so
   *  switching back restores it exactly. */
  const setManualFloorMode = (manual: boolean) => {
    setManualFloor(manual);
    updateProfile.mutate({ cash_floor_is_manual: manual });
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
  const liquidAccounts = useMemo(() => accounts.filter(a => a.active && LIQUID_ACCOUNT_TYPES.includes(a.account_type)), [accounts]);
  const defaultFunding = useMemo(() => {
    const defaultId = profile?.default_deposit_account;
    if (defaultId) {
      const acct = liquidAccounts.find(a => a.id === defaultId);
      if (acct) return acct.id;
    }
    const checking = liquidAccounts.find(a => a.account_type === 'checking');
    return checking?.id || liquidAccounts[0]?.id || '';
  }, [liquidAccounts, profile]);
  const [fundingAccountId, setFundingAccountIdLocal] = usePersistedState<string>('tre:debt:fundingAccount', defaultFunding);
  const setFundingAccountId = (id: string) => {
    setFundingAccountIdLocal(id);
    updateProfile.mutate({ default_deposit_account: id });
  };

  const liquidCash = liquidAccounts.reduce((s, a) => s + Number(a.balance), 0);
  // Use defaultFunding as fallback so fundingAccount resolves correctly while
  // accounts are still loading and fundingAccountId may be '' (no localStorage value yet).
  // Finding §2.8: fundingAccountId comes from localStorage, so it can name an account that no
  // longer exists — or, in demo mode, a real account's UUID. Every consumer below asks "is this
  // expense paid from the funding account?", so an id matching nothing drops every cash expense
  // out of the estimate. Resolve it against the real account list first; the persisted value is
  // left untouched so switching data sets (demo ↔ real) never overwrites the user's choice.
  const resolvedFundingId = resolveFundingAccountId(accounts, fundingAccountId, defaultFunding) ?? '';
  const fundingAccount = liquidAccounts.find(a => a.id === resolvedFundingId);
  const fundingBalance = fundingAccount ? Number(fundingAccount.balance) : liquidCash;

  // Use Plaid last_synced_at as cutoff so estimated liquid cash rolls over at 9am ET
  // when accounts update, not at midnight. Shares `resolveSyncCutoffDate` with
  // CardProjectionContext so this surface cannot drift from the engine's cutoff (finding §1.1
  // cause C — a second inline copy of this derivation is how they diverged in the first place).
  const syncCutoffDate = useMemo((): string => {
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const plaidItem = fundingAccount?.plaid_item_id
      ? plaidItems.find(pi => pi.plaid_item_id === fundingAccount.plaid_item_id)
      : undefined;
    return resolveSyncCutoffDate({
      lastSyncedAt: plaidItem?.last_synced_at,
      balanceUpdatedAt: (fundingAccount as { updated_at?: string } | undefined)?.updated_at,
      today: localDate,
    });
  }, [fundingAccount, plaidItems]);

  // Persist defaultFunding to localStorage the first time accounts load so future
  // reloads initialize fundingAccountId correctly without needing a navigation.
  useEffect(() => {
    if (!fundingAccountId && defaultFunding) {
      setFundingAccountIdLocal(defaultFunding);
    }
  }, [defaultFunding, fundingAccountId, setFundingAccountIdLocal]);

  // Allow-list of payment source strings that match the funding account.
  // Expenses with a source NOT in this set (CC, other checking, savings) are excluded
  // from the liquid cash estimate since they don't draw from the funding account.
  // Falls back to defaultFunding so the filter is non-empty even before the persisted
  // value resolves (accounts still loading → fundingAccountId may be '').
  const fundingAccountSources = useMemo(() => {
    const id = resolvedFundingId;
    return id ? new Set([id, `account:${id}`]) : new Set<string>();
  }, [resolvedFundingId]);

  const monthlyTakeHome = useMemo(() => {
    const now = new Date();
    const paycheckIncome = getNormalizedMonthNetIncome(payConfig);
    const nonPaycheckIncome = rules
      .filter(r =>
        r.active &&
        r.rule_type === 'income' &&
        !['paycheck', 'salary', 'wages', 'pay'].some(kw => r.name?.toLowerCase().includes(kw))
      )
      .reduce((s, r) => {
        const amt = Number(r.amount);
        const count = countRuleOccurrencesInMonth(r, now.getFullYear(), now.getMonth());
        return s + amt * count;
      }, 0);
    return paycheckIncome + nonPaycheckIncome;
  }, [payConfig, rules]);

  // Same plan-derived installment carve-out useCardProjection applies (shared
  // deriveUpfrontPlanFields) — without it this component's internal fallback sim treated a
  // card's full balance as APR-accruing revolving debt even when most of it is an interest-free
  // upfront plan, which both mis-prioritized the avalanche and charged phantom interest.
  const { installmentByCard: upfrontInstByCard, upfrontPayByMonth } = useMemo(() => {
    const rawCards = buildCardData(accounts, transactions, rules, debts);
    return deriveUpfrontPlanFields(rawCards, paymentPlans ?? [], PROJECTION_MONTHS, new Date(), syncCutoffDate);
  }, [accounts, transactions, rules, debts, paymentPlans, syncCutoffDate]);
  const cards: CardData[] = useMemo(() => buildCardData(accounts, transactions, rules, debts).map(card => {
    const derived = upfrontInstByCard.get(card.id);
    return {
      ...card,
      // Q11: same due-day-settled stamp useCardProjection applies — keeps this tab's internal
      // sim and recommendations from re-forcing a minimum that already cleared this cycle.
      m0MinSettled: m0MinDueSettled(card.dueDay, syncCutoffDate, new Date()),
      ...(derived ? { installmentBalance: derived.balance, installmentMonthlyPayment: derived.monthlyPayment } : {}),
    };
  }), [accounts, transactions, rules, debts, upfrontInstByCard, syncCutoffDate]);

  // When any revolving card is due on a day that already passed this month, the next
  // payment falls in next month. Generate those transactions so income/expense helpers
  // can correctly project cash through the actual upcoming due date.
  const allTransactionsWithNextMonth = useMemo(() => {
    const now = new Date();
    const today = now.getDate();
    const hasEarlyDueCard = cards.some(c => !c.autopayFullBalance && c.balance > 0 && (c.dueDay || 31) < today);
    if (!hasEarlyDueCard) return allTransactions;
    const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const nextMonth = (now.getMonth() + 1) % 12;
    const nextMonthTxns = generateMonthTransactionsFromRules(rules, accounts, nextYear, nextMonth);
    return [...allTransactions, ...nextMonthTxns];
  }, [allTransactions, cards, rules, accounts]);

  // CC account IDs in both raw and prefixed form — shared by expense filters
  const ccPaymentSources = useMemo(
    () => new Set(cards.flatMap(c => [c.id, `account:${c.id}`])),
    [cards],
  );

  const monthlyRecurringExpenses = useMemo(() => {
    // CC-tagged rules are tracked via cardPurchasesPerMonth in the engine (Step 2.5).
    // Including them here AND there would double-count, draining available cash
    // and causing UNSTABLE flags every month → no extra payments ever applied.
    return rules.filter(r => {
      if (!r.active || r.rule_type !== 'expense') return false;
      // Safety: if no CC accounts loaded yet, include all expenses (no CC data to filter on)
      if (ccPaymentSources.size === 0) return true;
      if (r.payment_source && ccPaymentSources.has(r.payment_source)) return false; // explicit CC
      if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false; // default-card CC
      if (pauseSavings && (r.category === 'Savings' || r.category === 'Investing')) return false;
      return true;
    }).reduce((s, r) => {
      const amt = Number(r.amount);
      const now = new Date();
      return s + amt * countRuleOccurrencesInMonth(r, now.getFullYear(), now.getMonth());
    }, 0);
  }, [rules, pauseSavings, ccPaymentSources]);

  // Pre-paycheck next-month bills
  const prePaycheckBills = useMemo(() => getPrePaycheckNextMonthBills(rules, payConfig, resolvedFundingId || null), [rules, payConfig, resolvedFundingId]);

  // recommendedSafeMinimum is computed after variableSim below so it can use the sim's
  // monthlyRevolvingBalances and perCardMinPayments to exactly match Forecast month 0.

  // Use the earliest card due day as the default window for the top-level display
  const primaryDueDay = useMemo(() => {
    const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
    if (revolving.length === 0) return 31;
    // Use the earliest due day among revolving cards
    const dueDays = revolving.map(c => c.dueDay || 31);
    return Math.min(...dueDays);
  }, [cards]);

  // Computed income/expense breakdown for display — full month (day 31).
  // Only funding-account expenses are counted (CC purchases excluded) so estLiquidCash
  // reflects what actually hits the funding account, not charges to credit cards.
  const fundingSources = useMemo(() =>
    resolvedFundingId
      ? new Set([resolvedFundingId, `account:${resolvedFundingId}`])
      : new Set<string>(),
    [resolvedFundingId],
  );

  const cashBreakdown = useMemo(() => {
    const transactionIncome = getRemainingTransactionIncomeByDay(allTransactionsWithNextMonth, 31, syncCutoffDate);
    const transactionExpenses = getRemainingTransactionExpensesByDay(allTransactionsWithNextMonth, 31, true, fundingSources, CC_DEFAULT_CATEGORIES, syncCutoffDate, confirmedOccurrences);
    return { transactionIncome, transactionExpenses };
  }, [allTransactionsWithNextMonth, syncCutoffDate, fundingSources, confirmedOccurrences]);

  // Line-item breakdown so the tooltip can show exactly what's included
  const cashBreakdownItems = useMemo(() => {
    const incomeItems = getRemainingTransactionIncomeItemsByDay(allTransactionsWithNextMonth, 31, syncCutoffDate);
    const expenseItems = getRemainingTransactionExpenseItemsByDay(allTransactionsWithNextMonth, 31, true, fundingSources, CC_DEFAULT_CATEGORIES, syncCutoffDate, confirmedOccurrences);
    return { incomeItems, expenseItems };
  }, [allTransactionsWithNextMonth, syncCutoffDate, fundingSources, confirmedOccurrences]);

  // Estimated liquid cash: funding balance + full-month income − full-month non-debt expenses.
  // Pre-debt-payment cash — feeds Safe to Pay (estLiquidCash − safeMinimum − autopay).
  // Dashboard's Month-End Cash is lower by the debt payment amounts (post-debt metric).
  const estLiquidCash = useMemo(() => {
    return fundingBalance + cashBreakdown.transactionIncome - cashBreakdown.transactionExpenses;
  }, [fundingBalance, cashBreakdown]);

  // Estimated liquid cash per card by due date (no expense deduction — safe minimum covers bills)
  const cardEstimatedCash = useMemo(() => {
    const result: Record<string, number> = {};
    for (const card of cards) {
      const dueDay = card.dueDay || 31;
      const incByDue = getRemainingTransactionIncomeByDay(allTransactionsWithNextMonth, dueDay, syncCutoffDate);
      result[card.id] = fundingBalance + incByDue;
    }
    return result;
  }, [cards, fundingBalance, allTransactionsWithNextMonth, syncCutoffDate]);

  // ── Event-based monthEvents + cardPurchasesPerMonth ──────────────────────────
  // Uses actual scheduled income/expense occurrences instead of flat scalars so
  // that month 0 only counts income from today forward (already-received income
  // is baked into the live checking balance and must not be double-counted).
  const { monthEvents, cardPurchasesPerMonth: ccPurchasesPerMonth } = useMemo(() => {
    const now = new Date();
    const todayStr = toLocalDateStr(now);
    const scheduledEvents = generateScheduledEvents(rules, accounts, PROJECTION_MONTHS);

    const liquidAccountIds = new Set<string>(
      accounts.filter(a => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
        .map(a => a.id),
    );

    const incomeToLiquidRuleIds = new Set<string>(
      rules.filter(r =>
        r.active && r.rule_type === 'income' &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).map(r => r.id),
    );

    const ccPaymentSources = new Set<string>(cards.flatMap(c => [c.id, `account:${c.id}`]));
    const ccExplicitRuleIds = new Set<string>(
      rules.filter(r =>
        r.active && r.rule_type === 'expense' && r.payment_source && ccPaymentSources.has(r.payment_source),
      ).map(r => r.id),
    );
    const highestAprCardId = cards.length > 0 ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : '';
    const ccDefaultRuleIds = new Set<string>(
      rules.filter(r =>
        r.active && r.rule_type === 'expense' && !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map(r => r.id),
    );
    const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);

    const cardRuleIdMap = new Map<string, Set<string>>(
      cards.map(c => {
        const cKey = `account:${c.id}`;
        const ids = new Set<string>(
          rules.filter(r =>
            r.active && r.rule_type === 'expense' &&
            (r.payment_source === c.id || r.payment_source === cKey),
          ).map(r => r.id),
        );
        if (c.id === highestAprCardId) ccDefaultRuleIds.forEach(id => ids.add(id));
        return [c.id, ids];
      }),
    );

    const savingsRuleIds = new Set<string>(
      rules.filter(r =>
        r.active && r.rule_type === 'expense' && (r.category === 'Savings' || r.category === 'Investing'),
      ).map(r => r.id),
    );

    const evMonthEvents: { income: number; expenses: number }[] = [];
    const evCardPurchases: { [cardId: string]: number }[] = [];

    for (let i = 0; i < PROJECTION_MONTHS; i++) {
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
          if (card.startDate) {
            const startD = new Date(card.startDate + 'T00:00:00');
            if (d < startD) continue; // no purchases before card's start date
          }
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

    const month0Income = getRemainingTransactionIncomeByDay(allTransactions, 31, syncCutoffDate);

    const month0Expenses = getRemainingTransactionExpensesByDay(allTransactions, 31, true, new Set(), new Set(), syncCutoffDate, confirmedOccurrences);

    // CC account IDs used to exclude CC-charged one-time expenses from future cash-flow months.
    const ccIds = new Set(
      accounts
        .filter(a => a.account_type === 'credit_card' && a.active)
        .flatMap(a => [a.id, `account:${a.id}`])
    );

    // One-time (non-generated) transactions per future month — applied AFTER debt allocation
    // in simulateVariablePayoff so they don't cause look-ahead cash hoarding in prior months.
    // Month 0 is handled separately via month0Income/month0Expenses above.
    const otherAssetIds = assetAccountIdsOf(accounts);
    const oneTimeByMonth: { income: number; expenses: number }[] = [{ income: 0, expenses: 0 }];

    // Augment ccPurchasesPerMonth with one-time (non-generated) CC transactions per card.
    // ccPurchasesPerMonth from the outer useMemo only includes recurring rule events.
    // One-time future CC purchases (e.g. $410 Prime Visa in June) must be added here
    // so the simulation knows that month's purchases on that card.
    const augmentedCCPurchases: { [cardId: string]: number }[] = [{}]; // month 0 = empty

    for (let i = 1; i < PROJECTION_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const txns = allTransactions.filter(t =>
        t.date && t.date.startsWith(mk) && !t.isGenerated,
      );
      const inc = txns
        .filter(t => t.type === 'income' && t.category !== 'Balance Adjustment')
        .reduce((s, t) => s + Number(t.amount), 0);
      const exp = txns
        .filter(t => {
          if (t.type !== 'expense') return false;
          if (t.category === 'Debt Payments' || t.category === 'Balance Adjustment') return false;
          if (t.payment_source && ccIds.has(t.payment_source)) return false;
          // Paid out of another of the user's accounts ⇒ it never touches the funding balance.
          // Same rule as `useForecastEngineInputs.oneTimeByMonth`; the sim's cash and the
          // forecast's cash have to exclude the same transaction or the two disagree by its amount.
          if (otherAssetSourceId(t.payment_source, resolvedFundingId || null, otherAssetIds) != null) return false;
          return true;
        })
        .reduce((s, t) => s + Number(t.amount), 0);
      oneTimeByMonth.push({ income: inc, expenses: exp });

      // Build per-card one-time CC purchases for this month
      const baseMonth = ccPurchasesPerMonth[i] ?? {};
      const monthCCPurchases: { [cardId: string]: number } = { ...baseMonth };
      for (const card of cards) {
        const cKey = `account:${card.id}`;
        const oneTimePurchases = txns
          .filter(t =>
            t.type === 'expense' &&
            (t.payment_source === card.id || t.payment_source === cKey),
          )
          .reduce((s, t) => s + Number(t.amount), 0);
        if (oneTimePurchases > 0) {
          monthCCPurchases[card.id] = (monthCCPurchases[card.id] || 0) + oneTimePurchases;
        }
      }
      augmentedCCPurchases.push(monthCCPurchases);
    }

    // Inject CC-sourced payment plan charges into augmentedCCPurchases so the
    // accordion shows installment spending on the correct card per month.
    if (paymentPlans && paymentPlans.length > 0) {
      const todayStr = toLocalDateStr(now);
      const cutoff = syncCutoffDate ?? todayStr;
      const sourceToCardId = new Map<string, string>(
        cards.flatMap(c => [[c.id, c.id], [`account:${c.id}`, c.id]]),
      );
      for (const plan of paymentPlans) {
        if (!plan.active || !plan.payment_source) continue;
        // Only monthly_charge (BNPL) plans hit the card as NEW purchases each month. An
        // 'upfront' plan's full amount is already in the live balance from day 1 — injecting
        // its installments as purchases here double-counted the whole plan on top of the
        // balance (matching useCardProjection's own cardPurchasesPerMonth filter).
        if (plan.plan_type !== 'monthly_charge') continue;
        const cardId = sourceToCardId.get(plan.payment_source);
        if (!cardId) continue;
        const planDates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
        for (const date of planDates) {
          if (date <= cutoff) continue;
          const pd = new Date(date + 'T00:00:00');
          for (let mi = 0; mi < PROJECTION_MONTHS; mi++) {
            const md = new Date(now.getFullYear(), now.getMonth() + mi, 1);
            if (pd.getFullYear() === md.getFullYear() && pd.getMonth() === md.getMonth()) {
              augmentedCCPurchases[mi][cardId] = (augmentedCCPurchases[mi][cardId] ?? 0) + plan.payment_amount;
              break;
            }
          }
        }
      }
    }

    // ── Apply Forecast growth-rate assumptions to future months ──────────────
    // Income raises apply as a step in the configured month each year.
    // Month 0 is left unchanged (uses actual remaining transaction amounts).
    // Pre-compute the compounding raise multiplier per month. This is order-dependent
    // (each raise compounds on the previous one), so it is built once in a plain loop
    // rather than accumulated inside the map() callback below — a render-scope variable
    // must not be reassigned from a closure.
    const incMultByMonth = (() => {
      const out: number[] = new Array(PROJECTION_MONTHS).fill(1);
      let mult = 1;
      for (let m = 0; m < PROJECTION_MONTHS; m++) {
        if (m > 0 && incomeGrowthEnabled && (incomeGrowth ?? 0) > 0) {
          const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
          if (d.getMonth() + 1 === (raiseMonth ?? 3)) {
            if (raiseMode === 'flat') {
              const currentAnnual = monthlyTakeHome * 12 * mult;
              if (currentAnnual > 0) mult *= (1 + (incomeGrowth ?? 0) / currentAnnual);
            } else {
              mult *= (1 + (incomeGrowth ?? 0) / 100);
            }
          }
        }
        out[m] = mult;
      }
      return out;
    })();
    // Pre-compute bonus month index for non-recurring bonus (first occurrence in window)
    const firstBonusIdx = (!bonusRecurring && bonusEnabled && (bonusAmount ?? 0) > 0)
      ? (() => {
          for (let k = 1; k < PROJECTION_MONTHS; k++) {
            const kd = new Date(now.getFullYear(), now.getMonth() + k, 1);
            if (kd.getMonth() + 1 === (bonusMonth ?? 12)) return k;
          }
          return -1;
        })()
      : -1;
    const growthAdjustedMonthEvents = (monthEvents ?? []).map((ev, m) => {
      if (m === 0) return ev;
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      const incMult = incMultByMonth[m];
      // Inject bonus + tax return into regular monthly income — same slot as Forecast PASS 1
      // so extra cash is available for debt allocation that month, not deferred post-allocation.
      let bonusTaxInc = 0;
      if (bonusEnabled && (bonusAmount ?? 0) > 0 && d.getMonth() + 1 === (bonusMonth ?? 12)) {
        if (bonusRecurring || m === firstBonusIdx) {
          bonusTaxInc += bonusMode === 'pct'
            ? monthlyTakeHome * 12 * incMult * ((bonusAmount ?? 0) / 100)
            : (bonusAmount ?? 0);
        }
      }
      if (taxReturnEnabled && (taxReturnAmountOverride ?? 0) > 0 && d.getMonth() + 1 === (taxReturnMonth ?? 2)) {
        bonusTaxInc += (taxReturnAmountOverride ?? 0);
      }
      return { income: ev.income * incMult + bonusTaxInc, expenses: ev.expenses };
    });

    // Per-month car loan payments from carFunds (mirrors Forecast's activeCarLoanByMonth).
    // Car loans live outside rules so they are absent from monthEvents; add them explicitly.
    const activeCarLoanByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      return getTotalCarLoanMonthly(carFunds, d);
    });

    // Savings goals + transfer rules + saving-phase car contributions — mirrors what
    // Forecast's cardProjectionData simulationMonthEvents adds on top of forecastMonthEvents.
    // These are absent from monthEvents because:
    //   goals → separate DB table, not in rules
    //   transfer/investment rules → type !== 'expense', filtered out of monthEvents
    //   saving-phase car → from carFunds, not rules
    const simRetireIds = new Set<string>(
      accounts.filter(a =>
        a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)
      ).map(a => a.id),
    );
    const simTransferRules = rules.filter(r =>
      r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'),
    );

    // Handoff item 4b — mirrors forecast-engine.ts / useCardProjection.ts exactly (same inputs,
    // same functions, built separately per call tree). Once a goal reaches its target, its linked
    // transfer rule stops being counted, and an unlinked goal's own contribution stops too.
    const goalTransferCutoffs = buildGoalTransferCutoffs(goals, rules, accounts, now);
    const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, now);

    const extraExpensesByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
      if (m === 0) return 0; // month 0 handled by month0Expenses
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      const simMonthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);

      const activeTransferDests = new Set<string>();
      let monthTransfers = 0;
      for (const tr of simTransferRules) {
        if (tr.start_date && new Date(tr.start_date + 'T00:00:00') > simMonthEnd) continue;
        if (tr.end_date && new Date(tr.end_date + 'T00:00:00') < d) continue;
        const goalCutoff = tr.id ? goalTransferCutoffs.get(tr.id) : undefined;
        if (goalCutoff != null && m >= goalCutoff) continue;
        if (tr.deposit_account) activeTransferDests.add(tr.deposit_account);
        const amt = Number(tr.amount);
        monthTransfers += amt * countRuleOccurrencesInMonth(tr, d.getFullYear(), d.getMonth(), now);
      }

      const monthSavings = pauseSavings ? 0 : goals.reduce((s, g) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > d) return s;
        if (g.linked_account && simRetireIds.has(g.linked_account)) return s;
        if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
        const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined;
        if (ownCutoff != null && m >= ownCutoff) return s;
        return s + Number(g.monthly_contribution);
      }, 0);

      const monthCarSaving = pauseSavings ? 0 : carFunds.reduce((s, c) => {
        if (c.phase !== 'saving') return s;
        if (c.linked_account) return s; // balance is live in current_saved — no monthly checking deduction
        const rem = Math.max(0, Number(c.down_payment_goal) - Number(c.current_saved) - Number(c.gift_contribution || 0));
        if (rem <= 0) return s;
        let purchaseMonthIdx = 12;
        if (c.planned_purchase_date) {
          const parts = (c.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          purchaseMonthIdx = Math.max(1, (pd.getFullYear() - d.getFullYear()) * 12 + (pd.getMonth() - d.getMonth()));
        }
        return s + Math.min(rem / purchaseMonthIdx, rem);
      }, 0);

      return monthTransfers + monthSavings + monthCarSaving;
    });

    const carAdjustedMonthEvents = growthAdjustedMonthEvents.map((ev, m) => ({
      ...ev,
      expenses: ev.expenses + activeCarLoanByMonth[m] + extraExpensesByMonth[m],
    }));

    // ── Per-month safe floor (mirrors Forecast monthMinSafe) ─────────────────────
    // getMinSafeCash = max(cashFloor, prePaycheckNextMonthBills) for that specific month.
    // Month 0 is already handled by month0SafeFloor in the sim call.
    const cashFloorByMonth: number[] = Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      return getMinSafeCash(rules, payConfig, cashFloor, resolvedFundingId || null, d,
        automaticFloorComponents(manualFloor, accounts, carFunds, d));
    });

    // ── Look-ahead pre-pass (mirrors Forecast PASS 2) ─────────────────────────────
    // Identifies save-up months: months where debt payments are capped at CC minimums
    // so cash accumulates before future large one-time cash expenses (e.g. car purchase).
    const ccMinTotalPrepass = cards
      .filter(c => !c.autopayFullBalance && c.balance > 0)
      .reduce((s, c) => s + c.minPayment, 0);

    const maxDebtPaymentByMonth: number[] = Array(PROJECTION_MONTHS).fill(Infinity);

    if (ccMinTotalPrepass > 0 && oneTimeByMonth.some((o, i) => i > 0 && o.expenses > 0)) {
      const saveUpMonths = new Set<number>();

      // Initialize: greedy estimate (all surplus above floor → debt)
      // Month 0 uses fundingBalance; months 1+ approximate PASS 3 (start at floor)
      const simDebtPay: number[] = [];
      for (let m = 0; m < PROJECTION_MONTHS; m++) {
        const mInc = m === 0 ? month0Income : (carAdjustedMonthEvents[m]?.income ?? monthlyTakeHome);
        const mExp = m === 0 ? month0Expenses : (carAdjustedMonthEvents[m]?.expenses ?? monthlyRecurringExpenses);
        const mFloor = cashFloorByMonth[m];
        const startBal = m === 0 ? fundingBalance : mFloor;
        const available = Math.max(0, startBal + mInc - mExp - mFloor);
        simDebtPay.push(Math.max(ccMinTotalPrepass, available));
      }

      const recomputeSimCash = (): number[] => {
        let bal = fundingBalance;
        const cash: number[] = [];
        for (let m = 0; m < PROJECTION_MONTHS; m++) {
          const mInc = m === 0 ? month0Income : (carAdjustedMonthEvents[m]?.income ?? monthlyTakeHome);
          const mExp = m === 0 ? month0Expenses : (carAdjustedMonthEvents[m]?.expenses ?? monthlyRecurringExpenses);
          const oneTime = m === 0 ? { income: 0, expenses: 0 } : (oneTimeByMonth[m] ?? { income: 0, expenses: 0 });
          const mFloor = cashFloorByMonth[m];
          const availForDebt = Math.max(0, bal + mInc - mExp - mFloor);
          const effectivePay = Math.min(simDebtPay[m], availForDebt + ccMinTotalPrepass);
          bal += mInc - mExp - effectivePay;
          if (!saveUpMonths.has(m) && bal > mFloor) bal = mFloor;
          bal += oneTime.income - oneTime.expenses;
          cash.push(bal);
        }
        return cash;
      };

      for (let pass = 0; pass < 20; pass++) {
        const simCash = recomputeSimCash();
        let anyFixed = false;
        for (let i = 0; i < PROJECTION_MONTHS; i++) {
          if (simCash[i] >= cashFloorByMonth[i]) continue;
          const shortfall = cashFloorByMonth[i] - simCash[i];
          let toRecover = shortfall;
          for (let j = i; j >= 0 && toRecover > 0; j--) {
            const canReduce = Math.max(0, Math.min(simDebtPay[j] - ccMinTotalPrepass, toRecover));
            if (canReduce > 0) {
              simDebtPay[j] -= canReduce;
              toRecover -= canReduce;
              if (j < i && (oneTimeByMonth[i]?.expenses ?? 0) > 0) saveUpMonths.add(j);
              anyFixed = true;
            }
          }
          if (anyFixed) break;
        }
        if (!anyFixed) break;
      }

      for (const m of saveUpMonths) {
        maxDebtPaymentByMonth[m] = ccMinTotalPrepass;
      }
    }

    // runSim closes over every argument so overrideData's fallback path below can re-run the
    // IDENTICAL simulation with the user's payment pins applied — one allocation model for both.
    const runSim = (paymentOverridesByMonth?: Record<string, Record<number, number>>) => simulateVariablePayoff(
      cards, fundingBalance, cashFloor, strategy,
      monthlyTakeHome, monthlyRecurringExpenses, PROJECTION_MONTHS,
      carAdjustedMonthEvents, undefined, augmentedCCPurchases,
      month0Income, month0Expenses,
      oneTimeByMonth,
      Math.max(cashFloor, prePaycheckBills.total), // month0SafeFloor — match recommendations
      maxDebtPaymentByMonth,
      cashFloorByMonth,
      undefined,
      undefined,
      upfrontPayByMonth,
      undefined,
      paymentOverridesByMonth,
    );
    const sim = runSim();
    // Return augmentedCCPurchases alongside the sim so projections can use it
    // to pass per-month purchase amounts to projectCardVariable.
    return { ...sim, augmentedCCPurchases, runSim };
  }, [cards, upfrontPayByMonth, fundingBalance, cashFloor, manualFloor, strategy, monthlyTakeHome,
      monthlyRecurringExpenses, allTransactions, accounts, ccPurchasesPerMonth, monthEvents,
      incomeGrowthEnabled, incomeGrowth, raiseMonth, raiseMode,
      bonusEnabled, bonusAmount, bonusMode, bonusMonth, bonusRecurring,
      taxReturnEnabled, taxReturnAmountOverride, taxReturnMonth,
      rules, payConfig, resolvedFundingId, carFunds, goals, pauseSavings, syncCutoffDate,
      paymentPlans, prePaycheckBills.total, confirmedOccurrences]);

  // Override-rebalance (Anomaly B): when the user pins any month's payment, rebuild the
  // CONTEXT's raw projection with the pins applied (withPaymentOverrides bakes them into both
  // the base sim and its resimulateWithDebtCash closure) and run the same debt-cash
  // convergence loop the unpinned view uses — so pinned and unpinned accordion rows share
  // one converged basis and every row reconciles. runDebtCashConvergence's exhaustion path
  // returns the pinned single-pass base, the zero-regression guard. variableSim itself stays
  // override-free: it feeds recommendedSafeMinimum and other non-override surfaces.
  const overrideData = useMemo(() => {
    if (Object.keys(overrides).length === 0) return null;
    const rawBase = forecastInputsBundle.engineInputs.cardProjectionData;
    if (rawBase?.withPaymentOverrides) {
      const converged = runDebtCashConvergence(
        rawBase.withPaymentOverrides(overrides), forecastInputsBundle.engineInputs,
      ).cardProjection;
      return {
        paymentsById: new Map<string, number[]>(converged.perCardPayments.map(p => [p.id, p.payments] as const)),
        monthlyRevolvingBalances: converged.monthlyRevolvingBalances,
        monthlyCyclingOwed: converged.monthlyCyclingOwed,
        monthlyCyclingInterest: converged.monthlyCyclingInterest,
        monthlyBalances: converged.monthlyBalances,
        monthlyInterest: converged.monthlyInterest,
      };
    }
    // Fallback (context has no projection — no cards / projection error): legacy single-pass
    // local sim via runSim, which closes over the identical arguments.
    const sim = variableSim.runSim(overrides);
    return {
      paymentsById: sim.monthlyPayments,
      monthlyRevolvingBalances: sim.monthlyRevolvingBalances,
      monthlyCyclingOwed: sim.monthlyCyclingOwed,
      monthlyCyclingInterest: sim.monthlyCyclingInterest,
      monthlyBalances: sim.monthlyBalances,
      monthlyInterest: sim.monthlyInterest,
    };
  }, [overrides, forecastInputsBundle.engineInputs, variableSim]);

  const monthlySavingsAndCar = useMemo(() => {
    if (pauseSavings) return 0;
    const retireIds = new Set<string>(
      accounts.filter(a => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map(a => a.id),
    );
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const activeTransferDests = new Set<string>(
      rules.filter(r =>
        r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
        !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd) &&
        !(r.end_date && new Date(r.end_date + 'T00:00:00') < now),
      ).map(r => r.deposit_account as string),
    );
    // Handoff item 4b — month-0 gate, mirrors useCardProjection.ts's goalContrib block. Separate
    // memo from variableSim, so it builds its own cutoff map (different closure).
    const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, now);
    const savingsTotal = goals.reduce((s, g) => {
      if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) return s;
      if (g.linked_account && retireIds.has(g.linked_account)) return s;
      if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
      const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined;
      if (ownCutoff != null && ownCutoff <= 0) return s;
      return s + Number(g.monthly_contribution);
    }, 0);
    const carTotal = carFunds.reduce((s, c) => {
      if (c.phase === 'loan') return s;
      if (c.linked_account) return s; // savings are in the checking pool — no separate monthly reservation
      const giftAdjDownPmt = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0));
      const rem = Math.max(0, giftAdjDownPmt - Number(c.current_saved));
      if (rem <= 0) return s;
      let monthsToGoal = 12;
      if (c.planned_purchase_date) {
        const parts = (c.planned_purchase_date as string).split('-').map(Number);
        const pd = new Date(parts[0], parts[1] - 1, parts[2]);
        monthsToGoal = Math.max(1, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
      }
      // Linked-account cars keep savings in the same checking pool used for CC payments.
      // For purchases within 12 months, reserve the full gift-adjusted down payment spread
      // over months-to-goal so safe-to-pay properly accounts for the upcoming cash event.
      // Always use rem (remaining after current_saved) to avoid overstating the monthly reserve.
      const reserve = Math.min(rem / monthsToGoal, rem);
      return s + reserve;
    }, 0);
    const carLoanTotal = getTotalCarLoanMonthly(carFunds);
    return savingsTotal + carTotal + carLoanTotal;
  }, [goals, carFunds, accounts, rules, pauseSavings]);

  // Exact Forecast month 0 floor formula: prePaycheckBills + carLoans + sim-based CC obligations.
  // Uses variableSim.monthlyRevolvingBalances[0] to distinguish revolving from paid/autopay cards,
  // matching forecastFloor0.monthMinSafe in Dashboard.tsx exactly.
  // Declared after monthlySavingsAndCar to avoid temporal dead zone on first render.
  const recommendedSafeMinimum = useMemo(() => {
    const now = new Date();
    const carLoanTotal = getTotalCarLoanMonthly(carFunds, now);
    let ccFloor = 0;
    for (const card of cards) {
      const revBal = variableSim.monthlyRevolvingBalances?.get(card.id)?.[0] ?? 1;
      if (revBal > 0) {
        const minPay = variableSim.perCardMinPayments?.get(card.id)?.[0] ?? 0;
        if (minPay > 0) ccFloor += minPay;
      } else {
        if (card.paymentPreference !== 'statement' && card.paymentPreference !== 'full' && !card.autopayFullBalance) continue;
        if (!card.dueDay || card.minPayment <= 0) continue;
        ccFloor += card.minPayment;
      }
    }
    const base = Math.max(cashFloor, prePaycheckBills.total + ccFloor + carLoanTotal);
    // monthlySavingsAndCar includes carLoanTotal; add only the savings/car-reserve portion
    // that Safe to Pay already deducts so the displayed floor matches the actual holdback.
    const savingsReserve = Math.max(0, monthlySavingsAndCar - carLoanTotal);
    return base + savingsReserve;
  }, [cashFloor, prePaycheckBills.total, cards, carFunds, variableSim, monthlySavingsAndCar]);

  const month0Recs = useMemo(() => {
    const now = new Date();
    // Next month's per-card payment. `perCardPaymentsScaled` first for the same reason the
    // accordion and the paydown panel prefer it: it is the cash-floor-constrained figure, i.e.
    // what the plan can actually send, not what it would like to. Month 0 is NOT read from here
    // — it comes from month0.perCardAdjusted, the integers the engine itself was pinned to.
    const nextMonthSource = perCardPaymentsScaled ?? perCardPayments;
    // A card whose card_start_date has not arrived cannot receive a payment this month.
    // Display layer only — the simulation still models it turning on (cardStartMonths).
    const unopenedCardIds = new Set(cards.filter(c => !isSimCardOpenAsOf(c, now)).map(c => c.id));
    const totalAvailableCash = month0?.safeToPayTotal ?? 0;
    const strategyLabel = strategy === 'avalanche' ? 'Avalanche' : 'Snowball';
    // Same predicate the engine reserves against — see `m0MinDueSettled`. Was open-coded here
    // (and in `month0-debt-breakdown.ts`) as `dueDateStr > syncCutoffDate`, which is how this
    // display could disagree with the engine about the very minimums it was summarising.
    const totalMinimumsdue = cards
      .filter(c => !unopenedCardIds.has(c.id))
      .filter(c => !c.autopayFullBalance && c.balance > 0)
      .filter(c => !m0MinDueSettled(c.dueDay, syncCutoffDate, now))
      .reduce((s, c) => s + Math.min(c.minPayment, c.balance), 0);
    const cashWarning = Math.ceil(totalAvailableCash - totalMinimumsdue) < 0;
    // Row construction shared with the Dashboard widget (`buildCardRecRows`,
    // month0-debt-breakdown.ts) — the A.2 layout used to live inline here, and the widget had
    // its own older copy. One derivation, so the two surfaces cannot drift apart again.
    const recs = buildCardRecRows({
      perCardAdjusted: month0?.perCardAdjusted ?? [], cards, strategy, nextMonthSource, now,
    });
    return { totalAvailableCash, totalMinimumsdue, cashWarning, strategyLabel, recs };
  }, [month0, cards, strategy, syncCutoffDate, perCardPaymentsScaled, perCardPayments]);

  // Active loan-phase vehicle loans, shown under the card rows — same builder as the Dashboard
  // widget. Display-only: loans never join month0Recs' totals, because Safe to Pay already
  // excludes the loan payment (the cash floor holds it via carLoanTotal above), so summing it in
  // would double-count. And they never join `recommendations` anywhere: that array feeds
  // createDebtPaymentTransactions, and the loan is already in the transaction stream.
  const loanRecs = useMemo(() => buildLoanRecommendations(carFunds, new Date()), [carFunds]);

  // The other kind of debt — a student loan, a mortgage, an `other_liability` account paired to a
  // `debts` row — under the same heading, from the same builder the Dashboard widget uses, so
  // /debt and the widget cannot show a different payment for the same loan. Display-only for the
  // same two reasons the loans above are: `buildOtherDebtPaymentSchedule` has already taken this cash out
  // before Safe to Pay is computed, so summing it into the totals would double-count; and it never
  // joins `recommendations`, which feeds createDebtPaymentTransactions.
  const otherDebtRecs = useMemo(() => buildOtherDebtRecommendations({
    accounts,
    debts: debts as unknown as LiabilityDebtInput[],
    rules,
    excludedAccountIds: linkedLoanAccountIds(carFunds, accounts),
  }), [accounts, debts, rules, carFunds]);

  const projections: CardProjection[] = useMemo(() => {
    // Display the sim's OWN payments alongside the sim's OWN balances/interest — one consistent
    // model — so every projection row reconciles: End = Start + interest + purchases − payment.
    // (Earlier code mixed pass-3-scaled/forecast-adjusted balances with the raw sim payment, which
    // broke reconciliation: balances dropped faster than the shown payment, paid-off cards kept
    // "paying" $0-balance months, and a phantom tail resurfaced.)
    const baseProjs = cards.map(c => {
      const cardOverrides = overrides[c.id] || {};
      const cardPurchases = variableSim.augmentedCCPurchases.map(
        (monthData: { [cardId: string]: number }) => monthData[c.id] ?? 0,
      );
      if (paymentMode === 'variable') {
        // Override-rebalance: when ANY override exists, the converged override projection
        // re-ran the full allocation with every pin applied, so it is the ground truth for
        // ALL cards — pinned months show exactly the (clamped) pin, other cards' payments
        // show their rebalanced amounts, and every row reconciles against the same
        // converged balances/interest the unpinned view uses.
        if (overrideData) {
          return projectCardVariable(
            c, overrideData.paymentsById.get(c.id) ?? [], PROJECTION_MONTHS, true, cardPurchases,
            overrideData.monthlyRevolvingBalances.get(c.id) ?? [],
            overrideData.monthlyCyclingOwed.get(c.id) ?? [],
            overrideData.monthlyCyclingInterest.get(c.id) ?? [],
            overrideData.monthlyBalances.get(c.id) ?? [],
            overrideData.monthlyInterest.get(c.id) ?? [],
          );
        }
        // Raw sim payments (perCardPayments) — the exact amounts that produced the sim balances
        // below. NOT perCardPaymentsScaled or the month-0 pass-3 amount, which differ from the
        // sim's own numbers and would reintroduce the reconciliation gap.
        const rawPays = perCardPayments?.find(p => p.id === c.id)?.payments;
        const localPays = variableSim.monthlyPayments.get(c.id) ?? [];
        const payments = rawPays ?? localPays;
        const revBals = (monthlyRevolvingBalances ?? variableSim.monthlyRevolvingBalances)?.get(c.id) ?? [];
        const cyclingOwed = (monthlyCyclingOwed ?? variableSim.monthlyCyclingOwed)?.get(c.id) ?? [];
        const cyclingInterest = (monthlyCyclingInterest ?? variableSim.monthlyCyclingInterest)?.get(c.id) ?? [];
        const trueBalances = (monthlyBalances ?? variableSim.monthlyBalances)?.get(c.id) ?? [];
        const trueInterest = (monthlyInterest ?? variableSim.monthlyInterest)?.get(c.id) ?? [];
        return projectCardVariable(
          c, payments, PROJECTION_MONTHS, true, cardPurchases,
          revBals, cyclingOwed, cyclingInterest,
          trueBalances,
          trueInterest,
        );
      }
      if (Object.keys(cardOverrides).length > 0) {
        const payments = Array.from({ length: PROJECTION_MONTHS }, (_, i) => cardOverrides[i] !== undefined ? cardOverrides[i] : c.targetPayment);
        return projectCardVariable(c, payments, PROJECTION_MONTHS, false, cardPurchases);
      }
      return projectCard(c, PROJECTION_MONTHS);
    });

    return baseProjs;
    // perCardPaymentsScaled and month0 are deliberately NOT dependencies: per the comment above,
    // this memo reads the raw sim payments on purpose and never touches either value, so listing
    // them only forced redundant re-projections.
  }, [cards, paymentMode, variableSim, overrideData, overrides, perCardPayments, monthlyRevolvingBalances, monthlyCyclingOwed, monthlyCyclingInterest, monthlyBalances, monthlyInterest]);

  // Hero figures. "Now" is the interest charged this month; "at plan" is next month's under the
  // recommended payments, and is ABSENT (null) rather than $0 when no converged plan exists to
  // read it off (getPlanInterestNextMonth). payoffOrder is marginal-rate ranked exactly as
  // generateRecommendations sorts — never re-sorted by flat APR here (see debt-payoff-order.ts).
  const interestThisMonth = useMemo(() => projections.reduce((s, p) => s + p.projectedInterestThisMonth, 0), [projections]);
  const interestAtPlan = useMemo(() => getPlanInterestNextMonth(projections, debtCashConverged), [projections, debtCashConverged]);

  // THE CASH-FLOOR WARNING (Tre, 2026-08-27: "it just lets the user know a not
  // meeting the cash floor is inevitable and to check cash floor").
  //
  // Read from the CONVERGED run, never from this file's local prepass. The local
  // one infers a cause from whatever else is happening that month, and
  // floor-protection.ts records what that costs: it once reported a $2,443 Prime
  // Visa reserve as "$200 Pay sibling to watch dogs". `saveUpReason` names the
  // outflow that actually sized the reserve, and where it has no answer this
  // states the shortfall alone rather than guessing one.
  const cashFloorWarning = useMemo(() => buildCashFloorWarning({
    months: convergedProjections?.data ?? [],
    saveUpReason: convergedCardProjection?.saveUpReason,
  }), [convergedProjections, convergedCardProjection]);
  const payoffOrder = useMemo(() => getStrategyPayoffOrder(cards, strategy, payoffOrderAsOf()), [cards, strategy]);
  // Cards the strategy pays but cannot rank — today that is only an account with no stored APR
  // under avalanche. They are listed separately and asked for their rate rather than ranked at a
  // placeholder 0%, which used to bury them at the cheap end of the list.
  const unratedCards = useMemo(() => getUnratedPayoffCards(cards, strategy, payoffOrderAsOf()), [cards, strategy]);

  // Cumulative PASS-3 surplus routed to each card — the shared step3-display adjustment, so
  // accordion/chart balances match the Forecast month popup and CSV export. Display-only:
  // raw sim balances (projections) stay the model; payoff detection and ETA are untouched.
  const step3CumSurplus = useMemo(
    () => cumulativeSurplusesByCard((perCardPaymentsScaled ?? []).map(c => ({ id: c.id, surpluses: c.surpluses ?? [] }))),
    [perCardPaymentsScaled],
  );

  const debtChartData = useMemo(() => {
    if (projections.length === 0) return [];
    const now = new Date();
    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const row: Record<string, number | string | null> = {
        month: d.toLocaleString('en', { month: 'short', year: 'numeric' }),
      };
      for (const p of projections) {
        if (p.card.startDate) {
          const startD = new Date(p.card.startDate + 'T00:00:00');
          const startMonth = new Date(startD.getFullYear(), startD.getMonth(), 1);
          if (d < startMonth) { row[p.card.name] = null; continue; } // null creates a gap, not a $0 line
        }
        const m = p.months[i];
        if (m) {
          // With overrides active, the converged override projection is the ground truth
          // (matches projections), and the shared step-3 surplus adjustment no longer
          // corresponds — skip it.
          const revBal = (overrideData?.monthlyRevolvingBalances ?? monthlyRevolvingBalances ?? variableSim.monthlyRevolvingBalances)?.get(p.card.id)?.[i] ?? 0;
          const cum = overrideData ? 0 : (step3CumSurplus.get(p.card.id)?.[i] ?? 0);
          row[p.card.name] = Math.round(revBal > 0 ? adjustedDisplayBalance(m.endBalance, cum) : m.endBalance);
        } else if (p.payoffMonth !== null && i >= p.payoffMonth) {
          // Per-month purchases, not the flat next-month estimate: the flat number is $0 for a
          // card whose only spend is future-dated (N11), which drew a paid-off statement card as
          // a $0 line forever even though scheduled purchases resume later in the horizon.
          row[p.card.name] = p.card.paymentPreference === 'full' || p.card.paymentPreference === 'statement'
            ? Math.round(variableSim.augmentedCCPurchases[i]?.[p.card.id] ?? p.card.monthlyNewPurchases)
            : 0;
        }
      }
      return row;
    });
  }, [projections, monthlyRevolvingBalances, variableSim, overrideData, step3CumSurplus]);

  // Display-only horizon trim. The projection itself is always the full PROJECTION_MONTHS —
  // this only shortens what the chart draws, so payoff detection and ETAs are unaffected.
  const visibleChartData = useMemo(
    () => debtChartData.slice(0, parseInt(chartYears, 10) * 12),
    [debtChartData, chartYears],
  );
  // Keep roughly 10 x-axis ticks regardless of horizon: 5Y -> 5 (unchanged from before), 3Y -> 3, 2Y -> 2, 1Y -> 1.
  const chartTickInterval = Math.max(0, Math.ceil((parseInt(chartYears, 10) * 12) / 10) - 1);

  // A card that draws nothing gets no legend entry. Cards before their card_start_date are
  // already null here (a gap, not a $0 line, see debtChartData), so an unopened card was
  // contributing a NAME and a COLOUR to a chart it never appears in — the same leak as the
  // recommendation panel, seen from the legend.
  //
  // ⚠️ Deliberately a property of the DATA, not a card_start_date special case: a card that
  // carries any balance anywhere in the drawn window can never be dropped, whatever its start
  // date, and a fully paid-off card disappears for the same honest reason.
  const chartSeries = useMemo(
    () => projections.filter(p => visibleChartData.some(row => {
      const v = row[p.card.name];
      return typeof v === 'number' && v > 0;
    })),
    [projections, visibleChartData],
  );

  // `month` = whole months from now until utilization first sits under the threshold.
  // 0 means it is already there — previously this returned the projection INDEX, so a threshold
  // cleared by the end of the current month reported "0 months", which reads as "already below"
  // and contradicted the utilization printed right above it (e.g. "below 50%: 0 months" at 65.1%).
  // projections[].months[i] is the END of month i, so clearing at index i takes i + 1 months.
  const utilizationMilestones = useMemo(() => {
    // Denominator = the limit actually OPEN in each projected month (a future
    // card_start_date card's limit is not credit yet) — same rule as the engine's
    // own utilization milestones (openCreditLimitAtMonth, session 93).
    const now = new Date();
    const limitCards = cards.map(c => ({
      creditLimit: c.creditLimit ?? 0,
      startMonth: cardStartMonthOffset(c.startDate, now),
    }));
    if (limitCards.reduce((s, c) => s + c.creditLimit, 0) === 0) return [];
    const balanceNow = cards.reduce((s, c) => s + c.balance, 0);
    return [25, 50, 75].map(threshold => {
      const limitNow = openCreditLimitAtMonth(limitCards, 0);
      if (limitNow > 0 && balanceNow <= limitNow * threshold / 100) return { threshold, month: 0 };
      for (let i = 0; i < PROJECTION_MONTHS; i++) {
        const limit = openCreditLimitAtMonth(limitCards, i);
        if (limit === 0) continue;
        const bal = projections.reduce((s, p) => s + (p.months[i]?.endBalance ?? 0), 0);
        if (bal <= limit * threshold / 100) return { threshold, month: i + 1 };
      }
      return { threshold, month: null };
    });
  }, [cards, projections]);

  const interestAvoided = useMemo(() => {
    const recommendedInterest = projections.reduce((s, p) => s + p.totalInterest, 0);
    const minInterest = cards.reduce((s, c) => {
      if (c.balance <= 0) return s;
      const minPays = Array.from({ length: PROJECTION_MONTHS }, () => c.minPayment);
      return s + projectCardVariable(c, minPays, PROJECTION_MONTHS, false).totalInterest;
    }, 0);
    return Math.max(0, minInterest - recommendedInterest);
  }, [cards, projections]);

  // A card with a future card_start_date is not open yet — its limit is not available
  // credit (session 93's rule, same filter Dashboard's utilization tile uses). Both sides
  // of the ratio use the same filter so Balance / Limit / Utilization stay consistent.
  const openCardsNow = cards.filter(c => isSimCardOpenAsOf(c, new Date()));
  const totalBalance = openCardsNow.reduce((s, c) => s + c.balance, 0);
  const totalLimit = openCardsNow.reduce((s, c) => s + c.creditLimit, 0);
  const overallUtil = totalLimit > 0 ? (totalBalance / totalLimit) * 100 : 0;

  const syncDebtAndAccount = (card: CardData, updates: { min_payment?: number; target_payment?: number }) => {
    const matchDebt = debts.find(d => d.name.toLowerCase() === card.name.toLowerCase());
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

  const handleSaveStatementBal = (card: CardData, rawValue?: string) => {
    const val = (rawValue ?? statementBalInput).trim();
    if (val === '') {
      updateAccount.mutate({ id: card.id, statement_balance: null });
      setEditingStatementBal(null);
      toast.success(`${card.name} interest-saving balance reverted to auto (current balance)`);
      return;
    }
    const parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0) {
      toast.error('Enter a valid balance amount');
      return;
    }
    updateAccount.mutate({ id: card.id, statement_balance: parsed });
    setEditingStatementBal(null);
    toast.success(`Statement balance for ${card.name} set to ${formatCurrency(parsed, false)}`);
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
    toast.success('Payment override applied — other cards rebalanced');
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
    const totalRecPay = (month0?.perCardAdjusted ?? []).reduce((s, r) => s + r.payment, 0);
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

  // Pins persist across sessions, so a card that was closed/removed since the pin was set would
  // otherwise leave an orphan key in storage — enough to keep the override path active forever
  // against a card that no longer exists. Prune once the real card list is known. Returning `prev`
  // unchanged when nothing is stale keeps this from looping.
  useEffect(() => {
    if (cards.length === 0) return;
    const liveIds = new Set(cards.map(c => c.id));
    setOverrides(prev => {
      const kept = Object.fromEntries(Object.entries(prev).filter(([id]) => liveIds.has(id)));
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
    });
  }, [cards, setOverrides]);

  const pinnedCardCount = Object.keys(overrides).length;
  const pinnedMonthCount = Object.values(overrides).reduce((s, m) => s + Object.keys(m).length, 0);

  if (cards.length === 0) {
    return (
      <div className="card-forged p-8 text-center">
        <CreditCard size={32} className="mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No credit card accounts found. Add credit card accounts to use the payoff engine.</p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 sm:space-y-5">
        <DebtHero interestThisMonth={interestThisMonth} interestAtPlan={interestAtPlan} />

        {/* Debt Payoff Trajectory Chart */}
        {debtChartData.length > 0 && (
          <div className="card-forged p-3 sm:p-5 min-w-0 overflow-x-hidden">
            <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 min-w-0">
                <CreditCard size={12} className="shrink-0" /> <span className="truncate">Credit Card Debt Payoff Trajectory</span>
              </h3>
              <div className="flex gap-1.5 shrink-0">
                {(['1', '2', '3', '5'] as const).map(y => (
                  <button
                    key={y}
                    onClick={() => setChartYears(y)}
                    aria-pressed={chartYears === y}
                    className={`px-2.5 py-1 text-[10px] font-medium border btn-press whitespace-nowrap ${chartYears === y ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {y}Y
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={visibleChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} onTouchStart={selectPointOnTouch}>
                <CartesianGrid stroke="hsl(0, 0%, 18%)" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(240, 4%, 50%)', textAnchor: 'end' }} angle={-45} height={50} interval={chartTickInterval} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(240, 4%, 50%)' }} tickFormatter={formatYAxisTick} />
                <RechartsTooltip formatter={(v, name) => [`$${Number(v).toLocaleString()}`, name]} labelStyle={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }} itemStyle={{ fontSize: 13 }} contentStyle={{ background: 'hsl(240, 6%, 10%)', border: '1px solid hsl(240, 4%, 20%)', borderRadius: '4px', fontSize: 13, padding: '8px 12px' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {chartSeries.map(p => (
                  <Line key={p.card.name} type="monotone" dataKey={p.card.name} stroke={p.card.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

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

        {/* Manual-edit banner. Pins now survive reloads, so the plan on screen can be a hand-edited
            one from a previous session — that has to be obvious at a glance, not just a small pill
            down on the individual card. */}
        {pinnedMonthCount > 0 && (
          <div className="flex items-start gap-2 border border-primary/40 bg-primary/10 p-2.5 sm:p-3" style={{ borderRadius: 'var(--radius)' }}>
            <Edit2 size={13} className="text-primary shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs font-semibold text-primary">
                Manually edited plan — {pinnedMonthCount} {pinnedMonthCount === 1 ? 'month' : 'months'} pinned
                {pinnedCardCount > 1 && ` across ${pinnedCardCount} cards`}
              </p>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
                These payments are locked to amounts you set, and every other card is rebalanced around them.
                Pinned edits are saved and will still be here next time you open the app.
              </p>
            </div>
            <button
              onClick={handleAutoAdjust}
              className="shrink-0 flex items-center gap-1 border border-primary/40 text-primary px-2 py-1 text-[9px] sm:text-[10px] font-medium btn-press hover:bg-primary/20"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <RotateCcw size={10} /> Clear all
            </button>
          </div>
        )}

        {/* Summary Stats */}
        <div className="card-forged p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 text-center">
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total CC Balance</p>
              <p className="text-lg sm:text-xl font-display font-bold mt-0.5 text-destructive">{formatCurrency(totalBalance, false)}</p>
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Limit</p>
              <p className="text-lg sm:text-xl font-display font-bold mt-0.5 text-foreground">{formatCurrency(totalLimit, false)}</p>
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Utilization</p>
              <p className={`text-lg sm:text-xl font-display font-bold mt-0.5 ${overallUtil > 30 ? 'text-destructive' : overallUtil > 10 ? 'text-primary' : 'text-success'}`}>{overallUtil.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Monthly Interest</p>
              <p className="text-lg sm:text-xl font-display font-bold mt-0.5 text-destructive">{formatCurrency(interestThisMonth, true)}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 sm:col-start-2 lg:col-start-auto">
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Payoff ETA</p>
              {(() => {
                const simEta = Math.max(0, ...projections.map(p => p.payoffMonth ?? 0));
                // Payoff ETA = the month the interest-bearing revolving debt truly reaches $0
                // (simRevolvingPayoffMonth), which is exactly the condition the Forecast page's CC
                // Debt Free milestone gates on — so the two surfaces agree. Fall back to
                // forecastRevolvingPayoffMonth (PASS 3), then the per-card sim payoff.
                const eta = (simRevolvingPayoffMonth != null && simRevolvingPayoffMonth > 0)
                  ? simRevolvingPayoffMonth
                  : (forecastRevolvingPayoffMonth != null && forecastRevolvingPayoffMonth > 0)
                    ? forecastRevolvingPayoffMonth
                    : simEta;
                const color = eta <= 1 ? 'text-success' : 'text-primary';
                if (eta <= 0) {
                  return <p className={`text-lg sm:text-xl font-display font-bold mt-0.5 ${color}`}>Paid</p>;
                }
                // eta is 1-INDEXED (month 1 = this month) — the same convention Forecast maps to a
                // row via `rawPayoffMonth - 1`. Printing it as "3 mo" read as three months FROM NOW
                // (Nov) while Forecast's milestone said Oct. Show the month itself, in Forecast's
                // own label format, so the two surfaces are directly comparable.
                const payoffDate = new Date();
                payoffDate.setDate(1);
                payoffDate.setMonth(payoffDate.getMonth() + eta - 1);
                const monthsAway = eta - 1;
                return (
                  <>
                    <p className={`text-lg sm:text-xl font-display font-bold mt-0.5 ${color}`}>
                      {payoffDate.toLocaleString('en', { month: 'short', year: 'numeric' })}
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
                      {monthsAway === 0 ? 'this month' : `in ${monthsAway} mo`}
                    </p>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        <UtilizationPanel cards={cards} />

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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[10px] text-muted-foreground uppercase">Cash Floor</label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span><Info size={11} className="text-muted-foreground cursor-help" /></span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    Never recommend payments that push liquid cash below this amount. Also reserves for early next-month bills.
                  </TooltipContent>
                </Tooltip>
                {/* Automatic is the default. The input stays VISIBLE but disabled in that mode, still
                    showing the saved figure, so the toggle plainly reads as reversible. */}
                <input type="number" value={manualFloorValue} onChange={e => setCashFloor(Number(e.target.value) || 0)}
                  disabled={!manualFloor}
                  aria-label="Manual cash floor"
                  className="w-20 sm:w-24 bg-secondary border border-border px-2 py-1 text-xs text-foreground font-display font-bold disabled:opacity-40" style={{ borderRadius: 'var(--radius)' }} step="100" min="0" />
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={manualFloor} className="accent-primary"
                    onChange={e => setManualFloorMode(e.target.checked)}
                    aria-label="Set the cash floor manually" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Set manually</span>
                </label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/20 text-[10px] font-medium text-primary cursor-help" style={{ borderRadius: 'var(--radius)' }}>
                      <ShieldCheck size={10} /> Safe Min: {formatCurrency(recommendedSafeMinimum, false)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    <p className="font-semibold mb-1">Safe Minimum = max(cash floor, pre-paycheck bills)</p>
                    {prePaycheckBills.items.length > 0 ? (
                      <>
                        <p className="mb-1">Bills due before first paycheck next month:</p>
                        {prePaycheckBills.items.map((item, i) => (
                          <div key={i} className="flex justify-between gap-2">
                            <span>{item.name} (day {item.dueDay})</span>
                            <span className="font-bold">{formatCurrency(item.amount, false)}</span>
                          </div>
                        ))}
                      </>
                    ) : <p>No bills found before next paycheck</p>}
                  </TooltipContent>
                </Tooltip>
              </div>
              {cashFloorWarning && (
                <p
                  role="status"
                  data-testid="cash-floor-warning"
                  className="text-[10px] text-amber-600 dark:text-amber-500 flex items-start gap-1 mt-1"
                >
                  <AlertTriangle size={10} className="shrink-0 mt-[2px]" />
                  <span>{cashFloorWarning.message}</span>
                </p>
              )}
              {!manualFloor && (
                <p className="text-[9px] text-muted-foreground flex items-center gap-1">
                  <Info size={9} className="shrink-0" />
                  Calculated automatically each month from the bills due before your next paycheck
                  &mdash; {formatCurrency(recommendedSafeMinimum, false)} this month. Tick
                  &ldquo;set manually&rdquo; to hold a floor of your own on top.
                </p>
              )}
              {manualFloor && prePaycheckBills.total > cashFloor && (
                <p className="text-[9px] text-primary flex items-center gap-1">
                  <Info size={9} className="shrink-0" />
                  Floor raised to {formatCurrency(recommendedSafeMinimum, false)} — pre-paycheck bills exceed your {formatCurrency(cashFloor, false)} floor.
                </p>
              )}
            </div>
          </div>

          {/* Funding Account Selector */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 pt-2 border-t border-border/50">
            <Wallet size={13} className="text-primary shrink-0" />
            <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider shrink-0">Funding Account:</span>
            <select
              value={resolvedFundingId}
              onChange={e => setFundingAccountId(e.target.value)}
              className="flex-1 min-w-0 bg-secondary border border-border px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}
            >
              {liquidAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {fundingAccount && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                Balance: <span className="font-display font-bold text-foreground">{formatCurrency(fundingBalance, false)}</span>
              </span>
            )}
          </div>
        </div>

        <AvalancheOrderList
          entries={payoffOrder}
          strategy={strategy}
          unrated={unratedCards}
          onSetApr={(cardId, apr) => updateAccount.mutate({ id: cardId, apr })}
        />

        {/* Recommendation Panel */}
        <div className="card-forged p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-3 sm:mb-4 flex-wrap">
            <h3 className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recommended This Month</h3>
            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {month0Recs.strategyLabel}
            </span>
            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 bg-muted/30 text-muted-foreground border border-border font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {paymentMode === 'variable' ? 'Variable' : 'Consistent'}
            </span>
          </div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground mb-3 sm:mb-4">
            A recommended payment based on your current cash flow. Not adjusted for bills further
            out than this month. Each card leads with its next payment and the date that payment is
            due; where the due date has already passed, that is next month's payment and the amount
            still owed this month is shown underneath it.
          </p>

          {month0Recs.cashWarning && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 px-3 py-2 mb-3 sm:mb-4 text-[10px] sm:text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>Safe to Pay ({formatCurrency(month0Recs.totalAvailableCash, false)}) is less than minimum payments due ({formatCurrency(month0Recs.totalMinimumsdue, false)}). Not all minimums can be covered. Review cash flow urgently.</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3 sm:mb-4">
            <Tooltip open={liquidCashOpen} onOpenChange={setLiquidCashOpen}>
              <TooltipTrigger asChild>
                <div className="relative p-2 sm:p-3 bg-muted/30 border border-border text-center cursor-pointer active:bg-muted/50 transition-colors" style={{ borderRadius: 'var(--radius)' }} onClick={() => setLiquidCashOpen(v => !v)}>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Est. Liquid Cash</p>
                  <p className="text-xs sm:text-sm font-display font-bold text-foreground">{formatCurrency(estLiquidCash, false)}</p>
                  <Info size={9} className="absolute bottom-1.5 right-1.5 text-muted-foreground/60" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[360px] text-xs">
                {(() => {
                  const now = new Date();
                  const today = now.getDate();
                  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const fmtDate = (d: string) => {
                    const [,m,day] = d.split('-');
                    return `${MONTHS[parseInt(m)-1]} ${parseInt(day)}`;
                  };
                  const windowLabel = 'remaining this month';
                  const hasProjected = cashBreakdownItems.incomeItems.some(i => i.isGenerated) || cashBreakdownItems.expenseItems.some(i => i.isGenerated);
                  const hasTodayItems = [...cashBreakdownItems.incomeItems, ...cashBreakdownItems.expenseItems].some(i => i.date.split('-')[2] === String(today).padStart(2,'0'));
                  return (
                    <>
                      <p className="font-semibold mb-2">Est. Liquid Cash ({windowLabel})</p>
                      <div className="flex justify-between gap-3 mb-2">
                        <span className="text-muted-foreground">{fundingAccount?.name ?? 'Funding'} balance now</span>
                        <span className="font-bold">{formatCurrency(fundingBalance, true)}</span>
                      </div>
                      {cashBreakdownItems.incomeItems.length > 0 && (
                        <div className="mb-2">
                          <p className="text-[10px] text-success uppercase tracking-wider mb-1">+ Upcoming income</p>
                          {cashBreakdownItems.incomeItems.map((item: TransactionLineItem, i: number) => (
                            <div key={i} className="flex justify-between gap-3">
                              <span className="text-muted-foreground truncate max-w-[200px]">{fmtDate(item.date)} · {item.note}{item.isGenerated ? ' *' : ''}</span>
                              <span className="text-success shrink-0">+{formatCurrency(item.amount, true)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {cashBreakdownItems.incomeItems.length === 0 && (
                        <p className="text-muted-foreground mb-2 italic">No income scheduled in window</p>
                      )}
                      {cashBreakdown.transactionExpenses > 0 && (
                        <div className="mb-2">
                          <p className="text-[10px] text-destructive/80 uppercase tracking-wider mb-1">− Upcoming expenses</p>
                          {cashBreakdownItems.expenseItems.slice(0, 6).map((item: TransactionLineItem, i: number) => (
                            <div key={i} className="flex justify-between gap-3">
                              <span className="text-muted-foreground truncate max-w-[200px]">{fmtDate(item.date)} · {item.note}{item.isGenerated ? ' *' : ''}</span>
                              <span className="text-destructive/80 shrink-0">−{formatCurrency(item.amount, true)}</span>
                            </div>
                          ))}
                          {cashBreakdownItems.expenseItems.length > 6 && (
                            <p className="text-muted-foreground text-[10px]">+{cashBreakdownItems.expenseItems.length - 6} more expense items</p>
                          )}
                        </div>
                      )}
                      <hr className="my-1 border-border/50" />
                      <div className="flex justify-between gap-3 font-bold mb-2">
                        <span>= Est. Liquid Cash (net)</span>
                        <span>{formatCurrency(estLiquidCash, true)}</span>
                      </div>
                      {(() => {
                        const activeCards = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
                        const uniqueDueDays = new Set(activeCards.map(c => c.dueDay || 31));
                        if (activeCards.length > 1 && uniqueDueDays.size > 1) {
                          return (
                            <div className="mb-2 space-y-0.5">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cash available by each card's due date</p>
                              {activeCards.map(c => (
                                <div key={c.id} className="flex justify-between gap-2">
                                  <span className="text-muted-foreground">{c.name} (due {ordinal(c.dueDay || 31)})</span>
                                  <span className="font-bold">{formatCurrency(cardEstimatedCash[c.id] || 0, true)}</span>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {hasProjected && <p className="text-muted-foreground text-[10px]">* Projected from your recurring rules — not yet a real transaction.</p>}
                      {hasTodayItems && <p className="text-muted-foreground text-[10px] mt-0.5">Items dated today may already be reflected in your balance.</p>}
                    </>
                  );
                })()}
              </TooltipContent>
            </Tooltip>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Safe Minimum</p>
              <p className="text-xs sm:text-sm font-display font-bold text-foreground">{formatCurrency(recommendedSafeMinimum, false)}</p>
            </div>
            <Tooltip open={safeToPayOpen} onOpenChange={setSafeToPayOpen}>
              <TooltipTrigger asChild>
                <div className="relative p-2 sm:p-3 bg-muted/30 border border-border text-center cursor-pointer active:bg-muted/50 transition-colors" style={{ borderRadius: 'var(--radius)' }} onClick={() => setSafeToPayOpen(v => !v)}>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground">Safe to Pay</p>
                  <p className="text-xs sm:text-sm font-display font-bold text-primary">{formatCurrency(month0Recs.totalAvailableCash, false)}</p>
                  <Info size={9} className="absolute bottom-1.5 right-1.5 text-muted-foreground/60" />
                </div>
              </TooltipTrigger>
              {/* Deliberately WHOLE DOLLARS, unlike the Est. Liquid Cash walk above. Every line here
                  is an integer by construction: useCardProjection rounds each month-0 per-card payment
                  and pins those integers into the sim (`m0FloorPins`) and the ledger the engine reads,
                  and `safeToPayTotal` is `Math.round(cycling + revolving)`. Showing cents would print
                  ".00" (false precision) and, because the total is rounded independently of its parts,
                  could make the walk visibly fail to add up. Unrounding the source is NOT a display
                  change — it would alter engine inputs. Leave it. */}
              <TooltipContent side="bottom" className="max-w-[340px] text-xs">
                <p className="font-semibold mb-1">Safe to Pay — how it's calculated:</p>
                <div className="space-y-0.5">
                  {(month0?.cyclingPayment ?? 0) > 0 && (
                    <div className="flex justify-between gap-3"><span>Cycling cards (statement/full)</span><span>{formatCurrency(month0!.cyclingPayment, false)}</span></div>
                  )}
                  {(month0?.revolvingPayment ?? 0) > 0 && (
                    <div className="flex justify-between gap-3"><span>Revolving debt payments</span><span>{formatCurrency(month0!.revolvingPayment, false)}</span></div>
                  )}
                  <hr className="my-1 border-border/50" />
                  <div className="flex justify-between gap-3 font-bold"><span>= Safe to Pay</span><span className="text-primary">{formatCurrency(month0Recs.totalAvailableCash, false)}</span></div>
                  {month0 != null && month0.holdback > 0 && month0.holdbackEvent && (
                    <div className="flex justify-between gap-3 text-primary text-[10px] mt-1">
                      <span>Holdback: {formatCurrency(month0.holdback, false)} reserved for {month0.holdbackEvent.eventName} ({month0.holdbackEvent.monthLabel})</span>
                    </div>
                  )}
                </div>
                <p className="text-muted-foreground mt-2">Computed by the Forecast engine using your paycheck schedule, floor ({formatCurrency(month0?.m0SafeFloor ?? recommendedSafeMinimum, false)}), savings goals, and upcoming bills. Save-up months reserve additional cash, reducing the amount available for debt.</p>
              </TooltipContent>
            </Tooltip>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Minimums Due</p>
              <p className="text-xs sm:text-sm font-display font-bold text-destructive">{formatCurrency(month0Recs.totalMinimumsdue, false)}</p>
            </div>
          </div>

          {month0 != null && month0.holdback > 0 && month0.holdbackEvent && (
            <div className="flex items-start gap-2 bg-primary/10 border border-primary/30 px-3 py-2 mb-3 sm:mb-4 text-[10px] sm:text-xs text-primary" style={{ borderRadius: 'var(--radius)' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Forecast is reserving <strong>{formatCurrency(month0.holdback, false)}</strong> for <strong>{month0.holdbackEvent.eventName}</strong> ({month0.holdbackEvent.monthLabel}). Paying the full amounts below may reduce that reserve. See the per-card caps.</span>
            </div>
          )}

          <div className="space-y-2">
            {month0Recs.recs.map(r => {
              const hasHoldbackCap = (month0?.holdback ?? 0) > 0 && r.maxPayment > r.payment + 0.01;
              return (
                <div key={r.cardId} className="flex items-center justify-between py-2 px-2 sm:px-3 border border-border bg-muted/10 flex-wrap gap-1" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="text-[10px] sm:text-xs font-medium">{r.cardName}</span>
                    {r.reason === 'Autopay Full Balance' ? (
                      <span className="text-[9px] sm:text-[10px] text-success bg-success/10 px-1.5 py-0.5 flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                        <CheckCircle2 size={9} /> autopay
                      </span>
                    ) : r.pastDue ? (
                      <span className="text-[9px] sm:text-[10px] text-primary bg-primary/10 border border-primary/30 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>saving</span>
                    ) : r.nextPayment == null ? (
                      // No badge: with no modelled payment there is nothing to classify, and
                      // "priority" would be a confident claim about an amount the row itself
                      // reports as unknown.
                      null
                    ) : r.isMinimumOnly ? (
                      <span className="text-[9px] sm:text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>min</span>
                    ) : (
                      <span className="text-[9px] sm:text-[10px] text-primary bg-primary/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>priority</span>
                    )}
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground italic truncate">{r.reason}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasHoldbackCap && month0?.holdbackEvent && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[9px] sm:text-[10px] text-primary bg-primary/10 border border-primary/30 px-1.5 py-0.5 cursor-pointer" style={{ borderRadius: 'var(--radius)' }}>
                            max {formatCurrency(r.maxPayment, false)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px] text-xs">
                          Forecast reserved {formatCurrency(month0.holdback, false)} for {month0.holdbackEvent.eventName} ({month0.holdbackEvent.monthLabel}), capping this month's payment from {formatCurrency(r.maxPayment, false)} to {formatCurrency(r.payment, false)}.
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {/* The next payment and the date it is due, together, because apart they lied:
                        a "$0" beside a left-hand "Due Sep 1st" chip read as "nothing to pay on the
                        1st". This month's figure is DEMOTED rather than dropped whenever the next
                        payment is next month's. */}
                    <div className="flex flex-col items-end leading-tight">
                      <span className="flex items-baseline gap-1">
                        {r.nextPayMonth === 1 && (
                          // The headline is NEXT month's payment on this row while the Safe to Pay
                          // tile above sums this month's. Both months are named rather than left to
                          // be inferred from the date underneath.
                          <span className="text-[8px] sm:text-[9px] uppercase tracking-wider text-muted-foreground">next</span>
                        )}
                        {r.nextPayment != null ? (
                          <span className="text-sm sm:text-base font-display font-bold text-primary">{formatCurrency(r.nextPayment, false)}</span>
                        ) : (
                          <span className="text-[10px] sm:text-xs text-muted-foreground">{NEXT_PAYMENT_UNKNOWN}</span>
                        )}
                      </span>
                      <span className="text-[9px] sm:text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <CalendarDays size={8} /> {r.nextDueDate ? formatNextDue(r.nextDueDate) : NEXT_DUE_UNKNOWN}
                      </span>
                      {r.nextPayMonth === 1 && (
                        // Demoted, not deleted. A this-month amount that is still owed is the
                        // actionable number and stays legible; a $0 stays quiet, because there is
                        // nothing to act on and the row above already carries the claim.
                        <span className={r.payment > 0
                          ? 'text-[10px] sm:text-xs text-foreground'
                          : 'text-[9px] text-muted-foreground/70'}>
                          {formatCurrency(r.payment, false)} due this month
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {loanRecs.map(l => (
              <div key={l.carFundId} className="flex items-center justify-between py-2 px-2 sm:px-3 border border-border bg-muted/10 flex-wrap gap-1" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  <Car size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-[10px] sm:text-xs font-medium">{l.name}</span>
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>loan</span>
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground italic truncate">{l.isFinalPayment ? 'Final payment' : 'Scheduled payment'}</span>
                </div>
                {/* No demoted "due this month" sub-line here, unlike the card rows: whether a
                    past-due-day loan payment was already made is not something this model can
                    verify, and claiming either way would be dishonest. The card sub-line states a
                    recommendation; a loan payment is a fixed obligation the floor already holds. */}
                <div className="flex flex-col items-end leading-tight shrink-0">
                  <span className="flex items-baseline gap-1">
                    {l.nextPayMonth === 1 && (
                      <span className="text-[8px] sm:text-[9px] uppercase tracking-wider text-muted-foreground">next</span>
                    )}
                    <span className="text-sm sm:text-base font-display font-bold text-primary">{formatCurrency(l.nextPayment, false)}</span>
                  </span>
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <CalendarDays size={8} /> {l.nextDueDate ? formatNextDue(l.nextDueDate) : NEXT_DUE_UNKNOWN}
                  </span>
                </div>
              </div>
            ))}
            {/* Non-CC debts, in parallel with the vehicle loans above and rendered the same way the
                Dashboard widget renders them. A separate list rather than more loan rows because a
                student loan has no car fund, and a Car icon beside one is a picture of the wrong
                thing. */}
            {otherDebtRecs.map(o => (
              <div key={o.accountId} className="flex items-center justify-between py-2 px-2 sm:px-3 border border-border bg-muted/10 flex-wrap gap-1" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  <Landmark size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-[10px] sm:text-xs font-medium">{o.name}</span>
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
                    {o.accountType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground italic truncate">{o.isFinalPayment ? 'Final payment' : 'Scheduled payment'}</span>
                  {/* Said out loud rather than hidden: the debt is real either way, and a row that
                      vanished for users who set up an expense rule would look like the app had
                      lost the loan. */}
                  {o.paidByExpenseRule && (
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground italic truncate">Paid by your expense rule</span>
                  )}
                </div>
                <div className="flex flex-col items-end leading-tight shrink-0">
                  <span className="flex items-baseline gap-1">
                    {o.nextPayMonth === 1 && (
                      <span className="text-[8px] sm:text-[9px] uppercase tracking-wider text-muted-foreground">next</span>
                    )}
                    <span className="text-sm sm:text-base font-display font-bold text-primary">{formatCurrency(o.nextPayment, false)}</span>
                  </span>
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <CalendarDays size={8} /> {o.nextDueDate ? formatNextDue(o.nextDueDate) : NEXT_DUE_UNKNOWN}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {(loanRecs.length > 0 || otherDebtRecs.length > 0) && (
            <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-2">
              Loan and other debt payments are already taken out of your cash before Safe to Pay,
              so they are not part of the card totals above.
            </p>
          )}

          {utilizationMilestones.length > 0 && (
            <div className="mt-3 sm:mt-4 flex flex-wrap gap-2 sm:gap-3">
              {utilizationMilestones.map(m => (
                <span key={m.threshold} className="text-[9px] sm:text-[10px] px-2 py-1 bg-muted/30 border border-border text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>
                  Below {m.threshold}% util: {m.month === null
                    ? 'N/A'
                    : m.month === 0
                      ? 'already there'
                      : `~${m.month} month${m.month === 1 ? '' : 's'}`}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Individual Card Projections */}
        <div className="space-y-3">
          {projections.map(proj => {
            const isExpanded = expandedCard === proj.card.id;
            const cardOverrides = overrides[proj.card.id] || {};
            const hasOverrides = Object.keys(cardOverrides).length > 0;

            return (
              <div key={proj.card.id} className="card-forged w-full max-w-full min-w-0">
                <button onClick={() => setExpandedCard(isExpanded ? null : proj.card.id)}
                  className="w-full p-3 sm:p-4 flex flex-row items-start justify-between text-left hover:bg-muted/10 transition-colors">
                  <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                    <span className="w-3 sm:w-4 h-3 sm:h-4 rounded-sm shrink-0 mt-0.5" style={{ backgroundColor: proj.card.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <h4 className="text-xs sm:text-sm font-semibold">{proj.card.name}</h4>
                        {proj.card.paymentPreference !== null && (
                          <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-success/15 text-success border border-success/30 font-medium flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                            <CheckCircle2 size={9} /> {proj.card.paymentPreference === 'full' ? 'Full Balance' : 'Statement Bal.'}
                          </span>
                        )}
                        {hasOverrides && (
                          <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-primary text-primary-foreground border border-primary font-semibold flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                            <Edit2 size={8} /> {Object.keys(cardOverrides).length} edited
                          </span>
                        )}
                      </div>
                      {/* Flat APR + the marginal rate that actually ranks the card, + promo warnings. */}
                      <CardRateLine
                        card={proj.card}
                        utilizationNow={proj.utilizationNow}
                        account={accounts.find(a => a.id === proj.card.id)}
                      />
                      <p className={`text-sm sm:text-base font-display font-bold mt-0.5 ${proj.card.balance <= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatCurrency(Math.max(0, proj.card.balance), false)}
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground">
                        {proj.card.balance <= 0
                          ? 'Debt free'
                          : (() => {
                              if (!proj.payoffMonth) return proj.card.paymentPreference === 'statement' ? 'Interest-free: N/A' : 'Payoff: N/A';
                              const d = new Date();
                              d.setMonth(d.getMonth() + proj.payoffMonth - 1);
                              const label = d.toLocaleString('en', { month: 'short', year: 'numeric' });
                              return proj.card.paymentPreference === 'statement'
                                ? `Interest-free: ${proj.payoffMonth} mo (${label})`
                                : `Payoff: ${proj.payoffMonth} months (${label})`;
                            })()
                        }
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 ml-2 flex items-center justify-center w-7 h-7 bg-secondary/60" style={{ borderRadius: 'var(--radius)' }}>
                    {isExpanded ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
                  </div>
                </button>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 px-3 sm:px-4 pb-3 text-center">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Min Payment</p>
                    <p className="text-xs font-semibold">{formatCurrency(proj.card.minPayment, false)}</p>
                    <p className="text-[8px] text-muted-foreground">Edit on Accounts</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Due Date</p>
                    <p className="text-xs font-semibold">{proj.card.dueDay ? ordinal(proj.card.dueDay) : '—'}</p>
                    <p className="text-[8px] text-muted-foreground">Edit on Accounts</p>
                  </div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Purchases/Mo</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.card.steadyMonthlyPurchases ?? proj.card.monthlyNewPurchases, false)}</p></div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Interest/Mo</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.projectedInterestThisMonth, true)}</p></div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Total Interest</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.totalInterest, false)}</p></div>
                </div>

                {/* Payment preference selector */}
                <div className="px-3 sm:px-4 pb-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">Payment type</p>
                  <div className="flex gap-2">
                    {([
                      ['Min Balance', null, 'Pay minimum required each month — strategy routes surplus to priority cards'],
                      ['Statement Bal.', 'statement', 'Pay carried balance + interest only — new purchases carry to next cycle'],
                      ['Full Balance', 'full', 'Pay entire balance + new purchases each month, as cash allows'],
                    ] as [string, 'statement' | 'full' | null, string][]).map(([label, key, desc]) => {
                      const active = proj.card.paymentPreference === key;
                      return (
                        <button
                          key={label}
                          onClick={() => { if (!active) updateAccount.mutate({ id: proj.card.id, payment_preference: key }); }}
                          className={`flex-1 py-1.5 text-[10px] font-medium border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'}`}
                          style={{ borderRadius: 'var(--radius)' }}
                          aria-pressed={active}
                          title={desc}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1">
                    {proj.card.paymentPreference === null && 'Strategy routes surplus to this card when it is the priority target'}
                    {proj.card.paymentPreference === 'statement' && 'Pay carried balance + interest — new purchases carry to next cycle'}
                    {proj.card.paymentPreference === 'full' && 'Pay entire balance + new purchases — as cash allows above floor'}
                  </p>
                  {proj.card.paymentPreference === 'statement' && (
                    <div className="flex items-center justify-between gap-2 mt-2 px-2 py-1.5 bg-muted/20 border border-border flex-wrap" style={{ borderRadius: 'var(--radius)' }}>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider" title="The statement balance this card pays to stay interest-free. Auto uses your current balance; set it manually if your latest statement differs.">
                        Interest-saving balance
                      </span>
                      {editingStatementBal === proj.card.id ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <input type="number" value={statementBalInput} onChange={e => setStatementBalInput(e.target.value)}
                            className="w-20 bg-secondary border border-primary px-1 py-0.5 text-xs text-foreground font-semibold text-center"
                            style={{ borderRadius: 'var(--radius)' }} autoFocus min={0} step="10" placeholder="Auto"
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveStatementBal(proj.card); if (e.key === 'Escape') setEditingStatementBal(null); }} />
                          <button onClick={() => handleSaveStatementBal(proj.card)} className="text-primary" aria-label="Save interest-saving balance"><Check size={12} /></button>
                          <button onClick={() => setEditingStatementBal(null)} className="text-muted-foreground hover:text-foreground" aria-label="Cancel"><X size={12} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {proj.card.statementBalance !== null ? (
                            <>
                              <span className="text-xs font-semibold">{formatCurrency(proj.card.statementBalance, false)}</span>
                              <span className="text-[8px] text-primary bg-primary/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>manual</span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Auto ({formatCurrency(Math.max(0, proj.card.balance), false)})</span>
                          )}
                          <button
                            onClick={() => { setEditingStatementBal(proj.card.id); setStatementBalInput(proj.card.statementBalance !== null ? String(proj.card.statementBalance) : ''); }}
                            className="text-muted-foreground hover:text-primary" aria-label="Edit interest-saving balance">
                            <Edit2 size={10} />
                          </button>
                          {proj.card.statementBalance !== null && (
                            <button onClick={() => handleSaveStatementBal(proj.card, '')}
                              className="text-muted-foreground hover:text-primary" aria-label="Revert to auto" title="Revert to auto (use current balance)">
                              <RotateCcw size={10} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="px-3 sm:px-4 pb-3">
                  <div className="w-full h-2 bg-muted/50 overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                    <div className={`h-full transition-all ${proj.utilizationNow > 30 ? 'bg-destructive' : proj.utilizationNow > 10 ? 'bg-primary' : 'bg-success'}`}
                      style={{ width: `${Math.min(100, proj.utilizationNow)}%` }} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border">
                  <div className="px-3 sm:px-4 py-3">
                    {proj.card.balance <= 0 && (
                      <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-success/10 border border-success/20 text-[10px] sm:text-xs text-success" style={{ borderRadius: 'var(--radius)' }}>
                        <CheckCircle2 size={14} className="shrink-0" />
                        <span>Debt-free. Monthly purchases ({formatCurrency(proj.card.steadyMonthlyPurchases ?? proj.card.monthlyNewPurchases, false)}) paid as {proj.card.paymentPreference === 'full' ? 'full balance' : proj.card.paymentPreference === 'statement' ? 'statement balance' : 'minimum'} — as cash allows.</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                      <h5 className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        Monthly Projection ({paymentMode === 'variable'
                          ? (perCardPaymentsScaled ? 'Forecast Sim' : 'Variable')
                          : 'Consistent'})
                      </h5>
                      {(isPremium || isDemo) && hasOverrides && (
                        <button onClick={() => revertAllForCard(proj.card.id)} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                          <RotateCcw size={10} /> Revert All
                        </button>
                      )}
                    </div>
                    {(() => {
                      const yearIdx = parseInt(accordionYear, 10);
                      const [yearStart, yearEnd] = getCalendarYearMonthRange(yearIdx);
                      const yearMonths = proj.months.slice(yearStart, yearEnd);
                      // Free tier keeps the same 3-free-months value prop, only ever in Year 1 —
                      // years 2-5 (and the rest of Year 1) stay behind the paywall.
                      const freeCount = (isPremium || isDemo) ? yearMonths.length : (yearIdx === 1 ? Math.min(3, yearMonths.length) : 0);
                      const visibleMonths = yearMonths.slice(0, freeCount);
                      const gatedMonths = yearMonths.slice(freeCount);
                      return (
                        <div className="w-full">
                          {/* Year navigator — one card open at a time, so this paging through
                              the full 5-year window never has to compete with another card's. */}
                          <div className="flex gap-1.5 mb-2 overflow-x-auto pb-0.5">
                            {(['1', '2', '3', '4', '5'] as const).map(yr => (
                              <button
                                key={yr}
                                onClick={(e) => { e.stopPropagation(); setAccordionYear(yr); }}
                                className={`px-2.5 py-1 text-[10px] font-medium border btn-press whitespace-nowrap ${accordionYear === yr ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
                                style={{ borderRadius: 'var(--radius)' }}
                              >
                                {getCalendarYearLabel(parseInt(yr, 10))}
                              </button>
                            ))}
                          </div>
                          {yearMonths.length === 0 ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-success/10 border border-success/20 text-[10px] sm:text-xs text-success" style={{ borderRadius: 'var(--radius)' }}>
                              <CheckCircle2 size={14} className="shrink-0" />
                              <span>{proj.card.name} is projected to be paid off before {getCalendarYearLabel(yearIdx)} — nothing to show here.</span>
                            </div>
                          ) : (
                            <>
                          {/* Column headers */}
                          <div className="grid grid-cols-3 gap-x-3 border-b border-border pb-1.5 mb-0.5 text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
                            <div className="px-2">Month</div>
                            <div className="px-2 text-right">Payment</div>
                            <div className="px-2 text-right">End Balance</div>
                          </div>
                          {visibleMonths.map((row, localIdx) => {
                        const idx = yearStart + localIdx;
                        const isOverridden = cardOverrides[idx] !== undefined;
                        // The engine clamps a pin to the month's mandatory obligation (floor) and
                        // to available cash (ceiling), so the shown payment can differ from what
                        // the user typed — surface that instead of a silently different number.
                        const pinnedVal = cardOverrides[idx];
                        const pinAdjusted = isOverridden && Math.abs(row.payment - (pinnedVal ?? 0)) > 0.5;
                        const isEditingThis = editingMonth?.cardId === proj.card.id && editingMonth?.month === idx;
                        const surplusAmt = perCardPaymentsScaled?.find(p => p.id === proj.card.id)?.surpluses?.[idx] ?? 0;
                        // Displayed Start/End use the shared step3-display adjustment for revolving
                        // months so they match the Forecast popup/export; with the surplus-redirect
                        // line above, rows still reconcile (End = Start + purchases + interest −
                        // payment − surplus). Raw sim balances stay the model underneath.
                        const isRevolvingMonth = ((monthlyRevolvingBalances ?? variableSim.monthlyRevolvingBalances)?.get(proj.card.id)?.[idx] ?? 0) > 0;
                        const cumAtIdx = step3CumSurplus.get(proj.card.id)?.[idx] ?? 0;
                        const cumBeforeIdx = idx > 0 ? (step3CumSurplus.get(proj.card.id)?.[idx - 1] ?? 0) : 0;
                        const displayEnd = isRevolvingMonth ? adjustedDisplayBalance(row.endBalance, cumAtIdx) : Math.max(0, row.endBalance);
                        const displayStart = isRevolvingMonth ? adjustedDisplayBalance(row.startBalance, cumBeforeIdx) : row.startBalance;
                        return (
                          <div key={row.month} className={`border-b border-border/30 hover:bg-muted/10 ${isOverridden ? 'bg-primary/15 border-l-2 border-l-primary' : ''}`}>
                            {/* Main row: Month | Payment | End Balance */}
                            <div className="grid grid-cols-3 gap-x-3 py-1.5">
                              <div className="px-2 text-[10px] sm:text-[11px] font-medium">{row.label}</div>
                              <div className="px-2 text-right text-[10px] sm:text-[11px]">
                                {isEditingThis ? (
                                  <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                                    <input type="number" value={monthPayInput} onChange={e => setMonthPayInput(e.target.value)}
                                      className="w-16 bg-secondary border border-primary px-1 py-0.5 text-xs text-foreground font-semibold text-center"
                                      style={{ borderRadius: 'var(--radius)' }} autoFocus min={0} step="10"
                                      onKeyDown={e => { if (e.key === 'Enter') handleOverrideMonth(proj.card.id, idx); if (e.key === 'Escape') setEditingMonth(null); }} />
                                    <button onClick={() => handleOverrideMonth(proj.card.id, idx)} className="text-primary"><Check size={10} /></button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="font-semibold text-primary">
                                      {row.payment > 0 ? `-${formatCurrency(row.payment, false)}` : '—'}
                                    </span>
                                    {isOverridden && <span className="text-[8px] font-semibold text-primary-foreground bg-primary px-1 py-0.5 flex items-center gap-0.5" style={{ borderRadius: 'var(--radius)' }}><Edit2 size={7} /> edited</span>}
                                    {(isPremium || isDemo) && !proj.card.autopayFullBalance && row.startBalance > 0 && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingMonth({ cardId: proj.card.id, month: idx }); setMonthPayInput(String(Math.round(row.payment))); }}
                                        className="text-muted-foreground hover:text-primary">
                                        <Edit2 size={9} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="px-2 text-right font-semibold text-[10px] sm:text-[11px]">
                                {formatCurrency(displayEnd, false)}
                              </div>
                            </div>
                            {/* Detail row: constrained to first column so it never bleeds into Payment/End Bal */}
                            <div className="grid grid-cols-3 gap-x-3 pb-1.5">
                              <div className="px-2 flex flex-col gap-0.5 text-[10px] sm:text-[11px] text-muted-foreground">
                                <span>Start: {formatCurrency(displayStart, false)}</span>
                                {pinAdjusted && (
                                  <span className="text-primary">
                                    {row.payment > (pinnedVal ?? 0)
                                      ? `Pinned ${formatCurrency(pinnedVal ?? 0, false)} raised to this month's required payment`
                                      : `Pinned ${formatCurrency(pinnedVal ?? 0, false)} reduced to available cash`}
                                  </span>
                                )}
                                {row.newPurchases > 0 && <span className="text-destructive">+{formatCurrency(row.newPurchases, false)} purchases</span>}
                                {row.interest > 0 && <span className="text-destructive">+{formatCurrency(row.interest, true)} interest</span>}
                                {surplusAmt > 0 && <span className="text-success">+{formatCurrency(surplusAmt, false)} surplus redirect</span>}
                                <span className={row.utilization > 30 ? 'text-destructive' : row.utilization > 10 ? 'text-primary' : 'text-success'}>
                                  {row.utilization.toFixed(1)}% utilization
                                </span>
                              </div>
                              <div />
                              <div className="px-2 flex items-start justify-end">
                                {isOverridden && (
                                  <button onClick={() => revertMonth(proj.card.id, idx)} className="text-muted-foreground hover:text-primary" title="Revert">
                                    <RotateCcw size={9} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                          })}
                          {/* Gate the rest of this year for free users (and all of Years 2-5) */}
                          {gatedMonths.length > 0 && (
                            <PremiumGate
                              isPremium={false}
                              title="See the full payoff timeline"
                              features={[
                                `${gatedMonths.length} more month${gatedMonths.length === 1 ? '' : 's'} remaining in ${getCalendarYearLabel(yearIdx)} for ${proj.card.name}`,
                                'Page through all 5 years of projections, not just this one',
                                `Save ${formatCurrency(proj.totalInterest, false)} in total interest`,
                                'Override any month\'s payment and watch balances update live',
                              ]}
                            >
                              <div>
                                {gatedMonths.map((row, gLocalIdx) => {
                                  const gIdx = yearStart + freeCount + gLocalIdx;
                                  const gRevolving = ((monthlyRevolvingBalances ?? variableSim.monthlyRevolvingBalances)?.get(proj.card.id)?.[gIdx] ?? 0) > 0;
                                  const gCum = step3CumSurplus.get(proj.card.id)?.[gIdx] ?? 0;
                                  const gEnd = gRevolving ? adjustedDisplayBalance(row.endBalance, gCum) : Math.max(0, row.endBalance);
                                  return (
                                  <div key={row.month} className="grid grid-cols-3 gap-x-3 py-1.5 border-b border-border/30">
                                    <div className="px-2 text-[10px] font-medium">{row.label}</div>
                                    <div className="px-2 text-right text-[10px] font-semibold text-primary">{row.payment > 0 ? `-${formatCurrency(row.payment, false)}` : '—'}</div>
                                    <div className="px-2 text-right text-[10px] font-semibold">{formatCurrency(gEnd, false)}</div>
                                  </div>
                                  );
                                })}
                              </div>
                            </PremiumGate>
                          )}
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
