import { useState, useMemo, useEffect, useCallback } from 'react';
import { LUMP_SUM_AUTO_EXTRA_NOTE, lumpSumsBlocked } from '@/lib/lump-sum-guard';
import type { Json, Tables } from '@/integrations/supabase/types';
import DateScrollPicker from '@/components/shared/DateScrollPicker';
import { useMonth0DebtBreakdown } from '@/hooks/useMonth0DebtBreakdown';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { buildAutoExtraByTarget, autoExtraSeriesForGoal } from '@/lib/auto-extra-projection';
import { useIsViewportBelow } from '@/hooks/use-mobile';
import { Link } from 'react-router';
import { GoalsSkeleton } from '@/components/shared/PageSkeleton';
import { useFormDraft, type FormDraft } from '@/hooks/useFormDraft';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { useSavingsGoals, useCarFunds, useAccounts, useRecurringRules, useProfile, useTransactions, useDebts, type AccountRow } from '@/hooks/useSupabaseData';
import SurplusRankingSection, { type OwnContribution } from '@/components/savings/SurplusRankingSection';
import ProgressBar from '@/components/shared/ProgressBar';
import FormModal, { type Field } from '@/components/shared/FormModal';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import { Plus, Edit2, Trash2, Car, Copy, Link2, Crown, X, Check } from 'lucide-react';
import { mergeWithGeneratedTransactions, createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, getAccountRemainingCashThisMonth } from '@/lib/pay-schedule';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { buildSavingsGrowthData, estimateGoalCompletionMonths, getGoalEffectiveApyPercent, goalCompletionMonthLabel, projectGoalBalanceAt, type GrowthGoalInput } from '@/lib/savings-growth';
import { buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';
import { planAutoEndWrites, toStampedMap, type StampedMap } from '@/lib/goal-auto-end';
import { computeEssentialMonthlyExpenses } from '@/lib/essential-monthly-expenses';
import { goalStages, goalWithdrawals, goalSavedIncludingSpent } from '@/lib/ranked-extra-payment-targets';
import { IRA_ANNUAL_LIMIT } from '@/lib/retirement-contribution-cap';
import GoalStopsEditor, { newStopDraft, stopDraftsFrom, stopsToStages, type StopDraft } from '@/components/savings/GoalStopsEditor';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { toast } from 'sonner';
import { selectPointOnTouch } from '@/lib/chart-touch';

const CHART_COLORS = ['hsl(43, 56%, 52%)', 'hsl(142, 50%, 40%)', 'hsl(200, 60%, 50%)', 'hsl(280, 50%, 50%)'];
const GOAL_TYPES = ['Emergency Fund', 'Vacation', 'Down Payment', 'Retirement', 'Custom'];
// ⚠️ ONE DEFINITION OF A STATUTORY NUMBER. This used to be its own `7000` here while the forecast
// engine capped against another copy; two spellings of a legal limit is the shape that goes stale in
// one place and not the other, and the two surfaces then disagree about whether a year is full.
const ROTH_IRA_LIMIT = IRA_ANNUAL_LIMIT;
const emptyForm = { name: '', target_amount: '', current_amount: '', monthly_contribution: '', target_date: '', goal_type: 'Custom', linked_account: '', contribution_start_date: '' };

// allGoals' shape: a real savings_goals row enriched with values computed from
// the linked account/rule (not DB columns themselves).
type LinkedRuleInfo = { name: string; amount: number; frequency: string; start_date: string | null };

type EnrichedGoal = Partial<Tables<'savings_goals'>> & {
  effective_apy: number;
  linked_rules: LinkedRuleInfo[];
  available_after_outflows: number | null;
  /**
   * Handoff item 4b — the goal has already reached its target as of today, so the engines
   * (forecast-engine.ts, useCardProjection.ts, CreditCardEngine.tsx) have stopped counting its
   * contribution. Display-only: `monthly_contribution` is deliberately left at its live value
   * because openEdit/handleDuplicate write that field straight back to savings_goals, and
   * zeroing it here would turn a read-path exclusion into a destructive DB write.
   */
  is_complete: boolean;
};

type GoalLumpSum = { id: string; date: string; amount: number };

/**
 * "Oct 2026" for the last month any of this goal's rules is stamped to stop, or null when
 * nothing is stamped (toggle on but the goal does not complete within the horizon).
 */
function autoEndLabel(value: unknown): string | null {
  const dates = Object.values(toStampedMap(value)).sort();
  if (dates.length === 0) return null;
  const d = new Date(dates[dates.length - 1] + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function GoalLumpSumModal({
  mode, initialDate, initialAmount, projectedBalanceAt, liquidCash, onSave, onClose,
}: {
  mode: 'add' | 'edit';
  initialDate: string;
  initialAmount: string;
  projectedBalanceAt: (date: string) => number;
  liquidCash: number;
  onSave: (date: string, amount: number) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [amount, setAmount] = useState(initialAmount);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const proj = date ? projectedBalanceAt(date) : null;
  const canSave = !!date && parseFloat(amount) > 0;

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!date || !amt || amt <= 0) return;
    onSave(date, amt);
  };

  return (
    <div
      className="modal-overlay z-60"
      style={{ touchAction: 'none', background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="card-forged w-full sm:max-w-md flex flex-col rounded-(--radius)"
        style={{ maxHeight: '100%', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 pt-5 sm:pt-6 pb-3 shrink-0">
          <h2 className="font-display font-semibold text-sm">{mode === 'add' ? 'Add Contribution' : 'Edit Contribution'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-4 pb-2 popup-scroll" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Date</p>
            <DateScrollPicker value={date} onChange={setDate} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Amount</p>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full bg-secondary border border-border px-3 py-3 text-sm text-foreground"
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>
          {date && proj !== null && (
            <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground p-2.5 bg-secondary/30 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
              <span>Goal balance at date: <span className="text-foreground font-medium">{formatCurrency(proj, false)}</span></span>
              <span>Cash available: <span className="text-success font-medium">{formatCurrency(liquidCash, false)}</span></span>
            </div>
          )}
        </div>
        <div className="px-4 sm:px-6 pt-3 pb-5 sm:pb-6 shrink-0 border-t border-border mt-1">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full bg-primary text-primary-foreground py-3.5 text-sm font-semibold btn-press disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Check size={14} />
            {mode === 'add' ? 'Add Contribution' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GoalLumpSumPanel({
  lumpSums, onSave, liquidCash, currentAmount, monthlyContrib, targetAmount, isRothIra, apyRate = 0,
  autoExtraOn,
}: {
  lumpSums: GoalLumpSum[];
  onSave: (lumps: GoalLumpSum[]) => void;
  liquidCash: number;
  currentAmount: number;
  monthlyContrib: number;
  targetAmount: number;
  isRothIra?: boolean;
  apyRate?: number;
  /** The goal's PERSISTED `auto_extra` switch — see `lump-sum-guard.ts` for why, and why not. */
  autoExtraOn?: boolean;
}) {
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string; date: string; amount: string }>(null);

  // Reads the same model as the chart above rather than a closed-form annuity of its own: the
  // old formula ignored the already-planned lump sums AND kept contributing past the target, so
  // it could quote a bigger balance for a date than the chart drew for that same month.
  const projectedBalanceAt = (dateStr: string) => {
    const today = new Date();
    const target = new Date(dateStr + 'T00:00:00');
    const months = Math.max(0, (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth()));
    return projectGoalBalanceAt({
      id: 'preview',
      name: '',
      currentAmount,
      monthlyContribution: monthlyContrib,
      annualApyPercent: apyRate,
      contributionStartDate: null,
      lumpSums,
      targetAmount,
    }, months, { today });
  };

  const rothByYear = useMemo(() => {
    if (!isRothIra) return {} as Record<number, number>;
    return lumpSums.reduce((acc, ls) => {
      const yr = parseInt(ls.date.substring(0, 4), 10);
      acc[yr] = (acc[yr] || 0) + ls.amount;
      return acc;
    }, {} as Record<number, number>);
  }, [lumpSums, isRothIra]);

  const handleModalSave = (date: string, amount: number) => {
    if (!modal) return;
    if (isRothIra) {
      const yr = parseInt(date.substring(0, 4), 10);
      let otherTotal: number;
      if (modal.mode === 'edit') {
        otherTotal = lumpSums.filter(ls => ls.id !== modal.id && ls.date.substring(0, 4) === String(yr)).reduce((s, ls) => s + ls.amount, 0);
      } else {
        otherTotal = rothByYear[yr] || 0;
      }
      if (otherTotal + amount > ROTH_IRA_LIMIT) {
        toast.error(`Exceeds $${ROTH_IRA_LIMIT.toLocaleString()} Roth IRA limit for ${yr}`);
        return;
      }
    }
    if (modal.mode === 'add') {
      onSave([...lumpSums, { id: crypto.randomUUID(), date, amount }]);
    } else {
      onSave(lumpSums.map(ls => ls.id === modal.id ? { ...ls, date, amount } : ls));
    }
    setModal(null);
  };

  const handleRemove = (id: string) => onSave(lumpSums.filter(ls => ls.id !== id));

  const blocked = lumpSumsBlocked(autoExtraOn);

  return (
    <div className="space-y-2 border-t border-border/30 pt-3 mt-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Planned Contributions</span>
        <button
          onClick={() => setModal({ mode: 'add' })}
          disabled={blocked}
          className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={10} /> Add
        </button>
      </div>

      {/* ⚠️ THIS PAGE HAD NO GUARD AT ALL UNTIL 2026-09-06, while the vehicles panel did. A goal
          with the sweep switched on still offered an Add button, and entering an amount would
          have changed neither cash nor the goal's total — a control that appears to do nothing.
          Same sentence as `LumpSumPanel`, from one constant, so the two surfaces cannot describe
          the same rule differently. */}
      {blocked && (
        <p className="text-[10px] text-muted-foreground">{LUMP_SUM_AUTO_EXTRA_NOTE}</p>
      )}

      {isRothIra && Object.keys(rothByYear).length > 0 && (
        <div className="space-y-1.5 p-2 bg-secondary/30 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
          {Object.entries(rothByYear).sort(([a], [b]) => Number(a) - Number(b)).map(([yr, total]) => {
            const pct = Math.min((total / ROTH_IRA_LIMIT) * 100, 100);
            const over = total > ROTH_IRA_LIMIT;
            const warn = !over && pct >= 80;
            const barColor = over ? 'hsl(0, 84%, 60%)' : warn ? 'hsl(38, 92%, 50%)' : 'hsl(43, 56%, 52%)';
            return (
              <div key={yr}>
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="text-muted-foreground">{yr} Roth IRA</span>
                  <span className={over ? 'text-destructive font-semibold' : warn ? 'text-gold' : 'text-muted-foreground'}>
                    {formatCurrency(total, false)} / {formatCurrency(ROTH_IRA_LIMIT, false)}{over ? ' ⚠ over!' : ''}
                  </span>
                </div>
                <div className="w-full h-1 bg-secondary overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor, borderRadius: 'var(--radius)' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!blocked && lumpSums.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No planned contributions yet.</p>
      )}

      {lumpSums.length > 0 && (
        <div className="space-y-1">
          {[...lumpSums].sort((a, b) => a.date.localeCompare(b.date)).map(ls => {
            const dateLabel = new Date(ls.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            return (
              <div key={ls.id} className="flex items-center justify-between py-1 px-2 bg-secondary/20 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium">{dateLabel}</span>
                  <span className="text-[10px] text-primary font-semibold">{formatCurrency(ls.amount, false)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setModal({ mode: 'edit', id: ls.id, date: ls.date, amount: String(ls.amount) })}
                    className="text-muted-foreground hover:text-foreground"><Edit2 size={11} /></button>
                  <button onClick={() => handleRemove(ls.id)} className="text-muted-foreground hover:text-destructive"><X size={11} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <GoalLumpSumModal
          key={modal.mode === 'edit' ? modal.id : 'add'}
          mode={modal.mode}
          initialDate={modal.mode === 'edit' ? modal.date : ''}
          initialAmount={modal.mode === 'edit' ? modal.amount : ''}
          projectedBalanceAt={projectedBalanceAt}
          liquidCash={liquidCash}
          onSave={handleModalSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

const toMonthly = (amount: number, freq: string) =>
  freq === 'weekly' ? amount * 52 / 12
  : freq === 'biweekly' ? amount * 26 / 12
  : freq === 'yearly' ? amount / 12
  : amount;

/**
 * Map an enriched goal onto the pure projection model's input shape.
 *
 * `extraByGoal` is the forecast engine's own ranked automatic extra, keyed by TARGET id — a goal's
 * own id, plus one entry per later stop of a staged plan (see `buildAutoExtraByTarget` and
 * `autoExtraSeriesForGoal`). Passing it is what makes ticking "Auto Extra" move this chart, and
 * reading it from the engine rather than re-deriving it is what stops the chart and the Forecast
 * disagreeing. Omitted (or a goal with nothing diverted) leaves every number exactly as it was.
 */
const toGrowthGoal = (
  g: EnrichedGoal,
  index: number,
  extraByGoal?: Map<string, number[]>,
  essentialMonthlyExpenses = 0,
): GrowthGoalInput => ({
  id: g.id ?? String(index),
  name: g.name ?? '',
  currentAmount: Number(g.current_amount),
  monthlyContribution: Number(g.monthly_contribution),
  annualApyPercent: Number(g.effective_apy || 0),
  contributionStartDate: g.contribution_start_date ?? null,
  lumpSums: Array.isArray(g.lump_sum_payments)
    ? (g.lump_sum_payments as unknown as GoalLumpSum[]).map(ls => ({ date: ls.date, amount: Number(ls.amount) }))
    : [],
  // Handoff 4b, completing it: the chart stops contributing once the goal is funded, exactly as
  // the Forecast, Dashboard and Debt engine already do. Interest keeps accruing after that.
  targetAmount: Number(g.target_amount),
  // ⚠️ Not `extraByGoal.get(g.id)`: a STAGED goal is several targets (`${goalId}::stopN`), so a bare
  // lookup draws the line without the money its later stops receive. `autoExtraSeriesForGoal` sums
  // every stop and returns undefined when nothing is diverted, which is the untouched case.
  extraByMonth: g.id && extraByGoal ? autoExtraSeriesForGoal(extraByGoal, g.id) : undefined,
  // The money this goal exists to SPEND. Empty for every goal until a stop is marked, so the line
  // is unchanged for anyone who has not used the feature.
  withdrawals: goalWithdrawals(g, essentialMonthlyExpenses),
});

function SavingsGrowthChart({ goals, extraByGoal, essentialMonthlyExpenses }: {
  goals: EnrichedGoal[]; extraByGoal: Map<string, number[]>; essentialMonthlyExpenses: number;
}) {
  const { rows: chartData, series } = useMemo(
    () => buildSavingsGrowthData(goals.map((g, i) => toGrowthGoal(g, i, extraByGoal, essentialMonthlyExpenses))),
    [goals, extraByGoal, essentialMonthlyExpenses],
  );
  const isMobile = useIsViewportBelow(640);
  // 60 monthly points is far too many labels and dots to draw: thin the axis to
  // roughly one tick a year (one every other year on a phone) and drop the dots.
  const tickInterval = Math.max(0, Math.ceil(chartData.length / (isMobile ? 5 : 10)) - 1);

  if (goals.length === 0) return null;
  return (
    <div className="card-forged p-4 sm:p-5 overflow-hidden w-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Savings Growth Projection</h3>
      <p className="text-[10px] text-muted-foreground mb-3 sm:mb-5">Next 5 years — includes interest, planned contributions, and future start dates. Contributions stop once a goal hits its target; interest keeps compounding. A stop you marked as spent drops out of the line on its date.</p>
      <ResponsiveContainer width="100%" height={isMobile ? 200 : 260}>
        <LineChart data={chartData} margin={{ left: 0, right: 0, top: 5, bottom: 5 }} onTouchStart={selectPointOnTouch}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)', textAnchor: 'end' }} angle={-45} height={50} axisLine={false} tickLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} />
          <Tooltip contentStyle={{ background: 'hsl(0, 0%, 8%)', border: '1px solid hsl(0, 0%, 15%)', borderRadius: 'var(--radius)', fontSize: 12 }} formatter={(value) => formatCurrency(Number(value), false)} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {series.map((s, i) => <Line key={s.key} dataKey={s.key} name={s.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={chartData.length > 24 ? false : { r: 3 }} activeDot={{ r: 4 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * ⚠️ GOALS IS NOT A ROUTE ANY MORE. It is the Forecast's second panel (Tre, 2026-08-18: "well
 * add goals to forecast then."), hosted the way the Dashboard hosts `Accounts` — rendered, not
 * linked to, and mounted only on its own panel. A goal's hero number is a target and an ETA, which
 * is the Forecast's whole subject.
 *
 * `embedded` suppresses ONLY the page <h1> and its subtitle, because the Forecast already carries a
 * page heading and two of them is the thing the merge was meant to remove. Everything else — Add
 * Goal, the Vehicles link, the projection chart, every modal — is untouched.
 */
export default function SavingsGoals({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: goals, add, update, remove, loading: goalsLoading } = useSavingsGoals();
  const { data: carFunds, loading: carFundsLoading } = useCarFunds();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: rules, update: updateRule } = useRecurringRules();
  const { data: profile } = useProfile();
  const { data: txns } = useTransactions();
  const { data: debts } = useDebts();
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  /** The goal's planned stops as the form holds them. Empty ⇒ an ordinary single-target goal, and
   *  that is every goal until the user adds one. */
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  // 97.3 — the auto-end toggle plus the stamp map (ruleId -> end_date THIS feature wrote) for
  // the goal being edited. The map is provenance: without it we cannot tell our own end_date
  // from one the user typed, and toggling off would clear dates we never set.
  const [autoEnd, setAutoEnd] = useState(false);
  const [stampedRules, setStampedRules] = useState<StampedMap>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const cashFloor = profile?.cash_floor != null ? Number(profile.cash_floor) : 1000;
  const liquidCash = useMemo(() =>
    accounts
      .filter(a => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
      .reduce((s, a) => s + Number(a.balance), 0),
    [accounts]
  );

  // Build full transaction stream including debt payments for linked-account math
  const baseTxns = useMemo(() => mergeWithGeneratedTransactions(txns || [], rules, accounts), [txns, rules, accounts]);

  // Card payments come from the converged month-0 projection (useCardProjection pass 3) that Debt
  // Payoff and Forecast read, instead of this page's own legacy engine pass. Linked-account
  // "remaining cash" now nets out the same payments /debt recommends.
  const { recommendations: debtRecs, totalRecommended: debtTotalRecommended } = useMonth0DebtBreakdown();
  // Same authoritative engine run the Forecast panel draws; see `autoExtraByGoal` below.
  const { projections } = useCardProjectionContext();

  const debtTxns = useMemo(() => {
    const fundId = profile?.default_deposit_account ||
      accounts.find(a => a.account_type === 'checking' && a.active)?.id || null;
    return createDebtPaymentTransactions(debtRecs, fundId);
  }, [debtRecs, profile, accounts]);

  /**
   * One month of keeping the lights on — bills, card-charged recurring spend, the vehicle loan and
   * its insurance. The multiplicand behind a STAGED goal's two thresholds.
   *
   * ⚠️ SHOWN, NEVER SILENTLY STORED. The goal stores the multiplier (3 months, 6 months) and the
   * engine recomputes the dollars every read, so the target tracks real spending instead of going
   * stale when the car loan ends or the rent changes. But a user picking "3 months" without seeing
   * what three months COSTS is picking a number they cannot see, so the form prints the figure and
   * both derived targets live. Zero means we could not read one, and the form says so rather than
   * multiplying nothing.
   */
  const essentialMonthlyExpenses = useMemo(() => computeEssentialMonthlyExpenses({
    rules,
    accounts,
    carFunds,
    fundingAccountId: profile?.default_deposit_account
      || accounts.find(a => a.account_type === 'checking' && a.active)?.id
      || null,
  }), [rules, accounts, carFunds, profile?.default_deposit_account]);
  const allTxns = useMemo(() => mergeDebtPaymentsIntoStream(baseTxns, debtTxns), [baseTxns, debtTxns]);

  // What the ranked list says about the card row, from the SAME converged month-0 breakdown the
  // Debt Payoff tab shows — never a second calculation of the same number.
  const cardsRankSubtitle = useMemo(() => {
    if (debtRecs.length === 0) return undefined;
    const n = debtRecs.length;
    return `${n} card${n > 1 ? 's' : ''} · ${formatCurrency(debtTotalRecommended, false)} this month`;
  }, [debtRecs.length, debtTotalRecommended]);


  const accountMap = useMemo(() => {
    const map: Record<string, AccountRow> = {};
    accounts.forEach(a => { map[a.id] = a; });
    return map;
  }, [accounts]);

  const getLinkedAmount = useCallback((accountId: string) => {
    const acct = accountMap[accountId];
    if (!acct) return 0;
    return getAccountRemainingCashThisMonth(accountId, acct.account_type, allTxns, Number(acct.balance), cashFloor);
  }, [accountMap, allTxns, cashFloor]);

  const allGoals: EnrichedGoal[] = useMemo(() => {
    // Handoff item 4b — same shared primitive the engines use, rather than a 4th local
    // re-derivation of "has this goal hit its target". cutoff <= 0 means already at target now.
    const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, new Date());
    return goals.map(g => {
      // Support multiple linked rules; fall back to legacy single linked_rule_id
      const ruleIds: string[] = (g.linked_rule_ids ?? []).length > 0
        ? (g.linked_rule_ids ?? [])
        : g.linked_rule_id ? [g.linked_rule_id] : [];
      const linkedRules: LinkedRuleInfo[] = ruleIds
        .map(id => rules.find(r => r.id === id))
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map(r => ({ name: r.name, amount: r.amount, frequency: r.frequency, start_date: r.start_date ?? null }));
      const linkedAcct = g.linked_account ? accountMap[g.linked_account] : null;
      const effective_apy = getGoalEffectiveApyPercent(linkedAcct);
      const linkedMonthly = linkedRules.reduce((s, r) => s + toMonthly(r.amount, r.frequency), 0);
      const earliestStart = linkedRules
        .map(r => r.start_date)
        .filter((d): d is string => d != null)
        .sort()[0] ?? null;
      return {
        ...g,
        goal_type: g.goal_type || 'Custom',
        current_amount: g.linked_account && accountMap[g.linked_account]
          ? Number(accountMap[g.linked_account].balance)
          : Number(g.current_amount),
        available_after_outflows: g.linked_account && accountMap[g.linked_account]
          ? getLinkedAmount(g.linked_account)
          : null,
        monthly_contribution: linkedRules.length > 0
          ? linkedMonthly
          : Number(g.monthly_contribution),
        contribution_start_date: earliestStart ?? g.contribution_start_date ?? null,
        linked_rules: linkedRules,
        effective_apy,
        is_complete: (() => {
          const cutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined;
          return cutoff != null && cutoff <= 0;
        })(),
      };
    });
  }, [goals, accountMap, rules, accounts, getLinkedAmount]);

  // The ranked automatic extra the Forecast already diverts to each goal, month by month. Free:
  // CardProjectionProvider (mounted by DashboardLayout) has already run the engine, so this is a
  // re-key of rows the page is holding anyway, not a second forecast.
  const autoExtraByGoal = useMemo(
    () => buildAutoExtraByTarget(projections.data ?? []),
    [projections],
  );

  /**
   * The whole deployable surplus per month, and each target's own standing contribution — the two
   * things "Where the extra money goes" needs before it can say whether a plan actually works.
   *
   * Capacity is `debtPayment + everything the ranked allocator diverted`, which is the pool BEFORE
   * it was split between the cards and the goals — the honest ceiling on what every target
   * combined can receive in a month. Deriving it from the forecast rows the page already holds
   * keeps it the same number the engine spent, rather than a second model of the same month.
   */
  const surplusCapacityByMonth = useMemo(
    () => (projections.data ?? []).map(r =>
      Math.max(0, Number(r.debtPayment) || 0)
      + Object.values(r.autoExtraByTarget ?? {}).reduce((s, v) => s + (Number(v) || 0), 0)),
    [projections],
  );

  // A goal's own monthly contribution fills the same need a ranked extra does, so a reachability
  // verdict that ignored it would call a goal unreachable that its own standing transfer reaches.
  //
  // ⚠️ THE START DATE RIDES ALONG, and it is the SAME enriched value the growth chart is handed
  // (`toGrowthGoal`) — a linked rule's earliest start where there is one, the goal's own column
  // otherwise. Without it the ranked list read "On track for Jul 2027" for a goal whose transfer
  // was dated to begin Nov 2027, while the chart three inches above it showed a flat line until
  // then.
  const ownMonthlyByTarget = useMemo(() => {
    const map: Record<string, OwnContribution> = {};
    for (const g of allGoals) {
      map[g.id as string] = {
        monthly: Math.max(0, Number(g.monthly_contribution) || 0),
        startDate: g.contribution_start_date ?? null,
      };
    }
    return map;
  }, [allGoals]);

  const totalSaved = allGoals.reduce((s, g) => s + Number(g.current_amount), 0);
  const totalTarget = allGoals.reduce((s, g) => s + Number(g.target_amount), 0);

  const accountOptions = useMemo(() => [
    { value: '', label: 'None (Manual)' },
    ...accounts.filter(a => a.active).map(a => ({ value: a.id, label: `${a.name} (${a.account_type.replace(/_/g, ' ')})` })),
  ], [accounts]);

  const transferRuleOptions = useMemo(() => [
    { value: '', label: 'None (manual)' },
    ...rules
      .filter(r => (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.active)
      .map(r => ({ value: r.id, label: `${r.name} — ${formatCurrency(r.amount, false)}/${r.frequency}` })),
  ], [rules]);

  // The linked rules, the auto-end toggle and its provenance map are all part of
  // what the user filled in, so they ride the draft alongside the text fields.
  const draftValues = useMemo(
    () => ({ form, stops, selectedRuleIds, autoEnd, stampedRules }),
    [form, stops, selectedRuleIds, autoEnd, stampedRules],
  );

  const { restored: draftRestored, discard: discardDraft } = useFormDraft({
    formKey: 'goals',
    open: showForm,
    editId,
    values: draftValues,
    enabled: !isDemo,
    onRestore: useCallback((draft: FormDraft<typeof draftValues>) => {
      setForm(draft.values.form);
      // A draft written before stops existed has none, and `?? []` is what keeps it restorable.
      setStops(draft.values.stops ?? []);
      setSelectedRuleIds(draft.values.selectedRuleIds);
      setAutoEnd(draft.values.autoEnd);
      setStampedRules(draft.values.stampedRules);
      setEditId(draft.editId);
      setShowForm(true);
    }, []),
  });

  const handleDiscardDraft = useCallback(() => {
    discardDraft();
    setForm(emptyForm);
    setStops([]);
    setSelectedRuleIds([]);
    setAutoEnd(false);
    setStampedRules({});
    setEditId(null);
  }, [discardDraft]);

  const openAdd = (goalType = 'Custom') => {
    setForm({ ...emptyForm, goal_type: goalType });
    setStops([]);
    setSelectedRuleIds([]);
    setAutoEnd(false); setStampedRules({});
    setEditId(null); setShowForm(true);
  };

  const openEdit = (g: EnrichedGoal) => {
    setForm({
      name: g.name ?? '', target_amount: String(g.target_amount), current_amount: String(g.current_amount),
      monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
      goal_type: g.goal_type || 'Custom', linked_account: g.linked_account || '',
      contribution_start_date: g.contribution_start_date || '',
    });
    setStops(stopDraftsFrom(g.stages));
    // Populate from linked_rule_ids, falling back to legacy single linked_rule_id
    const ids = (g.linked_rule_ids ?? []).length > 0
      ? (g.linked_rule_ids ?? [])
      : g.linked_rule_id ? [g.linked_rule_id] : [];
    setSelectedRuleIds(ids);
    setAutoEnd(!!g.auto_end_contributions);
    setStampedRules(toStampedMap(g.auto_end_stamped_rules));
    setEditId(g.id ?? null); setShowForm(true);
  };

  const handleDuplicate = (g: EnrichedGoal) => {
    setForm({
      name: `${g.name} (Copy)`, target_amount: String(g.target_amount), current_amount: '0',
      monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
      goal_type: g.goal_type || 'Custom', linked_account: g.linked_account || '',
      contribution_start_date: g.contribution_start_date || '',
    });
    // The PLAN copies; the progress does not. `stopDraftsFrom` mints fresh local ids, so the copy
    // cannot share a stop id with the original.
    setStops(stopDraftsFrom(g.stages));
    const ids = (g.linked_rule_ids ?? []).length > 0
      ? (g.linked_rule_ids ?? [])
      : g.linked_rule_id ? [g.linked_rule_id] : [];
    setSelectedRuleIds(ids);
    // A copy does not own the original's stamps: the original's rules still carry ITS end
    // dates, and inheriting the map would let the copy clear dates it never wrote.
    setAutoEnd(false); setStampedRules({});
    setEditId(null); setShowForm(true);
    toast.info('Goal duplicated — edit and save');
  };

  /**
   * The stops as the database wants them, and what they come to in dollars right now.
   *
   * A stop with no usable size is dropped by `stopsToStages`, so `stagesPayload` being empty is
   * exactly "this goal is not staged" — there is one definition of that, and the form cannot store
   * a state the engine would ignore.
   */
  const stagesPayload = useMemo(() => stopsToStages(stops), [stops]);
  const stagePreview = useMemo(
    () => goalStages({ target_amount: 0, stages: stagesPayload }, essentialMonthlyExpenses),
    [stagesPayload, essentialMonthlyExpenses],
  );
  const hasStops = stagesPayload.length > 0;

  const handleSave = () => {
    // ⚠️ WITH STOPS THERE IS NO TARGET AMOUNT FIELD TO PARSE. Tre, 2026-08-26: "in the modal the
    // target amount and date should clear if stages are planned." The stops ARE the target, so the
    // number stored below is derived from them rather than typed.
    const target_amount = hasStops ? stagePreview.total : parseFloat(form.target_amount);
    if (!form.name || isNaN(target_amount)) return;
    const { clean: cleanName, flagged: nameFlagged } = filterProfanity(form.name.trim().slice(0, LIMITS.goalName));
    if (nameFlagged) toast.warning('Goal name contained inappropriate language and was cleaned.');
    const payload: Partial<Tables<'savings_goals'>> & {
      name: string; target_amount: number; current_amount: number; monthly_contribution: number;
    } = {
      name: cleanName, target_amount, current_amount: parseFloat(form.current_amount) || 0,
      monthly_contribution: parseFloat(form.monthly_contribution) || 0,
      // The LAST stop's date is the goal's date, because that is when the whole plan is done. The
      // stops each carry their own; this one exists for the surfaces that only know about a goal.
      target_date: hasStops
        ? (stagePreview.stops[stagePreview.stops.length - 1]?.targetDate ?? null)
        : (form.target_date || null),
      linked_account: form.linked_account || null,
      goal_type: form.goal_type || 'Custom',
      contribution_start_date: form.contribution_start_date || null,
      linked_rule_ids: selectedRuleIds,
      linked_rule_id: selectedRuleIds.length === 1 ? selectedRuleIds[0] : null,
      auto_end_contributions: autoEnd,
      // ⚠️ AN EMPTY ARRAY IS THE OPT-OUT the whole feature hangs on — `goalStages` reads it as "not
      // staged" and the goal chases `target_amount` exactly as it did before this existed.
      stages: stagesPayload as unknown as Json,
      // The two-column design this replaced. Cleared on every save so a row cannot carry BOTH plans
      // and depend on which reader looked at it; `goalStages` prefers `stages`, but a stale pair
      // left behind would come back the moment someone deleted every stop.
      emergency_months_stage1: null,
      emergency_months_stage2: null,
    };

    // 97.3 — the ONLY place auto-end writes are issued: an explicit save, never a render path.
    // The engines on this page re-run on nearly every input change, so a write from a useMemo
    // would hammer Supabase. Planned against the payload (the goal AS SAVED), so a rule the
    // user just unlinked in this same save still gets its stale stamp cleared.
    const existing = editId ? goals.find(g => g.id === editId) : null;
    const plan = planAutoEndWrites({
      enabled: autoEnd,
      goal: { ...payload, id: editId ?? undefined, lump_sum_payments: existing?.lump_sum_payments },
      previousStamped: stampedRules,
      rules,
      accounts,
    });
    payload.auto_end_stamped_rules = plan.stamped as unknown as Json;
    // Demo mode has no DB: every mutation throws 'Demo mode', so don't queue rule writes there.
    if (!isDemo) for (const w of plan.ruleWrites) updateRule.mutate({ id: w.id, end_date: w.end_date });
    if (plan.conflicts.length > 0) {
      const names = plan.conflicts.map(c => rules.find(r => r.id === c.ruleId)?.name ?? 'rule').join(', ');
      toast.warning(`${names} already has an end date you set — left unchanged.`);
    }

    if (editId) {
      update.mutate({ id: editId, ...payload });
    } else {
      add.mutate(payload);
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const handleSaveLumpSums = (goalId: string, lumps: GoalLumpSum[]) => {
    update.mutate({ id: goalId, lump_sum_payments: lumps as unknown as Json });
  };

  // Uses the same month-by-month accrual as the growth chart, so the estimate
  // and the chart can never disagree: interest, a future contribution start
  // date, and planned lump sums all count toward the date.
  function estimateCompletion(g: EnrichedGoal): string {
    if (Number(g.current_amount) >= Number(g.target_amount)) return 'Complete';
    const months = estimateGoalCompletionMonths(toGrowthGoal(g, 0, autoExtraByGoal), Number(g.target_amount));
    if (months === null) {
      return Number(g.monthly_contribution) > 0 ? 'Beyond 50 yrs' : 'Set contribution';
    }
    return goalCompletionMonthLabel(months);
  }

  const formFields = useMemo(() => {
    const fields: Field[] = [
      { key: 'name', label: 'Goal Name', type: 'text', placeholder: 'e.g., Emergency Fund' },
      { key: 'goal_type', label: 'Goal Type', type: 'select', options: GOAL_TYPES.map(t => ({ value: t, label: t })) },
      { key: 'linked_account', label: 'Linked Account (auto-pull balance)', type: 'select', options: accountOptions },
    ];
    // Tre, 2026-08-26: "in the modal the target amount and date should clear if stages are planned."
    // With stops the single target is not a thing the user sets — it is the sum of what they
    // planned — so the field is removed rather than left showing a number nobody typed.
    if (!hasStops) {
      fields.push({ key: 'target_amount', label: 'Target Amount', type: 'number', placeholder: '10000', step: '0.01' });
    }
    if (!form.linked_account) {
      fields.push({ key: 'current_amount', label: 'Current Saved', type: 'number', placeholder: '0', step: '0.01' });
    }
    if (selectedRuleIds.length === 0) {
      fields.push({ key: 'monthly_contribution', label: 'Monthly Contribution', type: 'number', placeholder: '500', step: '0.01' });
      fields.push({ key: 'contribution_start_date', label: 'Contributions Start (optional)', type: 'date' });
    }
    // Same reason: each stop carries its own date now, and one goal-level date could only ever
    // describe one of them.
    if (!hasStops) fields.push({ key: 'target_date', label: 'Target Date', type: 'date' });
    return fields;
  }, [form.linked_account, selectedRuleIds.length, accountOptions, hasStops]);

  // The page's subject is `goals`, but the gate used to be on `accounts` alone —
  // so between the two resolving, a signed-in user with goals was shown
  // "No savings goals yet. Set a target. Build discipline." That reads as an
  // answer, and it was the wrong one.
  if (accountsLoading || goalsLoading || carFundsLoading) return <GoalsSkeleton />;

  return (
    <div className={embedded ? 'stack-section overflow-x-hidden' : 'py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {!embedded && <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Goals</h1>}
          </div>
          {!embedded && <p className="text-xs text-muted-foreground mt-0.5">Build your financial runway</p>}
        </div>
        <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row sm:shrink-0">
          {(isPremium || isDemo || goals.length < 3) ? (
            <button onClick={() => openAdd('Custom')} className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}><Plus size={12} /> Add Goal</button>
          ) : (
            <Link to="/premium" className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-primary/20 text-primary px-3 py-1.5 text-xs font-medium btn-press hover:bg-primary/30 transition-colors" style={{ borderRadius: 'var(--radius)' }}><Crown size={12} /> Add Goal</Link>
          )}
          <Link to="/debt?tab=auto" className="w-full sm:w-auto flex items-center justify-center gap-1.5 border border-border text-foreground px-3 py-1.5 text-xs font-medium btn-press hover:bg-muted/30" style={{ borderRadius: 'var(--radius)' }}><Car size={12} /> Vehicles</Link>
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Savings goals — track every target in one place</p>
              <p className="text-xs text-muted-foreground mt-0.5">Jordan is building an emergency fund. Goals link to real accounts and auto-sync balances.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {[
              { label: 'Emergency Fund', desc: 'Linked to Marcus HYS — the $5,800 balance auto-syncs here. Monthly $300 contribution tracked against the $15,000 target.' },
              { label: 'Linked accounts', desc: 'When an account is linked, "current saved" always reflects the live balance — no manual updates needed.' },
              { label: 'Connects to Forecast', desc: 'Monthly contributions here are deducted in the Forecast before sizing debt payments — goals don\'t compete with the debt engine.' },
              { label: 'Vehicles', desc: 'Car goals have moved to the Vehicles page — save for a down payment, then track the full loan to payoff.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {carFunds.length > 0 && (
        <Link to="/debt?tab=auto" className="card-forged p-3 flex items-center gap-3 hover:border-primary/30 transition-colors">
          <Car size={16} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">You have {carFunds.length} vehicle{carFunds.length > 1 ? 's' : ''} tracked</p>
            <p className="text-xs text-muted-foreground">Car funds live on Debt Payoff — view saving progress &amp; loan details on its Auto Loans tab →</p>
          </div>
        </Link>
      )}

      <SavingsGrowthChart goals={allGoals} extraByGoal={autoExtraByGoal} essentialMonthlyExpenses={essentialMonthlyExpenses} />

      <SurplusRankingSection
        cardsSubtitle={cardsRankSubtitle}
        autoExtraByTarget={autoExtraByGoal}
        ownMonthlyByTarget={ownMonthlyByTarget}
        capacityByMonth={surplusCapacityByMonth}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Total Saved</p><p className="text-lg font-display font-bold text-success">{formatCurrency(totalSaved, false)}</p></div>
        <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Total Target</p><p className="text-lg font-display font-bold text-foreground">{formatCurrency(totalTarget, false)}</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allGoals.map(g => {
          // THE CARD SHOWS THE STOP, NOT THE TOTAL (Tre, 2026-08-26: "the card should be edited to
          // reflect such stages ... and the original fund goal date should show per stage instead").
          // A staged goal measured against its full total reads as barely started for years, and
          // the one number it should be showing — what the next stop needs — is nowhere on it.
          const plan = goalStages(g, essentialMonthlyExpenses);
          // ⚠️ PROGRESS COUNTS MONEY ALREADY SPENT. Thresholds are cumulative against the live
          // balance, so the month the move fund's $5,730 leaves the account the plan would read
          // "stop 1 unfilled" and start saving for a move that has already happened. Progress
          // through a plan and the balance in the account are not the same thing.
          const saved = goalSavedIncludingSpent(g, essentialMonthlyExpenses, new Date());
          const nowStop = plan.stops.find(s => saved < s.threshold - 0.005) ?? plan.stops[plan.stops.length - 1];
          const headlineTarget = plan.staged ? nowStop.threshold : Number(g.target_amount);
          const pct = headlineTarget > 0 ? (saved / headlineTarget) * 100 : 0;
          const isLinked = !!g.linked_account && accountMap[g.linked_account];
          const linkedAcct = isLinked ? accountMap[g.linked_account!] : null;
          const linkedAccountType = linkedAcct?.account_type ?? '';
          const isRothIra = ['roth_ira', 'ira', '401k', 'hsa'].includes(linkedAccountType) || (g.goal_type || '').toLowerCase() === 'retirement';
          const goalLumps: GoalLumpSum[] = Array.isArray(g.lump_sum_payments) ? (g.lump_sum_payments as unknown as GoalLumpSum[]) : [];

          return (
            <div key={g.id} className="card-forged p-4 space-y-3 hover:border-primary/20 transition-colors">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold wrap-break-word">{g.name}</h3>
                    <span className="text-[9px] px-1.5 py-0.5 bg-muted/50 border border-border text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>{g.goal_type || 'Custom'}</span>
                    {isLinked && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                        <Link2 size={8} /> {linkedAcct?.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground wrap-break-word leading-relaxed">
                    {g.is_complete
                      ? <span className="text-success">Target reached · contributions no longer counted{g.linked_rules && g.linked_rules.length > 0 ? ` (${g.linked_rules.map(r => r.name).join(', ')} still active)` : ''}</span>
                      : g.linked_rules && g.linked_rules.length > 0
                      ? <span className="text-primary/80">{formatCurrency(Number(g.monthly_contribution), false)}/mo · via {g.linked_rules.map(r => r.name).join(', ')}</span>
                      : `${formatCurrency(Number(g.monthly_contribution), false)}/mo contribution`
                    }
                    {isLinked && ' · Auto-synced from account'}
                    {g.available_after_outflows != null && (
                      <span className="ml-1 text-muted-foreground">· Available after bills: {formatCurrency(g.available_after_outflows, false)}</span>
                    )}
                  </p>
                  {/* Never let the end_date this feature wrote onto a rule be invisible here. */}
                  {g.auto_end_contributions && autoEndLabel(g.auto_end_stamped_rules) && (
                    <p className="text-[10px] text-primary/80 mt-0.5">
                      Auto-ends contributions {autoEndLabel(g.auto_end_stamped_rules)}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0 self-end sm:self-auto">
                  <button onClick={() => handleDuplicate(g)} className="icon-btn text-muted-foreground hover:text-primary" title="Duplicate"><Copy size={13} /></button>
                  <button onClick={() => openEdit(g)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(g.id!)} className={`icon-btn ${deleteConfirm === g.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <span className="text-lg font-display font-bold text-primary wrap-break-word">{formatCurrency(Number(g.current_amount), false)}</span>
                <span className="text-xs text-muted-foreground">
                  of {formatCurrency(headlineTarget, false)}
                  {plan.staged && <span className="ml-1">· {nowStop.name}</span>}
                </span>
              </div>
              <ProgressBar value={saved} max={headlineTarget} color={pct >= 100 ? 'success' : 'gold'} />

              {/* THE PLAN, one line per stop. Each says what it needs, when it is wanted, and where
                  it is: done, being filled now, or waiting. A stop that is done is struck through
                  rather than deleted, because the card is the one place the whole sequence should
                  still be visible — it is the RANKED LIST that drops a filled stop. */}
              {plan.staged && (
                <ul className="space-y-1 border-t border-border/40 pt-2">
                  {plan.stops.map(s => {
                    const done = saved >= s.threshold - 0.005;
                    const isNow = !done && s.index === nowStop.index;
                    return (
                      <li key={s.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className={`min-w-0 wrap-break-word ${done ? 'text-muted-foreground line-through' : isNow ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {s.index}. {s.name}
                          {s.spends && (
                            <span className="ml-1 text-[10px] text-muted-foreground">· spent</span>
                          )}
                          {s.targetDate && (
                            <span className="ml-1 text-muted-foreground">
                              by {new Date(`${s.targetDate.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {formatCurrency(s.threshold, false)}
                          {done
                            ? <span className="ml-1.5 text-success">done</span>
                            : isNow
                              ? <span className="ml-1.5 text-primary">now</span>
                              : s.afterCards
                                ? <span className="ml-1.5">after cards</span>
                                : <span className="ml-1.5">queued</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
                <span>{pct.toFixed(0)}% complete</span>
                <span>Est. completion: {estimateCompletion(g)}</span>
              </div>
              {!isDemo && (
                <GoalLumpSumPanel
                  autoExtraOn={g.auto_extra === true}
                  lumpSums={goalLumps}
                  onSave={lumps => handleSaveLumpSums(g.id!, lumps)}
                  liquidCash={liquidCash}
                  currentAmount={Number(g.current_amount)}
                  monthlyContrib={Number(g.monthly_contribution)}
                  targetAmount={Number(g.target_amount)}
                  isRothIra={isRothIra}
                  apyRate={g.effective_apy || 0}
                />
              )}
            </div>
          );
        })}
      </div>

      {allGoals.length === 0 && (
        <div className="card-forged p-12 text-center"><p className="text-sm text-muted-foreground">No savings goals yet.</p><p className="text-xs text-muted-foreground mt-1">Set a target. Build discipline.</p></div>
      )}

      {showForm && (
        <FormModal
          title={editId ? 'Edit Goal' : 'New Savings Goal'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          draftRestored={draftRestored}
          onDiscardDraft={handleDiscardDraft}
          onClose={() => setShowForm(false)}
          saving={add.isPending || update.isPending}
          saveLabel={editId ? 'Update Goal' : 'Add Goal'}
        >
          {/* ── THE PLANNED STOPS ────────────────────────────────────────────────────
              One goal, N thresholds, one balance. Not N goals: a goal linked to a savings account
              resolves its balance FROM that account, so several goals on one account all read as
              funded and the savings get double-counted. */}
          <GoalStopsEditor
            stops={stops}
            onChange={setStops}
            essentialMonthlyExpenses={essentialMonthlyExpenses}
          />
          {!hasStops && stops.length === 0 && (
            <button
              type="button"
              onClick={() => setStops([
                newStopDraft({ name: 'First target', mode: 'amount', amount: form.target_amount || '', targetDate: form.target_date || '' }),
                newStopDraft({ name: 'Emergency runway', mode: 'months', months: '3' }),
                newStopDraft({ name: 'Full runway', mode: 'months', months: '3', afterCards: true }),
              ])}
              className="text-[10px] text-primary hover:underline text-left"
            >
              Use the emergency-runway plan: this target, then 3 months of expenses, then 3 more once your cards are clear
            </button>
          )}

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Transfer Rules (auto-sync contributions)</label>
            {transferRuleOptions.filter(o => o.value).length === 0 ? (
              <p className="text-xs text-muted-foreground">No active transfer or investment rules found.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {transferRuleOptions.filter(o => o.value).map(o => {
                  const active = selectedRuleIds.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setSelectedRuleIds(prev =>
                        active ? prev.filter(id => id !== o.value) : [...prev, o.value]
                      )}
                      className={`px-3 py-1.5 text-xs border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'}`}
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedRuleIds.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Total: {formatCurrency(
                  selectedRuleIds.reduce((s, id) => {
                    const r = rules.find(r => r.id === id);
                    return r ? s + toMonthly(r.amount, r.frequency) : s;
                  }, 0),
                  false
                )}/mo · Monthly contribution and start date auto-synced from rules
              </p>
            )}
            {selectedRuleIds.length > 0 && (
              <button
                type="button"
                onClick={() => setAutoEnd(v => !v)}
                className="w-full flex items-start gap-2.5 text-left p-2.5 bg-secondary/30 border border-border/50 hover:border-primary/30 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
                aria-pressed={autoEnd}
              >
                <span
                  className={`shrink-0 mt-0.5 w-4 h-4 border flex items-center justify-center ${autoEnd ? 'bg-primary border-primary text-primary-foreground' : 'border-border'}`}
                  style={{ borderRadius: 'calc(var(--radius) / 2)' }}
                >
                  {autoEnd && <Check size={11} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-foreground">Stop contributions when this goal is reached</span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    Sets an end date on {selectedRuleIds.length === 1 ? 'the rule above' : 'the rules above'} at the projected
                    completion month, visible in Budget Control. Revised whenever you save this goal; an end date you set
                    yourself is never changed.
                  </span>
                </span>
              </button>
            )}
          </div>
        </FormModal>
      )}
    </div>
  );
}
