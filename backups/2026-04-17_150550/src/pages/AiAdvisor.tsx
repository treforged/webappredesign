import { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTransactions, useDebts, useSavingsGoals, useAccounts, useRecurringRules } from '@/hooks/useSupabaseData';
import { mergeWithGeneratedTransactions } from '@/lib/pay-schedule';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/lib/supabase';
import { tracedInvoke } from '@/lib/tracer';
import { formatCurrency } from '@/lib/calculations';
import { categorizeExpenses } from '@/lib/expense-filtering';
import PremiumGate from '@/components/shared/PremiumGate';
import {
  Sparkles, TrendingUp, AlertTriangle, CheckCircle2, Loader2,
  Send, ChevronRight, User,
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
  usedToday?: number;
  limitPerDay?: number;
}

interface ChatEntry {
  id: string;
  question: string | null;
  result: AdviceResult;
  created_at: string;
}

const QUICK_QUESTIONS = [
  'Am I on track to be debt-free this year?',
  'Where should I cut spending first?',
  'How much more should I be saving?',
  'Is my savings rate good for my income?',
];

const DAILY_LIMIT = 10;
const COOLDOWN_MS = 3000;

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreColor(pct: number) {
  if (pct >= 80) return '#22c55e';
  if (pct >= 60) return '#3b82f6';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreBg(pct: number) {
  if (pct >= 80) return 'from-green-500/10 to-green-500/5';
  if (pct >= 60) return 'from-blue-500/10 to-blue-500/5';
  if (pct >= 40) return 'from-amber-500/10 to-amber-500/5';
  return 'from-red-500/10 to-red-500/5';
}

// ── ScoreRing ─────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = scoreColor(pct);
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const cx = size / 2;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-border/60" />
        <circle
          cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none" style={{ color }}>{score}</span>
        <span className="text-[9px] text-muted-foreground mt-0.5">/100</span>
      </div>
    </div>
  );
}

// ── InsightCard ───────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: Insight }) {
  const cfg = {
    positive: { Icon: CheckCircle2, border: 'border-green-500/25', bg: 'bg-green-500/8', dot: 'bg-green-500', label: 'text-green-400' },
    warning:  { Icon: AlertTriangle, border: 'border-amber-500/25', bg: 'bg-amber-500/8', dot: 'bg-amber-400', label: 'text-amber-400' },
    action:   { Icon: ChevronRight, border: 'border-primary/20', bg: 'bg-primary/6', dot: 'bg-primary', label: 'text-primary' },
  }[insight.type] ?? { Icon: ChevronRight, border: 'border-border/50', bg: 'bg-secondary/50', dot: 'bg-muted-foreground', label: 'text-muted-foreground' };

  return (
    <div className={`flex gap-3 p-3 border ${cfg.border} ${cfg.bg}`} style={{ borderRadius: 'var(--radius)' }}>
      <cfg.Icon size={14} className={`shrink-0 mt-0.5 ${cfg.label}`} />
      <div className="min-w-0">
        <p className={`text-xs font-semibold ${cfg.label}`}>{insight.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
      </div>
    </div>
  );
}

// ── ResultCard — full breakdown shown in the chat thread ──────────────────────

function ResultCard({ entry }: { entry: ChatEntry }) {
  const { result, question } = entry;
  const pct = Math.min(100, Math.max(0, result.score ?? 0));
  const color = scoreColor(pct);
  const bg = scoreBg(pct);

  return (
    <div className="space-y-3">
      {/* Question bubble */}
      {question && (
        <div className="flex justify-end">
          <div className="flex items-center gap-2 max-w-[80%]">
            <div className="text-[11px] px-3 py-2 bg-primary text-primary-foreground font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {question}
            </div>
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <User size={12} className="text-primary" />
            </div>
          </div>
        </div>
      )}

      {/* AI response */}
      <div className="flex gap-3">
        <div className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles size={11} className="text-primary" />
        </div>
        <div className="flex-1 space-y-3">

          {/* Score header */}
          <div className={`p-4 rounded-xl bg-gradient-to-br ${bg} border border-border/40`}>
            <div className="flex items-center gap-4">
              <ScoreRing score={pct} size={84} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>
                    {result.scoreLabel}
                  </span>
                  <span className="text-[10px] text-muted-foreground">Financial Health</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
              </div>
            </div>
          </div>

          {/* Next move */}
          {result.nextMove && (
            <div className="flex gap-3 p-3 bg-primary/8 border border-primary/25" style={{ borderRadius: 'var(--radius)' }}>
              <TrendingUp size={15} className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-[9px] font-bold text-primary uppercase tracking-wider mb-0.5">Your Move This Month</p>
                <p className="text-xs font-medium text-foreground leading-relaxed">{result.nextMove}</p>
              </div>
            </div>
          )}

          {/* Insights */}
          {(result.insights?.length ?? 0) > 0 && (
            <div className="space-y-2">
              {result.insights.map((ins, i) => (
                <InsightCard key={i} insight={ins} />
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/60 pl-1">
            {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiAdvisor() {
  const { user, isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const { data: rawTxns = [] } = useTransactions();
  const { data: rules = [] } = useRecurringRules();
  const { data: debts = [] } = useDebts();
  const { data: goals = [] } = useSavingsGoals();
  const { data: accounts = [] } = useAccounts();

  const allTxns = useMemo(
    () => mergeWithGeneratedTransactions(rawTxns, rules, accounts),
    [rawTxns, rules, accounts],
  );

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<ChatEntry[]>([]);
  const [usedToday, setUsedToday] = useState(0);
  const [cooldown, setCooldown] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAskTime = useRef(0);

  // Load history on mount
  useEffect(() => {
    if (!user || isDemo) return;
    (supabase as any)
      .from('ai_advisor_history')
      .select('id, question, result, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(10)
      .then(({ data }: { data: ChatEntry[] | null }) => {
        if (!data) return;
        setThread(data);
        const todayStr = new Date().toDateString();
        setUsedToday(data.filter(h => new Date(h.created_at).toDateString() === todayStr).length);
      });
  }, [user, isDemo]);

  // Scroll to bottom when thread grows
  useEffect(() => {
    if (thread.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [thread.length]);

  const snapshot = useMemo(() => {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonth = allTxns.filter((t: any) => t.date?.startsWith(currentMonthStr));

    const monthlyIncome = thisMonth
      .filter((t: any) => t.type === 'income' && t.category !== 'Balance Adjustment')
      .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);

    const monthlyExpenses = thisMonth
      .filter((t: any) => t.type === 'expense' && t.category !== 'Balance Adjustment')
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

  const atLimit = usedToday >= DAILY_LIMIT;
  const blocked = loading || cooldown || atLimit;

  const handleAsk = async (q?: string) => {
    const finalQ = (q ?? question).trim();

    // Client-side cooldown to prevent rapid-fire edge function errors
    const now = Date.now();
    if (now - lastAskTime.current < COOLDOWN_MS) {
      setError('Please wait a moment before asking again.');
      return;
    }
    if (atLimit) {
      setError(`You've used all ${DAILY_LIMIT} questions for today. Resets at midnight.`);
      return;
    }

    lastAskTime.current = now;
    setLoading(true);
    setError(null);
    setQuestion('');

    try {
      const { data, error: fnErr } = await tracedInvoke<AdviceResult>(supabase, 'ai-advisor', {
        body: { ...snapshot, question: finalQ || undefined },
      });
      if (fnErr) {
        // Try to extract meaningful error from the response body
        const msg = (fnErr as any)?.message ?? 'Something went wrong. Try again.';
        throw new Error(msg.includes('non-2xx') ? 'AI request failed. Please try again in a moment.' : msg);
      }

      const advice = data as AdviceResult;
      const entry: ChatEntry = {
        id: crypto.randomUUID(),
        question: finalQ || null,
        result: advice,
        created_at: new Date().toISOString(),
      };

      setThread(prev => [...prev, entry].slice(-10));
      if (typeof advice.usedToday === 'number') setUsedToday(advice.usedToday);

      // Brief cooldown after success
      setCooldown(true);
      setTimeout(() => setCooldown(false), COOLDOWN_MS);
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
    <div className="flex flex-col h-[calc(100dvh-4rem)] lg:h-screen max-w-3xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 lg:px-8 lg:pt-6 space-y-3 border-b border-border/40 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            <h1 className="font-display font-bold text-xl tracking-tight">AI Advisor</h1>
            <span className="text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium" style={{ borderRadius: 'var(--radius)' }}>
              Gemini 2.5
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              {Array.from({ length: DAILY_LIMIT }).map((_, i) => (
                <div key={i} className={`h-1.5 w-2.5 rounded-full transition-colors ${i < usedToday ? 'bg-primary' : 'bg-border'}`} />
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">{usedToday}/{DAILY_LIMIT}</span>
          </div>
        </div>

        {/* Snapshot cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Income', value: formatCurrency(snapshot.monthlyIncome, false) },
            { label: 'Expenses', value: formatCurrency(snapshot.monthlyExpenses, false) },
            { label: 'Total Debt', value: formatCurrency(snapshot.totalDebt, false) },
            { label: 'Savings Rate', value: `${snapshot.savingsRate.toFixed(1)}%` },
          ].map(k => (
            <div key={k.label} className="bg-secondary/60 rounded-lg p-2.5">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{k.label}</p>
              <p className="text-sm font-bold mt-0.5">{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat thread ── */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4 space-y-6">

        {/* Empty state */}
        {thread.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Sparkles size={24} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Ask Forge anything about your finances</p>
              <p className="text-xs text-muted-foreground mt-1">Personalized advice based on your live data</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-sm">
              {QUICK_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  disabled={blocked}
                  className="text-[11px] px-3 py-2 bg-secondary border border-border hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-colors btn-press disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {thread.map(entry => (
          <ResultCard key={entry.id} entry={entry} />
        ))}

        {/* Loading bubble */}
        {loading && (
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles size={11} className="text-primary" />
            </div>
            <div className="flex items-center gap-2 px-4 py-3 bg-secondary/60 border border-border/40" style={{ borderRadius: 'var(--radius)' }}>
              <Loader2 size={13} className="animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Analyzing your finances…</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
            <AlertTriangle size={13} className="shrink-0" />
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="px-4 pb-4 lg:px-8 lg:pb-6 pt-3 border-t border-border/40 shrink-0 space-y-3">

        {/* Quick questions — shown when thread has messages too */}
        {thread.length > 0 && !loading && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_QUESTIONS.map(q => (
              <button
                key={q}
                onClick={() => handleAsk(q)}
                disabled={blocked}
                className="text-[10px] px-2.5 py-1 bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && question.trim() && !blocked) handleAsk(); }}
            placeholder={atLimit ? 'Daily limit reached — resets at midnight' : 'Ask anything about your finances…'}
            className="flex-1 bg-secondary border border-border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
            disabled={blocked}
          />
          <button
            onClick={() => (question.trim() ? handleAsk() : handleAsk(''))}
            disabled={blocked}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {loading
              ? <Loader2 size={14} className="animate-spin" />
              : <Send size={14} />}
            {loading ? '' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
