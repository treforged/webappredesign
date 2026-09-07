import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowUpRight, Wallet } from 'lucide-react';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { buildNetWorthTrend, monthlyNetWorthChange, type TrendSnapshotRow } from '@/lib/net-worth-trend';
import { selectPointOnTouch } from '@/lib/chart-touch';

interface NWTooltipProps {
  active?: boolean;
  payload?: { payload: { month: string }; value: number }[];
}

function NWTooltip({ active, payload }: NWTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.month}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

export interface NetWorthTrendCardProps {
  snapshots: readonly TrendSnapshotRow[];
  snapshotsLoading: boolean;
  /** Today's net worth — the last point of the trend line, not a tile. */
  netWorth: number;
}

/**
 * Which way net worth is MOVING, and the recorded history behind that.
 *
 * The chart came up from the Accounts panel on 2026-08-20 (Tre: *"move the data
 * and net worth chart from the accounts section to the overview section. it
 * seems redundant and data is to spread out"*), leading with four tiles: Net
 * Worth, Total Assets, Total Liabilities and Monthly Change. Three of those four
 * now sit in the overview strip pinned above the panel switcher, permanently on
 * screen, so this card was showing the same figures a few hundred pixels below
 * them (Tre, 2026-08-22: *"condense and combine duplicate information"*). What
 * is left here is the part only this card has: the change since roughly a month
 * ago, and the line it came from. `netWorth` stays as an input because the trend
 * line's final point is today's figure — it is no longer drawn as a tile.
 *
 * ⚠️ The writer that feeds this chart, `useNetWorthSnapshotRecorder`, moved to
 * `Dashboard.tsx` in the same change and is mounted OUTSIDE the panel switch on
 * purpose. Net-worth recording has already died once by being left behind on a
 * surface nobody visits (2026-05-22). Never make it depend on this card being
 * on screen.
 *
 * Every empty state SAYS what is missing. A flat line at zero and a real zero
 * look the same, and only one of them is honest.
 */
export default function NetWorthTrendCard({
  snapshots,
  snapshotsLoading,
  netWorth,
}: NetWorthTrendCardProps) {
  const trend = useMemo(() => buildNetWorthTrend(snapshots, netWorth), [snapshots, netWorth]);
  const monthlyChange = useMemo(() => monthlyNetWorthChange(snapshots), [snapshots]);

  return (
    <div key="net_worth_trend" className="card-forged p-4 sm:p-5 space-y-3 sm:space-y-4">
      <div className="text-center sm:text-left">
        <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center justify-center sm:justify-start gap-1">
          <ArrowUpRight size={9} /> Monthly Change
        </p>
        <p className={`text-lg sm:text-2xl font-display font-bold mt-0.5 ${monthlyChange === null ? 'text-muted-foreground' : monthlyChange >= 0 ? 'text-success' : 'text-destructive'}`}>
          {monthlyChange !== null ? (monthlyChange >= 0 ? '+' : '') + formatCurrency(monthlyChange, false) : '—'}
        </p>
        <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
          {monthlyChange === null ? 'no history yet' : 'since roughly a month ago'}
        </p>
      </div>

      <div className="border-t border-border/40" />

      <div>
        <h3 className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {snapshots.length > 1 ? 'Net Worth History' : 'Current Net Worth'}
        </h3>
        {snapshotsLoading ? (
          <div className="h-[140px] flex items-end gap-2 px-2 pb-4 animate-pulse">
            {[40, 55, 48, 62, 70, 58, 75, 80].map((h, i) => (
              <div key={i} className="flex-1 bg-muted/40 rounded-sm" style={{ height: `${h}%` }} />
            ))}
          </div>
        ) : trend.length <= 1 ? (
          <div className="flex flex-col items-center justify-center h-[140px] text-center">
            <Wallet size={20} className="text-primary mb-2" />
            <p className="text-xs text-muted-foreground max-w-md">
              {snapshots.length > 0
                ? 'First snapshot saved — the trend line fills in over the coming weeks.'
                : 'The trend line appears once monthly snapshots are saved. See Forecast for projected trends.'}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trend} margin={{ left: 0, right: 8, top: 5, bottom: 4 }} onTouchStart={selectPointOnTouch}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 9, fill: 'hsl(240, 4%, 46%)' }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.ceil(trend.length / 6) - 1)}
                height={18}
              />
              <YAxis
                width={44}
                tick={{ fontSize: 9, fill: 'hsl(240, 4%, 46%)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatYAxisTick}
              />
              <Tooltip content={<NWTooltip />} />
              <Line
                dataKey="value"
                stroke="hsl(43, 56%, 52%)"
                strokeWidth={2}
                dot={{ r: 2.5, fill: 'hsl(43, 56%, 52%)', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
