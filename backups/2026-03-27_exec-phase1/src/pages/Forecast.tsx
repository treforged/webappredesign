import { useState, useMemo, useCallback } from 'react';
import { formatCurrency } from '@/lib/calculations';
import { usePersistedState } from '@/hooks/usePersistedState';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { useDebts, useSavingsGoals, useCarFunds, useAccounts, useSubscriptions, useBudgetItems, useProfile, useRecurringRules, useTransactions } from '@/hooks/useSupabaseData';
import { generateScheduledEvents, aggregateByMonth } from '@/lib/scheduling';
import { simulateVariablePayoff, buildCardData, projectCardVariable, getCurrentMonthDebtRecommendations } from '@/lib/credit-card-engine';
import { getDebtPaymentsByMonth, getDebtBalancesByMonth } from '@/lib/debt-transaction-generator';
import { buildPayConfig, getMonthNetIncome, getPaychecksInMonth, getMinSafeCash, mergeWithGeneratedTransactions } from '@/lib/pay-schedule';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Bar, ComposedChart, ReferenceLine, Area, AreaChart,
} from 'recharts';
import { Settings2, List, BarChart3, TrendingUp, CreditCard, Info, X } from 'lucide-react';

function CalcDrawer({ open, onClose, title, lines }: { open: boolean; onClose: () => void; title: string; lines: { label: string; value: string; op?: string }[] }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="card-forged p-4 sm:p-6 w-full max-w-md space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2 min-w-0"><Info size={14} className="text-primary shrink-0" /> <span className="truncate">{title}</span></h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 p-1"><X size={16} /></button>
        </div>
        <div className="space-y-2 pt-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0 gap-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                {l.op && <span className="text-primary font-bold shrink-0">{l.op}</span>}
                <span className="truncate">{l.label}</span>
              </span>
              <span className="text-xs font-display font-bold text-foreground whitespace-nowrap shrink-0">{l.value}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground pt-2 border-t border-border/30">
          A negative monthly cash flow can be acceptable if prior saved cash covers the difference and ending cash stays above the required floor. One-time purchases (e.g. car down payment) reduce available cash and may auto-adjust debt recommendations.
        </p>
      </div>
    </div>
  );
}

function ForecastTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border p-2 sm:p-3 text-[10px] sm:text-xs space-y-1 max-w-[200px] sm:max-w-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-display font-bold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-2 sm:gap-3">
          <span className="flex items-center gap-1 truncate"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />{p.name}</span>
          <span className="font-display font-bold shrink-0">{formatCurrency(p.value, false)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Forecast() {
  const { data: debts } = useDebts();
  const { data: goals } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: accounts } = useAccounts();
  const { data: subs } = useSubscriptions();
  const { data: budgetItems } = useBudgetItems();
  const { data: profile } = useProfile();
  const { data: rules } = useRecurringRules();
  const { data: transactions } = useTransactions();

  const [assumptions, setAssumptions] = usePersistedState('tre:forecast:assumptions', {
    incomeGrowth: 3, investmentGrowth: 7, savingsInterest: 4.5, expenseGrowth: 2.5, bonusIncome: 0, taxOverride: 0,
  });
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [filterYear, setFilterYear] = usePersistedState<'all' | '1' | '2' | '3'>('tre:forecast:filterYear', 'all');
  const [chartMode, setChartMode] = usePersistedState<'combo' | 'line'>('tre:forecast:chartMode', 'combo');
  const [viewMode, setViewMode] = usePersistedState<'monthly' | 'detailed'>('tre:forecast:viewMode', 'monthly');
  const [hiddenSeries, setHiddenSeries] = usePersistedState<string[]>('tre:forecast:hidden', []);
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);

  const toggleSeries = useCallback((key: string) => {
    setHiddenSeries((prev: string[]) => {
      const next = prev.includes(key) ? prev.filter((k: string) => k !== key) : [...prev, key];
      return next;
    });
  }, [setHiddenSeries]);

  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);
  const scheduledEvents = useMemo(() => generateScheduledEvents(rules, accounts, 36), [rules, accounts]);
  const monthlyAggregates = useMemo(() => aggregateByMonth(scheduledEvents), [scheduledEvents]);

  const debtPayoffOptions = useMemo(() => ({
    strategy: 'avalanche' as const,
    paymentMode: 'variable' as const,
    cashFloor: Number(profile?.cash_floor) || 1000,
    overrides: {} as Record<string, Record<number, number>>,
  }), [profile]);

  const debtPaymentsByMonth = useMemo(() =>
    getDebtPaymentsByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, 36),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions],
  );

  const debtBalancesByMonth = useMemo(() =>
    getDebtBalancesByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, 36),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions],
  );

  // Current-month recommended debt total — ensures forecast month 0 matches Debt Payoff
  const currentMonthRecommendedDebt = useMemo(() => {
    try {
      const allTxns = mergeWithGeneratedTransactions(transactions, rules, accounts);
      const recs = getCurrentMonthDebtRecommendations(accounts, allTxns, rules, debts, profile);
      return recs.reduce((s, r) => s + r.payment, 0);
    } catch { return null; }
  }, [accounts, transactions, rules, debts, profile]);

  const cardProjectionData = useMemo(() => {
    try {
      const cards = buildCardData(accounts, transactions, rules, debts);
      if (cards.length === 0) return null;

      const liquidTypes = ['checking', 'business_checking', 'cash'];
      const liquidCash = accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type))
        .reduce((s: number, a: any) => s + Number(a.balance), 0);
      const weeklyGross = Number(profile?.weekly_gross_income) || 1875;
      const taxRate = Number(profile?.tax_rate) || 22;
      const monthlyTakeHome = weeklyGross * (1 - taxRate / 100) * 4.33;
      const monthlyExpenses = rules.filter((r: any) => r.active && r.rule_type === 'expense')
        .reduce((s: number, r: any) => {
          const amt = Number(r.amount);
          if (r.frequency === 'weekly') return s + amt * 4.33;
          if (r.frequency === 'yearly') return s + amt / 12;
          return s + amt;
        }, 0);

      // Build per-month event arrays (C1 / C5): month 0 = today→EOM, months 1+ = full month
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const monthEvents: { income: number; expenses: number }[] = Array.from({ length: 36 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const eventsInMonth = scheduledEvents
          .filter(e => e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr))
          .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.type === 'expense' ? -1 : 1));
        return {
          income: eventsInMonth.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0),
          expenses: eventsInMonth.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0),
        };
      });

      const projs = (() => {
        const sim = simulateVariablePayoff(cards, liquidCash, debtPayoffOptions.cashFloor, 'avalanche', monthlyTakeHome, monthlyExpenses, 36, monthEvents);
        return cards.map(c => {
          const pays = sim.monthlyPayments.get(c.id) || [];
          return projectCardVariable(c, pays, 36);
        });
      })();

      const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
      const data = Array.from({ length: 36 }, (_, i) => {
        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const row: any = { month: d.toLocaleString('en', { month: 'short', year: '2-digit' }), totalCCBalance: 0, totalInterest: 0 };
        for (const p of projs) {
          const m = p.months[i];
          if (m) {
            row[p.card.name] = Math.round(m.endBalance);
            row.totalCCBalance += m.endBalance;
            row.totalInterest += m.interest;
          }
        }
        row.totalCCBalance = Math.round(Math.max(0, row.totalCCBalance));
        row.totalInterest = Math.round(row.totalInterest);
        row.utilization = totalLimit > 0 ? Math.round((row.totalCCBalance / totalLimit) * 100) : 0;
        return row;
      });
      return { data, cards: projs.map(p => ({ name: p.card.name, color: p.card.color })) };
    } catch { return null; }
  }, [accounts, transactions, rules, debts, profile, debtPayoffOptions, payConfig, scheduledEvents]);

  // One-time manual transactions for forecast
  const oneTimeByMonth = useMemo(() => {
    const result: Record<string, { income: number; expense: number }> = {};
    for (const t of transactions) {
      if ((t as any).isGenerated) continue;
      const monthKey = t.date?.substring(0, 7);
      if (!monthKey) continue;
      if (!result[monthKey]) result[monthKey] = { income: 0, expense: 0 };
      if (t.type === 'income') result[monthKey].income += Number(t.amount);
      else result[monthKey].expense += Number(t.amount);
    }
    return result;
  }, [transactions]);

  const projections = useMemo(() => {
    const taxRate = assumptions.taxOverride || Number((profile as any)?.tax_rate) || 22;
    const cashFloor = Number((profile as any)?.cash_floor) || 1000;

    const active = accounts.filter((a: any) => a.active);
    // FIX: Aligned with debt engine — only checking/business_checking/cash are "liquid"
    // for cash floor and debt payment purposes. Savings/HYS are tracked in savingsBal
    // separately and appear in net worth but NOT in ending cash calculations.
    const liquidTypes = ['checking', 'business_checking', 'cash'];
    const investTypes = ['brokerage'];
    const retireTypes = ['roth_ira', '401k'];
    const liabilityTypes = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];

    let liquidBal = active.filter((a: any) => liquidTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    let investBal = active.filter((a: any) => investTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    let retireBal = active.filter((a: any) => retireTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    let totalLiabilityBal = active.filter((a: any) => liabilityTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);

    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));
    let savingsBal = goals.reduce((s: number, g: any) => {
      if (g.linked_account && accountMap.has(g.linked_account)) {
        return s + Number(accountMap.get(g.linked_account).balance);
      }
      return s + Number(g.current_amount);
    }, 0);

    const monthlyInvestGrowth = Math.pow(1 + assumptions.investmentGrowth / 100, 1 / 12) - 1;
    const monthlySavingsInterest = Math.pow(1 + assumptions.savingsInterest / 100, 1 / 12) - 1;
    const monthlyIncomeGrowth = Math.pow(1 + assumptions.incomeGrowth / 100, 1 / 12) - 1;
    // FIX #1: Apply expense growth multiplier — was completely missing before
    const monthlyExpenseGrowth = Math.pow(1 + assumptions.expenseGrowth / 100, 1 / 12) - 1;

    const monthlySavingsContrib = goals.reduce((s: number, g: any) => s + Number(g.monthly_contribution), 0);
    const monthlyCarContrib = carFunds.reduce((s: number, c: any) => {
      const rem = Number(c.down_payment_goal) - Number(c.current_saved);
      return s + (rem > 0 ? Math.min(rem / 12, 500) : 0);
    }, 0);

    const transferRulesAll = rules.filter((r: any) => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'));

    const nowDate = new Date();

    // ═══ PASS 1: Compute base values without debt payment adjustments ═══
    const baseData: {
      monthLabel: string; monthKey: string; netIncome: number; baseExpenses: number;
      rawDebtPayment: number; monthTransfers: number; monthBrokerageContrib: number; monthRetireContrib: number; oneTimeNet: number;
      ccDebtBalance: number; otherDebtBalance: number; monthMinSafe: number;
    }[] = [];
    let incomeMultiplier = 1;
    let expenseMultiplier = 1;

    for (let i = 0; i < 36; i++) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const monthLabel = d.toLocaleString('en', { month: 'short', year: '2-digit' });
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      // FIX #2: Apply income growth to the payConfig correctly
      const adjustedConfig = { ...payConfig, weeklyGross: payConfig.weeklyGross * incomeMultiplier };
      const scheduled = monthlyAggregates[monthKey];
      const scheduledIncome = scheduled?.income || 0;
      const fallbackTakeHome = getMonthNetIncome(adjustedConfig, d.getFullYear(), d.getMonth());

      // FIX #3: Income calculation - use scheduledIncome only for current month (i===0),
      // for future months always use fallback with growth applied since scheduled events
      // use the base amount without growth
      let netIncome: number;
      if (i === 0 && scheduledIncome > 0) {
        netIncome = scheduledIncome + assumptions.bonusIncome / 12;
      } else {
        netIncome = fallbackTakeHome + assumptions.bonusIncome / 12;
      }

      // FIX #4: Expenses — apply expense growth multiplier for future months
      const scheduledExpenses = scheduled?.expenses || 0;
      const budgetFallback = budgetItems.reduce((s: number, b: any) => s + Number(b.amount), 0);
      let baseExpenses: number;
      if (i === 0 && scheduledExpenses > 0) {
        baseExpenses = scheduledExpenses;
      } else if (scheduledExpenses > 0) {
        baseExpenses = scheduledExpenses * expenseMultiplier;
      } else {
        baseExpenses = budgetFallback * expenseMultiplier;
      }

      let rawDebtPayment = (i === 0 && currentMonthRecommendedDebt !== null)
        ? currentMonthRecommendedDebt
        : (debtPaymentsByMonth[monthKey] || 0);

      // FIX #5: Only fall back to minimum payments if debt engine returned 0 but balance > 0
      if (rawDebtPayment <= 0) {
        const debtRow = debtBalancesByMonth[i];
        if (debtRow && debtRow.totalBalance > 0) {
          const fcCards = buildCardData(accounts, transactions, rules, debts);
          const totalMinPayments = fcCards.filter(c => !c.autopayFullBalance && c.balance > 0)
            .reduce((s, c) => s + Math.max(c.minPayment, c.monthlyNewPurchases), 0);
          if (totalMinPayments > 0) rawDebtPayment = totalMinPayments;
        }
      }

      let monthTransfers = 0;
      let monthBrokerageContrib = 0;
      let monthRetireContrib = 0;
      for (const tr of transferRulesAll) {
        if (tr.start_date && new Date(tr.start_date) > d) continue;
        if (tr.end_date && new Date(tr.end_date) < d) continue;
        const amt = Number(tr.amount);
        let monthAmt = amt;
        if (tr.frequency === 'weekly') monthAmt = amt * 4.33;
        else if (tr.frequency === 'yearly') monthAmt = amt / 12;
        monthTransfers += monthAmt;

        // Categorize by destination account type
        const destAcct = tr.deposit_account ? accountMap.get(tr.deposit_account) : null;
        const destType = destAcct?.account_type || '';
        if (['roth_ira', '401k'].includes(destType)) {
          monthRetireContrib += monthAmt;
        } else if (['brokerage'].includes(destType)) {
          monthBrokerageContrib += monthAmt;
        }
      }

      const oneTime = oneTimeByMonth[monthKey] || { income: 0, expense: 0 };
      const oneTimeNet = oneTime.income - oneTime.expense;

      const debtBalanceRow = debtBalancesByMonth[i];
      const ccDebtBalance = debtBalanceRow ? debtBalanceRow.totalBalance : 0;

      const nonCCLiabilities = active
        .filter((a: any) => !['credit_card'].includes(a.account_type) && liabilityTypes.includes(a.account_type))
        .reduce((s: number, a: any) => s + Number(a.balance), 0);
      const otherDebtPayments = debts
        .filter((dd: any) => !accounts.some((a: any) => a.account_type === 'credit_card' && a.name.toLowerCase() === dd.name.toLowerCase()))
        .reduce((s: number, dd: any) => s + Number(dd.target_payment), 0);
      const otherDebtBalance = Math.max(0, nonCCLiabilities - otherDebtPayments * i);

      const monthMinSafe = getMinSafeCash(rules, payConfig, cashFloor, null, d);

      baseData.push({
        monthLabel, monthKey, netIncome, baseExpenses, rawDebtPayment,
        monthTransfers, monthBrokerageContrib, monthRetireContrib, oneTimeNet, ccDebtBalance, otherDebtBalance, monthMinSafe,
      });

      incomeMultiplier *= (1 + monthlyIncomeGrowth);
      // FIX #6: Apply expense growth each month
      expenseMultiplier *= (1 + monthlyExpenseGrowth);
    }

    // ═══ PASS 2: Look-ahead — iteratively reduce debt payments to maintain cash floor ═══
    const debtPayments = baseData.map(b => b.rawDebtPayment);

    // Helper: recompute simulated cash from scratch
    const recomputeSimCash = (simCash: number[]) => {
      let bal = liquidBal;
      for (let i = 0; i < 36; i++) {
        const b = baseData[i];
        const totalOut = b.baseExpenses + debtPayments[i] + monthlySavingsContrib + monthlyCarContrib + b.monthTransfers;
        bal += b.netIncome - totalOut + b.oneTimeNet;
        simCash[i] = bal;
      }
    };

    const simCash: number[] = Array.from({ length: 36 });
    recomputeSimCash(simCash);

    const minAdjustableMonthIndex = currentMonthRecommendedDebt !== null ? 1 : 0;

    // FIX #7: Improved cash floor enforcement — scan backward from breached month
    // to find months with reducible debt payments, and also recompute after EACH fix
    for (let pass = 0; pass < 10; pass++) {
      let anyFixed = false;
      for (let i = 0; i < 36; i++) {
        if (simCash[i] >= baseData[i].monthMinSafe) continue;
        const shortfall = baseData[i].monthMinSafe - simCash[i];
        let toRecover = shortfall;

        // Reduce debt payments from the breached month backward
        for (let j = i; j >= minAdjustableMonthIndex && toRecover > 0; j--) {
          const canReduce = Math.min(debtPayments[j], toRecover);
          if (canReduce > 0) {
            debtPayments[j] -= canReduce;
            toRecover -= canReduce;
            anyFixed = true;
          }
        }

        // FIX #8: Recompute after each individual month fix to cascade correctly
        if (anyFixed) {
          recomputeSimCash(simCash);
          break; // restart full scan from month 0 to catch cascading effects
        }
      }
      if (!anyFixed) break;
    }

    // ═══ PASS 3: Build final projection data ═══
    let finalLiquid = liquidBal;
    const data: any[] = [];
    const milestones: { month: string; event: string }[] = [];

    for (let i = 0; i < 36; i++) {
      const b = baseData[i];
      let monthDebtPayment = debtPayments[i];
      const startingCash = Math.round(finalLiquid);

      totalLiabilityBal = b.ccDebtBalance + b.otherDebtBalance;

      const investGrowthAmt = Math.round(investBal * monthlyInvestGrowth * 100) / 100;
      const retireGrowthAmt = Math.round(retireBal * monthlyInvestGrowth * 100) / 100;

      savingsBal += monthlySavingsContrib;
      savingsBal *= (1 + monthlySavingsInterest);
      investBal += b.monthBrokerageContrib;
      investBal *= (1 + monthlyInvestGrowth);
      retireBal += b.monthRetireContrib;
      retireBal *= (1 + monthlyInvestGrowth);

      let totalMonthlyOut = b.baseExpenses + monthDebtPayment + monthlySavingsContrib + monthlyCarContrib + b.monthTransfers;

      finalLiquid += b.netIncome - totalMonthlyOut + b.oneTimeNet;

      // Final safety net for forecasted months
      if (i >= minAdjustableMonthIndex && finalLiquid < b.monthMinSafe) {
        const shortfall = b.monthMinSafe - finalLiquid;
        const adjustment = Math.min(shortfall, monthDebtPayment);
        finalLiquid += adjustment;
        monthDebtPayment -= adjustment;
        totalMonthlyOut -= adjustment;
      }

      // FIX #9: Don't floor at 0 — allow display of negative to alert user
      const endingCash = Math.round(finalLiquid);

      const totalAssets = finalLiquid + investBal + retireBal + savingsBal;
      const netWorth = totalAssets - totalLiabilityBal;

      if (b.ccDebtBalance <= 0 && i > 0 && (data[data.length - 1]?.debtBalance || 0) > 0) {
        milestones.push({ month: b.monthLabel, event: 'CC Debt Free! 🎉' });
      }
      goals.forEach((g: any) => {
        const projected = Number(g.current_amount) + Number(g.monthly_contribution) * i;
        if (projected >= Number(g.target_amount) && (i === 0 || Number(g.current_amount) + Number(g.monthly_contribution) * (i - 1) < Number(g.target_amount))) {
          milestones.push({ month: b.monthLabel, event: `${g.name} Complete! 🎯` });
        }
      });
      if (endingCash < 0 && (i === 0 || data[data.length - 1]?.endingCash >= 0)) {
        milestones.push({ month: b.monthLabel, event: '⚠️ Cash goes negative!' });
      } else if (endingCash >= 0 && endingCash < b.monthMinSafe && (i === 0 || (data.length > 0 && data[data.length - 1]?.endingCash >= baseData[Math.max(0, i - 1)].monthMinSafe))) {
        milestones.push({ month: b.monthLabel, event: '⚠️ Cash below safe minimum' });
      }

      data.push({
        month: b.monthLabel, netWorth: Math.round(netWorth), totalAssets: Math.round(totalAssets),
        totalLiabilities: Math.round(totalLiabilityBal), debtBalance: Math.round(b.ccDebtBalance + b.otherDebtBalance),
        savingsBalance: Math.round(savingsBal), investmentBalance: Math.round(investBal),
        retirementBalance: Math.round(retireBal), liquidCash: Math.round(finalLiquid),
        endingCash,
        startingCash,
        takeHome: Math.round(b.netIncome), totalExpenses: Math.round(totalMonthlyOut),
        debtPayment: Math.round(monthDebtPayment),
        brokerageContrib: Math.round(b.monthBrokerageContrib),
        retireContrib: Math.round(b.monthRetireContrib),
        investGrowth: Math.round(investGrowthAmt),
        retireGrowth: Math.round(retireGrowthAmt),
        oneTimeNet: Math.round(b.oneTimeNet),
        monthMinSafe: Math.round(b.monthMinSafe),
      });
    }

    return { data, milestones };
  }, [debts, goals, carFunds, accounts, subs, budgetItems, profile, assumptions, rules, monthlyAggregates, debtPaymentsByMonth, debtBalancesByMonth, payConfig, oneTimeByMonth, transactions, currentMonthRecommendedDebt]);

  const filteredData = useMemo(() => {
    if (filterYear === 'all') return projections.data;
    const yr = parseInt(filterYear);
    return projections.data.slice((yr - 1) * 12, yr * 12);
  }, [projections.data, filterYear]);

  const detailedEvents = useMemo(() => {
    if (filterYear === 'all') return scheduledEvents.slice(0, 100);
    const yr = parseInt(filterYear);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + (yr - 1) * 12, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + yr * 12, 0);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    return scheduledEvents.filter(e => e.date >= startStr && e.date <= endStr).slice(0, 100);
  }, [scheduledEvents, filterYear]);

  const gridStroke = 'hsl(0, 0%, 18%)';
  const tickStyle = { fontSize: 10, fill: 'hsl(240, 4%, 50%)' };
  const xInterval = filterYear === 'all' ? 2 : 0;

  // Helper to check visibility — a series is visible if NOT in hiddenSeries
  const isVisible = (key: string) => !hiddenSeries.includes(key);

  return (
    <div className="p-3 sm:p-4 lg:p-8 max-w-7xl mx-auto space-y-4 sm:space-y-6 lg:space-y-8">
      <div className="flex items-start sm:items-center justify-between flex-wrap gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg sm:text-2xl lg:text-3xl tracking-tight">Forecast</h1>
            <p className="text-[10px] sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 truncate">36-month projections driven by live data</p>
          </div>
          <InstructionsModal pageTitle="Forecast Guide" sections={[
            { title: 'What is this page?', body: 'The Forecast projects your financial trajectory over the next 36 months using your live accounts, recurring rules, debt payoff plan, savings goals, and one-time manual transactions.' },
            { title: 'How projections work', body: 'Each month computes: Take-Home Income + One-Time Income − Expenses − One-Time Expenses − Debt Payments − Transfers = Monthly Remaining. Ending Cash carries forward and must stay above the required safe minimum.' },
            { title: 'Look-ahead floor protection', body: 'The forecast engine proactively reduces earlier extra debt payments when a known future one-time purchase or cash drain would make a later month fall below the safe minimum. Minimums are still paid; only extra payments are reduced first.' },
            { title: 'One-time transactions', body: 'Manual transactions (e.g. car down payments, travel, bonuses) remain fixed. Debt payments flex to preserve the cash floor. One-time income before the due date is included in cash projections.' },
            { title: 'Savings & Liquid Cash', body: 'Ending Cash reflects only checking and cash accounts — savings and HYS are excluded to match the Debt Payoff engine. This protects emergency funds from being counted as available for debt payments. Savings balances still appear in Net Worth projections.' },
            { title: 'Charts & Legends', body: 'Click any legend item to toggle that series off/on. Hidden items are grayed out. Click again to restore. No refresh needed — your preferences are saved.' },
            { title: 'Cash Safety', body: 'Ending Cash enforces the Recommended Safe Minimum = max(your cash floor, pre-paycheck next-month bills). Debt payments automatically decrease to maintain the safety reserve. Minimums are always prioritized.' },
          ]} />
        </div>
        <div className="flex gap-1.5 sm:gap-2 flex-wrap">
          <button onClick={() => setChartMode(chartMode === 'combo' ? 'line' : 'combo')}
            className="flex items-center gap-1 sm:gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            <TrendingUp size={12} /> {chartMode === 'combo' ? 'Line' : 'Bars'}
          </button>
          <button onClick={() => setViewMode(viewMode === 'monthly' ? 'detailed' : 'monthly')}
            className="flex items-center gap-1 sm:gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            {viewMode === 'monthly' ? <List size={12} /> : <BarChart3 size={12} />} {viewMode === 'monthly' ? 'Detail' : 'Summary'}
          </button>
          <button onClick={() => setShowAssumptions(!showAssumptions)} className="flex items-center gap-1 sm:gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            <Settings2 size={12} /> Assumptions
          </button>
        </div>
      </div>

      {showAssumptions && (
        <div className="card-forged p-3 sm:p-5 space-y-3 sm:space-y-4">
          <h3 className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Forecast Assumptions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {[
              { key: 'incomeGrowth', label: 'Income Growth %' },
              { key: 'investmentGrowth', label: 'Investment Growth %' },
              { key: 'savingsInterest', label: 'Savings Interest %' },
              { key: 'expenseGrowth', label: 'Expense Growth %' },
              { key: 'bonusIncome', label: 'Bonus Income $' },
              { key: 'taxOverride', label: 'Tax Override %' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">{label}</label>
                <input type="number" value={(assumptions as any)[key]}
                  onChange={e => setAssumptions(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                  className="w-full mt-1 bg-secondary border border-border px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="0.1" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Year Filter */}
      <div className="flex gap-1.5 sm:gap-2 overflow-x-auto">
        {(['all', '1', '2', '3'] as const).map(yr => (
          <button key={yr} onClick={() => setFilterYear(yr)} className={`px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium border btn-press whitespace-nowrap ${filterYear === yr ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
            {yr === 'all' ? 'All 36 Months' : `Year ${yr}`}
          </button>
        ))}
      </div>

      {/* Milestones */}
      {projections.milestones.length > 0 && (
        <div className="card-forged p-3 sm:p-4 space-y-2">
          <h3 className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Milestones</h3>
          <div className="flex flex-wrap gap-2">
            {projections.milestones.map((m, i) => (
              <span key={i} className="bg-primary/10 text-primary px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-medium" style={{ borderRadius: 'var(--radius)' }}>
                {m.month}: {m.event}
              </span>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'monthly' ? (
        <>
          {/* Net Worth Chart */}
          <div className="card-forged p-3 sm:p-5">
            <h3 className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4">Net Worth & Assets Projection</h3>
            <ResponsiveContainer width="100%" height={280}>
              {chartMode === 'combo' ? (
                <ComposedChart data={filteredData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={tickStyle} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend onClick={e => toggleSeries(e.dataKey as string)} formatter={(value, entry) => (
                    <span style={{ color: hiddenSeries.includes(entry.dataKey as string) ? '#555' : entry.color, cursor: 'pointer', fontSize: 10 }}>{value}</span>
                  )} wrapperStyle={{ fontSize: 10 }} />
                  {isVisible('netWorth') && <Line type="monotone" dataKey="netWorth" name="Net Worth" stroke="hsl(47, 100%, 50%)" strokeWidth={2.5} dot={false} />}
                  {isVisible('totalAssets') && <Bar dataKey="totalAssets" name="Assets" fill="hsl(142, 71%, 45%)" opacity={0.3} />}
                  {isVisible('totalLiabilities') && <Bar dataKey="totalLiabilities" name="Liabilities" fill="hsl(0, 84%, 60%)" opacity={0.3} />}
                  {isVisible('endingCash') && <Line type="monotone" dataKey="endingCash" name="Ending Cash" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />}
                </ComposedChart>
              ) : (
                <LineChart data={filteredData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={tickStyle} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend onClick={e => toggleSeries(e.dataKey as string)} formatter={(value, entry) => (
                    <span style={{ color: hiddenSeries.includes(entry.dataKey as string) ? '#555' : entry.color, cursor: 'pointer', fontSize: 10 }}>{value}</span>
                  )} wrapperStyle={{ fontSize: 10 }} />
                  {isVisible('netWorth') && <Line type="monotone" dataKey="netWorth" name="Net Worth" stroke="hsl(47, 100%, 50%)" strokeWidth={2.5} dot={false} />}
                  {isVisible('investmentBalance') && <Line type="monotone" dataKey="investmentBalance" name="Investments" stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} dot={false} />}
                  {isVisible('retirementBalance') && <Line type="monotone" dataKey="retirementBalance" name="Retirement" stroke="hsl(262, 83%, 58%)" strokeWidth={1.5} dot={false} />}
                  {isVisible('savingsBalance') && <Line type="monotone" dataKey="savingsBalance" name="Savings" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} />}
                  {isVisible('endingCash') && <Line type="monotone" dataKey="endingCash" name="Ending Cash" stroke="hsl(30, 100%, 50%)" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Debt Projection Chart */}
          {cardProjectionData && (
            <div className="card-forged p-3 sm:p-5">
              <h3 className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4 flex items-center gap-2"><CreditCard size={12} /> Credit Card Debt Payoff Trajectory</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={cardProjectionData.data.slice(0, filterYear === 'all' ? 36 : parseInt(filterYear) * 12)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={tickStyle} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {cardProjectionData.cards.map(c => (
                    <Area key={c.name} type="monotone" dataKey={c.name} stackId="1" fill={c.color} stroke={c.color} fillOpacity={0.4} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly Cash Flow Table */}
          <div className="card-forged p-3 sm:p-5 overflow-x-auto">
            <h3 className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4">Monthly Breakdown</h3>
            <div className="min-w-0">
              <table className="w-full text-[10px] sm:text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-1.5 sm:py-2 px-1 sm:px-2 text-left font-medium">Month</th>
                    <th className="py-1.5 sm:py-2 px-1 sm:px-2 text-left font-medium hidden sm:table-cell">Start</th>
                    <th className="py-1.5 sm:py-2 px-1 sm:px-2 text-left font-medium">End Cash</th>
                    <th className="py-1.5 sm:py-2 px-1 sm:px-2 text-left font-medium hidden sm:table-cell">Income</th>
                    <th className="py-1.5 sm:py-2 px-1 sm:px-2 text-left font-medium">Out</th>
                    <th className="py-1.5 sm:py-2 px-1 sm:px-2 text-left font-medium hidden sm:table-cell">One-Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((row: any, i: number) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-secondary/30 cursor-pointer" onClick={() => setCalcDrawer({
                      title: `${row.month} Breakdown`,
                      lines: [
                        { label: 'Starting Cash', value: formatCurrency(row.startingCash, false) },
                        { label: 'Take-Home Income', value: formatCurrency(row.takeHome, false), op: '+' },
                        { label: 'Expenses + Debt + Transfers', value: formatCurrency(row.totalExpenses, false), op: '−' },
                        { label: 'One-Time Net', value: formatCurrency(row.oneTimeNet || 0, false), op: row.oneTimeNet >= 0 ? '+' : '−' },
                        { label: 'Ending Cash', value: formatCurrency(row.endingCash, false), op: '=' },
                        { label: '', value: '' },
                        { label: 'Debt Payment', value: formatCurrency(row.debtPayment, false) },
                        { label: 'Brokerage Contrib', value: formatCurrency(row.brokerageContrib, false) },
                        { label: 'Retirement Contrib', value: formatCurrency(row.retireContrib, false) },
                        { label: 'Net Worth', value: formatCurrency(row.netWorth, false) },
                      ],
                    })}>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 font-medium">{row.month}</td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 hidden sm:table-cell">{formatCurrency(row.startingCash, false)}</td>
                      <td className={`py-1.5 sm:py-2 px-1 sm:px-2 font-bold ${row.endingCash < (row.monthMinSafe || 0) ? 'text-destructive' : 'text-success'}`}>
                        {formatCurrency(row.endingCash, false)}
                        {row.endingCash < 0 && <span className="ml-0.5 text-[8px]">⚠️</span>}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 hidden sm:table-cell">{formatCurrency(row.takeHome, false)}</td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2">{formatCurrency(row.totalExpenses, false)}</td>
                      <td className={`py-1.5 sm:py-2 px-1 sm:px-2 hidden sm:table-cell ${(row.oneTimeNet || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>{row.oneTimeNet ? formatCurrency(row.oneTimeNet, false) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="card-forged p-3 sm:p-5">
          <h3 className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4">Scheduled Events Timeline</h3>
          <div className="space-y-1">
            {detailedEvents.length === 0 && <p className="text-[10px] sm:text-xs text-muted-foreground text-center py-8">No recurring rules configured yet. Add rules in Budget Control to see scheduled events.</p>}
            {detailedEvents.map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 sm:py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className="text-[10px] sm:text-[11px] text-muted-foreground w-20 sm:w-24 font-mono shrink-0">{e.date}</span>
                  <span className="text-[10px] sm:text-xs font-medium truncate">{e.name}</span>
                  {e.source && <span className="text-[9px] sm:text-[10px] text-muted-foreground hidden sm:inline">· {e.source}</span>}
                </div>
                <span className={`text-[10px] sm:text-xs font-display font-bold shrink-0 ${e.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {e.type === 'income' ? '+' : '-'}{formatCurrency(e.amount, false)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <CalcDrawer
        open={!!calcDrawer}
        onClose={() => setCalcDrawer(null)}
        title={calcDrawer?.title || ''}
        lines={calcDrawer?.lines || []}
      />
    </div>
  );
}
