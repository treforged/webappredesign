/**
 * PlaidOAuth
 *
 * Landing page for OAuth bank redirects (Chase, BofA, Wells Fargo, etc.)
 * Plaid redirects the user here after they authenticate with their bank.
 * We re-initialize Plaid Link with the stored link token + receivedRedirectUri,
 * then auto-open to complete the connection.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';

const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const LINK_TOKEN_KEY = 'forged:plaid_link_token';

async function loadPlaidScript(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Plaid) return;
  return new Promise((resolve, reject) => {
    if (document.getElementById('plaid-link-js')) { resolve(); return; }
    const script = document.createElement('script');
    script.id = 'plaid-link-js';
    script.src = PLAID_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Plaid'));
    document.head.appendChild(script);
  });
}

export default function PlaidOAuth() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function completeOAuth() {
      try {
        const linkToken = localStorage.getItem(LINK_TOKEN_KEY);
        if (!linkToken) throw new Error('Session expired. Please try linking your bank again.');

        await loadPlaidScript();

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Not authenticated');
        const authHeader = `Bearer ${token}`;

        const receivedRedirectUri = window.location.href;

        const handler = (window as any).Plaid.create({
          token: linkToken,
          receivedRedirectUri,
          onSuccess: async (public_token: string, metadata: any) => {
            try {
              localStorage.removeItem(LINK_TOKEN_KEY);
              const institution = metadata?.institution ?? {};
              const exchangeRes = await fetch(`${FN_BASE}/plaid-exchange-token`, {
                method: 'POST',
                headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  public_token,
                  institution_id: institution.institution_id ?? null,
                  institution_name: institution.name ?? null,
                }),
              });
              const exchangeBody = await exchangeRes.json();
              if (!exchangeRes.ok) throw new Error(exchangeBody.error ?? 'Exchange failed');

              const name = exchangeBody.institution_name ?? 'Your bank';
              toast.success(`${name} linked successfully`);

              // Sync balances
              await fetch(`${FN_BASE}/plaid-sync`, {
                method: 'POST',
                headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
              });

              navigate('/accounts');
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Link failed');
              navigate('/accounts');
            }
          },
          onExit: (err: any) => {
            localStorage.removeItem(LINK_TOKEN_KEY);
            if (err) console.warn('Plaid OAuth exit:', err);
            navigate('/accounts');
          },
        });

        if (!cancelled) handler.open();
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
          setStatus('error');
        }
      }
    }

    completeOAuth();
    return () => { cancelled = true; };
  }, [navigate]);

  if (status === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertCircle size={32} className="text-destructive" />
        <p className="text-sm text-muted-foreground max-w-xs">{errorMsg}</p>
        <button
          onClick={() => navigate('/accounts')}
          className="text-xs text-primary underline underline-offset-2"
        >
          Back to Accounts
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <Loader2 size={24} className="animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Completing bank connection…</p>
    </div>
  );
}
