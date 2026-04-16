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
      <svg width="13" height="13" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 382.9 40.7 262.6 40.7 242.1c0-131.4 90.7-200.3 179.4-200.3 87 0 142.7 57.6 168.2 57.6 24.4 0 88.1-60.9 172.3-60.9 13.8 0 133.4 1.3 204.3 104.6z"/>
        <path d="M530.4 40.3c-29.6 34.7-76.6 60.4-123.5 56.8-5.8-45.5 16.7-93.8 44.3-124 29.6-32.8 80-60.9 122.5-62.9 4.5 47.4-13.4 94-43.3 130.1z"/>
      </svg>
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

  const handleLink = async (provider: 'google' | 'apple') => {
    setActionLoading(provider);
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/settings` },
    });
    if (error) {
      // Provide context-specific error messages for common failure modes
      const msg = error.message.toLowerCase();
      if (msg.includes('already linked') || msg.includes('already associated')) {
        toast.error(`This ${provider} account is already linked to a different Forged account. Each ${provider} account can only be connected to one account.`);
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
      toast.success(`${identity.provider} account unlinked`);
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
        Link a social account so you can sign in with either method. Each social account can only be connected to one Forged account.
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
