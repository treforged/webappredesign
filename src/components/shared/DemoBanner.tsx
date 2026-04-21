import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const routeDescriptions: Record<string, string> = {
  '/dashboard':    'Overview of all accounts, cash flow, and net worth in one place',
  '/accounts':     'Every account — checking, savings, credit cards, investments — tracked together',
  '/budget':       'Recurring rules power the forecast: income, bills, transfers, subscriptions',
  '/transactions': 'One-time income and expenses feed directly into the debt payoff engine',
  '/debt':         'Avalanche engine computes the fastest payoff path using every dollar above your cash floor',
  '/savings':      'Goals track progress and link to real account balances automatically',
  '/net-worth':    'Weekly snapshots show wealth momentum over time',
  '/forecast':     '36-month projection: debt payoff, savings growth, and cash flow in one view',
  '/settings':     'Cash floor, income settings, and pay schedule drive every calculation',
};

export default function DemoBanner() {
  const { isDemo } = useAuth();
  const { pathname } = useLocation();
  if (!isDemo) return null;

  const description = routeDescriptions[pathname] ?? 'Explore any page to see how it all connects';

  return (
    <div className="sticky z-50 bg-card border-b border-border/80 px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3"
       style={{ top: 'env(safe-area-inset-top)' }}
>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-primary bg-primary/15 px-2 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
          Demo
        </span>
        <span className="text-[11px] text-muted-foreground hidden md:block truncate">
          <span className="text-foreground font-medium">Jordan's finances</span>
          {' · '}
          {description}
        </span>
        <span className="text-[11px] text-muted-foreground md:hidden">Sample profile</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/"
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 border border-border hover:border-border/80 btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          ← Home
        </Link>
        <Link
          to="/auth"
          className="text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Sign Up Free →
        </Link>
      </div>
    </div>
  );
}
