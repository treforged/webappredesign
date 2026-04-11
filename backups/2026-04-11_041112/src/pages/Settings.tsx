import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useAccounts } from '@/hooks/useSupabaseData';
import { useSubscription } from '@/hooks/useSubscription';
import { Link } from 'react-router-dom';
import { Settings as SettingsIcon, Crown, Save, CheckCircle, AlertCircle, Lock, Mail } from 'lucide-react';
import { getDayName } from '@/lib/scheduling';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { emailChangeSchema, passwordChangeSchema } from '@/lib/schemas';

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

  // Account security state
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

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

  const handleEmailChange = async () => {
    const result = emailChangeSchema.safeParse({ newEmail });
    if (!result.success) {
      toast.error(result.error.issues[0].message);
      return;
    }
    if (result.data.newEmail === user?.email) {
      toast.error('New email must be different from your current email');
      return;
    }
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      setEmailSent(true);
      setNewEmail('');
      toast.success('Verification sent — check your new email inbox to confirm the change');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update email');
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    const result = passwordChangeSchema.safeParse({ currentPassword, newPassword, confirmNewPassword });
    if (!result.success) {
      toast.error(result.error.issues[0].message);
      return;
    }
    setPasswordLoading(true);
    try {
      // Verify current password by re-authenticating
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '',
        password: currentPassword,
      });
      if (authError) throw new Error('Current password is incorrect');
      // Update to new password
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      toast.success('Password updated successfully');
      setTimeout(() => setPasswordSuccess(false), 4000);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!hasStripeCustomer) return;
    setPortalLoading(true);
    try {
      const { data, error } = await tracedInvoke<{ url: string }>(supabase, 'create-portal-session', {
        body: { return_url: window.location.origin },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error('Billing portal URL was not returned');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to open billing portal');
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

      {/* Account Security — hidden in demo */}
      {!isDemo && (
        <div className="card-forged p-5 space-y-5">
          <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Account Security</h2>

          {/* Change Email */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Mail size={13} className="text-muted-foreground" />
              <span className="text-xs font-medium">Change Email</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Current: <span className="text-foreground">{user?.email}</span>
            </p>
            {emailSent ? (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle size={13} />
                Verification sent to your new email. Click the link to confirm the change.
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="New email address"
                  className="flex-1 bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <button
                  onClick={handleEmailChange}
                  disabled={emailLoading || !newEmail.trim()}
                  className="px-3 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {emailLoading ? 'Sending…' : 'Send Verification'}
                </button>
              </div>
            )}
            {emailSent && (
              <button onClick={() => setEmailSent(false)} className="text-[10px] text-muted-foreground hover:text-foreground underline">
                Send again
              </button>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Change Password */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Lock size={13} className="text-muted-foreground" />
              <span className="text-xs font-medium">Change Password</span>
            </div>
            {passwordSuccess ? (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle size={13} />
                Password updated successfully.
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="New password (min 6 characters)"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className={`w-full bg-secondary border px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                    confirmNewPassword && confirmNewPassword !== newPassword
                      ? 'border-destructive focus:ring-destructive'
                      : 'border-border'
                  }`}
                  style={{ borderRadius: 'var(--radius)' }}
                />
                {confirmNewPassword && confirmNewPassword !== newPassword && (
                  <p className="text-[10px] text-destructive">Passwords do not match</p>
                )}
                <button
                  onClick={handlePasswordChange}
                  disabled={passwordLoading || !currentPassword || !newPassword || newPassword !== confirmNewPassword}
                  className="w-full py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {passwordLoading ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
            <label className="text-[10px] text-muted-foreground uppercase">{paycheckFrequency === 'monthly' ? 'Pay Day of Month' : `Paycheck Day (${getDayName(paycheckDay !== '' ? parseInt(paycheckDay) : 5)})`}</label>
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
          <input type="number" value={cashFloor} onChange={e => { setCashFloor(e.target.value); markDirty(); }} onBlur={() => { if (dirty) handleSave(); }} className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          <p className="text-[10px] text-muted-foreground mt-1">Cash-protected mode: extra card payments only when cash stays above this floor</p>
        </div>
      </div>

      {/* Subscription Status — hidden in demo mode */}
      {!isDemo && (
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
      )}
    </div>
  );
}
