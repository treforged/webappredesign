import { useState, useCallback } from 'react';
import { Check, Crown, Loader2, ExternalLink, ArrowLeft } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { tracedInvoke } from '@/lib/tracer';
import { toast } from 'sonner';
import IosPaywall from '@/components/premium/IosPaywall';

// Initialise Stripe outside the component so the promise is stable across renders
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '');

const free = ['Budget control', 'Basic dashboard', 'Transaction tracking', 'Up to 3 savings goals', 'Up to 3 debt trackers'];
const premium = ['Advanced dashboard', 'Export to CSV/PDF', 'Unlimited savings goals & debts', 'Car Fund Tracker', 'Custom rule categories', 'AI Advisor', 'Priority support'];

type Phase = 'pricing' | 'loading' | 'checkout';

const isNativeIos =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export default function Premium() {
  if (isNativeIos) return <IosPaywall />;

  const { isPremium, hasStripeCustomer, isLoading } = useSubscription();
  const [portalLoading, setPortalLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [phase, setPhase] = useState<Phase>('pricing');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<'monthly' | 'yearly'>('yearly');

  const fetchClientSecret = useCallback(async (plan: 'monthly' | 'yearly') => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error('Please sign in first');
      return null;
    }

    const { data, error } = await tracedInvoke<{ client_secret: string }>(supabase, 'create-checkout', {
      body: {
        plan,
        ui_mode: 'embedded',
        return_url: `${window.location.origin}/premium/success`,
      },
    });

    if (error) throw error;
    return data?.client_secret ?? null;
  }, []);

  const handleStartCheckout = async () => {
    setPhase('loading');
    try {
      const secret = await fetchClientSecret(selectedPlan);
      if (!secret) {
        setPhase('pricing');
        return;
      }
      setClientSecret(secret);
      setCheckoutPlan(selectedPlan);
      setPhase('checkout');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to start checkout');
      setPhase('pricing');
    }
  };

  const handleSwitchPlan = async (newPlan: 'monthly' | 'yearly') => {
    if (newPlan === checkoutPlan) return;
    setPhase('loading');
    try {
      const secret = await fetchClientSecret(newPlan);
      if (!secret) {
        setPhase('checkout');
        return;
      }
      setClientSecret(secret);
      setCheckoutPlan(newPlan);
      setPhase('checkout');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to switch plan');
      setPhase('checkout');
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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to open billing portal');
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

  // ── Embedded checkout phase ──────────────────────────────────────────────────
  if (phase === 'checkout' && clientSecret) {
    return (
      <div className="p-4 lg:p-6 pb-12 max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPhase('pricing')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ArrowLeft size={12} /> Back to plans
          </button>
          <div className="flex items-center gap-1.5">
            <Crown size={13} className="text-gold" />
            <span className="text-xs font-semibold text-gold">Premium</span>
          </div>
        </div>

        {/* Plan switcher */}
        <div className="flex bg-secondary border border-border p-0.5" style={{ borderRadius: 'var(--radius)' }}>
          <button
            onClick={() => handleSwitchPlan('yearly')}
            className={`flex-1 py-2 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${checkoutPlan === 'yearly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
          >
            Yearly — $89.99
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${checkoutPlan === 'yearly' ? 'bg-white/20 text-white' : 'bg-gold/15 text-gold'}`}>
              SAVE 25%
            </span>
          </button>
          <button
            onClick={() => handleSwitchPlan('monthly')}
            className={`flex-1 py-2 text-xs font-semibold transition-all ${checkoutPlan === 'monthly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
          >
            Monthly — $9.99/mo
          </button>
        </div>

        {/* Stripe Embedded Checkout */}
        <div className="rounded-lg overflow-hidden border border-border">
          <EmbeddedCheckoutProvider
            key={clientSecret}
            stripe={stripePromise}
            options={{ clientSecret }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    );
  }

  // ── Loading spinner ──────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader2 className="mx-auto animate-spin text-primary" size={28} />
          <p className="text-sm text-muted-foreground">Preparing checkout…</p>
        </div>
      </div>
    );
  }

  // ── Pricing cards (default) ──────────────────────────────────────────────────
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

      <div className="grid md:grid-cols-2 gap-4">
        {/* Free card */}
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

        {/* Premium card */}
        <div className="card-forged p-6 space-y-4 border-gold/30">
          <div className="flex items-center gap-2">
            <Crown size={16} className="text-gold" />
            <h3 className="font-display font-semibold text-sm text-gold">Premium</h3>
          </div>

          {/* Billing toggle */}
          {!isPremium && (
            <div className="flex bg-secondary border border-border p-0.5" style={{ borderRadius: 'var(--radius)' }}>
              <button
                onClick={() => setSelectedPlan('yearly')}
                className={`flex-1 py-2 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${selectedPlan === 'yearly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
              >
                Yearly
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${selectedPlan === 'yearly' ? 'bg-white/20 text-white' : 'bg-gold/15 text-gold'}`}>
                  SAVE 25%
                </span>
              </button>
              <button
                onClick={() => setSelectedPlan('monthly')}
                className={`flex-1 py-2 text-xs font-semibold transition-all ${selectedPlan === 'monthly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
              >
                Monthly
              </button>
            </div>
          )}

          {/* Price display */}
          {!isPremium && selectedPlan === 'yearly' ? (
            <div className="space-y-2">
              <p className="font-display font-bold text-3xl tracking-tight text-gold">
                $89.99<span className="text-base text-muted-foreground font-normal">/yr</span>
              </p>
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-lg text-gold/90">$7.50<span className="text-sm font-normal text-muted-foreground">/mo</span></span>
                <span className="bg-gold/15 border border-gold/40 text-gold text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full uppercase">
                  2 months free
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">Billed as $89.99 once per year</p>
            </div>
          ) : !isPremium ? (
            <p className="font-display font-bold text-3xl tracking-tight text-gold">
              $9.99<span className="text-sm text-muted-foreground font-normal">/mo</span>
            </p>
          ) : (
            <p className="font-display font-bold text-3xl tracking-tight text-gold">Active</p>
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
                onClick={handleStartCheckout}
                disabled={isLoading}
                className="w-full bg-primary text-primary-foreground py-2.5 text-xs font-semibold btn-press flex items-center justify-center gap-2"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {selectedPlan === 'yearly' ? 'Get Yearly — $89.99' : 'Get Monthly — $9.99/mo'}
              </button>
              <p className="text-[10px] text-muted-foreground text-center mt-1">
                Activated instantly after checkout
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
