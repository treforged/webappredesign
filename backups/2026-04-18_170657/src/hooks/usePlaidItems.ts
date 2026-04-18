/**
 * usePlaidItems — fetches the user's linked Plaid institutions.
 *
 * IMPORTANT: this hook explicitly selects only non-sensitive columns.
 * access_token is never queried from the frontend — only edge functions
 * using the service role key access it.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PlaidItem {
  id: string;
  plaid_item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export function usePlaidItems() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['plaid_items', user?.id],
    enabled: !isDemo && !!user,
    queryFn: async (): Promise<PlaidItem[]> => {
      if (!user) return [];
      // Explicitly omit access_token — never select it on the client
      const { data, error } = await (supabase as any)
        .from('plaid_items')
        .select('id, plaid_item_id, institution_id, institution_name, last_synced_at, created_at')
        .eq('user_id', user.id)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as PlaidItem[];
    },
    staleTime: 60_000, // 1 min — sync button drives freshness
  });

  const remove = async (plaidItemId: string) => {
    if (!user) return;
    await (supabase as any)
      .from('plaid_items')
      .delete()
      .eq('user_id', user.id)
      .eq('plaid_item_id', plaidItemId);
    // Also deactivate linked accounts
    await (supabase as any)
      .from('accounts')
      .update({ active: false })
      .eq('user_id', user.id)
      .eq('plaid_item_id', plaidItemId);
    qc.invalidateQueries({ queryKey: ['plaid_items'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['plaid_items'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    remove,
    invalidate,
  };
}
