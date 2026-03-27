-- Migration: account_reconciliations table
-- Apply in Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS public.account_reconciliations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id        text NOT NULL,
  source_table      text NOT NULL CHECK (source_table IN ('accounts', 'liabilities', 'debts')),
  effective_date    date NOT NULL,
  delta             numeric NOT NULL,
  actual_balance    numeric NOT NULL,
  projected_balance numeric NOT NULL,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.account_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own reconciliations"
  ON public.account_reconciliations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast per-account lookups
CREATE INDEX IF NOT EXISTS idx_reconciliations_account
  ON public.account_reconciliations (user_id, account_id, effective_date DESC);
