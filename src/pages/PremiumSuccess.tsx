import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';

export default function PremiumSuccess() {
  const { refetch } = useSubscription();
  const [searchParams] = useSearchParams();
  const [polling, setPolling] = useState(true);
  const [verified, setVerified] = useState(false);

  const sessionId = searchParams.get('session_id');
  const isCoupon = searchParams.get('coupon') === '1';

  useEffect(() => {
    // Coupon grants are written synchronously before the redirect — one refetch is enough
    if (isCoupon) {
      refetch().then(() => { setPolling(false); setVerified(true); });
      return;
    }

    // No session_id means the user navigated here directly — show confirmation without polling
    if (!sessionId) {
      setPolling(false);
      return;
    }

    // Stripe webhook is async. Poll every 1.5s (max 7 attempts ≈ 10.5s) until the DB
    // reflects the active subscription that the webhook will write.
    let attempts = 0;
    const MAX_ATTEMPTS = 7;

    const poll = async () => {
      const result = await refetch();
      const sub = result.data as { plan?: string; subscription_status?: string } | null;
      if (
        sub?.plan === 'premium' &&
        ['active', 'trialing'].includes(sub?.subscription_status || '')
      ) {
        setVerified(true);
        setPolling(false);
        return;
      }
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        setPolling(false);
        return;
      }
      setTimeout(poll, 1500);
    };

    // Give the webhook a 1s head-start before first poll
    setTimeout(poll, 1000);
  }, []);

  if (polling) {
    return (
      <div className="p-4 lg:p-6 max-w-md mx-auto text-center space-y-4 mt-12">
        <Loader2 className="mx-auto animate-spin text-primary" size={32} />
        <p className="text-sm font-medium">Activating your subscription…</p>
        <p className="text-xs text-muted-foreground">This usually takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-md mx-auto text-center space-y-6 mt-12">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
        <CheckCircle className="text-primary" size={32} />
      </div>
      <h1 className="font-display font-bold text-xl tracking-tight">Welcome to Premium!</h1>
      {verified ? (
        <p className="text-sm text-muted-foreground">
          Your subscription is confirmed and active. All premium features are unlocked.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your payment was received. Premium access may take a moment to activate — if the
          dashboard still shows a paywall, wait a few seconds and refresh.
        </p>
      )}
      <Link
        to="/dashboard"
        className="inline-block bg-primary text-primary-foreground px-6 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
