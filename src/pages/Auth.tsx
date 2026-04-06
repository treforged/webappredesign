import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Signed in successfully');
        // AuthProvider will handle navigation
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { 
            emailRedirectTo: `${window.location.origin}/auth`
          },
        });
        if (error) throw error;
        toast.success('Account created! Check your email to confirm.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Link
            to="/"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
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
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold btn-press disabled:opacity-50" style={{ borderRadius: 'var(--radius)' }}>
            {loading ? 'Processing…' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
          <div className="pt-1">
            <button type="button" onClick={() => setIsLogin(!isLogin)}
              className="w-full py-2 text-xs font-semibold border border-primary/40 text-primary hover:bg-primary/10 transition-colors btn-press" style={{ borderRadius: 'var(--radius)' }}>
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
