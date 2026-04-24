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
  Send, ChevronRight, User, ArrowLeft, Plus, MessageSquare,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface Conversation {
  id: string;
  title: string | null;
  entries: ChatEntry[];
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

function scoreLabel(pct: number) {
  if (pct >= 80) return 'Excellent';
  if (pct >= 60) return 'Good';
  if (pct >= 40) return 'Fair';
  return 'Poor';
}

// ── ScoreRing ─────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 88 }: { score: number; size?: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = scoreColor(pct);
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const cx = size / 2;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0" style={{ display: 'block' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-border/50" />
        <circle
          cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.9s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-bold leading-none" style={{ color, fontSize: size * 0.26 }}>{score}</span>
        <span className="text-muted-foreground leading-none mt-0.5" style={{ fontSize: size * 0.11 }}>/100</span>
      </div>
    </div>
  );
}

// ── InsightCard ───────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: Insight }) {
  const cfg = {
    positive: { Icon: CheckCircle2, border: 'border-green-500/25', bg: 'bg-green-500/8', label: 'text-green-400' },
    warning:  { Icon: AlertTriangle, border: 'border-amber-500/25', bg: 'bg-amber-500/8', label: 'text-amber-400' },
    action:   { Icon: ChevronRight,  border: 'border-primary/20',   bg: 'bg-primary/6',   label: 'text-primary' },
  }[insight.type] ?? { Icon: ChevronRight, border: 'border-border/50', bg: 'bg-secondary/50', label: 'text-muted-foreground' };

  return (
    <div className={`flex gap-3 p-3 border ${cfg.border} ${cfg.bg}`} style={{ borderRadius: 'var(--radius)' }}>
      <cfg.Icon size={14} className={`shrink-0 mt-0.5 ${cfg.label}`} />
      <div className="min-w-0">
        <p className={`text-xs font-semibold ${cfg.label}`}>{insight.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
      </div>
    </div>
  );
}

// ── EntryView — full AI response card ─────────────────────────────────────────

function EntryView({ entry }: { entry: ChatEntry }) {
  const { result, question } = entry;
  const pct = Math.min(100, Math.max(0, result.score ?? 0));
  const color = scoreColor(pct);
  const label = scoreLabel(pct);

  return (
    <div className="space-y-3">
      {/* Question bubble */}
      {question && (
        <div className="flex justify-end">
          <div className="flex items-center gap-2 max-w-[90%] sm:max-w-[85%] min-w-0">
            <div
              className="text-xs px-3 py-2 bg-primary text-primary-foreground font-medium leading-snug break-words"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {question}
            </div>
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <User size={13} className="text-primary" />
            </div>
          </div>
        </div>
      )}

      {/* AI response */}
      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles size={13} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">

          {/* Score + summary */}
          <div className="flex gap-4 p-4 bg-secondary/50 border border-border/40 min-w-0 overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
            <ScoreRing score={result.score ?? 0} size={88} />
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Financial Health</p>
              <p className="text-sm font-bold" style={{ color }}>{label}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>
            </div>
          </div>

          {/* Next move */}
          {result.nextMove && (
            <div className="flex gap-3 p-3 bg-primary/8 border border-primary/25" style={{ borderRadius: 'var(--radius)' }}>
              <TrendingUp size={14} className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-[9px] font-bold text-primary uppercase tracking-wider mb-0.5">Your Move This Month</p>
                <p className="text-xs font-medium text-foreground leading-relaxed">{result.nextMove}</p>
              </div>
            </div>
          )}

          {/* Insights */}
          {(result.insights?.length ?? 0) > 0 && (
            <div className="space-y-2">
              {result.insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
            </div>
          )}

          <p className="text-xs text-muted-foreground/50 pl-1">
            {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Score badge (used in conversation list) ───────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = scoreColor(score);
  const label = scoreLabel(score);
  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold border shrink-0"
      style={{ borderRadius: 'var(--radius)', color, borderColor: `${color}40`, background: `${color}12` }}
    >
      {score} <span className="font-normal opacity-70">{label}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiAdvisor() {
  const { user, isDemo } = useAuth();
  const { isPremium } = useSubscription();
  const { data: rawTxns = [] } = useTransactions();
  const { data: rules = [] }   = useRecurringRules();
  const { data: debts = [] }   = useDebts();
  const { data: goals = [] }   = useSavingsGoals();
  const { data: accounts = [] } = useAccounts();

  const allTxns = useMemo(
    () => mergeWithGeneratedTransactions(rawTxns, rules, accounts),
    [rawTxns, rules, accounts],
  );

  // ── Views: 'list' | 'new' | 'chat' ──────────────────────────────────────────
  const [view, setView] = useState<'list' | 'new' | 'chat'>('new');

  // Past conversations loaded from DB (newest first)
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Active conversation entries (the one currently open)
  const [activeEntries, setActiveEntries] = useState<ChatEntry[]>([]);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);

  // Chat input state
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedToday, setUsedToday] = useState(0);
  const [cooldown, setCooldown] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAskTime = useRef(0);

  // Financial snapshot
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

    const savingsBalance = accounts
      .filter((a: any) => ['savings', 'high_yield_savings'].includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0);

    const cashOnHand = accounts
      .filter((a: any) => ['checking', 'cash'].includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0);

    const totalAssets = accounts
      .filter((a: any) => !['credit_card', 'loan'].includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0);
    const netWorth = totalAssets - totalDebt;

    const savingsRate = monthlyIncome > 0
      ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100
      : 0;

    const breakdown = categorizeExpenses(thisMonth, true);
    const topCategories = Object.entries(breakdown)
      .map(([category, amount]) => ({ category, amount: amount as number }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    const debtDetails = debts.map((d: any) => ({
      name: String(d.name ?? 'Unknown'),
      balance: Number(d.balance ?? 0),
      apr: Number(d.apr ?? 0),
      minPayment: Number(d.min_payment ?? 0),
      targetPayment: Number(d.target_payment ?? 0),
    }));

    const savingsGoals = goals.map((g: any) => ({
      name: String(g.name ?? 'Unnamed Goal'),
      targetAmount: Number(g.target_amount ?? 0),
      currentAmount: Number(g.current_amount ?? 0),
      monthlyContribution: Number(g.monthly_contribution ?? 0),
      targetDate: g.target_date ?? null,
    }));

    return { monthlyIncome, monthlyExpenses, totalDebt, savingsBalance, cashOnHand, netWorth, savingsRate, topCategories, debtDetails, savingsGoals };
  }, [allTxns, debts, goals, accounts]);

  // Load history on mount
  useEffect(() => {
    if (!user || isDemo) { setHistoryLoaded(true); return; }
    (supabase as any)
      .from('ai_advisor_history')
      .select('id, question, result, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }: { data: ChatEntry[] | null }) => {
        if (data && data.length > 0) {
          // Each DB entry is its own conversation
          const convos: Conversation[] = data.map(entry => ({
            id: entry.id,
            title: entry.question,
            entries: [entry],
            created_at: entry.created_at,
          }));
          setConversations(convos);
          setView('list');
          const todayStr = new Date().toDateString();
          setUsedToday(data.filter(h => new Date(h.created_at).toDateString() === todayStr).length);
        }
        setHistoryLoaded(true);
      });
  }, [user, isDemo]);

  // Auto-scroll to bottom inside a chat
  useEffect(() => {
    if (view === 'chat' && activeEntries.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [activeEntries.length, view]);

  const atLimit = usedToday >= DAILY_LIMIT;
  const blocked = loading || cooldown || atLimit;

  const openConversation = (convo: Conversation) => {
    setActiveEntries(convo.entries);
    setActiveTitle(convo.title);
    setError(null);
    setView('chat');
  };

  const startNew = () => {
    setActiveEntries([]);
    setActiveTitle(null);
    setQuestion('');
    setError(null);
    setView('new');
  };

  const goBack = () => {
    setView(conversations.length > 0 ? 'list' : 'new');
    setActiveEntries([]);
    setActiveTitle(null);
  };

  const handleAsk = async (q?: string) => {
    const finalQ = (q ?? question).trim();

    const now = Date.now();
    if (now - lastAskTime.current < COOLDOWN_MS) {
      setError('Please wait a moment before asking again.');
      return;
    }
    if (atLimit) {
      setError(`You've reached your ${DAILY_LIMIT} daily questions. Resets at midnight.`);
      return;
    }

    lastAskTime.current = now;
    setLoading(true);
    setError(null);
    setQuestion('');

    // Transition to chat view if in new view
    if (view === 'new') setView('chat');

    try {
      const { data, error: fnErr } = await tracedInvoke<AdviceResult>(supabase, 'ai-advisor', {
        body: { ...snapshot, question: finalQ || undefined },
      });
      if (fnErr) {
        const msg = (fnErr as any)?.message ?? 'Something went wrong.';
        throw new Error(msg.includes('non-2xx') ? 'AI request failed. Please try again.' : msg);
      }

      const advice = data as AdviceResult;
      const entry: ChatEntry = {
        id: crypto.randomUUID(),
        question: finalQ || null,
        result: advice,
        created_at: new Date().toISOString(),
      };

      setActiveEntries(prev => [...prev, entry]);

      // Add to conversation list (prepend new conversation)
      const newConvo: Conversation = {
        id: entry.id,
        title: entry.question,
        entries: [entry],
        created_at: entry.created_at,
      };
      setConversations(prev => [newConvo, ...prev]);

      if (!activeTitle && finalQ) setActiveTitle(finalQ);
      if (typeof advice.usedToday === 'number') setUsedToday(advice.usedToday);

      setCooldown(true);
      setTimeout(() => setCooldown(false), COOLDOWN_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      if (view === 'new') setView('new');
    } finally {
      setLoading(false);
    }
  };

  // ── Gates ────────────────────────────────────────────────────────────────────

  if (isDemo) {
    return (
      <div className="py-4 lg:py-6 max-w-3xl mx-auto overflow-x-hidden">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles size={18} className="text-primary" />
          <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">AI Advisor</h1>
        </div>
        <div className="border border-border/60 bg-secondary/30 p-8 text-center space-y-4" style={{ borderRadius: 'var(--radius)' }}>
          <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto">
            <Sparkles size={22} className="text-primary" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display font-bold text-lg tracking-tight">AI Advisor is a Premium Feature</h2>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
              Create a free account and upgrade to Forged Premium to get your personalized financial health score and ask unlimited money questions.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <a href="/auth" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-primary/90" style={{ borderRadius: 'var(--radius)' }}>
              Create Free Account
            </a>
            <a href="/auth" className="inline-flex items-center justify-center gap-2 border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" style={{ borderRadius: 'var(--radius)' }}>
              Sign In
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!isPremium) {
    return (
      <div className="flex flex-col h-[calc(100dvh-56px)] lg:h-screen overflow-x-hidden">
        {/* header */}
        <div className="px-4 pt-4 pb-3 lg:px-6 lg:pt-5 border-b border-border/40 shrink-0 flex items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">AI Advisor</h1>
        </div>
        <PremiumGate
          title="AI Budget Advisor"
          features={['Financial health score (1–100)', 'Spending pattern analysis', 'Ask any money question']}
          isPremium={false}
          className="flex-1 min-h-0"
        >
          {/* mock chat — blurred as preview */}
          <div className="flex flex-col h-full p-4 gap-3 overflow-hidden">
            {/* mock AI message */}
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles size={12} className="text-primary" />
              </div>
              <div className="card-forged p-3 max-w-[92%] sm:max-w-[80%] text-xs text-foreground leading-relaxed">
                Your financial health score is <span className="text-primary font-bold">74/100</span>. You're covering essentials well, but your discretionary spend is 12% above your 3-month average.
              </div>
            </div>
            {/* mock user message */}
            <div className="flex gap-2 items-start justify-end">
              <div className="bg-primary/10 border border-primary/20 p-3 max-w-[75%] text-xs text-foreground leading-relaxed" style={{ borderRadius: 'var(--radius)' }}>
                How can I improve my score?
              </div>
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User size={12} className="text-muted-foreground" />
              </div>
            </div>
            {/* mock AI follow-up */}
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles size={12} className="text-primary" />
              </div>
              <div className="card-forged p-3 max-w-[92%] sm:max-w-[80%] text-xs text-foreground leading-relaxed">
                Three quick wins: <span className="text-primary font-semibold">reduce dining out by $120</span>, redirect that to your emergency fund, and set your Chase card to auto-pay minimum to avoid late fees.
              </div>
            </div>
            {/* mock input bar */}
            <div className="mt-auto flex gap-2 items-center border border-border bg-card px-3 py-2" style={{ borderRadius: 'var(--radius)' }}>
              <span className="flex-1 text-xs text-muted-foreground">Ask about your finances…</span>
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                <Send size={10} className="text-primary" />
              </div>
            </div>
          </div>
        </PremiumGate>
      </div>
    );
  }

  // ── Shared header bar ────────────────────────────────────────────────────────

  const SharedHeader = ({ showBack = false, title }: { showBack?: boolean; title?: string }) => (
    <div className="px-4 pt-4 pb-3 lg:px-6 lg:pt-5 border-b border-border/40 shrink-0 flex items-center gap-3">
      {showBack ? (
        <button
          onClick={goBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary hover:bg-secondary/80 border border-border/60 transition-colors shrink-0"
        >
          <ArrowLeft size={15} />
        </button>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          <Sparkles size={16} className="text-primary" />
          <span className="font-display font-bold text-base tracking-tight">AI Advisor</span>
          <span className="text-xs px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium hidden sm:inline" style={{ borderRadius: 'var(--radius)' }}>
            Gemini 2.5
          </span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        {showBack && title && (
          <p className="text-sm font-semibold truncate">{title}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:flex gap-0.5">
          {Array.from({ length: DAILY_LIMIT }).map((_, i) => (
            <div key={i} className={`h-1.5 w-2 rounded-full transition-colors ${i < usedToday ? 'bg-primary' : 'bg-border'}`} />
          ))}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{usedToday}/{DAILY_LIMIT}</span>
        {!showBack && (
          <button
            onClick={startNew}
            className="ml-1 flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-semibold transition-colors btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Plus size={11} /> New
          </button>
        )}
      </div>
    </div>
  );

  // ── Snapshot bar (shown in new-chat and chat views) ──────────────────────────

  const SnapshotBar = () => (
    <div className="px-4 py-2 lg:px-6 border-b border-border/30 shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-2">
      {[
        { label: 'Income',       value: formatCurrency(snapshot.monthlyIncome, false) },
        { label: 'Expenses',     value: formatCurrency(snapshot.monthlyExpenses, false) },
        { label: 'Total Debt',   value: formatCurrency(snapshot.totalDebt, false) },
        { label: 'Savings Rate', value: `${snapshot.savingsRate.toFixed(1)}%` },
      ].map(k => (
        <div key={k.label} className="bg-secondary/50 rounded-md px-2.5 py-1.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{k.label}</p>
          <p className="text-xs font-bold mt-0.5">{k.value}</p>
        </div>
      ))}
    </div>
  );

  // ── Input bar ────────────────────────────────────────────────────────────────

  const InputBar = ({ placeholder = 'Ask anything about your finances…' }: { placeholder?: string }) => (
    <div className="px-4 pb-4 lg:px-6 lg:pb-5 pt-3 border-t border-border/40 shrink-0">
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !blocked) handleAsk(); }}
          placeholder={atLimit ? 'Daily limit reached — resets at midnight' : placeholder}
          className="flex-1 bg-secondary border border-border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
          style={{ borderRadius: 'var(--radius)' }}
          disabled={blocked}
        />
        <button
          onClick={() => handleAsk()}
          disabled={blocked || !question.trim()}
          className="flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-4 py-2.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors disabled:opacity-50"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {loading ? '' : 'Ask'}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 mt-2 text-xs text-destructive">
          <AlertTriangle size={12} className="shrink-0" />
          {error}
        </div>
      )}
    </div>
  );

  // ── VIEW: Conversation list ──────────────────────────────────────────────────

  if (view === 'list') {
    return (
      <div className="flex flex-col h-[calc(100dvh-4rem)] lg:h-screen max-w-3xl mx-auto w-full overflow-hidden">
        <SharedHeader />

        <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 space-y-1.5" style={{ overflowX: 'hidden', touchAction: 'pan-y' }}>
          {conversations.map(convo => {
            const ts = new Date(convo.created_at);
            const isToday = ts.toDateString() === new Date().toDateString();
            const timeStr = isToday
              ? ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              : ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const score = convo.entries[0]?.result?.score;

            return (
              <button
                key={convo.id}
                onClick={() => openConversation(convo)}
                className="w-full flex items-center gap-3 p-3.5 overflow-hidden text-left bg-secondary/30 hover:bg-secondary/70 border border-border/30 hover:border-border/60 transition-all group"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <MessageSquare size={13} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {convo.title || 'General Analysis'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{timeStr}</p>
                </div>
                {score !== undefined && <ScoreBadge score={score} />}
                <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── VIEW: Active chat (new or open conversation) ─────────────────────────────

  const isNewChat = view === 'new';
  const showBackInChat = conversations.length > 0;

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] lg:h-screen max-w-3xl mx-auto w-full overflow-hidden">

      <SharedHeader showBack={showBackInChat} title={activeTitle ?? undefined} />
      {isNewChat && <SnapshotBar />}

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 space-y-6" style={{ overflowX: 'hidden', touchAction: 'pan-y' }}>

        {/* Empty state */}
        {activeEntries.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Sparkles size={24} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Ask Forge anything about your finances</p>
              <p className="text-xs text-muted-foreground mt-1">Personalized advice based on your live data</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-sm w-full">
              {QUICK_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  disabled={blocked}
                  className="text-xs px-3 py-2 bg-secondary border border-border hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-colors btn-press disabled:opacity-40"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Entries */}
        {activeEntries.map(entry => (
          <EntryView key={entry.id} entry={entry} />
        ))}

        {/* Loading bubble */}
        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles size={12} className="text-primary" />
            </div>
            <div className="flex items-center gap-2 px-4 py-3 bg-secondary/60 border border-border/40" style={{ borderRadius: 'var(--radius)' }}>
              <Loader2 size={13} className="animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Analyzing your finances…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick chips — only when there are already entries */}
      {activeEntries.length > 0 && !loading && (
        <div className="px-4 lg:px-6 pt-2 flex flex-wrap gap-1.5 border-t border-border/20 shrink-0">
          {QUICK_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => handleAsk(q)}
              disabled={blocked}
              className="text-xs px-2.5 py-1 bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-40"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <InputBar placeholder={activeEntries.length > 0 ? 'Ask a follow-up…' : 'Ask anything about your finances…'} />
    </div>
  );
}
