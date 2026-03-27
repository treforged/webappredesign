# Plan: Debt Engine V2 — Event-Based Simulation, Projected Transactions, Net Worth Chart

**Reconstructed 2026-03-27** (original lost to session compaction; all 8 corrections pre-applied)

---

## Overview

Four tasks to replace the flat-scalar debt simulation with a correct event-based engine,
surface projected debt payments as renderable transactions, and fix Net Worth chart ordering.

---

## TASK 1 — Rewrite `simulateVariablePayoff` in `src/lib/credit-card-engine.ts`

### Constraints

- The engine must operate on **event-based data**
  - Each income and expense event has an explicit date
  - The engine processes events in chronological order within each month
  - Even when values are summarized for monthly output, the underlying logic must
    reflect actual transaction dates
  - Monthly totals must be derived from dated events, not static profile values like
    `weekly_gross_income * 4`

- **Overpayment safety**: If all credit card balances reach $0 and remaining cash > 0:
  - Stop allocation immediately
  - Do not allow any card balance to go negative
  - Remaining cash stays in checking — it is not redistributed elsewhere
  - This surplus must be visible in the projected end-of-month cash balance

### Step-by-Step Algorithm

#### Step 1 — Initialise

```
balances = Map<cardId, card.balance>   // copy of starting balances
currentCash = liquidCash               // liquid checking balance right now
monthlyPayments = Map<cardId, number[]>
```

#### Step 2 — Available Cash (per month)

**Current month (month index 0, today → end of month):**
- Income: only count paychecks and recurring income events dated **today or later**
  within this calendar month
- Expenses: only count cash expenses dated **today or later** within this calendar month
- Already-spent money (transactions before today) is already reflected in the current
  account balance — do not double-count it

**Future months (index 1+, first day → last day of month):**
- Include ALL income and expense events for the full calendar month

```
month_income  = sum of dated income events in scope above
month_expenses = sum of dated expense events in scope above
available_cash = liquidCash + month_income - month_expenses - cash_floor
```

**Edge cases:**
- If `available_cash < 0` before minimums: set to `0`, emit `UNSTABLE` flag
- If covering minimum payments requires going below `(liquid_cash - cash_floor)`:
  - Allow it — minimums override the floor
  - Emit `FLOOR_BREACHED` flag
  - For minimums: `available_cash = liquidCash` (ignore floor)
- Extra payments must still respect the floor:
  - Extra payments only use cash above the floor
  - Never use floor-protected cash for extra payments

#### Step 3 — Pay Minimums

For each active card (balance > 0), sorted by strategy:

```
min_due = min(card.minPayment, balance)
pay minimums first, deduct from available_cash
```

If `available_cash < total_minimums`: emit `FLOOR_BREACHED`, pay proportionally
using `liquidCash` (not `available_cash`) for this month.

#### Step 4 — Extra Payment Calculation

```
remaining = available_cash - sum_of_minimums_paid
```

For each card in strategy order (avalanche = highest APR first, snowball = lowest balance first):

```
extra = min(remaining, card.balance)
```

> **Correction C3**: `card.balance` has already been reduced by the minimum payment
> in Step 3. Do NOT subtract `already_paid_this_month` again — that causes double
> subtraction and understates the extra payment available.

Apply extra to card, reduce `remaining`. If card reaches $0, carry leftover to next
card in order (same month). Stop when `remaining <= 0` or all balances are $0.

**Overpayment guard**: Once all card balances = $0, stop. Do not continue allocating.
Remaining cash stays in checking.

#### Step 5 — Update Balances

```
for each card:
  balances[card.id] = max(0, balances[card.id] - total_payment[card.id])
  currentCash -= total_payment[card.id]
```

Record `monthlyPayments[card.id].push(total_payment)`.

#### Step 6 — Interest (applied AFTER all payments)

Interest is calculated AFTER all payments for the month are applied.

```
end_of_month_balance = balances[card.id]   // after minimums + extra

if end_of_month_balance > 0:
  interest = (card.apr / 100 / 12) * end_of_month_balance
  next_month_starting_balance = end_of_month_balance + interest
else:
  interest = 0
  next_month_starting_balance = 0
```

Interest is **never applied mid-month**. It is always added to the **NEXT month's
starting balance** only.

#### Step 7 — Advance Month

```
currentCash += month_income - month_expenses   // net cash position entering next month
```

#### Step 8 — Repeat until all balances = 0 or month > 120 (safety cap)

### Return Value

```ts
{
  monthlyPayments: Map<string, number[]>;
  projectedPayoffMonths: number;
  cashFloorBreaches: { month: number; endingCash: number }[];
  flags: { month: number; flag: 'UNSTABLE' | 'FLOOR_BREACHED' }[];
  projectedCashByMonth: number[];
  // Debt payments as renderable transaction records (C6):
  debtPaymentTransactions: DebtPaymentTransaction[];
}
```

### Debt Payment Transaction Shape (C6)

The engine must return debt payments in this structure so they can be rendered as
projected transactions in the transactions list:

```ts
interface DebtPaymentTransaction {
  date: string;           // ISO date of payment (end of month)
  description: string;    // e.g. "Prime Visa Payment"
  amount: number;         // negative (outflow from checking)
  account: string;        // checking account id
  category: "Debt Payments";
  card: string;           // credit card account id
  type: "debt_payoff";
  projected: true;
}
```

One record per card per month where a payment occurs.

### Files changed (TASK 1)

| File | Operation | Change |
|------|-----------|--------|
| `src/lib/credit-card-engine.ts` | Modify | Rewrite `simulateVariablePayoff` per Steps 1–8 above |
| `src/lib/credit-card-engine.ts` | Modify | Add `DebtPaymentTransaction` type + include in return value |
| `src/lib/credit-card-engine.ts` | Modify | Add `flags` array to return value (UNSTABLE, FLOOR_BREACHED) |

---

## TASK 2 — Forecast page: consume corrected engine output

The Forecast `projections` useMemo (Forecast.tsx:180) currently:
- Passes flat `monthlyTakeHome` and `monthlyExpenses` scalars to `simulateVariablePayoff`
- These are not event-based (violates C5)
- Does not use `debtPaymentTransactions` from the engine return value (C6 not implemented)

### Fix

- Pass dated event arrays (from `mergeWithGeneratedTransactions`) into the engine
  instead of flat scalars
- Month 0: filter events to today→EOM only (C1 current month scoping)
- Months 1+: pass full month event arrays (C1 future month scoping)
- Consume `projectedCashByMonth` from engine return for the cash floor pass (Pass 2)
  instead of re-deriving from scalars

### Files changed (TASK 2)

| File | Operation | Change |
|------|-----------|--------|
| `src/pages/Forecast.tsx` | Modify | Replace flat scalar args to `simulateVariablePayoff` with dated event arrays |
| `src/pages/Forecast.tsx` | Modify | Month 0 scoping: filter events to today→EOM |

---

## TASK 3 — Transactions list: render projected debt payments

Consume `debtPaymentTransactions` from engine output and merge into the projected
transactions list so debt payments appear in the Transactions page under the
"Forecast Range" filter.

### Files changed (TASK 3)

| File | Operation | Change |
|------|-----------|--------|
| `src/pages/Transactions.tsx` | Modify | Accept and render `DebtPaymentTransaction[]` records in forecast-range view |
| `src/lib/credit-card-engine.ts` | Modify | Export `DebtPaymentTransaction` type |

---

## TASK 4 — Net Worth Chart: chronological ordering

All transactions (real and projected) must be sorted strictly by date ascending
before computing running balances.

**Sort rule:**
- Primary: date ascending
- Tie-breaking (same date): process expenses before income (conservative ordering)
- Within same type on same date: order does not matter

Never compute a balance snapshot out of chronological order.

### Where to apply

`src/pages/Forecast.tsx` Pass 3 (line 374+): the `baseData` array is built by
iterating `i = 0..35` month-by-month from today. Within each month, transactions
from `mergeWithGeneratedTransactions` must be sorted by date before summing.

`src/lib/debt-transaction-generator.ts`: any function that accumulates balances
across transaction records must sort before iterating.

### Files changed (TASK 4)

| File | Operation | Change |
|------|-----------|--------|
| `src/pages/Forecast.tsx` | Modify | Sort within-month events by date before summing (Pass 1 and Pass 3) |
| `src/lib/debt-transaction-generator.ts` | Modify | Sort transaction arrays before balance accumulation |

---

## TASK 5 — Manual Balance Reconciliation

When a user manually edits an account balance (checking, savings, or credit card),
do NOT silently overwrite the balance or erase history.

### Step 1 — Capture snapshot

```
actual_entered_balance   = what the user typed
effective_timestamp      = now (or user-selected date)
projected_system_balance = what the engine calculated at that timestamp
```

### Step 2 — Compute delta

```
reconciliation_delta = actual_entered_balance - projected_system_balance
```

If `delta = 0`: no event created, no action. Return immediately.

### Step 3 — Persist reconciliation event

Persist to DB for all account types (checking, savings, credit card).

```ts
interface ReconciliationEvent {
  account_id:         string;
  effective_date:     string;   // ISO date
  delta:              number;   // actual - projected (can be negative)
  actual_balance:     number;
  projected_balance:  number;
  type:               "reconciliation";
}
```

- `projected: false` — this is a confirmed real adjustment, not a forecast
- Read-only — user cannot edit or delete it
- Multiple reconciliations on same account are allowed

**New DB table required:**
```sql
CREATE TABLE IF NOT EXISTS public.account_reconciliations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL,
  effective_date   date NOT NULL,
  delta            numeric NOT NULL,
  actual_balance   numeric NOT NULL,
  projected_balance numeric NOT NULL,
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE public.account_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own reconciliations"
  ON public.account_reconciliations FOR ALL
  USING (auth.uid() = user_id);
```

### Step 4 — Recalculate forward

- All future projections use `actual_entered_balance` as new baseline
- Transactions before reconciliation date: unchanged
- For credit cards: post-reconciliation balance drives all future interest
  and payoff calculations

In practice: the existing `supabase.from('accounts').update({ balance })` call
still runs — the reconciliation event is an additional write, not a replacement.
The account row's `balance` column remains the current live value; reconciliation
records provide the audit trail.

### Step 5 — Visual treatment

In the transactions list and any balance history view:

| Property | Value |
|----------|-------|
| Label | "Balance Adjustment" |
| Badge | `reconciled` (distinct from `projected` and `debt payoff`) |
| Amount | `+/- delta` (formatted with sign) |
| Tooltip | "Manual balance correction on [date]" |
| Editable | No — cannot be edited or deleted |

### Constraints

- Historical transactions never modified
- Multiple reconciliations on same account: allowed
- `delta = 0` events: never created
- Demo mode: no reconciliation events written (read-only demo data)

### Files changed (TASK 5)

| File | Operation | Change |
|------|-----------|--------|
| DB migration (new) | Create | `account_reconciliations` table + RLS policy |
| `src/integrations/supabase/types.ts` | Add | `account_reconciliations` Row/Insert/Update types |
| `src/hooks/useSupabaseData.ts` | Add | `useAccountReconciliations()` hook (query + insert) |
| `src/pages/Accounts.tsx:87-116` | Modify | `handleSave` — after `update.mutate`, compute delta and insert reconciliation event if `editId` and `delta !== 0` |
| `src/pages/NetWorth.tsx:143-151` | Modify | `saveLiability` — same delta/insert pattern for liability balance edits |
| `src/pages/DebtPayoff.tsx:73-80` | Modify | debt `handleSave` — same pattern for debt balance edits |
| `src/pages/Transactions.tsx` | Modify | Render `ReconciliationEvent` records (with `reconciled` badge) in the transactions list |

---

## Execution Order

```
TASK 1 (core engine rewrite) → TASK 2 (Forecast consumes it) → TASK 3 (Transactions renders it) → TASK 4 (sort fix, independent)

TASK 5 (reconciliation) — independent of TASKS 1–4, can run in parallel with TASK 4
```

TASK 4 and TASK 5 are both independent of the engine rewrite and can execute in parallel.

---

## Files to Back Up

- `src/lib/credit-card-engine.ts`
- `src/pages/Forecast.tsx`
- `src/pages/Transactions.tsx`
- `src/lib/debt-transaction-generator.ts`
- `src/pages/Accounts.tsx`
- `src/pages/NetWorth.tsx`
- `src/pages/DebtPayoff.tsx`
- `src/hooks/useSupabaseData.ts`
- `src/integrations/supabase/types.ts`

---

## Risks

| Risk | Mitigation |
|------|------------|
| TASK 1: Event-based income for future months requires generating paycheck dates 36 months out | Use existing `getPaychecksInMonth` for each future month; sum net amounts |
| TASK 1: Interest timing change may shift payoff months vs current output | Expected — correct behaviour. Document in commit message. |
| TASK 2: Forecast month 0 income scoping change may reduce available cash estimate | Correct — current behaviour double-counts already-received income |
| TASK 3: Projected debt transactions must not appear in real transaction filters | Guard with `projected: true` flag; filter out in non-forecast views |
| TASK 4: Sorting within-month could reorder rule-generated transactions that currently rely on insertion order | Only affects balance accumulation totals, not UI rendering order |

---

## SESSION_ID
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
