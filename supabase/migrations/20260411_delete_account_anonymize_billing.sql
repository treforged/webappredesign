-- Allow user_id to be NULL so billing rows can survive after account deletion
ALTER TABLE public.user_subscriptions
  ALTER COLUMN user_id DROP NOT NULL;

-- Track when a row was anonymized (IRS 7-year retention)
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz DEFAULT NULL;
