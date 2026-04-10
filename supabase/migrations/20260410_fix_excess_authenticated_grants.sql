-- Migration: fix_excess_authenticated_grants
-- Applied: 2026-04-10
-- Purpose: Revoke write grants from authenticated role where no write policies exist.
--   Grants were wider than the RLS policies, creating unnecessary attack surface.
--   RLS already blocked these operations — this aligns grants with actual intent.

-- subscriptions: Stripe webhooks (service_role) own all writes, users get SELECT only
REVOKE INSERT, UPDATE, DELETE ON TABLE public.subscriptions FROM authenticated;

-- user_subscriptions: Stripe webhooks (service_role) own all writes, users get SELECT only
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_subscriptions FROM authenticated;

-- profiles: no DELETE policy exists and users should not delete their own profile row
REVOKE DELETE ON TABLE public.profiles FROM authenticated;
