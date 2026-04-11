import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { loginSchema, signUpSchema } from '@/lib/schemas';

type Mode = 'login' | 'signup' | 'reset';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Honour ?reset=true from security notification emails
  useEffect(() => {
    if (searchParams.get('reset') === 'true') {
      setMode('reset');
    }
  }, [searchParams]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setResetSent(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
        toast.success('Signed in successfully');
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Back to home
          </Link>
        </div>

        <div className="text-center mb-8">
          <h1 className="font-display font-bold text-xl tracking-tight text-gold">TRE FORGED</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === 'login' && 'Welcome back. Sign in to continue.'}
            {mode === 'signup' && 'Create your account to get started.'}
            {mode === 'reset' && 'Enter your email to receive a reset link.'}
          </p>
        </div>

        {/* Reset sent confirmation */}
        {mode === 'reset' && resetSent ? (
          <div className="card-forged p-6 space-y-4 text-center">
            <p className="text-sm font-semibold text-foreground">Check your inbox</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              We sent a password reset link to <span className="text-foreground font-medium">{email}</span>.
              The link expires in 1 hour.
            </p>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full py-2 text-xs font-semibold border border-border text-muted-foreground hover:text-foreground transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Back to Sign In
            </button>
          </div>
        ) : (
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
                  className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                  className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                  className={`w-full mt-1 bg-secondary border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
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
              className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold btn-press disabled:opacity-50"
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
                  className="w-full py-2 text-xs font-semibold border border-primary/40 text-primary hover:bg-primary/10 transition-colors btn-press"
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
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to Sign In
              </button>
            )}
          </form>
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
