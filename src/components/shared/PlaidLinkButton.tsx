/**
 * PlaidLinkButton
 *
 * Loads the Plaid Link JS script on demand, creates a link token via the
 * plaid-create-link-token edge function, and opens the Plaid Link UI.
 * On success it calls plaid-exchange-token, then triggers onSuccess() so
 * the parent can refresh account/plaid-items data.
 *
 * No npm dependency — the Plaid Link SDK is loaded from Plaid's CDN.
 */

import { useState, useCallback } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function loadPlaidScript(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Plaid) return;
  return new Promise((resolve, reject) => {
    if (document.getElementById('plaid-link-js')) { resolve(); return; }
    const script = document.createElement('script');
    script.id  = 'plaid-link-js';
    script.src = PLAID_SCRIPT_SRC;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Plaid script'));
    document.head.appendChild(script);
  });
}

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return `Bearer ${token}`;
}

interface PlaidLinkButtonProps {
  onSuccess: () => void;
  disabled?: boolean;
}

export default function PlaidLinkButton({ onSuccess, disabled }: PlaidLinkButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      // Load Plaid SDK
      await loadPlaidScript();

      const authHeader = await getAuthHeader();

      // Get link token from our edge function
      const tokenRes = await fetch(`${FN_BASE}/plaid-create-link-token`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      });
      const tokenBody = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenBody.error ?? 'Failed to create link token');

      const { link_token } = tokenBody;

      // Open Plaid Link
      const handler = (window as any).Plaid.create({
        token: link_token,
        onSuccess: async (public_token: string, metadata: any) => {
          try {
            const institution = metadata?.institution ?? {};
            const exchangeRes = await fetch(`${FN_BASE}/plaid-exchange-token`, {
              method: 'POST',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                public_token,
                institution_id:   institution.institution_id ?? null,
                institution_name: institution.name           ?? null,
              }),
            });
            const exchangeBody = await exchangeRes.json();
            if (!exchangeRes.ok) throw new Error(exchangeBody.error ?? 'Exchange failed');

            const name = exchangeBody.institution_name ?? 'Your bank';
            toast.success(`${name} linked successfully`);

            // Immediately sync balances
            await fetch(`${FN_BASE}/plaid-sync`, {
              method: 'POST',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            });

            onSuccess();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Link failed');
          }
        },
        onExit: (err: any) => {
          if (err) console.warn('Plaid Link exited with error:', err);
          setLoading(false);
        },
        onEvent: (_eventName: string) => {},
      });

      setLoading(false);
      handler.open();
    } catch (err) {
      setLoading(false);
      toast.error(err instanceof Error ? err.message : 'Failed to open bank link');
    }
  }, [onSuccess]);

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold btn-press disabled:opacity-50"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
      {loading ? 'Connecting…' : 'Link Bank Account'}
    </button>
  );
}
