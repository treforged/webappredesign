import { useState, useMemo } from 'react';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import { useAccounts, useDebts } from '@/hooks/useSupabaseData';
import MetricCard from '@/components/shared/MetricCard';
import FormModal from '@/components/shared/FormModal';
import {
  Building2, Plus, Edit2, Trash2, Wallet, TrendingUp, TrendingDown,
  CreditCard, PiggyBank, Landmark, DollarSign, Eye, EyeOff,
} from 'lucide-react';

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'high_yield_savings', label: 'High-Yield Savings' },
  { value: 'business_checking', label: 'Business Checking' },
  { value: 'brokerage', label: 'Brokerage' },
  { value: 'roth_ira', label: 'Roth IRA' },
  { value: '401k', label: '401k / Retirement' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'student_loan', label: 'Student Loan' },
  { value: 'auto_loan', label: 'Auto Loan' },
  { value: 'other_liability', label: 'Other Liability' },
  { value: 'other_asset', label: 'Other Asset' },
];

const ASSET_TYPES = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'brokerage', 'roth_ira', '401k', 'cash', 'other_asset'];
const LIABILITY_TYPES = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];
const LIQUID_TYPES = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'];
const INVESTMENT_TYPES = ['brokerage'];
const RETIREMENT_TYPES = ['roth_ira', '401k'];

const TYPE_LABELS: Record<string, string> = {};
ACCOUNT_TYPES.forEach(t => { TYPE_LABELS[t.value] = t.label; });

const TYPE_ICONS: Record<string, any> = {
  checking: Building2, savings: PiggyBank, high_yield_savings: PiggyBank,
  business_checking: Building2, brokerage: TrendingUp, roth_ira: TrendingUp,
  '401k': TrendingUp, cash: DollarSign, credit_card: CreditCard,
  student_loan: Landmark, auto_loan: Landmark, other_liability: TrendingDown,
  other_asset: Wallet,
};

const emptyForm = { name: '', account_type: 'checking', institution: '', balance: '', credit_limit: '', apr: '', notes: '', min_payment: '' };

export default function Accounts() {
  const { data: accounts, add, update, remove, loading } = useAccounts();
  const { data: debts, update: updateDebt, add: addDebt } = useDebts();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'assets' | 'liabilities'>('all');

  const activeAccounts = useMemo(() => accounts.filter((a: any) => a.active), [accounts]);

  const summary = useMemo(() => {
    const active = activeAccounts;
    const liquidCash = active.filter((a: any) => LIQUID_TYPES.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    const investments = active.filter((a: any) => INVESTMENT_TYPES.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    const retirement = active.filter((a: any) => RETIREMENT_TYPES.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    const ccDebt = active.filter((a: any) => a.account_type === 'credit_card').reduce((s: number, a: any) => s + Number(a.balance), 0);
    const totalLiabilities = active.filter((a: any) => LIABILITY_TYPES.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    const totalAssets = active.filter((a: any) => ASSET_TYPES.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    const netWorth = totalAssets - totalLiabilities;
    return { liquidCash, investments, retirement, ccDebt, totalLiabilities, totalAssets, netWorth };
  }, [activeAccounts]);

  const filteredAccounts = useMemo(() => {
    if (filterType === 'assets') return accounts.filter((a: any) => ASSET_TYPES.includes(a.account_type));
    if (filterType === 'liabilities') return accounts.filter((a: any) => LIABILITY_TYPES.includes(a.account_type));
    return accounts;
  }, [accounts, filterType]);

  const openAdd = () => { setForm(emptyForm); setEditId(null); setShowForm(true); };
  const openEdit = (a: any) => {
    const matchDebt = debts.find((d: any) => d.name.toLowerCase() === a.name.toLowerCase());
    setForm({
      name: a.name, account_type: a.account_type, institution: a.institution || '',
      balance: String(a.balance), credit_limit: String(a.credit_limit || ''), apr: String(a.apr || ''), notes: a.notes || '',
      min_payment: matchDebt ? String(matchDebt.min_payment) : '',
    });
    setEditId(a.id); setShowForm(true);
  };

  const handleSave = () => {
    const balance = parseFloat(form.balance);
    if (!form.name || isNaN(balance)) return;
    const payload: any = {
      name: form.name, account_type: form.account_type, institution: form.institution,
      balance, credit_limit: parseFloat(form.credit_limit) || null, apr: parseFloat(form.apr) || null,
      notes: form.notes, active: true,
    };
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    
    // Sync min_payment to debts table for credit card / debt accounts
    if (isLiability(form.account_type) && form.min_payment) {
      const minPay = parseFloat(form.min_payment);
      if (!isNaN(minPay) && minPay > 0) {
        const matchDebt = debts.find((d: any) => d.name.toLowerCase() === form.name.toLowerCase());
        if (matchDebt) {
          updateDebt.mutate({ id: matchDebt.id, min_payment: minPay, balance, apr: parseFloat(form.apr) || 0 });
        } else {
          addDebt.mutate({
            name: form.name, balance, apr: parseFloat(form.apr) || 0,
            min_payment: minPay, target_payment: minPay,
            credit_limit: parseFloat(form.credit_limit) || 0,
          });
        }
      }
    }
    
    setShowForm(false); setEditId(null);
  };

  const toggleActive = (a: any) => update.mutate({ id: a.id, active: !a.active });

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const isLiability = (type: string) => LIABILITY_TYPES.includes(type);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-2xl lg:text-3xl tracking-tight">Accounts</h1>
            <InstructionsModal pageTitle="Accounts Guide" sections={[
              { title: 'What is this page?', body: 'Accounts is the centralized source of truth for all your financial balances — checking, savings, investments, retirement, credit cards, and loans.' },
              { title: 'How it connects', body: 'Account balances drive net worth, liquid cash calculations, debt payoff recommendations, and payment source availability across the entire app.' },
              { title: 'Credit Cards', body: 'Credit card accounts automatically appear in the Debt Payoff Planner. Set APR and credit limits here for accurate utilization and interest calculations.' },
              { title: 'Tips', body: 'Mark accounts as inactive to exclude them from calculations without deleting. Use the filter to view assets vs liabilities separately.' },
            ]} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">Manage all financial accounts in one place</p>
        </div>
        <button onClick={openAdd} className="shrink-0 flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press" style={{ borderRadius: 'var(--radius)' }}>
          <Plus size={14} /> Add Account
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Liquid Cash" value={formatCurrency(summary.liquidCash, false)} accent="success" icon={DollarSign} />
        <MetricCard label="Investments" value={formatCurrency(summary.investments, false)} accent="gold" icon={TrendingUp} />
        <MetricCard label="Retirement" value={formatCurrency(summary.retirement, false)} accent="gold" icon={TrendingUp} />
        <MetricCard label="Credit Card Debt" value={formatCurrency(summary.ccDebt, false)} accent="crimson" icon={CreditCard} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Total Assets" value={formatCurrency(summary.totalAssets, false)} accent="success" icon={Wallet} />
        <MetricCard label="Total Liabilities" value={formatCurrency(summary.totalLiabilities, false)} accent="crimson" icon={TrendingDown} />
        <MetricCard label="Net Worth" value={formatCurrency(summary.netWorth, false)} accent={summary.netWorth >= 0 ? 'gold' : 'crimson'} icon={Wallet} />
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'assets', 'liabilities'] as const).map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 text-[11px] font-medium border btn-press ${filterType === t ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
            {t === 'all' ? 'All Accounts' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Account List */}
      <div className="space-y-3">
        {loading && <div className="card-forged p-8 text-center"><p className="text-sm text-muted-foreground">Loading accounts...</p></div>}
        {!loading && filteredAccounts.length === 0 && (
          <div className="card-forged p-8 text-center"><p className="text-sm text-muted-foreground">No accounts yet. Add one above.</p></div>
        )}
        {filteredAccounts.map((a: any) => {
          const Icon = TYPE_ICONS[a.account_type] || Wallet;
          const liability = isLiability(a.account_type);
          return (
            <div key={a.id} className={`card-forged p-4 transition-opacity ${!a.active ? 'opacity-40' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center ${liability ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                    <Icon size={16} className={liability ? 'text-destructive' : 'text-primary'} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {TYPE_LABELS[a.account_type] || a.account_type}
                      {a.institution ? ` · ${a.institution}` : ''}
                      {a.apr ? ` · ${a.apr}% APR` : ''}
                      {a.credit_limit ? ` · Limit ${formatCurrency(Number(a.credit_limit), false)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-display font-bold ${liability ? 'text-destructive' : 'text-success'}`}>
                    {liability ? '-' : ''}{formatCurrency(Number(a.balance), false)}
                  </span>
                  <button onClick={() => toggleActive(a)} className="text-muted-foreground hover:text-foreground" title={a.active ? 'Deactivate' : 'Activate'}>
                    {a.active ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button onClick={() => openEdit(a)} className="text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(a.id)} className={`${deleteConfirm === a.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                </div>
              </div>
              {a.notes && <p className="text-[10px] text-muted-foreground mt-2 ml-12">{a.notes}</p>}
            </div>
          );
        })}
      </div>

      {showForm && (
        <FormModal
          title={editId ? 'Edit Account' : 'Add Account'}
          fields={[
            { key: 'name', label: 'Account Name', type: 'text', placeholder: 'e.g., Chase Checking', required: true },
            { key: 'account_type', label: 'Account Type', type: 'select', options: ACCOUNT_TYPES },
            { key: 'institution', label: 'Institution', type: 'text', placeholder: 'e.g., Chase, Fidelity' },
            { key: 'balance', label: 'Current Balance', type: 'number' as const, placeholder: '0.00', step: '0.01', required: true },
            { key: 'credit_limit', label: 'Credit Limit (cards only)', type: 'number' as const, placeholder: '0', step: '0.01' },
            { key: 'apr', label: 'APR % (optional)', type: 'number' as const, placeholder: '0', step: '0.01' },
            ...(LIABILITY_TYPES.includes(form.account_type) ? [
              { key: 'min_payment', label: 'Minimum Payment', type: 'number' as const, placeholder: '25', step: '0.01' },
            ] : []),
            { key: 'notes', label: 'Notes (optional)', type: 'text' as const, placeholder: 'Any details...' },
          ]}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null); }}
          saving={add.isPending || update.isPending}
          saveLabel={editId ? 'Update Account' : 'Add Account'}
        />
      )}
    </div>
  );
}
