import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTransactions, useDebts, useSavingsGoals, useAccounts } from '@/hooks/useSupabaseData';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/lib/supabase';
import { tracedInvoke } from '@/lib/tracer';
import { formatCurrency } from '@/lib/calculations';
import { categorizeExpenses } from '@/lib/expense-filtering';
import PremiumGate from '@/components/shared/PremiumGate';
import {
  Sparkles, TrendingUp, AlertTriangle, CheckCircle2, Loader2,
  Send, RefreshCw, ChevronRight,
} from 'lucide-react';

interface Insight {
  type: 'positive' | 'warning' | 'action';
  title: string;
  body: string;
}

interface AdviceResult {
  summary: string;
  score: number;
  scoreLabel: string;
  insights: Insight[];
  nextMove: string;
}

const QUICK_QUESTIONS = [
  'Am I on track to be debt-free this year?',
  'Where should I cut spending first?',
  'How much more should I be saving?',
  'Is my savings rate good for my income?',
];

function ScoreRing({ score, label }: { score: number; label: string }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 80 ? '#22c55e' :
    pct >= 60 ? '#3b82f6' :
    pct >= 40 ? '#f59e0b' :
                '#ef4444';
  const r = 42;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="104" height="104" className="-rotate-90">
        <circle cx="52" cy="52" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-border" />
        <circle
          cx="52" cy="52" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute text-center" style={{ marginTop: '-72px' }}>
        <div className="text-2xl font-bold">{score}</div>
        <div className="text-[10px] text-muted-foreground">/100</div>
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const Icon =
    insight.type === 'positive' ? CheckCircle2 :
    insight.type === 'warning'  ? AlertTriangle :
    ChevronRight;
  const cls =
    insight.type === 'positive' ? 'text-success' :
    insight.type === 'warning'  ? 'text-amber-500' :
    'text-primary';

  return (
    <div className="flex gap-3 p-3 bg-secondary/50 border border-border/50" style={{ borderRadius: 'var(--radius)' }}>
      <Icon size={15} className={`shrink-0 mt-0.5 ${cls}`} />
      <div>
        <p className="text-xs font-semibold text-foreground">{insight.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{insight.body}</p>
      </div>
    </div>
  );
}

export default function AiAdvisor() {
  const { user, isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const { data: allTxns = [] } = useTransactions();
  const { data: debts = [] } = useDebts();
  const { data: goals = [] } = useSavingsGoals();
  const { data: accounts = [] } = useAccounts();

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdviceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build financial snapshot from live data
  const snapshot = useMemo(() => {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonth = allTxns.filter((t: any) => t.date?.startsWith(currentMonthStr));

    const monthlyIncome = thisMonth
      .filter((t: any) => t.type === 'income')
      .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);

    const monthlyExpenses = thisMonth
      .filter((t: any) => t.type === 'expense' && t.category !== 'Debt Payment')
      .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);

    const totalDebt = debts.reduce((s: number, d: any) => s + Number(d.balance ?? 0), 0);

    const savingsBalance = goals.reduce((s: number, g: any) => s + Number(g.current_amount ?? 0), 0);

    const active = accounts.filter((a: any) => a.active);
    const cashOnHand = active
      .filter((a: any) => ['checking', 'savings', 'high_yield_savings', 'cash', 'business_checking'].includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0);

    const liabilityTypes = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];
    const totalAssets = active
      .filter((a: any) => !liabilityTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0);
    const totalLiabilities = active
      .filter((a: any) => liabilityTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0);
    const netWorth = totalAssets - totalLiabilities;

    const savingsRate = monthlyIncome > 0
      ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100
      : 0;

    const breakdown = categorizeExpenses(thisMonth, true);
    const topCategories = Object.entries(breakdown)
      .map(([category, amount]) => ({ category, amount: amount as number }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return { monthlyIncome, monthlyExpenses, totalDebt, savingsBalance, cashOnHand, netWorth, savingsRate, topCategories };
  }, [allTxns, debts, goals, accounts]);

  const hasData = snapshot.monthlyIncome > 0 || snapshot.cashOnHand > 0 || snapshot.totalDebt > 0;

  const handleAsk = async (q?: string) => {
    const finalQ = q ?? question.trim();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnErr } = await tracedInvoke<AdviceResult>(supabase, 'ai-advisor', {
        body: { ...snapshot, question: finalQ || undefined },
      });
      if (fnErr) throw new Error(fnErr.message);
      setResult(data as AdviceResult);
      if (!q) setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isPremium && !isDemo) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles size={18} className="text-primary" />
          <h1 className="font-display font-bold text-2xl tracking-tight">AI Advisor</h1>
        </div>
        <PremiumGate
          title="AI Budget Advisor"
          features={['Financial health score (1–100)', 'Spending pattern analysis', 'Ask any money question']}
          isPremium={false}
        >
          <div />
        </PremiumGate>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-primary" />
        <h1 className="font-display font-bold text-2xl tracking-tight">AI Advisor</h1>
        <span className="text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium ml-1" style={{ borderRadius: 'var(--radius)' }}>
          Powered by Gemini
        </span>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Personalized advice based on your live financial data &bull; {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </p>

      {!hasData && (
        <div className="card-forged p-4 border-amber-500/20">
          <p className="text-xs text-muted-foreground">
            Add transactions, accounts, and debts to get the most accurate advice. The advisor works with whatever data you have.
          </p>
        </div>
      )}

      {/* Snapshot summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Income', value: formatCurrency(snapshot.monthlyIncome, false) },
          { label: 'Expenses', value: formatCurrency(snapshot.monthlyExpenses, false) },
          { label: 'Total Debt', value: formatCurrency(snapshot.totalDebt, false) },
          { label: 'Savings Rate', value: `${snapshot.savingsRate.toFixed(1)}%` },
        ].map(k => (
          <div key={k.label} className="card-forged p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</p>
            <p className="text-base font-bold mt-0.5">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Quick questions */}
      {!result && !loading && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Quick questions</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_QUESTIONS.map(q => (
              <button
                key={q}
                onClick={() => handleAsk(q)}
                className="text-[11px] px-3 py-1.5 bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ask box */}
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && question.trim()) handleAsk(); }}
          placeholder="Ask anything about your finances…"
          className="flex-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
          disabled={loading}
        />
        <button
          onClick={() => question.trim() ? handleAsk() : handleAsk('')}
          disabled={loading}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors disabled:opacity-50"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {loading
            ? <Loader2 size={14} className="animate-spin" />
            : <Send size={14} />}
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Score + summary */}
          <div className="card-forged p-5 flex flex-col sm:flex-row items-center gap-5">
            <div className="relative flex flex-col items-center">
              <ScoreRing score={result.score} label={result.scoreLabel} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Financial Health</p>
              <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
            </div>
          </div>

          {/* Next move */}
          <div className="flex gap-3 p-4 bg-primary/8 border border-primary/20" style={{ borderRadius: 'var(--radius)' }}>
            <TrendingUp size={16} className="text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-0.5">Your Move This Month</p>
              <p className="text-sm font-medium text-foreground">{result.nextMove}</p>
            </div>
          </div>

          {/* Insights */}
          {result.insights?.length > 0 && (
            <div className="space-y-2">
              {result.insights.map((ins, i) => (
                <InsightCard key={i} insight={ins} />
              ))}
            </div>
          )}

          {/* Re-ask */}
          <button
            onClick={() => { setResult(null); setQuestion(''); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors btn-press"
          >
            <RefreshCw size={12} /> Ask another question
          </button>
        </div>
      )}
    </div>
  );
}
