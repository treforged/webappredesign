import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Link2, Unlink, Loader2, CheckCircle } from 'lucide-react';

type UserIdentity = {
  identity_id: string;
  provider: string;
  identity_data?: { email?: string; name?: string };
};

const OAUTH_PROVIDERS = [
  {
    id: 'google' as const,
    label: 'Google',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
  },
  {
    id: 'apple' as const,
    label: 'Apple',
    icon: (
      <img src="/apple-logo.png" alt="Apple" width={14} height={14} style={{ objectFit: 'contain' }} />
    ),
  },
] as const;

export function LinkedAccounts() {
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadIdentities = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setIdentities((user.identities as UserIdentity[]) ?? []);
      setHasPassword(user.identities?.some(i => i.provider === 'email') ?? false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadIdentities(); }, [loadIdentities]);

  const getProviderLabel = (providerId: string) =>
    OAUTH_PROVIDERS.find(p => p.id === providerId)?.label ?? providerId;

  const handleLink = async (provider: 'google' | 'apple') => {
    const label = getProviderLabel(provider);
    setActionLoading(provider);
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/settings` },
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already linked') || msg.includes('already associated')) {
        toast.error(`This ${label} account is already linked to a different Forgenta account. Each ${label} account can only be connected to one Forgenta account.`);
      } else if (msg.includes('manual linking') || msg.includes('disabled')) {
        toast.error('Account linking is currently disabled. Contact support if this persists.');
      } else {
        toast.error(error.message);
      }
      setActionLoading(null);
    }
    // success → browser redirects away; loading state clears on return
  };

  const handleUnlink = async (identity: UserIdentity) => {
    if (identities.length <= 1 && !hasPassword) {
      toast.error('You must keep at least one sign-in method. Add a password or another provider first.');
      return;
    }
    if (identities.length === 1) {
      toast.error('Cannot unlink your only sign-in method.');
      return;
    }
    setActionLoading(identity.provider);
    const { error } = await supabase.auth.unlinkIdentity(identity as any);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${getProviderLabel(identity.provider)} account removed`);
      await loadIdentities();
    }
    setActionLoading(null);
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link2 size={13} className="text-muted-foreground" />
        <span className="text-xs font-medium">Linked Accounts</span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Link a social account so you can sign in with either method. Each social account can only be connected to one Forgenta account.
      </p>

      <div className="space-y-2">
        {OAUTH_PROVIDERS.map(provider => {
          const linked = identities.find(i => i.provider === provider.id);
          const busy = actionLoading === provider.id;
          return (
            <div
              key={provider.id}
              className="flex items-center justify-between bg-secondary/40 border border-border px-3 py-2.5"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <div className="flex items-center gap-2.5">
                {provider.icon}
                <div>
                  <p className="text-xs font-medium">{provider.label}</p>
                  {linked?.identity_data?.email && (
                    <p className="text-[10px] text-muted-foreground">{linked.identity_data.email}</p>
                  )}
                </div>
              </div>

              {linked ? (
                <div className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-primary" />
                  <button
                    onClick={() => handleUnlink(linked)}
                    disabled={busy}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors btn-press disabled:opacity-50"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {busy ? <Loader2 size={10} className="animate-spin" /> : <Unlink size={10} />}
                    Unlink
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleLink(provider.id)}
                  disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <Link2 size={10} />}
                  Link
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
