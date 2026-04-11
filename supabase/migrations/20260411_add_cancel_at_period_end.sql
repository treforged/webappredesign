-- Migration: add_cancel_at_period_end
-- Applied: 2026-04-11
-- Purpose: Track whether a subscription is scheduled to cancel at period end.
--   Populated by the stripe-webhook function on customer.subscription.updated.
--   Read by the frontend to show "cancels on [date]" messaging and the Resume button.

ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
