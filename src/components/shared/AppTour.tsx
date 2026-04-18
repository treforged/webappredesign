import { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export type TourVariant = 'new-user' | 'premium';

interface TourStep {
  title: string;
  body: string;
  emoji: string;
}

const NEW_USER_STEPS: TourStep[] = [
  {
    emoji: '🏠',
    title: 'Command Center',
    body: 'Your dashboard shows net worth, cash position, and key KPIs at a glance. Everything updates live as you add data.',
  },
  {
    emoji: '⚙️',
    title: 'Budget Control first',
    body: 'Start in Budget Control — add your income and recurring expenses. These power every projection in the app.',
  },
  {
    emoji: '💳',
    title: 'Debt Payoff engine',
    body: 'Add your credit cards and loans. The avalanche engine tells you exactly how much to throw at each one each month.',
  },
  {
    emoji: '🎯',
    title: 'Savings Goals',
    body: 'Track emergency funds, vacations, down payments, and more. Goals link to real accounts so balances stay accurate.',
  },
  {
    emoji: '📈',
    title: '36-Month Forecast',
    body: 'See your full financial trajectory. Debt payoff, savings growth, and net worth — all projected three years out.',
  },
  {
    emoji: '💡',
    title: "You're set",
    body: 'Tap any section to explore. The more data you add, the sharper your plan gets. Welcome to Forged.',
  },
];

const PREMIUM_STEPS: TourStep[] = [
  {
    emoji: '✨',
    title: 'Premium unlocked',
    body: 'You now have access to every feature in Forged. Here\'s what\'s new for you.',
  },
  {
    emoji: '🤖',
    title: 'AI Advisor',
    body: 'Get a financial health score, spending analysis, and ask any money question. Find it in the More menu.',
  },
  {
    emoji: '🏦',
    title: 'Bank auto-sync',
    body: 'Connect your bank via Plaid in Accounts. Balances update automatically — no more manual entry.',
  },
  {
    emoji: '🚗',
    title: 'Car Fund Tracker',
    body: 'Plan a vehicle purchase with full affordability math — down payment, APR, monthly payment, and insurance.',
  },
  {
    emoji: '📄',
    title: 'PDF export',
    body: 'Download your 36-month forecast as a print-ready PDF. Put it on the wall. Watch it happen.',
  },
  {
    emoji: '🏷️',
    title: 'Custom categories',
    body: 'In Budget Control, you can now type any category name for your recurring rules instead of using preset options.',
  },
];

// Flag keys stored in profiles.tour_flags JSONB — account-based, cross-device
const FLAG_KEY: Record<TourVariant, string> = {
  'new-user': 'new_user_done',
  'premium': 'premium_done',
};

// localStorage cache key (device-level fast check to avoid DB round-trip on every load)
const LOCAL_KEY: Record<TourVariant, string> = {
  'new-user': 'forged:tour_done_new_user',
  'premium': 'forged:tour_done_premium',
};

interface AppTourProps {
  variant: TourVariant;
  onDone?: () => void;
}

export default function AppTour({ variant, onDone }: AppTourProps) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Fast path: device cache says it's done — skip DB call
    if (localStorage.getItem(LOCAL_KEY[variant])) return;

    // Authoritative check: read from profiles.tour_flags (account-based, cross-device)
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('profiles')
        .select('tour_flags')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          const flags = ((data as any)?.tour_flags as Record<string, boolean>) ?? {};
          if (flags[FLAG_KEY[variant]]) {
            // DB says done — populate device cache and stay hidden
            localStorage.setItem(LOCAL_KEY[variant], '1');
          } else {
            setVisible(true);
          }
        });
    });
  }, [variant]);

  const steps = variant === 'premium' ? PREMIUM_STEPS : NEW_USER_STEPS;
  const current = steps[step];
  const isLast = step === steps.length - 1;

  const dismiss = async () => {
    setVisible(false);
    // Write to device cache immediately
    localStorage.setItem(LOCAL_KEY[variant], '1');
    // Persist to DB so other devices see it too
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from('profiles').select('tour_flags').eq('user_id', user.id).maybeSingle();
      const existing = ((data as any)?.tour_flags as Record<string, boolean>) ?? {};
      await supabase.from('profiles').update({
        tour_flags: { ...existing, [FLAG_KEY[variant]]: true },
      } as any).eq('user_id', user.id);
    }
    onDone?.();
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={dismiss} />

      {/* Card */}
      <div
        className="relative z-10 w-full max-w-sm card-forged p-5 space-y-4"
        style={{ boxShadow: '0 0 40px -8px hsl(43 56% 52% / 0.25)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {variant === 'premium' && <Sparkles size={14} className="text-primary" />}
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {variant === 'premium' ? 'Premium Tour' : 'Getting Started'} · {step + 1}/{steps.length}
            </span>
          </div>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Step progress dots */}
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-0.5 flex-1 rounded-full transition-all duration-300"
              style={{ background: i <= step ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="space-y-2">
          <div className="text-2xl">{current.emoji}</div>
          <p className="font-display font-bold text-base tracking-tight">{current.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{current.body}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          >
            <ChevronLeft size={13} /> Back
          </button>

          {isLast ? (
            <button
              onClick={dismiss}
              className="bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Let's go
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1 bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Next <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
