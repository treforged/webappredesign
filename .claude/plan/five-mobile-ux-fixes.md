# Plan: Five Mobile UX Fixes

## Summary

Five targeted bug fixes across BudgetControl, FormModal, Legal, and shared components.

---

## TASK 1 — Gross income field resets while typing

### Root Cause

`BudgetControl.tsx:511`:
```tsx
<input type="number" value={weeklyGross}
  onChange={e => setWeeklyGrossAuto(parseFloat(e.target.value) || 0)} />
```

`parseFloat('') = NaN`, `NaN || 0 = 0` → `setWeeklyGross(0)` fires immediately.
After 800ms debounce, `doAutoSave(0, ...)` saves 0 to DB.
Profile `useEffect` re-reads and applies `Number(0) || 1875 = 1875` → resets to 1875.

### Fix

Add a separate string state `weeklyGrossInput: string` for the input display.
Keep `weeklyGross: number` as the committed value used in calculations.

- `onChange`: update only `weeklyGrossInput` string, do NOT call `doAutoSave`
- `onBlur`: parse string → if valid > 0, commit + auto-save; if empty/zero, revert display to current `weeklyGross`
- `value={weeklyGrossInput}` on the input element

### Key File

| File | Line | Change |
|------|------|--------|
| `src/pages/BudgetControl.tsx` | 72 | Add `const [weeklyGrossInput, setWeeklyGrossInput] = useState('1875')` |
| `src/pages/BudgetControl.tsx` | 91 | Also set `setWeeklyGrossInput(String(wg))` in profile `useEffect` |
| `src/pages/BudgetControl.tsx` | 148 | Change `setWeeklyGrossAuto` — remove from onChange, call only from onBlur |
| `src/pages/BudgetControl.tsx` | 511 | Change input: `value={weeklyGrossInput}`, `onChange={e => setWeeklyGrossInput(e.target.value)}`, add `onBlur` handler |

### onBlur Handler

```tsx
const handleWeeklyGrossBlur = () => {
  const parsed = parseFloat(weeklyGrossInput);
  if (!isNaN(parsed) && parsed > 0) {
    setWeeklyGross(parsed);
    doAutoSave(parsed, taxRate, paycheckDay, payFrequency);
  } else {
    setWeeklyGrossInput(String(weeklyGross)); // revert display
  }
};
```

---

## TASK 2 — Negative number minus sign wraps on mobile

### Root Cause

`Intl.NumberFormat` produces e.g. `-$1,234`. On narrow screens, the minus can
break onto its own line unless the container has `whitespace-nowrap`.

### Fix Strategy

Add `whitespace-nowrap` to the value display in `MetricCard` (covers all KPI cards
everywhere) and to inline currency `<span>` / `<p>` elements across pages that
can show negative values.

### Key Files

| File | Change |
|------|--------|
| `src/components/shared/MetricCard.tsx:43` | Add `whitespace-nowrap` to the value `<p>` |
| `src/pages/NetWorth.tsx` | Add `whitespace-nowrap` to net worth total display |
| `src/pages/DebtPayoff.tsx` | Add `whitespace-nowrap` to balance/payment amount displays |
| `src/pages/Accounts.tsx` | MetricCard covers summary; check any inline balance text |
| `src/pages/Dashboard.tsx` | MetricCard covers KPIs; check any inline negative value text |

Primary fix is `MetricCard.tsx` — all other MetricCard usages are automatically fixed.
Scan pages for any non-MetricCard inline currency text that could go negative.

---

## TASK 3 — iOS Safari modal scroll conflict

### Root Cause

`max-h-[90vh]` uses `vh` (static viewport height = full screen including browser chrome).
When iOS Safari shows both URL bar and bottom nav simultaneously, `90vh` may still
overflow. `dvh` (dynamic viewport height) reflects the *actual* visible area.

Also missing: `-webkit-overflow-scrolling: touch` on the scroll container.

### Fix

File: `src/components/shared/FormModal.tsx`

1. **Backdrop**: add `touch-action: none` (inline style `touchAction: 'none'`) to prevent background touch-scroll
2. **Modal card**: change `max-h-[90vh]` → `max-h-[90dvh]`
3. **Scrollable content div**: add `style={{ WebkitOverflowScrolling: 'touch' }}`

### Diff

```tsx
// Backdrop
<div
  className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center p-4"
  style={{ touchAction: 'none' }}
  onClick={onClose}
>
  {/* Modal card */}
  <div
    className="card-forged w-full max-w-md flex flex-col max-h-[90dvh]"
    onClick={e => e.stopPropagation()}
  >
    {/* Scrollable content */}
    <div
      className="flex-1 overflow-y-auto px-6 pb-6 space-y-3"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
```

---

## TASK 4 — Legal back button should navigate(-1)

### Root Cause

`Legal.tsx` uses `<Link to="/">` which always navigates to `/` regardless of where
the user came from.

### Fix

Replace `<Link to="/">` with a `<button>` using `useNavigate`:

```tsx
import { useNavigate, useLocation } from 'react-router-dom';

const navigate = useNavigate();

// In JSX (top bar):
<button
  onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
>
  <ArrowLeft size={12} /> Back
</button>
```

Remove the `Link` import from `react-router-dom` if only used for the back button
(check: `Link` is also used for sidebar nav links and Terms→Privacy crosslink — keep import).

File: `src/pages/Legal.tsx:309-314`

---

## TASK 5 — Privacy/Terms links open in new tab

### Scope

Links that should get `target="_blank" rel="noopener noreferrer"`:
- `src/pages/Auth.tsx:79,81` — footer Privacy/Terms below login form
- `src/pages/Landing.tsx:151,152` — landing footer Privacy/Terms
- `src/components/layout/DashboardLayout.tsx:16,17` — app footer Privacy/Terms

Links that should NOT get new tab (internal Legal page navigation):
- `src/pages/Legal.tsx` sidebar nav, tab switcher, Terms→Privacy crosslink
  (user is already on Legal page, navigating between Privacy/Terms tabs)

### Fix

React Router `<Link>` supports `target` prop. Add to each affected link:
```tsx
<Link to="/privacy" target="_blank" rel="noopener noreferrer" ...>
<Link to="/terms" target="_blank" rel="noopener noreferrer" ...>
```

---

## Execution Order

Tasks are independent. Execute in order:
1. TASK 4 (1 file, trivial)
2. TASK 5 (3 files, trivial)
3. TASK 3 (1 file, already partially done — small delta from last fix)
4. TASK 1 (1 file, requires careful state surgery)
5. TASK 2 (MetricCard.tsx + scan pages)

## Files to Back Up

- `src/pages/BudgetControl.tsx`
- `src/components/shared/FormModal.tsx`
- `src/pages/Legal.tsx`
- `src/pages/Auth.tsx`
- `src/pages/Landing.tsx`
- `src/components/layout/DashboardLayout.tsx`
- `src/components/shared/MetricCard.tsx`
