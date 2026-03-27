import { useState, useMemo } from 'react';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency, calculateMonthlyPayment } from '@/lib/calculations';
import { useSavingsGoals, useCarFunds, useAccounts, useRecurringRules, useProfile, useTransactions, useDebts } from '@/hooks/useSupabaseData';
import ProgressBar from '@/components/shared/ProgressBar';
import FormModal from '@/components/shared/FormModal';
import PremiumGate from '@/components/shared/PremiumGate';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Edit2, Trash2, Car, Copy, Link2, Info, X } from 'lucide-react';
import { getCurrentMonthDebtRecommendations } from '@/lib/credit-card-engine';
import { mergeWithGeneratedTransactions, createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, getAccountRemainingCashThisMonth } from '@/lib/pay-schedule';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from 'sonner';

const CHART_COLORS = ['hsl(43, 56%, 52%)', 'hsl(142, 50%, 40%)', 'hsl(200, 60%, 50%)', 'hsl(280, 50%, 50%)'];
const GOAL_TYPES = ['Emergency Fund', 'Vacation', 'Down Payment', 'Car Fund', 'Retirement', 'Custom'];
const emptyForm = { name: '', target_amount: '', current_amount: '', monthly_contribution: '', target_date: '', goal_type: 'Custom', linked_account: '' };
const emptyCarForm = { name: '', target_amount: '', current_amount: '', monthly_contribution: '', target_date: '', goal_type: 'Car Fund', target_price: '', tax_fees: '', monthly_insurance: '', expected_apr: '', loan_term_months: '', linked_account: '' };

// getAccountScheduledOutflows removed — replaced by transaction-based getAccountRemainingCashThisMonth from pay-schedule

function SavingsGrowthChart({ goals }: { goals: any[] }) {
  const chartData = useMemo(() => {
    const months: Record<string, any>[] = [];
    for (let i = 0; i < 12; i++) {
      const entry: Record<string, any> = { month: new Date(new Date().getFullYear(), new Date().getMonth() + i).toLocaleString('en', { month: 'short', year: '2-digit' }) };
      goals.forEach(g => { entry[g.name] = Math.min(Number(g.current_amount) + Number(g.monthly_contribution) * i, Number(g.target_amount)); });
      months.push(entry);
    }
    return months;
  }, [goals]);

  if (goals.length === 0) return null;
  return (
    <div className="card-forged p-5">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Savings Growth Projection</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={{ background: 'hsl(0, 0%, 8%)', border: '1px solid hsl(0, 0%, 15%)', borderRadius: 'var(--radius)', fontSize: 12 }} formatter={(value: number) => formatCurrency(value, false)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {goals.map((g, i) => <Line key={g.id} dataKey={g.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function SavingsGoals() {
  const { data: goals, add, update, remove } = useSavingsGoals();
  const { data: carFunds, add: addCarFund, update: updateCarFund, remove: removeCarFund } = useCarFunds();
  const { data: accounts } = useAccounts();
  const { data: rules } = useRecurringRules();
  const { data: profile } = useProfile();
  const { data: txns } = useTransactions();
  const { data: debts } = useDebts();
  const { isPremium } = useSubscription();
  const { isDemo } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const cashFloor = Number((profile as any)?.cash_floor) || 500;

  // Build full transaction stream including debt payments for linked-account math
  const baseTxns = useMemo(() => mergeWithGeneratedTransactions(txns || [], rules, accounts), [txns, rules, accounts]);
  const debtRecs = useMemo(() => getCurrentMonthDebtRecommendations(accounts, baseTxns, rules, debts, profile), [accounts, baseTxns, rules, debts, profile]);
  const debtTxns = useMemo(() => {
    const fundId = (profile as any)?.default_deposit_account ||
      accounts.find((a: any) => a.account_type === 'checking' && a.active)?.id || null;
    return createDebtPaymentTransactions(debtRecs, fundId);
  }, [debtRecs, profile, accounts]);
  const allTxns = useMemo(() => mergeDebtPaymentsIntoStream(baseTxns, debtTxns), [baseTxns, debtTxns]);

  // Account lookup
  const accountMap = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => { map[a.id] = a; });
    return map;
  }, [accounts]);

  // Merge car funds into goals for display
  const carGoals = useMemo(() => carFunds.map((c: any) => ({
    id: `car:${c.id}`,
    name: c.vehicle_name,
    target_amount: Number(c.down_payment_goal),
    current_amount: Number(c.current_saved),
    monthly_contribution: 0,
    target_date: null,
    goal_type: 'Car Fund',
    car_data: c,
    linked_account: (c as any).linked_account || null,
  })), [carFunds]);

  // Compute available-after-outflows for linked accounts using transaction-based math
  // Formula: account balance + remaining income - remaining expenses (including debt) - cash floor
  const getLinkedAmount = (accountId: string) => {
    const acct = accountMap[accountId];
    if (!acct) return 0;
    return getAccountRemainingCashThisMonth(accountId, acct.account_type, allTxns, Number(acct.balance), cashFloor);
  };

  const allGoals = useMemo(() => {
    const carNames = new Set(carGoals.map(c => c.name.toLowerCase()));
    const filtered = goals.filter(g => !carNames.has(g.name.toLowerCase()));
    return [...filtered.map(g => ({
      ...g,
      goal_type: (g as any).goal_type || 'Custom',
      current_amount: (g as any).linked_account && accountMap[(g as any).linked_account]
        ? Number(accountMap[(g as any).linked_account].balance)
        : Number(g.current_amount),
      available_after_outflows: (g as any).linked_account && accountMap[(g as any).linked_account]
        ? getLinkedAmount((g as any).linked_account)
        : null,
    })), ...carGoals];
  }, [goals, carGoals, accountMap, rules, cashFloor]);

  const totalSaved = allGoals.reduce((s, g) => s + Number(g.current_amount), 0);
  const totalTarget = allGoals.reduce((s, g) => s + Number(g.target_amount), 0);

  const accountOptions = useMemo(() => [
    { value: '', label: 'None (Manual)' },
    ...accounts.filter((a: any) => a.active).map((a: any) => ({ value: a.id, label: `${a.name} (${a.account_type.replace(/_/g, ' ')})` })),
  ], [accounts]);

  const openAdd = (goalType = 'Custom') => {
    if (goalType === 'Car Fund') setForm({ ...emptyCarForm });
    else setForm({ ...emptyForm, goal_type: goalType });
    setEditId(null); setShowForm(true);
  };

  const openEdit = (g: any) => {
    if (g.goal_type === 'Car Fund' && g.car_data) {
      const c = g.car_data;
      setForm({
        name: c.vehicle_name, target_amount: String(c.down_payment_goal), current_amount: String(c.current_saved),
        monthly_contribution: '0', target_date: '', goal_type: 'Car Fund',
        target_price: String(c.target_price), tax_fees: String(c.tax_fees),
        monthly_insurance: String(c.monthly_insurance), expected_apr: String(c.expected_apr),
        loan_term_months: String(c.loan_term_months), linked_account: '',
      } as any);
    } else {
      setForm({
        name: g.name, target_amount: String(g.target_amount), current_amount: String(g.current_amount),
        monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
        goal_type: g.goal_type || 'Custom', linked_account: (g as any).linked_account || '',
      });
    }
    setEditId(g.id); setShowForm(true);
  };

  const handleDuplicate = (g: any) => {
    if (g.goal_type === 'Car Fund' && g.car_data) {
      const c = g.car_data;
      setForm({
        name: `${c.vehicle_name} (Copy)`, target_amount: String(c.down_payment_goal), current_amount: '0',
        monthly_contribution: '0', target_date: '', goal_type: 'Car Fund',
        target_price: String(c.target_price), tax_fees: String(c.tax_fees),
        monthly_insurance: String(c.monthly_insurance), expected_apr: String(c.expected_apr),
        loan_term_months: String(c.loan_term_months), linked_account: '',
      } as any);
    } else {
      setForm({
        name: `${g.name} (Copy)`, target_amount: String(g.target_amount), current_amount: '0',
        monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
        goal_type: g.goal_type || 'Custom', linked_account: (g as any).linked_account || '',
      });
    }
    setEditId(null); setShowForm(true);
    toast.info('Goal duplicated — edit and save');
  };

  const handleSave = () => {
    const target_amount = parseFloat(form.target_amount);
    if (!form.name || isNaN(target_amount)) return;

    // Handle car fund updates
    if (editId && editId.startsWith('car:')) {
      const carId = editId.replace('car:', '');
      const carPayload: any = {
        id: carId,
        vehicle_name: form.name,
        down_payment_goal: target_amount,
        current_saved: parseFloat(form.current_amount) || 0,
      };
      const f = form as any;
      if (f.target_price !== undefined) carPayload.target_price = parseFloat(f.target_price) || 0;
      if (f.tax_fees !== undefined) carPayload.tax_fees = parseFloat(f.tax_fees) || 0;
      if (f.monthly_insurance !== undefined) carPayload.monthly_insurance = parseFloat(f.monthly_insurance) || 0;
      if (f.expected_apr !== undefined) carPayload.expected_apr = parseFloat(f.expected_apr) || 0;
      if (f.loan_term_months !== undefined) carPayload.loan_term_months = parseInt(f.loan_term_months) || 60;
      updateCarFund.mutate(carPayload);
      setShowForm(false);
      return;
    }

    const payload: any = {
      name: form.name, target_amount, current_amount: parseFloat(form.current_amount) || 0,
      monthly_contribution: parseFloat(form.monthly_contribution) || 0,
      target_date: form.target_date || null,
      linked_account: form.linked_account || null,
      goal_type: form.goal_type || 'Custom',
    };
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('car:')) {
      const carId = id.replace('car:', '');
      if (deleteConfirm === id) { removeCarFund.mutate(carId); setDeleteConfirm(null); }
      else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
      return;
    }
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  function estimateCompletion(g: any): string {
    const remaining = Number(g.target_amount) - Number(g.current_amount);
    if (remaining <= 0) return 'Complete';
    if (Number(g.monthly_contribution) <= 0) return 'Set contribution';
    const months = Math.ceil(remaining / Number(g.monthly_contribution));
    const date = new Date(); date.setMonth(date.getMonth() + months);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  const formFields = useMemo(() => {
    const fields: any[] = [
      { key: 'name', label: form.goal_type === 'Car Fund' ? 'Vehicle Name' : 'Goal Name', type: 'text', placeholder: form.goal_type === 'Car Fund' ? 'e.g., Porsche Cayman' : 'e.g., Emergency Fund' },
      { key: 'goal_type', label: 'Goal Type', type: 'select', options: GOAL_TYPES.map(t => ({ value: t, label: t })) },
      { key: 'linked_account', label: 'Linked Account (auto-pull balance)', type: 'select', options: accountOptions },
      { key: 'target_amount', label: form.goal_type === 'Car Fund' ? 'Down Payment Goal' : 'Target Amount', type: 'number', placeholder: '10000', step: '0.01' },
    ];
    // Only show manual current_amount if no linked account
    if (!form.linked_account) {
      fields.push({ key: 'current_amount', label: 'Current Saved', type: 'number', placeholder: '0', step: '0.01' });
    }
    fields.push(
      { key: 'monthly_contribution', label: 'Monthly Contribution', type: 'number', placeholder: '500', step: '0.01' },
      { key: 'target_date', label: 'Target Date', type: 'date' },
    );
    if (form.goal_type === 'Car Fund') {
      fields.push(
        { key: 'target_price', label: 'Vehicle Target Price', type: 'number', placeholder: '50000', step: '0.01' },
        { key: 'tax_fees', label: 'Tax & Fees', type: 'number', placeholder: '5000', step: '0.01' },
        { key: 'monthly_insurance', label: 'Monthly Insurance', type: 'number', placeholder: '250', step: '0.01' },
        { key: 'expected_apr', label: 'Expected Loan APR %', type: 'number', placeholder: '5.9', step: '0.01' },
        { key: 'loan_term_months', label: 'Loan Term (months)', type: 'number', placeholder: '60' },
      );
    }
    return fields;
  }, [form.goal_type, form.linked_account, accountOptions]);

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div><h1 className="font-display font-bold text-xl tracking-tight">Savings Goals</h1><p className="text-xs text-muted-foreground mt-0.5">Build your financial runway</p></div>
          <InstructionsModal pageTitle="Savings Goals Guide" sections={[
            { title: 'What is this page?', body: 'Track progress toward your financial goals — emergency fund, vacation, down payment, or car purchase. Link goals to real accounts for automatic balance sync.' },
            { title: 'Linked Accounts', body: 'When linked to an account, the goal\'s "current saved" automatically reflects that account balance. "Available after bills" shows the realistic amount after subtracting scheduled outflows.' },
            { title: 'Car Fund', body: 'The Car Fund mode adds vehicle-specific fields like price, APR, loan term, and insurance to give you a complete affordability picture.' },
            { title: 'Target Date', body: 'Set a target date to see estimated completion. The chart projects growth based on your monthly contribution.' },
          ]} />
        </div>
        <PremiumGate
          isPremium={isPremium || isDemo || (goals.length + carFunds.length) < 3}
          message="Upgrade to add unlimited savings goals"
          className="flex gap-2"
        >
          <div className="flex gap-2">
            <button onClick={() => openAdd('Custom')} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}><Plus size={12} /> Add Goal</button>
            <button onClick={() => openAdd('Car Fund')} className="flex items-center gap-1.5 border border-border text-foreground px-3 py-1.5 text-xs font-medium btn-press hover:bg-muted/30" style={{ borderRadius: 'var(--radius)' }}><Car size={12} /> Car Fund</button>
          </div>
        </PremiumGate>
      </div>

      <SavingsGrowthChart goals={allGoals} />

      <div className="grid grid-cols-2 gap-3">
        <div className="card-forged p-4 text-center"><p className="text-[10px] text-muted-foreground uppercase">Total Saved</p><p className="text-lg font-display font-bold text-success">{formatCurrency(totalSaved, false)}</p></div>
        <div className="card-forged p-4 text-center"><p className="text-[10px] text-muted-foreground uppercase">Total Target</p><p className="text-lg font-display font-bold text-foreground">{formatCurrency(totalTarget, false)}</p></div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {allGoals.map(g => {
          const pct = Number(g.target_amount) > 0 ? (Number(g.current_amount) / Number(g.target_amount)) * 100 : 0;
          const isCar = g.goal_type === 'Car Fund';
          const car = (g as any).car_data;
          const isLinked = !!(g as any).linked_account && accountMap[(g as any).linked_account];
          const linkedAcct = isLinked ? accountMap[(g as any).linked_account] : null;

          return (
            <div key={g.id} className="card-forged p-4 space-y-3 hover:border-primary/20 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {isCar && <Car size={14} className="text-primary" />}
                    <h3 className="text-sm font-semibold">{g.name}</h3>
                    <span className="text-[9px] px-1.5 py-0.5 bg-muted/50 border border-border text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>{g.goal_type || 'Custom'}</span>
                    {isLinked && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                        <Link2 size={8} /> {linkedAcct?.name}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {formatCurrency(Number(g.monthly_contribution), false)}/mo contribution
                    {isLinked && ' · Auto-synced from account'}
                    {(g as any).available_after_outflows != null && (
                      <span className="ml-1 text-muted-foreground">· Available after bills: {formatCurrency((g as any).available_after_outflows, false)}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleDuplicate(g)} className="text-muted-foreground hover:text-primary" title="Duplicate"><Copy size={13} /></button>
                  <button onClick={() => openEdit(g)} className="text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(g.id)} className={`${deleteConfirm === g.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-lg font-display font-bold text-primary">{formatCurrency(Number(g.current_amount), false)}</span>
                <span className="text-xs text-muted-foreground">of {formatCurrency(Number(g.target_amount), false)}</span>
              </div>
              <ProgressBar value={Number(g.current_amount)} max={Number(g.target_amount)} color={pct >= 100 ? 'success' : 'gold'} />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{pct.toFixed(0)}% complete</span>
                <span>Est. completion: {estimateCompletion(g)}</span>
              </div>
              {isCar && car && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                  <div className="text-center"><p className="text-[9px] text-muted-foreground uppercase">Vehicle Price</p><p className="text-xs font-display font-bold">{formatCurrency(Number(car.target_price), false)}</p></div>
                  <div className="text-center"><p className="text-[9px] text-muted-foreground uppercase">Est. Monthly</p><p className="text-xs font-display font-bold text-primary">{formatCurrency(calculateMonthlyPayment(Number(car.target_price) + Number(car.tax_fees) - Number(car.down_payment_goal), Number(car.expected_apr), Number(car.loan_term_months)), true)}</p></div>
                  <div className="text-center"><p className="text-[9px] text-muted-foreground uppercase">Insurance/mo</p><p className="text-xs font-display font-bold">{formatCurrency(Number(car.monthly_insurance), false)}</p></div>
                  <div className="text-center"><p className="text-[9px] text-muted-foreground uppercase">Loan Term</p><p className="text-xs font-display font-bold">{car.loan_term_months} mo</p></div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allGoals.length === 0 && (
        <div className="card-forged p-12 text-center"><p className="text-sm text-muted-foreground">No savings goals yet.</p><p className="text-xs text-muted-foreground mt-1">Set a target. Build discipline.</p></div>
      )}

      {showForm && (
        <FormModal
          title={editId ? 'Edit Goal' : form.goal_type === 'Car Fund' ? 'New Car Fund Goal' : 'New Savings Goal'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          saving={add.isPending || update.isPending || updateCarFund.isPending}
          saveLabel={editId ? 'Update Goal' : 'Add Goal'}
        />
      )}
    </div>
  );
}