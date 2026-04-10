-- Migration: fix_rls_policies
-- Applied: 2026-04-10
-- Purpose: Harden RLS across all public tables.
--   - Revoke all anon grants from user-data tables
--   - Convert all {public} policies to {authenticated}
--   - Remove duplicate insert_own policies
--   - Restrict subscriptions/user_subscriptions to SELECT-only (service_role manages writes via Stripe webhooks)
--   - Lock subscription_tiers to SELECT-only for anon/authenticated (no user should mutate tier definitions)

-- ============================================================
-- PROFILES
-- ============================================================
REVOKE ALL ON TABLE public.profiles FROM anon;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "insert_own" ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
REVOKE ALL ON TABLE public.subscriptions FROM anon;

DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can delete own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "insert_own" ON public.subscriptions;

-- SELECT only — Stripe webhooks (service_role) manage all writes
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- USER_SUBSCRIPTIONS
-- ============================================================
REVOKE ALL ON TABLE public.user_subscriptions FROM anon;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.user_subscriptions;
DROP POLICY IF EXISTS "select_own" ON public.user_subscriptions;

-- SELECT only — Stripe webhooks (service_role) manage all writes
CREATE POLICY "user_subscriptions_select_own" ON public.user_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- SUBSCRIPTION_TIERS
-- ============================================================
-- Anon retains SELECT (public pricing page policy stays as-is)
-- Remove write grants from anon and authenticated — only service_role should mutate tiers
REVOKE INSERT, UPDATE, DELETE ON TABLE public.subscription_tiers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.subscription_tiers FROM authenticated;

-- ============================================================
-- ACCOUNTS
-- ============================================================
REVOKE ALL ON TABLE public.accounts FROM anon;

DROP POLICY IF EXISTS "Users can view own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can insert own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can update own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can delete own accounts" ON public.accounts;
DROP POLICY IF EXISTS "insert_own" ON public.accounts;

CREATE POLICY "accounts_select_own" ON public.accounts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "accounts_insert_own" ON public.accounts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "accounts_update_own" ON public.accounts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "accounts_delete_own" ON public.accounts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
REVOKE ALL ON TABLE public.transactions FROM anon;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
DROP POLICY IF EXISTS "insert_own" ON public.transactions;

CREATE POLICY "transactions_select_own" ON public.transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "transactions_insert_own" ON public.transactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions_update_own" ON public.transactions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions_delete_own" ON public.transactions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- ASSETS
-- ============================================================
REVOKE ALL ON TABLE public.assets FROM anon;

DROP POLICY IF EXISTS "Users can view own assets" ON public.assets;
DROP POLICY IF EXISTS "Users can insert own assets" ON public.assets;
DROP POLICY IF EXISTS "Users can update own assets" ON public.assets;
DROP POLICY IF EXISTS "Users can delete own assets" ON public.assets;
DROP POLICY IF EXISTS "insert_own" ON public.assets;

CREATE POLICY "assets_select_own" ON public.assets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "assets_insert_own" ON public.assets
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "assets_update_own" ON public.assets
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "assets_delete_own" ON public.assets
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- DEBTS
-- ============================================================
REVOKE ALL ON TABLE public.debts FROM anon;

DROP POLICY IF EXISTS "Users can view own debts" ON public.debts;
DROP POLICY IF EXISTS "Users can insert own debts" ON public.debts;
DROP POLICY IF EXISTS "Users can update own debts" ON public.debts;
DROP POLICY IF EXISTS "Users can delete own debts" ON public.debts;
DROP POLICY IF EXISTS "insert_own" ON public.debts;

CREATE POLICY "debts_select_own" ON public.debts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "debts_insert_own" ON public.debts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "debts_update_own" ON public.debts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "debts_delete_own" ON public.debts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- LIABILITIES
-- ============================================================
REVOKE ALL ON TABLE public.liabilities FROM anon;

DROP POLICY IF EXISTS "Users can view own liabilities" ON public.liabilities;
DROP POLICY IF EXISTS "Users can insert own liabilities" ON public.liabilities;
DROP POLICY IF EXISTS "Users can update own liabilities" ON public.liabilities;
DROP POLICY IF EXISTS "Users can delete own liabilities" ON public.liabilities;
DROP POLICY IF EXISTS "insert_own" ON public.liabilities;

CREATE POLICY "liabilities_select_own" ON public.liabilities
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "liabilities_insert_own" ON public.liabilities
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "liabilities_update_own" ON public.liabilities
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "liabilities_delete_own" ON public.liabilities
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- BUDGET_ITEMS
-- ============================================================
REVOKE ALL ON TABLE public.budget_items FROM anon;

DROP POLICY IF EXISTS "Users can view own budget items" ON public.budget_items;
DROP POLICY IF EXISTS "Users can insert own budget items" ON public.budget_items;
DROP POLICY IF EXISTS "Users can update own budget items" ON public.budget_items;
DROP POLICY IF EXISTS "Users can delete own budget items" ON public.budget_items;
DROP POLICY IF EXISTS "insert_own" ON public.budget_items;

CREATE POLICY "budget_items_select_own" ON public.budget_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "budget_items_insert_own" ON public.budget_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "budget_items_update_own" ON public.budget_items
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "budget_items_delete_own" ON public.budget_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- CAR_FUNDS
-- ============================================================
REVOKE ALL ON TABLE public.car_funds FROM anon;

DROP POLICY IF EXISTS "Users can view own car funds" ON public.car_funds;
DROP POLICY IF EXISTS "Users can insert own car funds" ON public.car_funds;
DROP POLICY IF EXISTS "Users can update own car funds" ON public.car_funds;
DROP POLICY IF EXISTS "Users can delete own car funds" ON public.car_funds;
DROP POLICY IF EXISTS "insert_own" ON public.car_funds;

CREATE POLICY "car_funds_select_own" ON public.car_funds
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "car_funds_insert_own" ON public.car_funds
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "car_funds_update_own" ON public.car_funds
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "car_funds_delete_own" ON public.car_funds
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- RECURRING_RULES
-- ============================================================
REVOKE ALL ON TABLE public.recurring_rules FROM anon;

DROP POLICY IF EXISTS "Users can view own rules" ON public.recurring_rules;
DROP POLICY IF EXISTS "Users can insert own rules" ON public.recurring_rules;
DROP POLICY IF EXISTS "Users can update own rules" ON public.recurring_rules;
DROP POLICY IF EXISTS "Users can delete own rules" ON public.recurring_rules;
DROP POLICY IF EXISTS "insert_own" ON public.recurring_rules;

CREATE POLICY "recurring_rules_select_own" ON public.recurring_rules
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "recurring_rules_insert_own" ON public.recurring_rules
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "recurring_rules_update_own" ON public.recurring_rules
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "recurring_rules_delete_own" ON public.recurring_rules
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- SAVINGS_GOALS
-- ============================================================
REVOKE ALL ON TABLE public.savings_goals FROM anon;

DROP POLICY IF EXISTS "Users can view own goals" ON public.savings_goals;
DROP POLICY IF EXISTS "Users can insert own goals" ON public.savings_goals;
DROP POLICY IF EXISTS "Users can update own goals" ON public.savings_goals;
DROP POLICY IF EXISTS "Users can delete own goals" ON public.savings_goals;
DROP POLICY IF EXISTS "insert_own" ON public.savings_goals;

CREATE POLICY "savings_goals_select_own" ON public.savings_goals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "savings_goals_insert_own" ON public.savings_goals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "savings_goals_update_own" ON public.savings_goals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "savings_goals_delete_own" ON public.savings_goals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- NET_WORTH_SNAPSHOTS
-- ============================================================
REVOKE ALL ON TABLE public.net_worth_snapshots FROM anon;

DROP POLICY IF EXISTS "users_own_snapshots" ON public.net_worth_snapshots;

CREATE POLICY "net_worth_snapshots_select_own" ON public.net_worth_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "net_worth_snapshots_insert_own" ON public.net_worth_snapshots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "net_worth_snapshots_update_own" ON public.net_worth_snapshots
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "net_worth_snapshots_delete_own" ON public.net_worth_snapshots
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- ACCOUNT_RECONCILIATIONS
-- ============================================================
REVOKE ALL ON TABLE public.account_reconciliations FROM anon;

DROP POLICY IF EXISTS "Users can insert own reconciliations" ON public.account_reconciliations;
DROP POLICY IF EXISTS "users see own reconciliations" ON public.account_reconciliations;

CREATE POLICY "account_reconciliations_select_own" ON public.account_reconciliations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "account_reconciliations_insert_own" ON public.account_reconciliations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "account_reconciliations_update_own" ON public.account_reconciliations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "account_reconciliations_delete_own" ON public.account_reconciliations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- RATE_LIMITS — no changes needed
-- RLS ON, no policies (default deny), service_role only. Correct as-is.
-- ============================================================
