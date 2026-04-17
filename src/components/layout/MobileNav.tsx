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

// Primary 5 — matches bottom-nav-limit rule (max 5 with labels)
const PRIMARY = [
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Home' },
  { to: '/transactions', icon: ArrowLeftRight,  label: 'Txns' },
  { to: '/budget',       icon: Sliders,         label: 'Budget' },
  { to: '/debt',         icon: Landmark,        label: 'Debt' },
];

// Secondary — lives in the More sheet
const SECONDARY = [
  { to: '/accounts',  icon: Building2,  label: 'Accounts' },
  { to: '/savings',   icon: PiggyBank,  label: 'Savings' },
  { to: '/forecast',  icon: TrendingUp, label: 'Forecast' },
  { to: '/net-worth', icon: Wallet,     label: 'Net Worth' },
  { to: '/ai',        icon: Sparkles,   label: 'AI' },
  { to: '/settings',  icon: Settings,   label: 'Settings' },
];

export default function MobileNav() {
  const { pathname } = useLocation();
  const { signOut, isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const [showMore, setShowMore] = useState(false);

  const moreActive = SECONDARY.some(i => pathname === i.to);

  return (
    <>
      {/* More sheet overlay */}
      {showMore && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          onClick={() => setShowMore(false)}
        >
          <div
            className="absolute bottom-16 left-2 right-2 bg-card border border-border shadow-xl p-3"
            style={{ borderRadius: 'var(--radius)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close row */}
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">More</span>
              <button onClick={() => setShowMore(false)} className="p-1 text-muted-foreground hover:text-foreground icon-btn">
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {SECONDARY.map(item => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setShowMore(false)}
                    className={cn(
                      'flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors btn-press',
                      active ? 'text-primary bg-primary/8' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                    )}
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-border pt-2 space-y-0.5">
              {isDemo ? (
                <>
                  <Link
                    to="/auth"
                    onClick={() => setShowMore(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/8 btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Sign Up Free →
                  </Link>
                  <Link
                    to="/"
                    onClick={() => setShowMore(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <Home size={13} /> Main Page
                  </Link>
                </>
              ) : (
                <>
                  {!isPremium && (
                    <Link
                      to="/premium"
                      onClick={() => setShowMore(false)}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary btn-press w-full"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      <Crown size={13} className="text-primary" /> Upgrade to Premium
                    </Link>
                  )}
                  <button
                    onClick={() => { setShowMore(false); signOut(); }}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <LogOut size={13} /> Sign Out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border safe-area-pb">
        <div className="flex justify-around py-1.5">
          {PRIMARY.map(item => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] font-medium transition-colors btn-press min-w-[52px]',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <item.icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setShowMore(!showMore)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] font-medium transition-colors btn-press min-w-[52px]',
              moreActive || showMore ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <MoreHorizontal size={20} strokeWidth={moreActive || showMore ? 2.2 : 1.8} />
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
