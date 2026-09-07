import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { Landmark, type LucideIcon } from 'lucide-react';
import { formatYAxisTick } from '@/lib/calculations';
import { usePersistedState } from '@/hooks/usePersistedState';
import { buildLiabilityTrajectory, type LiabilityTrajectoryInput } from '@/lib/liability-trajectory';
// The tap fix now lives in one place because five other charts need it too - see chart-touch.ts
// for the Safari `Illegal constructor` crash a second copy would be a second chance to reintroduce.
import { selectPointOnTouch } from '@/lib/chart-touch';

/**
 * THE PAYOFF TRAJECTORY THE NON-CARD DEBT TABS NEVER HAD.
 *
 * The Credit Card Payoff tab has drawn one since the engine shipped, so a user with a student loan
 * or a mortgage got three numbers on a card and a customer with a credit card got a picture. This
 * is that picture for Mortgage, Student Loans and Other Debts, and every point in it comes from
 * the forecast engine's own balance arrays — the same shared references the Forecast month drawer
 * itemises and the "with extra payments" payoff line on each card reads. There is no second math
 * path here to drift out of agreement with them.
 *
 * The solid line is what the plan actually does (extras included); the dashed companion, drawn
 * only for a debt the ranked waterfall reaches, is what would happen at the target payment alone.
 * That is the same ordering the payoff stats use — Tre, 2026-08-27: the plan he set up leads, the
 * do-nothing case is the footnote.
 */

/** Same hues as the card engine's series, so the two tabs read as one system. */
const LIABILITY_COLORS = [
  'hsl(200, 70%, 55%)', 'hsl(280, 55%, 55%)', 'hsl(160, 55%, 45%)',
  'hsl(30, 70%, 50%)', 'hsl(340, 65%, 50%)', 'hsl(60, 55%, 50%)',
];

const YEAR_OPTIONS = ['1', '2', '3', '5'] as const;
type ChartYears = (typeof YEAR_OPTIONS)[number];

interface LiabilityTrajectoryChartProps {
  title: string;
  /** One entry per debt on the tab. Order decides colour, so it must be the on-screen order. */
  debts: LiabilityTrajectoryInput[];
  /** Where the chosen horizon is remembered. Per-tab, so switching tabs does not reset it. */
  storageKey: string;
  /** The tab's own icon, so the chart heading matches the tab that opened it. */
  icon?: LucideIcon;
}

export default function LiabilityTrajectoryChart({ title, debts, storageKey, icon: Icon = Landmark }: LiabilityTrajectoryChartProps) {
  const [chartYears, setChartYears] = usePersistedState<ChartYears>(storageKey, '5');

  const months = parseInt(chartYears, 10) * 12;

  const { rows, series } = useMemo(
    () => buildLiabilityTrajectory(debts, months, new Date()),
    [debts, months],
  );

  // Nothing worth drawing is drawn. An empty chart frame reads as a broken chart, and a debt with
  // no projection is already saying so on its own card.
  if (series.length === 0) return null;

  // Keep roughly 10 x-axis ticks regardless of horizon — the same rule the card chart uses.
  const tickInterval = Math.max(0, Math.ceil(months / 10) - 1);
  const hasScheduledLine = series.some(s => s.scheduledKey);

  return (
    <div className="card-forged p-3 sm:p-5 min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 min-w-0">
          <Icon size={12} className="shrink-0" /> <span className="truncate">{title}</span>
        </h3>
        <div className="flex gap-1.5 shrink-0">
          {YEAR_OPTIONS.map(y => (
            <button
              key={y}
              onClick={() => setChartYears(y)}
              aria-pressed={chartYears === y}
              className={`px-2.5 py-1 text-[10px] font-medium border btn-press whitespace-nowrap ${chartYears === y ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              {y}Y
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} onTouchStart={selectPointOnTouch}>
          <CartesianGrid stroke="hsl(0, 0%, 18%)" strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(240, 4%, 50%)', textAnchor: 'end' }} angle={-45} height={50} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(240, 4%, 50%)' }} tickFormatter={formatYAxisTick} />
          <RechartsTooltip
            formatter={(v, name) => [`$${Number(v).toLocaleString()}`, name]}
            labelStyle={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ fontSize: 13 }}
            contentStyle={{ background: 'hsl(240, 6%, 10%)', border: '1px solid hsl(240, 4%, 20%)', borderRadius: '4px', fontSize: 13, padding: '8px 12px' }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {/* flatMap, not map: recharts reads its own children to decide what to draw, so the
              lines have to arrive as one flat list rather than a list of pairs. */}
          {series.flatMap((s, i) => {
            const color = LIABILITY_COLORS[i % LIABILITY_COLORS.length];
            const lines = [
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={color} strokeWidth={2} dot={false} connectNulls={false} />,
            ];
            // Same colour, dashed: it is the same debt, told the other way. A second hue would
            // read as a second debt.
            if (s.scheduledKey) {
              lines.push(
                <Line key={s.scheduledKey} type="monotone" dataKey={s.scheduledKey} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} />,
              );
            }
            return lines;
          })}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground mt-2">
        Balance owed at the start of each month, from the same forecast projection the payoff dates
        above come from.
        {hasScheduledLine && ' The dashed line is the same debt at its target payment alone, without the extra money the plan sends it.'}
      </p>
    </div>
  );
}
