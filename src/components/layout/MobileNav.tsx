import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, Sliders, Landmark,
  MoreHorizontal, Building2, PiggyBank, TrendingUp, Wallet,
  Settings, Crown, LogOut, Home, X, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useState } from 'react';

const PRIMARY = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Txns' },
  { to: '/budget', icon: Sliders, label: 'Budget' },
  { to: '/debt', icon: Landmark, label: 'Debt' },
];

const SECONDARY = [
  { to: '/accounts', icon: Building2, label: 'Accounts' },
  { to: '/savings', icon: PiggyBank, label: 'Savings' },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
  { to: '/net-worth', icon: Wallet, label: 'Net Worth' },
  { to: '/ai', icon: Sparkles, label: 'AI' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function MobileNav() {
  const { pathname } = useLocation();
  const { signOut, isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const [showMore, setShowMore] = useState(false);

  const moreActive = SECONDARY.some(i => pathname === i.to);

  return (
    <>
      {showMore && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          onClick={() => setShowMore(false)}
        >
          <div
            className="absolute left-3 right-3 bg-card border border-border shadow-xl max-h-[min(70vh,560px)] overflow-y-auto"
            style={{
              bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
              borderRadius: 'var(--radius)',
              paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                More
              </span>
              <button
                onClick={() => setShowMore(false)}
                className="p-1 text-muted-foreground hover:text-foreground icon-btn"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3">
              {SECONDARY.map(item => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setShowMore(false)}
                    className={cn(
                      'flex min-h-[72px] flex-col items-center justify-center gap-1.5 px-2 py-3 text-[11px] font-medium transition-colors btn-press text-center',
                      active ? 'text-primary bg-primary/8' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                    )}
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <item.icon size={18} />
                    <span className="leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-border px-3 pt-2 space-y-1">
              {isDemo ? (
                <>
                  <Link
                    to="/auth"
                    onClick={() => setShowMore(false)}
                    className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-primary hover:bg-primary/8 btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Sign Up Free →
                  </Link>
                  <Link
                    to="/"
                    onClick={() => setShowMore(false)}
                    className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <Home size={14} /> Main Page
                  </Link>
                </>
              ) : (
                <>
                  {!isPremium && (
                    <Link
                      to="/premium"
                      onClick={() => setShowMore(false)}
                      className="flex items-center gap-2 px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary btn-press w-full"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      <Crown size={14} className="text-primary" /> Upgrade to Premium
                    </Link>
                  )}
                  <button
                    onClick={() => { setShowMore(false); signOut(); }}
                    className="flex items-center gap-2 px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <LogOut size={14} /> Sign Out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <nav
        className="lg:hidden fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-5 items-stretch px-2 py-2 min-h-[72px]">
          {PRIMARY.map(item => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors btn-press text-center',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <item.icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setShowMore(!showMore)}
            className={cn(
              'flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors btn-press text-center',
              moreActive || showMore ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <MoreHorizontal size={20} strokeWidth={moreActive || showMore ? 2.2 : 1.8} />
            <span className="truncate">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}