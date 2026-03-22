import { cn } from '@/lib/utils';

type ProgressBarProps = {
  value: number;
  max: number;
  className?: string;
  showLabel?: boolean;
  thick?: boolean;
  color?: 'gold' | 'silver' | 'success';
};

export default function ProgressBar({ value, max, className, showLabel = false, thick = false }: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div className={cn("w-full", className)}>
      <div className={cn(
        "w-full bg-secondary overflow-hidden",
        thick ? "h-3" : "h-1.5"
      )} style={{ borderRadius: 'var(--radius)' }}>
        <div
          className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, borderRadius: 'var(--radius)' }}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-muted-foreground">{Math.round(pct)}% complete</span>
        </div>
      )}
    </div>
  );
}
