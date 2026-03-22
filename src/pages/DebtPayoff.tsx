import { useState, useMemo } from 'react';
import { formatCurrency } from '@/lib/calculations';
import { useDebts, useAccounts, useTransactions, useRecurringRules, useProfile } from '@/hooks/useSupabaseData';
import { calculatePayoffMonths, calculateTotalInterest } from '@/lib/calculations';
import FormModal from '@/components/shared/FormModal';
import InstructionsModal from '@/components/shared/InstructionsModal';
import CreditCardEngine from '@/components/debt/CreditCardEngine';
import { Plus, Edit2, Trash2, CreditCard, Landmark } from 'lucide-react';

const emptyForm = { name: '', balance: '', apr: '', min_payment: '', target_payment: '', credit_limit: '' };

export default function DebtPayoff() {
  const { data: debts, add, update, remove } = useDebts();
  const { data: accounts } = useAccounts();
  const { data: transactions } = useTransactions();
  const { data: rules } = useRecurringRules();
  const { data: profile } = useProfile();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'cards' | 'other'>('cards');

  // Filter debts to non-credit-card items
  const ccAccountNames = useMemo(() => {
    return new Set(accounts.filter((a: any) => a.account_type === 'credit_card').map((a: any) => a.name.toLowerCase()));
  }, [accounts]);

  const otherDebts = useMemo(() => debts.filter(d => !ccAccountNames.has(d.name.toLowerCase())), [debts, ccAccountNames]);

  const totalBalance = otherDebts.reduce((s, d) => s + Number(d.balance), 0);
  const totalMinPayment = otherDebts.reduce((s, d) => s + Number(d.min_payment), 0);
  const totalTargetPayment = otherDebts.reduce((s, d) => s + Number(d.target_payment), 0);

  const snowballOrder = [...otherDebts].sort((a, b) => Number(a.balance) - Number(b.balance));
  const avalancheOrder = [...otherDebts].sort((a, b) => Number(b.apr) - Number(a.apr));

  const openAdd = () => { setForm(emptyForm); setEditId(null); setShowForm(true); };
  const openEdit = (d: any) => {
    setForm({ name: d.name, balance: String(d.balance), apr: String(d.apr), min_payment: String(d.min_payment), target_payment: String(d.target_payment), credit_limit: String(d.credit_limit || '') });
    setEditId(d.id); setShowForm(true);
  };

  const handleSave = () => {
    const balance = parseFloat(form.balance);
    if (!form.name || isNaN(balance)) return;
    const payload = {
      name: form.name, balance, apr: parseFloat(form.apr) || 0, min_payment: parseFloat(form.min_payment) || 0,
      target_payment: parseFloat(form.target_payment) || parseFloat(form.min_payment) || 0, credit_limit: parseFloat(form.credit_limit) || 0,
    };
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const hasCreditCards = accounts.some((a: any) => a.account_type === 'credit_card' && a.active);

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-6xl mx-auto space-y-4 sm:space-y-6">
      <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg sm:text-xl tracking-tight">Debt Payoff Planner</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate">Eliminate debt with realistic, due-date-aware projections</p>
          </div>
          <InstructionsModal pageTitle="Debt Payoff Guide" sections={[
            { title: 'What is this page?', body: 'The Debt Payoff Planner helps you eliminate credit card and other debt using proven strategies. The engine uses due-date-aware cash estimation and always prioritizes minimum payments first.' },
            { title: 'Strategies', body: 'Avalanche pays the highest APR card first to minimize total interest. Snowball pays the smallest balance first for faster wins. Both enforce your cash floor and reserve for early next-month bills.' },
            { title: 'Due Dates', body: 'Each credit card can have a payment due date. The engine estimates available cash by each card\'s due date, factoring in income received and expenses due before that date.' },
            { title: 'Est. Liquid Cash', body: 'Estimated Liquid Cash uses only the funding balance plus income transactions already scheduled/recorded in Transactions between today and the card due date. Income is not counted from Budget Control separately — Transactions is the single source of truth to prevent double counting.' },
            { title: 'Safe to Pay', body: 'Safe to Pay = Est. Liquid Cash − Safe Minimum − Autopay Amounts. Only income from Transactions arriving between today and the due date is counted. Past income already in the funding balance is not double-counted.' },
            { title: 'Minimum Payment Priority', body: 'All card minimums are covered first whenever cash allows. Only after all minimums are met does the engine allocate extra to the priority card based on your chosen strategy.' },
            { title: 'Recommended Safe Minimum', body: 'The greater of your user-set cash floor and pre-paycheck next-month bills from the funding account. This protects you from going negative between paychecks.' },
            { title: 'Reset & Recalculate', body: 'Click "Reset & Recalculate" to clear all manual payment overrides and let the engine recalculate optimal payments. The engine auto-updates when your data changes — this button is only needed to undo manual overrides.' },
            { title: 'One-Time Transactions', body: 'Large one-time expenses entered in Transactions reduce available cash. Debt recommendations automatically adjust to preserve the cash floor. This means if you enter a car down payment, your debt payments will decrease that month.' },
            { title: 'Overrides', body: 'Click any monthly payment to override the recommended amount. Use "Revert" to return to the calculated recommendation.' },
          ]} />
        </div>
        {activeTab === 'other' && (
          <button onClick={openAdd} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press shrink-0" style={{ borderRadius: 'var(--radius)' }}>
            <Plus size={12} /> Add Debt
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('cards')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'cards' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <CreditCard size={13} /> Credit Card Payoff {hasCreditCards && <span className="ml-1 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>{accounts.filter((a: any) => a.account_type === 'credit_card' && a.active).length}</span>}
        </button>
        <button onClick={() => setActiveTab('other')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'other' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Landmark size={13} /> Other Debts {otherDebts.length > 0 && <span className="ml-1 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>{otherDebts.length}</span>}
        </button>
      </div>

      {activeTab === 'cards' ? (
        <CreditCardEngine accounts={accounts} transactions={transactions} rules={rules} debts={debts} profile={profile} />
      ) : (
        <>
          {/* Other Debts Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="card-forged p-4 text-center"><p className="text-[10px] text-muted-foreground uppercase">Total Owed</p><p className="text-lg font-display font-bold text-destructive">{formatCurrency(totalBalance, false)}</p></div>
            <div className="card-forged p-4 text-center"><p className="text-[10px] text-muted-foreground uppercase">Monthly Min</p><p className="text-lg font-display font-bold text-foreground">{formatCurrency(totalMinPayment, false)}</p></div>
            <div className="card-forged p-4 text-center"><p className="text-[10px] text-muted-foreground uppercase">Target Payment</p><p className="text-lg font-display font-bold text-primary">{formatCurrency(totalTargetPayment, false)}</p></div>
          </div>

          {/* Debt Cards */}
          <div className="space-y-3">
            {otherDebts.map(d => {
              const bal = Number(d.balance), apr = Number(d.apr), tp = Number(d.target_payment);
              const months = calculatePayoffMonths(bal, apr, tp);
              const interest = calculateTotalInterest(bal, apr, tp);
              return (
                <div key={d.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">{d.name}</h3>
                      <p className="text-[10px] text-muted-foreground">{apr}% APR · Min {formatCurrency(Number(d.min_payment), false)}/mo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-display font-bold text-destructive">{formatCurrency(bal, false)}</p>
                      <button onClick={() => openEdit(d)} className="text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className={`${deleteConfirm === d.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-[10px] text-muted-foreground">Target Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(tp, false)}/mo</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Payoff In</p><p className="text-xs font-semibold">{bal <= 0 ? 'Paid' : months === Infinity ? '—' : `${months} months`}</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{interest === Infinity ? '—' : formatCurrency(interest, false)}</p></div>
                  </div>
                </div>
              );
            })}
            {otherDebts.length === 0 && <div className="card-forged p-12 text-center"><p className="text-sm text-muted-foreground">No other debts tracked yet.</p></div>}
          </div>

          {/* Strategy */}
          {otherDebts.length > 1 && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card-forged p-4">
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Snowball Order</h3>
                <p className="text-[10px] text-muted-foreground mb-3">Smallest balance first.</p>
                {snowballOrder.map((d, i) => (
                  <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-xs"><span className="text-primary font-semibold mr-2">#{i + 1}</span>{d.name}</span>
                    <span className="text-xs text-muted-foreground">{formatCurrency(Number(d.balance), false)}</span>
                  </div>
                ))}
              </div>
              <div className="card-forged p-4">
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Avalanche Order</h3>
                <p className="text-[10px] text-muted-foreground mb-3">Highest interest first.</p>
                {avalancheOrder.map((d, i) => (
                  <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-xs"><span className="text-primary font-semibold mr-2">#{i + 1}</span>{d.name}</span>
                    <span className="text-xs text-muted-foreground">{Number(d.apr)}% APR</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showForm && (
        <FormModal
          title={editId ? 'Edit Debt' : 'Add Debt'}
          fields={[
            { key: 'name', label: 'Debt Name', type: 'text', placeholder: 'e.g., Student Loan' },
            { key: 'balance', label: 'Balance', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'apr', label: 'APR %', type: 'number', placeholder: '5.5', step: '0.01' },
            { key: 'min_payment', label: 'Minimum Payment', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'target_payment', label: 'Target Payment', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'credit_limit', label: 'Credit Limit (if card)', type: 'number', placeholder: '0', step: '0.01' },
          ]}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          saving={add.isPending || update.isPending}
          saveLabel={editId ? 'Update Debt' : 'Add Debt'}
        />
      )}
    </div>
  );
}
