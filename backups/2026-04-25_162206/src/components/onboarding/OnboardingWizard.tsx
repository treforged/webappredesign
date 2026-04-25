import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import PlaidLinkButton from '@/components/shared/PlaidLinkButton';
import {
  X, ChevronRight, Crown, Check, Shield,
  DollarSign, CreditCard, PiggyBank,
} from 'lucide-react';

const WIZARD_DISMISSED_KEY = 'forged:onboarding_wizard_dismissed';

type Step = 1 | 2 | 3 | 4;
type UpsellStage = null | 'first' | 'second';

interface Props {
  onComplete: () => void;
  onDismiss: () => void;
}

const STEP_LABELS = ['Connect a bank', 'Set your income', 'Add a debt', 'Create a goal'];

export default function OnboardingWizard({ onComplete, onDismiss }: Props) {
  const { user } = useAuth();
  const { isPremium } = useSubscription();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [upsellStage, setUpsellStage] = useState<UpsellStage>(isPremium ? null : 'first');
  const [bankLinked, setBankLinked] = useState(false);

  const markComplete = async () => {
    if (user) {
      await supabase
        .from('profiles')
        .update({ onboarding_completed: true } as any)
        .eq('user_id', user.id);
    }
    onComplete();
  };

  const dismiss = () => {
    sessionStorage.setItem(WIZARD_DISMISSED_KEY, '1');
    onDismiss();
  };

  const nextStep = () => {
    if (step < 4) setStep((step + 1) as Step);
    else markComplete();
  };

  const navigateTo = (path: string) => {
    sessionStorage.setItem(WIZARD_DISMISSED_KEY, '1');
    navigate(path);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-background/85 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="card-forged p-5 sm:p-6 w-full max-w-md space-y-5 relative animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Getting started</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Step {step} of {STEP_LABELS.length} — {STEP_LABELS[step - 1]}
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${(step / STEP_LABELS.length) * 100}%` }}
          />
        </div>

        {/* ── Step 1: Bank connect ── */}
        {step === 1 && isPremium && (
          <BankConnectStep
            linked={bankLinked}
            onLinked={() => { setBankLinked(true); nextStep(); }}
            onSkip={nextStep}
          />
        )}

        {step === 1 && !isPremium && upsellStage === 'first' && (
          <FirstUpsell
            onUpgrade={() => navigateTo('/premium')}
            onDecline={() => setUpsellStage('second')}
          />
        )}

        {step === 1 && !isPremium && upsellStage === 'second' && (
          <SecondUpsell
            onUpgrade={() => navigateTo('/premium')}
            onDecline={nextStep}
          />
        )}

        {/* ── Step 2: Income ── */}
        {step === 2 && (
          <NavStep
            icon={<DollarSign size={16} className="text-primary" />}
            title="Set your monthly income"
            body="Head to Budget Control to enter your gross pay, deductions, and paycheck frequency. This powers every projection in Forged."
            ctaLabel="Open Budget Control"
            onNavigate={() => navigateTo('/budget')}
            onSkip={nextStep}
          />
        )}

        {/* ── Step 3: Debt ── */}
        {step === 3 && (
          <NavStep
            icon={<CreditCard size={16} className="text-primary" />}
            title="Add a debt"
            body="Add your credit cards or loans in Debt Payoff. The avalanche engine will calculate the fastest, cheapest path to zero."
            ctaLabel="Open Debt Payoff"
            onNavigate={() => navigateTo('/debt')}
            onSkip={nextStep}
          />
        )}

        {/* ── Step 4: Goals ── */}
        {step === 4 && (
          <NavStep
            icon={<PiggyBank size={16} className="text-primary" />}
            title="Create a savings goal"
            body="Add your first savings goal — emergency fund, vacation, down payment, or anything else. Forged tracks progress automatically."
            ctaLabel="Open Savings Goals"
            onNavigate={() => navigateTo('/savings')}
            onSkip={markComplete}
            isLast
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BankConnectStep({
  linked,
  onLinked,
  onSkip,
}: {
  linked: boolean;
  onLinked: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
          <Shield size={14} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">Connect a bank account</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Link your bank via Plaid for automatic transaction import and daily balance updates.
          </p>
        </div>
      </div>

      {linked ? (
        <div className="flex items-center gap-2 bg-success/10 border border-success/30 px-3 py-2.5 text-xs text-success font-medium" style={{ borderRadius: 'var(--radius)' }}>
          <Check size={12} /> Bank connected — continuing…
        </div>
      ) : (
        <PlaidLinkButton onSuccess={onLinked} />
      )}

      <button
        onClick={onSkip}
        className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        Skip for now →
      </button>
    </div>
  );
}

function FirstUpsell({
  onUpgrade,
  onDecline,
}: {
  onUpgrade: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
          <Crown size={14} className="text-gold" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-snug">
            Connect up to 10 bank accounts automatically with Forged Premium.
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Premium also includes: AI Advisor (unlimited), daily auto-sync,
            advanced forecasting, and priority support.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onUpgrade}
          className="flex-1 py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Yes, upgrade
        </button>
        <button
          onClick={onDecline}
          className="flex-1 py-2.5 border border-border text-xs text-muted-foreground hover:text-foreground btn-press transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          No, I'll stick to free
        </button>
      </div>
    </div>
  );
}

function SecondUpsell({
  onUpgrade,
  onDecline,
}: {
  onUpgrade: () => void;
  onDecline: () => void;
}) {
  const perks = [
    'Auto-sync every morning — wake up to fresh balances',
    'AI Advisor — ask your money anything, get real answers',
    'Up to 10 linked accounts vs. manual-only on free',
    'Advanced 36-month forecast with Plaid data',
    'Cancel anytime',
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">Are you sure? Here's what you'd be missing:</p>

      <ul className="space-y-2">
        {perks.map(perk => (
          <li key={perk} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check size={11} className="text-primary mt-0.5 shrink-0" />
            {perk}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          onClick={onUpgrade}
          className="flex-1 py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Upgrade now
        </button>
        <button
          onClick={onDecline}
          className="flex-1 py-2.5 border border-border text-xs text-muted-foreground hover:text-foreground btn-press transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          I'll stay on free — let's keep going
        </button>
      </div>
    </div>
  );
}

function NavStep({
  icon,
  title,
  body,
  ctaLabel,
  onNavigate,
  onSkip,
  isLast = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  onNavigate: () => void;
  onSkip: () => void;
  isLast?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>
        </div>
      </div>

      <button
        onClick={onNavigate}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {ctaLabel} <ChevronRight size={13} />
      </button>

      <button
        onClick={onSkip}
        className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        {isLast ? 'Finish setup' : 'Skip for now →'}
      </button>
    </div>
  );
}
