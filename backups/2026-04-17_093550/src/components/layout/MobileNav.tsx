import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, Landmark, PiggyBank, Sliders, Building2, TrendingUp, LogOut, MoreHorizontal, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useState } from 'react';

const items = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/accounts', icon: Building2, label: 'Accounts' },
  { to: '/budget', icon: Sliders, label: 'Budget' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Txns' },
  { to: '/debt', icon: Landmark, label: 'Debt' },
  { to: '/savings', icon: PiggyBank, label: 'Savings' },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
];

export default function MobileNav() {
  const { pathname } = useLocation();
  const { signOut, isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const [showMore, setShowMore] = useState(false);

  return (
    <>
      {/* More menu overlay */}
      {showMore && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setShowMore(false)}>
          <div className="absolute bottom-16 right-4 bg-card border border-border shadow-lg p-2 space-y-1 min-w-[160px]" style={{ borderRadius: 'var(--radius)' }} onClick={e => e.stopPropagation()}>
            <Link to="/net-worth" onClick={() => setShowMore(false)}
              className="block px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/50 btn-press" style={{ borderRadius: 'var(--radius)' }}>
              Net Worth
            </Link>
            <Link to="/settings" onClick={() => setShowMore(false)}
              className="block px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/50 btn-press" style={{ borderRadius: 'var(--radius)' }}>
              Settings
            </Link>
            {isDemo ? (
              <>
                <div className="border-t border-border my-1" />
                <Link to="/auth" onClick={() => setShowMore(false)}
                  className="block px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/10 btn-press" style={{ borderRadius: 'var(--radius)' }}>
                  Sign Up Free →
                </Link>
                <Link to="/" onClick={() => setShowMore(false)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 btn-press" style={{ borderRadius: 'var(--radius)' }}>
                  <Home size={12} /> Main Page
                </Link>
              </>
            ) : (
              <>
                {!isPremium && (
                  <Link to="/premium" onClick={() => setShowMore(false)}
                    className="block px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/50 btn-press" style={{ borderRadius: 'var(--radius)' }}>
                    Upgrade
                  </Link>
                )}
                <button onClick={() => { setShowMore(false); signOut(); }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 btn-press flex items-center gap-2" style={{ borderRadius: 'var(--radius)' }}>
                  <LogOut size={12} /> Sign Out
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex justify-around py-2 safe-area-pb">
        {items.map(item => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium transition-colors btn-press min-w-0",
                active ? "text-gold" : "text-muted-foreground"
              )}
            >
              <item.icon size={18} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setShowMore(!showMore)}
          className={cn(
            "flex flex-col items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium transition-colors btn-press",
            showMore ? "text-gold" : "text-muted-foreground"
          )}
        >
          <MoreHorizontal size={18} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
