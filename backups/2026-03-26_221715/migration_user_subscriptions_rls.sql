-- Migration: Fix user_subscriptions RLS
-- Apply manually in Supabase SQL Editor.
-- Safe to run multiple times.
--
-- Finding 1 (CRITICAL): Remove INSERT policy that allowed any user to
--   self-grant premium by posting directly to user_subscriptions.
--   All legitimate writes go through Edge Functions using the service role
--   key, which bypasses RLS — this policy is not needed and is dangerous.
--
-- Finding 2 (HIGH): Add SELECT own-rows-only policy so the client-side
--   useSubscription hook can read the user's own subscription status.
--   Without this policy, all reads return 0 rows → everyone appears free.

-- Step 1: Remove the dangerous INSERT policy
DROP POLICY IF EXISTS "insert_own" ON public.user_subscriptions;

-- Step 2: Add SELECT policy — users may only read their own row
DROP POLICY IF EXISTS "select_own" ON public.user_subscriptions;
CREATE POLICY "select_own" ON public.user_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Verify result:
-- SELECT policyname, cmd, qual FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'user_subscriptions';
--
-- Expected: one row — policyname='select_own', cmd='SELECT', qual='(auth.uid() = user_id)'
-- No INSERT, UPDATE, or DELETE policies should exist.
