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
import { Capacitor } from '@capacitor/core';
import { Link2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const LINK_TOKEN_KEY = 'forged:plaid_link_token';
const OAUTH_REDIRECT_URI = `${window.location.origin}/oauth`;

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
  // Refresh the session to ensure the token isn't close to expiry before calling edge functions
  const { data: refreshData } = await supabase.auth.refreshSession();
  const token = refreshData.session?.access_token;
  if (!token) {
    // Fallback: try current session
    const { data } = await supabase.auth.getSession();
    const fallback = data.session?.access_token;
    if (!fallback) throw new Error('Not authenticated. Please sign in again.');
    return `Bearer ${fallback}`;
  }
  return `Bearer ${token}`;
}

export interface PlaidSyncedAccount {
  name: string;
  balance: number;
  type: string;
}

interface PlaidLinkButtonProps {
  onSuccess: (accounts: PlaidSyncedAccount[], institutionName?: string) => void;
  onProcessing?: (processing: boolean) => void;
  disabled?: boolean;
}

export default function PlaidLinkButton({ onSuccess, onProcessing, disabled }: PlaidLinkButtonProps) {
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
        body: JSON.stringify({ redirect_uri: OAUTH_REDIRECT_URI }),
      });
      const tokenBody = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenBody.error ?? tokenBody.message ?? 'Failed to create link token');

      const { link_token } = tokenBody;

      // Store link token for OAuth redirect flow
      localStorage.setItem(LINK_TOKEN_KEY, link_token);

      // Open Plaid Link
      const handler = (window as any).Plaid.create({
        token: link_token,
        onSuccess: async (public_token: string, metadata: any) => {
          onProcessing?.(true);
          try {
            localStorage.removeItem(LINK_TOKEN_KEY);
            const institution = metadata?.institution ?? {};
            // Get a fresh token — the original may be stale after time spent in Plaid Link UI
            const freshAuth = await getAuthHeader();
            const exchangeRes = await fetch(`${FN_BASE}/plaid-exchange-token`, {
              method: 'POST',
              headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                public_token,
                institution_id:   institution.institution_id ?? null,
                institution_name: institution.name           ?? null,
              }),
            });
            const exchangeBody = await exchangeRes.json();
            if (!exchangeRes.ok) throw new Error(exchangeBody.error ?? exchangeBody.message ?? 'Exchange failed');

            const institutionName = exchangeBody.institution_name ?? 'Your bank';

            // Immediately sync balances
            const syncRes = await fetch(`${FN_BASE}/plaid-sync`, {
              method: 'POST',
              headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
            });
            const syncBody = syncRes.ok ? await syncRes.json() : { accounts: [] };

            onSuccess(syncBody.accounts ?? [], institutionName);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Link failed');
          } finally {
            onProcessing?.(false);
          }
        },
        onExit: (err: any) => {
          localStorage.removeItem(LINK_TOKEN_KEY);
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
