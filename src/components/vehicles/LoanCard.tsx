import { useState, useMemo } from 'react';
import { Edit2, Trash2, Car, TrendingDown, AlertTriangle, Undo2 } from 'lucide-react';
import ProgressBar from '@/components/shared/ProgressBar';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { buildAmortizationSchedule, type LumpSumPayment } from '@/lib/vehicle-loan-engine';
import { extraAwarePayoffMonthIndex } from '@/lib/extra-aware-payoff';
import { buildAutoExtraByTarget } from '@/lib/auto-extra-projection';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { CarFund } from '@/lib/types';
import LumpSumPanel from './LumpSumPanel';
import { selectPointOnTouch } from '@/lib/chart-touch';

/**
 * The loan-phase card: real terms, the amortization to payoff, and the payoff date the money he
 * has actually ranked will produce.
 *
 * Lifted VERBATIM out of `Vehicles.tsx` on 2026-08-27 when the vehicle-money panels moved to
 * /debt's Auto Loans tab. It still reads `extraAwarePayoffMonthIndex` — the one helper /debt's own
 * rows read — so the two cannot disagree about a payoff date.
 */

export default function LoanCard({ cf, onEdit, onDelete, onUndo, deleteConfirm, undoConfirm, onSaveLumpSums, liquidCash }:
  { cf: CarFund; onEdit: () => void; onDelete: () => void; onUndo: () => void; deleteConfirm: boolean; undoConfirm: boolean; onSaveLumpSums: (lumps: LumpSumPayment[]) => void; liquidCash?: number }) {
  const lumpSums: LumpSumPayment[] = useMemo(
    () => Array.isArray(cf.lump_sum_payments) ? cf.lump_sum_payments : [],
    [cf.lump_sum_payments]
  );

  const baseInput = useMemo(() => {
    if (!cf.payment_start_date || !cf.loan_start_date) return null;
    return {
      loanAmount: cf.loan_amount, apr: cf.expected_apr, termMonths: cf.loan_term_months,
      loanStartDate: cf.loan_start_date, paymentStartDate: cf.payment_start_date,
      interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
      actualMonthlyPayment: cf.actual_monthly_payment,
      // Resolved by useCarFunds from the linked account's live balance; null when unlinked.
      currentBalance: cf.current_balance_override ?? null,
    };
  }, [cf]);

  const proj = useMemo(() => baseInput ? buildAmortizationSchedule(baseInput) : null, [baseInput]);

  const projWithLumps = useMemo(() => {
    if (!baseInput || lumpSums.length === 0) return proj;
    return buildAmortizationSchedule({ ...baseInput, lumpSumPayments: lumpSums });
  }, [baseInput, lumpSums, proj]);

  const [showSchedule, setShowSchedule] = useState(false);

  // THE RANKED WATERFALL'S EXTRA PRINCIPAL, if this loan is receiving any. The card
  // above models only the fund's OWN lump sums, so without this a user who ranked
  // this loan under "Where the extra money goes" saw a payoff date that ignored the
  // money actually going to it. Same arrays the /debt tabs read, so the two surfaces
  // cannot disagree. Declared above the `if (!proj)` return because hooks cannot be
  // conditional.
  const { projections } = useCardProjectionContext();
  const autoExtraMonths = useMemo(
    () => buildAutoExtraByTarget(projections.data).get(cf.id) ?? null,
    [projections.data, cf.id],
  );
  const extraBalances = useMemo(
    () => projections.carLoanBalancesByFundId?.get(cf.id) ?? null,
    [projections.carLoanBalancesByFundId, cf.id],
  );
  // Gated on money actually ARRIVING, not on the loan being rankable: a ranked target
  // that the waterfall never reaches would otherwise get a line promising nothing.
  const receivesAutoExtra = !!autoExtraMonths && autoExtraMonths.some(v => v > 0);
  const nextAutoExtra = autoExtraMonths?.find(v => v > 0) ?? 0;
  // The date the dashed line reaches zero. Without this the card shows a chart
  // hitting zero in early 2029 next to a "Payoff Date" stat reading Jun 2030, and
  // a user is left to decide which of the two the app means. balances[i] is the
  // balance month i OPENS at, so the final payment lands in month firstZero - 1.
  /**
   * The same ranked extras, keyed by CALENDAR month, for the amortization schedule.
   *
   * ⚠️ THE JOIN IS A DATE, NOT A POSITION, and it is the same join the chart below already makes.
   * `autoExtraMonths` is indexed from THIS month; the schedule's rows are dated from
   * `payment_start_date`, which for a loan already running is in the past. Lining them up by index
   * would credit a payment made next year to a row from last year.
   */
  const autoExtraByMonth = useMemo(() => {
    if (!autoExtraMonths) return undefined;
    const out: Record<string, number> = {};
    const n = new Date();
    autoExtraMonths.forEach((amount, i) => {
      if (!(amount > 0)) return;
      const d = new Date(n.getFullYear(), n.getMonth() + i, 1);
      out[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = amount;
    });
    return Object.keys(out).length > 0 ? out : undefined;
  }, [autoExtraMonths]);

  /**
   * The schedule as the money ACTUALLY goes: the fund's own lump sums AND the ranked extras.
   *
   * Tre, 2026-08-26: "for auto loan, the amortization schedule should be updated with the extra
   * payments." The chart gained its extra-aware line in `6e676601`; the table underneath was still
   * built from lump sums alone, so a user who ranked this loan read a table that contradicted the
   * line directly above it.
   */
  const projWithExtras = useMemo(() => {
    if (!baseInput || !autoExtraByMonth) return null;
    return buildAmortizationSchedule({
      ...baseInput,
      ...(lumpSums.length > 0 ? { lumpSumPayments: lumpSums } : {}),
      autoExtraByMonth,
    });
  }, [baseInput, lumpSums, autoExtraByMonth]);

  // ⚠️ IT USED TO SUBTRACT ONE UNCONDITIONALLY, and on Tre's own C5 that printed "Jul 2029" above
  // a schedule whose final payment lands in Aug - while the engine sent $2,343 of extra principal
  // that August, into a loan the label claimed was already gone. The array carries two conventions;
  // `extraAwarePayoffMonthIndex` is now the one place that reads them, shared with /debt.
  const autoPayoffLabel = useMemo(() => {
    if (!receivesAutoExtra) return null;
    const idx = extraAwarePayoffMonthIndex(extraBalances, autoExtraMonths);
    if (idx == null) return null;
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() + idx, 1)
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }, [receivesAutoExtra, extraBalances, autoExtraMonths]);

  const handleAddLump = (entries: LumpSumPayment[]) => onSaveLumpSums([...lumpSums, ...entries]);
  const handleRemoveLump = (ids: string[]) => onSaveLumpSums(lumpSums.filter(l => !ids.includes(l.id)));
  const handleReplaceLumps = (oldIds: string[], entries: { date: string; amount: number }[]) =>
    onSaveLumpSums([
      ...lumpSums.filter(l => !oldIds.includes(l.id)),
      ...entries.map(e => ({ id: crypto.randomUUID(), date: e.date, amount: e.amount })),
    ]);

  if (!proj) return null;

  // projWithLumps reflects extra payments - use it for everything the user actually sees.
  // proj (base, no lumps) is kept only for the LumpSumPanel's "impact of extra payments" comparison below.
  const effective = projWithLumps ?? proj;

  const pct = cf.loan_amount > 0 ? ((cf.loan_amount - effective.remainingBalance) / cf.loan_amount) * 100 : 0;

  // The engine's array is indexed by FORECAST month (index 0 is the current month)
  // while the schedule is indexed by payment number, so the two are joined on the
  // calendar month rather than on position.
  const nowBaseMonth = (() => { const n = new Date(); return n.getFullYear() * 12 + n.getMonth(); })();
  const chartData = effective.schedule.map(r => {
    const d = new Date(r.date + 'T00:00:00');
    const idx = (d.getFullYear() * 12 + d.getMonth()) - nowBaseMonth;
    // undefined, never 0: recharts skips an undefined point but would draw a line
    // down to zero for a 0, inventing a paid-off loan past the projection horizon.
    // ⚠️ ONE CHART, ONE CONVENTION. The solid line is `r.endBalance` — the balance at the END of
    // the month. The engine's array is the balance a month OPENS at (reduced from index i
    // INCLUSIVE by that month's extra), so plotting `extraBalances[idx]` beside it drew the two
    // lines a month out of step: measured 2026-08-27 on a C5 fixture, Oct 2026 solid $15,674.80
    // against dashed $15,962.28 — the gap is exactly that month's principal, and it put the
    // ACCELERATED line ABOVE the un-accelerated one. The extras line looked worse than doing
    // nothing.
    //
    // End of month i is what month i+1 opens at, plus back the extra that month i+1 has already
    // had subtracted from it — because the reducer takes each month's extra off its own entry.
    const nextIdx = idx + 1;
    const autoBalance = receivesAutoExtra && extraBalances && idx >= 0 && nextIdx < extraBalances.length
      ? Math.max(0, extraBalances[nextIdx] + (autoExtraMonths?.[nextIdx] ?? 0))
      : undefined;
    return { month: r.month, date: r.date, balance: r.endBalance, autoBalance };
  });

  // One tick per calendar year (first chart point in each year) so the x-axis reads in years, not raw payment numbers.
  const yearTicks: string[] = [];
  const seenYears = new Set<string>();
  chartData.forEach(d => {
    const year = d.date.slice(0, 4);
    if (!seenYears.has(year)) { seenYears.add(year); yearTicks.push(d.date); }
  });

  const payoffDateFmt = new Date(effective.payoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  return (
    <div className="card-forged p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Car size={16} className="text-success shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{cf.vehicle_name}</h3>
            <p className="text-xs text-muted-foreground">{cf.expected_apr}% APR · {cf.loan_term_months} mo</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className="text-[10px] bg-success/15 text-success px-1.5 py-0.5 font-medium" style={{ borderRadius: 'var(--radius)' }}>Active Loan</span>
          <button
            onClick={onUndo}
            className={`icon-btn text-sm flex items-center gap-1 px-2 ${undoConfirm ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
            title={undoConfirm ? 'Click again to confirm undo' : 'Undo purchase - revert to saving phase'}
          >
            <Undo2 size={16} />
            {undoConfirm && <span className="text-xs font-medium">Confirm?</span>}
          </button>
          <button onClick={onEdit} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
          <button onClick={onDelete} className={`icon-btn ${deleteConfirm ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
        </div>
      </div>

      {effective.isDeferredInterest && effective.monthsElapsed === 0 && (
        <div className="flex items-center gap-2 p-2 bg-primary/10 border border-primary/20 text-xs text-primary" style={{ borderRadius: 'var(--radius)' }}>
          <AlertTriangle size={12} />
          <span>Deferred interest until {new Date((cf.interest_start_date ?? '') + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
        </div>
      )}

      {effective.isNegativeAmortization && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 border border-destructive/20 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
          <AlertTriangle size={12} />
          <span>Payment is below interest-only - balance is growing. Consider raising to {formatCurrency(effective.scheduledPayment, false)}/mo.</span>
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Loan payoff progress</span>
          <span className="font-medium">{formatCurrency(effective.remainingBalance, false)} remaining</span>
        </div>
        <ProgressBar value={Math.min(pct, 100)} max={100} />
        <p className="text-[10px] text-muted-foreground mt-1">{Math.round(pct)}% paid · {effective.monthsElapsed} of {effective.schedule.length} payments made</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Monthly Payment</p>
          <p className="text-xs font-semibold text-primary">{formatCurrency(effective.effectivePayment, false)}</p>
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          {/* ⚠️ THE EXTRA-AWARE DATE LEADS (Tre, 2026-08-27: "the payoff date with extra payments
              should be the default big number shown. the original without should be small below
              it"). This stat used to read Jun 2030 while the chart beneath it drew a line hitting
              zero in 2029 — the plan he actually set up was the small print on his own card. */}
          <p className="text-[10px] text-muted-foreground">Payoff Date</p>
          {autoPayoffLabel ? (
            <>
              <p className="text-xs font-semibold text-primary">{autoPayoffLabel}</p>
              <p className="text-[10px] text-muted-foreground">{payoffDateFmt} without extra</p>
            </>
          ) : (
            <p className="text-xs font-semibold">{payoffDateFmt}</p>
          )}
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Interest Paid</p>
          <p className="text-xs font-semibold text-destructive">{formatCurrency(effective.interestPaidToDate, false)}</p>
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Total Interest</p>
          <p className="text-xs font-semibold text-muted-foreground">{formatCurrency(effective.totalInterest, false)}</p>
        </div>
      </div>

      {chartData.length > 1 && (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ left: 0, right: 12, top: 8, bottom: 28 }} onTouchStart={selectPointOnTouch}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,15%)" />
            {yearTicks.slice(1).map(t => (
              <ReferenceLine key={t} x={t} stroke="hsl(0,0%,22%)" strokeDasharray="2 4" />
            ))}
            <XAxis
              dataKey="date"
              ticks={yearTicks}
              tickFormatter={(d: string) => d.slice(0, 4)}
              tick={{ fontSize: 12, fill: 'hsl(0,0%,100%)' }}
              axisLine={false}
              tickLine={false}
              label={{ value: 'Year', position: 'insideBottom', offset: -8, fontSize: 12, fill: 'hsl(0,0%,100%)' }}
            />
            <YAxis tick={{ fontSize: 12, fill: 'hsl(0,0%,100%)' }} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} width={48} />
            <Tooltip
              contentStyle={{ background: 'hsl(0,0%,8%)', border: '1px solid hsl(0,0%,15%)', borderRadius: 'var(--radius)', fontSize: 12 }}
              labelStyle={{ color: 'hsl(0,0%,100%)' }}
              itemStyle={{ color: 'hsl(0,0%,100%)' }}
              labelFormatter={(d) => new Date(String(d) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              formatter={(v, n) => [formatCurrency(Number(v), false), n === 'With auto extra' ? 'With auto extra' : 'Remaining']}
            />
            <Line dataKey="balance" name="Remaining" stroke="hsl(43,56%,52%)" strokeWidth={2} dot={false} />
            {receivesAutoExtra && (
              <Line
                type="monotone"
                dataKey="autoBalance"
                name="With auto extra"
                stroke="hsl(var(--primary))"
                strokeDasharray="4 3"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {receivesAutoExtra && (
        <p className="text-[10px] text-muted-foreground">
          The dashed line adds {formatCurrency(nextAutoExtra, false)}/mo of extra principal, from
          left-over cash after the bills{autoPayoffLabel ? `, paying this loan off by ${autoPayoffLabel}` : ''}.
          You set that order under "Where the extra money goes".
        </p>
      )}

      <LumpSumPanel
        autoExtraOn={cf.auto_extra === true}
        schedule={projWithLumps?.schedule ?? proj.schedule}
        lumpSums={lumpSums}
        baseTotalInterest={proj.totalInterest}
        withLumpsTotalInterest={projWithLumps?.totalInterest ?? proj.totalInterest}
        basePayoffDate={proj.payoffDate}
        withLumpsPayoffDate={projWithLumps?.payoffDate ?? proj.payoffDate}
        onAdd={handleAddLump}
        onRemove={handleRemoveLump}
        onReplace={handleReplaceLumps}
        liquidCash={liquidCash}
      />

      <button
        onClick={() => setShowSchedule(v => !v)}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        {showSchedule ? 'Hide' : 'Show'} full amortization schedule
      </button>

      {showSchedule && (() => {
        // The schedule the extras are in, when there are any. `scheduled` is what the table draws.
        const shown = projWithExtras ?? effective;
        return (
          <div className="space-y-1.5">
            {projWithExtras && (
              // Never let a number move without saying why. The rows below are shorter and the
              // balances fall faster than the loan's own terms, and without this line that reads
              // as the app getting the arithmetic wrong.
              <p className="text-[10px] text-muted-foreground">
                Includes the automatic extra payments your ranked list sends this loan, so the
                balances below are what you would actually owe.
              </p>
            )}
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-muted-foreground">
                    <th className="text-left py-1 px-1">#</th>
                    <th className="text-left py-1 px-1">Month</th>
                    <th className="text-right py-1 px-1">Payment</th>
                    {projWithExtras && <th className="text-right py-1 px-1">Auto extra</th>}
                    <th className="text-right py-1 px-1">Principal</th>
                    <th className="text-right py-1 px-1">Interest</th>
                    <th className="text-right py-1 px-1">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.schedule.map(r => (
                    <tr key={r.month} className={`border-t border-border/20 ${r.month === shown.monthsElapsed ? 'bg-primary/5' : ''}`}>
                      <td className="py-1 px-1 text-muted-foreground">{r.month}</td>
                      <td className="py-1 px-1 text-muted-foreground">{new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                      <td className="py-1 px-1 text-right">{formatCurrency(r.payment, false)}</td>
                      {projWithExtras && (
                        // A dash, not $0: a month the waterfall did not reach and a month it sent
                        // nothing are the same thing, and printing $0 down a whole column reads as
                        // a broken feature rather than as "not this month".
                        <td className="py-1 px-1 text-right text-primary">
                          {r.autoExtra > 0 ? formatCurrency(r.autoExtra, false) : '—'}
                        </td>
                      )}
                      <td className="py-1 px-1 text-right text-success">{formatCurrency(r.principal, false)}</td>
                      <td className="py-1 px-1 text-right text-destructive">{r.deferred ? '—' : formatCurrency(r.interest, false)}</td>
                      <td className="py-1 px-1 text-right font-medium">{formatCurrency(r.endBalance, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
