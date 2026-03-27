import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useAccounts } from '@/hooks/useSupabaseData';
import { useSubscription } from '@/hooks/useSubscription';
import { Link } from 'react-router-dom';
import { Settings as SettingsIcon, Crown, Save, CheckCircle, AlertCircle } from 'lucide-react';
import { getDayName } from '@/lib/scheduling';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export default function SettingsPage() {
  const { user, isDemo } = useAuth();
  const { data: profile, loading, update } = useProfile();
  const { data: accounts } = useAccounts();
  const { subscription, isPremium, hasStripeCustomer, isLoading: subLoading } = useSubscription();
  const [portalLoading, setPortalLoading] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [weeklyGrossIncome, setWeeklyGrossIncome] = useState('1875');
  const [startDay, setStartDay] = useState('1');
  const [showCents, setShowCents] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [taxRate, setTaxRate] = useState('22');
  const [cashFloor, setCashFloor] = useState('1000');
  const [paycheckFrequency, setPaycheckFrequency] = useState('weekly');
  const [paycheckDay, setPaycheckDay] = useState('5');
  const [paycheckStartDate, setPaycheckStartDate] = useState('');
  const [defaultDepositAccount, setDefaultDepositAccount] = useState('');
  const [autoGenerateRecurring, setAutoGenerateRecurring] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName((profile as any).display_name || '');
      setCurrency((profile as any).currency || 'USD');
      setWeeklyGrossIncome(String((profile as any).weekly_gross_income || 1875));
      setStartDay(String((profile as any).budget_start_day || 1));
      setShowCents((profile as any).show_cents ?? true);
      setCompactMode((profile as any).compact_mode ?? false);
      setTaxRate(String((profile as any).tax_rate || 22));
      setCashFloor(String((profile as any).cash_floor || 1000));
      setPaycheckFrequency((profile as any).paycheck_frequency || 'weekly');
      setPaycheckDay(String((profile as any).paycheck_day ?? 5));
      setPaycheckStartDate((profile as any).paycheck_start_date || '');
      setDefaultDepositAccount((profile as any).default_deposit_account || '');
      setAutoGenerateRecurring((profile as any).auto_generate_recurring ?? true);
      setDirty(false);
    }
  }, [profile]);

  const markDirty = () => setDirty(true);

  // FIX #10: Save ALL profile fields including derived fields so they propagate everywhere
  const handleSave = () => {
    const wgi = parseFloat(weeklyGrossIncome) || 1875;
    const tr = parseFloat(taxRate) || 22;
    const cf = parseFloat(cashFloor) || 1000;
    const pd = parseInt(paycheckDay);

    update.mutate({
      display_name: displayName,
      currency,
      weekly_gross_income: wgi,
      // FIX #11: Correctly compute gross_income based on frequency
      gross_income: paycheckFrequency === 'weekly' ? wgi * 52 / 12
        : paycheckFrequency === 'biweekly' ? wgi * 2 * 26 / 12
        : wgi * 52 / 12, // for monthly, weeklyGross * 52/12
      // FIX #12: Correctly compute monthly_income_default (net)
      monthly_income_default: (paycheckFrequency === 'weekly' ? wgi * 52 / 12
        : paycheckFrequency === 'biweekly' ? wgi * 2 * 26 / 12
        : wgi * 52 / 12) * (1 - tr / 100),
      budget_start_day: parseInt(startDay) || 1,
      show_cents: showCents,
      compact_mode: compactMode,
      tax_rate: tr,
      cash_floor: cf,
      paycheck_frequency: paycheckFrequency,
      paycheck_day: pd,
      paycheck_start_date: paycheckStartDate || null,
      default_deposit_account: defaultDepositAccount || null,
      auto_generate_recurring: autoGenerateRecurring,
    } as any);
    setDirty(false);
  };

  const depositAccounts = accounts.filter((a: any) => ['checking', 'savings', 'high_yield_savings', 'business_checking'].includes(a.account_type) && a.active);

  const handleManageSubscription = async () => {
    if (!hasStripeCustomer) return;
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-link');
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      console.error('Portal error:', err);
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SettingsIcon size={18} className="text-primary" />
          <h1 className="font-display font-bold text-xl tracking-tight">Settings</h1>
        </div>
        {dirty && !isDemo && (
          <button onClick={handleSave} disabled={update.isPending} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press disabled:opacity-50" style={{ borderRadius: 'var(--radius)' }}>
            <Save size={12} /> {update.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      {isDemo && (
        <div className="card-forged p-4 border-primary/30">
          <p className="text-xs text-primary font-medium">Demo Mode</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Settings won't persist. Sign up to save your preferences.</p>
        </div>
      )}

      {/* Profile */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Profile</h2>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase">Email</label>
          <p className="text-sm mt-0.5">{isDemo ? 'demo@treforged.com' : user?.email || '—'}</p>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase">Display Name</label>
          <input value={displayName} onChange={e => { setDisplayName(e.target.value); markDirty(); }}
            className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" style={{ borderRadius: 'var(--radius)' }} placeholder="Your name" />
        </div>
      </div>

      {/* Income & Paycheck */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Income & Paycheck</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Weekly Gross Income</label>
            <input type="number" value={weeklyGrossIncome} onChange={e => { setWeeklyGrossIncome(e.target.value); markDirty(); }}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Tax Rate %</label>
            <input type="number" value={taxRate} onChange={e => { setTaxRate(e.target.value); markDirty(); }}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Pay Frequency</label>
            <select value={paycheckFrequency} onChange={e => { setPaycheckFrequency(e.target.value); markDirty(); }}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">{paycheckFrequency === 'monthly' ? 'Pay Day of Month' : `Paycheck Day (${getDayName(parseInt(paycheckDay) || 5)})`}</label>
            {paycheckFrequency === 'monthly' ? (
              <input type="number" min={1} max={31} value={paycheckDay} onChange={e => { setPaycheckDay(e.target.value); markDirty(); }}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
            ) : (
              <select value={paycheckDay} onChange={e => { setPaycheckDay(e.target.value); markDirty(); }}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
                {[0,1,2,3,4,5,6].map(d => <option key={d} value={d}>{getDayName(d)}</option>)}
              </select>
            )}
          </div>
          {paycheckFrequency === 'biweekly' && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Pay Cycle Anchor Date</label>
              <p className="text-[9px] text-muted-foreground mt-0.5 mb-1">Any past paycheck date — used to determine which biweekly Fridays are pay days.</p>
              <input type="date" value={paycheckStartDate} onChange={e => { setPaycheckStartDate(e.target.value); markDirty(); }}
                className="w-full bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
            </div>
          )}
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase">Default Deposit Account</label>
          <select value={defaultDepositAccount} onChange={e => { setDefaultDepositAccount(e.target.value); markDirty(); }}
            className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
            <option value="">Auto-detect (first checking)</option>
            {depositAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {/* Display Preferences */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Display</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Currency</label>
            <select value={currency} onChange={e => { setCurrency(e.target.value); markDirty(); }}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Budget Start Day</label>
            <input type="number" min={1} max={28} value={startDay} onChange={e => { setStartDay(e.target.value); markDirty(); }}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs">Show cents</span>
          <button onClick={() => { setShowCents(!showCents); markDirty(); }} className={`w-8 h-4 rounded-full transition-colors ${showCents ? 'bg-primary' : 'bg-secondary'} relative`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform ${showCents ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs">Auto-generate recurring entries</span>
          <button onClick={() => { setAutoGenerateRecurring(!autoGenerateRecurring); markDirty(); }} className={`w-8 h-4 rounded-full transition-colors ${autoGenerateRecurring ? 'bg-primary' : 'bg-secondary'} relative`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform ${autoGenerateRecurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Financial Defaults */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Cash Management</h2>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase">Minimum Cash Floor / Reserve</label>
          <input type="number" value={cashFloor} onChange={e => { setCashFloor(e.target.value); markDirty(); }} className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          <p className="text-[10px] text-muted-foreground mt-1">Cash-protected mode: extra card payments only when cash stays above this floor</p>
        </div>
      </div>

      {/* Subscription Status */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Subscription</h2>
        {subLoading ? (
          <p className="text-xs text-muted-foreground">Loading subscription info...</p>
        ) : isPremium ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle size={14} className="text-primary" />
              <span className="text-sm font-semibold text-primary">Premium Active</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Status</span>
                <p className="font-medium capitalize">{subscription?.subscription_status || '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Renews</span>
                <p className="font-medium">
                  {subscription?.current_period_end
                    ? format(new Date(subscription.current_period_end), 'MMM d, yyyy')
                    : '—'}
                </p>
              </div>
            </div>
            {hasStripeCustomer && (
              <button onClick={handleManageSubscription} disabled={portalLoading}
                className="flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium btn-press disabled:opacity-50" style={{ borderRadius: 'var(--radius)' }}>
                <Crown size={12} /> {portalLoading ? 'Loading...' : 'Manage Subscription'}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-muted-foreground" />
              <span className="text-sm font-medium">Free Plan</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Upgrade to Premium for advanced features, unlimited history, and priority support.</p>
            <Link to="/premium" className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
              <Crown size={12} /> Upgrade to Premium
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
