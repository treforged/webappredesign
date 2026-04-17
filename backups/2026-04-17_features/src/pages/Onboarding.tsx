import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  DollarSign, CreditCard, PiggyBank, Target, ChevronRight,
  ChevronLeft, Check, Crown, Zap, BarChart3, Shield, Loader2, Car,
} from 'lucide-react';

type Step = 'welcome' | 'income' | 'expenses' | 'debts' | 'savings' | 'goals' | 'finish';

const STEPS: Step[] = ['welcome', 'income', 'expenses', 'debts', 'savings', 'goals', 'finish'];

const STEP_LABELS: Record<Step, string> = {
  welcome:  'Welcome',
  income:   'Income',
  expenses: 'Expenses',
  debts:    'Debts',
  savings:  'Savings',
  goals:    'Goals',
  finish:   'Your Plan',
};

const GOAL_TYPES = ['Emergency Fund', 'Vacation', 'Down Payment', 'Car Fund', 'Retirement', 'Custom'] as const;
type GoalType = typeof GOAL_TYPES[number];

interface DebtEntry {
  name: string;
  balance: string;
  apr: string;
  minPayment: string;
  creditLimit: string;
  dueDate: string;
}

interface GoalEntry {
  name: string;
  targetAmount: string;
  goalType: GoalType;
  // Car Fund fields
  targetPrice: string;
  taxFees: string;
  monthlyInsurance: string;
  expectedApr: string;
  loanTermMonths: string;
}

interface OnboardingData {
  displayName: string;
  weeklyGross: string;
  taxRate: string;
  paycheckFrequency: string;
  monthlyRent: string;
  monthlyUtilities: string;
  monthlyGroceries: string;
  monthlySubscriptions: string;
  debts: DebtEntry[];
  savingsBalance: string;
  savingsApy: string;
  goals: GoalEntry[];
}

const emptyDebt = (): DebtEntry => ({ name: '', balance: '', apr: '', minPayment: '', creditLimit: '', dueDate: '' });
const emptyGoal = (type: GoalType = 'Custom'): GoalEntry => ({
  name: type === 'Custom' ? '' : type,
  targetAmount: '',
  goalType: type,
  targetPrice: '',
  taxFees: '',
  monthlyInsurance: '',
  expectedApr: '',
  loanTermMonths: '60',
});

const DEFAULT_DATA: OnboardingData = {
  displayName: '',
  weeklyGross: '',
  taxRate: '22',
  paycheckFrequency: 'biweekly',
  monthlyRent: '',
  monthlyUtilities: '',
  monthlyGroceries: '',
  monthlySubscriptions: '',
  debts: [],
  savingsBalance: '',
  savingsApy: '4.5',
  goals: [],
};

function StepProgress({ step }: { step: Step }) {
  const idx = STEPS.indexOf(step);
  const pct = (idx / (STEPS.length - 1)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] text-muted-foreground overflow-hidden">
        {STEPS.slice(0, -1).map((s, i) => (
          <span key={s} className={`truncate ${i <= idx ? 'text-primary font-medium' : ''}`}>{STEP_LABELS[s]}</span>
        ))}
      </div>
      <div className="h-1 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{children}</label>;
}

function Input({ value, onChange, placeholder, type = 'text', prefix }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; prefix?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>
      )}
      <input
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-secondary border border-border py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${prefix ? 'pl-7 pr-3' : 'px-3'}`}
        style={{ borderRadius: 'var(--radius)' }}
      />
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-secondary border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [data, setData] = useState<OnboardingData>({
    ...DEFAULT_DATA,
    displayName: (user?.user_metadata?.display_name as string) ?? '',
  });
  const [saving, setSaving] = useState(false);

  const update = useCallback(<K extends keyof OnboardingData>(key: K, val: OnboardingData[K]) => {
    setData(prev => ({ ...prev, [key]: val }));
  }, []);

  const next = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const back = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const wg = parseFloat(data.weeklyGross) || 0;
      const tr = parseFloat(data.taxRate) || 22;
      const gross = data.paycheckFrequency === 'biweekly' ? wg * 26 / 12 : wg * 52 / 12;

      await supabase.from('profiles').update({
        display_name: data.displayName || user?.email?.split('@')[0] || 'User',
        weekly_gross_income: wg,
        gross_income: gross,
        monthly_income_default: gross * (1 - tr / 100),
        tax_rate: tr,
        paycheck_frequency: data.paycheckFrequency,
      }).eq('user_id', user!.id);

      const expenses = [
        { label: 'Rent / Mortgage', amount: data.monthlyRent, category: 'Housing' },
        { label: 'Utilities', amount: data.monthlyUtilities, category: 'Utilities' },
        { label: 'Groceries', amount: data.monthlyGroceries, category: 'Food' },
        { label: 'Subscriptions', amount: data.monthlySubscriptions, category: 'Entertainment' },
      ].filter(e => parseFloat(e.amount) > 0);

      if (expenses.length > 0) {
        await supabase.from('budget_items').insert(
          expenses.map(e => ({
            user_id: user!.id,
            label: e.label,
            amount: parseFloat(e.amount),
            category: e.category,
          }))
        );
      }

      const validDebts = data.debts.filter(d => d.name && parseFloat(d.balance) > 0);
      if (validDebts.length > 0) {
        await supabase.from('debts').insert(
          validDebts.map(d => ({
            user_id: user!.id,
            name: d.name,
            balance: parseFloat(d.balance),
            apr: parseFloat(d.apr) || 0,
            min_payment: parseFloat(d.minPayment) || 0,
            credit_limit: parseFloat(d.creditLimit) || null,
          }))
        );
      }

      if (parseFloat(data.savingsBalance) > 0) {
        await supabase.from('accounts').insert({
          user_id: user!.id,
          name: 'High-Yield Savings',
          account_type: 'high_yield_savings',
          balance: parseFloat(data.savingsBalance),
          apy: parseFloat(data.savingsApy) || 0,
        });
      }

      const regularGoals = data.goals.filter(g => g.goalType !== 'Car Fund' && g.name && parseFloat(g.targetAmount) > 0);
      if (regularGoals.length > 0) {
        await supabase.from('savings_goals').insert(
          regularGoals.map(g => ({
            user_id: user!.id,
            name: g.name,
            target_amount: parseFloat(g.targetAmount),
            current_amount: 0,
            goal_type: g.goalType,
          }))
        );
      }

      const carGoals = data.goals.filter(g => g.goalType === 'Car Fund' && g.name);
      if (carGoals.length > 0) {
        await supabase.from('car_funds').insert(
          carGoals.map(g => ({
            user_id: user!.id,
            vehicle_name: g.name,
            down_payment_goal: parseFloat(g.targetAmount) || 0,
            current_saved: 0,
            target_price: parseFloat(g.targetPrice) || 0,
            tax_fees: parseFloat(g.taxFees) || 0,
            monthly_insurance: parseFloat(g.monthlyInsurance) || 0,
            expected_apr: parseFloat(g.expectedApr) || 0,
            loan_term_months: parseInt(g.loanTermMonths) || 60,
          }))
        );
      }

      localStorage.setItem(`forged:onboarding_done_${user!.id}`, '1');
      toast.success('Your financial profile is ready!');
      navigate('/dashboard');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    localStorage.setItem(`forged:onboarding_done_${user?.id}`, '1');
    navigate('/dashboard');
  };

  const monthly = useCallback(() => {
    const wg = parseFloat(data.weeklyGross) || 0;
    const tr = parseFloat(data.taxRate) || 22;
    const gross = data.paycheckFrequency === 'biweekly' ? wg * 26 / 12 : wg * 52 / 12;
    return (gross * (1 - tr / 100)).toFixed(0);
  }, [data.weeklyGross, data.taxRate, data.paycheckFrequency]);

  const totalDebt = data.debts.reduce((s, d) => s + (parseFloat(d.balance) || 0), 0);
  const totalExpenses = [data.monthlyRent, data.monthlyUtilities, data.monthlyGroceries, data.monthlySubscriptions]
    .reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const net = parseFloat(monthly()) - totalExpenses;

  const updateDebt = (i: number, field: keyof DebtEntry, val: string) => {
    update('debts', data.debts.map((d, j) => j === i ? { ...d, [field]: val } : d));
  };

  const updateGoal = (i: number, field: keyof GoalEntry, val: string) => {
    const updated = data.goals.map((g, j) => {
      if (j !== i) return g;
      const next = { ...g, [field]: val };
      if (field === 'goalType' && val !== 'Custom') {
        next.name = val;
      }
      return next;
    });
    update('goals', updated);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-display font-bold text-xl tracking-tight text-gold">FORGED</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {step === 'finish' ? 'Your financial plan is ready.' : "Let's set up your financial profile."}
          </p>
        </div>

        {step !== 'finish' && <StepProgress step={step} />}

        <div className="card-forged p-5 space-y-5">

          {/* ── Welcome ── */}
          {step === 'welcome' && (
            <div className="space-y-5">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center mx-auto">
                  <Zap size={22} className="text-primary" />
                </div>
                <h2 className="font-display font-bold text-lg">Welcome to Forged</h2>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  Takes 2 minutes. We'll build your personalized financial picture so your dashboard is ready from day one.
                </p>
              </div>
              <div className="space-y-1">
                <FieldLabel>What should we call you?</FieldLabel>
                <Input value={data.displayName} onChange={v => update('displayName', v)} placeholder="Your name" />
              </div>
            </div>
          )}

          {/* ── Income ── */}
          {step === 'income' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <DollarSign size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Income & Paycheck</h2>
              </div>
              <div className="space-y-1">
                <FieldLabel>Pay Frequency</FieldLabel>
                <Select
                  value={data.paycheckFrequency}
                  onChange={v => update('paycheckFrequency', v)}
                  options={[
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'biweekly', label: 'Biweekly (every 2 weeks)' },
                    { value: 'monthly', label: 'Monthly' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FieldLabel>Gross per paycheck ($)</FieldLabel>
                  <Input value={data.weeklyGross} onChange={v => update('weeklyGross', v)} placeholder="e.g. 1875" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Tax Rate (%)</FieldLabel>
                  <Input value={data.taxRate} onChange={v => update('taxRate', v)} placeholder="22" type="number" />
                </div>
              </div>
              {data.weeklyGross && (
                <div className="bg-primary/8 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Estimated monthly take-home: </span>
                  <span className="font-semibold text-primary">${Number(monthly()).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Expenses ── */}
          {step === 'expenses' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <BarChart3 size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Monthly Expenses</h2>
              </div>
              <p className="text-[10px] text-muted-foreground">Approximate is fine — you can adjust later in Budget Control.</p>
              {[
                { label: 'Rent / Mortgage', key: 'monthlyRent' as const },
                { label: 'Utilities', key: 'monthlyUtilities' as const },
                { label: 'Groceries', key: 'monthlyGroceries' as const },
                { label: 'Subscriptions', key: 'monthlySubscriptions' as const },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-1">
                  <FieldLabel>{label}</FieldLabel>
                  <Input value={data[key]} onChange={v => update(key, v)} placeholder="0" type="number" prefix="$" />
                </div>
              ))}
              {totalExpenses > 0 && data.weeklyGross && (
                <div className={`px-3 py-2.5 text-xs border ${net >= 0 ? 'bg-primary/8 border-primary/20' : 'bg-destructive/10 border-destructive/20'}`} style={{ borderRadius: 'var(--radius)' }}>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monthly expenses</span>
                    <span className="font-semibold">${totalExpenses.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Remaining after expenses</span>
                    <span className={`font-semibold ${net >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {net >= 0 ? '+' : ''}${net.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Debts ── */}
          {step === 'debts' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Credit Cards & Loans</h2>
              </div>
              <p className="text-[10px] text-muted-foreground">Add any debts you're paying down. Skip if none.</p>
              {data.debts.map((d, i) => (
                <div key={i} className="space-y-3 p-3 bg-secondary/40 border border-border" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Debt {i + 1}</span>
                    <button onClick={() => update('debts', data.debts.filter((_, j) => j !== i))}
                      className="text-[10px] text-destructive hover:underline">Remove</button>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] text-muted-foreground uppercase">Card / loan name</span>
                    <Input value={d.name} onChange={v => updateDebt(i, 'name', v)} placeholder="e.g. Chase Sapphire, Student Loan" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-[9px] text-muted-foreground uppercase">Current balance</span>
                      <Input value={d.balance} onChange={v => updateDebt(i, 'balance', v)} placeholder="0" type="number" prefix="$" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-muted-foreground uppercase">APR %</span>
                      <Input value={d.apr} onChange={v => updateDebt(i, 'apr', v)} placeholder="0.0" type="number" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-muted-foreground uppercase">Min. payment</span>
                      <Input value={d.minPayment} onChange={v => updateDebt(i, 'minPayment', v)} placeholder="0" type="number" prefix="$" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-muted-foreground uppercase">Credit limit</span>
                      <Input value={d.creditLimit} onChange={v => updateDebt(i, 'creditLimit', v)} placeholder="0" type="number" prefix="$" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] text-muted-foreground uppercase">Payment due date (day of month)</span>
                    <Input value={d.dueDate} onChange={v => updateDebt(i, 'dueDate', v)} placeholder="e.g. 15" type="number" />
                    <p className="text-[9px] text-muted-foreground">You can link this to an account in Accounts for payment reminders.</p>
                  </div>
                </div>
              ))}
              <button
                onClick={() => update('debts', [...data.debts, emptyDebt()])}
                className="w-full py-2.5 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                + Add a debt
              </button>
              {totalDebt > 0 && (
                <div className="bg-secondary/40 px-3 py-2 text-xs flex justify-between" style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Total debt</span>
                  <span className="font-semibold text-destructive">${totalDebt.toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Savings ── */}
          {step === 'savings' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <PiggyBank size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Savings Account</h2>
              </div>
              <p className="text-[10px] text-muted-foreground">Your current savings balance. We'll track APY growth automatically.</p>
              <div className="space-y-1">
                <FieldLabel>Current savings balance</FieldLabel>
                <Input value={data.savingsBalance} onChange={v => update('savingsBalance', v)} placeholder="0" type="number" prefix="$" />
              </div>
              <div className="space-y-1">
                <FieldLabel>APY (%)</FieldLabel>
                <Input value={data.savingsApy} onChange={v => update('savingsApy', v)} placeholder="4.5" type="number" />
              </div>
              {data.savingsBalance && data.savingsApy && (
                <div className="bg-primary/8 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Projected growth in 1 year: </span>
                  <span className="font-semibold text-primary">
                    +${((parseFloat(data.savingsBalance) || 0) * (parseFloat(data.savingsApy) / 100)).toFixed(0)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Goals ── */}
          {step === 'goals' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Target size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Financial Goals</h2>
              </div>
              <p className="text-[10px] text-muted-foreground">What are you saving for? Add up to 3 goals. Skip if none yet.</p>
              {data.goals.map((g, i) => {
                const isCarFund = g.goalType === 'Car Fund';
                return (
                  <div key={i} className="space-y-3 p-3 bg-secondary/40 border border-border" style={{ borderRadius: 'var(--radius)' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {isCarFund ? <Car size={12} className="text-primary" /> : <Target size={12} className="text-primary" />}
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">Goal {i + 1}</span>
                      </div>
                      <button onClick={() => update('goals', data.goals.filter((_, j) => j !== i))}
                        className="text-[10px] text-destructive hover:underline">Remove</button>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[9px] text-muted-foreground uppercase">Goal type</span>
                      <Select
                        value={g.goalType}
                        onChange={v => updateGoal(i, 'goalType', v)}
                        options={GOAL_TYPES.map(t => ({ value: t, label: t }))}
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[9px] text-muted-foreground uppercase">{isCarFund ? 'Vehicle name' : 'Goal name'}</span>
                      <Input
                        value={g.name}
                        onChange={v => updateGoal(i, 'name', v)}
                        placeholder={isCarFund ? 'e.g. Porsche Cayman, Honda Civic' : 'e.g. Emergency Fund, Europe Trip'}
                      />
                    </div>

                    {isCarFund ? (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <span className="text-[9px] text-muted-foreground uppercase">Vehicle price</span>
                            <Input value={g.targetPrice} onChange={v => updateGoal(i, 'targetPrice', v)} placeholder="30000" type="number" prefix="$" />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] text-muted-foreground uppercase">Tax & fees</span>
                            <Input value={g.taxFees} onChange={v => updateGoal(i, 'taxFees', v)} placeholder="3000" type="number" prefix="$" />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] text-muted-foreground uppercase">Down payment goal</span>
                            <Input value={g.targetAmount} onChange={v => updateGoal(i, 'targetAmount', v)} placeholder="5000" type="number" prefix="$" />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] text-muted-foreground uppercase">Monthly insurance</span>
                            <Input value={g.monthlyInsurance} onChange={v => updateGoal(i, 'monthlyInsurance', v)} placeholder="200" type="number" prefix="$" />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] text-muted-foreground uppercase">Expected loan APR %</span>
                            <Input value={g.expectedApr} onChange={v => updateGoal(i, 'expectedApr', v)} placeholder="5.9" type="number" />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] text-muted-foreground uppercase">Loan term (months)</span>
                            <Input value={g.loanTermMonths} onChange={v => updateGoal(i, 'loanTermMonths', v)} placeholder="60" type="number" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1">
                        <span className="text-[9px] text-muted-foreground uppercase">Target amount</span>
                        <Input value={g.targetAmount} onChange={v => updateGoal(i, 'targetAmount', v)} placeholder="0" type="number" prefix="$" />
                      </div>
                    )}
                  </div>
                );
              })}
              {data.goals.length < 3 && (
                <button
                  onClick={() => update('goals', [...data.goals, emptyGoal()])}
                  className="w-full py-2.5 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  + Add a goal
                </button>
              )}
            </div>
          )}

          {/* ── Finish ── */}
          {step === 'finish' && (
            <div className="space-y-5">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center mx-auto">
                  <Check size={22} className="text-primary" />
                </div>
                <h2 className="font-display font-bold text-lg">Your profile is set</h2>
              </div>

              <div className="space-y-2">
                {data.weeklyGross && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Monthly take-home</span>
                    <span className="font-semibold">${Number(monthly()).toLocaleString()}</span>
                  </div>
                )}
                {totalExpenses > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Monthly expenses</span>
                    <span className="font-semibold text-destructive">−${totalExpenses.toLocaleString()}</span>
                  </div>
                )}
                {totalDebt > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Total debt</span>
                    <span className="font-semibold text-destructive">${totalDebt.toLocaleString()}</span>
                  </div>
                )}
                {data.goals.filter(g => g.name).length > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Active goals</span>
                    <span className="font-semibold">{data.goals.filter(g => g.name).length}</span>
                  </div>
                )}
                {data.weeklyGross && (
                  <div className="flex justify-between py-2 text-xs">
                    <span className="text-muted-foreground">Available after expenses</span>
                    <span className={`font-semibold ${net >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {net >= 0 ? '+' : ''}${net.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              <div className="border border-primary/25 bg-primary/5 p-4 space-y-3" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-2">
                  <Crown size={14} className="text-gold" />
                  <span className="text-xs font-semibold">Unlock automatic tracking with Premium</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Connect your bank accounts with Plaid for <strong className="text-foreground">automatic transaction import</strong>,
                  daily balance updates, and real-time net worth — no manual entry.
                </p>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {['Auto-sync transactions', 'Plaid bank connection', 'Unlimited history', 'Priority support'].map(f => (
                    <div key={f} className="flex items-center gap-1 text-muted-foreground">
                      <Shield size={9} className="text-primary shrink-0" /> {f}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <a
                    href="/premium"
                    onClick={e => { e.preventDefault(); handleFinish().then(() => setTimeout(() => (window.location.href = '/premium'), 500)); }}
                    className="flex-1 text-center py-2 text-[10px] font-semibold bg-primary text-primary-foreground btn-press"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Explore Premium
                  </a>
                  <button
                    onClick={handleFinish}
                    disabled={saving}
                    className="flex-1 py-2 text-[10px] font-medium border border-border text-muted-foreground hover:text-foreground btn-press disabled:opacity-50"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {saving ? <Loader2 size={10} className="animate-spin inline" /> : 'Continue free'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          {step !== 'finish' && (
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={step === 'welcome' ? skip : back}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {step === 'welcome' ? 'Skip setup →' : <><ChevronLeft size={14} /> Back</>}
              </button>
              <button
                onClick={next}
                className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {step === 'goals' ? 'See your plan' : 'Continue'} <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
