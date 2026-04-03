import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, Landmark, PiggyBank,
  Settings, Crown, LogOut, ChevronLeft, ChevronRight, Wallet,
  Sliders, TrendingUp, Building2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/accounts', icon: Building2, label: 'Accounts' },
  { to: '/budget', icon: Sliders, label: 'Budget Control' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/debt', icon: Landmark, label: 'Debt Payoff' },
  { to: '/savings', icon: PiggyBank, label: 'Savings Goals' },
  { to: '/net-worth', icon: Wallet, label: 'Net Worth' },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/premium', icon: Crown, label: 'Upgrade' },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const { signOut, isDemo } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  // Brand link: dashboard if logged in, landing if demo/auth
  const brandTo = isDemo ? '/' : '/dashboard';

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0 transition-all duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border">
        {!collapsed && (
          <Link to={brandTo} className="font-display font-bold text-sm tracking-tight text-primary hover:opacity-80 transition-opacity">
            TRE FORGED
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors btn-press"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.map(item => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-xs font-medium transition-colors duration-150 btn-press",
                active
                  ? "bg-sidebar-accent text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
              )}
              style={{ borderRadius: 'var(--radius)' }}
            >
              <item.icon size={16} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-sidebar-border">
        <button
          onClick={signOut}
          className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground hover:text-destructive transition-colors w-full btn-press"
        >
          <LogOut size={16} />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
