import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  demoAssets, demoLiabilities, demoDebts, demoSavingsGoals, demoCarFunds, demoTransactions,
} from '@/lib/demo-data';

// ─── Accounts (Centralized) ──────────────────────────────
// FIX #13: Demo accounts now have realistic balances that produce
// meaningful forecast projections. Checking balance supports the
// cash floor while showing debt payoff in action.
const demoAccounts = [
  { id: 'd1', user_id: 'demo', name: 'Chase Checking', account_type: 'checking', institution: 'Chase', balance: 4200, credit_limit: null, apr: null, active: true, notes: 'Primary checking', created_at: '', updated_at: '' },
  { id: 'd2', user_id: 'demo', name: 'Alliant Checking', account_type: 'checking', institution: 'Alliant', balance: 1800, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd3', user_id: 'demo', name: 'Marcus HYS', account_type: 'high_yield_savings', institution: 'Marcus', balance: 12800, credit_limit: null, apr: 4.5, active: true, notes: 'Emergency fund', created_at: '', updated_at: '' },
  { id: 'd4', user_id: 'demo', name: 'Fidelity 401k', account_type: '401k', institution: 'Fidelity', balance: 34500, credit_limit: null, apr: null, active: true, notes: 'Employer match 4%', created_at: '', updated_at: '' },
  { id: 'd5', user_id: 'demo', name: 'Roth IRA', account_type: 'roth_ira', institution: 'Fidelity', balance: 15200, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd6', user_id: 'demo', name: 'Robinhood', account_type: 'brokerage', institution: 'Robinhood', balance: 8900, credit_limit: null, apr: null, active: true, notes: 'Index funds', created_at: '', updated_at: '' },
  { id: 'd7', user_id: 'demo', name: 'Chase Sapphire', account_type: 'credit_card', institution: 'Chase', balance: 3200, credit_limit: 10000, apr: 22.99, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd8', user_id: 'demo', name: 'Discover It', account_type: 'credit_card', institution: 'Discover', balance: 800, credit_limit: 5000, apr: 18.99, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd9', user_id: 'demo', name: 'Cash', account_type: 'cash', institution: '', balance: 500, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
];


export function useAccounts() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['accounts', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoAccounts;
      const { data, error } = await supabase.from('accounts' as any).select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: any) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('accounts' as any).insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); toast.success('Account added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('accounts' as any).update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); toast.success('Account updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('accounts' as any).delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); toast.success('Account deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Recurring Rules ─────────────────────────────────────
// FIX #14: Demo recurring rules now cover a full realistic budget with
// all rule types (income, expense, transfer, investment) so the forecast
// shows meaningful projections. Amounts are consistent with the demo
// profile's weekly_gross_income of $1875 @ 22% tax.
const demoRecurringRules = [
  // Income — $1875/week gross @ 22% tax = $1462.50 net per paycheck
  { id: 'r1', user_id: 'demo', name: 'Weekly Paycheck', amount: 1462.50, rule_type: 'income', frequency: 'weekly', due_day: 5, due_month: null, start_date: '2026-01-03', end_date: null, category: 'Other', payment_source: null, deposit_account: 'd1', active: true, notes: 'Friday deposits', created_at: '', updated_at: '' },
  // Fixed expenses
  { id: 'r2', user_id: 'demo', name: 'Rent', amount: 1400, rule_type: 'expense', frequency: 'monthly', due_day: 1, due_month: null, start_date: '2026-01-01', end_date: null, category: 'Bills', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r3', user_id: 'demo', name: 'Utilities', amount: 120, rule_type: 'expense', frequency: 'monthly', due_day: 15, due_month: null, start_date: '2026-01-15', end_date: null, category: 'Bills', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r4', user_id: 'demo', name: 'Car Insurance', amount: 280, rule_type: 'expense', frequency: 'monthly', due_day: 14, due_month: null, start_date: '2026-01-14', end_date: null, category: 'Car', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Variable expenses
  { id: 'r10', user_id: 'demo', name: 'Groceries', amount: 80, rule_type: 'expense', frequency: 'weekly', due_day: 6, due_month: null, start_date: '2026-01-06', end_date: null, category: 'Groceries', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r11', user_id: 'demo', name: 'Gas', amount: 55, rule_type: 'expense', frequency: 'weekly', due_day: 3, due_month: null, start_date: '2026-01-03', end_date: null, category: 'Gas', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r12', user_id: 'demo', name: 'Dining Out', amount: 120, rule_type: 'expense', frequency: 'monthly', due_day: 20, due_month: null, start_date: '2026-01-20', end_date: null, category: 'Dining', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Subscriptions
  { id: 'r5', user_id: 'demo', name: 'Amazon Prime', amount: 139, rule_type: 'expense', frequency: 'yearly', due_day: 15, due_month: 3, start_date: '2026-03-15', end_date: null, category: 'Subscriptions', payment_source: 'd7', deposit_account: null, active: true, notes: 'Annual renewal', created_at: '', updated_at: '' },
  { id: 'r13', user_id: 'demo', name: 'Streaming + Gym', amount: 85, rule_type: 'expense', frequency: 'monthly', due_day: 4, due_month: null, start_date: '2026-01-04', end_date: null, category: 'Subscriptions', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Transfers — savings and investments
  { id: 'r6', user_id: 'demo', name: 'Emergency Fund', amount: 300, rule_type: 'transfer', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Savings', payment_source: 'd1', deposit_account: 'd3', active: true, notes: 'HYS contribution', created_at: '', updated_at: '' },
  { id: 'r7', user_id: 'demo', name: '401k Contribution', amount: 375, rule_type: 'investment', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd4', active: true, notes: 'Pre-tax', created_at: '', updated_at: '' },
  { id: 'r8', user_id: 'demo', name: 'Roth IRA', amount: 250, rule_type: 'investment', frequency: 'monthly', due_day: 10, due_month: null, start_date: '2026-01-10', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd5', active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r9', user_id: 'demo', name: 'Brokerage', amount: 200, rule_type: 'investment', frequency: 'monthly', due_day: 10, due_month: null, start_date: '2026-01-10', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd6', active: true, notes: 'Index funds', created_at: '', updated_at: '' },
];

export function useRecurringRules() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recurring_rules', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoRecurringRules;
      const { data, error } = await supabase.from('recurring_rules' as any).select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: any) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('recurring_rules' as any).insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring_rules'] }); toast.success('Recurring rule added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('recurring_rules' as any).update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring_rules'] }); toast.success('Recurring rule updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('recurring_rules' as any).delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring_rules'] }); toast.success('Recurring rule deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Assets ───────────────────────────────────────────────
export function useAssets() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['assets', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoAssets.map((a, i) => ({ ...a, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('assets').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; type: string; value: number; notes?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('assets').insert({ ...item, user_id: user.id, notes: item.notes || '' });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; name?: string; type?: string; value?: number; notes?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('assets').update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('assets').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Liabilities ──────────────────────────────────────────
export function useLiabilities() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['liabilities', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoLiabilities.map((l, i) => ({ ...l, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('liabilities').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; type: string; balance: number; apr?: number; notes?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('liabilities').insert({ ...item, user_id: user.id, notes: item.notes || '', apr: item.apr || 0 });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liabilities'] }); toast.success('Liability added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('liabilities').update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liabilities'] }); toast.success('Liability updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('liabilities').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liabilities'] }); toast.success('Liability deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Debts ────────────────────────────────────────────────
export function useDebts() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['debts', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoDebts.map((d, i) => ({ ...d, id: String(i), user_id: 'demo', created_at: '', updated_at: '', credit_limit: (d as any).credit_limit || 0 }));
      const { data, error } = await supabase.from('debts').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; balance: number; apr: number; min_payment: number; target_payment: number; credit_limit?: number }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('debts').insert({ ...item, user_id: user.id } as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); toast.success('Debt added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('debts').update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); toast.success('Debt updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('debts').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); toast.success('Debt deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Account Reconciliations ──────────────────────────────
export function useAccountReconciliations() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['account_reconciliations', isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from('account_reconciliations' as any).select('*').eq('user_id', user.id).order('effective_date', { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: {
      account_id: string;
      source_table: 'accounts' | 'liabilities' | 'debts';
      effective_date: string;
      delta: number;
      actual_balance: number;
      projected_balance: number;
    }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('account_reconciliations' as any).insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account_reconciliations'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, add };
}

// ─── Savings Goals ────────────────────────────────────────
export function useSavingsGoals() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['savings_goals', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoSavingsGoals.map((g, i) => ({ ...g, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('savings_goals').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; target_amount: number; current_amount: number; monthly_contribution: number; target_date?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('savings_goals').insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings_goals'] }); toast.success('Goal added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('savings_goals').update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings_goals'] }); toast.success('Goal updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('savings_goals').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings_goals'] }); toast.success('Goal deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Car Funds ────────────────────────────────────────────
export function useCarFunds() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['car_funds', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoCarFunds.map((c, i) => ({ ...c, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('car_funds').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: any) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('car_funds').insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_funds'] }); toast.success('Vehicle added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('car_funds').update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_funds'] }); toast.success('Vehicle updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('car_funds').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_funds'] }); toast.success('Vehicle deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Transactions ─────────────────────────────────────────
export function useTransactions() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['transactions', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoTransactions.map((t, i) => ({ ...t, id: String(i), user_id: 'demo', created_at: '', updated_at: '', payment_source: (t as any).payment_source || 'bank_account' }));
      const { data, error } = await supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { date: string; type: string; amount: number; category: string; account?: string; note?: string; payment_source?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('transactions').insert({ ...item, user_id: user.id, note: item.note || '', account: item.account || 'Checking' } as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); toast.success('Transaction added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('transactions').update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); toast.success('Transaction updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); toast.success('Transaction deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Subscriptions ────────────────────────────────────────
const demoSubs = [
  { name: 'Spotify', cost: 10.99, billing: 'monthly', renewal_date: '2026-04-01', active: true },
  { name: 'Netflix', cost: 15.49, billing: 'monthly', renewal_date: '2026-04-05', active: true },
  { name: 'Gym Membership', cost: 49.99, billing: 'monthly', renewal_date: '2026-04-01', active: true },
  { name: 'iCloud Storage', cost: 2.99, billing: 'monthly', renewal_date: '2026-04-15', active: true },
  { name: 'Adobe Creative Suite', cost: 599.88, billing: 'yearly', renewal_date: '2026-09-01', active: true },
  { name: 'ChatGPT Plus', cost: 20.00, billing: 'monthly', renewal_date: '2026-04-10', active: false },
];

export function useSubscriptions() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['subscriptions', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoSubs.map((s, i) => ({ ...s, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('subscriptions' as any).select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: any) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('subscriptions' as any).insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('subscriptions' as any).update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('subscriptions' as any).delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Budget Items ─────────────────────────────────────────
const demoBudgetItems = [
  { label: 'Rent / Mortgage', amount: 1400, category: 'fixed' },
  { label: 'Utilities', amount: 120, category: 'fixed' },
  { label: 'Insurance', amount: 250, category: 'fixed' },
  { label: 'Subscriptions', amount: 85, category: 'fixed' },
  { label: 'Debt Payments', amount: 850, category: 'fixed' },
  { label: 'Groceries', amount: 320, category: 'variable' },
  { label: 'Dining Out', amount: 110, category: 'variable' },
  { label: 'Gas / Transport', amount: 55, category: 'variable' },
  { label: 'Entertainment', amount: 30, category: 'variable' },
  { label: 'Miscellaneous', amount: 100, category: 'variable' },
];

export function useBudgetItems() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['budget_items', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoBudgetItems.map((b, i) => ({ ...b, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('budget_items' as any).select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: any) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('budget_items' as any).insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget_items'] }); toast.success('Budget item added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; [key: string]: any }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('budget_items' as any).update(item).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget_items'] }); toast.success('Budget item updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('budget_items' as any).delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget_items'] }); toast.success('Budget item deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Profile ──────────────────────────────────────────────
// FIX #15: DEFAULT_PROFILE now has consistent values that match
// the demo recurring rules and produce correct calculations
const DEFAULT_PROFILE = {
  display_name: '', currency: 'USD', budget_start_day: 1,
  monthly_income_default: 6337.50, // 1875 * 4.33 * 0.78 (net)
  show_cents: true, compact_mode: false,
  is_premium: false,
  gross_income: 8118.75, // 1875 * 4.33
  tax_rate: 22,
  cash_floor: 1000,
  weekly_gross_income: 1875,
  paycheck_frequency: 'weekly',
  paycheck_day: 5,
  default_deposit_account: null,
  auto_generate_recurring: true,
};

export function useProfile() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['profile', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return { ...DEFAULT_PROFILE, display_name: 'Demo User', is_premium: true };
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data) {
          // Auto-create profile if missing
          const { data: newProfile, error: insertErr } = await supabase
            .from('profiles')
            .insert({ user_id: user.id } as any)
            .select()
            .maybeSingle();
          if (insertErr) {
            console.error('Failed to auto-create profile:', insertErr.message);
            return { ...DEFAULT_PROFILE, user_id: user.id };
          }
          return newProfile ?? { ...DEFAULT_PROFILE, user_id: user.id };
        }
        return data;
      } catch (err) {
        console.error('Profile fetch error:', err);
        return { ...DEFAULT_PROFILE, user_id: user.id };
      }
    },
    retry: 1,
  });
  const update = useMutation({
    mutationFn: async (item: Record<string, any>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('profiles').update(item as any).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); toast.success('Settings saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? DEFAULT_PROFILE, loading: query.isLoading, error: query.error, update };
}
