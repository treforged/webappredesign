import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useAccounts } from '@/hooks/useSupabaseData';
import { useSubscription } from '@/hooks/useSubscription';
import { Link } from 'react-router-dom';
import { Settings as SettingsIcon, Crown, Save, CheckCircle, AlertCircle, Lock, Mail, CreditCard, X, Loader2, Trash2, MessageCircle, Shield, SendHorizonal } from 'lucide-react';
import { LinkedAccounts } from '@/components/settings/LinkedAccounts';
import { TwoFactorAuth } from '@/components/settings/TwoFactorAuth';
import { getDayName } from '@/lib/scheduling';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { emailChangeSchema, passwordChangeSchema } from '@/lib/schemas';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '');

// ── Embedded payment method update form ───────────────────────────────────────
function PaymentUpdateForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    try {
      // Confirm the SetupIntent — 'if_required' avoids redirect for card payments
      const { setupIntent, error } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      });
      if (error) throw new Error(error.message);
      if (!setupIntent?.payment_method) throw new Error('No payment method returned');

      const pmId = typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method.id;

      // Tell the backend to set this PM as the subscription's default
      const { error: fnErr } = await tracedInvoke(supabase, 'update-payment-method', {
        body: { payment_method_id: pmId },
      });
      if (fnErr) throw fnErr;

      toast.success('Payment method updated');
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update payment method');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!stripe || loading}
          className="flex-1 py-2 text-xs font-medium bg-primary text-primary-foreground btn-press disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
          {loading ? 'Saving…' : 'Save card'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-3 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 transition-colors btn-press disabled:opacity-50"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const { user, isDemo } = useAuth();
  const { data: profile, loading, update } = useProfile();
  const { data: accounts } = useAccounts();
  const { subscription, isPremium, hasStripeCustomer, isLoading: subLoading, refetch: refetchSub } = useSubscription();
  const [cancelLoading, setCancelLoading] = useState(false);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Delete account state — steps: 'hidden' | 'confirm' | 'email-sent' | 'deleting'
  const [deleteStep, setDeleteStep] = useState<'hidden' | 'confirm' | 'email-sent' | 'deleting'>('hidden');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteOtp, setDeleteOtp] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

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

  const handleSendDeleteConfirmation = async () => {
    setDeleteLoading(true);
    try {
      const { error } = await supabase.auth.reauthenticate();
      if (error) throw error;
      setDeleteStep('email-sent');
      toast.success('Confirmation code sent — check your email inbox');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send confirmation email');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE' || deleteOtp.length < 6 || deleteOtp.length > 8) return;
    setDeleteLoading(true);
    try {
      // Verify the reauthentication OTP before deletion
      const { error: otpErr } = await supabase.auth.verifyOtp({
        email: user?.email ?? '',
        token: deleteOtp.trim(),
        type: 'reauthentication' as any,
      });
      if (otpErr) throw new Error('Invalid confirmation code — check your email and try again');

      const { error } = await tracedInvoke(supabase, 'delete-account', {});
      if (error) throw error;
      toast.success('Account permanently deleted. Goodbye.');
      await supabase.auth.signOut();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleteLoading(false);
    }
  };

  const resetDeleteFlow = () => {
    setDeleteStep('hidden');
    setDeleteConfirmText('');
    setDeleteOtp('');
  };

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

  const handleCancelOrResume = async (action: 'cancel' | 'resume') => {
    setCancelLoading(true);
    setConfirmCancel(false);
    try {
      const { error } = await tracedInvoke(supabase, 'manage-subscription', { body: { action } });
      if (error) throw error;
      await refetchSub();
      toast.success(action === 'cancel' ? 'Subscription will cancel at period end' : 'Subscription resumed');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update subscription');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleShowPaymentUpdate = useCallback(async () => {
    setSetupLoading(true);
    try {
      const { data, error } = await tracedInvoke<{ client_secret: string }>(supabase, 'create-setup-intent', {});
      if (error) throw error;
      if (data?.client_secret) {
        setSetupClientSecret(data.client_secret);
      } else {
        toast.error('Failed to initialize payment form');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to open payment update');
    } finally {
      setSetupLoading(false);
    }
  }, []);

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
        <div id="security" className="card-forged p-5 space-y-5">
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

          {/* Linked Accounts */}
          <LinkedAccounts />

          <div className="border-t border-border" />

          {/* Two-Factor Auth */}
          <TwoFactorAuth />

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

      {/* Support */}
      {!isDemo && (
        <div className="card-forged p-5 space-y-3">
          <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Support</h2>
          {isPremium ? (
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MessageCircle size={13} className="text-primary" />
                  <span className="text-xs font-medium">Priority Support</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium" style={{ borderRadius: 'var(--radius)' }}>Premium</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Your message goes to the front of the queue. Email us with your account issue and we'll respond within 24 hours.
                </p>
              </div>
              <a
                href="mailto:contact@treforged.com?subject=Premium%20Support%20Request"
                className="shrink-0 flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <Mail size={12} /> Email Support
              </a>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MessageCircle size={13} className="text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Priority Support</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Premium subscribers get front-of-queue email support with a 24-hour response guarantee.
                </p>
              </div>
              <Link
                to="/premium"
                className="shrink-0 flex items-center gap-1.5 bg-secondary border border-primary/30 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/10 transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <Crown size={12} /> Upgrade
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Danger Zone — hidden in demo mode */}
      {!isDemo && (
        <div className="card-forged p-5 space-y-4 border border-destructive/20">
          <h2 className="text-[11px] font-medium text-destructive uppercase tracking-wider">Danger Zone</h2>

          {deleteStep === 'hidden' && (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium">Delete Account</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Permanently deletes your account and all data. Active subscriptions are cancelled immediately. Billing records are retained per IRS requirements.
                </p>
              </div>
              <button
                onClick={() => setDeleteStep('confirm')}
                className="shrink-0 flex items-center gap-1.5 bg-secondary border border-destructive/30 text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/10 transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <Trash2 size={12} />
                Delete account
              </button>
            </div>
          )}

          {deleteStep === 'confirm' && (
            <div className="space-y-3">
              {/* Irreversible warning */}
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>
                  This is <strong>permanent and irreversible</strong>. All your budgets, accounts, transactions, and goals will be deleted.
                </span>
              </div>

              {/* Subscription cancellation notice */}
              {isPremium && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-600" style={{ borderRadius: 'var(--radius)' }}>
                  <Crown size={13} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>
                    Your <strong>Premium subscription will be cancelled immediately</strong> with no refund. You will lose access to all premium features upon deletion.
                  </span>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                Type <strong className="text-foreground">DELETE</strong> to confirm, then we'll send a verification code to your email:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-secondary border border-destructive/30 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
                style={{ borderRadius: 'var(--radius)' }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSendDeleteConfirmation}
                  disabled={deleteConfirmText !== 'DELETE' || deleteLoading}
                  className="flex items-center gap-1.5 bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium btn-press disabled:opacity-50"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {deleteLoading ? <Loader2 size={12} className="animate-spin" /> : <SendHorizonal size={12} />}
                  {deleteLoading ? 'Sending…' : 'Send confirmation email'}
                </button>
                <button
                  onClick={resetDeleteFlow}
                  disabled={deleteLoading}
                  className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors btn-press disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {deleteStep === 'email-sent' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 bg-primary/10 border border-primary/20 px-3 py-2.5 text-xs text-primary" style={{ borderRadius: 'var(--radius)' }}>
                <Mail size={13} className="mt-0.5 shrink-0" />
                <span>
                  A 6-digit confirmation code was sent to <strong>{user?.email}</strong>. Enter it below to permanently delete your account.
                </span>
              </div>

              {isPremium && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-600" style={{ borderRadius: 'var(--radius)' }}>
                  <Crown size={13} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>Your Premium subscription will be <strong>cancelled immediately</strong> with no refund.</span>
                </div>
              )}

              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={deleteOtp}
                onChange={e => setDeleteOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="Code from your email"
                className="w-full bg-secondary border border-destructive/30 px-3 py-2 text-xs text-foreground text-center tracking-widest focus:outline-none focus:ring-1 focus:ring-destructive"
                style={{ borderRadius: 'var(--radius)' }}
                autoFocus
              />

              <div className="flex gap-2">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteOtp.length < 6 || deleteLoading || deleteOtp.length > 8}
                  className="flex items-center gap-1.5 bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium btn-press disabled:opacity-50"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {deleteLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {deleteLoading ? 'Deleting…' : 'Permanently delete my account'}
                </button>
                <button
                  onClick={resetDeleteFlow}
                  disabled={deleteLoading}
                  className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors btn-press disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              <button
                onClick={handleSendDeleteConfirmation}
                disabled={deleteLoading}
                className="text-[10px] text-muted-foreground hover:text-foreground underline"
              >
                Resend code
              </button>
            </div>
          )}
        </div>
      )}

      {/* Subscription Management — hidden in demo mode */}
      {!isDemo && (
        <div className="card-forged p-5 space-y-4">
          <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Subscription</h2>

          {subLoading ? (
            <p className="text-xs text-muted-foreground">Loading subscription info…</p>
          ) : isPremium ? (
            <div className="space-y-4">
              {/* Status row */}
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-primary" />
                <span className="text-sm font-semibold text-primary">Premium Active</span>
              </div>

              {/* Plan details */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="font-medium capitalize">{subscription?.subscription_status || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {subscription?.cancel_at_period_end ? 'Cancels on' : 'Renews'}
                  </span>
                  <p className="font-medium">
                    {subscription?.current_period_end
                      ? format(new Date(subscription.current_period_end), 'MMM d, yyyy')
                      : '—'}
                  </p>
                </div>
              </div>

              {/* Pending cancellation warning */}
              {subscription?.cancel_at_period_end && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Your subscription will cancel on{' '}
                    <strong>
                      {subscription.current_period_end
                        ? format(new Date(subscription.current_period_end), 'MMM d, yyyy')
                        : 'period end'}
                    </strong>
                    . You'll keep access until then.
                  </span>
                </div>
              )}

              {/* Actions — only shown when payment update is not open */}
              {!setupClientSecret && hasStripeCustomer && (
                <div className="flex flex-wrap gap-2">
                  {/* Update payment method */}
                  <button
                    onClick={handleShowPaymentUpdate}
                    disabled={setupLoading}
                    className="flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {setupLoading ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                    Update payment method
                  </button>

                  {/* Cancel / Resume */}
                  {subscription?.cancel_at_period_end ? (
                    <button
                      onClick={() => handleCancelOrResume('resume')}
                      disabled={cancelLoading}
                      className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press disabled:opacity-50"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {cancelLoading ? <Loader2 size={12} className="animate-spin" /> : <Crown size={12} />}
                      Keep subscription
                    </button>
                  ) : (
                    <>
                      {confirmCancel ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Cancel at period end?</span>
                          <button
                            onClick={() => handleCancelOrResume('cancel')}
                            disabled={cancelLoading}
                            className="px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground btn-press disabled:opacity-50"
                            style={{ borderRadius: 'var(--radius)' }}
                          >
                            {cancelLoading ? <Loader2 size={12} className="animate-spin" /> : 'Yes, cancel'}
                          </button>
                          <button
                            onClick={() => setConfirmCancel(false)}
                            className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmCancel(true)}
                          className="flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-destructive/40 hover:text-destructive transition-colors btn-press"
                          style={{ borderRadius: 'var(--radius)' }}
                        >
                          Cancel subscription
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Embedded payment method update (Stripe Elements) */}
              {setupClientSecret && (
                <div className="border border-border rounded-lg overflow-hidden p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Update payment method</span>
                    <button onClick={() => setSetupClientSecret(null)} className="text-muted-foreground hover:text-foreground">
                      <X size={14} />
                    </button>
                  </div>
                  <Elements
                    stripe={stripePromise}
                    options={{ clientSecret: setupClientSecret, appearance: { theme: 'night', variables: { fontSizeBase: '13px' } } }}
                  >
                    <PaymentUpdateForm
                      onSuccess={() => { setSetupClientSecret(null); refetchSub(); }}
                      onCancel={() => setSetupClientSecret(null)}
                    />
                  </Elements>
                </div>
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
