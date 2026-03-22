import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import MetricCard from '@/components/shared/MetricCard';
import FormModal from '@/components/shared/FormModal';
import { toast } from 'sonner';
import { useProfile, useAccounts, useRecurringRules, useSubscriptions, useDebts } from '@/hooks/useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Wallet, TrendingDown, DollarSign, PiggyBank, Plus, Edit2, Trash2, Copy,
  CalendarDays, Pause, Play, ArrowLeftRight, CreditCard, Info, X,
} from 'lucide-react';
import { getDayName } from '@/lib/scheduling';
import { CATEGORIES } from '@/lib/types';
import { buildCardData, generateRecommendations, getCurrentMonthDebtRecommendations } from '@/lib/credit-card-engine';
import { buildPayConfig, getPaycheckNet, getRemainingIncomeThisMonth, getRemainingPaychecksThisMonth, getNextPaycheckDate, getPaychecksInMonth, getPrePaycheckNextMonthBills, getRemainingTransactionIncomeThisMonth, getRemainingTransactionExpensesThisMonth, getRemainingTransactionDebtPaymentsThisMonth, mergeWithGeneratedTransactions, createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, type PayFrequency } from '@/lib/pay-schedule';
import { useTransactions } from '@/hooks/useSupabaseData';

const emptyRuleForm = {
  name: '', amount: '', rule_type: 'expense', frequency: 'monthly',
  due_day: '1', due_month: '', category: 'Other', payment_source: '', deposit_account: '', notes: '', start_date: '',
};

const DEFAULT_STARTER_RULES = [
  { name: 'Weekly Paycheck', amount: 1875, rule_type: 'income', frequency: 'weekly', due_day: 5, category: 'Other', notes: 'Friday deposits' },
  { name: 'Rent', amount: 1400, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Bills' },
  { name: 'Utilities', amount: 150, rule_type: 'expense', frequency: 'monthly', due_day: 15, category: 'Bills' },
  { name: 'Groceries', amount: 400, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Groceries' },
  { name: 'Gas / Transport', amount: 200, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Gas' },
  { name: 'Dining Out', amount: 150, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Dining' },
  { name: 'Insurance', amount: 280, rule_type: 'expense', frequency: 'monthly', due_day: 14, category: 'Bills' },
  { name: 'Subscriptions', amount: 50, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Subscriptions' },
  { name: 'Miscellaneous', amount: 100, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Other' },
];

// Calc detail drawer
function CalcDrawer({ open, onClose, title, lines }: { open: boolean; onClose: () => void; title: string; lines: { label: string; value: string; op?: string }[] }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card-forged p-6 w-full max-w-md space-y-3 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2"><Info size={14} className="text-primary" /> {title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="space-y-2 pt-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                {l.op && <span className="text-primary font-bold">{l.op}</span>}
                {l.label}
              </span>
              <span className="text-xs font-display font-bold text-foreground">{l.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BudgetControl() {
  const { user, isDemo } = useAuth();
  const { data: profile, update: updateProfile } = useProfile();
  const { data: accounts } = useAccounts();
  const { data: rules, add: addRule, update: updateRule, remove: removeRule, loading: rulesLoading } = useRecurringRules();
  const { data: subs } = useSubscriptions();
  const { data: debts } = useDebts();

  // Income state
  const [weeklyGross, setWeeklyGross] = useState(1875);
  const [taxRate, setTaxRate] = useState(22);
  const [paycheckDay, setPaycheckDay] = useState(5);
  const [payFrequency, setPayFrequency] = useState<PayFrequency>('weekly');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Calc drawer
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);

  // Rule form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyRuleForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [starterSeeded, setStarterSeeded] = useState(false);
  const profileLoaded = useRef(false);

  useEffect(() => {
    if (profile) {
      setWeeklyGross(Number((profile as any).weekly_gross_income) || 1875);
      setTaxRate(Number((profile as any).tax_rate) || 22);
      setPaycheckDay(Number((profile as any).paycheck_day) || 5);
      setPayFrequency(((profile as any).paycheck_frequency as PayFrequency) || 'weekly');
      profileLoaded.current = true;
    }
  }, [profile]);

  useEffect(() => {
    if (!rulesLoading && !isDemo && user && rules.length === 0 && !starterSeeded) {
      setStarterSeeded(true);
      DEFAULT_STARTER_RULES.forEach(r => {
        addRule.mutate({ ...r, active: true, due_month: null, payment_source: null, deposit_account: null, notes: r.notes || '' });
      });
    }
  }, [rulesLoading, isDemo, user, rules.length, starterSeeded]);

  // Auto-save income/tax with debounce + auto-sync income rule
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doAutoSave = useCallback((wg: number, tr: number, pd: number, pf: PayFrequency) => {
    if (!profileLoaded.current || isDemo) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      setAutoSaveStatus('saving');
      updateProfile.mutate({
        weekly_gross_income: wg,
        tax_rate: tr,
        paycheck_day: pd,
        paycheck_frequency: pf,
        gross_income: wg * 52 / 12,
        monthly_income_default: (wg * 52 / 12) * (1 - tr / 100),
      } as any, {
        onSuccess: () => {
          setAutoSaveStatus('saved');
          setTimeout(() => setAutoSaveStatus('idle'), 2000);
          // Auto-sync income rule to match top settings
          const incomeRule = rules.find((r: any) => r.rule_type === 'income' && r.active);
          if (incomeRule) {
            const netPerPaycheck = pf === 'biweekly' ? wg * 2 * (1 - tr / 100) : pf === 'monthly' ? wg * 52 / 12 * (1 - tr / 100) : wg * (1 - tr / 100);
            const needsUpdate = Number(incomeRule.amount) !== netPerPaycheck ||
              incomeRule.frequency !== pf ||
              incomeRule.due_day !== pd;
            if (needsUpdate) {
              updateRule.mutate({
                id: incomeRule.id,
                amount: Math.round(netPerPaycheck * 100) / 100,
                frequency: pf,
                due_day: pd,
              });
            }
          }
        },
        onError: () => setAutoSaveStatus('idle'),
      });
    }, 800);
  }, [isDemo, updateProfile, rules, updateRule]);

  const setWeeklyGrossAuto = (v: number) => { setWeeklyGross(v); doAutoSave(v, taxRate, paycheckDay, payFrequency); };
  const setTaxRateAuto = (v: number) => { setTaxRate(v); doAutoSave(weeklyGross, v, paycheckDay, payFrequency); };
  const setPaycheckDayAuto = (v: number) => { setPaycheckDay(v); doAutoSave(weeklyGross, taxRate, v, payFrequency); };
  const setPayFrequencyAuto = (v: PayFrequency) => { setPayFrequency(v); doAutoSave(weeklyGross, taxRate, paycheckDay, v); };

  // Unified pay schedule
  const payConfig = useMemo(() => ({
    weeklyGross, taxRate, paycheckDay, frequency: payFrequency,
  }), [weeklyGross, taxRate, paycheckDay, payFrequency]);

  const paycheckNet = useMemo(() => getPaycheckNet(payConfig), [payConfig]);
  const now = new Date();
  const monthlyTakeHome = useMemo(() => {
    const paychecks = getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth());
    return paychecks.reduce((s, p) => s + p.net, 0);
  }, [payConfig]);
  const remainingIncome = useMemo(() => getRemainingIncomeThisMonth(payConfig), [payConfig]);
  const remainingPaychecks = useMemo(() => getRemainingPaychecksThisMonth(payConfig), [payConfig]);
  const nextPayday = useMemo(() => getNextPaycheckDate(payConfig), [payConfig]);

  const monthlyGross = useMemo(() => {
    const paychecks = getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth());
    return paychecks.reduce((s, p) => s + p.gross, 0);
  }, [payConfig]);
  const annualGross = weeklyGross * 52;
  const annualTakeHome = weeklyGross * (1 - taxRate / 100) * 52;

  // Merge subscriptions into fixed rules view
  const subsAsRules = useMemo(() => subs.filter((s: any) => s.active).map((s: any) => ({
    id: `sub:${s.id}`,
    name: s.name,
    amount: s.billing === 'yearly' ? Number(s.cost) : Number(s.cost),
    rule_type: 'expense',
    frequency: s.billing === 'yearly' ? 'yearly' : 'monthly',
    due_day: s.renewal_date ? new Date(s.renewal_date + 'T12:00:00').getDate() : 1,
    due_month: s.billing === 'yearly' && s.renewal_date ? new Date(s.renewal_date + 'T12:00:00').getMonth() + 1 : null,
    category: 'Subscriptions',
    payment_source: null,
    deposit_account: null,
    notes: 'From Subscriptions',
    active: s.active,
    isSub: true,
  })), [subs]);

  // Auto-pull debt payments from Debt Payoff recommendations (with full params)
  const { data: txns } = useTransactions();

  // Base transaction stream (recurring rules merged with real DB transactions)
  const baseTxns = useMemo(() =>
    mergeWithGeneratedTransactions(txns || [], rules, accounts),
    [txns, rules, accounts],
  );

  // Compute debt recommendations using shared helper
  const debtRecommendations = useMemo(() =>
    getCurrentMonthDebtRecommendations(accounts, baseTxns, rules, debts, profile),
    [accounts, baseTxns, rules, debts, profile],
  );

  const debtPaymentRules = useMemo(() =>
    debtRecommendations.map(r => ({
      id: `debt:${r.cardId}`,
      name: `${r.cardName} Payment`,
      amount: Math.round(r.payment * 100) / 100,
      rule_type: 'debt_payment',
      frequency: 'monthly',
      due_day: r.dueDay || 1,
      due_month: null,
      category: 'Debt Payments',
      payment_source: null,
      deposit_account: null,
      notes: r.reason,
      active: true,
      isDebtSync: true,
    })),
    [debtRecommendations],
  );

  // Inject debt payment transactions into the stream
  const debtPaymentTxns = useMemo(() => {
    const fundId = (profile as any)?.default_deposit_account ||
      accounts.find((a: any) => a.account_type === 'checking' && a.active)?.id || null;
    return createDebtPaymentTransactions(debtRecommendations, fundId);
  }, [debtRecommendations, profile, accounts]);

  // Full transaction stream with debt payments — single source of truth
  const allMonthTransactions = useMemo(() =>
    mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTxns),
    [baseTxns, debtPaymentTxns],
  );

  // Rules by category
  const incomeRules = useMemo(() => rules.filter((r: any) => r.rule_type === 'income'), [rules]);
  const fixedRules = useMemo(() => {
    const fixed = rules.filter((r: any) => r.rule_type === 'expense' && ['Bills', 'Subscriptions', 'Debt Payments'].includes(r.category));
    const ruleNames = new Set(fixed.map((r: any) => r.name.toLowerCase()));
    const uniqueSubs = subsAsRules.filter(s => !ruleNames.has(s.name.toLowerCase()));
    return [...fixed, ...uniqueSubs];
  }, [rules, subsAsRules]);
  const variableRules = useMemo(() => rules.filter((r: any) => r.rule_type === 'expense' && !['Bills', 'Subscriptions', 'Debt Payments'].includes(r.category)), [rules]);
  
  const manualDebtRules = useMemo(() => rules.filter((r: any) => r.rule_type === 'debt_payment' || (r.rule_type === 'expense' && r.category === 'Debt Payments')), [rules]);
  const debtRules = useMemo(() => {
    const manualNames = new Set(manualDebtRules.map((r: any) => r.name.toLowerCase()));
    const uniqueDebtSync = debtPaymentRules.filter(d => !manualNames.has(d.name.toLowerCase()));
    return [...manualDebtRules, ...uniqueDebtSync];
  }, [manualDebtRules, debtPaymentRules]);
  
  const transferRules = useMemo(() => rules.filter((r: any) => r.rule_type === 'transfer' || r.rule_type === 'investment'), [rules]);

  const toMonthly = (r: any) => {
    const amt = Number(r.amount);
    if (r.frequency === 'weekly') return amt * 4.33;
    if (r.frequency === 'yearly') return amt / 12;
    return amt;
  };

  const currentMonthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  
  const toCurrentMonthAmount = (r: any) => {
    const amt = Number(r.amount);
    if (r.start_date) {
      const startDate = new Date(r.start_date + 'T12:00:00');
      if (startDate > new Date(now.getFullYear(), now.getMonth() + 1, 0)) return 0;
    }
    if (r.frequency === 'weekly') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      let count = 0;
      const d = new Date(monthStart);
      const dayOfWeek = r.due_day ?? 5;
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= monthEnd) { count++; d.setDate(d.getDate() + 7); }
      return amt * count;
    }
    if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      return dueMonth === now.getMonth() ? amt : 0;
    }
    return amt;
  };

  const totalRecurringIncome = useMemo(() => incomeRules.filter((r: any) => r.active).reduce((s: number, r: any) => s + toCurrentMonthAmount(r), 0), [incomeRules]);
  const totalFixedExpenses = useMemo(() => fixedRules.filter((r: any) => r.active).reduce((s: number, r: any) => s + toCurrentMonthAmount(r), 0), [fixedRules]);
  const totalVariableExpenses = useMemo(() => variableRules.filter((r: any) => r.active).reduce((s: number, r: any) => s + toCurrentMonthAmount(r), 0), [variableRules]);
  const totalDebtPayments = useMemo(() => debtRules.filter((r: any) => r.active).reduce((s: number, r: any) => s + toCurrentMonthAmount(r), 0), [debtRules]);
  const totalTransfers = useMemo(() => transferRules.filter((r: any) => r.active).reduce((s: number, r: any) => s + toCurrentMonthAmount(r), 0), [transferRules]);

  const totalExpenses = totalFixedExpenses + totalVariableExpenses + totalDebtPayments + totalTransfers;
  const remaining = monthlyTakeHome - totalExpenses;

  const fundingAccount = useMemo(() => {
    const defaultId = (profile as any)?.default_deposit_account;
    if (defaultId) {
      const acct = accounts.find((a: any) => a.id === defaultId);
      if (acct) return acct;
    }
    return accounts.find((a: any) => a.account_type === 'checking' && a.active) || null;
  }, [accounts, profile]);

  // Remaining Cash On Hand — uses funding account + Transactions as single source of truth
  const fundingAccountBalance = useMemo(() => {
    if (fundingAccount) return Number(fundingAccount.balance);
    const liquidTypes = ['checking', 'business_checking', 'cash'];
    return accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
  }, [accounts, fundingAccount]);

  const remainingTxIncome = useMemo(() => getRemainingTransactionIncomeThisMonth(allMonthTransactions), [allMonthTransactions]);
  const remainingTxExpenses = useMemo(() => getRemainingTransactionExpensesThisMonth(allMonthTransactions, true), [allMonthTransactions]);
  const remainingTxDebt = useMemo(() => getRemainingTransactionDebtPaymentsThisMonth(allMonthTransactions), [allMonthTransactions]);

  const remainingCashOnHand = fundingAccountBalance + remainingTxIncome - remainingTxExpenses - remainingTxDebt;

  const allAccountOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...accounts.filter((a: any) => a.active).map((a: any) => ({ value: a.id, label: `${a.name} (${a.account_type.replace(/_/g, ' ')})` })),
  ], [accounts]);

  const depositAccountOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...accounts.filter((a: any) => a.active && ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'].includes(a.account_type)).map((a: any) => ({ value: a.id, label: a.name })),
  ], [accounts]);

  const ruleTypeOptions = [
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
    { value: 'debt_payment', label: 'Debt Payment' },
    { value: 'transfer', label: 'Transfer' },
    { value: 'investment', label: 'Investment Contribution' },
  ];

  const openAdd = (type: string, category?: string) => {
    setForm({ ...emptyRuleForm, rule_type: type, category: category || 'Other' });
    setEditId(null);
    setShowForm(true);
  };

  const openEdit = (r: any) => {
    if (r.isSub || r.isDebtSync) return;
    setForm({
      name: r.name, amount: String(r.amount), rule_type: r.rule_type, frequency: r.frequency,
      due_day: String(r.due_day), due_month: String(r.due_month || ''), category: r.category,
      payment_source: r.payment_source || '', deposit_account: r.deposit_account || '', notes: r.notes || '',
      start_date: r.start_date || '',
    });
    setEditId(r.id);
    setShowForm(true);
  };

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (!form.name || isNaN(amount)) return;
    const payload: any = {
      name: form.name, amount, rule_type: form.rule_type, frequency: form.frequency,
      due_day: parseInt(form.due_day) || 1, due_month: form.due_month ? parseInt(form.due_month) : null,
      category: form.category, payment_source: form.payment_source || null,
      deposit_account: form.deposit_account || null, notes: form.notes, active: true,
      start_date: form.start_date || null,
    };
    if (editId) updateRule.mutate({ id: editId, ...payload });
    else addRule.mutate(payload);
    setShowForm(false);
    setEditId(null);
  };

  const toggleActive = (r: any) => {
    if (r.isSub || r.isDebtSync) return;
    updateRule.mutate({ id: r.id, active: !r.active });
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('sub:') || id.startsWith('debt:')) return;
    if (deleteConfirm === id) { removeRule.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const getAccountName = (id: string) => accounts.find((a: any) => a.id === id)?.name || '';
  const freqLabel = (f: string) => f === 'weekly' ? 'Weekly' : f === 'biweekly' ? 'Biweekly' : f === 'monthly' ? 'Monthly' : 'Yearly';

  const formFields = useMemo(() => {
    const fields: any[] = [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g., Rent, Paycheck', required: true },
      { key: 'amount', label: 'Amount', type: 'number', placeholder: '0.00', step: '0.01', required: true },
      { key: 'rule_type', label: 'Type', type: 'select', options: ruleTypeOptions },
      { key: 'frequency', label: 'Frequency', type: 'select', options: [{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Biweekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }] },
      { key: 'due_day', label: form.frequency === 'weekly' || form.frequency === 'biweekly' ? 'Day of Week (0=Sun, 5=Fri)' : 'Due Day of Month', type: 'number' },
    ];
    if (form.frequency === 'yearly') {
      fields.push({ key: 'due_month', label: 'Due Month (1-12)', type: 'number' });
    }
    fields.push({ key: 'category', label: 'Category', type: 'select', options: CATEGORIES.map(c => ({ value: c, label: c })) });
    
    if (form.rule_type === 'transfer' || form.rule_type === 'investment') {
      fields.push({ key: 'start_date', label: 'Start Date', type: 'date' });
    }
    
    if (form.rule_type === 'income') {
      fields.push({ key: 'deposit_account', label: 'Deposit Into', type: 'select', options: depositAccountOptions });
    } else if (form.rule_type === 'debt_payment' || form.rule_type === 'transfer' || form.rule_type === 'investment') {
      fields.push({ key: 'payment_source', label: 'Paid From', type: 'select', options: allAccountOptions });
      fields.push({ key: 'deposit_account', label: 'Apply To / Deposit Into', type: 'select', options: allAccountOptions });
    } else {
      fields.push({ key: 'payment_source', label: 'Charged To', type: 'select', options: allAccountOptions });
    }
    fields.push({ key: 'notes', label: 'Notes', type: 'text', placeholder: 'Optional' });
    return fields;
  }, [form.frequency, form.rule_type, allAccountOptions, depositAccountOptions]);

  const handleDuplicate = (r: any) => {
    if (r.isSub || r.isDebtSync) return;
    setForm({
      name: `${r.name} (Copy)`, amount: String(r.amount), rule_type: r.rule_type, frequency: r.frequency,
      due_day: String(r.due_day), due_month: String(r.due_month || ''), category: r.category,
      payment_source: r.payment_source || '', deposit_account: r.deposit_account || '', notes: r.notes || '',
      start_date: r.start_date || '',
    });
    setEditId(null);
    setShowForm(true);
    toast.info('Rule duplicated — edit and save');
  };

  // Calc detail openers
  const openCashCalc = () => setCalcDrawer({
    title: 'Remaining Cash On Hand',
    lines: [
      { label: `Funding Account Balance${fundingAccount ? ` (${fundingAccount.name})` : ''}`, value: formatCurrency(fundingAccountBalance, false) },
      { label: 'Remaining Income (from Transactions)', value: formatCurrency(remainingTxIncome, false), op: '+' },
      { label: 'Remaining Expenses (from Transactions)', value: formatCurrency(remainingTxExpenses, false), op: '−' },
      { label: 'Remaining Debt Payments (from Transactions)', value: formatCurrency(remainingTxDebt, false), op: '−' },
      { label: 'Remaining Cash On Hand', value: formatCurrency(remainingCashOnHand, false), op: '=' },
    ],
  });

  const openIncomeCalc = () => setCalcDrawer({
    title: 'Income This Month',
    lines: [
      { label: `Pay frequency: ${payFrequency}`, value: '' },
      { label: 'Net per paycheck (post-tax)', value: formatCurrency(paycheckNet, false) },
      { label: 'Paychecks this month', value: String(getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth()).length) },
      { label: 'Total monthly take-home', value: formatCurrency(monthlyTakeHome, false), op: '=' },
      ...incomeRules.filter((r: any) => r.active).map((r: any) => ({ label: `  Rule: ${r.name}`, value: formatCurrency(toCurrentMonthAmount(r), false), op: '+' })),
      { label: 'Total recurring income', value: formatCurrency(totalRecurringIncome, false), op: '=' },
    ],
  });

  const RuleRow = ({ r, color = 'text-destructive' }: { r: any; color?: string }) => (
    <div className={`flex items-center justify-between py-2.5 border-b border-border/50 last:border-0 ${!r.active ? 'opacity-40' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium truncate">{r.name}</p>
          {r.isSub && <span className="text-[9px] px-1 py-0.5 bg-accent/20 text-accent-foreground border border-accent/30" style={{ borderRadius: 'var(--radius)' }}>sub</span>}
          {r.isDebtSync && <span className="text-[9px] px-1 py-0.5 bg-primary/20 text-primary border border-primary/30" style={{ borderRadius: 'var(--radius)' }}>from payoff</span>}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">
          {freqLabel(r.frequency)} · Day {r.due_day}
          {r.due_month ? ` / Month ${r.due_month}` : ''}
          {r.start_date ? ` · Starts ${r.start_date}` : ''}
          {r.payment_source ? ` · From: ${getAccountName(r.payment_source)}` : ''}
          {r.deposit_account ? ` · To: ${getAccountName(r.deposit_account)}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <span className={`text-xs font-display font-bold ${color}`}>{formatCurrency(Number(r.amount), false)}</span>
        <span className="text-[10px] text-muted-foreground">/mo {formatCurrency(toMonthly(r), false)}</span>
        {!r.isSub && !r.isDebtSync && (
          <>
            <button onClick={() => handleDuplicate(r)} className="p-1 text-muted-foreground hover:text-primary" title="Duplicate"><Copy size={11} /></button>
            <button onClick={() => toggleActive(r)} className="p-1 text-muted-foreground hover:text-foreground">{r.active ? <Pause size={11} /> : <Play size={11} />}</button>
            <button onClick={() => openEdit(r)} className="p-1 text-muted-foreground hover:text-foreground"><Edit2 size={11} /></button>
            <button onClick={() => handleDelete(r.id)} className={`p-1 ${deleteConfirm === r.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={11} /></button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-3 sm:p-4 lg:p-8 max-w-5xl mx-auto space-y-4 sm:space-y-6 lg:space-y-8">
      <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-lg sm:text-2xl lg:text-3xl tracking-tight">Budget Control</h1>
          <p className="text-[10px] sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 truncate">Your single source of truth for income, expenses, and automation</p>
        </div>
        <InstructionsModal pageTitle="Budget Control Guide" sections={[
          { title: 'What is this page?', body: 'Budget Control is your hub for managing all recurring financial rules — income, fixed expenses, variable spending, debt payments, and transfers. It feeds the Dashboard, Forecast, and Transactions.' },
          { title: 'Income & Taxes', body: 'Set your gross income, pay frequency, tax rate, and payday at the top. Changes auto-save and automatically sync your income rule to match.' },
          { title: 'Budget Allocation Bar', body: 'Shows how your take-home is distributed across categories for the current month only. Colors: Red=Fixed, Orange=Variable, Blue=Debt, Purple=Transfers, Green=Remaining.' },
          { title: 'Remaining Cash On Hand', body: 'Uses only the selected funding account\'s live balance plus remaining income minus remaining expenses and remaining debt payments for the rest of the current month. All values come from Transactions as the single source of truth — no double counting with Budget Control rules.' },
          { title: 'How rules work', body: 'Rules auto-generate transactions. Weekly rules create 4-5 entries/month, monthly once, yearly once in the due month. Start dates control when rules activate.' },
          { title: 'One-Time Transactions', body: 'One-time manual transactions from Transactions are factored into Remaining Cash and debt recommendations. Future one-time purchases reduce available repayment cash.' },
        ]} />
      </div>

      {/* Income & Taxes — auto-saves */}
      <div className="card-forged p-3 sm:p-5 space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Income & Taxes</h3>
          {autoSaveStatus === 'saving' && <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>}
          {autoSaveStatus === 'saved' && <span className="text-[10px] text-success">✓ Saved</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Gross Income</label>
            <input type="number" value={weeklyGross} onChange={e => setWeeklyGrossAuto(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Pay Frequency</label>
            <select value={payFrequency} onChange={e => setPayFrequencyAuto(e.target.value as PayFrequency)}
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground" style={{ borderRadius: 'var(--radius)' }}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Tax Rate (%)</label>
            <input type="number" value={taxRate} onChange={e => setTaxRateAuto(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">{payFrequency === 'monthly' ? 'Pay Day of Month' : 'Paycheck Day'}</label>
            {payFrequency === 'monthly' ? (
              <input type="number" min={1} max={31} value={paycheckDay} onChange={e => setPaycheckDayAuto(parseInt(e.target.value) || 1)}
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
            ) : (
              <select value={paycheckDay} onChange={e => setPaycheckDayAuto(parseInt(e.target.value))}
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground" style={{ borderRadius: 'var(--radius)' }}>
                {[0,1,2,3,4,5,6].map(d => <option key={d} value={d}>{getDayName(d)}</option>)}
              </select>
            )}
          </div>
          <div className="flex flex-col justify-end">
            <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><CalendarDays size={10} /> Next Paycheck</p>
            <p className="text-sm font-display font-bold text-primary mt-1">{nextPayday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 pt-2 border-t border-border">
          <div className="text-center"><p className="text-[10px] text-muted-foreground">Per Paycheck (Net)</p><p className="text-xs font-display font-bold text-success">{formatCurrency(paycheckNet, false)}</p></div>
          <div className="text-center"><p className="text-[10px] text-muted-foreground">Monthly Gross</p><p className="text-xs font-display font-bold text-foreground">{formatCurrency(monthlyGross, false)}</p></div>
          <div className="text-center"><p className="text-[10px] text-muted-foreground">Monthly Take-Home</p><p className="text-xs font-display font-bold text-success">{formatCurrency(monthlyTakeHome, false)}</p></div>
          <div className="text-center"><p className="text-[10px] text-muted-foreground">Annual Gross</p><p className="text-xs font-display font-bold text-foreground">{formatCurrency(annualGross, false)}</p></div>
          <div className="text-center"><p className="text-[10px] text-muted-foreground">Annual Take-Home</p><p className="text-xs font-display font-bold text-success">{formatCurrency(annualTakeHome, false)}</p></div>
        </div>
      </div>

      {/* KPI Summary + Remaining Cash On Hand */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
        <div className="cursor-pointer" onClick={openIncomeCalc}>
          <MetricCard label="Monthly Take-Home" value={formatCurrency(monthlyTakeHome, false)} accent="success" icon={DollarSign} />
        </div>
        <MetricCard label="Fixed Expenses" value={formatCurrency(totalFixedExpenses, false)} accent="crimson" icon={TrendingDown} />
        <MetricCard label="Variable" value={formatCurrency(totalVariableExpenses, false)} accent="gold" icon={TrendingDown} />
        <MetricCard label="Debt Payments" value={formatCurrency(totalDebtPayments, false)} accent="crimson" icon={CreditCard} />
        <MetricCard label="Transfers" value={formatCurrency(totalTransfers, false)} accent="gold" icon={ArrowLeftRight} />
        <MetricCard label="Projected Remaining" value={formatCurrency(remaining, false)} accent={remaining >= 0 ? 'success' : 'crimson'} icon={PiggyBank} />
      </div>

      {/* Remaining Cash On Hand — prominent */}
      <div className="card-forged p-5 cursor-pointer hover:border-primary/20 transition-colors group" onClick={openCashCalc}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Wallet size={14} className="text-primary" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Remaining Cash On Hand</h3>
              <Info size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Funding account balance + remaining income − remaining expenses − debt payments (from Transactions)
              {fundingAccount && ` · Funding: ${fundingAccount.name}`}
            </p>
          </div>
          <p className={`text-2xl font-display font-bold ${remainingCashOnHand >= 0 ? 'text-success' : 'text-destructive'}`}>
            {formatCurrency(remainingCashOnHand, false)}
          </p>
        </div>
      </div>

      {/* Budget Allocation Bar — current month only, distinct colors */}
      <div className="card-forged p-5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Budget Allocation</h3>
        <p className="text-[10px] text-muted-foreground mb-4">{now.toLocaleString('en-US', { month: 'long', year: 'numeric' })} — current month only</p>
        <div className="w-full h-6 bg-secondary overflow-hidden flex" style={{ borderRadius: 'var(--radius)' }}>
          {monthlyTakeHome > 0 && (
            <>
              <div className="h-full transition-all" style={{ width: `${Math.min((totalFixedExpenses / monthlyTakeHome) * 100, 100)}%`, background: 'hsl(0, 65%, 45%)' }} title="Fixed" />
              <div className="h-full transition-all" style={{ width: `${Math.min((totalVariableExpenses / monthlyTakeHome) * 100, 100)}%`, background: 'hsl(35, 85%, 50%)' }} title="Variable" />
              <div className="h-full transition-all" style={{ width: `${Math.min((totalDebtPayments / monthlyTakeHome) * 100, 100)}%`, background: 'hsl(210, 70%, 50%)' }} title="Debt" />
              <div className="h-full transition-all" style={{ width: `${Math.min((totalTransfers / monthlyTakeHome) * 100, 100)}%`, background: 'hsl(280, 60%, 55%)' }} title="Transfers" />
              {remaining > 0 && <div className="h-full transition-all" style={{ width: `${Math.min((remaining / monthlyTakeHome) * 100, 100)}%`, background: 'hsl(142, 50%, 40%)' }} title="Remaining" />}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-4 mt-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(0, 65%, 45%)' }} /> Fixed ({monthlyTakeHome > 0 ? ((totalFixedExpenses / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(35, 85%, 50%)' }} /> Variable ({monthlyTakeHome > 0 ? ((totalVariableExpenses / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(210, 70%, 50%)' }} /> Debt ({monthlyTakeHome > 0 ? ((totalDebtPayments / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(280, 60%, 55%)' }} /> Transfers ({monthlyTakeHome > 0 ? ((totalTransfers / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(142, 50%, 40%)' }} /> Remaining ({monthlyTakeHome > 0 ? ((remaining / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
        </div>
      </div>

      {/* Tabbed Rule Management */}
      <Tabs defaultValue="income" className="space-y-4">
        <TabsList className="bg-secondary border border-border w-full justify-start overflow-x-auto flex-nowrap sm:flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="income" className="text-[11px] data-[state=active]:bg-background">Income ({incomeRules.length})</TabsTrigger>
          <TabsTrigger value="fixed" className="text-[11px] data-[state=active]:bg-background">Fixed ({fixedRules.length})</TabsTrigger>
          <TabsTrigger value="variable" className="text-[11px] data-[state=active]:bg-background">Variable ({variableRules.length})</TabsTrigger>
          <TabsTrigger value="debt" className="text-[11px] data-[state=active]:bg-background">Debt ({debtRules.length})</TabsTrigger>
          <TabsTrigger value="transfers" className="text-[11px] data-[state=active]:bg-background">Transfers ({transferRules.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="income">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Income Rules</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs font-display font-bold text-success">{formatCurrency(totalRecurringIncome, false)}/mo</span>
                <button onClick={() => openAdd('income')} className="flex items-center gap-1 text-[10px] text-primary font-medium hover:underline"><Plus size={10} /> Add Income</button>
              </div>
            </div>
            {incomeRules.length === 0 && <p className="text-[10px] text-muted-foreground">No income rules. Add one to auto-generate paychecks.</p>}
            {incomeRules.map((r: any) => <RuleRow key={r.id} r={r} color="text-success" />)}
          </div>
        </TabsContent>

        <TabsContent value="fixed">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fixed Expenses (incl. Subscriptions)</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs font-display font-bold text-destructive">{formatCurrency(totalFixedExpenses, false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Bills')} className="flex items-center gap-1 text-[10px] text-primary font-medium hover:underline"><Plus size={10} /> Add Fixed</button>
              </div>
            </div>
            {fixedRules.length === 0 && <p className="text-[10px] text-muted-foreground">No fixed expenses.</p>}
            {fixedRules.map((r: any) => <RuleRow key={r.id} r={r} />)}
          </div>
        </TabsContent>

        <TabsContent value="variable">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Variable Expenses</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs font-display font-bold" style={{ color: 'hsl(35, 85%, 50%)' }}>{formatCurrency(totalVariableExpenses, false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Other')} className="flex items-center gap-1 text-[10px] text-primary font-medium hover:underline"><Plus size={10} /> Add Variable</button>
              </div>
            </div>
            {variableRules.length === 0 && <p className="text-[10px] text-muted-foreground">No variable expenses.</p>}
            {variableRules.map((r: any) => <RuleRow key={r.id} r={r} color="text-foreground" />)}
          </div>
        </TabsContent>

        <TabsContent value="debt">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2"><CreditCard size={12} /> Debt Payments</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs font-display font-bold text-destructive">{formatCurrency(totalDebtPayments, false)}/mo</span>
                <button onClick={() => openAdd('debt_payment', 'Debt Payments')} className="flex items-center gap-1 text-[10px] text-primary font-medium hover:underline"><Plus size={10} /> Add Payment</button>
              </div>
            </div>
            {debtRules.length === 0 && <p className="text-[10px] text-muted-foreground">No debt payments. Add credit card accounts and visit Debt Payoff to generate recommendations.</p>}
            {debtRules.map((r: any) => <RuleRow key={r.id} r={r} />)}
            {debtPaymentRules.length > 0 && (
              <p className="text-[9px] text-muted-foreground pt-2 border-t border-border/30">
                Items tagged "from payoff" are auto-synced from the Debt Payoff Planner's avalanche recommendations.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transfers">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2"><ArrowLeftRight size={12} /> Transfers & Investing</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs font-display font-bold text-primary">{formatCurrency(totalTransfers, false)}/mo</span>
                <button onClick={() => openAdd('investment')} className="flex items-center gap-1 text-[10px] text-primary font-medium hover:underline"><Plus size={10} /> Add Transfer</button>
              </div>
            </div>
            {transferRules.length === 0 && <p className="text-[10px] text-muted-foreground">No transfers or investment contributions configured.</p>}
            {transferRules.map((r: any) => <RuleRow key={r.id} r={r} color="text-primary" />)}
          </div>
        </TabsContent>
      </Tabs>

      {showForm && (
        <FormModal
          title={editId ? 'Edit Rule' : 'Add Rule'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null); }}
          saving={addRule.isPending || updateRule.isPending}
          saveLabel={editId ? 'Update Rule' : 'Add Rule'}
        />
      )}

      <CalcDrawer
        open={!!calcDrawer}
        onClose={() => setCalcDrawer(null)}
        title={calcDrawer?.title || ''}
        lines={calcDrawer?.lines || []}
      />
    </div>
  );
}
