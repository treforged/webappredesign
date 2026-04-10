import { useState } from 'react';
import { Check, Crown, Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { tracedInvoke } from '@/lib/tracer';
import { toast } from 'sonner';

const free = ['1 budget', 'Basic dashboard', 'Transaction tracking', 'Up to 3 savings goals', '1 debt tracker'];
const premium = ['Unlimited budgets', 'Advanced dashboard', 'Export to CSV/PDF', 'Unlimited goals & debts', 'Priority support', 'Car fund tracker pro', 'Custom categories'];

export default function Premium() {
  const { isPremium, hasStripeCustomer, isLoading } = useSubscription();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in first');
        return;
      }

      const { data, error } = await tracedInvoke<{ url: string }>(supabase, 'create-checkout', {
        body: { return_url: window.location.origin, plan: selectedPlan },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      toast.error('Checkout URL was not returned');
    } catch (e: any) {
      toast.error(e.message || 'Failed to start checkout');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in first');
        return;
      }

      const { data, error } = await tracedInvoke<{ url: string }>(supabase, 'create-portal-session', {
        body: { return_url: window.location.origin },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      toast.error('Billing portal URL was not returned');
    } catch (e: any) {
      toast.error(e.message || 'Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <div className="h-7 w-48 bg-muted rounded animate-pulse mx-auto" />
          <div className="h-4 w-64 bg-muted rounded animate-pulse mx-auto" />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card-forged p-6 h-72 bg-muted/20 animate-pulse" style={{ borderRadius: 'var(--radius)' }} />
          <div className="card-forged p-6 h-72 bg-muted/20 animate-pulse" style={{ borderRadius: 'var(--radius)' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="font-display font-bold text-2xl tracking-tight">
          {isPremium ? 'Your Premium Plan' : 'Upgrade to Premium'}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {isPremium ? 'You have full access to all features.' : 'Unlock the full financial cockpit. No compromises.'}
        </p>
      </div>

      {/* Billing toggle — only show when not yet premium */}
      {!isPremium && (
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center bg-secondary border border-border p-0.5" style={{ borderRadius: 'var(--radius)' }}>
            <button
              onClick={() => setSelectedPlan('yearly')}
              className={`px-4 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${selectedPlan === 'yearly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
            >
              Yearly
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${selectedPlan === 'yearly' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-gold/20 text-gold'}`}>
                SAVE 25%
              </span>
            </button>
            <button
              onClick={() => setSelectedPlan('monthly')}
              className={`px-4 py-1.5 text-xs font-semibold transition-colors ${selectedPlan === 'monthly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
            >
              Monthly
            </button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-forged p-6 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-sm">Free</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Get started with the basics</p>
          </div>
          <p className="font-display font-bold text-3xl tracking-tight">
            $0<span className="text-sm text-muted-foreground font-normal">/mo</span>
          </p>
          <ul className="space-y-2">
            {free.map((f) => (
              <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Check size={12} className="text-muted-foreground" /> {f}
              </li>
            ))}
          </ul>
          <button
            disabled
            className="w-full border border-border text-foreground py-2 text-xs font-semibold opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {isPremium ? 'Free Tier' : 'Current Plan'}
          </button>
        </div>

        <div className="card-forged p-6 space-y-4 border-gold/30">
          <div className="flex items-center gap-2">
            <Crown size={16} className="text-gold" />
            <h3 className="font-display font-semibold text-sm text-gold">Premium</h3>
          </div>
          <p className="text-[10px] text-muted-foreground">Full access. Total control.</p>
          {isPremium ? null : selectedPlan === 'yearly' ? (
            <div>
              <p className="font-display font-bold text-3xl tracking-tight text-gold">
                $89.99<span className="text-sm text-muted-foreground font-normal">/yr</span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">$7.50/mo — 2 months free</p>
            </div>
          ) : (
            <p className="font-display font-bold text-3xl tracking-tight text-gold">
              $9.99<span className="text-sm text-muted-foreground font-normal">/mo</span>
            </p>
          )}
          {isPremium && (
            <p className="font-display font-bold text-3xl tracking-tight text-gold">
              Active
            </p>
          )}
          <ul className="space-y-2">
            {premium.map((f) => (
              <li key={f} className="flex items-center gap-2 text-xs">
                <Check size={12} className="text-gold" /> {f}
              </li>
            ))}
          </ul>

          {isPremium ? (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="w-full bg-secondary text-secondary-foreground py-2 text-xs font-semibold btn-press flex items-center justify-center gap-2"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {portalLoading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              Manage Billing
            </button>
          ) : (
            <>
              <button
                onClick={handleCheckout}
                disabled={checkoutLoading || isLoading}
                className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold btn-press flex items-center justify-center gap-2"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {checkoutLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                Upgrade Now
              </button>
              <p className="text-sm text-muted-foreground mt-2">
                Your subscription will be processed and activated via a webhook. You will receive an email once your subscription is active.
              </p>
            </>
          )}
        </div>
      </div>

      {isPremium && hasStripeCustomer && (
        <div className="text-center">
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            {portalLoading ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
            View invoices & update payment method
          </button>
        </div>
      )}
    </div>
  );
}