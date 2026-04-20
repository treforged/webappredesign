import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { loginSchema, signUpSchema } from '@/lib/schemas';
import { Capacitor } from '@capacitor/core';

const PASSKEY_CRED_KEY   = 'forged:signin_passkey';
const PASSKEY_TOKENS_KEY = 'forged:signin_passkey_tokens';

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

type Mode = 'login' | 'signup' | 'reset' | 'set-password' | 'mfa';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [hasSigninPasskey, setHasSigninPasskey] = useState(() => {
    try { return !!(window.PublicKeyCredential && localStorage.getItem(PASSKEY_CRED_KEY)); }
    catch { return false; }
  });

  // MFA challenge state
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactorType, setMfaFactorType] = useState<string>('totp');
  const [totpCountdown, setTotpCountdown] = useState(0);
  const [mfaError, setMfaError] = useState('');

  useEffect(() => {
    // Supabase appends #access_token=...&type=recovery to the redirectTo URL
    // when the user clicks the reset link in their email.
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setMode('set-password');
      // Clean the hash from the URL so a refresh doesn't re-trigger this
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    // ?reset=true from security notification emails → show the request-reset form
    if (searchParams.get('reset') === 'true') {
      setMode('reset');
    }
  }, [searchParams]);

  useEffect(() => {
  let mounted = true;

  // Check if session already exists (OAuth redirect case)
  supabase.auth.getSession().then(({ data }) => {
    if (!mounted) return;
    if (data.session) {
      navigate('/dashboard', { replace: true });
    }
  });

  // Listen for auth changes (Google/Apple login finishing)
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (!mounted) return;

    if (
      session &&
      (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
    ) {
      navigate('/dashboard', { replace: true });
    }
  });

  return () => {
    mounted = false;
    subscription.unsubscribe();
  };
}, [navigate]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setResetSent(false);
  };

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
  setLoading(true);
  try {
    const redirectTo = Capacitor.isNativePlatform()
  ? 'com.treforged.forged://auth-callback'
  : `${window.location.origin}/auth`;

const { error } = await supabase.auth.signInWithOAuth({
  provider,
  options: { redirectTo },
});

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('email already in use')) {
        toast.error('An account already exists with this email. Sign in with your password or reset it using "Forgot password?".');
      } else {
        toast.error(error.message);
      }
    }
  } catch {
    toast.error('OAuth sign-in failed. Please try again.');
  } finally {
    setLoading(false);
  }
};

  const handlePasskeySignIn = async () => {
    setLoading(true);
    try {
      const raw = localStorage.getItem(PASSKEY_CRED_KEY);
      if (!raw) throw new Error('No passkey registered');
      const { credId } = JSON.parse(raw) as { credId: string; email: string };
      const credIdBytes = b64urlToBytes(credId).buffer as ArrayBuffer;

      const challenge = crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer;
      await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: [{ type: 'public-key', id: credIdBytes }],
          userVerification: 'required',
          timeout: 60000,
        },
      });

      const tokensRaw = localStorage.getItem(PASSKEY_TOKENS_KEY);
      if (!tokensRaw) throw new Error('Session tokens missing. Sign in with your password once to re-link your passkey.');
      const { refresh_token } = JSON.parse(tokensRaw) as { access_token: string; refresh_token: string };

      const { data, error } = await supabase.auth.refreshSession({ refresh_token });
      if (error || !data.session) {
        localStorage.removeItem(PASSKEY_TOKENS_KEY);
        throw new Error('Session expired. Sign in with your password once to refresh your passkey.');
      }

      localStorage.setItem(PASSKEY_TOKENS_KEY, JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }));

      toast.success('Signed in with passkey');
      navigate('/dashboard', { replace: true });
      return; // stop here → prevents any further auth/MFA logic
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      const lower = msg.toLowerCase();
      if (!lower.includes('cancel') && !lower.includes('abort') && !lower.includes('not allowed')) {
        toast.error(msg || 'Passkey sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Set new password (came from reset email link) ──────────────────────
    if (mode === 'set-password') {
      if (password.length < 6) {
        toast.error('Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        toast.error('Passwords do not match');
        return;
      }
      setLoading(true);
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success('Password updated. You are now signed in.');
        navigate('/dashboard');
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to update password');
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Request reset email ─────────────────────────────────────────────────
    if (mode === 'reset') {
      if (!email.trim()) {
        toast.error('Enter your email address');
        return;
      }
      setLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        setResetSent(true);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to send reset email');
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Sign in / Sign up ───────────────────────────────────────────────────
    if (mode === 'login') {
      const result = loginSchema.safeParse({ email, password });
      if (!result.success) {
        toast.error(result.error.issues[0].message);
        return;
      }
    } else {
      const result = signUpSchema.safeParse({ displayName, email, password, confirmPassword });
      if (!result.success) {
        toast.error(result.error.issues[0].message);
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;

        // Check if MFA is required before granting access
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
          // User has MFA enrolled — find first verified factor and challenge it
          const { data: factorsData } = await supabase.auth.mfa.listFactors();
          const rawFactors = factorsData as any;
          const allFactors = [
            ...(factorsData?.totp ?? []),
            ...(factorsData?.phone ?? []),
            ...((rawFactors?.email ?? []) as any[]),
          ];
          const factor = allFactors.find(f => f.status === 'verified');
          if (factor) {
            const { data: challenge, error: ce } = await supabase.auth.mfa.challenge({ factorId: factor.id });
            if (ce || !challenge) throw ce ?? new Error('MFA challenge failed');
            setMfaFactorId(factor.id);
            setMfaChallengeId(challenge.id);
            setMfaFactorType(factor.factor_type);
            setMode('mfa');
            setLoading(false);
            return;
          }
        }

        toast.success('Signed in successfully');

        // Keep sign-in passkey tokens fresh after any normal login
        try {
          if (localStorage.getItem(PASSKEY_CRED_KEY)) {
            const { data: sess } = await supabase.auth.getSession();
            if (sess.session) {
              localStorage.setItem(PASSKEY_TOKENS_KEY, JSON.stringify({
                access_token: sess.session.access_token,
                refresh_token: sess.session.refresh_token,
              }));
            }
          }
        } catch { /* non-critical */ }
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { display_name: displayName.trim() },
          },
        });
        if (error) throw error;
        toast.success('Account created! Check your email to confirm.');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  // TOTP countdown — shows seconds remaining in 30s window
  useEffect(() => {
    if (mode !== 'mfa' || mfaFactorType !== 'totp') return;
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setTotpCountdown(30 - (now % 30));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode, mfaFactorType]);

  const handleMfaVerify = useCallback(async () => {
    if (!mfaCode.trim()) { setMfaError('Enter the verification code'); return; }
    setMfaError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode.trim(),
      });
      if (error) throw error;
      toast.success('Signed in successfully');
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setMfaError(msg);
      setMfaCode('');
    } finally {
      setLoading(false);
    }
  }, [mfaCode, mfaFactorId, mfaChallengeId, navigate]);

  // Auto-submit when 6 digits entered for TOTP
  useEffect(() => {
    if (mfaFactorType === 'totp' && mfaCode.length === 6 && !loading) {
      handleMfaVerify();
    }
  }, [mfaCode, mfaFactorType, loading, handleMfaVerify]);

  // ── MFA challenge UI ──────────────────────────────────────────────────────
  if (mode === 'mfa') {
    const FACTOR_HINTS: Record<string, string> = {
      totp: 'Open your authenticator app and enter the 6-digit code. It submits automatically.',
      phone: 'Enter the SMS code sent to your phone.',
      email: 'Enter the code sent to your email.',
    };
    const countdownPct = mfaFactorType === 'totp' ? (totpCountdown / 30) * 100 : 100;
    const isExpiring = mfaFactorType === 'totp' && totpCountdown <= 5;

    return (
      <div
  className="min-h-screen bg-background flex items-center justify-center px-4"
  style={{
    paddingTop: 'calc(env(safe-area-inset-top) + 16px)',
    paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)'
  }}
>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-display font-bold text-xl tracking-tight text-gold">FORGED</h1>
            <p className="text-xs text-muted-foreground mt-1">Two-factor verification required.</p>
          </div>
          <div className="card-forged p-6 space-y-4">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {FACTOR_HINTS[mfaFactorType] ?? 'Enter your verification code.'}
            </p>

            {/* TOTP countdown bar */}
            {mfaFactorType === 'totp' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Code expires in</span>
                  <span className={`text-[10px] font-semibold tabular-nums ${isExpiring ? 'text-destructive' : 'text-foreground'}`}>
                    {totpCountdown}s
                  </span>
                </div>
                <div className="h-1 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${isExpiring ? 'bg-destructive' : 'bg-primary'}`}
                    style={{ width: `${countdownPct}%` }}
                  />
                </div>
              </div>
            )}

            <input
  type="text"
  inputMode="numeric"
  pattern="[0-9]*"
  name="one-time-code"
  autoComplete="one-time-code"
  maxLength={mfaFactorType === 'totp' ? 6 : 8}
  value={mfaCode}
  onChange={e => { setMfaError(''); setMfaCode(e.target.value.replace(/\D/g, '')); }}
  placeholder={mfaFactorType === 'totp' ? '000000' : 'Verification code'}
  autoFocus
              className={`w-full bg-secondary border px-3 py-3 text-lg text-foreground text-center tracking-[0.4em] focus:outline-none focus:ring-1 ${mfaError ? 'border-destructive focus:ring-destructive' : 'border-border focus:ring-ring'}`}
              style={{ borderRadius: 'var(--radius)' }}
            />

            {mfaError && (
              <p className="text-[10px] text-destructive -mt-2">{mfaError}</p>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Verifying…
              </div>
            )}

            {!loading && mfaFactorType !== 'totp' && (
              <button
                onClick={handleMfaVerify}
                disabled={!mfaCode.trim()}
                className="w-full bg-primary text-primary-foreground py-3 text-xs font-semibold btn-press disabled:opacity-50"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Verify
              </button>
            )}

            <button
              type="button"
              onClick={() => { setMode('login'); setMfaCode(''); setMfaError(''); }}
              className="w-full py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Set new password UI (after clicking reset email link) ─────────────────
  if (mode === 'set-password') {
    const mismatch = !!confirmPassword && confirmPassword !== password;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-display font-bold text-xl tracking-tight text-gold">FORGED</h1>
            <p className="text-xs text-muted-foreground mt-1">Choose a new password for your account.</p>
          </div>

          <form onSubmit={handleSubmit} className="card-forged p-6 space-y-4">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                placeholder="At least 6 characters"
                className="w-full mt-1 bg-secondary border border-border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                placeholder="Re-enter your new password"
                className={`w-full mt-1 bg-secondary border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                  mismatch ? 'border-destructive focus:ring-destructive' : 'border-border'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              />
              {mismatch && (
                <p className="text-[10px] text-destructive mt-1">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || mismatch}
              className="w-full bg-primary text-primary-foreground py-3 text-xs font-semibold btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {loading ? 'Updating…' : 'Set New Password'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Reset sent confirmation ───────────────────────────────────────────────
  if (mode === 'reset' && resetSent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-display font-bold text-xl tracking-tight text-gold">FORGED</h1>
          </div>
          <div className="card-forged p-6 space-y-4 text-center">
            <p className="text-base font-semibold text-foreground">Check your inbox</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              We sent a password reset link to{' '}
              <span className="text-foreground font-medium">{email}</span>.
              The link expires in 1 hour.
            </p>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full py-3 text-xs font-semibold border border-border text-muted-foreground hover:text-foreground transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Sign in / Sign up / Request reset ────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Back to home
          </Link>
        </div>

        <div className="text-center mb-8">
          <h1 className="font-display font-bold text-xl tracking-tight text-gold">FORGED</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === 'login' && 'Welcome back. Sign in to continue.'}
            {mode === 'signup' && 'Create your account to get started.'}
            {mode === 'reset' && 'Enter your email to receive a reset link.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card-forged p-6 space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
                placeholder="Your name"
                maxLength={50}
                autoComplete="name"
                className="w-full mt-1 bg-secondary border border-border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </div>
          )}

          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              maxLength={254}
              autoComplete={mode === 'signup' ? 'email' : 'username'}
              className="w-full mt-1 bg-secondary border border-border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-muted-foreground uppercase">Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full mt-1 bg-secondary border border-border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className={`w-full mt-1 bg-secondary border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                  confirmPassword && confirmPassword !== password
                    ? 'border-destructive focus:ring-destructive'
                    : 'border-border'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              />
              {confirmPassword && confirmPassword !== password && (
                <p className="text-[10px] text-destructive mt-1">Passwords do not match</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (mode === 'signup' && !!confirmPassword && confirmPassword !== password)}
            className="w-full bg-primary text-primary-foreground py-3 text-xs font-semibold btn-press disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {loading
              ? 'Processing…'
              : mode === 'login'
              ? 'Sign In'
              : mode === 'signup'
              ? 'Create Account'
              : 'Send Reset Link'}
          </button>

          {mode !== 'reset' && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                className="w-full py-3 text-xs font-semibold border border-primary/40 text-primary hover:bg-primary/10 transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {mode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
              </button>
            </div>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Sign In
            </button>
          )}
        </form>

        {mode === 'login' && hasSigninPasskey && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={handlePasskeySignIn}
              className="w-full flex items-center justify-center gap-2 py-3 text-xs font-semibold border border-primary/40 text-primary hover:bg-primary/10 transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>
              </svg>
              Sign in with passkey
            </button>
            <button
              type="button"
              onClick={() => { localStorage.removeItem(PASSKEY_CRED_KEY); localStorage.removeItem(PASSKEY_TOKENS_KEY); setHasSigninPasskey(false); }}
              className="w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Remove saved passkey
            </button>
          </div>
        )}

        {mode !== 'reset' && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleOAuthSignIn('google')}
              className="w-full flex items-center justify-center gap-2 py-3 text-xs font-semibold border border-border text-foreground hover:bg-secondary/60 transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleOAuthSignIn('apple')}
              className="w-full flex items-center justify-center gap-2 py-3 text-xs font-semibold border border-border text-foreground hover:bg-secondary/60 transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <svg width="14" height="14" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 382.9 40.7 262.6 40.7 242.1c0-131.4 90.7-200.3 179.4-200.3 87 0 142.7 57.6 168.2 57.6 24.4 0 88.1-60.9 172.3-60.9 13.8 0 133.4 1.3 204.3 104.6z"/>
                <path d="M530.4 40.3c-29.6 34.7-76.6 60.4-123.5 56.8-5.8-45.5 16.7-93.8 44.3-124 29.6-32.8 80-60.9 122.5-62.9 4.5 47.4-13.4 94-43.3 130.1z"/>
              </svg>
              Continue with Apple
            </button>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground text-center mt-4">
          <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          {' · '}
          <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
}
