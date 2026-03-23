import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

type PremiumGateProps = {
  isPremium: boolean;
  children: React.ReactNode;
  message?: string;
  className?: string;
};

export default function PremiumGate({ isPremium, children, message, className }: PremiumGateProps) {
  if (isPremium) return <>{children}</>;

  return (
    <div className={cn("relative", className)}>
      <div className="blur-sm pointer-events-none select-none">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[2px] z-10" style={{ borderRadius: 'var(--radius)' }}>
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock size={18} className="text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {message || 'Upgrade to unlock this feature'}
          </p>
          <Link
            to="/premium"
            className="bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Upgrade Now
          </Link>
        </div>
      </div>
    </div>
  );
}
