import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

type MetricCardProps = {
  label: string;
  value: string;
  sub?: string;
  accent?: 'gold' | 'silver' | 'crimson' | 'success' | 'orange';
  className?: string;
  icon?: LucideIcon;
};

export default function MetricCard({ label, value, sub, accent = 'silver', className, icon: Icon }: MetricCardProps) {
  const colorMap = {
    gold: 'text-primary',
    silver: 'text-foreground',
    crimson: 'text-destructive',
    success: 'text-success',
    orange: 'text-orange-400',
  };

  const glowMap = {
    gold: 'shadow-[0_0_20px_-8px_hsl(var(--gold)/0.3)]',
    silver: '',
    crimson: 'shadow-[0_0_20px_-8px_hsl(var(--crimson)/0.2)]',
    success: 'shadow-[0_0_20px_-8px_hsl(var(--success)/0.2)]',
    orange: 'shadow-[0_0_20px_-8px_hsl(30_90%_50%/0.2)]',
  };

  const iconBgMap = {
    gold: 'bg-primary/10 text-primary',
    silver: 'bg-muted text-foreground',
    crimson: 'bg-destructive/10 text-destructive',
    success: 'bg-success/10 text-success',
    orange: 'bg-orange-400/10 text-orange-400',
  };

  return (
    <div className={cn("card-forged p-5 hover:border-primary/20 transition-all duration-300", glowMap[accent], className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className={cn("text-2xl font-display font-bold mt-2 tracking-tight", colorMap[accent])}>{value}</p>
          {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn("w-9 h-9 rounded-md flex items-center justify-center shrink-0", iconBgMap[accent])}>
            <Icon size={16} />
          </div>
        )}
      </div>
    </div>
  );
}
