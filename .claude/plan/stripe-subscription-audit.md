# Plan: Stripe Subscription Audit + Hardening

**Date:** 2026-03-26
**Status:** REPORT ONLY — no code changes applied. Awaiting confirmation.
**Tasks:** 3 — Stripe authority, billing flow fixes, coupon flow

---

## Audit Scope

Files read:
- `src/hooks/useSubscription.ts` — client subscription state
- `src/hooks/useSupabaseData.ts` — profile hook, `is_premium` field
- `src/contexts/AuthContext.tsx` — demo flag
- `src/components/shared/PremiumGate.tsx` — rendering gate
- `src/pages/Dashboard.tsx`, `NetWorth.tsx` — gate call sites
- `src/pages/Premium.tsx` — checkout/portal trigger
- `src/pages/PremiumSuccess.tsx`, `PremiumCancel.tsx` — post-checkout pages
- `src/pages/Settings.tsx` — subscription display
- `supabase/functions/create-checkout/index.ts`
- `supabase/functions/create-portal-session/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `src/integrations/supabase/types.ts` — table schemas
- `backups/2026-03-26_205859/migration_rls_insert_policies.sql` — previously applied RLS

---

## FINDINGS

### FINDING 1 — CRITICAL: INSERT RLS policy allows any user to self-grant premium

**Severity:** CRITICAL
**Location:** `user_subscriptions` table, applied via `migration_rls_insert_policies.sql`
**What it is:**
The previous session added:
```sql
CREATE POLICY "insert_own" ON public.user_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```
This policy allows any authenticated user to INSERT a row into `user_subscriptions` with their own `user_id`. There is nothing preventing them from setting `plan = 'premium'` and `subscription_status = 'active'` in that row.

**Attack:**
Any logged-in user can call the Supabase REST API directly:
```bash
POST https://<project>.supabase.co/rest/v1/user_subscriptions
Authorization: Bearer <their-jwt>
apikey: <public-anon-key>
Content-Type: application/json

{"user_id":"<their-uid>","plan":"premium","subscription_status":"active"}
```
This grants themselves premium access at no cost, bypassing Stripe entirely.

**Why it exists:** The previous session was trying to add ownership constraints to user-data tables. For most tables (`accounts`, `transactions`, etc.), an INSERT-own policy is correct. For `user_subscriptions` specifically, it is not — this table should never accept client writes at all, because all legitimate writes go through Edge Functions using the service-role key, which bypasses RLS.

**Proposed fix:**
```sql
DROP POLICY IF EXISTS "insert_own" ON public.user_subscriptions;
```
No client-side INSERT policy is needed. Service role bypasses RLS — all legitimate writes (webhook, checkout) continue to work.

---

### FINDING 2 — HIGH: No SELECT policy on `user_subscriptions` (behavior depends on RLS state)

**Severity:** HIGH
**Location:** `user_subscriptions` table + `src/hooks/useSubscription.ts:22-25`
**What it is:**
The client reads `user_subscriptions` directly:
```ts
const { data, error } = await supabase
  .from('user_subscriptions' as any)
  .select('*')
  .eq('user_id', user.id)
  .maybeSingle();
```
Two possible states, both problematic:
- **If RLS is ON + no SELECT policy:** query returns 0 rows → `isPremium` is always `false` → all paying users see a paywall. Premium is broken for everyone.
- **If RLS is ON + no per-row SELECT restriction:** any user could enumerate all other users' subscription statuses by querying without the `eq('user_id')` filter (if they call the API directly).

**Proposed fix:**
```sql
CREATE POLICY "select_own" ON public.user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
```
This lets users read only their own row, which is all the client hook needs.

---

### FINDING 3 — HIGH: `PremiumSuccess.tsx` does not trigger a subscription data refresh

**Severity:** HIGH
**Location:** `src/pages/PremiumSuccess.tsx`
**What it is:**
After a successful Stripe checkout, the user lands on `/premium/success`. The page renders a static "Welcome to Premium!" message with a link to Dashboard. It does not call `useSubscription().refetch()` or wait for the webhook to update the DB.

**Sequence of events:**
1. User pays → Stripe redirects to `/premium/success?session_id=...`
2. Stripe sends `checkout.session.completed` webhook asynchronously (100ms–5s delay)
3. Webhook updates `user_subscriptions` in DB
4. User clicks "Go to Dashboard" — React Query cache still has the old free-tier data
5. Dashboard shows the paywall
6. User wonders if payment worked

**Proposed fix:**
On mount, `PremiumSuccess.tsx` should:
1. Read the `session_id` from the URL query string (already passed by Stripe)
2. Call `useSubscription().refetch()` in a polling loop (max 10s, 1s intervals) until `isPremium === true`
3. Show a spinner ("Activating your subscription...") while polling
4. On success: show the confirmation message
5. On timeout: show "Subscription confirmed — it may take a moment to activate" with a manual refresh link

---

### FINDING 4 — HIGH: `invoice.payment_succeeded` is listed but not handled in webhook

**Severity:** HIGH
**Location:** `supabase/functions/stripe-webhook/index.ts:34-46`
**What it is:**
```ts
const relevantEvents = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",  // ← listed
  "invoice.payment_failed",
];
// ...
if (event.type === "invoice.payment_failed") { ... }
// No handler for invoice.payment_succeeded
```
Stripe sends `invoice.payment_succeeded` when a payment recovers after `past_due`. Without a handler, a user who had their card declined and later updates their payment method will have their `subscription_status` stay at `past_due` in the DB indefinitely — even though Stripe shows them as `active` again.

In practice, Stripe also sends `customer.subscription.updated` when a subscription recovers, which IS handled. So the immediate breakage risk is lower. However, the intent is clearly to handle this event and it silently does nothing, which is a logic gap.

**Proposed fix:**
Add a handler for `invoice.payment_succeeded`:
```ts
if (event.type === "invoice.payment_succeeded") {
  const invoice = event.data.object;
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  const { data: userSub } = await supabase
    .from("user_subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (userSub && subscriptionId) {
    await supabase.from("user_subscriptions").update({
      subscription_status: "active",
      stripe_subscription_id: subscriptionId,
    }).eq("user_id", userSub.user_id);

    await supabase.from("profiles")
      .update({ is_premium: true })
      .eq("user_id", userSub.user_id);
  }
}
```

---

### FINDING 5 — MEDIUM: Open redirect in `create-portal-session`

**Severity:** MEDIUM (previously flagged as LOW in prior audit — re-evaluated upward)
**Location:** `supabase/functions/create-portal-session/index.ts:57-58`
**What it is:**
```ts
const { return_url } = await req.json();
const origin = return_url || req.headers.get("origin") || "https://app.treforged.com";
```
The `return_url` from the request body is passed directly to Stripe as the portal's return URL. An attacker with a valid JWT could craft a request redirecting the user to an arbitrary domain after billing portal actions (e.g., subscription cancellation).

While Stripe whitelists return URLs in the Dashboard, this still represents unvalidated client input flowing to a third-party redirect. Elevated to MEDIUM because it's authenticated (not critical) but the bypass method is trivial.

**Proposed fix:**
```ts
// Ignore client-provided return_url — derive from request Origin header only
const origin = req.headers.get("origin") || "https://app.treforged.com";
```

---

### FINDING 6 — MEDIUM: `profiles.is_premium` is written by webhook but never read for access control

**Severity:** MEDIUM (code confusion risk)
**Location:** `supabase/functions/stripe-webhook/index.ts:72,97` + `src/hooks/useSupabaseData.ts:519,537`
**What it is:**
The webhook writes `is_premium: true/false` to the `profiles` table on every subscription event. But:
- `useSubscription.ts` derives `isPremium` from `user_subscriptions.plan + subscription_status` — NOT from `profiles.is_premium`
- `PremiumGate` receives `isPremium` from `useSubscription`, not from profile
- `DEFAULT_PROFILE` has `is_premium: false`
- Demo profile returns `is_premium: true` in `useProfile()`

So `profiles.is_premium` is written but never authoritative for access decisions. It's dead state that could mislead future developers into thinking it controls premium access when it does not.

**Proposed fix (two options):**
- **Option A (preferred):** Remove the `profiles.is_premium` updates from the webhook entirely. Subscription status lives in `user_subscriptions`; no need to mirror it to `profiles`.
- **Option B:** Document explicitly in code that `profiles.is_premium` is a non-authoritative cache and must never be used for access gating. Keep writing it for informational display in Settings if desired.

---

### FINDING 7 — MEDIUM: Coupon grants have no `stripe_subscription_id` — portal shows "No subscription found"

**Severity:** MEDIUM
**Location:** `supabase/functions/create-checkout/index.ts:66-72`
**What it is:**
When a valid coupon code is entered, the Edge Function upserts:
```ts
{ user_id: userId, plan: "premium", subscription_status: "active" }
```
No `stripe_customer_id`, no `stripe_subscription_id`, no `current_period_end` are set. This means:
- The user gets premium access ✓
- If the user tries to manage billing via "Manage Billing" button → `create-portal-session` fails with `"No subscription found"` (checks for `stripe_customer_id`)
- No expiry date
- No record in Stripe dashboard
- No way to revoke through Stripe

The coupon grant is permanent with no management interface.

**Architecture question raised by TASK 3:**
Should coupons use Stripe-native promo codes instead?

| | Current custom approach | Stripe-native promo code |
|---|---|---|
| Setup | Only env var | Stripe dashboard coupon + promo code object |
| User flow | Enter code on `/premium` page, no Stripe checkout | Goes through Stripe checkout with 100% discount |
| Billing portal | Not accessible | Full portal access (cancel, manage) |
| Audit trail | None in Stripe | Full subscription record in Stripe |
| Expiry | Never (permanent) | Configurable |
| Shareable | No (env var) | Yes, unless max_redemptions=1 |
| Architecture | DB write bypasses Stripe | Normal subscription flow |

**Recommendation for personal use:** Keep the current custom approach. It's appropriate for a single personal access code and avoids Stripe dashboard config. But fix the UX: detect coupon-granted subscriptions (`stripe_subscription_id IS NULL AND plan = 'premium'`) and hide the "Manage Billing" button for them, or show a static message instead of an error.

**Proposed fix:**
In `Premium.tsx`, the "Manage Billing" button is conditioned on `hasStripeCustomer`. Ensure this condition stays respected and coupon users don't see the button (they won't have a `stripe_customer_id`).

In `create-checkout`, when a coupon is valid, also upsert the `stripe_customer_id` if one already exists (preserve existing data). Current code only sets `plan` and `status` — it could overwrite an existing customer ID if using `onConflict: "user_id"` with a full upsert. **Fix: use a targeted UPDATE instead of full upsert for coupon grants if the user already has a row.**

---

### FINDING 8 — LOW: `invoice.payment_failed` sets `past_due` but does not revoke access

**Severity:** LOW (intentional grace period behavior)
**Location:** `supabase/functions/stripe-webhook/index.ts:101-116`
**What it is:**
On `invoice.payment_failed`, the webhook sets `subscription_status = "past_due"`. But `useSubscription.ts` only grants premium if status is `'active'` or `'trialing'`. So `past_due` users will immediately lose access.

This may be intentional (strict enforcement), or you may want a grace period. Stripe's default is to retry failed payments 3–4 times before cancelling. During retries, Stripe keeps the subscription in `past_due` state. A strict read of the current code means users lose access immediately on first payment failure, before Stripe has finished retrying.

**No fix required** unless you want a grace period — in that case, add `'past_due'` to the `isPremium` status check in `useSubscription.ts`.

---

### FINDING 9 — LOW: Raw fetch in webhook instead of Stripe SDK for subscription retrieval

**Severity:** LOW (code consistency)
**Location:** `supabase/functions/stripe-webhook/index.ts:57-60`
**What it is:**
The file imports and uses `Stripe` SDK for `constructEvent`, but falls back to raw fetch for retrieving subscription details:
```ts
const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
  headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
});
```
This is inconsistent with the SDK pattern used elsewhere in the file.

**Proposed fix:**
```ts
const sub = await stripe.subscriptions.retrieve(subscriptionId);
```

---

### FINDING 10 — LOW: CORS `Allow-Origin: "*"` on all Edge Functions

**Severity:** LOW (mitigated by JWT requirement)
**Location:** All three Edge Functions
**What it is:**
All functions return `"Access-Control-Allow-Origin": "*"`. The stripe-webhook function doesn't need CORS headers at all (server-to-server). The other two require a valid JWT so the risk is limited. However, `*` allows any origin to make cross-origin requests.

**No fix required** unless you want to restrict to your specific domain (e.g., `https://app.treforged.com`).

---

## Summary Table

| # | Finding | Severity | Requires DB | Requires Deploy |
|---|---------|----------|-------------|-----------------|
| 1 | INSERT policy lets users self-grant premium | **CRITICAL** | YES — drop policy | No |
| 2 | No SELECT policy — client reads return empty | **HIGH** | YES — add policy | No |
| 3 | PremiumSuccess doesn't refresh subscription | **HIGH** | No | No |
| 4 | invoice.payment_succeeded not handled | **HIGH** | No | YES — redeploy webhook |
| 5 | Open redirect in portal return_url | **MEDIUM** | No | YES — redeploy portal |
| 6 | profiles.is_premium written but unused | **MEDIUM** | No | YES — redeploy webhook |
| 7 | Coupon grants missing stripe data, portal fails | **MEDIUM** | No | YES — redeploy checkout |
| 8 | past_due = immediate access loss | **LOW** | No | No (if intentional) |
| 9 | Raw fetch instead of Stripe SDK in webhook | **LOW** | No | YES — redeploy webhook |
| 10 | CORS Allow-Origin: * | **LOW** | No | No (not blocking) |

---

## Proposed Execution Plan (pending your confirmation)

### DB Changes (apply manually in Supabase SQL Editor)

```sql
-- Fix Finding 1: remove dangerous INSERT policy
DROP POLICY IF EXISTS "insert_own" ON public.user_subscriptions;

-- Fix Finding 2: add SELECT own-rows-only policy
DROP POLICY IF EXISTS "select_own" ON public.user_subscriptions;
CREATE POLICY "select_own" ON public.user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
```

### Code Changes

**`supabase/functions/stripe-webhook/index.ts`**
- Fix 4: Add `invoice.payment_succeeded` handler
- Fix 6: Remove `profiles.is_premium` write calls (both locations)
- Fix 9: Replace raw fetch with `stripe.subscriptions.retrieve(subscriptionId)`

**`supabase/functions/create-portal-session/index.ts`**
- Fix 5: Replace `return_url || req.headers.get("origin")` with `req.headers.get("origin")` only

**`supabase/functions/create-checkout/index.ts`**
- Fix 7: Change coupon upsert to preserve existing `stripe_customer_id` — use targeted UPDATE if row exists, INSERT only if new

**`src/pages/PremiumSuccess.tsx`**
- Fix 3: Poll subscription refetch on mount, show spinner until `isPremium === true` or 10s timeout

### Edge Function Deploys Required
After code changes: redeploy all 3 Edge Functions manually via Supabase dashboard (MCP deploy blocked by permissions).

---

## What is NOT changing (by design)

- Demo mode behavior — unchanged
- `isPremium` computation logic in `useSubscription.ts` — unchanged (statuses: active, trialing)
- `PremiumGate` component — unchanged
- The two `PremiumGate` call sites in `Dashboard.tsx` and `NetWorth.tsx` — unchanged
- Real non-subscribed users continue to see the paywall — unchanged
- Coupon architecture stays custom (env-var, server-side, JWT-verified) — not switching to Stripe promo codes
- `profiles.is_premium` in demo profile (`is_premium: true`) — no change to demo behavior

---

## SESSION_ID
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
