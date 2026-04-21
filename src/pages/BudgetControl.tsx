import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import MetricCard from '@/components/shared/MetricCard';
import FormModal from '@/components/shared/FormModal';
import { toast } from 'sonner';
import { useProfile, useAccounts, useRecurringRules, useSubscriptions, useDebts, useSavingsGoals } from '@/hooks/useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Wallet, TrendingDown, DollarSign, PiggyBank, Plus, Edit2, Trash2, Copy,
  CalendarDays, Pause, Play, ArrowLeftRight, CreditCard, Info, X,
} from 'lucide-react';
import { getDayName } from '@/lib/scheduling';
import { CATEGORIES } from '@/lib/types';
import { generateRecommendations, getCurrentMonthDebtRecommendations } from '@/lib/credit-card-engine';
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

// ── Paycheck Deduction types + catalog ───────────────────────────────────────
export type PaycheckDeduction = {
  id: string;
  label: string;
  value: number;
  mode: 'flat' | 'pct';
  preTax: boolean;
  accountId?: string; // linked investment/retirement account
  goalId?: string;    // linked savings goal (monthly_contribution auto-synced)
};

export const DEDUCTION_CATALOG: { label: string; mode: 'flat' | 'pct'; preTax: boolean }[] = [
  // Benefits
  { label: 'Medical Insurance',          mode: 'flat', preTax: true  },
  { label: 'Dental Insurance',           mode: 'flat', preTax: true  },
  { label: 'Vision Insurance',           mode: 'flat', preTax: true  },
  { label: 'Accident Insurance',         mode: 'flat', preTax: false },
  { label: 'Life Insurance',             mode: 'flat', preTax: false },
  { label: 'Short/Long-Term Disability', mode: 'flat', preTax: false },
  { label: 'Critical Illness Insurance', mode: 'flat', preTax: false },
  // Retirement & Savings
  { label: '401(k) Traditional',         mode: 'pct',  preTax: true  },
  { label: '401(k) Roth',                mode: 'pct',  preTax: false },
  { label: '403(b)',                      mode: 'pct',  preTax: true  },
  { label: 'HSA',                         mode: 'flat', preTax: true  },
  { label: 'FSA (Medical)',               mode: 'flat', preTax: true  },
  { label: 'FSA (Dependent Care)',        mode: 'flat', preTax: true  },
  // Taxes
  { label: 'Federal Withholding',                mode: 'flat', preTax: false },
  { label: 'Fed FICA Medicare (1.45%)',          mode: 'pct',  preTax: false },
  { label: 'Fed OASDI / Social Security (6.2%)', mode: 'pct',  preTax: false },
  { label: 'State Income Tax',                   mode: 'flat', preTax: false },
  // Other
  { label: 'Commuter Benefits', mode: 'flat', preTax: true  },
  { label: 'Parking Benefits',  mode: 'flat', preTax: true  },
  { label: 'Union Dues',        mode: 'flat', preTax: false },
  { label: 'Wage Garnishment',  mode: 'flat', preTax: false },
];

// All catalog items in the Taxes group (indices 13-16) — used to enforce post-tax and suppress Tax Rate field
const TAX_CATALOG_LABELS = new Set(DEDUCTION_CATALOG.slice(13, 17).map(c => c.label.toLowerCase()));

const DEFAULT_DEDUCTIONS: PaycheckDeduction[] = [
  { id: 'medical', label: 'Medical Insurance', value: 0, mode: 'flat', preTax: true },
  { id: 'dental',  label: 'Dental Insurance',  value: 0, mode: 'flat', preTax: true },
  { id: 'vision',  label: 'Vision Insurance',  value: 0, mode: 'flat', preTax: true },
  { id: '401k',    label: '401(k) Traditional', value: 0, mode: 'pct',  preTax: true },
  { id: 'hsa',     label: 'HSA',               value: 0, mode: 'flat', preTax: true },
];

function migrateOldDeductions(profile: any): PaycheckDeduction[] | null {
  const vals = [
    { id: '401k',    label: '401(k) Traditional', val: Number(profile?.deduction_401k_value), mode: profile?.deduction_401k_mode || 'pct',  preTax: profile?.deduction_401k_pretax  !== false },
    { id: 'hsa',     label: 'HSA',                val: Number(profile?.deduction_hsa),        mode: profile?.deduction_hsa_mode    || 'flat', preTax: profile?.deduction_hsa_pretax   !== false },
    { id: 'fsa',     label: 'FSA (Medical)',       val: Number(profile?.deduction_fsa),        mode: profile?.deduction_fsa_mode    || 'flat', preTax: profile?.deduction_fsa_pretax   !== false },
    { id: 'medical', label: 'Medical Insurance',   val: Number(profile?.deduction_medical),    mode: profile?.deduction_medical_mode || 'flat', preTax: profile?.deduction_medical_pretax !== false },
  ].filter(d => d.val > 0);
  if (vals.length === 0) return null;
  return vals.map(d => ({ id: d.id, label: d.label, value: d.val, mode: d.mode as 'flat' | 'pct', preTax: d.preTax }));
}

// ── Calc detail drawer ────────────────────────────────────────────────────────
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
              <span className="text-sm sm:text-base text-muted-foreground flex items-center gap-1.5">
                {l.op && <span className="text-primary font-bold">{l.op}</span>}
                {l.label}
              </span>
              <span className="text-sm sm:text-base font-display font-bold text-foreground">{l.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BudgetControl() {
  const { user, isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const { data: profile, update: updateProfile } = useProfile();
  const { data: accounts } = useAccounts();
  const { data: rules, add: addRule, update: updateRule, remove: removeRule, loading: rulesLoading } = useRecurringRules();
  const { data: savingsGoals, update: updateGoal } = useSavingsGoals();
  const { data: subs } = useSubscriptions();
  const { data: debts } = useDebts();

  // Income state
  const [weeklyGross, setWeeklyGross] = useState(1875);
  const [weeklyGrossInput, setWeeklyGrossInput] = useState('1875');
  const [taxRate, setTaxRate] = useState(22);
  const [paycheckDay, setPaycheckDay] = useState(5);
  const [payFrequency, setPayFrequency] = useState<PayFrequency>('weekly');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Dynamic paycheck deductions
  const [deductions, setDeductions] = useState<PaycheckDeduction[]>(DEFAULT_DEDUCTIONS);
  const [showCatalog, setShowCatalog] = useState(false);
  const [customLabel, setCustomLabel] = useState('');

  // Paycheck rule lock — ID of the single income rule auto-synced by income settings
  const [paycheckRuleId, setPaycheckRuleId] = useState<string | null>(null);

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
      const wg = Number((profile as any).weekly_gross_income) || 1875;
      setWeeklyGross(wg);
      setWeeklyGrossInput(String(wg));
      setTaxRate(Number((profile as any).tax_rate) || 22);
      setPaycheckDay((profile as any).paycheck_day != null ? Number((profile as any).paycheck_day) : 5);
      setPayFrequency(((profile as any).paycheck_frequency as PayFrequency) || 'weekly');
      // Load deductions: prefer new JSONB column, migrate from legacy columns if needed
      const jsonDeds = (profile as any).paycheck_deductions as PaycheckDeduction[] | null;
      if (jsonDeds && jsonDeds.length > 0) {
        setDeductions(jsonDeds);
      } else {
        const migrated = migrateOldDeductions(profile);
        if (migrated) setDeductions(migrated);
        // else keep DEFAULT_DEDUCTIONS
      }
      // Load the designated paycheck rule ID
      setPaycheckRuleId((profile as any).paycheck_rule_id ?? null);
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
  const resolveAmt = (d: PaycheckDeduction, gross: number) =>
    d.mode === 'pct' ? gross * (d.value / 100) : d.value;

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doAutoSave = useCallback((
    wg: number, tr: number, pd: number, pf: PayFrequency, deds: PaycheckDeduction[],
  ) => {
    if (!profileLoaded.current || isDemo) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      setAutoSaveStatus('saving');
      const gross = pf === 'biweekly' ? wg * 2 : pf === 'monthly' ? wg * 52 / 12 : wg;
      const preTax  = deds.filter(d => d.preTax).reduce((s, d) => s + resolveAmt(d, gross), 0);
      const postTax = deds.filter(d => !d.preTax).reduce((s, d) => s + resolveAmt(d, gross), 0);
      // Federal Withholding / FICA / OASDI deductions replace the tax rate when active
      const taxDedActive = deds.some(d => /withholding|fica|oasdi/i.test(d.label) && d.value > 0);
      const effectiveTr = taxDedActive ? 0 : tr;
      const netPerPaycheck = (gross - preTax) * (1 - effectiveTr / 100) - postTax;
      const paychecksPerYear = pf === 'biweekly' ? 26 : pf === 'monthly' ? 12 : 52;
      // Backward-compat: keep legacy 401k columns so Forecast + use401kAutoUpdate still work
      const k401 = deds.find(d => d.id === '401k' || d.label.toLowerCase().includes('401(k) traditional') || d.label.toLowerCase().includes('401k'));
      // Resolve which rule is the designated paycheck rule (only that one gets synced)
      const targetRule = paycheckRuleId
        ? rules.find((r: any) => r.id === paycheckRuleId)
        : rules.find((r: any) => r.rule_type === 'income' && r.active);
      updateProfile.mutate({
        weekly_gross_income: wg,
        tax_rate: tr,
        paycheck_day: pd,
        paycheck_frequency: pf,
        gross_income: wg * 52 / 12,
        monthly_income_default: (netPerPaycheck * paychecksPerYear) / 12,
        paycheck_deductions: deds,
        paycheck_rule_id: targetRule?.id ?? paycheckRuleId,
        deduction_401k_value: k401?.value ?? 0,
        deduction_401k_mode: k401?.mode ?? 'pct',
        deduction_401k_pretax: k401?.preTax ?? true,
      } as any, {
        onSuccess: () => {
          setAutoSaveStatus('saved');
          setTimeout(() => setAutoSaveStatus('idle'), 2000);
          // Sync ONLY the designated paycheck rule — never touch other income rules
          if (targetRule) {
            if (!paycheckRuleId) setPaycheckRuleId(targetRule.id);
            const needsUpdate = Math.round(Number(targetRule.amount) * 100) !== Math.round(netPerPaycheck * 100) ||
              targetRule.frequency !== pf ||
              targetRule.due_day !== pd;
            if (needsUpdate) {
              updateRule.mutate({
                id: targetRule.id,
                amount: Math.round(netPerPaycheck * 100) / 100,
                frequency: pf,
                due_day: pd,
              });
            }
          }
          // Sync savings goal monthly_contribution for any linked deduction
          deds.forEach(d => {
            if (d.goalId && d.value > 0) {
              const flatAmt = d.mode === 'pct' ? gross * (d.value / 100) : d.value;
              const paychecksPerYr = pf === 'biweekly' ? 26 : pf === 'monthly' ? 12 : 52;
              const monthlyContrib = Math.round((flatAmt * paychecksPerYr / 12) * 100) / 100;
              updateGoal.mutate({ id: d.goalId, monthly_contribution: monthlyContrib });
            }
          });
        },
        onError: () => setAutoSaveStatus('idle'),
      });
    }, 800);
  }, [isDemo, updateProfile, rules, updateRule, paycheckRuleId, setPaycheckRuleId, updateGoal]);

  const handleWeeklyGrossBlur = () => {
    const parsed = parseFloat(weeklyGrossInput);
    if (!isNaN(parsed) && parsed > 0) {
      setWeeklyGross(parsed);
      doAutoSave(parsed, taxRate, paycheckDay, payFrequency, deductions);
    } else {
      setWeeklyGrossInput(String(weeklyGross));
    }
  };
  const setTaxRateAuto = (v: number) => { setTaxRate(v); doAutoSave(weeklyGross, v, paycheckDay, payFrequency, deductions); };
  const setPaycheckDayAuto = (v: number) => { setPaycheckDay(v); doAutoSave(weeklyGross, taxRate, v, payFrequency, deductions); };
  const setPayFrequencyAuto = (v: PayFrequency) => { setPayFrequency(v); doAutoSave(weeklyGross, taxRate, paycheckDay, v, deductions); };

  // Deduction CRUD — each mutates and auto-saves
  const updateDeduction = (id: string, patch: Partial<PaycheckDeduction>) => {
    const next = deductions.map(d => {
      if (d.id !== id) return d;
      const merged = { ...d, ...patch };
      // Catalog Taxes-group items are always post-tax — prevent toggle from changing it
      if (TAX_CATALOG_LABELS.has(merged.label.toLowerCase())) merged.preTax = false;
      return merged;
    });
    setDeductions(next);
    doAutoSave(weeklyGross, taxRate, paycheckDay, payFrequency, next);
  };
  const removeDeduction = (id: string) => {
    const next = deductions.filter(d => d.id !== id);
    setDeductions(next);
    doAutoSave(weeklyGross, taxRate, paycheckDay, payFrequency, next);
  };
  const addDeductionFromCatalog = (item: { label: string; mode: 'flat' | 'pct'; preTax: boolean }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const next = [...deductions, { id, label: item.label, value: 0, mode: item.mode, preTax: item.preTax }];
    setDeductions(next);
    doAutoSave(weeklyGross, taxRate, paycheckDay, payFrequency, next);
    setShowCatalog(false);
    setCustomLabel('');
  };

  // Unified pay schedule
  const paycheckGross = useMemo(() => {
    if (payFrequency === 'biweekly') return weeklyGross * 2;
    if (payFrequency === 'monthly') return weeklyGross * 52 / 12;
    return weeklyGross;
  }, [weeklyGross, payFrequency]);

  // Resolve each deduction to flat $ per paycheck
  const deductionAmounts = useMemo(() =>
    deductions.map(d => ({
      ...d,
      flatAmt: d.mode === 'pct' ? paycheckGross * (d.value / 100) : d.value,
    })),
    [deductions, paycheckGross]);

  const preTaxDeductionsFlat  = useMemo(() => deductionAmounts.filter(d => d.preTax).reduce((s, d) => s + d.flatAmt, 0), [deductionAmounts]);
  const postTaxDeductionsFlat = useMemo(() => deductionAmounts.filter(d => !d.preTax).reduce((s, d) => s + d.flatAmt, 0), [deductionAmounts]);

  // When any catalog Taxes-group deduction is active, they replace the Tax Rate %
  const hasTaxDeductions = useMemo(() =>
    deductions.some(d => TAX_CATALOG_LABELS.has(d.label.toLowerCase()) && d.value > 0),
    [deductions]);
  const effectiveTaxRate = hasTaxDeductions ? 0 : taxRate;

  const payConfig = useMemo(() => ({
    weeklyGross, taxRate: effectiveTaxRate, paycheckDay, frequency: payFrequency,
    preTaxDeductions: preTaxDeductionsFlat,
    postTaxDeductions: postTaxDeductionsFlat,
  }), [weeklyGross, effectiveTaxRate, paycheckDay, payFrequency, preTaxDeductionsFlat, postTaxDeductionsFlat]);

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
  const paychecksPerYear = payFrequency === 'biweekly' ? 26 : payFrequency === 'monthly' ? 12 : 52;
  const annualTakeHome = paycheckNet * paychecksPerYear;

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

  // Split fixedRules into Bills-only and Subscriptions-only for separate tabs
  const billsRules = useMemo(() => fixedRules.filter((r: any) => !r.isSub && r.category !== 'Subscriptions'), [fixedRules]);
  const subscriptionRules = useMemo(() => fixedRules.filter((r: any) => r.isSub || r.category === 'Subscriptions'), [fixedRules]);

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
    if (isPremium || isDemo) {
      fields.push({ key: 'category', label: 'Category (custom)', type: 'text', placeholder: 'e.g., Bills, Groceries, Side Hustle…' });
    } else {
      fields.push({ key: 'category', label: 'Category', type: 'select', options: CATEGORIES.map(c => ({ value: c, label: c })) });
    }
    
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

  const openIncomeCalc = () => {
    const lines: { label: string; value: string; op?: string }[] = [
      { label: `Pay frequency: ${payFrequency}`, value: '' },
      { label: 'Gross per paycheck', value: formatCurrency(paycheckGross, false) },
    ];
    if (preTaxDeductionsFlat > 0) {
      lines.push({ label: `Pre-tax deductions (reduces taxable income)`, value: formatCurrency(preTaxDeductionsFlat, false), op: '−' });
      lines.push({ label: 'Taxable gross per paycheck', value: formatCurrency(paycheckGross - preTaxDeductionsFlat, false), op: '=' });
    }
    if (!hasTaxDeductions) {
      lines.push({ label: `Income tax (${taxRate}%)`, value: formatCurrency((paycheckGross - preTaxDeductionsFlat) * taxRate / 100, false), op: '−' });
      if (preTaxDeductionsFlat > 0) {
        lines.push({ label: `Tax saved by pre-tax deductions`, value: formatCurrency(preTaxDeductionsFlat * taxRate / 100, false) });
      }
    } else {
      lines.push({ label: 'Tax withheld via deductions (Fed Withholding / FICA / OASDI)', value: formatCurrency(postTaxDeductionsFlat, false), op: '−' });
    }
    if (postTaxDeductionsFlat > 0 && !hasTaxDeductions) {
      lines.push({ label: 'Other post-tax deductions', value: formatCurrency(postTaxDeductionsFlat, false), op: '−' });
    } else if (postTaxDeductionsFlat > 0 && hasTaxDeductions) {
      // already shown above as a single line
    }
    lines.push({ label: 'Net per paycheck', value: formatCurrency(paycheckNet, false), op: '=' });
    lines.push({ label: 'Paychecks this month', value: String(getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth()).length) });
    lines.push({ label: 'Total monthly take-home', value: formatCurrency(monthlyTakeHome, false), op: '=' });
    incomeRules.filter((r: any) => r.active).forEach((r: any) =>
      lines.push({ label: `  Rule: ${r.name}`, value: formatCurrency(toCurrentMonthAmount(r), false), op: '+' }),
    );
    lines.push({ label: 'Total recurring income', value: formatCurrency(totalRecurringIncome, false), op: '=' });
    setCalcDrawer({ title: 'Income This Month', lines });
  };

  const RuleRow = ({ r, color = 'text-destructive' }: { r: any; color?: string }) => (
  <div className={`flex flex-col gap-2 py-3 border-b border-border/50 last:border-0 sm:flex-row sm:items-center sm:justify-between ${!r.active ? 'opacity-40' : ''}`}>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 flex-wrap">
      <p className="text-sm sm:text-base font-medium break-words">{r.name}</p>
      {r.isSub && (
        <span
          className="text-[9px] px-1 py-0.5 bg-accent/20 text-accent-foreground border border-accent/30 shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
        >
          sub
        </span>
      )}
      {r.isDebtSync && (
        <span
          className="text-[9px] px-1 py-0.5 bg-primary/20 text-primary border border-primary/30 shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
        >
          from payoff
        </span>
      )}
    </div>

    <p className="mt-1 text-xs sm:text-sm text-muted-foreground break-words">
      {freqLabel(r.frequency)} · Day {r.due_day}
      {r.due_month ? ` / Month ${r.due_month}` : ''}
      {r.start_date ? ` · Starts ${r.start_date}` : ''}
      {r.payment_source ? ` · From: ${getAccountName(r.payment_source)}` : ''}
      {r.deposit_account ? ` · To: ${getAccountName(r.deposit_account)}` : ''}
    </p>
  </div>

  <div className="flex flex-col gap-2 sm:items-end">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`text-sm sm:text-base font-display font-bold ${color}`}>
        {formatCurrency(Number(r.amount), false)}
      </span>
      <span className="text-xs sm:text-sm text-muted-foreground">
        /mo {formatCurrency(toMonthly(r), false)}
      </span>
    </div>

    {!r.isSub && !r.isDebtSync && (
      <div className="flex flex-wrap items-center gap-1">
        <button onClick={() => handleDuplicate(r)} className="icon-btn text-muted-foreground hover:text-primary" title="Duplicate">
          <Copy size={13} />
        </button>
        <button onClick={() => toggleActive(r)} className="icon-btn text-muted-foreground hover:text-foreground">
          {r.active ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button onClick={() => openEdit(r)} className="icon-btn text-muted-foreground hover:text-foreground">
          <Edit2 size={13} />
        </button>
        <button
          onClick={() => handleDelete(r.id)}
          className={`icon-btn ${deleteConfirm === r.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    )}
  </div>
</div>
  );

  return (
    <div className="w-full max-w-none space-y-6 sm:space-y-8">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-xl sm:text-2xl lg:text-3xl tracking-tight">Budget Control</h1>
          <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">Your single source of truth for income, expenses, and automation</p>
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

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-sm sm:text-base font-semibold text-foreground">Recurring rules — the engine behind every projection</p>
              <p className="text-sm text-muted-foreground mt-0.5">Everything you set here flows automatically into the Dashboard, Debt Payoff engine, and 36-month Forecast.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Income rules', desc: 'Weekly paycheck ($1,462.50) + monthly roommate contribution ($900) define the take-home the debt engine works with.' },
              { label: 'Expense rules', desc: 'Rent, utilities, car insurance, groceries, gas — each rule auto-generates a transaction every month so nothing is missed.' },
              { label: 'CC-tagged expenses', desc: 'Groceries and subscriptions marked as credit card purchases feed the debt engine\'s monthly purchase tracking.' },
              { label: 'Transfer rules', desc: 'Emergency fund ($300/mo) and investments ($825/mo) move automatically — Forecast accounts for these before sizing debt payments.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs sm:text-sm" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-sm font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {/* Income & Taxes — auto-saves */}
      <div className="card-forged p-3 sm:p-5 space-y-3 sm:space-y-4">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Income & Taxes</h3>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {incomeRules.length > 0 && (
              <div className="flex w-full items-center gap-1 sm:w-auto">
                <span className="text-[9px] text-muted-foreground uppercase shrink-0">Rule:</span>
                <select
                  value={paycheckRuleId ?? ''}
                  onChange={e => {
                    const id = e.target.value || null;
                    setPaycheckRuleId(id);
                    updateProfile.mutate({ paycheck_rule_id: id } as any);
                  }}
                  className="bg-secondary border border-border px-2 py-1 text-sm text-foreground w-full sm:w-auto max-w-full sm:max-w-[130px]"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <option value="">— none —</option>
                  {incomeRules.map((r: any) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            {autoSaveStatus === 'saving' && <span className="text-xs sm:text-sm text-muted-foreground animate-pulse">Saving…</span>}
            {autoSaveStatus === 'saved' && <span className="text-xs sm:text-sm text-success">✓ Saved</span>}
          </div>
        </div>

        {/* Gross Income — prominent at top */}
        <div className="pb-3 border-b border-border">
          <label className="text-xs sm:text-sm text-muted-foreground uppercase">Gross Income (per paycheck)</label>
          <input type="number" value={weeklyGrossInput} onChange={e => setWeeklyGrossInput(e.target.value)} onBlur={handleWeeklyGrossBlur}
            className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
        </div>

        {/* Paycheck Deductions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs sm:text-sm font-semibold text-muted-foreground uppercase tracking-wider">Paycheck Deductions</h4>
            <button
              onClick={() => setShowCatalog(true)}
              className="shrink-0 flex items-center gap-1 text-xs sm:text-sm text-primary border border-primary/30 px-2 py-1 hover:bg-primary/5 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Plus size={10} /> Add Deduction
            </button>
          </div>

          {/* Deduction rows — grouped by type */}
          {(() => {
            const isCatalogItem = (label: string) => DEDUCTION_CATALOG.some(c => c.label.toLowerCase() === label.toLowerCase());
            const getGroup = (label: string): string => {
              const l = label.toLowerCase();
              if (DEDUCTION_CATALOG.slice(0, 7).some(c => c.label.toLowerCase() === l)) return 'Benefits';
              if (DEDUCTION_CATALOG.slice(7, 13).some(c => c.label.toLowerCase() === l)) return 'Retirement & Savings';
              if (DEDUCTION_CATALOG.slice(13, 17).some(c => c.label.toLowerCase() === l)) return 'Taxes';
              if (DEDUCTION_CATALOG.slice(17).some(c => c.label.toLowerCase() === l)) return 'Other';
              return 'Custom';
            };
            const groupOrder = ['Taxes', 'Benefits', 'Retirement & Savings', 'Other', 'Custom'];
            const grouped: Record<string, typeof deductionAmounts> = {};
            for (const d of deductionAmounts) {
              const g = getGroup(d.label);
              if (!grouped[g]) grouped[g] = [];
              grouped[g].push(d);
            }
            const retirementAccounts = accounts.filter((a: any) => a.active && ['brokerage', 'roth_ira', '401k'].includes(a.account_type));
            return groupOrder.filter(g => grouped[g]?.length).map(group => (
              <div key={group} className="space-y-0">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5 pt-2 pb-0.5">{group}</p>
                <div className="space-y-1.5">
                  {grouped[group].map(d => {
              const isRetirement = /401|403|roth|ira/i.test(d.label);
              const isTaxItem = TAX_CATALOG_LABELS.has(d.label.toLowerCase());
              const fromCatalog = isCatalogItem(d.label);
              return (
                <div key={d.id} className="border-b border-border/30 last:border-0 pb-2 pt-1">
                  {/* Row 1: label + remove */}
                  <div className="flex items-center gap-2 pt-1 pb-0.5">
                    {fromCatalog ? (
                      <span className="flex-1 min-w-0 text-sm font-semibold text-foreground px-0.5 truncate">{d.label}</span>
                    ) : (
                      <input
                        type="text"
                        value={d.label}
                        onChange={e => updateDeduction(d.id, { label: e.target.value })}
                        className="flex-1 min-w-0 bg-transparent border-b border-transparent hover:border-border focus:border-primary text-sm font-semibold text-foreground px-0.5 outline-none transition-colors"
                      />
                    )}
                    <button onClick={() => removeDeduction(d.id)} className="text-muted-foreground hover:text-destructive shrink-0"><X size={12} /></button>
                  </div>
                  {/* Row 2: controls */}
                  <div className="flex flex-col gap-2 pb-2 sm:flex-row sm:flex-wrap sm:items-center">
                    {/* Value input */}
                    <input
                      type="number" min={0} max={d.mode === 'pct' ? 100 : undefined} step={d.mode === 'pct' ? 0.5 : 1}
                      value={d.value}
                      onChange={e => updateDeduction(d.id, { value: parseFloat(e.target.value) || 0 })}
                      className="w-full sm:w-24 bg-secondary border border-border px-3 py-2 text-base text-foreground font-display font-bold text-left sm:text-right"
                      style={{ borderRadius: 'var(--radius)' }}
                    />
                    {/* $/% toggle */}
                    <div className="flex gap-1 w-full sm:w-auto">
                      <button onClick={() => updateDeduction(d.id, { mode: 'flat' })} className={`text-[9px] px-1.5 py-0.5 border transition-colors ${d.mode === 'flat' ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>$</button>
                      <button onClick={() => updateDeduction(d.id, { mode: 'pct' })} className={`text-[9px] px-1.5 py-0.5 border transition-colors ${d.mode === 'pct' ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>%</button>
                    </div>
                    {/* Pre/post-tax toggle */}
                    {!isTaxItem && (
                      <div className="flex gap-1 w-full sm:w-auto">
                        <button onClick={() => updateDeduction(d.id, { preTax: true })} className={`text-[9px] px-1.5 py-0.5 border transition-colors ${d.preTax ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>Pre</button>
                        <button onClick={() => updateDeduction(d.id, { preTax: false })} className={`text-[9px] px-1.5 py-0.5 border transition-colors ${!d.preTax ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>Post</button>
                      </div>
                    )}
                    {/* Resolved amount hint */}
                    {d.value > 0 && (
                      <span className="text-[10px] text-muted-foreground w-full sm:w-auto"
                        {d.mode === 'pct' ? formatCurrency(d.flatAmt, false) : `${paycheckGross > 0 ? ((d.value / paycheckGross) * 100).toFixed(1) : '0'}%`}
                      </span>
                    )}
                  </div>
                  {/* Retirement account + goal link */}
                  {isRetirement && (
                    <div className="flex flex-wrap items-center gap-2 pl-1 mt-0.5">
                      {retirementAccounts.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-muted-foreground">Account:</span>
                          <select
                            value={d.accountId ?? ''}
                            onChange={e => updateDeduction(d.id, { accountId: e.target.value || undefined })}
                            className="bg-secondary border border-border px-1.5 py-0.5 text-[9px] text-foreground"
                            style={{ borderRadius: 'var(--radius)' }}
                          >
                            <option value="">— none —</option>
                            {retirementAccounts.map((a: any) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {savingsGoals.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-muted-foreground">Goal:</span>
                          <select
                            value={d.goalId ?? ''}
                            onChange={e => updateDeduction(d.id, { goalId: e.target.value || undefined })}
                            className="bg-secondary border border-border px-1.5 py-0.5 text-[9px] text-foreground"
                            style={{ borderRadius: 'var(--radius)' }}
                          >
                            <option value="">— none —</option>
                            {savingsGoals.map((g: any) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {d.goalId && d.value > 0 && (
                        <span className="text-[9px] text-success">
                          syncs {formatCurrency(Math.round(d.flatAmt * (payFrequency === 'biweekly' ? 26 : payFrequency === 'monthly' ? 12 : 52) / 12 * 100) / 100, false)}/mo → goal
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
                </div>
              </div>
            ));
          })()}

          {/* Totals summary */}
          {(preTaxDeductionsFlat + postTaxDeductionsFlat) > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs sm:text-sm pt-1">
              {preTaxDeductionsFlat > 0 && <span className="text-primary">−{formatCurrency(preTaxDeductionsFlat, false)} pre-tax <span className="text-success">(saves {formatCurrency(preTaxDeductionsFlat * (taxRate / 100), false)} tax)</span></span>}
              {postTaxDeductionsFlat > 0 && <span className="text-gold">−{formatCurrency(postTaxDeductionsFlat, false)} post-tax</span>}
            </div>
          )}
          {/* Gross → Net breakdown */}
          {(preTaxDeductionsFlat + postTaxDeductionsFlat) > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs sm:text-sm text-muted-foreground pt-1">
              <span className="font-medium text-foreground">{formatCurrency(paycheckGross, false)}</span>
              {preTaxDeductionsFlat > 0 && <><span className="text-primary">−{formatCurrency(preTaxDeductionsFlat, false)} pre-tax</span><span>→</span><span className="font-medium text-foreground">{formatCurrency(paycheckGross - preTaxDeductionsFlat, false)} taxable</span></>}
              {!hasTaxDeductions && <span>× {(100 - taxRate).toFixed(0)}%</span>}
              {postTaxDeductionsFlat > 0 && <><span className="text-gold">−{formatCurrency(postTaxDeductionsFlat, false)} post-tax</span></>}
              <span>→</span>
              <span className="font-display font-bold text-success">{formatCurrency(paycheckNet, false)} net</span>
            </div>
          )}
        </div>

        {/* Income inputs — frequency, tax rate, payday */}
        <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div>
            <label className="text-xs sm:text-sm text-muted-foreground uppercase">Pay Frequency</label>
            <select value={payFrequency} onChange={e => setPayFrequencyAuto(e.target.value as PayFrequency)}
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground" style={{ borderRadius: 'var(--radius)' }}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {hasTaxDeductions ? (
            <div className="flex flex-col justify-end">
              <p className="text-[9px] text-muted-foreground italic">Tax Rate hidden — using withholding deductions above</p>
            </div>
          ) : (
            <div>
              <label className="text-xs sm:text-sm text-muted-foreground uppercase">Tax Rate (%)</label>
              <input type="number" value={taxRate} onChange={e => setTaxRateAuto(parseFloat(e.target.value) || 0)}
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
            </div>
          )}
          <div>
            <label className="text-xs sm:text-sm text-muted-foreground uppercase">{payFrequency === 'monthly' ? 'Pay Day of Month' : 'Paycheck Day'}</label>
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
            <p className="text-sm text-muted-foreground uppercase flex items-center gap-1"><CalendarDays size={10} /> Next Paycheck</p>
            <p className="text-sm font-display font-bold text-primary mt-1">{nextPayday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 pt-2 border-t border-border sm:grid-cols-2 lg:grid-cols-3">
          <div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Per Paycheck (Net)</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-success break-words">
    {formatCurrency(paycheckNet, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Monthly Gross</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-foreground break-words">
    {formatCurrency(monthlyGross, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Monthly Take-Home</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-success break-words">
    {formatCurrency(monthlyTakeHome, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Annual Gross</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-foreground break-words">
    {formatCurrency(annualGross, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Annual Take-Home</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-success break-words">
    {formatCurrency(annualTakeHome, false)}
  </p>
</div>
      </div>

      {/* KPI Summary + Remaining Cash On Hand */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
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
      <div className="card-forged p-4 sm:p-5 cursor-pointer hover:border-primary/20 transition-colors group" onClick={openCashCalc}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Wallet size={14} className="text-primary shrink-0" />
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Remaining Cash On Hand</h3>
              <Info size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Funding balance + remaining income − expenses − debt payments
              {fundingAccount && <span className="font-medium"> · {fundingAccount.name}</span>}
            </p>
          </div>
          <p className={`text-xl sm:text-2xl font-display font-bold ${remainingCashOnHand >= 0 ? 'text-success' : 'text-destructive'}`}>
            {formatCurrency(remainingCashOnHand, false)}
          </p>
        </div>
      </div>

      {/* Budget Allocation Bar — current month only, distinct colors */}
      <div className="card-forged p-5">
        <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider mb-1">Budget Allocation</h3>
        <p className="text-sm text-muted-foreground mb-4">{now.toLocaleString('en-US', { month: 'long', year: 'numeric' })} — current month only</p>
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
        <div className="flex flex-wrap gap-4 mt-3 text-xs sm:text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(0, 65%, 45%)' }} /> Fixed ({monthlyTakeHome > 0 ? ((totalFixedExpenses / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(35, 85%, 50%)' }} /> Variable ({monthlyTakeHome > 0 ? ((totalVariableExpenses / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(210, 70%, 50%)' }} /> Debt ({monthlyTakeHome > 0 ? ((totalDebtPayments / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(280, 60%, 55%)' }} /> Transfers ({monthlyTakeHome > 0 ? ((totalTransfers / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'hsl(142, 50%, 40%)' }} /> Remaining ({monthlyTakeHome > 0 ? ((remaining / monthlyTakeHome) * 100).toFixed(0) : 0}%)</span>
        </div>
      </div>

      {/* Tabbed Rule Management */}
      <Tabs defaultValue="income" className="space-y-4">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
        <TabsList className="bg-secondary border border-border w-max sm:w-full justify-start flex-nowrap h-auto gap-1 p-1">
          <TabsTrigger value="income" className="text-sm data-[state=active]:bg-background">Income ({incomeRules.length})</TabsTrigger>
          <TabsTrigger value="fixed" className="text-sm data-[state=active]:bg-background">Fixed ({billsRules.length})</TabsTrigger>
          <TabsTrigger value="subscriptions" className="text-sm data-[state=active]:bg-background">Subscriptions ({subscriptionRules.length})</TabsTrigger>
          <TabsTrigger value="variable" className="text-sm data-[state=active]:bg-background">Variable ({variableRules.length})</TabsTrigger>
          <TabsTrigger value="debt" className="text-sm data-[state=active]:bg-background">Debt ({debtRules.length})</TabsTrigger>
          <TabsTrigger value="transfers" className="text-sm data-[state=active]:bg-background">Transfers ({transferRules.length})</TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="income">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Income Rules</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-success">{formatCurrency(totalRecurringIncome, false)}/mo</span>
                <button onClick={() => openAdd('income')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Income</button>
              </div>
            </div>
            {incomeRules.length === 0 && <p className="text-sm text-muted-foreground">No income rules. Add one to auto-generate paychecks.</p>}
            {incomeRules.map((r: any) => <RuleRow key={r.id} r={r} color="text-success" />)}
          </div>
        </TabsContent>

        <TabsContent value="fixed">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Fixed Expenses</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-destructive">{formatCurrency(billsRules.filter((r: any) => r.active).reduce((s: number, r: any) => s + toCurrentMonthAmount(r), 0), false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Bills')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Fixed</button>
              </div>
            </div>
            {billsRules.length === 0 && <p className="text-sm text-muted-foreground">No fixed expenses.</p>}
            {billsRules.map((r: any) => <RuleRow key={r.id} r={r} />)}
          </div>
        </TabsContent>

        <TabsContent value="subscriptions">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Subscriptions</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-destructive">{formatCurrency(subscriptionRules.filter((r: any) => r.active).reduce((s: number, r: any) => s + toCurrentMonthAmount(r), 0), false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Subscriptions')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Subscription</button>
              </div>
            </div>
            {subscriptionRules.length === 0 && <p className="text-sm text-muted-foreground">No subscriptions. Rules with category "Subscriptions" appear here.</p>}
            {subscriptionRules.map((r: any) => <RuleRow key={r.id} r={r} />)}
          </div>
        </TabsContent>

        <TabsContent value="variable">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Variable Expenses</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold" style={{ color: 'hsl(35, 85%, 50%)' }}>{formatCurrency(totalVariableExpenses, false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Other')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Variable</button>
              </div>
            </div>
            {variableRules.length === 0 && <p className="text-sm text-muted-foreground">No variable expenses.</p>}
            {variableRules.map((r: any) => <RuleRow key={r.id} r={r} color="text-foreground" />)}
          </div>
        </TabsContent>

        <TabsContent value="debt">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2"><CreditCard size={12} /> Debt Payments</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-destructive">{formatCurrency(totalDebtPayments, false)}/mo</span>
                <button onClick={() => openAdd('debt_payment', 'Debt Payments')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Payment</button>
              </div>
            </div>
            {debtRules.length === 0 && <p className="text-sm text-muted-foreground">No debt payments. Add credit card accounts and visit Debt Payoff to generate recommendations.</p>}
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
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2"><ArrowLeftRight size={12} /> Transfers & Investing</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-primary">{formatCurrency(totalTransfers, false)}/mo</span>
                <button onClick={() => openAdd('investment')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Transfer</button>
              </div>
            </div>
            {transferRules.length === 0 && <p className="text-sm text-muted-foreground">No transfers or investment contributions configured.</p>}
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

      {/* Catalog picker modal */}
      {showCatalog && (() => {
        const usedLabels = new Set(deductions.map(d => d.label.toLowerCase()));
        const CatalogBtn = ({ item }: { item: typeof DEDUCTION_CATALOG[number] }) => {
          const used = usedLabels.has(item.label.toLowerCase());
          return (
            <button
              key={item.label}
              onClick={() => !used && addDeductionFromCatalog(item)}
              disabled={used}
              className={`text-xs sm:text-sm px-2 py-1 border transition-colors ${used ? 'border-border bg-secondary text-muted-foreground opacity-40 cursor-not-allowed' : 'border-border bg-secondary hover:bg-primary/10 hover:border-primary/40 text-foreground'}`}
              style={{ borderRadius: 'var(--radius)' }}
              title={used ? 'Already added' : undefined}
            >
              {item.label}
            </button>
          );
        };
        return (
        <div className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center p-4" onClick={() => { setShowCatalog(false); setCustomLabel(''); }}>
          <div className="card-forged p-5 w-full max-w-md space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-sm">Add Deduction</h2>
              <button onClick={() => { setShowCatalog(false); setCustomLabel(''); }} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>

            {/* Benefits */}
            <div className="space-y-2.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Benefits</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(0, 7).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Retirement & Savings */}
            <div className="space-y-2.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Retirement & Savings</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(7, 13).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Taxes */}
            <div className="space-y-2.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Taxes</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(13, 17).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Other */}
            <div className="space-y-2.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Other</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(17).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Custom */}
            <div className="space-y-1.5 pt-2 border-t border-border">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Custom</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Deduction name…"
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customLabel.trim()) {
                      addDeductionFromCatalog({ label: customLabel.trim(), mode: 'flat', preTax: false });
                    }
                  }}
                  className="flex-1 bg-secondary border border-border px-3 py-1.5 text-sm sm:text-base text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <button
                  onClick={() => { if (customLabel.trim()) addDeductionFromCatalog({ label: customLabel.trim(), mode: 'flat', preTax: false }); }}
                  disabled={!customLabel.trim()}
                  className="text-xs sm:text-sm px-3 py-1.5 bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  Add
                </button>
              </div>
              <p className="text-[9px] text-muted-foreground">Custom deductions default to flat $ post-tax — adjust after adding.</p>
            </div>
          </div>
        </div>
        );
      })()}

      <CalcDrawer
        open={!!calcDrawer}
        onClose={() => setCalcDrawer(null)}
        title={calcDrawer?.title || ''}
        lines={calcDrawer?.lines || []}
      />
    </div>
  );
}
