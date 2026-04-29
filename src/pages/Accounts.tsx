import { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import { useAccounts, useDebts, useAccountReconciliations } from '@/hooks/useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { Link } from 'react-router-dom';
import MetricCard from '@/components/shared/MetricCard';
import FormModal from '@/components/shared/FormModal';
import PlaidLinkButton, { PlaidSyncedAccount } from '@/components/shared/PlaidLinkButton';
import PremiumGate from '@/components/shared/PremiumGate';
import {
  Building2, Plus, Edit2, Trash2, Wallet, TrendingUp, TrendingDown,
  CreditCard, PiggyBank, Landmark, DollarSign, Eye, EyeOff,
  Link2, Unlink, Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MatchEntry {
  plaidAccount: PlaidSyncedAccount & { plaid_account_id?: string };
  matchedAccountId: string | null; // null = keep as new
}

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'high_yield_savings', label: 'High-Yield Savings' },
  { value: 'hsa', label: 'HSA (Health Savings)' },
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

const ASSET_TYPES = ['checking', 'savings', 'high_yield_savings', 'hsa', 'business_checking', 'brokerage', 'roth_ira', '401k', 'cash', 'other_asset'];
const LIABILITY_TYPES = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];
const LIQUID_TYPES = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'];
const INVESTMENT_TYPES = ['brokerage'];
const RETIREMENT_TYPES = ['roth_ira', '401k'];

const TYPE_LABELS: Record<string, string> = {};
ACCOUNT_TYPES.forEach(t => { TYPE_LABELS[t.value] = t.label; });

const TYPE_ICONS: Record<string, any> = {
  checking: Building2, savings: PiggyBank, high_yield_savings: PiggyBank,
  hsa: PiggyBank, business_checking: Building2, brokerage: TrendingUp,
  roth_ira: TrendingUp, '401k': TrendingUp, cash: DollarSign,
  credit_card: CreditCard, student_loan: Landmark, auto_loan: Landmark,
  other_liability: TrendingDown, other_asset: Wallet,
};

function formatSyncStatus(lastSyncedAt: string | null): { text: string; isStale: boolean } {
  if (!lastSyncedAt) return { text: 'Not yet synced', isStale: false };
  const ms = Date.now() - new Date(lastSyncedAt).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours > 25) return { text: 'Sync delayed', isStale: true };
  if (hours < 1) {
    const mins = Math.round(ms / (1000 * 60));
    return { text: mins <= 1 ? 'Updated just now' : `Updated ${mins} min ago`, isStale: false };
  }
  const h = Math.floor(hours);
  if (h < 24) return { text: `Updated ${h} hour${h === 1 ? '' : 's'} ago`, isStale: false };
  const d = new Date(lastSyncedAt);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return { text: `Updated today at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, isStale: false };
  }
  return { text: `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, isStale: false };
}

const emptyForm = { name: '', account_type: 'checking', institution: '', balance: '', credit_limit: '', apr: '', notes: '', min_payment: '', apy_rate: '' };
const APY_TYPES = ['401k', 'roth_ira', 'brokerage', 'savings', 'high_yield_savings'];

export default function Accounts() {
  const { isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const { data: accounts, add, update, remove, loading } = useAccounts();
  const { data: debts, update: updateDebt, add: addDebt } = useDebts();
  const { add: addReconciliation } = useAccountReconciliations();
  const { items: plaidItems, loading: plaidLoading, remove: removePlaidItem, invalidate: invalidatePlaid } = usePlaidItems();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'assets' | 'liabilities'>('all');
  const [matchEntries, setMatchEntries] = useState<MatchEntry[]>([]);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [matchSaving, setMatchSaving] = useState(false);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState<string | null>(null);
  const [delinkConfirm, setDelinkConfirm] = useState<string | null>(null);
  const [delinking, setDelinking] = useState(false);
  const [plaidLinkedName, setPlaidLinkedName] = useState<string | null>(null);

  const handlePlaidSuccess = useCallback((syncedAccounts: PlaidSyncedAccount[], institutionName?: string) => {
  invalidatePlaid();
  qc.invalidateQueries({ queryKey: ['accounts'] });

  const name = institutionName ?? 'Your bank';
  setPlaidLinkedName(name);

  const manualAccounts = accounts.filter((a: any) => !a.plaid_account_id && a.active);

  const matchableAccounts = syncedAccounts.filter((synced) =>
    manualAccounts.some((manual: any) => {
      const syncedName = synced.name.trim().toLowerCase();
      const manualName = manual.name.trim().toLowerCase();
      return syncedName === manualName;
    })
  );

  if (matchableAccounts.length > 0) {
    setMatchEntries(
      matchableAccounts.map((a) => ({
        plaidAccount: a,
        matchedAccountId: null,
      }))
    );
  } else {
    setMatchEntries([]);
  }
}, [invalidatePlaid, qc, accounts]);

  const handleConfirmMatch = useCallback(async () => {
    const toMatch = matchEntries.filter(e => e.matchedAccountId !== null);
    if (toMatch.length === 0) { setShowMatchModal(false); return; }
    setMatchSaving(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      // Fresh fetch of ALL user accounts from DB (bypasses stale React state)
      const { data: allAccountsRaw, error: fetchErr } = await (supabase as any)
        .from('accounts')
        .select('id, name, institution, plaid_account_id, plaid_item_id, balance, active')
        .eq('user_id', currentUser.id);
      if (fetchErr) throw new Error(fetchErr.message);

      const allAccounts = (allAccountsRaw ?? []) as any[];
      const plaidCreatedAccounts = allAccounts.filter((a: any) => a.plaid_account_id);

      let matched = 0;
      for (const entry of toMatch) {
        // Use fresh DB data to find existing account (not stale React state)
        const existingAccount = allAccounts.find((a: any) => a.id === entry.matchedAccountId);
        if (!existingAccount) continue;

        const plaidAccountId = (entry.plaidAccount as any).plaid_account_id;
        const plaidCreated = plaidAccountId
          ? plaidCreatedAccounts.find((a: any) => a.plaid_account_id === plaidAccountId)
          : plaidCreatedAccounts.find((a: any) => a.name === entry.plaidAccount.name);

        if (!plaidCreated) continue;

        // Delete the Plaid-created duplicate FIRST — frees the unique constraint on plaid_account_id
        const { error: deleteErr } = await (supabase as any)
          .from('accounts')
          .delete()
          .eq('id', plaidCreated.id)
          .eq('user_id', currentUser.id);

        if (deleteErr) {
          console.error('Match delete failed:', deleteErr);
          toast.error(`Failed to match "${existingAccount.name}": ${deleteErr.message}`);
          continue;
        }

        // Now stamp Plaid link fields onto the existing manual account
        const { error: updateErr } = await (supabase as any)
          .from('accounts')
          .update({
            plaid_account_id: plaidCreated.plaid_account_id,
            plaid_item_id: plaidCreated.plaid_item_id,
            name: plaidCreated.name,
            institution: plaidCreated.institution,
            balance: plaidCreated.balance,
            active: true,
          })
          .eq('id', existingAccount.id)
          .eq('user_id', currentUser.id);

        if (updateErr) {
          console.error('Match update failed:', updateErr);
          toast.error(`Failed to match "${existingAccount.name}": ${updateErr.message}`);
          continue;
        }
        matched++;
      }

      if (matched > 0) toast.success(`Matched ${matched} account${matched !== 1 ? 's' : ''}`);
      invalidatePlaid();
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Match failed');
    } finally {
      setMatchSaving(false);
      setShowMatchModal(false);
    }
  }, [matchEntries, invalidatePlaid, qc]);

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

  const openAdd = () => { setForm(emptyForm); setEditId(null); setEditingPlaidLinked(false); setShowForm(true); };
  const [editingPlaidLinked, setEditingPlaidLinked] = useState(false);

  const openEdit = (a: any) => {
    const matchDebt = debts.find((d: any) => d.name.toLowerCase() === a.name.toLowerCase());
    setForm({
      name: a.name, account_type: a.account_type, institution: a.institution || '',
      balance: String(a.balance), credit_limit: String(a.credit_limit || ''), apr: String(a.apr || ''), notes: a.notes || '',
      min_payment: matchDebt ? String(matchDebt.min_payment) : '',
      apy_rate: a.apy_rate != null ? String(a.apy_rate) : '',
    });
    setEditingPlaidLinked(!!a.plaid_account_id);
    setEditId(a.id); setShowForm(true);
  };

  const handleSave = () => {
    const balance = parseFloat(form.balance);
    if (!form.name || isNaN(balance)) return;
    const payload: any = {
      name: form.name, account_type: form.account_type, institution: form.institution,
      credit_limit: parseFloat(form.credit_limit) || null, apr: parseFloat(form.apr) || null,
      notes: form.notes, active: true,
      apy_rate: APY_TYPES.includes(form.account_type) && form.apy_rate !== '' ? parseFloat(form.apy_rate) : null,
    };
    // Never overwrite Plaid-managed balance — it is owned by the sync job
    if (!editingPlaidLinked) payload.balance = balance;
    if (editId) {
      const existingAccount = accounts.find((a: any) => a.id === editId);
      const projectedBalance = existingAccount ? Number(existingAccount.balance) : balance;
      update.mutate({ id: editId, ...payload });
      if (!editingPlaidLinked && balance !== projectedBalance) {
        addReconciliation.mutate({
          account_id: editId,
          source_table: 'accounts',
          effective_date: new Date().toISOString().split('T')[0],
          delta: balance - projectedBalance,
          actual_balance: balance,
          projected_balance: projectedBalance,
        });
      }
    } else {
      add.mutate({ ...payload, balance });
    }
    
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

  const handleUnlinkAccount = async (accountId: string) => {
    if (unlinkConfirm !== accountId) {
      setUnlinkConfirm(accountId);
      setTimeout(() => setUnlinkConfirm(null), 4000);
      return;
    }
    setUnlinkConfirm(null);
    try {
      const { error } = await supabase.from('accounts').update({ plaid_account_id: null, plaid_item_id: null } as any).eq('id', accountId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account unlinked. Balance will no longer auto-sync.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlink failed');
    }
  };

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-8 overflow-x-hidden">
      {/* Plaid link success overlay */}
      {plaidLinkedName && !plaidSyncing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/85 backdrop-blur-sm p-4">
          <div className="card-forged w-full max-w-sm p-6 flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
              <Link2 size={24} className="text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{plaidLinkedName} linked!</p>
              <p className="text-xs text-muted-foreground mt-1">Balances synced successfully. Your accounts are ready.</p>
            </div>
            <button
              onClick={() => {
                setPlaidLinkedName(null);
                if (matchEntries.length > 0) setShowMatchModal(true);
              }}
              className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {matchEntries.length > 0 ? 'Match Accounts →' : 'Done'}
            </button>
          </div>
        </div>
      )}

      {/* Plaid exchange/sync loading overlay */}
      {plaidSyncing && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm gap-3">
          <Loader2 size={28} className="animate-spin text-primary" />
          <p className="text-sm font-semibold text-foreground">Linking your bank…</p>
          <p className="text-xs text-muted-foreground">Exchanging token and syncing balances</p>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Accounts</h1>
            <InstructionsModal pageTitle="Accounts Guide" sections={[
              { title: 'What is this page?', body: 'Accounts is the centralized source of truth for all your financial balances — checking, savings, investments, retirement, credit cards, and loans.' },
              { title: 'How it connects', body: 'Account balances drive net worth, liquid cash calculations, debt payoff recommendations, and payment source availability across the entire app.' },
              { title: 'Credit Cards', body: 'Credit card accounts automatically appear in the Debt Payoff Planner. Set APR and credit limits here for accurate utilization and interest calculations.' },
              { title: 'Tips', body: 'Mark accounts as inactive to exclude them from calculations without deleting. Use the filter to view assets vs liabilities separately.' },
            ]} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">Manage all financial accounts in one place</p>
        </div>
        <button onClick={openAdd} className="w-full sm:w-auto flex items-center justify-center sm:justify-start gap-1.5 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press" style={{ borderRadius: 'var(--radius)' }}>
          <Plus size={14} /> Add Account
        </button>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Your financial foundation</p>
              <p className="text-xs text-muted-foreground mt-0.5">Every account type in one place — balances here drive every number across the entire app.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Checking & Cash', desc: 'Liquid balance is the starting point for the debt payoff engine and the 36-month forecast.' },
              { label: 'Credit Cards', desc: 'Balance + APR feed the avalanche engine. Payment due date determines when each card gets paid.' },
              { label: 'Savings & HYS', desc: 'Tracked separately from cash so emergency funds are never counted as available for debt payments.' },
              { label: 'Investments & Retirement', desc: '401k, Roth IRA, and brokerage grow over time and appear in Net Worth projections.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground truncate">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Liquid Cash" value={formatCurrency(summary.liquidCash, false)} accent="success" icon={DollarSign} />
        <MetricCard label="Investments" value={formatCurrency(summary.investments, false)} accent="gold" icon={TrendingUp} />
        <MetricCard label="Retirement" value={formatCurrency(summary.retirement, false)} accent="gold" icon={TrendingUp} />
        <MetricCard label="Credit Card Debt" value={formatCurrency(summary.ccDebt, false)} accent="crimson" icon={CreditCard} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard label="Total Assets" value={formatCurrency(summary.totalAssets, false)} accent="success" icon={Wallet} />
        <MetricCard label="Total Liabilities" value={formatCurrency(summary.totalLiabilities, false)} accent="crimson" icon={TrendingDown} />
        <MetricCard label="Net Worth" value={formatCurrency(summary.netWorth, false)} accent={summary.netWorth >= 0 ? 'gold' : 'crimson'} icon={Wallet} />
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'assets', 'liabilities'] as const).map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 text-xs font-medium border btn-press ${filterType === t ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
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
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${liability ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                  <Icon size={16} className={liability ? 'text-destructive' : 'text-primary'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-semibold truncate">{a.name}</p>
                      {a.plaid_account_id && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 font-medium leading-none shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                          Auto-sync
                        </span>
                      )}
                    </div>
                    <span className={`text-base font-display font-bold shrink-0 ${liability ? 'text-destructive' : 'text-success'}`}>
                      {liability ? '-' : ''}{formatCurrency(Number(a.balance), false)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {TYPE_LABELS[a.account_type] || a.account_type}
                    {a.institution ? ` · ${a.institution}` : ''}
                    {a.apr ? ` · ${a.apr}% APR` : ''}
                    {a.apy_rate != null ? ` · ${a.apy_rate}% APY` : ''}
                    {a.credit_limit ? ` · Limit ${formatCurrency(Number(a.credit_limit), false)}` : ''}
                  </p>
                  <div className="flex items-center gap-0.5 mt-2 -ml-1">
                    {a.plaid_account_id && (
                      <button
                        onClick={() => handleUnlinkAccount(a.id)}
                        className={`text-xs font-medium px-1.5 py-1 border transition-colors mr-1 ${unlinkConfirm === a.id ? 'text-destructive border-destructive/40 bg-destructive/5' : 'text-muted-foreground border-transparent hover:text-destructive'}`}
                        style={{ borderRadius: 'var(--radius)' }}
                        title={unlinkConfirm === a.id ? 'Click again to confirm unlink' : 'Unlink from Plaid auto-sync'}
                      >
                        {unlinkConfirm === a.id ? 'Confirm unlink?' : <Unlink size={12} />}
                      </button>
                    )}
                    <button onClick={() => toggleActive(a)} className="icon-btn text-muted-foreground hover:text-foreground" title={a.active ? 'Deactivate' : 'Activate'}>
                      {a.active ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button onClick={() => openEdit(a)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                    <button onClick={() => handleDelete(a.id)} className={`icon-btn ${deleteConfirm === a.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
              {a.notes && <p className="text-xs text-muted-foreground mt-2 ml-12 break-words">{a.notes}</p>}
            </div>
          );
        })}
      </div>

      {/* ── Linked Banks (Plaid) ─────────────────────────────────────────── */}
      {!isDemo && (
        <div className="card-forged p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><Link2 size={14} className="text-primary" /> Linked Banks</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Auto-sync balances from your bank accounts (premium)</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isPremium && plaidItems.length < 10 && (
                <PlaidLinkButton
                  onSuccess={handlePlaidSuccess}
                  onProcessing={setPlaidSyncing}
                />
              )}
            </div>
          </div>

          {isPremium && plaidItems.length > 0 && (() => {
            const mostRecent = plaidItems
              .map(i => i.last_synced_at)
              .filter(Boolean)
              .sort()
              .at(-1);
            return (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${mostRecent ? 'bg-green-500' : 'bg-yellow-500'}`} />
                {mostRecent
                  ? `Last synced ${new Date(mostRecent).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · Updates daily at 9 AM ET`
                  : 'Not yet synced · Will sync daily at 9 AM ET'}
              </div>
            );
          })()}

          <p className="text-xs text-muted-foreground leading-relaxed">
            Bank connections are powered by{' '}
            <a href="https://plaid.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Plaid</a>
            , a trusted financial data platform used by thousands of apps. We never see your bank login credentials — Plaid handles authentication securely.{' '}
            <a href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
            {' · '}
            <a href="https://plaid.com/legal/#end-user-services-agreement" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms</a>
          </p>

          {!isPremium ? (
            <PremiumGate
              isPremium={false}
              title="Auto-Sync Bank Balances"
              features={['Connect up to 10 institutions', 'Balances sync daily and on demand', 'Flows into Forecast & Net Worth automatically']}
            >
              <div className="h-16" />
            </PremiumGate>
          ) : plaidLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Loading linked banks…
            </div>
          ) : plaidItems.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No linked banks yet. Click "Link Bank Account" to connect your first institution.</p>
          ) : (
            <div className="space-y-2">
              {plaidItems.map(item => (
                <div key={item.id} className="flex items-center justify-between py-2 gap-2 min-w-0 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 size={13} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{item.institution_name ?? 'Bank'}</p>
                      {(() => {
                        const { text, isStale } = formatSyncStatus(item.last_synced_at);
                        return (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            {isStale && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 inline-block" />}
                            {text}
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                  <button
                    disabled={delinking}
                    onClick={async () => {
                      if (delinkConfirm !== item.plaid_item_id) {
                        setDelinkConfirm(item.plaid_item_id);
                        return;
                      }
                      setDelinking(true);
                      setDelinkConfirm(null);
                      await removePlaidItem(item.plaid_item_id);
                      setDelinking(false);
                    }}
                    onBlur={() => setDelinkConfirm(null)}
                    className={`text-xs font-medium px-2 py-1 rounded border transition-colors shrink-0 ${
                      delinkConfirm === item.plaid_item_id
                        ? 'text-destructive border-destructive/40 bg-destructive/10'
                        : 'text-muted-foreground border-transparent hover:text-destructive'
                    }`}
                    title={delinkConfirm === item.plaid_item_id ? 'Click again to confirm' : 'Remove bank connection'}
                  >
                    {delinking && delinkConfirm === null ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : delinkConfirm === item.plaid_item_id ? (
                      'Confirm remove?'
                    ) : (
                      <Unlink size={13} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Account Match Modal ─────────────────────────────────────────── */}
      {showMatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="card-forged w-full max-w-md p-5 space-y-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Match Linked Accounts</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Do any of these Plaid accounts match accounts you already added manually? We'll merge the balance and enable auto-sync on the existing one.
              </p>
            </div>
            <div className="space-y-3">
              {matchEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{entry.plaidAccount.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{formatCurrency(entry.plaidAccount.balance, false)}</p>
                  </div>
                  <select
                    className="bg-secondary border border-border text-xs px-2 py-1 rounded flex-1 min-w-0 truncate"
                    value={entry.matchedAccountId ?? ''}
                    onChange={e => setMatchEntries(prev => prev.map((en, j) => j === i ? { ...en, matchedAccountId: e.target.value || null } : en))}
                  >
                    <option value="">Keep as new account</option>
                    {accounts
  .filter((a: any) => {
    if (a.plaid_account_id || !a.active) return false;
    const plaidName = entry.plaidAccount.name.trim().toLowerCase();
    const accountName = a.name.trim().toLowerCase();
    return plaidName === accountName;
  })
  .map((a: any) => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowMatchModal(false)} className="text-xs px-3 py-1.5 border border-border rounded hover:bg-secondary">Skip</button>
              <button
                onClick={handleConfirmMatch}
                disabled={matchSaving || matchEntries.every(e => !e.matchedAccountId)}
                className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
              >
                {matchSaving ? 'Saving…' : 'Confirm Matches'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          title={editId ? 'Edit Account' : 'Add Account'}
          fields={[
            { key: 'name', label: 'Account Name', type: 'text', placeholder: 'e.g., Chase Checking', required: true, disabled: editingPlaidLinked },
            { key: 'account_type', label: 'Account Type', type: 'select', options: ACCOUNT_TYPES, disabled: editingPlaidLinked },
            { key: 'institution', label: 'Institution', type: 'text', placeholder: 'e.g., Chase, Fidelity', disabled: editingPlaidLinked, hint: editingPlaidLinked ? 'Managed by Plaid' : undefined },
            { key: 'balance', label: 'Current Balance', type: 'number' as const, placeholder: '0.00', step: '0.01', required: true, disabled: editingPlaidLinked, hint: editingPlaidLinked ? 'Balance is managed by Plaid auto-sync' : undefined },
            ...(form.account_type === 'credit_card' ? [
              { key: 'credit_limit', label: 'Credit Limit', type: 'number' as const, placeholder: '0', step: '0.01' },
            ] : []),
            { key: 'apr', label: 'APR % (optional)', type: 'number' as const, placeholder: '0', step: '0.01' },
            ...(APY_TYPES.includes(form.account_type) ? [
              { key: 'apy_rate', label: 'APY % (annual growth rate)', type: 'number' as const, placeholder: '7.0', step: '0.1' },
            ] : []),
            ...(LIABILITY_TYPES.includes(form.account_type) ? [
              { key: 'min_payment', label: 'Minimum Payment', type: 'number' as const, placeholder: '25', step: '0.01' },
            ] : []),
            { key: 'notes', label: 'Notes (optional)', type: 'text' as const, placeholder: 'Any details...' },
          ]}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null); setEditingPlaidLinked(false); }}
          saving={add.isPending || update.isPending}
          saveLabel={editId ? 'Update Account' : 'Add Account'}
          notice={editingPlaidLinked ? 'Balance, name, type, and institution are managed by Plaid auto-sync. You can still edit APR, credit limit, minimum payment, and notes.' : undefined}
        />
      )}
    </div>
  );
}
