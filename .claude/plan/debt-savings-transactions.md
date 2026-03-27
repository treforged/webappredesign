# Implementation Plan: Debt Rollover, Savings Goals Fix, Transactions Filter

**Date:** 2026-03-26
**Tasks:** 3 — debt payoff rollover simulation, savings goals chart year bug, transactions date filter + biweekly phase fix

---

## Pre-session: Post-commit auto-push hook

`.git/hooks/post-commit` contained `git push origin main`. Already renamed to `.git/hooks/post-commit.disabled` before this plan was written. No commits will auto-push this session.

---

## TASK 1 — Debt Payoff Rollover Simulation

### Diagnosis

`DebtPayoff.tsx` computes per-debt `calculatePayoffMonths(balance, apr, target_payment)` independently. When a debt is paid off, its freed payment is NOT stacked onto the next debt. The "Snowball Order" and "Avalanche Order" panels only sort debts — they show no simulation.

Root location: `src/pages/DebtPayoff.tsx:119-143` (individual debt cards) and `:148-171` (strategy panels).

### Fix: Add rollover simulation to `calculations.ts`

New function `simulateDebtPayoff` in `src/lib/calculations.ts`:

```ts
export interface DebtPayoffDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  min_payment: number;
  target_payment: number;
}

export interface DebtMonthEntry {
  month: number;    // 1-indexed month number from start
  payment: number;
  interest: number;
  remaining: number;
}

export interface DebtPayoffResult {
  debtId: string;
  name: string;
  schedule: DebtMonthEntry[];
  paidOffMonth: number;      // month number when balance reaches 0
  totalInterest: number;
}

export interface PayoffSimulation {
  schedule: DebtPayoffResult[];
  totalMonths: number;
  totalInterest: number;
}

export function simulateDebtPayoff(
  debts: DebtPayoffDebt[],
  strategy: 'snowball' | 'avalanche',
): PayoffSimulation
```

**Algorithm (month-by-month simulation):**
1. Sort debts: snowball = balance asc, avalanche = apr desc. This defines priority order.
2. Keep mutable balances array (copy of input balances).
3. Each month:
   a. Accrue interest: `balance * (apr/100/12)` for each debt with balance > 0.
   b. Compute minimums: for each debt with balance > 0, minimum to pay = `min(min_payment, balance + accrued_interest)`.
   c. Compute `totalBudget = sum of target_payments` from original inputs (constant each month).
   d. First pass: pay all minimums. Deduct from budget.
   e. `extra = max(0, totalBudget - sum_of_minimums_paid)`. Apply extra to the first debt in priority order that still has balance.
   f. If that debt is paid off with the extra, carry the remainder to the next debt in order.
   g. Record each debt's `{ month, payment, interest, remaining }`.
4. Repeat until all balances = 0 or month > 600 (safety cap).
5. Return full schedule + `paidOffMonth` per debt + totals.

**Verified test case (computed month-by-month):**

Inputs:
- Debt A: $3,000 balance, 8% APR ($0.667%/mo), $60 min payment
- Debt B: $5,000 balance, 22% APR ($1.833%/mo), $100 min payment
- totalMonthlyBudget = $300 (constant). Extra each month = $300 − $160 = **$140**.

**Snowball — priority order: A (#1, $3K) → B (#2, $5K)**

A gets: $60 min + $140 extra = **$200/mo** until paid off.
B gets: $100 min only until A paid off.

| Month | A Interest | A Payment | A Remaining | B Interest | B Payment | B Remaining |
|-------|-----------|-----------|-------------|-----------|-----------|-------------|
| 1     | $20.00    | $200.00   | $2,820.00   | $91.67    | $100.00   | $4,991.67   |
| 2     | $18.80    | $200.00   | $2,638.80   | $91.51    | $100.00   | $4,983.18   |
| ...   | ...       | ...       | ...         | ...       | ...       | ...         |
| 15    | $2.45     | $200.00   | $170.28     | $89.25    | $100.00   | $4,857.61   |
| 16    | $1.13     | **$171.41** (final) | **$0.00** | $89.06 | **$128.59** (+$28.59 rollover) | **$4,818.08** |

→ **A paid off: Month 16.** Remaining payment ($28.59) immediately rolls to B same month.
→ From Month 17: full $300 to B.

| Month | B Payment | B Remaining |
|-------|-----------|-------------|
| 17    | $300.00   | $4,606.41   |
| ...   | ...       | ...         |
| 35    | $300.00   | $58.49      |
| 36    | $59.56 (final) | **$0.00** |

**Snowball result: Debt-free Month 36. Total interest: $171.41 (A) + $2,388.15 (B) = $2,559.56**

---

**Avalanche — priority order: B (#1, 22% APR) → A (#2, 8% APR)**

B gets: $100 min + $140 extra = **$240/mo** until paid off.
A gets: $60 min only until B paid off.

| Month | B Interest | B Payment | B Remaining | A Interest | A Payment | A Remaining |
|-------|-----------|-----------|-------------|-----------|-----------|-------------|
| 1     | $91.67    | $240.00   | $4,851.67   | $20.00    | $60.00    | $2,960.00   |
| 2     | $88.95    | $240.00   | $4,700.62   | $19.73    | $60.00    | $2,919.73   |
| ...   | ...       | ...       | ...         | ...       | ...       | ...         |
| 26    | $6.39     | $240.00   | $115.09     | $12.77    | $60.00    | $1,868.53   |
| 27    | $2.11     | **$117.20** (final) | **$0.00** | $12.46 | **$182.80** (+$122.80 rollover) | **$1,698.19** |

→ **B paid off: Month 27.** Remaining budget ($122.80) immediately rolls to A same month.
→ From Month 28: full $300 to A.

| Month | A Payment | A Remaining |
|-------|-----------|-------------|
| 28    | $300.00   | $1,409.52   |
| ...   | ...       | ...         |
| 32    | $300.00   | $235.44     |
| 33    | $237.01 (final) | **$0.00** |

**Avalanche result: Debt-free Month 33. Total interest: $1,357.20 (B) + $479.80 (A) = $1,837.00**

---

**Side-by-side comparison:**

| | Snowball | Avalanche |
|---|---|---|
| Attack order | A ($3K, 8%) first | B ($5K, 22%) first |
| First debt paid off | A — Month 16 ✓ (smallest balance) | B — Month 27 ✓ (highest APR) |
| Rollover amount | $28.59 freed in M16 → B | $122.80 freed in M27 → A |
| Total payments | $300 × 35 + last = $10,559.56 | $300 × 32 + last = $9,837.00 |
| Total interest | **$2,559.56** | **$1,837.00** |
| Debt-free | **Month 36** | **Month 33** |
| Interest savings | — | **$722.56 less** |
| Psychological win | First payoff Month 16 | First payoff Month 27 |

No payment dollars disappear. Budget = $300 every month without exception. When a debt hits zero, leftover payment goes to the next debt the same month.

### Files changed (TASK 1)

| File | Operation | Line | Change |
|------|-----------|------|--------|
| `src/lib/calculations.ts` | Add | end | Add `DebtPayoffDebt`, `DebtMonthEntry`, `DebtPayoffResult`, `PayoffSimulation` types + `simulateDebtPayoff()` function |
| `src/pages/DebtPayoff.tsx` | Modify | :36-37, :148-171 | Replace static sort-only strategy panels with rollover simulation results |

### UI for strategy panels (TASK 1)

Replace the two static ordered-list panels with a tabbed/side-by-side comparison:

Each strategy card shows:
- "Debt free in X months (Est. [Month Year])"
- "Total interest paid: $Y"
- Per-debt table: Debt name | Payoff month | Interest paid
- Keep the numbered order list as a secondary "attack order" line under each debt name

---

## TASK 2 — Savings Goals Chart Year Bug

### Diagnosis

`SavingsGoals.tsx:24`:
```ts
const entry: Record<string, any> = {
  month: new Date(2026, new Date().getMonth() + i).toLocaleString(...)
```

`2026` is hardcoded. After 2026, chart months will show wrong years. Also, month index overflow (e.g., month 11 + 8 = 19) is handled correctly by `new Date` auto-rolling to next year — but the year `2026` means in Dec 2026 the chart shows "Jan 2026" for future months instead of "Jan 2027".

### Fix

Replace `new Date(2026, new Date().getMonth() + i)` with `new Date(new Date().getFullYear(), new Date().getMonth() + i)`.

Single line change, one file.

### Files changed (TASK 2)

| File | Operation | Line | Change |
|------|-----------|------|--------|
| `src/pages/SavingsGoals.tsx` | Modify | :24 | `2026` → `new Date().getFullYear()` |

---

## TASK 3 — Transactions Date Filter + Biweekly Phase Fix

### Sub-task 3A: Transactions default-to-current-month filter

**Diagnosis:** `Transactions.tsx` shows ALL transactions across all time. `filtered` only applies type/category/source filters. No date filter exists.

**Fix:** Add `filterMonth` state (string `'YYYY-MM'` or `'all'`), defaulting to current month. Add month picker to filter bar. Add "All time" option.

```ts
const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
const [filterMonth, setFilterMonth] = useState<string>(currentMonth);
```

Filter logic addition in `filtered` useMemo:
```ts
if (filterMonth !== 'all' && !t.date.startsWith(filterMonth)) return false;
```

Month picker UI: a `<select>` or `<input type="month">` placed first in the filter bar, with an "All time" option. Build the options list from the distinct months present in `allTransactions` (sorted desc), capped at 24 months.

**Secondary view — Forecast range:** Add a "Forecast Range" option to `filterMonth` that, when selected, reads the persisted `tre:forecast:filterYear` value and shows transactions for those months. Use `usePersistedState('tre:forecast:filterYear', 'all')` to read it (same key as Forecast).

When `filterMonth === 'forecast'`:
- `filterYear === 'all'` → show all 36 forward months from today (i.e., no past filter, show from today forward)
- `filterYear === '1'` → show months 0–11 from today
- `filterYear === '2'` → show months 12–23 from today
- `filterYear === '3'` → show months 24–35 from today

### Sub-task 3B: Biweekly paycheck phase anchor

**Diagnosis:** `getPaychecksInMonth` for biweekly finds the first occurrence of `paycheckDay` (day of week) in the month and steps +14. Without a phase anchor, it always assumes the 1st and 3rd (and sometimes 5th) occurrence of that weekday in the month are paycheck days. This is wrong for most biweekly schedules.

Example: If actual paychecks are Jan 9, Jan 23, Feb 6, Feb 20... the algorithm for February (first Friday = Feb 6) would return Feb 6 and Feb 20. Happens to be correct for this example, but for April 2026 (first Friday = April 3): returns April 3, April 17. If actual schedule has April 10, April 24 — both dates AND the count would be wrong.

**Fix:** Add `paycheck_start_date` (date string `'YYYY-MM-DD'`) to profiles table. Use it as a phase anchor.

Phase anchor algorithm:
```ts
// Given anchor date A (any known paycheck date, from profile.paycheck_start_date),
// all biweekly paycheck dates D satisfy: (D - A) % 14 === 0
// For a given month, compute all such D within [monthStart, monthEnd].
```

Implementation in `getPaychecksInMonth`:
```ts
if (config.frequency === 'biweekly' && config.paycheckStartDate) {
  const anchor = new Date(config.paycheckStartDate);
  const anchorMs = anchor.getTime();
  const DAY_MS = 86400000;
  const d = new Date(monthStart);
  // Advance d to first biweekly date in month
  const diffDays = Math.floor((d.getTime() - anchorMs) / DAY_MS);
  const remainder = ((diffDays % 14) + 14) % 14;
  if (remainder !== 0) d.setDate(d.getDate() + (14 - remainder));
  while (d <= monthEnd) {
    paychecks.push({ date: new Date(d), gross, net });
    d.setDate(d.getDate() + 14);
  }
  return paychecks;
}
// Fall through to existing day-of-week logic when no anchor set
```

**DB migration required:** Add `paycheck_start_date date` column to profiles table.

SQL (save to `backups/` and apply manually in Supabase SQL Editor):
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paycheck_start_date date;
```

**Settings UI update:** Add a date input for "Pay Cycle Anchor Date (any past paycheck date)" to the profile settings form, shown only when `paycheck_frequency === 'biweekly'`.

**`PayScheduleConfig` type update:**
```ts
export type PayScheduleConfig = {
  weeklyGross: number;
  taxRate: number;
  paycheckDay: number;
  frequency: PayFrequency;
  paycheckStartDate?: string; // 'YYYY-MM-DD', for biweekly phase anchor
};
```

**`buildPayConfig` update:** add `paycheckStartDate: profile?.paycheck_start_date || undefined`

### Files changed (TASK 3)

| File | Operation | Change |
|------|-----------|--------|
| `src/pages/Transactions.tsx` | Modify | Add `filterMonth` state + month picker UI + forecast-range option |
| `src/lib/pay-schedule.ts` | Modify | Add `paycheckStartDate?` to `PayScheduleConfig`, update `getPaychecksInMonth` to use anchor when available, update `buildPayConfig` |
| `src/pages/Settings.tsx` | Modify | Add `paycheck_start_date` date input when frequency is biweekly |
| `src/integrations/supabase/types.ts` | Modify | Add `paycheck_start_date: string \| null` to profiles Row/Insert/Update |

Migration SQL (manual apply):
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paycheck_start_date date;
```

---

## Execution Order

```
Pre:  Disable post-commit hook ✓ (already done)

TASK 2 (smallest change, lowest risk — do first):
1. Backup SavingsGoals.tsx
2. Fix line 24: 2026 → new Date().getFullYear()
3. Commit

TASK 1 (pure additive — new function + UI update):
1. Backup calculations.ts and DebtPayoff.tsx
2. Add types + simulateDebtPayoff() to calculations.ts
3. Update DebtPayoff.tsx strategy panels to use simulation
4. Commit

TASK 3A (Transactions month filter):
1. Backup Transactions.tsx
2. Add filterMonth state + UI + filter logic
3. Commit

TASK 3B (biweekly anchor — touches 4 files + needs migration SQL):
1. Backup pay-schedule.ts, Settings.tsx, types.ts
2. Update PayScheduleConfig + getPaychecksInMonth + buildPayConfig
3. Update types.ts
4. Update Settings.tsx UI
5. Generate migration SQL → save to backups/
6. Commit (note: DB migration must be applied manually)
```

---

## Risks

| Risk | Mitigation |
|------|------------|
| TASK 1: infinite loop if budget < sum of minimums | Cap simulation at 600 months; handle `min_payment > 0` invariant |
| TASK 1: floating point rounding accumulates over months | Use `Math.max(0, balance)` guard; round to 2 decimals per month |
| TASK 3B: `paycheck_start_date` not set by existing users | Fall back to current day-of-week algorithm when `paycheckStartDate` is undefined |
| TASK 3B: DB migration needs manual apply | Provide exact SQL in backups/; note in commit message |

---

## SESSION_ID
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
