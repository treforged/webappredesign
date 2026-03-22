import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type UserSubscription = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  subscription_status: string;
  current_period_end: string | null;
};

export function useSubscription() {
  const { user, isDemo } = useAuth();

  const query = useQuery({
    queryKey: ['user_subscription', isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('user_subscriptions' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown) as UserSubscription | null;
    },
  });

  const isPremium = isDemo
    ? false
    : query.data?.plan === 'premium' &&
      ['active', 'trialing'].includes(query.data?.subscription_status || '');

  const hasStripeCustomer = !!query.data?.stripe_customer_id;

  return {
    subscription: query.data,
    isPremium,
    hasStripeCustomer,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
