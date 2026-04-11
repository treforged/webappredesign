import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { loginSchema, signUpSchema } from '@/lib/schemas';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLogin) {
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
      if (isLogin) {
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
            {isLogin ? 'Welcome back. Sign in to continue.' : 'Create your account to get started.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card-forged p-6 space-y-4">
          {!isLogin && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required={!isLogin}
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

          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Password</label>
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

          {!isLogin && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required={!isLogin}
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
            disabled={loading || (!isLogin && !!confirmPassword && confirmPassword !== password)}
            className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold btn-press disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {loading ? 'Processing…' : isLogin ? 'Sign In' : 'Create Account'}
          </button>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => switchMode(!isLogin)}
              className="w-full py-2 text-xs font-semibold border border-primary/40 text-primary hover:bg-primary/10 transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
            </button>
          </div>
        </form>

        <p className="text-[10px] text-muted-foreground text-center mt-4">
          <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          {' · '}
          <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
}
