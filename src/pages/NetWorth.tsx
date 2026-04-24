import { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import { useAccounts, useAssets, useLiabilities, useAccountReconciliations, useNetWorthSnapshots, useProfile, useRecurringRules } from '@/hooks/useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import MetricCard from '@/components/shared/MetricCard';
import PremiumGate from '@/components/shared/PremiumGate';
import FormModal from '@/components/shared/FormModal';
import { projectMilestones, monthlyContribForAccount } from '@/lib/retirement-projection';
import { buildPayConfig, getPaycheckGross } from '@/lib/pay-schedule';
import {
  Wallet, TrendingUp, TrendingDown, ArrowUpRight,
  Plus, Trash2, Edit2, Building2,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { ASSET_TYPES, LIABILITY_TYPES } from '@/lib/types';

const COLORS = [
  'hsl(43, 56%, 52%)', 'hsl(142, 50%, 40%)', 'hsl(200, 60%, 50%)',
  'hsl(280, 50%, 50%)', 'hsl(30, 80%, 55%)', 'hsl(0, 0%, 40%)',
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.name || payload[0].payload.month}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

const ACCOUNT_TYPE_MAP: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', high_yield_savings: 'Savings',
  business_checking: 'Checking', cash: 'Cash', brokerage: 'Brokerage',
  '401k': 'Retirement', roth_ira: 'Retirement', ira: 'Retirement',
  hsa: 'Retirement', credit_card: 'Credit Card',
};

const emptyAssetForm = { name: '', type: 'Checking', value: '', notes: '' };
const emptyLiabilityForm = { name: '', type: 'Credit Card', balance: '', apr: '', notes: '' };

export default function NetWorth() {
  const { isDemo, user } = useAuth();
  const { isPremium } = useSubscription();
  const { data: accounts } = useAccounts();
  const { data: profile } = useProfile();
  const { data: rules } = useRecurringRules();
  const { data: manualAssets, add: addAsset, update: updateAsset, remove: removeAsset } = useAssets();
  const { data: manualLiabilities, add: addLiability, update: updateLiability, remove: removeLiability } = useLiabilities();
  const { add: addReconciliation } = useAccountReconciliations();
  const { data: snapshots, upsert: upsertSnapshot } = useNetWorthSnapshots();

  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showLiabilityForm, setShowLiabilityForm] = useState(false);
  const [editAssetId, setEditAssetId] = useState<string | null>(null);
  const [editLiabilityId, setEditLiabilityId] = useState<string | null>(null);
  const [assetForm, setAssetForm] = useState(emptyAssetForm);
  const [liabilityForm, setLiabilityForm] = useState(emptyLiabilityForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Auto-pull assets from Accounts
  const liveAssets = useMemo(() => {
    return accounts
      .filter((a: any) => a.active && a.account_type !== 'credit_card')
      .map((a: any) => ({
        id: `live:${a.id}`,
        name: a.name,
        type: ACCOUNT_TYPE_MAP[a.account_type] || 'Other',
        value: Number(a.balance),
        notes: a.institution || '',
        isLive: true,
      }));
  }, [accounts]);

  // Auto-pull liabilities from Accounts (credit cards)
  const liveLiabilities = useMemo(() => {
    return accounts
      .filter((a: any) => a.active && a.account_type === 'credit_card')
      .map((a: any) => ({
        id: `live:${a.id}`,
        name: a.name,
        type: 'Credit Card',
        balance: Number(a.balance),
        apr: Number(a.apr) || 0,
        notes: a.institution || '',
        isLive: true,
      }));
  }, [accounts]);

  // Combine live + manual, avoiding duplicates by name
  const liveAssetNames = new Set(liveAssets.map(a => a.name.toLowerCase()));
  const liveLiabilityNames = new Set(liveLiabilities.map(l => l.name.toLowerCase()));

  const allAssets = useMemo(() => {
    const manual = manualAssets.filter(a => !liveAssetNames.has(a.name.toLowerCase())).map(a => ({ ...a, isLive: false }));
    return [...liveAssets, ...manual];
  }, [liveAssets, manualAssets, liveAssetNames]);

  const allLiabilities = useMemo(() => {
    const manual = manualLiabilities.filter(l => !liveLiabilityNames.has(l.name.toLowerCase())).map(l => ({ ...l, isLive: false }));
    return [...liveLiabilities, ...manual];
  }, [liveLiabilities, manualLiabilities, liveLiabilityNames]);

  const totalAssets = allAssets.reduce((s, a) => s + Number(a.value), 0);
  const totalLiabilities = allLiabilities.reduce((s, l) => s + Number(l.balance), 0);
  const netWorth = totalAssets - totalLiabilities;

  // ── Retirement growth projections (all users) ───────────────────────────────
  const RETIRE_TYPES = ['401k', 'roth_ira', 'ira', 'brokerage', 'hsa'];
  const DEFAULT_APY = 7;

  const retirementProjections = useMemo(() => {
    const prof = profile as any;
    const retireAccounts = accounts.filter((a: any) => a.active && RETIRE_TYPES.includes(a.account_type));
    if (retireAccounts.length === 0) return [];

    const payConfig = buildPayConfig(prof);
    const paycheckGross = getPaycheckGross(payConfig);
    const paychecksPerYear = payConfig.frequency === 'biweekly' ? 26 : payConfig.frequency === 'monthly' ? 12 : 52;

    const deductions: { value: number; mode: 'flat' | 'pct'; accountId?: string }[] =
      Array.isArray(prof?.paycheck_deductions) ? prof.paycheck_deductions : [];

    // Also count transfer rules depositing into retirement accounts
    const retireIds = new Set(retireAccounts.map((a: any) => a.id as string));
    const transferContribByAccount: Record<string, number> = {};
    for (const r of (rules || [])) {
      if (!r.active) continue;
      if (r.rule_type !== 'transfer' && r.rule_type !== 'investment') continue;
      const destId = r.deposit_account as string | undefined;
      if (!destId || !retireIds.has(destId)) continue;
      const amt = Number(r.amount);
      const monthly = r.frequency === 'weekly' ? amt * 4.33
        : r.frequency === 'biweekly' ? amt * 2.167
        : r.frequency === 'yearly' ? amt / 12
        : amt;
      transferContribByAccount[destId] = (transferContribByAccount[destId] || 0) + monthly;
    }

    return retireAccounts.map((a: any) => {
      const apyRate = a.apy_rate != null ? Number(a.apy_rate) : DEFAULT_APY;
      const fromDeductions = monthlyContribForAccount(deductions, a.id, paycheckGross, paychecksPerYear);
      const fromTransfers = transferContribByAccount[a.id] || 0;
      // Avoid double-counting: if a deduction links to this account, use deduction amount as authoritative
      const monthlyContrib = fromDeductions > 0 ? fromDeductions : fromTransfers;
      const milestones = projectMilestones(Number(a.balance), monthlyContrib, apyRate);
      return { account: a, apyRate, monthlyContrib, milestones };
    });
  }, [accounts, profile, rules]);

  const assetsByType = useMemo(() => {
    const acc: Record<string, number> = {};
    allAssets.forEach(a => { acc[a.type] = (acc[a.type] || 0) + Number(a.value); });
    return Object.entries(acc).map(([name, value]) => ({ name, value }));
  }, [allAssets]);

  const liabilitiesByType = useMemo(() => {
    const acc: Record<string, number> = {};
    allLiabilities.forEach(l => { acc[l.type] = (acc[l.type] || 0) + Number(l.balance); });
    return Object.entries(acc).map(([name, value]) => ({ name, value }));
  }, [allLiabilities]);

  // Auto-save snapshot at most once per 7 days
  const snapshotSaved = useRef(false);
  useEffect(() => {
    if (isDemo || snapshotSaved.current || !user) return;
    if (totalAssets === 0 && totalLiabilities === 0) return; // no data yet

    const today = new Date().toISOString().split('T')[0];
    const lastSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

    if (lastSnapshot) {
      const lastDate = new Date(lastSnapshot.snapshot_date);
      const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      if (daysSince < 7) return;
    }

    snapshotSaved.current = true;
    upsertSnapshot.mutate({
      snapshot_date: today,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      net_worth: netWorth,
    });
  }, [snapshots, totalAssets, totalLiabilities, netWorth, isDemo, user, upsertSnapshot]);

  // Build trend from historical snapshots; fall back to current value if none saved yet
  const netWorthTrend = useMemo(() => {
    if (snapshots.length === 0) {
      const now = new Date();
      return [{ month: now.toLocaleString('en', { month: 'short' }), value: netWorth }];
    }
    return snapshots.map((s: any) => ({
      month: new Date(s.snapshot_date).toLocaleString('en', { month: 'short', day: 'numeric' }),
      value: Number(s.net_worth),
    }));
  }, [snapshots, netWorth]);

  // Monthly change: compare the two most recent snapshots at least 25 days apart
  const monthlyChange = useMemo((): number | null => {
    if (snapshots.length < 2) return null;
    const latest = snapshots[snapshots.length - 1];
    for (let i = snapshots.length - 2; i >= 0; i--) {
      const older = snapshots[i];
      const daysBetween = Math.floor(
        (new Date(latest.snapshot_date).getTime() - new Date(older.snapshot_date).getTime()) / 86400000,
      );
      if (daysBetween >= 25) return Number(latest.net_worth) - Number(older.net_worth);
    }
    return null;
  }, [snapshots]);

  const openAddAsset = () => { setAssetForm(emptyAssetForm); setEditAssetId(null); setShowAssetForm(true); };
  const openEditAsset = (a: any) => { setAssetForm({ name: a.name, type: a.type, value: String(a.value), notes: a.notes || '' }); setEditAssetId(a.id); setShowAssetForm(true); };
  const saveAsset = () => {
    const val = parseFloat(assetForm.value);
    if (!assetForm.name || isNaN(val)) return;
    if (editAssetId && !editAssetId.startsWith('live:')) {
      updateAsset.mutate({ id: editAssetId, name: assetForm.name, type: assetForm.type, value: val, notes: assetForm.notes });
    } else {
      addAsset.mutate({ name: assetForm.name, type: assetForm.type, value: val, notes: assetForm.notes });
    }
    setShowAssetForm(false);
  };

  const openAddLiability = () => { setLiabilityForm(emptyLiabilityForm); setEditLiabilityId(null); setShowLiabilityForm(true); };
  const openEditLiability = (l: any) => { setLiabilityForm({ name: l.name, type: l.type, balance: String(l.balance), apr: String(l.apr || ''), notes: l.notes || '' }); setEditLiabilityId(l.id); setShowLiabilityForm(true); };
  const saveLiability = () => {
    const bal = parseFloat(liabilityForm.balance);
    if (!liabilityForm.name || isNaN(bal)) return;
    if (editLiabilityId && !editLiabilityId.startsWith('live:')) {
      const existingLiability = manualLiabilities.find((l: any) => l.id === editLiabilityId);
      const projectedBalance = existingLiability ? Number(existingLiability.balance) : bal;
      const delta = bal - projectedBalance;
      updateLiability.mutate({ id: editLiabilityId, name: liabilityForm.name, type: liabilityForm.type, balance: bal, apr: parseFloat(liabilityForm.apr) || 0, notes: liabilityForm.notes });
      if (delta !== 0) {
        addReconciliation.mutate({
          account_id: editLiabilityId,
          source_table: 'liabilities',
          effective_date: new Date().toISOString().split('T')[0],
          delta,
          actual_balance: bal,
          projected_balance: projectedBalance,
        });
      }
    } else {
      addLiability.mutate({ name: liabilityForm.name, type: liabilityForm.type, balance: bal, apr: parseFloat(liabilityForm.apr) || 0, notes: liabilityForm.notes });
    }
    setShowLiabilityForm(false);
  };

  const handleDelete = (id: string, type: 'asset' | 'liability') => {
    if (id.startsWith('live:')) return; // Can't delete live entries
    if (deleteConfirm === id) {
      if (type === 'asset') removeAsset.mutate(id); else removeLiability.mutate(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-5 sm:space-y-8 overflow-x-hidden">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Net Worth</h1>
          <p className="text-sm text-muted-foreground mt-1">Auto-calculated from your live accounts & manual entries</p>
        </div>
        <InstructionsModal pageTitle="Net Worth Guide" sections={[
          { title: 'What is this page?', body: 'Net Worth tracks your total financial position: Assets − Liabilities = Net Worth. It auto-pulls from your Accounts and lets you add manual entries for items not in Accounts.' },
          { title: 'How values are calculated', body: 'Total Assets includes all asset-type accounts (checking, savings, investments, retirement) plus manual asset entries. Total Liabilities includes credit cards, loans, and manual liabilities.' },
          { title: 'Charts', body: 'The chart shows your current net worth based on live account data. Historical chart points only appear when actual saved data exists — current live balances do not create fake past history. Future projections, if shown, are visually distinct from recorded data.' },
          { title: 'Manual entries', body: 'Use manual assets/liabilities for things like real estate, vehicles, or personal loans not tracked in Accounts.' },
        ]} />
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Tracking Jordan's wealth trajectory — from negative to positive</p>
              <p className="text-xs text-muted-foreground mt-0.5">Started at −$7,800 in January. Crossed zero in early March. Every debt payment and contribution moved this number.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Weekly snapshots', desc: 'The chart uses 14 saved snapshots from Jan–Apr showing the real progression. The Jan 10 dip was a $380 car repair that spiked the CC balance.' },
              { label: 'Auto-calculated totals', desc: 'Assets and liabilities pull live from Accounts — no manual entry needed for anything tracked there.' },
              { label: 'Student loan', desc: 'The $8,000 federal student loan is a manual liability. It reduces net worth but isn\'t part of the CC avalanche payoff plan.' },
              { label: 'Connects to Forecast', desc: 'The Forecast page projects where net worth goes over 36 months as debt is eliminated and savings grow.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Assets" value={formatCurrency(totalAssets, false)} accent="success" icon={TrendingUp} />
        <MetricCard label="Total Liabilities" value={formatCurrency(totalLiabilities, false)} accent="crimson" icon={TrendingDown} />
        <MetricCard label="Net Worth" value={formatCurrency(netWorth, false)} accent="gold" icon={Wallet} />
        <MetricCard
          label="Monthly Change"
          value={monthlyChange !== null ? formatCurrency(monthlyChange, false) : 'No history yet'}
          accent={monthlyChange !== null ? (monthlyChange >= 0 ? 'success' : 'crimson') : 'gold'}
          icon={ArrowUpRight}
        />
      </div>

      <div className="card-forged p-5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">{snapshots.length > 1 ? 'Net Worth History' : 'Current Net Worth'}</h3>
        {netWorthTrend.length <= 1 ? (
          <div className="flex flex-col items-center justify-center h-[200px] text-center">
            <Wallet size={28} className="text-primary mb-3" />
            <p className="text-2xl font-display font-bold text-primary whitespace-nowrap">{formatCurrency(netWorth, false)}</p>
            <p className="text-xs text-muted-foreground mt-2">{snapshots.length > 0 ? 'First snapshot saved — chart will populate over the coming weeks.' : 'Historical chart will appear once monthly snapshots are saved. Only real recorded data is shown — see Forecast for projected net worth trends.'}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={netWorthTrend} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} interval={window.innerWidth < 640 ? Math.ceil(netWorthTrend.length / 5) : 0} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Line dataKey="value" stroke="hsl(43, 56%, 52%)" strokeWidth={2.5} dot={{ r: 4, fill: 'hsl(43, 56%, 52%)', strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Assets */}
        <div className="card-forged p-5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assets Breakdown</h3>
            <button onClick={openAddAsset} className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
              <Plus size={12} /> Add Manual Asset
            </button>
          </div>
          <div className="flex gap-4">
            {assetsByType.length > 0 && (
              <div className="hidden sm:block shrink-0">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={assetsByType} cx="50%" cy="50%" innerRadius={28} outerRadius={50} dataKey="value" strokeWidth={0}>
                      {assetsByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1.5">
              {allAssets.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: COLORS[assetsByType.findIndex(t => t.name === a.type) % COLORS.length] }} />
                    <span className="font-medium truncate">{a.name}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">{a.type}</span>
                    {(a as any).isLive && <span className="text-[9px] text-primary bg-primary/10 px-1 py-0.5 shrink-0" style={{ borderRadius: 'var(--radius)' }}>live</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-bold font-display text-success whitespace-nowrap">{formatCurrency(Number(a.value), false)}</span>
                    {!(a as any).isLive && (
                      <>
                        <button onClick={() => openEditAsset(a)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={12} /></button>
                        <button onClick={() => handleDelete(a.id, 'asset')} className={`icon-btn ${deleteConfirm === a.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={12} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {allAssets.length === 0 && <p className="text-xs text-muted-foreground">No assets yet.</p>}
            </div>
          </div>
        </div>

        {/* Liabilities */}
        <div className="card-forged p-5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Liabilities Breakdown</h3>
            <button onClick={openAddLiability} className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
              <Plus size={12} /> Add Manual Liability
            </button>
          </div>
          <div className="flex gap-4">
            {liabilitiesByType.length > 0 && (
              <div className="hidden sm:block shrink-0">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={liabilitiesByType} cx="50%" cy="50%" innerRadius={28} outerRadius={50} dataKey="value" strokeWidth={0}>
                      {liabilitiesByType.map((_, i) => <Cell key={i} fill={['hsl(0, 73%, 35%)', 'hsl(30, 80%, 55%)', 'hsl(0, 50%, 50%)'][i % 3]} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1.5">
              {allLiabilities.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: ['hsl(0, 73%, 35%)', 'hsl(30, 80%, 55%)', 'hsl(0, 50%, 50%)'][liabilitiesByType.findIndex(t => t.name === l.type) % 3] }} />
                    <span className="font-medium truncate">{l.name}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">{l.type}</span>
                    {(l as any).isLive && <span className="text-[9px] text-primary bg-primary/10 px-1 py-0.5 shrink-0" style={{ borderRadius: 'var(--radius)' }}>live</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-bold font-display text-destructive whitespace-nowrap">{formatCurrency(Number(l.balance), false)}</span>
                    {!(l as any).isLive && (
                      <>
                        <button onClick={() => openEditLiability(l)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={12} /></button>
                        <button onClick={() => handleDelete(l.id, 'liability')} className={`icon-btn ${deleteConfirm === l.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={12} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {allLiabilities.length === 0 && <p className="text-xs text-muted-foreground">No liabilities yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Retirement Growth Projections (all users) ────────────────────── */}
      {retirementProjections.length > 0 && (
        <div className="card-forged p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-primary" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Retirement & Investment Growth Projections</h3>
          </div>
          <div className="space-y-4">
            {retirementProjections.map(({ account, apyRate, monthlyContrib, milestones }) => (
              <div key={account.id} className="border border-border/40 rounded-sm p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.account_type.toUpperCase().replace('_', ' ')} · {apyRate}% APY
                      {monthlyContrib > 0 && ` · +${formatCurrency(monthlyContrib, false)}/mo contributions`}
                    </p>
                  </div>
                  <span className="text-xs font-bold font-display text-foreground">{formatCurrency(Number(account.balance), false)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([['1yr', milestones.year1], ['5yr', milestones.year5], ['10yr', milestones.year10], ['20yr', milestones.year20]] as [string, number][]).map(([label, val]) => (
                    <div key={label} className="bg-muted/30 border border-border/30 px-2 py-1.5 text-center rounded-sm">
                      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
                      <p className="text-xs font-bold font-display text-success">{formatCurrency(val, false)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {retirementProjections.length > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground font-medium">Combined projected retirement (10yr)</p>
                <p className="text-sm font-bold font-display text-success">
                  {formatCurrency(retirementProjections.reduce((s, p) => s + p.milestones.year10, 0), false)}
                </p>
              </div>
            )}
            <p className="text-[9px] text-muted-foreground">Projections assume consistent contributions and APY. Actual growth will vary with market conditions.</p>
          </div>
        </div>
      )}

      <PremiumGate isPremium={isPremium || isDemo} message="Unlock unlimited account tracking with Premium">
        <div className="card-forged p-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Detailed Account Management</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {allAssets.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 bg-muted/30 border border-border" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-3">
                  <Building2 size={16} className="text-muted-foreground" />
                  <div>
                    <p className="text-xs font-semibold">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.type} {(a as any).isLive ? '· Live' : ''} {a.notes ? `· ${a.notes}` : ''}</p>
                  </div>
                </div>
                <span className="text-sm font-bold font-display text-success">{formatCurrency(Number(a.value), false)}</span>
              </div>
            ))}
          </div>
        </div>
      </PremiumGate>

      {showAssetForm && (
        <FormModal
          title={editAssetId ? 'Edit Asset' : 'Add Manual Asset'}
          fields={[
            { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g., Vehicle', required: true },
            { key: 'type', label: 'Type', type: 'select', options: ASSET_TYPES.map(t => ({ value: t, label: t })) },
            { key: 'value', label: 'Current Value', type: 'number', placeholder: '0.00', step: '0.01', required: true },
            { key: 'notes', label: 'Notes (optional)', type: 'text', placeholder: 'Any details...' },
          ]}
          values={assetForm}
          onChange={(k, v) => setAssetForm(prev => ({ ...prev, [k]: v }))}
          onSave={saveAsset}
          onClose={() => setShowAssetForm(false)}
          saving={addAsset.isPending || updateAsset.isPending}
          saveLabel={editAssetId ? 'Update Asset' : 'Add Asset'}
        />
      )}

      {showLiabilityForm && (
        <FormModal
          title={editLiabilityId ? 'Edit Liability' : 'Add Manual Liability'}
          fields={[
            { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g., Personal Loan', required: true },
            { key: 'type', label: 'Type', type: 'select', options: LIABILITY_TYPES.map(t => ({ value: t, label: t })) },
            { key: 'balance', label: 'Current Balance', type: 'number', placeholder: '0.00', step: '0.01', required: true },
            { key: 'apr', label: 'APR % (optional)', type: 'number', placeholder: '22.99', step: '0.01' },
            { key: 'notes', label: 'Notes (optional)', type: 'text', placeholder: 'Any details...' },
          ]}
          values={liabilityForm}
          onChange={(k, v) => setLiabilityForm(prev => ({ ...prev, [k]: v }))}
          onSave={saveLiability}
          onClose={() => setShowLiabilityForm(false)}
          saving={addLiability.isPending || updateLiability.isPending}
          saveLabel={editLiabilityId ? 'Update Liability' : 'Add Liability'}
        />
      )}
    </div>
  );
}
