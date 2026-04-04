import { useState, useMemo, useCallback } from 'react';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import { useTransactions, useAccounts, useRecurringRules, useDebts, useProfile, useAccountReconciliations } from '@/hooks/useSupabaseData';
import { usePersistedState } from '@/hooks/usePersistedState';
import { CATEGORIES } from '@/lib/types';
import { getCurrentMonthDebtRecommendations, buildCardData, simulateVariablePayoff, CC_DEFAULT_CATEGORIES } from '@/lib/credit-card-engine';
import { createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, mergeWithGeneratedTransactions } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import FormModal from '@/components/shared/FormModal';
import { Plus, ArrowUpRight, ArrowDownRight, Edit2, Trash2, Copy, Repeat, AlertTriangle, Landmark, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

const ALL_CATEGORIES = ['Income', ...CATEGORIES];

const emptyForm = { date: new Date().toISOString().split('T')[0], type: 'expense', amount: '', category: 'Other', account: 'Checking', note: '', payment_source: '' };

export default function Transactions() {
  const { data: transactions, add, update, remove } = useTransactions();
  const { data: accounts } = useAccounts();
  const { data: rules, update: updateRule } = useRecurringRules();
  const { data: debts } = useDebts();
  const { data: profile } = useProfile();
  const { data: reconciliations } = useAccountReconciliations();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterSource, setFilterSource] = useState('all');

  // Month filter: 'YYYY-MM' | 'all' | 'forecast'
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const [filterMonth, setFilterMonth] = useState<string>(currentMonthStr);
  // Read forecast's persisted year filter to support forecast-range mode
  const [forecastYear] = usePersistedState<'all' | '1' | '2' | '3'>('tre:forecast:filterYear', 'all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editChoiceId, setEditChoiceId] = useState<string | null>(null);
  const [editChoiceRule, setEditChoiceRule] = useState<any>(null);

  // Build account lookup map
  const accountMap = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => { map[a.id] = a; map[`account:${a.id}`] = a; });
    return map;
  }, [accounts]);

  // Normalize a payment_source to `account:ID` format
  const normalizeSource = useCallback((src: string | null | undefined): string => {
    if (!src) return '';
    if (src.startsWith('account:')) return src;
    // If it's a raw account ID, prefix it
    if (accountMap[src]) return `account:${src}`;
    return src;
  }, [accountMap]);

  // Base transaction stream (real + generated recurring) shared across pages
  const baseTxns = useMemo(() => {
    return mergeWithGeneratedTransactions(transactions, rules, accounts)
      .map((t: any) => ({ ...t, isGenerated: Boolean((t as any).isGenerated), isDebtPayment: false }));
  }, [transactions, rules, accounts]);

  // Generate debt payment transactions from Debt Payoff schedule
  // Resolve funding account from profile or default to first checking account
  const fundingAccountId = useMemo(() => {
    const defaultId = profile?.default_deposit_account;
    if (defaultId) {
      const acct = accounts.find((a: any) => a.id === defaultId && a.active);
      if (acct) return acct.id;
    }
    const checking = accounts.find((a: any) => a.account_type === 'checking' && a.active);
    return checking?.id || '';
  }, [accounts, profile]);

  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);

  // Account name → ID lookup (for mapping ScheduledEvent.source to account:ID)
  const accountByName = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach((a: any) => { map[a.name] = a.id; });
    return map;
  }, [accounts]);

  // Rule ID → category lookup
  const ruleCategoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    rules.forEach((r: any) => { map[r.id] = r.category || 'Other'; });
    return map;
  }, [rules]);

  // Savings/investing rule IDs for "paused" badge
  const savingsRuleIdsForBadge = useMemo(() => new Set<string>(
    rules.filter((r: any) =>
      r.active && r.rule_type === 'expense' &&
      (r.category === 'Savings' || r.category === 'Investing'),
    ).map((r: any) => r.id),
  ), [rules]);

  const debtPaymentTransactions = useMemo(() => {
    const recs = getCurrentMonthDebtRecommendations(accounts, baseTxns, rules, debts, profile);
    return createDebtPaymentTransactions(recs, fundingAccountId || null);
  }, [accounts, baseTxns, rules, debts, profile, fundingAccountId]);

  // Map reconciliation records to transaction-like shape for rendering
  const reconciliationTxns = useMemo(() => {
    return (reconciliations || []).map((r: any) => ({
      id: `recon:${r.id}`,
      date: r.effective_date,
      type: r.delta >= 0 ? 'income' : 'expense',
      amount: Math.abs(r.delta),
      category: 'Balance Adjustment',
      note: 'Balance Adjustment',
      payment_source: '',
      account: '',
      isGenerated: false,
      isDebtPayment: false,
      isReconciliation: true,
      reconciliationDelta: r.delta,
    }));
  }, [reconciliations]);

  // Projected debt payment transactions from the simulation engine — only for forecast view
  const projectedDebtPaymentTxns = useMemo(() => {
    if (filterMonth !== 'forecast') return [];
    const cards = buildCardData(accounts, baseTxns, rules, debts);
    if (cards.length === 0) return [];

    const liquidTypes = ['checking', 'business_checking', 'cash'];
    const liquidCash = accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance), 0);
    const cashFloor = Number(profile?.cash_floor) || 1000;
    // Scalar fallbacks
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

    const schedEvts = generateScheduledEvents(rules, accounts, 36);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Same CC-aware builder as Forecast.tsx cardProjectionData (T1/T2/T3/T4)
    const liquidAccountIds = new Set<string>(
      accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type)).map((a: any) => a.id),
    );
    const incomeToLiquidRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'income' &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).map((r: any) => r.id),
    );
    const ccPaymentSources = new Set<string>(cards.flatMap(c => [c.id, `account:${c.id}`]));
    const ccExplicitRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' &&
        r.payment_source && ccPaymentSources.has(r.payment_source),
      ).map((r: any) => r.id),
    );
    const highestAprCardId = cards.length > 0 ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : '';
    const ccDefaultRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' &&
        !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map((r: any) => r.id),
    );
    const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);
    const cardRuleIdMap = new Map<string, Set<string>>(
      cards.map(c => {
        const cKey = `account:${c.id}`;
        const ids = new Set<string>(
          rules.filter((r: any) =>
            r.active && r.rule_type === 'expense' &&
            (r.payment_source === c.id || r.payment_source === cKey),
          ).map((r: any) => r.id),
        );
        if (c.id === highestAprCardId) ccDefaultRuleIds.forEach(id => ids.add(id));
        return [c.id, ids];
      }),
    );

    const monthEvts: { income: number; expenses: number }[] = [];
    const cardPurchasesPerMonth: { [cardId: string]: number }[] = [];

    for (let i = 0; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const eventsInMonth = schedEvts.filter(e =>
        e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr),
      );
      const income = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
        .reduce((s, e) => s + e.amount, 0);
      const cashExpenses = eventsInMonth
        .filter(e =>
          e.type === 'expense' &&
          !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
          !(pauseSavings && e.ruleId && savingsRuleIdsForBadge.has(e.ruleId)),
        )
        .reduce((s, e) => s + e.amount, 0);
      monthEvts.push({ income, expenses: cashExpenses });

      const cardPurchases: { [cardId: string]: number } = {};
      if (i > 0) {
        for (const card of cards) {
          const ruleIds = cardRuleIdMap.get(card.id) ?? new Set<string>();
          cardPurchases[card.id] = eventsInMonth
            .filter(e => e.type === 'expense' && e.ruleId && ruleIds.has(e.ruleId))
            .reduce((s, e) => s + e.amount, 0);
        }
      }
      cardPurchasesPerMonth.push(cardPurchases);
    }

    const sim = simulateVariablePayoff(
      cards, liquidCash, cashFloor, 'avalanche',
      monthlyTakeHome, monthlyExpenses, 36,
      monthEvts, fundingAccountId || undefined, cardPurchasesPerMonth,
    );

    return sim.debtPaymentTransactions.map(p => ({
      id: `proj:${p.card}:${p.date}`,
      date: p.date,
      type: 'expense' as const,
      amount: p.amount,
      category: p.category,
      note: p.description,
      payment_source: p.account ? `account:${p.account}` : '',
      isGenerated: true,
      isDebtPayment: true,
      projected: true,
      debtCardId: p.card,
      debtCardName: p.description.replace(' Payment', ''),
    }));
  }, [filterMonth, accounts, baseTxns, rules, debts, profile, fundingAccountId, pauseSavings, savingsRuleIdsForBadge]);

  // Projected recurring transactions for ALL future months — only in forecast view (T6)
  const projectedRecurringTxns = useMemo(() => {
    if (filterMonth !== 'forecast') return [];
    const schedEvts = generateScheduledEvents(rules, accounts, 36);
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return schedEvts
      .filter(e => e.date.substring(0, 7) > currentMonthKey)
      .map(e => {
        const acctId = e.source ? accountByName[e.source] : undefined;
        return {
          id: `proj:sched:${e.ruleId ?? e.name}:${e.date}`,
          date: e.date,
          type: e.type as 'income' | 'expense',
          amount: e.amount,
          category: e.type === 'income' ? 'Income' : (e.ruleId ? (ruleCategoryMap[e.ruleId] ?? 'Other') : 'Other'),
          note: e.name,
          payment_source: acctId ? `account:${acctId}` : '',
          isGenerated: true,
          isDebtPayment: false,
          projected: true,
          ruleId: e.ruleId,
        };
      });
  }, [filterMonth, rules, accounts, accountByName, ruleCategoryMap]);

  // Merge real + generated recurring + debt payments + reconciliations
  const allTransactions = useMemo(() => {
    const merged = mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTransactions);
    return [
      ...merged,
      ...reconciliationTxns,
      ...projectedDebtPaymentTxns,
      ...projectedRecurringTxns,
    ].sort((a, b) => b.date.localeCompare(a.date));
  }, [baseTxns, debtPaymentTransactions, reconciliationTxns, projectedDebtPaymentTxns, projectedRecurringTxns]);

  const paymentSourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: 'cash', label: 'Cash' }];
    accounts.filter((a: any) => a.active).forEach((a: any) => {
      const typeLabel = a.account_type === 'credit_card' ? 'Credit Card'
        : a.account_type === 'high_yield_savings' ? 'HYS'
        : a.account_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      opts.push({ value: `account:${a.id}`, label: `${a.name} (${typeLabel})` });
    });
    if (opts.length === 1) {
      opts.push({ value: 'bank_account', label: 'Bank Account' });
      opts.push({ value: 'credit_card', label: 'Credit Card' });
    }
    return opts;
  }, [accounts]);

  const getSourceLabel = useCallback((source: string) => {
    if (!source) return 'Unassigned';
    // Try direct match
    const opt = paymentSourceOptions.find(o => o.value === source);
    if (opt) return opt.label;
    // Try with account: prefix
    const prefixed = paymentSourceOptions.find(o => o.value === `account:${source}`);
    if (prefixed) return prefixed.label;
    // Try raw account lookup
    const acct = accountMap[source];
    if (acct) return acct.name;
    if (source === 'bank_account') return 'Bank Account';
    if (source === 'credit_card') return 'Credit Card';
    if (source === 'cash') return 'Cash';
    return source;
  }, [paymentSourceOptions, accountMap]);

  // Check if a source account is missing/deleted
  const isSourceMissing = useCallback((source: string) => {
    if (!source || source === 'cash' || source === 'bank_account' || source === 'credit_card') return false;
    const id = source.startsWith('account:') ? source.slice(8) : source;
    return !accountMap[id] && !accountMap[`account:${id}`];
  }, [accountMap]);

  // Compute forecast date range for 'forecast' filter mode
  const forecastRange = useMemo((): [string, string] | null => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const toYYYYMM = (d: Date) => d.toISOString().slice(0, 7);
    if (forecastYear === '1') {
      return [toYYYYMM(start), toYYYYMM(new Date(start.getFullYear(), start.getMonth() + 11, 1))];
    }
    if (forecastYear === '2') {
      return [toYYYYMM(new Date(start.getFullYear(), start.getMonth() + 12, 1)), toYYYYMM(new Date(start.getFullYear(), start.getMonth() + 23, 1))];
    }
    if (forecastYear === '3') {
      return [toYYYYMM(new Date(start.getFullYear(), start.getMonth() + 24, 1)), toYYYYMM(new Date(start.getFullYear(), start.getMonth() + 35, 1))];
    }
    // 'all' = full 36-month window
    return [toYYYYMM(start), toYYYYMM(new Date(start.getFullYear(), start.getMonth() + 35, 1))];
  }, [forecastYear]);

  const filtered = useMemo(() => {
    return allTransactions.filter(t => {
      // Projected transactions only appear in forecast mode
      if ((t as any).projected && filterMonth !== 'forecast') return false;
      // Date filter
      if (filterMonth !== 'all') {
        const txMonth = t.date.slice(0, 7);
        if (filterMonth === 'forecast') {
          if (!forecastRange || txMonth < forecastRange[0] || txMonth > forecastRange[1]) return false;
        } else {
          if (txMonth !== filterMonth) return false;
        }
      }
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      if (filterSource !== 'all' && t.payment_source !== filterSource) return false;
      return true;
    });
  }, [allTransactions, filterMonth, forecastRange, filterType, filterCategory, filterSource]);

  // Build month options from distinct months in allTransactions (up to 24), plus forecast option
  const monthOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTransactions) {
      const m = t.date.slice(0, 7);
      seen.add(m);
      if (seen.size >= 24) break;
    }
    return [...seen].sort((a, b) => b.localeCompare(a)).map(m => {
      const [y, mo] = m.split('-');
      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
      return { value: m, label };
    });
  }, [allTransactions]);

  const totals = useMemo(() => {
    const income = filtered.filter(t => t.type === 'income' && t.category !== 'Balance Adjustment').reduce((s, t) => s + Number(t.amount), 0);
    const expense = filtered.filter(t => t.type === 'expense' && t.category !== 'Balance Adjustment').reduce((s, t) => s + Number(t.amount), 0);
    return { income, expense, net: income - expense };
  }, [filtered]);

  const spendBySource = useMemo(() => {
    const acc: Record<string, number> = {};
    filtered.filter(t => t.type === 'expense').forEach(t => {
      const src = getSourceLabel(t.payment_source || '');
      acc[src] = (acc[src] || 0) + Number(t.amount);
    });
    return acc;
  }, [filtered, getSourceLabel]);

  const openAdd = () => { setForm(emptyForm); setEditId(null); setShowForm(true); };

  const openEditDirect = (t: any) => {
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '' });
    setEditId(t.id); setShowForm(true);
  };

  const handleEditClick = (t: any) => {
    if (t.isGenerated && t.ruleId) {
      const rule = rules.find((r: any) => r.id === t.ruleId);
      setEditChoiceId(t.id);
      setEditChoiceRule(rule || null);
      return;
    }
    openEditDirect(t);
  };

  const handleEditOccurrence = (t: any) => {
    // Create as a real transaction (overrides this generated occurrence)
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '' });
    setEditId(null); // null = new transaction (override)
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing this occurrence only — saving will create a standalone transaction.');
  };

  const handleEditRule = () => {
    if (!editChoiceRule) return;
    // Navigate to Budget Control or open edit for the rule
    // For now, open a form pre-filled with rule data
    const r = editChoiceRule;
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: r.rule_type === 'income' ? 'income' : 'expense',
      amount: String(r.amount),
      category: r.rule_type === 'income' ? 'Income' : r.category,
      account: 'Checking',
      note: r.name,
      payment_source: normalizeSource(r.payment_source || r.deposit_account) || '',
    });
    // Store the rule ID for update
    setEditId(`rule:${r.id}`);
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing the recurring rule — changes affect all future occurrences.');
  };

  const duplicateTransaction = (t: any) => {
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: t.type,
      amount: String(t.amount),
      category: t.category,
      account: t.account || 'Checking',
      note: t.note || '',
      payment_source: normalizeSource(t.payment_source) || '',
    });
    setEditId(null);
    setShowForm(true);
  };

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (!amount) return;

    if (editId && editId.startsWith('rule:')) {
      // Update the recurring rule
      const ruleId = editId.slice(5);
      const rulePayload: any = {
        id: ruleId,
        amount,
        name: form.note || 'Transaction',
        category: form.category,
      };
      if (form.type === 'income') {
        rulePayload.rule_type = 'income';
        rulePayload.deposit_account = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      } else {
        rulePayload.rule_type = 'expense';
        rulePayload.payment_source = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      }
      updateRule.mutate(rulePayload);
      toast.success('Recurring rule updated — future transactions will reflect this change.');
    } else {
      const payload = { date: form.date, type: form.type, amount, category: form.category, account: form.account, note: form.note || 'Transaction', payment_source: form.payment_source };
      if (editId && !editId.startsWith('gen:')) {
        update.mutate({ id: editId, ...payload });
        toast.success('Transaction updated');
      } else {
        add.mutate(payload);
        toast.success('Transaction added');
      }
    }
    setShowForm(false); setForm(emptyForm); setEditId(null);
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('gen:')) return;
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const formFields = useMemo(() => [
    { key: 'date', label: 'Date', type: 'date' as const },
    { key: 'type', label: 'Type', type: 'select' as const, options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
    { key: 'amount', label: 'Amount', type: 'number' as const, placeholder: '0.00', step: '0.01' },
    { key: 'category', label: 'Category', type: 'select' as const, options: ALL_CATEGORIES.map(c => ({ value: c, label: c })) },
    { key: 'payment_source', label: editId?.startsWith('rule:') ? 'Account' : 'Payment Source', type: 'select' as const, options: paymentSourceOptions },
    { key: 'note', label: 'Note', type: 'text' as const, placeholder: 'What was this for?' },
  ], [paymentSourceOptions, editId]);

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-bold text-xl tracking-tight">Transactions</h1>
          <InstructionsModal pageTitle="Transactions Guide" sections={[
            { title: 'What is this page?', body: 'Transactions shows your complete ledger — real transactions you enter plus auto-generated ones from your Budget Control recurring rules and debt payoff plan.' },
            { title: 'Generated vs Real', body: 'Entries with badges (recurring, debt payment) are auto-generated from rules. Edit the occurrence to override just that instance, or edit the rule to change all future occurrences.' },
            { title: 'Filters', body: 'Filter by type (income/expense), category, or payment source to find specific entries.' },
            { title: 'How it affects the rest', body: 'Transactions feed the Dashboard monthly totals, Forecast projections, and spending breakdowns.' },
          ]} />
        </div>
        <button onClick={openAdd} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}><Plus size={12} /> Add</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground font-medium" style={{ borderRadius: 'var(--radius)' }}>
          {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="forecast">Forecast Range</option>
          <option value="all">All Time</option>
        </select>
        {(['all', 'income', 'expense'] as const).map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 text-[11px] font-medium border btn-press ${filterType === t ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Categories</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Sources</option>
          {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card-forged p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Income</p><p className="text-sm font-display font-bold text-success">{formatCurrency(totals.income, false)}</p></div>
        <div className="card-forged p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Expenses</p><p className="text-sm font-display font-bold text-destructive">{formatCurrency(totals.expense, false)}</p></div>
        <div className="card-forged p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Net</p><p className={`text-sm font-display font-bold ${totals.net >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(totals.net, false)}</p></div>
      </div>

      {Object.keys(spendBySource).length > 0 && (
        <div className="card-forged p-4">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Spend by Payment Source</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(spendBySource).map(([src, amt]) => (
              <div key={src} className="p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-[10px] text-muted-foreground truncate">{src}</p>
                <p className="text-sm font-display font-bold text-destructive">{formatCurrency(amt, false)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-forged divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center"><p className="text-sm text-muted-foreground">No transactions found.</p></div>
        ) : filtered.map(t => {
          const isRecon = (t as any).isReconciliation;
          const sourceMissing = !isRecon && isSourceMissing(t.payment_source);
          const reconDelta = (t as any).reconciliationDelta as number | undefined;
          const isProjected = (t as any).projected === true;
          return (
            <div key={t.id} className={`flex items-center justify-between px-4 py-3 ${isProjected ? 'opacity-50' : t.isGenerated ? 'bg-muted/5' : ''} ${(t as any).isDebtPayment ? 'border-l-2 border-l-primary/40' : ''} ${isRecon ? 'border-l-2 border-l-amber-500/40' : ''}`}>
              <div className="flex items-center gap-3">
                {isRecon ? <SlidersHorizontal size={14} className="text-amber-500" /> : (t as any).isDebtPayment ? <Landmark size={14} className="text-primary" /> : t.type === 'income' ? <ArrowUpRight size={14} className="text-success" /> : <ArrowDownRight size={14} className="text-destructive" />}
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium">{t.note || '—'}</p>
                    {t.isGenerated && !(t as any).isDebtPayment && !isProjected && <Repeat size={10} className="text-primary" />}
                    {(t as any).isDebtPayment && !isProjected && <span className="text-[9px] text-primary bg-primary/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>debt payoff</span>}
                    {isProjected && <span className="text-[9px] text-muted-foreground bg-muted/30 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>projected</span>}
                    {!isProjected && pauseSavings && (t as any).ruleId && savingsRuleIdsForBadge.has((t as any).ruleId) && (
                      <span className="text-[9px] text-muted-foreground bg-muted/20 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>paused</span>
                    )}
                    {isRecon && <span className="text-[9px] text-amber-600 bg-amber-500/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }} title="Manual balance correction">reconciled</span>}
                    {sourceMissing && <span className="text-destructive" aria-label="Linked account not found"><AlertTriangle size={10} /></span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {t.date} · {t.category}{!isRecon && <> · {sourceMissing ? <span className="text-destructive">⚠ Missing account</span> : getSourceLabel(t.payment_source)}</>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold font-display whitespace-nowrap ${isRecon ? (reconDelta !== undefined && reconDelta >= 0 ? 'text-success' : 'text-destructive') : t.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {isRecon ? (reconDelta !== undefined && reconDelta >= 0 ? '+' : '') : (t.type === 'income' ? '+' : '-')}{isRecon && reconDelta !== undefined ? formatCurrency(reconDelta, false) : formatCurrency(Number(t.amount), false)}
                </span>
                {!isRecon && !isProjected && <button onClick={() => duplicateTransaction(t)} className="text-muted-foreground hover:text-foreground" title="Duplicate"><Copy size={12} /></button>}
                {!isRecon && !isProjected && <button onClick={() => handleEditClick(t)} className="text-muted-foreground hover:text-foreground" title="Edit"><Edit2 size={12} /></button>}
                {!isRecon && !isProjected && !t.isGenerated && (
                  <button onClick={() => handleDelete(t.id)} className={`${deleteConfirm === t.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Choice Dialog for Generated Transactions */}
      {editChoiceId && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }}>
          <div className="bg-card border border-border p-4 sm:p-6 w-full sm:max-w-sm space-y-4 rounded-t-[var(--radius)] rounded-b-none sm:rounded-b-[var(--radius)]" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-display font-bold">Edit Recurring Transaction</h3>
            <p className="text-xs text-muted-foreground">This transaction was auto-generated from a recurring rule. How would you like to edit it?</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const t = allTransactions.find(tx => tx.id === editChoiceId);
                  if (t) handleEditOccurrence(t);
                }}
                className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-xs font-semibold">Edit This Occurrence Only</p>
                <p className="text-[10px] text-muted-foreground">Creates a one-time override. Future months are unaffected.</p>
              </button>
              {editChoiceRule && (
                <button
                  onClick={handleEditRule}
                  className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                  <p className="text-xs font-semibold">Edit Recurring Rule</p>
                  <p className="text-[10px] text-muted-foreground">Updates the source rule in Budget Control. All future occurrences change.</p>
                </button>
              )}
            </div>
            <button onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          title={editId?.startsWith('rule:') ? 'Edit Recurring Rule' : editId ? 'Edit Transaction' : 'Add Transaction'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null); }}
          saving={add.isPending || update.isPending || updateRule.isPending}
          saveLabel={editId?.startsWith('rule:') ? 'Update Rule' : editId ? 'Update' : 'Add Transaction'}
        />
      )}
    </div>
  );
}
