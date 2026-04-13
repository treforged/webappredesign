import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield, ShieldCheck, ShieldOff, QrCode, Loader2, X, CheckCircle, Trash2, Mail } from 'lucide-react';

type MfaFactor = {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: 'verified' | 'unverified';
  phone?: string;
  email?: string;
};

type EnrollView = 'none' | 'totp-qr' | 'totp-verify' | 'email-verify';

export function TwoFactorAuth() {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<EnrollView>('none');
  const [actionLoading, setActionLoading] = useState(false);

  // TOTP state
  const [totpQr, setTotpQr] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [totpFactorId, setTotpFactorId] = useState('');
  const [totpCode, setTotpCode] = useState('');

  // Email MFA state
  const [emailFactorId, setEmailFactorId] = useState('');
  const [emailMfaCode, setEmailMfaCode] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState('');

  const loadFactors = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error && data) {
      const raw = data as any;
      const all = [
        ...(data.totp ?? []),
        ...(data.phone ?? []),
        ...((raw.email as MfaFactor[] | undefined) ?? []),
      ] as MfaFactor[];
      setFactors(all);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadFactors(); }, [loadFactors]);

  // ── TOTP enrollment ────────────────────────────────────────────────────────
  const startTotpEnroll = async () => {
    setActionLoading(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Authenticator App',
    });
    if (error || !data) {
      toast.error(error?.message ?? 'Failed to start enrollment');
    } else {
      setTotpQr(data.totp.qr_code);
      setTotpSecret(data.totp.secret);
      setTotpFactorId(data.id);
      setView('totp-qr');
    }
    setActionLoading(false);
  };

  const verifyTotp = async () => {
    if (totpCode.length !== 6) { toast.error('Enter the 6-digit code from your authenticator'); return; }
    setActionLoading(true);
    const { data: challenge, error: ce } = await supabase.auth.mfa.challenge({ factorId: totpFactorId });
    if (ce || !challenge) { toast.error(ce?.message ?? 'Challenge failed'); setActionLoading(false); return; }
    const { error: ve } = await supabase.auth.mfa.verify({ factorId: totpFactorId, challengeId: challenge.id, code: totpCode });
    if (ve) {
      toast.error(ve.message);
    } else {
      toast.success('Authenticator app enabled');
      setView('none');
      setTotpCode('');
      await loadFactors();
    }
    setActionLoading(false);
  };

  // ── Email MFA enrollment ───────────────────────────────────────────────────
  const startEmailEnroll = async () => {
    setActionLoading(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'email' } as any);
    if (error || !data) {
      toast.error(error?.message ?? 'Failed to enroll email MFA');
    } else {
      setEmailFactorId(data.id);
      const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId: data.id });
      if (ce || !ch) { toast.error('Failed to send email code'); setActionLoading(false); return; }
      setEmailChallengeId(ch.id);
      setView('email-verify');
      toast.success('Verification code sent to your email');
    }
    setActionLoading(false);
  };

  const verifyEmailMfa = async () => {
    if (!emailMfaCode.trim()) { toast.error('Enter the verification code'); return; }
    setActionLoading(true);
    const { error } = await supabase.auth.mfa.verify({ factorId: emailFactorId, challengeId: emailChallengeId, code: emailMfaCode.trim() });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Email two-factor enabled');
      setView('none');
      setEmailMfaCode('');
      await loadFactors();
    }
    setActionLoading(false);
  };

  // ── Unenroll ───────────────────────────────────────────────────────────────
  const handleUnenroll = async (factorId: string, label: string) => {
    setActionLoading(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${label} removed`);
      await loadFactors();
    }
    setActionLoading(false);
  };

  const cancelEnroll = () => {
    if (totpFactorId && view.startsWith('totp')) {
      supabase.auth.mfa.unenroll({ factorId: totpFactorId }).then(() => {});
      setTotpFactorId('');
    }
    setView('none');
    setTotpCode('');
    setEmailMfaCode('');
  };

  const verifiedFactors = factors.filter(f => f.status === 'verified');

  const FACTOR_LABELS: Record<string, string> = {
    totp: 'Authenticator App',
    phone: 'SMS',
    email: 'Email',
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {verifiedFactors.length > 0
          ? <ShieldCheck size={13} className="text-primary" />
          : <Shield size={13} className="text-muted-foreground" />
        }
        <span className="text-xs font-medium">Two-Factor Authentication</span>
        {verifiedFactors.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium" style={{ borderRadius: 'var(--radius)' }}>
            ON
          </span>
        )}
      </div>

      {verifiedFactors.length === 0 && view === 'none' && (
        <p className="text-[10px] text-muted-foreground">
          Add a second factor to protect your account. Works with Microsoft Authenticator, Google Authenticator, Apple Passwords, Bitwarden, Authy, and any TOTP app.
        </p>
      )}

      {/* Active factors */}
      {factors.length > 0 && (
        <div className="space-y-1.5">
          {factors.map(f => (
            <div key={f.id} className="flex items-center justify-between bg-secondary/40 border border-border px-3 py-2" style={{ borderRadius: 'var(--radius)' }}>
              <div className="flex items-center gap-2">
                {f.status === 'verified'
                  ? <CheckCircle size={11} className="text-primary" />
                  : <ShieldOff size={11} className="text-muted-foreground" />}
                <span className="text-xs">{f.friendly_name || FACTOR_LABELS[f.factor_type] || f.factor_type}</span>
                {f.status === 'unverified' && <span className="text-[9px] text-muted-foreground">(unverified)</span>}
                {f.phone && <span className="text-[10px] text-muted-foreground">{f.phone}</span>}
              </div>
              <button
                onClick={() => handleUnenroll(f.id, FACTOR_LABELS[f.factor_type] ?? 'Factor')}
                disabled={actionLoading}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors btn-press disabled:opacity-50"
                title="Remove"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Enrollment views */}
      {view === 'none' && (
        <div className="flex flex-wrap gap-2 pt-1">
          {!factors.some(f => f.factor_type === 'totp') && (
            <button
              onClick={startTotpEnroll}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {actionLoading ? <Loader2 size={10} className="animate-spin" /> : <QrCode size={10} />}
              Add Authenticator App
            </button>
          )}
          {!factors.some(f => f.factor_type === 'email') && (
            <button
              onClick={startEmailEnroll}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {actionLoading ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />}
              Add Email Code
            </button>
          )}
        </div>
      )}

      {/* TOTP: show QR */}
      {view === 'totp-qr' && (
        <div className="space-y-3 border border-border p-4" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Scan with your authenticator app</p>
            <button onClick={cancelEnroll} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
          </div>
          {totpQr && <img src={totpQr} alt="TOTP QR Code" className="w-40 h-40 mx-auto bg-white p-2" style={{ borderRadius: 'var(--radius)' }} />}
          <div className="bg-secondary/60 border border-border px-3 py-2" style={{ borderRadius: 'var(--radius)' }}>
            <p className="text-[9px] text-muted-foreground uppercase mb-0.5">Or enter this key manually</p>
            <p className="text-xs font-mono break-all">{totpSecret}</p>
          </div>
          <button
            onClick={() => setView('totp-verify')}
            className="w-full py-2 text-xs font-medium bg-primary text-primary-foreground btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            I've scanned it → Enter code
          </button>
        </div>
      )}

      {/* TOTP: verify code */}
      {view === 'totp-verify' && (
        <div className="space-y-3 border border-border p-4" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Enter the 6-digit code from your app</p>
            <button onClick={cancelEnroll} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={totpCode}
            onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full bg-secondary border border-border px-3 py-2 text-sm text-foreground text-center tracking-widest focus:outline-none focus:ring-1 focus:ring-ring"
            style={{ borderRadius: 'var(--radius)' }}
          />
          <div className="flex gap-2">
            <button
              onClick={verifyTotp}
              disabled={actionLoading || totpCode.length !== 6}
              className="flex-1 py-2 text-xs font-medium bg-primary text-primary-foreground btn-press disabled:opacity-50 flex items-center justify-center gap-1.5"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : null}
              Confirm & Enable
            </button>
            <button onClick={() => setView('totp-qr')} className="px-3 text-xs text-muted-foreground hover:text-foreground">Back</button>
          </div>
        </div>
      )}

      {/* Email MFA: verify */}
      {view === 'email-verify' && (
        <div className="space-y-3 border border-border p-4" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Enter the code sent to your email</p>
            <button onClick={cancelEnroll} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={emailMfaCode}
            onChange={e => setEmailMfaCode(e.target.value.replace(/\D/g, ''))}
            placeholder="Verification code"
            className="w-full bg-secondary border border-border px-3 py-2 text-sm text-foreground text-center tracking-widest focus:outline-none focus:ring-1 focus:ring-ring"
            style={{ borderRadius: 'var(--radius)' }}
          />
          <button
            onClick={verifyEmailMfa}
            disabled={actionLoading || !emailMfaCode.trim()}
            className="w-full py-2 text-xs font-medium bg-primary text-primary-foreground btn-press disabled:opacity-50 flex items-center justify-center gap-1.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {actionLoading ? <Loader2 size={12} className="animate-spin" /> : null}
            Confirm & Enable
          </button>
        </div>
      )}
    </div>
  );
}
