import { useMemo, useState, useEffect } from 'react';
import { useRetirementAutoUpdate } from '@/hooks/useRetirementAutoUpdate';
import InstructionsModal from '@/components/shared/InstructionsModal';
import MetricCard from '@/components/shared/MetricCard';
import AppTour from '@/components/shared/AppTour';
import ProgressBar from '@/components/shared/ProgressBar';
import CategoryIcon from '@/components/shared/CategoryIcon';
import PremiumGate from '@/components/shared/PremiumGate';
import AccountUpdateReminder from '@/components/shared/AccountUpdateReminder';
import { formatCurrency } from '@/lib/calculations';
import { categorizeExpenses, getDebtPaymentsByCard } from '@/lib/expense-filtering';
import { MetricSkeleton, ChartSkeleton, ScheduleSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { useTransactions, useDebts, useSavingsGoals, useCarFunds, useAccounts, useSubscriptions, useProfile, useRecurringRules } from '@/hooks/useSupabaseData';
import { generateScheduledEvents, getUpcomingEvents, formatDateShort } from '@/lib/scheduling';
import { useSubscription } from '@/hooks/useSubscription';
import {
  buildPayConfig,
  getRemainingIncomeThisMonth,
  getMonthlyNetIncome,
  getRemainingPaychecksThisMonth,
  getNextPaycheckDate,
  getPaycheckNet,
  getMinSafeCash,
  getPrePaycheckNextMonthBills,
  getRemainingTransactionIncomeThisMonth,
  getRemainingTransactionExpensesThisMonth,
  getRemainingTransactionDebtPaymentsThisMonth,
  mergeWithGeneratedTransactions,
  generateCurrentMonthTransactionsFromRules,
  createDebtPaymentTransactions,
  mergeDebtPaymentsIntoStream,
  getPaychecksInMonth,
} from '@/lib/pay-schedule';
import { getCurrentMonthDebtRecommendations } from "@/lib/credit-card-engine";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip,
  Line, CartesianGrid, ComposedChart,
} from 'recharts';
import {
  Plus, ArrowUpRight, DollarSign, CreditCard,
  TrendingUp, PiggyBank, Landmark, Percent, Wallet, Repeat,
  CalendarDays, AlertTriangle, Info, X, Car, Shield, Check, FileDown,
} from 'lucide-react';
import { exportDashboardPdf } from '@/lib/exportPdf';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { calculateMonthlyPayment } from '@/lib/calculations';
import { supabase } from '@/integrations/supabase/client';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-semibold" style={{ color: p.color }}>{formatCurrency(p.value, false)}</span>
        </div>
      ))}
    </div>
  );
}

function CategoryTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

function CalcDrawer({
  open,
  onClose,
  title,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lines: { label: string; value: string; op?: string }[];
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-background/80"
      style={{ touchAction: 'none' }}
      onClick={onClose}
    >
      <div
        className="card-forged p-4 sm:p-6 w-full sm:max-w-md space-y-3 max-h-[65vh] sm:max-h-[80vh] overflow-y-auto rounded-b-none sm:rounded-b-[var(--radius)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            <Info size={14} className="text-primary" /> {title}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Calculation Breakdown
        </p>

        <div className="space-y-2 pt-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0"
            >
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                {l.op && <span className="text-primary font-bold">{l.op}</span>}
                {l.label}
              </span>
              <span className="text-xs font-display font-bold text-foreground">
                {l.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClickableMetric({
  to,
  onClick,
  children,
  tooltip,
}: {
  to?: string;
  onClick?: () => void;
  children: React.ReactNode;
  tooltip: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="relative group cursor-pointer"
      onClick={() => {
        if (onClick) onClick();
        else if (to) navigate(to);
      }}
      title={tooltip}
    >
      {children}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Info size={12} className="text-muted-foreground" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const navigate = useNavigate();

  const { data: transactions, loading: txnLoading } = useTransactions();
  const { data: accounts, loading: acctLoading } = useAccounts();
  const { data: profile, loading: profileLoading } = useProfile();

  useRetirementAutoUpdate(profile, accounts, isDemo, isPremium);
  const { data: debts, loading: debtsLoading } = useDebts();
  const { data: goals, loading: goalsLoading } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: subs } = useSubscriptions();
  const { data: rules, loading: rulesLoading } = useRecurringRules();

  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);
  const [showSecurityBanner, setShowSecurityBanner] = useState(false);

  useEffect(() => {
    if (isDemo) return;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!data) return;
      const raw = data as any;
      const all = [...(data.totp ?? []), ...(data.phone ?? []), ...((raw.email ?? []) as any[])];
      const hasVerified = all.some((f: any) => f.status === 'verified');
      setShowSecurityBanner(!hasVerified);
    });
  }, [isDemo]);

  const essentialLoading = txnLoading || acctLoading || profileLoading;

  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);
  const paycheckNet = useMemo(() => getPaycheckNet(payConfig), [payConfig]);
  const remainingIncome = useMemo(() => getRemainingIncomeThisMonth(payConfig), [payConfig]);
  const remainingPaychecks = useMemo(() => getRemainingPaychecksThisMonth(payConfig), [payConfig]);
  const nextPayday = useMemo(() => getNextPaycheckDate(payConfig), [payConfig]);
  const monthlyNetIncome = useMemo(() => getMonthlyNetIncome(payConfig), [payConfig]);

  const accountMap = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => {
      map[a.id] = a;
      map[`account:${a.id}`] = a;
    });
    return map;
  }, [accounts]);

  const generatedTransactions = useMemo(
    () => generateCurrentMonthTransactionsFromRules(rules, accounts),
    [rules, accounts],
  );

  const baseTxns = useMemo(
    () => mergeWithGeneratedTransactions(transactions, rules, accounts),
    [transactions, rules, accounts],
  );

  const fundingAccountId = useMemo(() => {
    const defaultId = (profile as any)?.default_deposit_account;
    if (defaultId) return defaultId;
    const checking = accounts.find((a: any) => a.account_type === 'checking' && a.active);
    return checking?.id || null;
  }, [accounts, profile]);

  const debtPaymentTxns = useMemo(() => {
    const recs = getCurrentMonthDebtRecommendations(accounts, baseTxns, rules, debts, profile);
    return createDebtPaymentTransactions(recs, fundingAccountId);
  }, [accounts, baseTxns, rules, debts, profile, fundingAccountId]);

  const allMonthTransactions = useMemo(
    () => mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTxns),
    [baseTxns, debtPaymentTxns],
  );

  const accountSummary = useMemo(() => {
    if (!accounts.length) {
      return {
        liquidCash: 0,
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        ccDebt: 0,
        ccLimit: 0,
      };
    }

    const active = accounts.filter((a: any) => a.active);
    const liquidTypes = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'];
    const investTypes = ['brokerage'];
    const retireTypes = ['roth_ira', '401k'];
    const liabilityTypes = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];
    const assetTypes = [...liquidTypes, ...investTypes, ...retireTypes, 'other_asset'];

    const liquidCash = active
      .filter((a: any) => liquidTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance || 0), 0);

    const totalAssets = active
      .filter((a: any) => assetTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance || 0), 0);

    const totalLiabilities = active
      .filter((a: any) => liabilityTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance || 0), 0);

    const ccDebt = active
      .filter((a: any) => a.account_type === 'credit_card')
      .reduce((s: number, a: any) => s + Number(a.balance || 0), 0);

    const ccLimit = active
      .filter((a: any) => a.account_type === 'credit_card' && a.credit_limit)
      .reduce((s: number, a: any) => s + Number(a.credit_limit || 0), 0);

    return {
      liquidCash,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
      ccDebt,
      ccLimit,
    };
  }, [accounts]);

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const currentMonthTransactions = useMemo(
    () => allMonthTransactions.filter((t: any) => t.date?.startsWith(currentMonthStr)),
    [allMonthTransactions, currentMonthStr],
  );

  const expenseBreakdown = useMemo(
    () => categorizeExpenses(currentMonthTransactions, true),
    [currentMonthTransactions],
  );

  const debtPaymentBreakdown = useMemo(
    () => getDebtPaymentsByCard(currentMonthTransactions),
    [currentMonthTransactions],
  );

  const totalDebtPayments = useMemo(
    () => debtPaymentBreakdown.reduce((s, d) => s + d.amount, 0),
    [debtPaymentBreakdown],
  );

  const summary = useMemo(() => {
    const income = currentMonthTransactions
      .filter((t: any) => t.type === 'income' && t.category !== 'Balance Adjustment')
      .reduce((s: number, t: any) => s + Number(t.amount || 0), 0);

    const expenses = Object.values(expenseBreakdown).reduce((s: number, v: number) => s + v, 0);

    const totalDebt = debts.reduce((s: number, d: any) => s + Number(d.balance || 0), 0);

    const totalSaved = goals.reduce((s: number, g: any) => {
      if ((g as any).linked_account && accountMap[(g as any).linked_account]) {
        return s + Number(accountMap[(g as any).linked_account].balance);
      }
      return s + Number(g.current_amount || 0);
    }, 0);

    const cashFlow = income - expenses - totalDebtPayments;
    const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0;
    const carSaved = carFunds[0] ? Number(carFunds[0].current_saved || 0) : 0;
    const carGoal = carFunds[0] ? Number(carFunds[0].down_payment_goal || 1) : 1;

    return { income, expenses, cashFlow, totalDebt, totalSaved, savingsRate, carSaved, carGoal };
  }, [currentMonthTransactions, expenseBreakdown, totalDebtPayments, debts, goals, carFunds, accountMap]);

  const scheduledEvents = useMemo(() => {
    if (!rules.length) return [];
    try {
      return generateScheduledEvents(rules, accounts, 1);
    } catch {
      return [];
    }
  }, [rules, accounts]);

  const upcomingWeek = useMemo(() => getUpcomingEvents(scheduledEvents, 7), [scheduledEvents]);
  const upcomingMonth = useMemo(() => getUpcomingEvents(scheduledEvents, 30), [scheduledEvents]);
  const upcomingBillsWeek = upcomingWeek.filter(e => e.type === 'expense');
  const upcomingBillsMonth = upcomingMonth.filter(e => e.type === 'expense');

  const utilization = accountSummary.ccLimit > 0 ? (accountSummary.ccDebt / accountSummary.ccLimit) * 100 : 0;

  const subTotal = useMemo(
    () =>
      subs
        .filter((s: any) => s.active)
        .reduce((acc: number, s: any) => acc + (s.billing === 'monthly' ? Number(s.cost || 0) : Number(s.cost || 0) / 12), 0),
    [subs],
  );

  const remainingTxIncome = useMemo(
    () => getRemainingTransactionIncomeThisMonth(allMonthTransactions),
    [allMonthTransactions],
  );

  const remainingTxExpenses = useMemo(
    () => getRemainingTransactionExpensesThisMonth(allMonthTransactions, true),
    [allMonthTransactions],
  );

  const remainingTxDebt = useMemo(
    () => getRemainingTransactionDebtPaymentsThisMonth(allMonthTransactions),
    [allMonthTransactions],
  );

  const cashFloor = Number(profile?.cash_floor) || 500;

  const minSafeCash = useMemo(
    () => getMinSafeCash(rules, payConfig, cashFloor, fundingAccountId),
    [rules, payConfig, cashFloor, fundingAccountId],
  );

  const prePaycheckBills = useMemo(
    () => getPrePaycheckNextMonthBills(rules, payConfig, fundingAccountId),
    [rules, payConfig, fundingAccountId],
  );

  const fundingBalance = useMemo(() => {
    const fundAcct = accounts.find((a: any) => a.id === fundingAccountId);
    if (fundAcct) return Number(fundAcct.balance);
    return accountSummary.liquidCash;
  }, [accounts, fundingAccountId, accountSummary]);

  const rawMonthEndCash = useMemo(
    () => fundingBalance + remainingTxIncome - remainingTxExpenses - remainingTxDebt,
    [fundingBalance, remainingTxIncome, remainingTxExpenses, remainingTxDebt],
  );

  const adjustedDebtPayments = useMemo(() => {
    const hasDebt =
      debts.some((d: any) => Number(d.balance) > 0) ||
      accounts.some((a: any) => a.account_type === 'credit_card' && a.active && Number(a.balance) > 0);

    if (!hasDebt) return remainingTxDebt;

    const surplus = rawMonthEndCash - minSafeCash;

    if (surplus > 100) {
      return remainingTxDebt + Math.max(0, surplus - 100);
    }
    if (surplus < 0) {
      return Math.max(0, remainingTxDebt + surplus);
    }
    return remainingTxDebt;
  }, [rawMonthEndCash, minSafeCash, remainingTxDebt, debts, accounts]);

  const monthEndCash = useMemo(
    () => fundingBalance + remainingTxIncome - remainingTxExpenses - adjustedDebtPayments,
    [fundingBalance, remainingTxIncome, remainingTxExpenses, adjustedDebtPayments],
  );

  const categoryData = useMemo(
    () => Object.entries(expenseBreakdown).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    [expenseBreakdown],
  );

  const cashFlowData = useMemo(() => {
    const months = [];
    const nowDate = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthName = d.toLocaleString('en', { month: 'short' });

      if (i === 0) {
        months.push({ month: monthName, income: summary.income, expenses: summary.expenses, net: summary.cashFlow });
      } else {
        const monthTxns = transactions.filter(t => t.date.startsWith(monthStr));
        const inc = monthTxns.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + Number(t.amount), 0);
        const exp = monthTxns.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + Number(t.amount), 0);
        months.push({ month: monthName, income: Math.round(inc), expenses: Math.round(exp), net: Math.round(inc - exp) });
      }
    }

    return months;
  }, [summary, transactions]);

  const recentTxns = useMemo(
    () => [...allMonthTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [allMonthTransactions],
  );

  const carGoalData = useMemo(() => {
    if (carFunds.length > 0) {
      const c = carFunds[0];
      return {
        name: c.vehicle_name,
        saved: Number(c.current_saved),
        target: Number(c.down_payment_goal),
        price: Number(c.target_price),
        apr: Number(c.expected_apr),
        term: Number(c.loan_term_months),
      };
    }
    return null;
  }, [carFunds]);

  const openMonthEndCalc = () => {
    const hasDebt =
      debts.some((d: any) => Number(d.balance) > 0) ||
      accounts.some((a: any) => a.account_type === 'credit_card' && a.active && Number(a.balance) > 0);

    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'Funding Account Balance', value: formatCurrency(fundingBalance, false) },
      { label: 'Remaining Income (from Transactions)', value: formatCurrency(remainingTxIncome, false), op: '+' },
      { label: 'Remaining Expenses (from Transactions)', value: formatCurrency(remainingTxExpenses, false), op: '−' },
      { label: 'Remaining Debt Payments (adjusted)', value: formatCurrency(adjustedDebtPayments, false), op: '−' },
      { label: 'Projected Month-End Cash', value: formatCurrency(monthEndCash, false), op: '=' },
      { label: '', value: '' },
      { label: 'Cash Floor', value: formatCurrency(cashFloor, false) },
      { label: `Pre-paycheck next-month bills (${prePaycheckBills.items.length} items)`, value: formatCurrency(prePaycheckBills.total, false) },
      { label: 'Min Safe Cash Reserve', value: formatCurrency(minSafeCash, false), op: '≥' },
      { label: '', value: '' },
      {
        label: monthEndCash >= minSafeCash
          ? '✅ Cash is above safety threshold'
          : '⚠️ Cash is below safety threshold — debt payments may need adjustment',
        value: '',
      },
      {
        label: hasDebt
          ? 'While debt exists, month-end cash targets ~$100 above the safe minimum. Extra cash is directed to debt payoff.'
          : 'Uses Transactions as single source of truth. Same formula as Budget Control Remaining Cash On Hand.',
        value: '',
      },
    ];

    setCalcDrawer({ title: 'Projected Month-End Cash', lines });
  };

  const openIncomeCalc = () => {
    const incomeItems = currentMonthTransactions.filter((t: any) => t.type === 'income');
    const paychecksThisMonth = getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth());

    const lines: { label: string; value: string; op?: string }[] = [
      { label: `Pay Schedule: ${payConfig.frequency}`, value: `${payConfig.paycheckDay === 5 ? 'Fri' : `Day ${payConfig.paycheckDay}`}` },
      { label: 'Net per paycheck (post-tax)', value: formatCurrency(paycheckNet, false) },
      { label: 'Paychecks this month', value: String(paychecksThisMonth.length) },
      { label: `${incomeItems.length} income transactions`, value: '' },
    ];

    incomeItems.slice(0, 8).forEach(t => {
      lines.push({ label: `  ${(t as any).note || t.category}`, value: formatCurrency(Number(t.amount), false), op: '+' });
    });

    lines.push({ label: 'Total Monthly Income', value: formatCurrency(summary.income, false), op: '=' });
    setCalcDrawer({ title: 'Monthly Income', lines });
  };

  const openExpenseCalc = () => {
    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'All current-month expense transactions (excluding debt):', value: '' },
    ];

    Object.entries(expenseBreakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, val]) => {
        lines.push({ label: `  ${cat}`, value: formatCurrency(val, false), op: '+' });
      });

    lines.push({ label: 'Total Monthly Expenses', value: formatCurrency(summary.expenses, false), op: '=' });
    setCalcDrawer({ title: 'Monthly Expenses', lines });
  };

  const openDebtPaymentsCalc = () => {
    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'All current-month debt payment transactions:', value: '' },
    ];

    debtPaymentBreakdown.forEach(({ cardName, amount }) => {
      lines.push({ label: `  ${cardName}`, value: formatCurrency(amount, false), op: '+' });
    });

    if (debtPaymentBreakdown.length === 0) {
      lines.push({ label: '  No debt payments this month', value: '$0' });
    }

    lines.push({ label: 'Total Debt Payments', value: formatCurrency(totalDebtPayments, false), op: '=' });
    setCalcDrawer({ title: 'Debt Payments', lines });
  };

  const openNetWorthCalc = () => {
    const active = accounts.filter((a: any) => a.active);
    const lines: { label: string; value: string; op?: string }[] = [];

    const assetAccts = active.filter((a: any) => !['credit_card', 'student_loan', 'auto_loan', 'other_liability'].includes(a.account_type));
    const liabAccts = active.filter((a: any) => ['credit_card', 'student_loan', 'auto_loan', 'other_liability'].includes(a.account_type));

    lines.push({ label: `Assets (${assetAccts.length} accounts)`, value: '' });
    assetAccts.forEach((a: any) => lines.push({ label: `  ${a.name}`, value: formatCurrency(Number(a.balance), false), op: '+' }));

    lines.push({ label: 'Total Assets', value: formatCurrency(accountSummary.totalAssets, false), op: '=' });
    lines.push({ label: `Liabilities (${liabAccts.length} accounts)`, value: '' });

    liabAccts.forEach((a: any) => lines.push({ label: `  ${a.name}`, value: formatCurrency(Number(a.balance), false), op: '−' }));

    lines.push({ label: 'Total Liabilities', value: formatCurrency(accountSummary.totalLiabilities, false), op: '=' });
    lines.push({ label: 'Net Worth', value: formatCurrency(accountSummary.netWorth, false), op: '=' });

    setCalcDrawer({ title: 'Net Worth', lines });
  };

  const openLiquidCashCalc = () => {
    const active = accounts.filter((a: any) => a.active && ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'].includes(a.account_type));
    const lines: { label: string; value: string; op?: string }[] = [];

    active.forEach((a: any) => lines.push({ label: a.name, value: formatCurrency(Number(a.balance), false), op: '+' }));
    lines.push({ label: 'Total Liquid Cash', value: formatCurrency(accountSummary.liquidCash, false), op: '=' });

    setCalcDrawer({ title: 'Liquid Cash', lines });
  };

  if (essentialLoading) {
    return (
      <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-8 overflow-x-hidden">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-48 bg-muted/50 rounded animate-pulse" />
            <div className="h-4 w-64 bg-muted/50 rounded animate-pulse mt-2" />
          </div>
          <div className="h-9 w-36 bg-muted/50 rounded animate-pulse" />
        </div>
        <ScheduleSkeleton />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <MetricSkeleton key={i} />)}
        </div>
        <ChartSkeleton />
      </div>
    );
  }

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-8 overflow-x-hidden">
      {!isDemo && <AppTour variant="new-user" />}
      <AccountUpdateReminder />

      {!isDemo && showSecurityBanner && (
        <div className="flex items-start justify-between gap-3 bg-amber-500/8 border border-amber-500/25 px-4 py-3" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-start gap-3">
            <Shield size={15} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-600">Your account has no two-factor protection</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Adding 2FA takes under a minute and significantly reduces the risk of unauthorized access.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/settings#security"
              className="flex items-center gap-1.5 bg-amber-500 text-white px-3 py-1.5 text-[10px] font-semibold hover:bg-amber-600 transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Shield size={10} /> Secure my account
            </Link>
            <button
              onClick={() => setShowSecurityBanner(false)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {!isDemo && accounts.length === 0 && debts.length === 0 && goals.length === 0 && (
        <div className="card-forged p-4 border-primary/20 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 bg-primary rounded-full shrink-0" />
            <p className="text-xs font-semibold">Get started — set up your financial profile</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Add your accounts', desc: 'Checking, savings, credit cards, and more', path: '/accounts', done: accounts.length > 0 },
              { label: 'Set income in Budget Control', desc: 'Gross pay, deductions, and recurring expenses', path: '/budget', done: Boolean((profile as any)?.gross_income > 0) },
              { label: 'Add savings goals', desc: 'Emergency fund, vacation, down payment', path: '/savings', done: goals.length > 0 },
              { label: 'Track your debts', desc: 'Credit cards and loans for the payoff engine', path: '/debt', done: debts.length > 0 },
            ].map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-start gap-3 p-3 border transition-colors btn-press ${item.done ? 'border-success/30 bg-success/5 opacity-60' : 'border-border hover:border-primary/30 hover:bg-primary/5'}`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${item.done ? 'bg-success border-success' : 'border-muted-foreground'}`}>
                  {item.done && <Check size={9} className="text-white" />}
                </div>
                <div>
                  <p className="text-xs font-medium">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Updated mobile-friendly header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-xl sm:text-2xl lg:text-3xl tracking-tight">
                Command Center
              </h1>
              <InstructionsModal
                pageTitle="Dashboard Guide"
                sections={[
                  { title: 'What is this page?', body: 'The Command Center gives you a real-time snapshot of your financial health — income, expenses, net worth, savings, debt, and upcoming bills for the current month.' },
                  { title: 'KPI Cards', body: 'Click any metric card to see exactly how it is calculated, including which accounts and transactions are included.' },
                  { title: 'Projected Month-End Cash', body: 'Shows your expected cash position at month end: current liquid cash + remaining paychecks − remaining expenses − debt payments. Must stay above your cash floor.' },
                  { title: 'Cash Flow Chart', body: 'Displays the last 6 months of income vs expenses with net cash flow trend line.' },
                  { title: 'How edits affect this page', body: 'Changes to Accounts, Budget Control rules, or Debt Payoff recommendations instantly update all dashboard metrics.' },
                ]}
              />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Your financial control system &bull; {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {(isPremium || isDemo) && (
              <button
                onClick={() =>
                  exportDashboardPdf({
                    month: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                    liquidCash: accountSummary.liquidCash,
                    netWorth: accountSummary.netWorth,
                    income: summary.income,
                    expenses: summary.expenses,
                    totalDebtPayments,
                    savingsRate: summary.savingsRate,
                    totalSaved: summary.totalSaved,
                    ccDebt: accountSummary.ccDebt ?? 0,
                  })
                }
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2 text-xs font-medium btn-press hover:border-primary/40 hover:text-primary transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={13} /> PDF
              </button>
            )}

            <Link
              to="/transactions"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Plus size={14} /> Add Transaction
            </Link>
          </div>
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-4">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Jordan&apos;s Story — How it all connects</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                26 y/o with $12,700 in CC debt, a steady paycheck, and a plan to be debt-free in under a year.
                Every number here is live-calculated from the data below.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: 'Budget Control', desc: 'Recurring rules define income, bills, and transfers — this is the engine behind every projection.', path: '/budget' },
              { label: 'Debt Payoff', desc: 'Avalanche engine computes how fast each card gets paid using every dollar above the cash floor.', path: '/debt' },
              { label: 'Forecast', desc: '36-month sim. Debt payoff adjusts monthly so end cash never sits idle — it goes straight to debt.', path: '/forecast' },
              { label: 'Transactions', desc: 'One-time income (tax refund, bonus) and expenses update cash flow and feed the debt engine.', path: '/transactions' },
              { label: 'Savings & Car Fund', desc: 'Goals track toward specific targets. The car fund models the full purchase: down payment + loan.', path: '/savings' },
              { label: 'Net Worth', desc: 'Weekly snapshots plot the trajectory — watches Jordan cross zero and start building real wealth.', path: '/net-worth' },
            ].map(f => (
              <Link key={f.path} to={f.path} className="group flex gap-2.5 p-3 bg-secondary/40 hover:bg-secondary/70 transition-colors btn-press" style={{ borderRadius: 'var(--radius)' }}>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-primary group-hover:underline">{f.label} →</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{f.desc}</p>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">All data is fictional and resets when you close the tab.</p>
            <Link to="/auth" className="text-[11px] font-semibold text-primary hover:underline">
              Set up your own profile →
            </Link>
          </div>
        </div>
      )}

      {rulesLoading ? (
        <ScheduleSkeleton />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card-forged p-4 cursor-pointer hover:border-primary/20 transition-colors" onClick={() => navigate('/budget')}>
            <div className="flex items-center gap-2 mb-1"><CalendarDays size={12} className="text-primary" /><p className="text-[10px] text-muted-foreground uppercase">Next Paycheck</p></div>
            <p className="text-sm font-display font-bold text-success">{formatCurrency(paycheckNet, false)}</p>
            <p className="text-[10px] text-muted-foreground">{nextPayday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          </div>
          <div className="card-forged p-4 cursor-pointer hover:border-primary/20 transition-colors" onClick={() => navigate('/transactions')}>
            <div className="flex items-center gap-2 mb-1"><AlertTriangle size={12} className="text-destructive" /><p className="text-[10px] text-muted-foreground uppercase">Bills This Week</p></div>
            <p className="text-sm font-display font-bold text-destructive">{formatCurrency(upcomingBillsWeek.reduce((s, e) => s + e.amount, 0), false)}</p>
            <p className="text-[10px] text-muted-foreground">{upcomingBillsWeek.length} upcoming</p>
          </div>
          <div className="card-forged p-4 cursor-pointer hover:border-primary/20 transition-colors" onClick={() => navigate('/transactions')}>
            <div className="flex items-center gap-2 mb-1"><Repeat size={12} className="text-primary" /><p className="text-[10px] text-muted-foreground uppercase">Bills This Month</p></div>
            <p className="text-sm font-display font-bold text-foreground">{formatCurrency(upcomingBillsMonth.reduce((s, e) => s + e.amount, 0), false)}</p>
            <p className="text-[10px] text-muted-foreground">{upcomingBillsMonth.length} scheduled</p>
          </div>
          <div className="card-forged p-4 cursor-pointer hover:border-primary/20 transition-colors group" onClick={openMonthEndCalc}>
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={12} className="text-primary" />
              <p className="text-[10px] text-muted-foreground uppercase">Projected Month-End Cash</p>
              <Info size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className={`text-sm font-display font-bold ${monthEndCash >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(monthEndCash, false)}</p>
            <p className="text-[10px] text-muted-foreground">After all scheduled items</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ClickableMetric onClick={openLiquidCashCalc} tooltip="View liquid cash breakdown">
          <MetricCard label="Liquid Cash" value={formatCurrency(accountSummary.liquidCash, false)} accent="success" icon={DollarSign} />
        </ClickableMetric>
        <ClickableMetric onClick={openIncomeCalc} tooltip="How income is calculated">
          <MetricCard label="Monthly Income" value={summary.income > 0 ? formatCurrency(summary.income, false) : '—'} accent="success" icon={TrendingUp} />
        </ClickableMetric>
        <ClickableMetric onClick={openExpenseCalc} tooltip="How expenses are calculated">
          <MetricCard label="Monthly Expenses" value={summary.expenses > 0 ? formatCurrency(summary.expenses, false) : '—'} accent="crimson" icon={CreditCard} />
        </ClickableMetric>
        <ClickableMetric onClick={openDebtPaymentsCalc} tooltip="View debt payment breakdown by card">
          <MetricCard label="Debt Payments" value={totalDebtPayments > 0 ? formatCurrency(totalDebtPayments, false) : '—'} accent="silver" icon={Landmark} />
        </ClickableMetric>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ClickableMetric onClick={openNetWorthCalc} tooltip="How net worth is calculated">
          <MetricCard label="Net Worth" value={formatCurrency(accountSummary.netWorth, false)} accent={accountSummary.netWorth >= 0 ? 'gold' : 'crimson'} icon={Wallet} />
        </ClickableMetric>
        <ClickableMetric to="/budget" tooltip="Savings rate = (income - expenses) / income">
          <MetricCard label="Savings Rate" value={summary.income > 0 ? `${summary.savingsRate.toFixed(1)}%` : '—'} accent="gold" icon={Percent} />
        </ClickableMetric>
        <ClickableMetric to="/debt" tooltip="Credit card balances / total limits">
          <MetricCard
            label="Credit Utilization"
            value={`${utilization.toFixed(1)}%`}
            accent={utilization > 30 ? 'crimson' : 'success'}
            sub={`${formatCurrency(accountSummary.ccDebt, false)} / ${formatCurrency(accountSummary.ccLimit, false)}`}
            icon={CreditCard}
          />
        </ClickableMetric>
        {goalsLoading ? (
          <MetricSkeleton />
        ) : (
          <ClickableMetric to="/savings" tooltip="Total saved across all goals">
            <MetricCard label="Total Saved" value={formatCurrency(summary.totalSaved, false)} accent="success" sub={`${goals.length} goals`} icon={PiggyBank} />
          </ClickableMetric>
        )}
        <ClickableMetric to="/budget" tooltip="Monthly recurring subscription costs">
          <MetricCard label="Subscriptions" value={formatCurrency(subTotal, false)} accent="gold" sub="Monthly recurring" icon={Repeat} />
        </ClickableMetric>
      </div>

      {carGoalData && (
        <div className="card-forged p-5 cursor-pointer hover:border-primary/20 transition-colors" onClick={() => navigate('/savings')}>
          <div className="flex items-center gap-2 mb-4">
            <Car size={14} className="text-primary" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Car Goal: {carGoalData.name}</h3>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Saved</p>
              <p className="text-lg font-display font-bold text-primary">{formatCurrency(carGoalData.saved, false)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Down Payment Goal</p>
              <p className="text-lg font-display font-bold text-foreground">{formatCurrency(carGoalData.target, false)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Progress</p>
              <p className="text-lg font-display font-bold text-success">{carGoalData.target > 0 ? `${((carGoalData.saved / carGoalData.target) * 100).toFixed(0)}%` : '0%'}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Est. Monthly Pmt</p>
              <p className="text-lg font-display font-bold text-destructive">
                {formatCurrency(calculateMonthlyPayment(carGoalData.price - carGoalData.target, carGoalData.apr, carGoalData.term), true)}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <ProgressBar value={carGoalData.saved} max={carGoalData.target} color="gold" />
          </div>
        </div>
      )}

      {!rulesLoading && upcomingBillsWeek.length > 0 && (
        <div className="card-forged p-4 cursor-pointer hover:border-primary/20 transition-colors" onClick={() => navigate('/transactions')}>
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Upcoming This Week</h3>
          <div className="space-y-1">
            {upcomingBillsWeek.slice(0, 5).map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-xs">
                <div>
                  <span className="font-medium">{e.name}</span>
                  <span className="text-muted-foreground ml-2">{formatDateShort(e.date)}</span>
                  {e.source && <span className="text-muted-foreground ml-2">· {e.source}</span>}
                </div>
                <span className="font-display font-bold text-destructive">{formatCurrency(e.amount, false)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-forged p-5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Cash Flow Overview</h3>
        {cashFlowData.some(d => d.income > 0 || d.expenses > 0) ? (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={cashFlowData} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="income" name="Income" fill="hsl(142, 50%, 40%)" radius={[2, 2, 0, 0]} barSize={20} />
              <Bar dataKey="expenses" name="Expenses" fill="hsl(0, 73%, 35%)" radius={[2, 2, 0, 0]} barSize={20} />
              <Line dataKey="net" name="Net Cash Flow" stroke="hsl(43, 56%, 52%)" strokeWidth={2} dot={{ r: 4, fill: 'hsl(43, 56%, 52%)' }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-8">No transaction data yet. Add transactions or set up recurring rules in Budget Control.</p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card-forged p-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Spending by Category</h3>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryData} layout="vertical" margin={{ left: 0, right: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CategoryTooltip />} />
                <Bar dataKey="value" radius={[0, 2, 2, 0]} barSize={14}>
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? 'hsl(43, 56%, 52%)' : i === 1 ? 'hsl(43, 56%, 42%)' : 'hsl(0, 0%, 22%)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">No expenses recorded yet.</p>
          )}
        </div>

        <div className="card-forged p-5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Transactions</h3>
            <Link to="/transactions" className="text-[10px] text-primary hover:underline font-medium">View All</Link>
          </div>
          <div className="space-y-1">
            {recentTxns.map((t: any) => (
              <div
                key={t.id}
                className="flex items-center justify-between py-2.5 px-2 border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center ${t.type === 'income' ? 'bg-success/10' : 'bg-muted'}`}>
                    {t.type === 'income' ? <ArrowUpRight size={14} className="text-success" /> : <CategoryIcon category={t.category} size={14} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-medium">{t.note || '—'}</p>
                      {t.isGenerated && <Repeat size={9} className="text-primary" />}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{t.category}</p>
                  </div>
                </div>
                <span className={`text-xs font-bold font-display ${t.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {t.type === 'income' ? '+' : '-'}{formatCurrency(Number(t.amount), false)}
                </span>
              </div>
            ))}
            {recentTxns.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No transactions yet.</p>}
          </div>
        </div>
      </div>

      {goalsLoading ? (
        <ChartSkeleton height={120} />
      ) : (
        <div className="card-forged p-5 cursor-pointer hover:border-primary/20 transition-colors" onClick={() => navigate('/savings')}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Goal Progress</h3>
          <div className="grid md:grid-cols-3 gap-5">
            {[
  ...goals.slice(0, 2),
  ...(carFunds[0]
    ? [
        {
          id: 'car-dash',
          name: carFunds[0].vehicle_name,
          current_amount: carFunds[0].current_saved,
          target_amount: carFunds[0].down_payment_goal,
          isCar: true,
        },
      ]
    : []),
].slice(0, 3).map((g: any) => {
              const pct = Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0;
              return (
                <div key={g.id} className="space-y-3 p-4 bg-muted/30 border border-border" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      {g.isCar && <Car size={11} className="text-primary" />}
                      {g.name}
                    </span>
                    <span className="text-xs font-bold text-primary">{pct}%</span>
                  </div>
                  <ProgressBar value={Number(g.current_amount)} max={Number(g.target_amount)} thick showLabel />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{formatCurrency(Number(g.current_amount), false)}</span>
                    <span>{formatCurrency(Number(g.target_amount), false)}</span>
                  </div>
                </div>
              );
            })}
            {goals.length === 0 && !carFunds[0] && <p className="text-xs text-muted-foreground col-span-3 text-center py-4">No savings goals yet.</p>}
          </div>
        </div>
      )}

      <PremiumGate
        isPremium={isPremium || isDemo}
        title="Advanced Analytics"
        features={[
          'Weekly take-home after taxes — see your real pay each cycle',
          'Projected annual savings based on your live cash flow',
          'Total debt at a glance — all accounts in one number',
        ]}
      >
        <div className="card-forged p-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Advanced Analytics</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <MetricCard label="Weekly Take-Home" value={formatCurrency(paycheckNet, false)} accent="gold" icon={DollarSign} />
            <MetricCard label="Projected Annual Savings" value={formatCurrency(summary.cashFlow * 12, false)} accent="success" icon={TrendingUp} />
            {debtsLoading ? (
              <MetricSkeleton />
            ) : (
              <MetricCard label="Total Debt" value={formatCurrency(summary.totalDebt, false)} accent="crimson" sub={`${debts.length} active debts`} icon={Landmark} />
            )}
          </div>
        </div>
      </PremiumGate>

      {calcDrawer && (
  <CalcDrawer
    open={true}
    onClose={() => setCalcDrawer(null)}
    title={calcDrawer.title}
    lines={calcDrawer.lines}
  />
)}
    </div>
  );
}