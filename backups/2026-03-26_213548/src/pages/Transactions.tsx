import { useState, useMemo, useCallback } from 'react';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import { useTransactions, useAccounts, useRecurringRules, useDebts, useProfile } from '@/hooks/useSupabaseData';
import { CATEGORIES } from '@/lib/types';
import { getCurrentMonthDebtRecommendations } from '@/lib/credit-card-engine';
import { createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, mergeWithGeneratedTransactions } from '@/lib/pay-schedule';
import FormModal from '@/components/shared/FormModal';
import { Plus, ArrowUpRight, ArrowDownRight, Edit2, Trash2, Copy, Repeat, AlertTriangle, Landmark } from 'lucide-react';
import { toast } from 'sonner';

const ALL_CATEGORIES = ['Income', ...CATEGORIES];

const emptyForm = { date: new Date().toISOString().split('T')[0], type: 'expense', amount: '', category: 'Other', account: 'Checking', note: '', payment_source: '' };

export default function Transactions() {
  const { data: transactions, add, update, remove } = useTransactions();
  const { data: accounts } = useAccounts();
  const { data: rules, update: updateRule } = useRecurringRules();
  const { data: debts } = useDebts();
  const { data: profile } = useProfile();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editChoiceId, setEditChoiceId] = useState<string | null>(null);
  const [editChoiceRule, setEditChoiceRule] = useState<any>(null);

  // Build account lookup map
  const accountMap = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => { map[a.id] = a; map[`account:${a.id}`] = a; });
    return map;
  }, [accounts]);

  // Normalize a payment_source to `account:ID` format
  const normalizeSource = useCallback((src: string | null | undefined): string => {
    if (!src) return '';
    if (src.startsWith('account:')) return src;
    // If it's a raw account ID, prefix it
    if (accountMap[src]) return `account:${src}`;
    return src;
  }, [accountMap]);

  // Base transaction stream (real + generated recurring) shared across pages
  const baseTxns = useMemo(() => {
    return mergeWithGeneratedTransactions(transactions, rules, accounts)
      .map((t: any) => ({ ...t, isGenerated: Boolean((t as any).isGenerated), isDebtPayment: false }));
  }, [transactions, rules, accounts]);

  // Generate debt payment transactions from Debt Payoff schedule
  // Resolve funding account from profile or default to first checking account
  const fundingAccountId = useMemo(() => {
    const defaultId = profile?.default_deposit_account;
    if (defaultId) {
      const acct = accounts.find((a: any) => a.id === defaultId && a.active);
      if (acct) return acct.id;
    }
    const checking = accounts.find((a: any) => a.account_type === 'checking' && a.active);
    return checking?.id || '';
  }, [accounts, profile]);

  const debtPaymentTransactions = useMemo(() => {
    const recs = getCurrentMonthDebtRecommendations(accounts, baseTxns, rules, debts, profile);
    return createDebtPaymentTransactions(recs, fundingAccountId || null);
  }, [accounts, baseTxns, rules, debts, profile, fundingAccountId]);

  // Merge real + generated recurring + debt payments with shared dedup helper
  const allTransactions = useMemo(() => {
    const merged = mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTransactions);
    return merged.sort((a, b) => b.date.localeCompare(a.date));
  }, [baseTxns, debtPaymentTransactions]);

  const paymentSourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: 'cash', label: 'Cash' }];
    accounts.filter((a: any) => a.active).forEach((a: any) => {
      const typeLabel = a.account_type === 'credit_card' ? 'Credit Card'
        : a.account_type === 'high_yield_savings' ? 'HYS'
        : a.account_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      opts.push({ value: `account:${a.id}`, label: `${a.name} (${typeLabel})` });
    });
    if (opts.length === 1) {
      opts.push({ value: 'bank_account', label: 'Bank Account' });
      opts.push({ value: 'credit_card', label: 'Credit Card' });
    }
    return opts;
  }, [accounts]);

  const getSourceLabel = useCallback((source: string) => {
    if (!source) return 'Unassigned';
    // Try direct match
    const opt = paymentSourceOptions.find(o => o.value === source);
    if (opt) return opt.label;
    // Try with account: prefix
    const prefixed = paymentSourceOptions.find(o => o.value === `account:${source}`);
    if (prefixed) return prefixed.label;
    // Try raw account lookup
    const acct = accountMap[source];
    if (acct) return acct.name;
    if (source === 'bank_account') return 'Bank Account';
    if (source === 'credit_card') return 'Credit Card';
    if (source === 'cash') return 'Cash';
    return source;
  }, [paymentSourceOptions, accountMap]);

  // Check if a source account is missing/deleted
  const isSourceMissing = useCallback((source: string) => {
    if (!source || source === 'cash' || source === 'bank_account' || source === 'credit_card') return false;
    const id = source.startsWith('account:') ? source.slice(8) : source;
    return !accountMap[id] && !accountMap[`account:${id}`];
  }, [accountMap]);

  const filtered = useMemo(() => {
    return allTransactions.filter(t => {
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      if (filterSource !== 'all' && t.payment_source !== filterSource) return false;
      return true;
    });
  }, [allTransactions, filterType, filterCategory, filterSource]);

  const totals = useMemo(() => {
    const income = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    return { income, expense, net: income - expense };
  }, [filtered]);

  const spendBySource = useMemo(() => {
    const acc: Record<string, number> = {};
    allTransactions.filter(t => t.type === 'expense').forEach(t => {
      const src = getSourceLabel(t.payment_source || '');
      acc[src] = (acc[src] || 0) + Number(t.amount);
    });
    return acc;
  }, [allTransactions, getSourceLabel]);

  const openAdd = () => { setForm(emptyForm); setEditId(null); setShowForm(true); };

  const openEditDirect = (t: any) => {
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '' });
    setEditId(t.id); setShowForm(true);
  };

  const handleEditClick = (t: any) => {
    if (t.isGenerated && t.ruleId) {
      const rule = rules.find((r: any) => r.id === t.ruleId);
      setEditChoiceId(t.id);
      setEditChoiceRule(rule || null);
      return;
    }
    openEditDirect(t);
  };

  const handleEditOccurrence = (t: any) => {
    // Create as a real transaction (overrides this generated occurrence)
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '' });
    setEditId(null); // null = new transaction (override)
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing this occurrence only — saving will create a standalone transaction.');
  };

  const handleEditRule = () => {
    if (!editChoiceRule) return;
    // Navigate to Budget Control or open edit for the rule
    // For now, open a form pre-filled with rule data
    const r = editChoiceRule;
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: r.rule_type === 'income' ? 'income' : 'expense',
      amount: String(r.amount),
      category: r.rule_type === 'income' ? 'Income' : r.category,
      account: 'Checking',
      note: r.name,
      payment_source: normalizeSource(r.payment_source || r.deposit_account) || '',
    });
    // Store the rule ID for update
    setEditId(`rule:${r.id}`);
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing the recurring rule — changes affect all future occurrences.');
  };

  const duplicateTransaction = (t: any) => {
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: t.type,
      amount: String(t.amount),
      category: t.category,
      account: t.account || 'Checking',
      note: t.note || '',
      payment_source: normalizeSource(t.payment_source) || '',
    });
    setEditId(null);
    setShowForm(true);
  };

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (!amount) return;

    if (editId && editId.startsWith('rule:')) {
      // Update the recurring rule
      const ruleId = editId.slice(5);
      const rulePayload: any = {
        id: ruleId,
        amount,
        name: form.note || 'Transaction',
        category: form.category,
      };
      if (form.type === 'income') {
        rulePayload.rule_type = 'income';
        rulePayload.deposit_account = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      } else {
        rulePayload.rule_type = 'expense';
        rulePayload.payment_source = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      }
      updateRule.mutate(rulePayload);
      toast.success('Recurring rule updated — future transactions will reflect this change.');
    } else {
      const payload = { date: form.date, type: form.type, amount, category: form.category, account: form.account, note: form.note || 'Transaction', payment_source: form.payment_source };
      if (editId && !editId.startsWith('gen:')) {
        update.mutate({ id: editId, ...payload });
        toast.success('Transaction updated');
      } else {
        add.mutate(payload);
        toast.success('Transaction added');
      }
    }
    setShowForm(false); setForm(emptyForm); setEditId(null);
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('gen:')) return;
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const formFields = useMemo(() => [
    { key: 'date', label: 'Date', type: 'date' as const },
    { key: 'type', label: 'Type', type: 'select' as const, options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
    { key: 'amount', label: 'Amount', type: 'number' as const, placeholder: '0.00', step: '0.01' },
    { key: 'category', label: 'Category', type: 'select' as const, options: ALL_CATEGORIES.map(c => ({ value: c, label: c })) },
    { key: 'payment_source', label: editId?.startsWith('rule:') ? 'Account' : 'Payment Source', type: 'select' as const, options: paymentSourceOptions },
    { key: 'note', label: 'Note', type: 'text' as const, placeholder: 'What was this for?' },
  ], [paymentSourceOptions, editId]);

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-bold text-xl tracking-tight">Transactions</h1>
          <InstructionsModal pageTitle="Transactions Guide" sections={[
            { title: 'What is this page?', body: 'Transactions shows your complete ledger — real transactions you enter plus auto-generated ones from your Budget Control recurring rules and debt payoff plan.' },
            { title: 'Generated vs Real', body: 'Entries with badges (recurring, debt payment) are auto-generated from rules. Edit the occurrence to override just that instance, or edit the rule to change all future occurrences.' },
            { title: 'Filters', body: 'Filter by type (income/expense), category, or payment source to find specific entries.' },
            { title: 'How it affects the rest', body: 'Transactions feed the Dashboard monthly totals, Forecast projections, and spending breakdowns.' },
          ]} />
        </div>
        <button onClick={openAdd} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}><Plus size={12} /> Add</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'income', 'expense'] as const).map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 text-[11px] font-medium border btn-press ${filterType === t ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Categories</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Sources</option>
          {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card-forged p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Income</p><p className="text-sm font-display font-bold text-success">{formatCurrency(totals.income, false)}</p></div>
        <div className="card-forged p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Expenses</p><p className="text-sm font-display font-bold text-destructive">{formatCurrency(totals.expense, false)}</p></div>
        <div className="card-forged p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Net</p><p className={`text-sm font-display font-bold ${totals.net >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(totals.net, false)}</p></div>
      </div>

      {Object.keys(spendBySource).length > 0 && (
        <div className="card-forged p-4">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Spend by Payment Source</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(spendBySource).map(([src, amt]) => (
              <div key={src} className="p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-[10px] text-muted-foreground truncate">{src}</p>
                <p className="text-sm font-display font-bold text-destructive">{formatCurrency(amt, false)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-forged divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center"><p className="text-sm text-muted-foreground">No transactions found.</p></div>
        ) : filtered.map(t => {
          const sourceMissing = isSourceMissing(t.payment_source);
          return (
            <div key={t.id} className={`flex items-center justify-between px-4 py-3 ${t.isGenerated ? 'bg-muted/5' : ''} ${(t as any).isDebtPayment ? 'border-l-2 border-l-primary/40' : ''}`}>
              <div className="flex items-center gap-3">
                {(t as any).isDebtPayment ? <Landmark size={14} className="text-primary" /> : t.type === 'income' ? <ArrowUpRight size={14} className="text-success" /> : <ArrowDownRight size={14} className="text-destructive" />}
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium">{t.note || '—'}</p>
                    {t.isGenerated && !(t as any).isDebtPayment && <Repeat size={10} className="text-primary" />}
                    {(t as any).isDebtPayment && <span className="text-[9px] text-primary bg-primary/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>debt payoff</span>}
                    {sourceMissing && <span className="text-destructive" aria-label="Linked account not found"><AlertTriangle size={10} /></span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {t.date} · {t.category} · {sourceMissing ? <span className="text-destructive">⚠ Missing account</span> : getSourceLabel(t.payment_source)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold font-display ${t.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {t.type === 'income' ? '+' : '-'}{formatCurrency(Number(t.amount), false)}
                </span>
                <button onClick={() => duplicateTransaction(t)} className="text-muted-foreground hover:text-foreground" title="Duplicate"><Copy size={12} /></button>
                <button onClick={() => handleEditClick(t)} className="text-muted-foreground hover:text-foreground" title="Edit"><Edit2 size={12} /></button>
                {!t.isGenerated && (
                  <button onClick={() => handleDelete(t.id)} className={`${deleteConfirm === t.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Choice Dialog for Generated Transactions */}
      {editChoiceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }}>
          <div className="bg-card border border-border p-6 max-w-sm w-full mx-4 space-y-4" style={{ borderRadius: 'var(--radius)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-display font-bold">Edit Recurring Transaction</h3>
            <p className="text-xs text-muted-foreground">This transaction was auto-generated from a recurring rule. How would you like to edit it?</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const t = allTransactions.find(tx => tx.id === editChoiceId);
                  if (t) handleEditOccurrence(t);
                }}
                className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-xs font-semibold">Edit This Occurrence Only</p>
                <p className="text-[10px] text-muted-foreground">Creates a one-time override. Future months are unaffected.</p>
              </button>
              {editChoiceRule && (
                <button
                  onClick={handleEditRule}
                  className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                  <p className="text-xs font-semibold">Edit Recurring Rule</p>
                  <p className="text-[10px] text-muted-foreground">Updates the source rule in Budget Control. All future occurrences change.</p>
                </button>
              )}
            </div>
            <button onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          title={editId?.startsWith('rule:') ? 'Edit Recurring Rule' : editId ? 'Edit Transaction' : 'Add Transaction'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null); }}
          saving={add.isPending || update.isPending || updateRule.isPending}
          saveLabel={editId?.startsWith('rule:') ? 'Update Rule' : editId ? 'Update' : 'Add Transaction'}
        />
      )}
    </div>
  );
}
