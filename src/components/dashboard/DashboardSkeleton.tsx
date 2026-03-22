import { Skeleton } from '@/components/ui/skeleton';

export function MetricSkeleton() {
  return (
    <div className="card-forged p-4 space-y-2">
      <Skeleton className="h-3 w-20 bg-muted/50" />
      <Skeleton className="h-6 w-28 bg-muted/50" />
      <Skeleton className="h-3 w-16 bg-muted/50" />
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="card-forged p-5 space-y-4">
      <Skeleton className="h-3 w-40 bg-muted/50" />
      <Skeleton className={`w-full bg-muted/50`} style={{ height }} />
    </div>
  );
}

export function ScheduleSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <MetricSkeleton key={i} />
      ))}
    </div>
  );
}

export function SectionError({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <div className="card-forged p-5 flex items-center justify-between">
      <p className="text-xs text-muted-foreground">Failed to load {label}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-primary hover:underline font-medium">
          Retry
        </button>
      )}
    </div>
  );
}
