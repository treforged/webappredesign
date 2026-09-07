import { useState, useMemo, useCallback, useEffect } from 'react';
import SurfaceGuide from '@/components/shared/SurfaceGuide';
import { Link } from 'react-router';
import { ForecastSkeleton } from '@/components/shared/PageSkeleton';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { ordinal } from '@/lib/ordinal';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useIsViewportBelow } from '@/hooks/use-mobile';
import { useDebts, useSavingsGoals, useCarFunds, useAccounts, useSubscriptions, useBudgetItems, useProfile, useRecurringRules, useTransactions, usePaymentPlans } from '@/hooks/useSupabaseData';
import { getCalendarYearMonthRange, getCalendarYearLabel } from '@/lib/scheduling';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { getPaycheckGross } from '@/lib/pay-schedule';
import { projectMilestonesWithGrowth, monthlyContribSplitForAccount, incomeMultipliersByMonth } from '@/lib/retirement-projection';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Bar, ComposedChart, ReferenceLine,
} from 'recharts';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { MOTION_DURATION, EASE_OUT } from '@/lib/motion';
import { Settings2, List, BarChart3, TrendingUp, Info, X, FileDown, Crown, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { exportForecastPdf, type ForecastRow } from '@/lib/exportPdf';
import { exportForecastCsv } from '@/lib/exportCsv';
import { buildForecastMonthDetail, getAbsoluteMonthIndex } from '@/lib/forecast-export';
import { cumulativeSurplusesByCard } from '@/lib/step3-display';
import { useForecastProjections } from '@/hooks/useForecastProjections';
import { scanForDuplicateTransactions } from '@/lib/duplicate-transaction-detection';
import { useDismissedDuplicates } from '@/hooks/useDismissedDuplicates';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import DuplicateTransactionWarning from '@/components/shared/DuplicateTransactionWarning';
import CalcDrawer, { type CalcDrawerLine } from '@/components/shared/CalcDrawer';
import ForecastHero from '@/components/forecast/ForecastHero';
import ForecastAssumptionsPanel from '@/components/forecast/ForecastAssumptionsPanel';
import MonthlyBreakdownTable from '@/components/forecast/MonthlyBreakdownTable';
import { isManualCashFloor } from '@/lib/cash-floor';
import ReceiptsDisclosure from '@/components/forecast/ReceiptsDisclosure';
import { toLocalDateStr } from '@/lib/scheduling';
import { selectPointOnTouch } from '@/lib/chart-touch';

const RETIRE_TYPES_FORECAST = ['401k', 'roth_ira', 'ira', 'brokerage', 'hsa'];

/**
 * How the forecast series draw themselves in.
 *
 * 🔬 **Checked rather than assumed, and it changed the plan.** recharts 3.10
 * already draws these lines, and — via its `isAnimationActive: "auto"` default —
 * it already reads `prefers-reduced-motion` itself and skips the draw when the
 * user has asked for that (`recharts/util/usePrefersReducedMotion`). So there
 * was no accessibility gap here to close, and **`isAnimationActive` is
 * deliberately left unset**: pinning it to `true` would have hardcoded past the
 * library's own reduced-motion handling and shipped exactly the regression this
 * work exists to avoid.
 *
 * What is set is the timing, so the chart draws on the same clock as everything
 * else in `lib/motion.ts` instead of recharts' 1500ms default, which reads as
 * the page still loading.
 */
const CHART_DRAW = {
  animationDuration: MOTION_DURATION.draw * 1000,
  animationEasing: 'ease-out',
} as const;

/**
 * Printed under every calc drawer on this page — the same caveat the page-local drawer
 * carried before it was replaced by the shared component.
 */
const CALC_FOOTNOTE = 'A negative monthly cash flow can be acceptable if prior saved cash covers the difference and ending cash stays above the required floor. One-time purchases (e.g. car down payment) reduce available cash and may auto-adjust debt recommendations.';

interface ForecastTooltipProps {
  active?: boolean;
  payload?: { dataKey: string; color: string; name: string; value: number }[];
  label?: string;
}

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card-forged p-2 sm:p-3 text-xs space-y-1 max-w-[140px] sm:max-w-xs">
      <p className="font-display font-bold text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-2 sm:gap-3">
          <span className="flex items-center gap-1 truncate"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />{p.name}</span>
          <span className="font-display font-bold shrink-0">{formatCurrency(p.value, false)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Forecast() {
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { data: debts, loading: debtsLoading } = useDebts();
  const { data: goals, loading: goalsLoading } = useSavingsGoals();
  const { data: carFunds, loading: carFundsLoading } = useCarFunds();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: subs, loading: subsLoading } = useSubscriptions();
  const { data: budgetItems, loading: budgetItemsLoading } = useBudgetItems();
  const { data: profile, loading: profileLoading } = useProfile();
  const { data: rules, loading: rulesLoading } = useRecurringRules();
  const { data: transactions, remove: removeTransaction, loading: transactionsLoading } = useTransactions();
  const { data: paymentPlans, loading: paymentPlansLoading } = usePaymentPlans();

  // A 60-month projection is a single number built from ALL of these. Rendering
  // it while any input is still empty does not show a partial forecast — it
  // shows a confident, wrong one, and the chart animates from that wrong shape
  // to the right one. Every source or none.
  const forecastInputsLoading =
    accountsLoading || debtsLoading || goalsLoading || carFundsLoading || subsLoading ||
    budgetItemsLoading || profileLoading || rulesLoading || transactionsLoading ||
    paymentPlansLoading;

  const {
    cardProjection: cardProjectionData,
    assumptions,
    setAssumptions,
    pauseSavings,
    debtStrategy,
    payConfig,
    cashFloor,
    forecastFundingAccountId,
    syncCutoffDate,
    scheduledEvents,
    debtPayoffOptions,
  } = useCardProjectionContext();
  // Assumptions are settings, not the story, so the panel starts closed (DIRECTION.md: the
  // page leads with one number). Both disclosures persist through the same idiom the rest of
  // this page's view state already uses, so a reader who opens them keeps them open.
  const [showAssumptions, setShowAssumptions] = usePersistedState('tre:forecast:showAssumptions', false);
  // PHONE ONLY (Tre, 2026-08-27: "make the top controls of forecast 'Line / Detail / Assumptions /
  // PDF / CSV' collapsable. they take up a lot of space on mobile screens"). Five full-width
  // buttons stacked one per row pushed the chart most of a screen down. Closed by default and
  // remembered, so a user who wants them open pays the taps once. From `sm` up the row is
  // unchanged and this state is not consulted — the controls are never hidden on a desktop.
  const [showControls, setShowControls] = usePersistedState('tre:forecast:showControls', false);
  const [showReceipts, setShowReceipts] = usePersistedState('tre:forecast:showReceipts', false);
  const [assumptionsTutorialSeen, setAssumptionsTutorialSeen] = usePersistedState('tre:forecast:assumptionsTutorialSeen', false);
  const [filterYear, setFilterYear] = usePersistedState<'all' | '1' | '2' | '3' | '4' | '5'>('tre:forecast:filterYear', 'all');
  const [chartMode, setChartMode] = usePersistedState<'combo' | 'line'>('tre:forecast:chartMode', 'combo');
  const [viewMode, setViewMode] = usePersistedState<'monthly' | 'detailed'>('tre:forecast:viewMode', 'monthly');
  const [hiddenSeries, setHiddenSeries] = usePersistedState<string[]>('tre:forecast:hidden', []);
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: CalcDrawerLine[] } | null>(null);
  const [floorCalcDrawer, setFloorCalcDrawer] = useState<{ title: string; lines: CalcDrawerLine[] } | null>(null);

  const toggleSeries = useCallback((key: string) => {
    setHiddenSeries((prev: string[]) => {
      const next = prev.includes(key) ? prev.filter((k: string) => k !== key) : [...prev, key];
      return next;
    });
  }, [setHiddenSeries]);


  const {
    projections,
    monthlyAggregates,
    debtPaymentsByMonth,
    debtBalancesByMonth,
    oneTimeByMonth,
    ccOneTimeByMonth,
    ccScheduledByMonth,
    currentMonthRecommendedDebt,
    forecastMonthEvents,
    planExpensesByMonth,
    annualFederalWithheldFromBudget,
  } = useForecastProjections();

  // A month charged twice by a hand-entered copy of a generated payment is a forecast bug the
  // forecast itself cannot see — it just reports the lower cash and, on Tre's data, trips the
  // "Cash below safe minimum" milestone in Sep 2026. Same scan, same dismissals, as /transactions.
  const { dismissed: dismissedDuplicates, dismiss: dismissDuplicate } = useDismissedDuplicates();
  const duplicateCollisions = useMemo(() => scanForDuplicateTransactions({
    transactions,
    rules,
    accounts,
    paymentPlans,
    carFunds: carFunds ?? [],
    dismissed: dismissedDuplicates,
  }), [transactions, rules, accounts, paymentPlans, carFunds, dismissedDuplicates]);

  const duplicatesByMonth = useMemo(() => {
    const map = new Map<string, typeof duplicateCollisions>();
    for (const c of duplicateCollisions) {
      const list = map.get(c.monthKey);
      if (list) list.push(c); else map.set(c.monthKey, [c]);
    }
    return map;
  }, [duplicateCollisions]);

  const handleDeleteDuplicate = useCallback(async (manualId: string) => {
    try {
      await removeTransaction.mutateAsync(manualId);
      toast.success('Manual row deleted — the generated payment still stands.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete that transaction.');
    }
  }, [removeTransaction]);

  // Month-0 floor exactly as the ENGINE derived it (getAugmentedMinSafeCash: the pre-paycheck base
  // bills PLUS car loans, vehicle insurance and credit-card minimums). The "cash floor raised to"
  // banner below used to re-derive its own total from getPrePaycheckNextMonthBills alone, so it
  // announced the un-augmented base while the Cash Floor popup on the same page — reading
  // row.monthMinSafe — showed the real, higher floor. Session 79's lesson: a UI showing a total it
  // did not derive hides whatever it failed to model. Read the engine's row instead.
  const m0Floor = projections.data[0];

  const filteredData = useMemo(() => {
    if (filterYear === 'all') return projections.data;
    const yr = parseInt(filterYear);
    const [start, end] = getCalendarYearMonthRange(yr);
    return projections.data.slice(start, end);
  }, [projections.data, filterYear]);

  // Detailed per-month money-flow + account-balance breakdown for the PDF/CSV exports, mirroring
  // the Month Breakdown drawer below exactly (same source fields/formulas — see forecast-export.ts).
  // Cumulative PASS-3 surplus redirected to each card — shared display adjustment (step3-display)
  // used by the month popup so per-card balances match Debt Payoff's accordion and the export.
  const step3CumSurplus = useMemo(
    () => cumulativeSurplusesByCard(cardProjectionData?.perCardPaymentsScaled),
    [cardProjectionData],
  );

  const exportDetails = useMemo(() => {
    const calendarYearStart = filterYear === 'all' ? 0 : getCalendarYearMonthRange(parseInt(filterYear, 10))[0];
    return filteredData.map((r, i) => {
      const absoluteI = getAbsoluteMonthIndex(i, filterYear, calendarYearStart);
      return buildForecastMonthDetail(r, absoluteI, cardProjectionData as unknown as Parameters<typeof buildForecastMonthDetail>[2]);
    });
  }, [filteredData, filterYear, cardProjectionData]);

  const detailedEvents = useMemo(() => {
    if (filterYear === 'all') return scheduledEvents.slice(0, 100);
    const yr = parseInt(filterYear);
    const now = new Date();
    const [startIdx, endIdx] = getCalendarYearMonthRange(yr, now);
    const start = new Date(now.getFullYear(), now.getMonth() + startIdx, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + endIdx, 0);
    const startStr = toLocalDateStr(start);
    const endStr = toLocalDateStr(end);
    return scheduledEvents.filter(e => e.date >= startStr && e.date <= endStr).slice(0, 100);
  }, [scheduledEvents, filterYear]);

  const gridStroke = 'hsl(0, 0%, 18%)';
  const tickStyle = { fontSize: 10, fill: 'hsl(240, 4%, 50%)' };
  const isMobile = useIsViewportBelow(640);
  const xInterval = filterYear === 'all' ? (isMobile ? 5 : 4) : (isMobile ? 2 : 1);

  // Helper to check visibility — a series is visible if NOT in hiddenSeries
  const isVisible = (key: string) => !hiddenSeries.includes(key);

  const retirementProjections = useMemo(() => {
    const prof = profile;
    const retireAccounts = accounts.filter((a) => a.active && RETIRE_TYPES_FORECAST.includes(a.account_type));
    if (retireAccounts.length === 0) return [];

    const paycheckGross = getPaycheckGross(payConfig);
    const paychecksPerYear = payConfig?.frequency === 'biweekly' ? 26 : payConfig?.frequency === 'monthly' ? 12 : 52;

    const deductions: { value: number; mode: 'flat' | 'pct'; accountId?: string }[] =
      Array.isArray(prof?.paycheck_deductions) ? (prof.paycheck_deductions as typeof deductions) : [];

    const retireIds = new Set(retireAccounts.map((a) => a.id as string));
    const today = new Date(syncCutoffDate + 'T00:00:00');
    const transferContribByAccount: Record<string, number> = {};
    for (const r of (rules || [])) {
      if (!r.active) continue;
      if (r.rule_type !== 'transfer' && r.rule_type !== 'investment') continue;
      // Only count rules that are currently in effect — matches the main forecast loop's
      // start_date/end_date handling so this panel doesn't include not-yet-started or
      // already-ended transfers in its forward-looking milestones.
      if (r.start_date && new Date(r.start_date + 'T00:00:00') > today) continue;
      if (r.end_date && new Date(r.end_date + 'T00:00:00') < today) continue;
      const destId = r.deposit_account as string | undefined;
      if (!destId || !retireIds.has(destId)) continue;
      const amt = Number(r.amount);
      const annualCount = r.frequency === 'weekly' ? 52 : r.frequency === 'biweekly' ? 26 : r.frequency === 'yearly' ? 1 : 12;
      const monthly = amt * annualCount / 12;
      transferContribByAccount[destId] = (transferContribByAccount[destId] || 0) + monthly;
    }

    // Pct-mode deduction contributions scale with raises/promotions exactly as the
    // engine scales them; flat deductions and transfer rules stay flat. Without this
    // split the panel froze today's contribution flat for 20 years while the chart
    // on the same page grew it.
    const annualBaseSalary = (payConfig?.weeklyGross ?? 0) * 52;
    const multipliers = incomeMultipliersByMonth(assumptions, annualBaseSalary, today, 240);

    return retireAccounts.map((a) => {
      // Same fallback as the chart (forecast-engine's weightedRetireApy), so an
      // account with no apy_rate grows at one rate in both. A hardcoded default
      // here disagreed with the chart on the same page for every user whose
      // investment-growth assumption was not exactly 7%.
      const apyRate = a.apy_rate != null ? Number(a.apy_rate) : assumptions.investmentGrowth;
      const fromDeductions = monthlyContribSplitForAccount(deductions, a.id, paycheckGross, paychecksPerYear);
      const fromTransfers = transferContribByAccount[a.id] || 0;
      const flatContrib = fromDeductions.flat + fromTransfers;
      const monthlyContrib = flatContrib + fromDeductions.pct;
      const milestones = projectMilestonesWithGrowth(Number(a.balance), flatContrib, fromDeductions.pct, apyRate, multipliers);
      return { account: a, apyRate, monthlyContrib, milestones };
    });
  }, [accounts, profile, rules, payConfig, syncCutoffDate, assumptions]);

  const freePreview = !isPremium && !isDemo;
  const displayData = freePreview ? filteredData.slice(0, 12) : filteredData;

  if (forecastInputsLoading) return <ForecastSkeleton />;

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden">
      {!isDemo && !assumptionsTutorialSeen && (
        <div
          className="modal-overlay z-60"
          style={{ background: 'rgba(0,0,0,0.85)', paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))', paddingLeft: '1rem', paddingRight: '1rem' }}
          onClick={() => setAssumptionsTutorialSeen(true)}
        >
          <div className="card-forged p-5 sm:p-6 w-full max-w-md space-y-4 overflow-y-auto popup-scroll" style={{ maxHeight: '100%' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-semibold text-sm flex items-center gap-2"><Settings2 size={14} className="text-primary shrink-0" /> Forecast Assumptions</h2>
              <button onClick={() => setAssumptionsTutorialSeen(true)} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={16} /></button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              These inputs directly drive every number in the 60-month projection. Changing them instantly re-runs the full forecast.
            </p>
            <div className="space-y-2">
              {[
                { label: 'Promotions', desc: 'Schedule a one-time jump to a new annual salary on a specific date. Raises and % bonuses keep applying to the new amount afterward.' },
                { label: 'Income Growth %', desc: 'Annual raise applied to your take-home. 3% means your income increases 3% each year.' },
                { label: 'Investment Growth %', desc: 'Annual return applied to investment account balances in the projection.' },
                { label: 'Savings Interest %', desc: 'Annual APY applied to savings and HYSA account balances.' },
                { label: 'Bonus Income $', desc: 'A one-time annual bonus added to total income, spread evenly across all 12 months.' },
                { label: 'Tax Override %', desc: 'Overrides the default tax rate used to estimate your take-home. Leave at 0 to use your profile rate.' },
              ].map(a => (
                <div key={a.label} className="flex gap-2.5 py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-primary font-bold text-xs shrink-0 mt-0.5">→</span>
                  <div><span className="text-xs font-medium text-foreground">{a.label}: </span><span className="text-xs text-muted-foreground">{a.desc}</span></div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Access assumptions anytime with the <span className="font-medium text-foreground">Assumptions</span> button in the toolbar.</p>
            <button
              onClick={() => setAssumptionsTutorialSeen(true)}
              className="w-full bg-primary text-primary-foreground py-2 text-sm font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* ⚠️ THE GUIDE BELONGS ON THE TITLE ROW (Tre, 2026-08-19), which is where every other
            surface already puts it. It had been sitting at the end of the action row, so on this
            page alone its position was a function of how many buttons happened to be premium-gated
            — the same drift #112 fixed everywhere else and missed here. */}
        <div className="flex items-start justify-between gap-2 sm:gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Forecast</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 truncate">60-month projections driven by live data</p>
          </div>
          <div className="shrink-0">
            <SurfaceGuide surface="forecast" />
          </div>
        </div>
        <div className="w-full sm:w-auto">
          {/* The disclosure itself is `sm:hidden`: it exists only where the controls cost a screen.
              It is a DISCLOSURE, not a hide — every control below is still reachable, one tap in,
              and the count says how many are waiting so an empty-looking toolbar is never a
              mystery. */}
          <button
            onClick={() => setShowControls(!showControls)}
            aria-expanded={showControls}
            aria-controls="forecast-controls"
            className="sm:hidden w-full flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 py-1.5 text-xs font-medium btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <SlidersHorizontal size={12} /> Controls
            {showControls ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <div
            id="forecast-controls"
            className={`${showControls ? 'grid' : 'hidden'} grid-cols-2 gap-2 mt-2 sm:mt-0 sm:flex sm:items-center`}
          >
          <button onClick={() => setChartMode(chartMode === 'combo' ? 'line' : 'combo')}
            className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            <TrendingUp size={12} /> {chartMode === 'combo' ? 'Line' : 'Bars'}
          </button>
          <button onClick={() => setViewMode(viewMode === 'monthly' ? 'detailed' : 'monthly')}
            className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            {viewMode === 'monthly' ? <List size={12} /> : <BarChart3 size={12} />} {viewMode === 'monthly' ? 'Detail' : 'Summary'}
          </button>
          <button onClick={() => setShowAssumptions(!showAssumptions)} className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            <Settings2 size={12} /> Assumptions
          </button>
          {(isPremium || isDemo) ? (
            <>
              <button
                onClick={async () => {
                  const label = filterYear === 'all' ? 'All 60 Months' : String(getCalendarYearLabel(parseInt(filterYear, 10)));
                  await exportForecastPdf(filteredData.map((r) => ({
                    month: r.month,
                    takeHome: r.takeHome ?? 0,
                    totalExpenses: r.totalExpenses ?? 0,
                    debtPayment: r.debtPayment ?? 0,
                    liquidCash: r.liquidCash ?? 0,
                    endingCash: r.endingCash ?? 0,
                    netWorth: r.netWorth ?? 0,
                    debtBalance: r.debtBalance ?? 0,
                    savingsBalance: r.savingsBalance ?? 0,
                  } as ForecastRow)), label, exportDetails);
                }}
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> PDF
              </button>
              <button
                onClick={async () => {
                  await exportForecastCsv(filteredData.map((r): ForecastRow => ({
                    month: r.month,
                    takeHome: r.takeHome ?? 0,
                    totalExpenses: r.totalExpenses ?? 0,
                    debtPayment: r.debtPayment ?? 0,
                    liquidCash: r.liquidCash ?? 0,
                    endingCash: r.endingCash ?? 0,
                    netWorth: r.netWorth ?? 0,
                    debtBalance: r.debtBalance ?? 0,
                    savingsBalance: r.savingsBalance ?? 0,
                  })), exportDetails);
                }}
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> CSV
              </button>
            </>
          ) : (
            <>
              <Link
                to="/premium"
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 border border-primary/30 text-primary/70 px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press hover:bg-primary/5 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> PDF
              </Link>
              <Link
                to="/premium"
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 border border-primary/30 text-primary/70 px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press hover:bg-primary/5 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> CSV
              </Link>
            </>
          )}
          </div>
        </div>
      </div>

      {/* The one thing this page leads with: the next milestone month. Rendered above the
          assumptions and the receipts because it is the story and they are the settings and
          the proof. `emptyReason` splits "nothing entered yet" from "the projection simply
          crosses no line", so a set-up user is never told to go and add data. */}
      <ForecastHero
        milestones={projections.milestones}
        emptyReason={accounts.length === 0 && rules.length === 0 ? 'no-inputs' : 'no-milestones'}
      />

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">60-month simulation — every data source feeding one projection</p>
              <p className="text-xs text-muted-foreground mt-0.5">The Forecast is where everything converges: income rules, debt payments, savings transfers, and one-time transactions all play out month by month.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: '3-pass engine', desc: 'PASS 1 builds base values. PASS 2 looks ahead and pre-saves cash for future one-time expenses. PASS 3 pushes all surplus above the cash floor to debt.' },
              { label: 'End cash at floor', desc: 'While CC debt exists, end cash lands exactly at $1,000 each month — no idle cash. The June car purchase causes PASS 2 to pre-save in April and May.' },
              { label: 'Debt payoff trajectory', desc: 'The debt chart shows each card\'s balance declining month by month. Sapphire goes first (22.99% APR), then Discover gets the full surplus.' },
              { label: 'Assumptions panel', desc: 'Adjust income growth, investment return, and savings interest to model different scenarios over 5 years.' },
            ].map((f, i) => (
              <div key={i} className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div className="min-w-0"><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {showAssumptions && (
        <ForecastAssumptionsPanel
          assumptions={assumptions}
          setAssumptions={setAssumptions}
          payConfig={payConfig}
          annualFederalWithheldFromBudget={annualFederalWithheldFromBudget}
          onClose={() => setShowAssumptions(false)}
        />
      )}

      {/* The year filter, the floor notice and the projection they govern are ONE group
          (`stack-row`): a control row belongs to the content below it. See the
          vertical-rhythm block in `src/index.css`. */}
      <div className="stack-row">
      {/* Year Filter — premium only */}
      {!freePreview && (
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto w-full pb-1">
          {(['all', '1', '2', '3', '4', '5'] as const).map(yr => (
            <button key={yr} onClick={() => setFilterYear(yr)} className={`px-3 sm:px-4 py-1 sm:py-1.5 text-xs font-medium border btn-press whitespace-nowrap ${filterYear === yr ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
              {yr === 'all' ? 'All 60 Months' : getCalendarYearLabel(parseInt(yr, 10))}
            </button>
          ))}
        </div>
      )}


      {/* Safe minimum override notice — shown when fixed monthly obligations exceed user cash floor */}
      {m0Floor && m0Floor.monthMinSafe > m0Floor.settingsCashFloor && (
        <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
          <Info size={13} className="text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {/* In AUTOMATIC mode there is no "your floor setting" to exceed — the floor IS the
                  obligations. Saying "your $0 floor setting" reported an internal sentinel as if it
                  were something the user had chosen, which is the one thing this app must not do. */}
              {m0Floor.settingsCashFloor > 0
                ? <>Cash floor raised to {formatCurrency(m0Floor.monthMinSafe, false)} — monthly obligations exceed your {formatCurrency(m0Floor.settingsCashFloor, false)} floor setting.</>
                : <>Cash floor of {formatCurrency(m0Floor.monthMinSafe, false)}, calculated from this month&rsquo;s obligations.</>}
            </p>
            {m0Floor.floorItems.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                {m0Floor.floorItems.map((item, idx) => (
                  <span key={idx}>{item.name} — {formatCurrency(item.amount, false)} (due {ordinal(item.dueDay)})</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'monthly' ? (
        <>
          {/* Net Worth Chart */}
          <ErrorBoundary variant="widget" label="Net Worth & Assets Projection">
          {/* The card arrives, then the series draw inside it. Without this the
              card snapped in fully-formed and the line animation read as a
              glitch on something already present, rather than as the chart
              building itself. Transform-based, so reduced motion drops it via
              MotionConfig and the lines stop drawing via recharts' own `auto`. */}
          <motion.div
            className="card-forged p-3 sm:p-5 min-w-0 overflow-x-hidden"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: MOTION_DURATION.slow, ease: EASE_OUT }}
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4">
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net Worth & Assets Projection</h3>
                <p className="text-[9px] text-muted-foreground mt-0.5">Click legend items to show or hide series</p>
              </div>
              {freePreview && <span className="text-[9px] text-muted-foreground">Showing 12 of 60 months</span>}
            </div>
            <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
              {chartMode === 'combo' ? (
                <ComposedChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ ...tickStyle, textAnchor: 'end' }} angle={-45} height={50} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={formatYAxisTick} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend onClick={e => toggleSeries(e.dataKey as string)} formatter={(value, entry) => (
                    <span style={{ color: hiddenSeries.includes(entry.dataKey as string) ? '#555' : entry.color, cursor: 'pointer', fontSize: 10 }}>{value}</span>
                  )} wrapperStyle={{ fontSize: 10 }} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="netWorth" name="Net Worth" stroke="hsl(47, 100%, 50%)" strokeWidth={2.5} dot={false} strokeOpacity={isVisible('netWorth') ? 1 : 0} />
                  <Bar {...CHART_DRAW} dataKey="totalAssets" name="Assets" fill="hsl(142, 71%, 45%)" opacity={isVisible('totalAssets') ? 0.3 : 0} />
                  <Bar {...CHART_DRAW} dataKey="totalLiabilities" name="Liabilities" fill="hsl(0, 84%, 60%)" opacity={isVisible('totalLiabilities') ? 0.3 : 0} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="retirementBalance" name="Retirement" stroke="hsl(262, 83%, 58%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('retirementBalance') ? 1 : 0} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="endingCash" name="Ending Cash" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} strokeDasharray="5 5" strokeOpacity={isVisible('endingCash') ? 1 : 0} />
                </ComposedChart>
              ) : (
                <LineChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} onTouchStart={selectPointOnTouch}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ ...tickStyle, textAnchor: 'end' }} angle={-45} height={50} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={formatYAxisTick} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend onClick={e => toggleSeries(e.dataKey as string)} formatter={(value, entry) => (
                    <span style={{ color: hiddenSeries.includes(entry.dataKey as string) ? '#555' : entry.color, cursor: 'pointer', fontSize: 10 }}>{value}</span>
                  )} wrapperStyle={{ fontSize: 10 }} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="netWorth" name="Net Worth" stroke="hsl(47, 100%, 50%)" strokeWidth={2.5} dot={false} strokeOpacity={isVisible('netWorth') ? 1 : 0} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="investmentBalance" name="Investments" stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('investmentBalance') ? 1 : 0} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="retirementBalance" name="Retirement" stroke="hsl(262, 83%, 58%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('retirementBalance') ? 1 : 0} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="savingsBalance" name="Savings" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('savingsBalance') ? 1 : 0} />
                  <Line {...CHART_DRAW} type="monotone" dataKey="endingCash" name="Ending Cash" stroke="hsl(30, 100%, 50%)" strokeWidth={1.5} dot={false} strokeDasharray="5 5" strokeOpacity={isVisible('endingCash') ? 1 : 0} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </motion.div>
          </ErrorBoundary>

          {/* Premium upgrade CTA — free users only */}
          {freePreview && (
            <div className="card-forged p-4 sm:p-5 overflow-hidden sm:p-6 flex flex-col items-center text-center gap-3 border border-primary/20">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Crown size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Unlock years 2-5</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">You have year 1 free. Upgrade to Premium to unlock all 60 months, the CC debt payoff trajectory chart, and PDF export.</p>
              </div>
              <Link
                to="/premium"
                className="bg-primary text-primary-foreground px-5 py-2 text-xs font-semibold btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Unlock Full Forecast
              </Link>
            </div>
          )}


          {/* The receipts. Every column, both drawers and the row tap are unchanged — the
              table simply no longer greets the reader before the milestone does. */}
          {/* Above the disclosure, never inside it: a month counted twice makes every figure
              on this page wrong, and a warning behind a tap is a warning nobody reads. */}
          <DuplicateTransactionWarning
            collisions={duplicateCollisions}
            onDelete={handleDeleteDuplicate}
            onDismiss={dismissDuplicate}
            title="A month below is counted twice"
          />
          <ReceiptsDisclosure
            title="Monthly breakdown"
            summary={`${displayData.length} month${displayData.length === 1 ? '' : 's'}`}
            open={showReceipts}
            onToggle={() => setShowReceipts(!showReceipts)}
          >
            <MonthlyBreakdownTable
              cashFloorIsManual={isManualCashFloor(profile)}
              displayData={displayData}
              filterYear={filterYear}
              duplicatesByMonth={duplicatesByMonth}
              payConfig={payConfig}
              syncCutoffDate={syncCutoffDate}
              cardProjectionData={cardProjectionData}
              step3CumSurplus={step3CumSurplus}
              carFunds={carFunds ?? []}
              onOpenCalcDrawer={setCalcDrawer}
              onOpenFloorDrawer={setFloorCalcDrawer}
            />
          </ReceiptsDisclosure>
        </>
      ) : (

        <div className="card-forged p-3 sm:p-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4">Scheduled Events Timeline</h3>
          <div className="space-y-1">
            {detailedEvents.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No recurring rules configured yet. Add rules in Budget Control to see scheduled events.</p>}
            {detailedEvents.map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 sm:py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground w-20 sm:w-24 font-mono shrink-0">{e.date}</span>
                  <span className="text-xs font-medium truncate">{e.name}</span>
                  {e.source && <span className="text-[9px] sm:text-xs text-muted-foreground hidden sm:inline">· {e.source}</span>}
                </div>
                <span className={`text-xs font-display font-bold shrink-0 ${e.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {e.type === 'income' ? '+' : '-'}{formatCurrency(e.amount, false)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {/* ── Retirement & Investment Growth Projections ─────────────────── */}
      {retirementProjections.length > 0 && (
        <div className="card-forged p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-primary" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Retirement & Investment Growth Projections</h3>
          </div>
          <div className="space-y-4">
            {retirementProjections.map(({ account, apyRate, monthlyContrib, milestones }) => (
              <div key={account.id} className="card-forged p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.account_type.toUpperCase().replace('_', ' ')} · {apyRate}% APY
                      {monthlyContrib > 0 && ` · +${formatCurrency(monthlyContrib, false)}/mo contributions`}
                    </p>
                  </div>
                  <span className="text-xs font-bold font-display text-foreground">{formatCurrency(Number(account.balance), false)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([['1yr', milestones.year1], ['5yr', milestones.year5], ['10yr', milestones.year10], ['20yr', milestones.year20]] as [string, number][]).map(([label, val]) => (
                    <div key={label} className="card-forged px-2 py-1.5 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
                      <p className="text-xs font-bold font-display text-success">{formatCurrency(val, false)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {retirementProjections.length > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground font-medium">Combined projected retirement (10yr)</p>
                <p className="text-sm font-bold font-display text-success">
                  {formatCurrency(retirementProjections.reduce((s, p) => s + p.milestones.year10, 0), false)}
                </p>
              </div>
            )}
            <p className="text-[9px] text-muted-foreground">Projections use your configured APY rates and paycheck deductions. Actual growth will vary with market conditions.</p>
          </div>
        </div>
      )}

      <CalcDrawer
        open={!!calcDrawer}
        onClose={() => setCalcDrawer(null)}
        title={calcDrawer?.title || ''}
        lines={calcDrawer?.lines || []}
        footnote={CALC_FOOTNOTE}
      />
      <CalcDrawer
        open={!!floorCalcDrawer}
        onClose={() => setFloorCalcDrawer(null)}
        title={floorCalcDrawer?.title || ''}
        lines={floorCalcDrawer?.lines || []}
        footnote={CALC_FOOTNOTE}
        zIndex={70}
      />
    </div>
  );
}
