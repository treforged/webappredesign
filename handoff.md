# handoff.md — FIRST UP NEXT TIME

⛔ **THE ONE THING: ENTER TRE'S THREE CHASE PAY OVER TIME PLANS.** It is the largest number left
on the board — **$2,101.39 of 0% principal is being charged 27.49%, about $577/yr of interest he
will not pay** — and every line of code it needs shipped 2026-09-06 (`72f82c28`). It is blocked
ONLY on his three confirmation emails. When they arrive: Accounts → Prime Visa → Rate Tiers, one
tier per plan — balance, **0** APR, the plan end date, the monthly instalment, the monthly fee,
and tick **Fixed term**. Do NOT invent the figures from the handoff's summary.

**Second, if that is still waiting:** run `docs/signed-in-verification-pass.md` check 1. It is the
only unverified thing that can change a stored amount, and it needs a pending bank row that pairs
with a hand-typed entry — so it becomes runnable the moment one appears.

---

## ⚠️ THE ASKS LEDGER IS BADLY STALE, AND IT IS DANGEROUS IN THIS DIRECTION

Measured 2026-09-06. **SIX of the eight open getforgenta asks I opened today were already
SHIPPED**, several with a test file and a source comment quoting Tre's own words. Each was found
by one `grep -rli "<his words>" src/` before writing a line of code:

| Ask, as the ledger still had it | Where it actually lives |
| --- | --- |
| Repeat intervals for planned items | `20260905_recurring_rules_custom_interval.sql` + 2 test files |
| GENERAL OPERATIONS balance in forecast pop-ups | `forecast-engine.ts:327` + `forecast-engine.nonFundingLiquid.test.ts` |
| Hide "cash floor set" when AUTOMATIC | `Dashboard.tsx:1024`, `MonthlyBreakdownTable.tsx` |
| Transfers on the HOMEPAGE | `Dashboard.tsx:1336`, commit `0f92da5c` |
| SECURITY tab symmetry | `Settings.securityControls.test.tsx` |
| The rent grace period | `sync-cutoff.ts:123` + `pay-schedule.debitGracePeriod.test.ts` |

**This is the failure mode the repo already names, at scale.** A session that trusts an open `[ ]`
rebuilds a working feature on top of itself, and the rebuild passes its own tests. **The check is
one command and it costs nothing: grep for Tre's OWN WORDS**, which this codebase puts in the
comment above the code that answers them. That convention is what made all six findable in a
single pass, and it is worth keeping for exactly this reason.

✅ **ALL OF THEM ARE NOW CLOSED — 2026-09-06.** Eight of eight, plus the auto-extra ask below.
Seven needed no new feature code at all; the three real holes were all on the same surface, and all
the same shape: **money the engine already computed, that the LEDGER alone never showed.** Goal
contributions, then the ranked auto-extra. If another "should show in Transactions" ask arrives,
look there first — `Transactions.tsx` derives its stream from `recurring_rules` and nothing else
unless a caller explicitly adds to it.

---

## ✅ SHIPPED 2026-09-06 — a savings goal moved money monthly and the ledger never said so. `eef7dadd`.

`origin/main` 0/0, verified by CONTENTS. Gates: `npx tsc --noEmit` clean, `npm run lint` 0 errors,
`npm run test:tz` **3911 passed / 1 skipped** across all three zones.

**The ask split in half, and only one half was real.** Transfer RULES already showed —
`pay-schedule.ts:1436` marks a `transfer`/`investment` rule `isTransfer` and `Transactions.tsx:1241`
renders the destination. **A GOAL contribution is not a `recurring_rules` row at all**, so nothing
generated it there: `savings_goals.monthly_contribution` was synthesised inline inside
`useBudgetMonthTotals` and lived only there. Budget Control listed it, the forecast moved that cash
out of checking every month and priced the plan around it, and **Transactions had ZERO references to
savings goals.** A person reading their own ledger could not see $200/mo leaving.

Now shared through `src/lib/goal-transfer-rules.ts`, called by both surfaces. Three things not to
re-derive:
- **ONE precedence filter, not two.** A goal already funded by a real rule is skipped because it is
  on screen as that rule; a second copy of that filter is a double-count waiting to happen. A link
  to a DELETED rule still synthesises — the money still leaves.
- **`due_day` stays null in the base synthesis** (Budget Control shows no day on purpose), and
  `buildDatedGoalTransferRules` derives the ledger date from the goal's own
  `contribution_start_date`. It lives in the lib so the tests exercise what ships, not a copy.
- ⚠️ **A goal occurrence carries a synthetic `goal:<id>` ruleId**, so `rules.find` misses and the
  "edit the recurring rule" button would have silently done nothing. Guarded.

⚠️ **FOUR EXISTING TEST FILES BROKE — 25 failures — because they mock `useSupabaseData` and
`useSavingsGoals` was absent from every mock.** Caught by the gate, not by reading. Any new data
hook added to `Transactions.tsx` will do this again; patch the four `Transactions.*.test.tsx` mocks
in the same commit.

⚠️ **NOT VERIFIED IN A BROWSER.** Tre is signed out at the console, so nothing could render today.
jsdom is legitimate here (text and presence, no geometry) but a rendered frame is still owed.

## ⛔ FIVE OF THE ITEMS I TOOK THIS SESSION WERE ALREADY BUILT. GREP BEFORE YOU BUILD.

Counted 2026-09-07, and it is now the single highest-yield habit at this desk. Each was found by
ONE grep for the caller before writing a line, and each would otherwise have been rebuilt on top of
itself — with the rebuild passing its own tests, which is what makes this expensive rather than merely
wasteful.

| The record said | What was actually there |
| --- | --- |
| Transfer rules must show in Transactions | Already shipped — `pay-schedule.ts:1436`. Only the GOAL half was real |
| /debt student-loans chart breaks on mobile | Fixed in `1d4fd3bd` |
| Four charts lack an `ErrorBoundary` | All five are wrapped — `DebtPayoff.tsx:480,499,539,651,724` |
| Plaid cost tracking, both halves | Rule live in his ledger + `docs/plaid-cost-2026-09-06.md` |
| `otherDebtPayment` is a scalar that never stops | Month-indexed and gated — `non-cc-liabilities.ts:398`, `isOtherDebtPaymentOwed:348` |

And one in the OTHER direction, which is the same failure wearing a different coat: **"`logIn()` is
never called" was recorded as a money-path defect and is CORRECT behaviour** — building it would have
changed a working money path on a false premise. **Test the premise, not just the presence.**

**The habit, in one line:** before the first edit, `grep -rn "<symbol>" src/ | grep -v export`, and
search for the name the CODE has rather than the name the ask uses (`monthly_fee`, not `payOverTime`).

## ✅ SHIPPED 2026-09-07 — notifications: the deep link, and one event becoming several.

Two commits, `test:tz` 3938 then **3940 passed**, three zones, `origin/main` 0/0 verified by contents.

**THE DEEP LINK WAS NEVER WIRED, NOT BROKEN — and it is the aim-at-the-wrong-object shape again.**
`PushTapHandler` listened only to `pushNotificationActionPerformed` on the REMOTE plugin, which has
**never fired once** (`push_sends` zero rows, zero iOS tokens), while every notification this app
shows is LOCAL and raises `localNotificationActionPerformed` on a different plugin nobody watched.
Both halves were missing, which is why neither looked wrong alone: the schedule also carried no
`extra`, so a correct listener would have had no key to route on. Both fixed; routing lifted into
one `handleTap` so the two channels cannot disagree.
⚠️ **The component had NO test at all** — the routing lib under it was tested and passed throughout,
because the lib was never the broken part. That is the gap to look for elsewhere.

**SEVEN NOTIFICATIONS FOR ONE EVENT — every gate was reading a history written too late.**
`MIN_HOURS_BETWEEN` 16h, `MAX_PER_WEEK` 5 and the per-kind caps all compute FROM stored history, so
**all of them are defeated at once** by the check-then-act race: `runNotificationCheck` read history,
then awaited `ensurePermission()` — an OS dialog open for as long as the person takes — and only
recorded the send at the end. Checks are now serialised through one promise chain. **Not one gate
wrong; every gate asked too early.**

⚠️ **NEITHER IS DEVICE-VERIFIED, and both need it.** A mocked `addListener` proves wiring, not that
Capacitor delivers the event — the testing rules name that exact mock shape as a way a green lies.
The cold-start tap path and the real trigger for the seven are both inferred, not observed.

## ✅ SHIPPED 2026-09-06 — a tap selected nothing on FIVE charts, and the fix existed in a sixth.

`origin/main` 0/0, verified by CONTENTS across 9 files. `test:tz` **3932 passed / 1 skipped**.

`selectPointOnTouch` was written for `LiabilityTrajectoryChart` and lived there alone. The credit
card engine, net-worth trend, forecast chart, loan card and savings-goal projection each render a
recharts Tooltip and **none could be tapped.** Now `src/lib/chart-touch.ts`, applied to all six.

⚠️ **A SECOND COPY WOULD HAVE BEEN DANGEROUS, NOT UNTIDY.** Safari has the `TouchEvent` interface
but no constructor, so `new TouchEvent(...)` throws `Illegal constructor`, the ErrorBoundary catches
it, and **the chart vanishes** — on iOS a tap did not fail to select, it DELETED THE GRAPH. Five
copies would have been five chances to reintroduce that.

⚠️ **THE TEST THAT MATTERS IS THE SOURCE SWEEP, and it generalises past charts.** The helper was
correct for weeks while five surfaces lacked it — **a unit test on the helper stays green through
exactly that failure.** So the suite walks `src/components` and `src/pages`, selects every file
rendering a chart WITH a Tooltip, and asserts each passes `onTouchStart`; it also asserts it found
at least 5 files, so an empty sweep cannot pass silently. **Reach for this shape whenever a fix has
to be applied at N call sites** — the unit test proves the helper, the sweep proves the wiring.
`InstructionsModal`, `MetricCard` and `Onboarding` are deliberately out of scope: decorative charts,
no Tooltip, nothing to select — which is why the sweep keys on the Tooltip, not the chart.

⚠️ **NOT VERIFIED ON A PHONE.** jsdom cannot exercise recharts point selection at all, and the
Safari path is simulated by stubbing a throwing constructor because jsdom implements the real one.

## ✅ SHIPPED 2026-09-06 — the monthly surplus swept into goals and loans was invisible in the ledger.

`origin/main` 0/0, verified by CONTENTS. `npm run test:tz` **3922 passed / 1 skipped**, three zones.

The engine's ranked surplus moves real cash out of checking every month. The Forecast month drawer
itemised it, the CSV export listed it, and **`Transactions.tsx` had ZERO references to auto-extra
anything.** Now `src/lib/auto-extra-ledger-rows.ts`, reading the engine's OWN named list
(`ForecastMonthRow.autoExtraItems` — the `{id,name,kind,amount}` twin of `autoExtraByTarget` that
the drawer and export already read), so there is no second allocation and no second total.

⚠️ **THE DOUBLE-COUNT THAT WOULD HAVE BEEN EASY TO SHIP.** A credit card's ranked surplus is NOT in
that list — `AutoExtraReserveKind` is `car_fund | goal | loan | liability` with **no `card`** — and
card surplus rides inside `perCardAdjusted`, which this page ALREADY renders as a debt payment row.
Emitting it here too would have shown the same money leaving twice, silently, on a money surface.
**Anyone adding a `card` kind to the engine must exclude it here explicitly.**

Two smaller decisions worth not re-arguing: the date is the LAST DAY of its month (a ranked extra is
what is left after that month's obligations, not a payment on a chosen day), and `isTransfer` is
true for a goal or car fund and FALSE for a loan — one receives money, the other retires debt.

## ✅ CLOSED, ALREADY FIXED — the /debt STUDENT LOANS chart "breaking" on mobile. `1d4fd3bd`.

Found by reading rather than rebuilding. **"Breaks" was exact and worse than it sounded:** Safari
implements the `TouchEvent` INTERFACE but not its CONSTRUCTOR, so `new TouchEvent(...)` threw
`TypeError: Illegal constructor` out of a React touch handler, the chart's `ErrorBoundary` caught
it, and **the graph VANISHED.** A tap did not fail to select a point — it deleted the chart. The
replay can no longer throw and falls back to a synthetic `mousemove`, which reaches the same
recharts machinery. **jsdom implements the constructor, so no test in this repo could ever have
seen it.**

⚠️ **AND A STALE LINE CORRECTED WHILE HERE:** this file said only the Credit Card tab is inside an
`ErrorBoundary` and a throw in the other four `LiabilityTrajectoryChart` usages would blank `/debt`.
**All five are wrapped** — `DebtPayoff.tsx:480, 499, 539, 651, 724`. Do not rebuild that.

---

## ✅ SHIPPED 2026-09-06 - a card's FIRST payment due date. `26781c63`, on origin/main.

Tre's ask: "maybe make it a feature for cards to set there first due date." `payment_due_day` is
a day of month and describes a steady state; month one is not one. Now `accounts.first_payment_due_date`
(date, nullable, live - applied and read back from `information_schema`, and its CHECK was proven
to FIRE on a bad row before being believed), the pure `src/lib/first-payment-due.ts`, an Accounts
form field, and ONE engine site: the due-month decision at `credit-card-engine.ts:~1262`.
16 tests, all mutation-checked. `test:tz` green in three zones, 3887 passed.

✅ **AND THE SECOND HALF IS SHIPPED TOO - `9c40be0` region, same window.** A card now owes NO
minimum in the months before its first payment is due. `minSuppressed(card, m)` is the single
predicate, borrowed from the existing `m0MinSettled` and applied at exactly the FIVE sites that
one is applied at. **The handoff said fifteen sites; reading them showed twelve are about whether
the card EXISTS and five about whether it OWES** - a useful correction to make out loud, because
the fifteen was the reason the slice looked too big to do.

⚠️ **A TEST FOUND THE FIFTH SITE AND IT MATTERS BEYOND THIS FEATURE.** Suppressing the
RESERVATION was not enough: the minimum-enforcement guard at the end of Step 5 put the payment
straight back, so `perCardMinPayments` read $0 while `monthlyPayments` read $60. **Reserving
nothing and paying it anyway is the worst of both** - cash leaves that the floor was never told
about. Any future change that zeroes a minimum must check that guard too.

✅ **ALSO CLOSED, ALREADY BUILT:** the user-chosen repeat intervals ask (asks.md line 3) is DONE
end to end - `20260905_recurring_rules_custom_interval.sql`, `scheduling.ts`, `pay-schedule.ts`,
`BudgetControl.tsx`, plus `scheduling.customInterval.test.ts` and `BudgetControl.customInterval.test.tsx`.
Found by grepping for the caller before building, which is the rule that exists for exactly this.

---

## 🔐 RESTRICT the Firebase Android API key — DO NOT ROTATE IT

Found by Ruby's gitleaks scan of 4,731 commits, which was otherwise **CLEAR** — no live exposed
credential anywhere in getforgenta's GitHub history. Her evidence:
`tre-forged-marketing/docs/evidence/2026-09-06_secret-scan-getforgenta.md` (commit `01bf307`).

`android/app/google-services.json:18` carries the Firebase Android API key (`AIzaSy…`).
**It ships inside every published APK by design, so it is NOT a leak.** Rotating it as though it
were would break released builds and buy nothing. What it needs is an **Android app restriction in
the Google Cloud console: package name plus release SHA-1.** Unrestricted is the default, and that
default is the actual risk.

**This desk cannot do it** — there is no authenticated Google Cloud tool here. It is in the Asks
Ledger for Tre.

**Two things that are NOT findings — do not chase them:** every `price_1T…` literal in
`create-checkout` / `grant-promo-premium` is a Stripe PRICE id, public by design; and the
`-----BEGIN PRIVATE KEY` in `src/lib/__tests__/push-transport.routing.test.ts:55` is a `btoa()`
test fixture.

⚠️ **The warning that generalises, and it is this repo's own testing rule wearing different
clothes:** gitleaks with its DEFAULT rules **MISSED** a credential Ruby already knew was in that
history. It only surfaced under a rule keying on argument position, because
`page.fill('input[type="password"]', "<value>")` puts the keyword in the SELECTOR and the value
after a comma. **If you ever run a scanner, first point it at a secret you know is there and
confirm it finds it.** A clean report from an unproven scanner is the same false green as a test
that cannot fail.

## ⏰ SUNDAY 2026-09-13 — REMIND TRE, in his own words

He asked for this reminder himself, and it is the ONLY thing standing between the free
first bank link and being verified. Word it to him exactly like this:

> **Link a bank on an account that is NOT premium, then try a second one and confirm it is
> blocked.**

That is the unmet acceptance for `0eaedbef`. It cannot be done from this desk: Linked Banks
is `!isDemo` so `/demo` cannot show it, and a real link needs bank credentials no session may
handle. Sam has the same date in `Desktop\TASKS.md` and the Asks Ledger, so the nightly asks
push carries it if no session is open.

## 🔎 SEPARATE FINDING — `akoya-exchange-token` had NO entitlement gate at all

Not part of the paywall change, and deliberately written here rather than buried inside it.
Until 2026-09-06 that function checked only the `MAX_LINKED` ceiling: no premium check, no
subscription check, nothing. `akoya-auth-url` had the premium gate and the exchange did not,
so the ceiling was the only thing between a caller and an Akoya connection. It is gated now
via `decideBankLink`, but **the gap existed in production and is worth knowing about when
auditing the other providers** — the question to ask of any new provider is not "does the
start of the flow check entitlement" but "does the step that CREATES the connection check it".

## 💭 COSTED OPTION, NOT A PLAN — moving the engines server-side

Tre asked whether the debt calculation code can be hidden. Recorded as an option with its cost
named, so nobody reads it as scheduled work:
- **Making the repo private would hide nothing.** `forecast-engine.ts` (2,920 lines),
  `credit-card-engine.ts` (2,840) and `useCardProjection.ts` (2,521) are CLIENT-side and ship
  inside the browser bundle to every visitor of getforgenta.com.
- **Only moving the maths to the server actually hides it**, and that is a large build: it is
  the same engine `docs/push-runbook.md` already names as the blocker for server-computable
  notifications, so the two would share the work.
- **The licence is the cheap half and it is DONE** — the repo was public with `licenseInfo`
  null and no LICENSE file, which is the weakest position available. Now explicit and
  proprietary.

## 2026-09-06 — the paywall moved, and the app finally has a search box

Two commits, `ff49219d` and `0eaedbef`. `origin/main` 0/0, both verified by CONTENTS.
Gates each time: `npx tsc --noEmit` clean, `npm run lint` 0 errors, `npm run test:tz`
**3871 passed / 1 skipped** across all three zones.

**THE FIRST LINKED BANK IS NOW FREE, AND IT IS DEPLOYED.** `0eaedbef`. Four edge functions
deployed and verified live by contents — `plaid-exchange-token` now contains `decideBankLink`
and no longer contains `Premium subscription required`. Migration applied and locked down:
`free_bank_link_grants`, RLS on, **0 grants to anon/authenticated, 0 policies**.
- **Why it could not be a column on `profiles`:** `profiles_update_own` lets any signed-in user
  UPDATE their own row, so a marker there is clearable by the account it constrains — with the
  anon key that ships in the bundle — and every clear mints another Plaid item Tre pays for.
- **Why it is not a `count(financial_connections)`:** unlinking HARD-deletes that row, so a
  count-based gate is a retry loop. The grant is durable and unlinking does not return it.
- **Consumed at EXCHANGE, after the insert.** Plaid bills on the item; an abandoned Link flow
  costs nothing and must not spend somebody's one free bank.
- ⚠️ **ACCEPTANCE UNMET, DO NOT RECORD IT AS DONE:** a rendered frame of a NON-PREMIUM account
  completing a real link, and proof the second is gated. Linked Banks is `!isDemo`, so `/demo`
  cannot show it, and a real link needs bank credentials this desk must not handle.

**NEXT UP, and it is queued to ship WITH the above (Tre, via Sam):** track Plaid's cost as a
business expense. Two halves, not to be merged — (1) a real recurring row in his own ledger
beside `Claude` and `Google Workspace`, **amount left blank rather than invented** if the Plaid
dashboard is unreachable from this desk; (2) what one free link actually costs and what 100
signups would cost, since the free-first-link decision makes spend grow with signups rather than
with paying customers. Apple revenue is confirmed **zero**, so Plaid is the largest real running
cost against no income.

**The app had no text search anywhere.** `ff49219d`. Measured: `type="search"` appeared **0**
times in `src/`. The ledger has one now — verified in a real 390px iframe, 31 rows → 5 on "gas",
18 on "northvale", AND semantics, clear restores 31; 12 tests, three mutation-verified.
⚠️ **It covers the LEDGER half only** — `BankActivity` takes no props and owns its own queries,
so the bank rows are NOT searched. Found by the acceptance test itself: "Ridgeline", a merchant
visible on screen, matched 0.

**`docs/screens-jakobs-law.md`** extends the Jakob's Law method to the screens, ranked by
encounters per session, and says plainly that **no screen change fixes the measured 9-of-31
day-one retention** — every notification the app ships is LOCAL, so nothing reaches a dormant
person. The server-side sender is the item above all of these.

**Also open, from Sam, unstarted:** mobile logs the user out (a PIN is the direction Tre wants;
the dev sign-in died with exactly ONE key removed of fifty, which is token revocation and may be
the same root cause); the lesson deep link still does not open and delivery has stopped
altogether; seven notifications for one event; the toggle knob sits outside its container; which
onboarding step to cut (unblocked, but no signups since, so the columns are empty for want of
traffic); OG seats never reused and `seats_left` computed from the wrong thing; 44px tap targets
on BankActivity and BudgetControl, folded into the screen-level plan.

---

# Handoff — Forgenta

> **This file is a SNAPSHOT, not a log.** It was 1,075,335 bytes on 2026-09-01,
> read into context at every SessionStart in this folder, and it had swallowed
> every previous session end to end. The history is in `handoff-archive.md`;
> search that when you need something this file no longer carries. Keep this one
> under ~15 KB: rewrite the state, do not append to it. Everything below the
> AUTO-SNAPSHOT marker is machine-written and is replaced on every run — write
> above it.
>
> ✅ **PRUNED 2026-09-05: 101 KB -> 54 KB.** Sixteen closed sections moved to
> `handoff-archive.md` with a one-line pointer each, carrying the load-bearing fact
> (a reversal state, a lesson, a do-not-rebuild) so nothing has to be re-derived to
> act. Still above the ~15 KB rule; the remaining weight is the Resume queue and the
> genuinely open sections, which is what this file is for. When you close something,
> move it — do not append.

---

## ✅ SHIPPED 2026-09-05 — the i18n scaffold plus Spanish on Landing. `c9643e6c`, on origin/main.

Was FIRST UP. Scoped exactly as asked: `i18next` + `react-i18next`, catalogues at
`src/locales/<lang>/<namespace>.json`, `src/lib/i18n.ts`, a `LanguageSwitcher` on BOTH the
signed-out Landing page and Settings, and ONE complete namespace (`landing`, 47 keys) in
Spanish. Detail is in the commit body; three things worth not re-deriving:

- **A surface is all-or-nothing.** A half-translated screen is worse than an English one, so
  the next surface is a new namespace file per locale — nothing in `i18n.ts` changes.
- **The language is NOT the money knob.** `formatCurrency`/`setMoneyDisplay` still own how an
  amount is written. Somebody reading in Spanish may hold a USD account.
- **The currency picker is RE-ENABLED** (`Settings.tsx`), on the condition its own 2026-09-03
  disable note set. `f21d4d00` had already connected `MoneyDisplaySync`; the control was still
  off two commits later. Found by grepping for the CALLER, which is now a repo gate.

⚠️ **Arabic/RTL is still a separate slice, and is now the natural next i18n item.** `dir` is set
on `<html>` and `SUPPORTED_LANGUAGES` carries a `dir` field, so the plumbing exists — the work is
mirroring the layout, not the strings.
⚠️ The 32 `toLocaleDateString` sites remain NOT a blocker (textual options, `Sep 2026`).
`docs/international-release-plan.md` carries that correction; do not re-derive it a fourth time.

**The gate added this morning caught something on its first day.** jsdom reported the switcher's
box as 0 and stayed green while Chrome showed "Español" clipped under the chevron in an 80px
select — the browser sizes a select to its longest OPTION and ignores the 2rem author padding.
Also learned, and worth keeping: `index.css:845` forces `font-size: 16px !important` on every
input, textarea and select (iOS zooms below that), so a font-size class on any select in this
app is inert.

## ⛔ PUSH: EVERYTHING IN OUR CONTROL IS VERIFIED CORRECT, AND APPLE DOES NOT ANSWER.

**Read this before touching push. The point of it is to stop you re-running an eleven-hour
evening.** As of 2026-09-06 00:45Z: `push_sends` holds **ZERO rows across ALL users**, there are
**ZERO iOS tokens on the entire system**, and Tre's row reads
`outcome timeout | attempts 57 | app_build 686 | detail permission=granted`.

**The device asks Apple for a token. Apple says nothing — no token, and no error.** That is the
whole remaining fact.

### ⛔ ELEVEN HYPOTHESES, ALL DEAD BY EVIDENCE. DO NOT REOPEN ONE WITHOUT NEW INFORMATION.

| # | Hypothesis | How it was killed |
|---|---|---|
| 1 | He is on an old build | `app_build` recorded from `App.getInfo()` — reads **686**, the fixed one |
| 2 | `aps-environment` missing | Added `c1cff973`; symptom unchanged |
| 3 | It is `development`, not `production` | Fixed `8561f0d0`; symptom unchanged |
| 4 | The profile lacks the capability | CI step decodes the profile and asserts it — **present** |
| 5 | Xcode dropped it at export | CI step runs `codesign -d --entitlements` on the exported IPA — **`production`**, and `get-task-allow => false`, so properly distribution-signed |
| 6 | `register()` races its own listeners | Real bug, fixed `ec67489f`; symptom unchanged |
| 7 | A late token was discarded | Real bug, fixed `8975c23f`; symptom unchanged |
| 8 | Permission is not granted | **MEASURED** from `checkPermissions()` — `permission=granted`, not inferred |
| 9 | `INITIAL_SESSION` is not handled | `AuthContext.tsx:248` handles both events, with a comment recording `7108311a` |
| 10 | The app resumed, so sign-in never re-ran | Tre swipes it out of the switcher — real cold starts |
| 11 | The network blocks APNs (port 5223) | Tested on **cellular with wifi off**, app foregrounded 60s — `pending` at 00:26 → `timeout` at 00:44 |

### ⚠️ THE `.p8` CANNOT BE THE CAUSE, SO DO NOT "FIX" IT AND BELIEVE THE RESULT.
`APNS_AUTH_KEY_P8`, `APNS_KEY_ID` and `APNS_TEAM_ID` are how **our server authenticates to APNs
when SENDING**. Minting a device token is purely the OS talking to Apple, using the entitlement
and the app identity — **our server key is not involved at all**. If somebody later changes those
and a token appears, treat it as a coincidence and find the real reason.

### ⇢ THE NEXT STEP IS APPLE'S DIAGNOSTICS, AND IT IS OUTSIDE THIS DESK
The device console during a registration attempt shows the actual APNs subsystem error — the thing
we spent an evening inferring from silence. That needs a Mac with the iPhone attached, or
Console.app over the network. **This desk cannot do it from Windows, and saying so is the honest
end of the thread rather than a twelfth theory.**

Two free checks for his list, neither yet done, neither worth waking him for: **Low Power Mode**,
and any restriction under **Settings → Forgenta**. Both can interfere with background networking.

### What IS built and working, so it is not rebuilt
The sender (`push-send`, 291 lines, `x-cron-secret` only, dry-run default true), the APNs/FCM
transport with dead-token retirement, the `push-send-daily` cron (DRY RUN — appending
`?dry_run=0` is what turns delivery on), per-user/per-platform dedupe, and **FCM proven end to end
without delivering anything**: `?check=1` uses `validate_only` and returned `android_checked: 7,
android_ok: 7, delivered: 0`. **Android is proven; only APNs is not.**

### ⚠️ TWO THINGS ABOUT MY OWN REASONING, recorded so they are not repeated
1. I claimed the 30s wait window "recorded nothing" and had sent us down a wrong branch. **Rows
   WERE being written** — attempts went 41 → 46 at 22:47:35Z; the read that looked like silence
   was taken between attempts. I built a theory on a stale timestamp and stated it as cause.
2. **The registration JS ships in the WEB bundle, not the binary.** The app is a WebView on
   getforgenta.com, so a JS fix reaches a phone on the next app open with **no TestFlight
   install**. Six installs were requested tonight and most were unnecessary. Check the served
   chunk before asking for one.

`pending` is what made the last test readable: **no row** = the handler never ran; **`pending`** =
it ran and the app closed before the provider answered; **anything else** = it resolved.

### Also unbuilt: there is no Trophy Case
All five `Trophy` references are a lucide ICON inside `LearnCard`. Tre earned
`lesson:what-a-cash-floor-is` and asked where achievements live. There is no page and no route —
an unbuilt slice, not an unwired one.

## ⇢ FIRST UP — RECONCILE A PLANNED TRANSACTION WITH ITS REAL PLAID TWIN.

**Tre, 2026-09-05, verbatim, and it is the actual ask behind two mis-scoped slices:**
> *"the transaction should auto pull from plaid so I wait for it to ask to categorize it. sometimes
> i will add a transaction that day if its unrelated to a auto move, that way i can already plan
> ahead. then it should merge when the real transaction shows."*

**⚠️ HE IS NOT DOUBLE-COUNTING. Checked, and the number that said he was is a FALSE ALARM.**
A ±1-cent, ±5-day join over his 641 synced rows produced **96 pairs, 63 of his 83 manual rows,
$7,282.14** — and 63 of 83 was the tell. `synced_transactions` **never enters the cash math**:
`useForecastEngineInputs.ts:90` feeds them only to `buildAutoMatchedOccurrences`, and
`matched-occurrence-display.ts:166` says so outright. A manual row separately retires the rule
projection it answers (`overridesGeneratedOccurrence`, `mergeWithGeneratedTransactions` PASS 2).
Do not re-derive this and do not re-report the $7,282.

**THE REAL GAP, and it is an accuracy one:** nothing merges his planned row with the real one, so
**his typed figure stands forever and the bank's never replaces it.** He types $50, the charge is
$52.30, the ledger keeps $50 and nothing tells him. That is the silently-wrong number this repo
refuses everywhere else — the merge exists to CORRECT THE AMOUNT AND DATE, not to tidy a list.

**BUILD IT AS A SECOND CALLER, NOT A SECOND MATCHER.** `transaction-matching.ts` already has the
hard half — `amountConfidence` (exact/strong tolerances), `DATE_WINDOW_DAYS = 5`,
`normalizePaymentSource`, `ruleChargeAccountId`. Its `MatchableRule` aims it at RECURRING RULES.
**Widen the target to manual `transactions`; cloning the logic guarantees drift.**

**Design, decided (Sam, 2026-09-05) — do not re-argue:**
- **Propose, never merge silently.** A wrong auto-merge HIDES a real transaction, which is worse
  than two rows a person can reconcile themselves.
- **Show BOTH figures and say which wins** — his, the bank's, and that the bank's is about to.
- **In the categorize prompt he already waits for**, not a new reconciliation inbox.
- An unmatched manual row stays visible and stays his.
- ⚠️ **The FALSE-merge test matters more than the true one:** two genuinely different transactions
  of the same amount on the same day must NOT merge. That failure loses money from view.

## ✅ CLOSED — lump-sum transfers. Already built, and his constraint settled with a number.
`9f72c935` (test only; committed LOCALLY, unpushed — see the `src` hold below).
- **`lump_sum_transfers` is an ABANDONED DUPLICATE** with 0 rows. The live mechanism is
  `savings_goals.lump_sum_payments`, wired end to end: written `SavingsGoals.tsx:733`, read
  `forecast-engine.ts:797`, mirrored `useCardProjection.ts:920`, rendered
  `MonthlyBreakdownTable.tsx:183-185`, exported `forecast-export.ts:249-251`. **Two of us reasoned
  from a row count on the wrong table and nearly rebuilt a working feature on top of itself.**
- **Measured:** auto-extra OFF, a lump moves cash by exactly 500. Auto-extra ON, it moves cash by
  **ZERO** and auto-extra to that goal drops 1065.16 → 565.16. **A substitution, not a
  double-count.** His constraint is unnecessary for correctness.
- **KEEP IT ANYWAY, for a different reason:** with auto-extra on the control changes nothing
  visible, which is the lying-control shape. Disable it with auto-extra ON, visible and saying why.
  **He was right, for a reason he did not have — tell him, or he keeps a wrong model of his own
  forecast.** NOT BUILT YET; only the test is.

## ✅ THE `src/**` HOLD IS OVER - do not reinstate it from this file's history.
Written 2026-09-06 by Ada. The section below is kept for its REASON, which still stands, but the
hold itself is dead: five `src/**` pushes between 02:08 and 04:19 on 2026-09-06 each ran
`android-build.yml` to `success` (runs 34005691437, 34006159803, 34006829317, 34010612324,
34011182423). Verified with `gh run list`, not assumed. Push on green, as everywhere else.

<details><summary>The hold as written, and why it existed</summary>

### ⚠️ `src/**` COMMITS WERE ON HOLD (Sam, 2026-09-05) until Tre's APNs test lands.
Non-`src` work (migrations, docs, handoff) ships normally. **`9f72c935` is committed and NOT
pushed.** The hold exists because VERSION is now 6.6.0 and `android-build.yml` deploys to **Google
Play production at a 10% staged rollout auto-promoting after 24 hours** on any `src/**` push —
shipping the build that changes the permission flow before the first real-device evidence exists.

</details>

## 📱 TESTFLIGHT 6.6, BUILD 676 — uploaded, waiting on Tre's iOS test.
Install, Settings → Notifications → "Alerts about your money" ON, accept the iOS prompt.
**If it works he sees NOTHING; if it fails he now gets a line under the switch saying why.**
Then fire ONE real delivery and WATCH it — the first test APNs has ever had.
⚠️ **Uploaded ≠ processed.** `altool` succeeded; Apple's processing is async and there are no App
Store Connect credentials locally, only in GitHub. Do not claim it is installable unseen.

### ⚠️ THREE THINGS THAT COST A RELEASE TODAY — read before shipping a build
1. **A green `ios-build` run does NOT mean a build shipped.** `Upload to App Store Connect` is
   gated `if: workflow_dispatch || refs/tags/v`. Eleven green push builds today uploaded NOTHING.
2. **The version train closes.** `CFBundleShortVersionString 6.5` was rejected — *"train version
   '6.5' is closed for new build submissions"*. This is documented in `version-bump.yml`'s own
   header because it happened at 6.3 on 2026-08-21. **Run Bump VERSION; never hand-edit.**
3. **`aps-environment` was missing from `App.entitlements` entirely**, so iOS push could never have
   worked whatever the `.p8` said. Added `c1cff973`. It did NOT break signing — the profile already
   carried the capability. **I predicted it would and never ran `gh run list`; Sam caught it.
   Verify by evidence, not by mechanism, even when the mechanism is right.**

### ⚠️ TWO THINGS THAT OUTLIVE ANY SINGLE TASK, now also in `CLAUDE.md`'s gates
1. **A jsdom green on anything geometric is not evidence.** jsdom reports `scrollHeight` and
   `clientHeight` as 0 and does not clamp `scrollTop`. Eight tests passed for a feature that
   failed three times in Chrome. Model the geometry, or verify in a browser.
2. **Grep for the CALLER, not the definition**, before scoping anything as "not built". Four
   features on 2026-09-05 were already written, exported and never called — and three of them
   had comments describing the behaviour as if it were happening.

## ⚠️ CORRECTIONS TO TODAY'S OWN RECORD — 2026-09-05, made the same day

**A finding I published was scoped to the wrong data, and I am striking it rather than letting
it stand.** I reported that "$1,195.88 of Tre's most expensive debt is treated as free money"
because two cards had a null APR. Those cards — "Capital one SAVOR" and "Fairwinds Preffered
Cash Back" — **belong to a different user.** The query behind it was not scoped to his
`user_id`.

**Tre's actual cards, five active, scoped by joining `auth.users` on his email:**

    Robinhood Credit Card   $46.38      29.99%   rank 0   plaid-linked
    Prime Visa              $8,711.21   27.49%   rank 1   plaid-linked
    Discover it Card       $10,290.04   16.60%   rank 2   plaid-linked
    Venture X                   $0.00   22.99%   rank 3   manual
    Apple Card                  $0.00   22.99%   rank 4   manual
    ------------------------------------------------------
    total                  $19,047.63

That total matches the outside analysis exactly. **There is no missing $6,480, no unranked-card
problem in his data, and every one of his cards carries a real APR and a real rank.**

**THE CODE DEFECT SURVIVES, and is worth fixing on its own merits.**
`credit-card-engine.ts:471` does `const apr = Number(acct.apr) || 0`, so an UNKNOWN rate becomes
ZERO — and under avalanche a 0% card sorts LAST. Any real user who leaves an APR blank has their
most expensive debt paid last, silently, and is told nothing. That is the confident-zero this
codebase refuses everywhere else. Not Tre's problem today; still a defect.

**✅ CLOSED SAME DAY — the `de1000xx` accounts are the APP STORE REVIEWER LOGIN, not a leak.**
I escalated nine accounts inserted at one identical microsecond as demo seed reaching a real
user. Sam searched the whole tree for `de1000xx-0000` and there is **not one match** — not in
`src`, not in `supabase`, not in the migrations. Nothing in the app can produce those ids. The
account is `reviewer@treforged.com`, and the rows are a hand-run seed so a store reviewer signing
in sees a working finance app rather than an empty shell. **Nobody is budgeting on fake balances;
the "user" is Apple.** Right escalation on the evidence I had, wrong conclusion once scoped. Do
not re-raise it.

**✅ CLOSED 2026-09-05 — an unknown card APR was silently treated as 0%.** `credit-card-engine.ts` used to do
`Number(acct.apr) || 0`, and a 0% card sorted LAST under avalanche. **DECIDED (Sam,
2026-09-05): the app ASKS, it does not assume.** Both defaults are the confident-zero mistake —
sorting an unknown rate first invents a pessimistic number just as surely. So: a null-APR card is
NOT ranked and NOT assigned a rate; its MINIMUM is still paid, because it is real debt; it renders
in the ranking list in a "needs your rate" state with an inline input, so the fix is one tap where
the problem is visible; and it never silently sorts last.

✅ **IT IS BUILT, and this section said otherwise for a whole session.** `0d91028b` ("a card with
no APR is asked for its rate, not ranked as if it were 0%") shipped every part of the decision
above: `credit-card-engine.ts:505` carries `aprIsUnknown` as a real distinction instead of
collapsing an unknown rate to 0, `rankableForStrategy` (line 104) keeps such a card out of the
ranking, `debt-payoff-order.ts` threads the flag through both list builders, and
`AvalancheOrderList` renders the "needs your rate" row with its inline input — mounted for real at
`CreditCardEngine.tsx:1608`, not merely exported.

⚠️ **This is the CALLER gate firing in the direction nobody watches.** It was written for features
described as built that were never called. The opposite costs just as much: a record saying NOT
BUILT about something shipped, called and tested, which the next session rebuilds on top of itself.
`grep -rn aprIsUnknown src/` was the whole check. **Grep before you BUILD, not only before you scope.**

**Also settled today, from Tre:** the Robinhood card is **NOT** to be demoted — *"it needs to be
paid first, and on time in full"* — so `surplus_sort_order: 0` stays, and its due day is now the
10th. And "is EU/Japan closed for Apple and Google too?" — **both, and it is one disclosure
question wearing two store-specific forms**: Japan is a GOOGLE requirement (business operator's
name, phone and physical address under the Specified Commercial Transactions Act) and the EU is
an APPLE one (the DSA trader declaration, published on the product page in all 27 territories).
Neither region can be served without the disclosure he has refused, on either store.

## 2026-09-05 — OVERDRIVE. Twelve things shipped, and three of them were live defects nobody knew about.

Every item below is on `origin/main`, verified by CONTENTS, with its gate run. Detail is in the
commit bodies; this is the pointer list.

**⚠️ THE THREE LIVE DEFECTS, in the order they cost money:**

1. **RevenueCat was never configured for a returning user.** `Purchases.configure` was called
   only on `SIGNED_IN`. Supabase fires `INITIAL_SESSION` when it rehydrates a stored session,
   which is nearly every launch of the mobile app — a person who stays signed in never sees
   `SIGNED_IN` again. So `getOfferings`, `purchasePackage` and `restorePurchases` all returned
   null on the `!configured` guard: **the paywall had nothing to show and Restore Purchases
   silently did nothing.** Same event that caused the Google OAuth popup hang (`7108311a`); it
   survives because it never fires in a fresh-login test. Also fixed: the guard was a bare
   boolean, so a second user on a live SDK would have had their entitlements attached to the
   FIRST user's customer.
2. **The hosted Plaid sheet could hang on a blank white page forever.** It waited for ONE
   signal, an `appUrlOpen` on our custom scheme. When Plaid renders a completion page instead
   of redirecting, that never fires. The redirect is a hint; the SERVER is the truth, so the
   result endpoint is now polled WHILE the sheet is open and a completed session closes it.
   Tre hit this on his own phone at 06:54Z — the link had SUCCEEDED underneath.
3. **An anonymous stranger could read the subscriber counts.** `revenue_summary_lines()` is
   SECURITY DEFINER and carried `EXECUTE` to PUBLIC, which includes `anon`, whose key ships in
   the app bundle. Revoked, and proven closed with a real anonymous request (401 / 42501).

**⛔ STANDING RULE, LEARNED THE HARD WAY TODAY — put this anywhere you touch a definer function:
`CREATE` RE-GRANTS `EXECUTE` TO `PUBLIC`.** Adding an OUT column to `revenue_summary_lines`
needed a `DROP` and `CREATE`, and that would have silently reopened the leak closed an hour
earlier. **Every `DROP`/`CREATE` on a SECURITY DEFINER function must carry its REVOKEs with it,
in the same migration.** The absence of a grant is not a state you can rely on surviving a
redefinition, and nothing in the schema warns you.

**MONEY, RECONCILED FROM STRIPE ITSELF — the answer is exact.** `revenue_summary_lines` reported
five ACTIVE STRIPE PREMIUM subscriptions. Stripe live mode: 8 subscriptions, 6 active, **every
one carrying a discount**, five of six with no payment method, and **exactly ONE charge in the
account's entire history — $4.99 on 2026-03-26, billed to tre@treforged.com testing his own
checkout.** No customer money has ever moved. Fixed with an `is_comp` column, defaulting TRUE so
a forgotten write UNDER-reports rather than invents revenue; only `invoice.paid` with
`amount_paid > 0` clears it. Comps are reported separately and labelled, never dropped.
⚠️ **"No `stripe_subscription_id`" could never have worked as the rule** — one comp holds a real
subscription id, and its comp lives in a Stripe discount that is not in this database and cannot
be. Inference here is impossible, not merely fragile.

**A PAYMENT PIN IS A REPLACEMENT.** See the RESOLVED section at the top of this file. The
promo-card explanation for the payoff date is struck.

**Also shipped:** three one-day-early date defects plus an eslint rule so the class cannot return
(`net-worth-snapshot.ts:46` was the one nobody had counted — it compares a DATE against a live
instant, so unlike its neighbours the offset does not cancel); the Student Loans chart responds
to a tap on mobile (recharts selects on `touchmove` only, and a stationary tap never sends one);
duplicate bank rows in Linked Banks (the dedupe was never broken — the hook returned revoked
connections); the supersede path now hangs up at Plaid's end too; the btn vocabulary across four
surfaces with 73 labels lifted to the `text-xs` floor; the Security tab's three different
"remove" treatments unified; `docs/dynamic-cash-floor.md`, `docs/distribution-expansion.md`,
`docs/ux-rules-audit.md`; `src/lib/variable-bill-buffer.ts`; handoff.md pruned 101 KB to 54 KB.

**BASELINES TO MEASURE AGAINST — write nothing over these, they are the before picture:**
- **RevenueCat, 2026-09-05: 172 customers, 0 trialing, 0 paid, $0 revenue**, against 31 Supabase
  accounts and only 2 rows carrying a `revenuecat_app_user_id`. The identifier column is
  overwhelmingly `$RCAnonymousID:`. After the INITIAL_SESSION fix reaches a device, NEW customers
  should stop being anonymous. That ratio is now the regression signal.
- **Users: 31 total, 2 active in 7 days, 4 in 30 days, 23 dormant, 4 never signed in. Latest
  signup 2026-08-07.**
- **getforgenta.com: 0 CACHED REQUESTS in 30 days against 88.99k total.** Zero, not low. Every
  request on a static Vite build is reaching origin. Worth a look at the Vercel cache headers or
  a zone bypass rule — a free performance and cost win, not urgent.

**OPEN, AND HONEST ABOUT IT:**
- The RevenueCat fix is **not proven on a device.** It has unit and behavioural cover; it has not
  been pressed on a phone. Do that before drawing conclusions from the customer ratio.
- ✅ **CLOSED 2026-09-06 — `logIn()` is never called, and that is CORRECT. The premise was false.**
  Checked against the code rather than re-derived: `configure` is only ever reached with a real
  `userId` (from `AuthContext` on `SIGNED_IN || INITIAL_SESSION`), and `getOfferings`,
  `purchasePackage` and `restorePurchases` all return null while `configuredUserId === null` — so a
  purchase CANNOT be made before identification and there is no anonymous customer to alias.
  `logIn` is for apps that configure anonymously and identify later; this one identifies first.
  **Recorded as a comment in `purchases.ts` so nobody "fixes" it.**
  ⚠️ **What IS still unexplained is a DATA question:** the 172 customers keyed `$RCAnonymousID:`.
  Nothing in that file can produce one. Likely pre-dating the `INITIAL_SESSION` fix, or the native
  SDK self-initialising outside the JS path — **a guess, to be MEASURED before anyone acts on it.**
- The chart touch fix is **not verified by a real finger on a real phone.** jsdom cannot exercise
  recharts point selection at all — not even a mouse — so no test in this repo can close that.
- `CreditCardEngine.tsx`'s chart has the **identical** recharts touch gap, untouched.
- Only the Credit Card tab is inside an `ErrorBoundary`; a throw in any of the other four
  `LiabilityTrajectoryChart` usages in `DebtPayoff.tsx` (`:480, :537, :647, :718`) blanks the
  whole `/debt` page.
- **Bank linking is hardcoded to the US** — `country_codes: ["US"]` at
  `plaid-create-link-token/index.ts:118` and `plaid-exchange-token/index.ts:170`. First thing
  that must move for ANY market. Nobody had counted it.
- Distribution: **EU and Japan are refused and final** (Tre, on the DSA trader declaration).
  Target is everything except those. Tranche A is UK, Canada, Australia, New Zealand.
- The account-wide Cloudflare 5xx belongs to **another zone**, not getforgenta — its own zone
  shows ~1,081 requests in 24 h and no French traffic at all. Vercel reports ZERO runtime errors
  for getforgenta, and it is a static site with no `api/` directory, so there is no route to
  throw. Not this desk's.

## ⛔ TWO STANDING PATTERNS, each of which has now cost more than one bug

**1. ANYTHING THAT MUST RUN FOR A *RETURNING* USER RIDES ON `INITIAL_SESSION`, NOT JUST
`SIGNED_IN`.** Supabase fires `INITIAL_SESSION` when it rehydrates a session from storage, which
is nearly every launch of the mobile app — a person who stays signed in **never sees `SIGNED_IN`
again**. It has now cost three separate things:
- the Google OAuth popup hang (`7108311a`),
- the RevenueCat SDK never being configured, so the paywall and Restore Purchases silently did
  nothing for every returning user,
- push registration, which would have collected tokens from first-time sign-ins and nobody else.
It survives because **it never fires in a fresh-login test.** Any new branch in
`AuthContext.tsx`'s `onAuthStateChange` gets asked this question before it is written.

**2. AN AGENT CANNOT REPORT THAT IT IS SPINNING, so watch the FILE, not the agent.** A
`sonnet-executor` sat listed as "reviewing the final diff in LiabilityTrajectoryChart.tsx" for
over an hour after that file's last write — the work was long since committed. **Nothing flagged
it and nothing would have**: this desk was productive throughout, so it looked healthy from the
inside, and it took Tre reading the terminal footer to spot it. Same confident-blank shape as a
desk that is simply absent from a stuck-check.
**The check: when you spawn an agent, note the file it should be touching. "Still listed AND its
target file has not moved in 30 minutes" is the signal.** Compare mtime against now; that is the
whole test. And prefer an `llm` shim call, which returns and ends — an agent can sit.

## ✅ CHASE PAY OVER TIME — THE CODE HALF IS DONE. The DATA half is Tre's.

⚠️ **"Not started" was wrong, and so was the sweep that said so.** The 2026-09-05 caller gate
grepped for `payOverTime` / `pay_over_time`, found nothing, and recorded the item as unbuilt. **The
feature is called `monthly_fee`.** A caller-grep is only as good as the symbol you grep for.

What was actually true, in three layers:
1. `monthly_fee` and `fixed_term` existed on `BalanceTranche`, were parsed, normalised and had
   their own test file. Correct.
2. **`credit-card-engine.ts` threw the fee away at the boundary** — it read `monthlyInterest` and
   `totalMonthlyInterest` while `trancheInterestBreakdown` was already computing `monthlyCost` and
   `totalMonthlyCost`. Computed, tested, discarded. Fixed; mutation-verified.
3. **`tranche-form.ts` dropped both fields**, so a fee could not be ENTERED and would have been
   **erased by any save**. That is the SECOND time this file has done exactly that — `min_payment`
   from `ef75f6d5` to 2026-08-22 — and a warning comment did not prevent the repeat, so there is
   now `tranche-form.roundTrip.test.ts` which fails on the next field somebody forgets.
4. `BalanceTrancheEditor` had no inputs. Now has a Monthly Plan Fee box and a Fixed term checkbox,
   both pressed in tests.

⚠️ **NO NUMBER MOVES TODAY.** Measured: 3 accounts, 6 tranche rows, **zero carry a fee**. The
change only takes effect once a plan is entered, and parity holds to the cent for anything without
one.

### ⬜ STILL OPEN AND IT IS TRE'S — the three plans are MISSING from `balance_tranches`
$2,101.39 of 0% instalment principal sits in the untranched remainder at 27.49% — **~$577/yr of
interest he will not pay** — and $284.40 of fees have nowhere to live until the rows exist.
**I did not enter them:** that is his data off three confirmation emails I do not have, and
inventing tranche rows on a live financial account from a summary is not something to do
unattended. He can now type them in: balance, 0% APR, the plan end date, the monthly instalment,
the monthly fee, and tick Fixed term.

<details><summary>The original finding, 2026-09-05</summary>


Reconciled 2026-09-05 against three plan-confirmation emails. **Two errors pointing in OPPOSITE
directions, which is why nothing looked wrong.**

- **The three plans are MISSING from `balance_tranches`.** No balance match, no monthly match, and
  the timing proves it: a 12-month plan opened Sep 2026 ends **Sep 2027**, and his stored expiries
  are Feb 2027, Jul 2027 (×2), Aug 2027. So **$2,101.39 of 0% instalment principal sits in the
  $3,123.46 untranched remainder and is charged at 27.49%** — roughly **$577/yr of interest he
  will not pay**.
- **The FEES are real and have no field.** Every plan's monthly × 12 equals principal + fees to
  within two cents (PayPal Zettle 12 × $124.06 = $1,488.72 vs $1,322.50 + $166.20 = $1,488.70).
  **$284.40 across three, 13.5% of principal, invisible to the forecast.**

Net: the forecast **overstates** these three by about **$290/yr**, with both components wrong.

**⚠️ POSSIBLY BIGGER, AND UNVERIFIED — needs his statements, do not guess.** All four stored
tranches divide to exactly whole payment counts (6.000, 11.000, 10.999, 12.000). They were
DERIVED as balance ÷ months, not read off a statement, so their `min_payment` is principal-only
and excludes whatever fee each carries. At a comparable load that is another **~$754** hidden
across the $5,587.75.

**THE MODELLING QUESTION UNDERNEATH THE FEE, and it moves the payoff DATE rather than the cost.**
Chase allocates minimums to the LOWEST APR and surplus to the HIGHEST, so he **cannot selectively
prepay a 0% plan while carrying a 27.49% balance.** These are FIXED 12-month obligations. The
engine has no way to express "this tranche's schedule cannot be shortened" — `min_payment` on the
tranche is close but is a floor, not a ceiling.

**The fix:** a FEE concept on the tranche — a flat monthly amount, not a rate, because that is how
Pay Over Time charges — plus the payoff math including it. A 0% tranche is not a free tranche.
Same confident-zero as the null APR, on the same card.

</details>

## HIS LIVE NUMBERS, 2026-09-05 — useful, and they go stale fast

Answering "can I pay $753.75 and still clear my floor?" — **no, short by $386.95.**
- Cash **$1,002.58**: Chase Checking $728.28, General Operations $162.59, Savings $106.71,
  Alliant $5.00.
- Paid **WEEKLY on Fridays** (`paycheck_day: 5` = day-of-week). Gross $1,093, tax 22%, net
  **~$852.54/wk**. 2026-09-05 is a **Saturday**, so the balance already includes Friday's pay and
  the next is **Fri 2026-09-11**.
- Due before then: **Prime Visa min $559.40 (due 09-07)** + Phone Bill to Mom $30 (09-10) +
  Robinhood $46.38 (09-10, pays in full) = **$635.78**. Discover's due day is the 1st — outside.
- He could pay **$366.80** today, or the lot after Friday.

⚠️ **His `cash_floor` reads 2500 but `cash_floor_is_manual` is FALSE**, so 2500 is a saved
preference and is **NOT the floor in force** — the measured bills figure is. Anyone quoting 2500
is quoting a number the engine is not using. Confirmed live, exactly as `docs/dynamic-cash-floor.md`
describes.

## ✅ PUSH NOTIFICATIONS — storage, sender AND transport are ALL built. `664bdb10` + `efa5d1ee`.

Full detail, Tre's seven console steps and the device-proof runbook: **`docs/push-runbook.md`**.

**Built, applied and verified:** `device_tokens`, `push_sends`, `push_send_runs` (anon `GET` on
all three returns **401/42501**, checked with a real request); `src/lib/push-registration.ts` with
11 cases; `src/lib/push-store.ts`; wiring in `AuthContext` beside the RevenueCat calls, on
`SIGNED_IN || INITIAL_SESSION`.

**⚠️ THE FORK THAT DECIDES WHAT THE SENDER IS.** `notification-policy.ts` is transport-agnostic
and the sender can call it as-is — but its SIGNALS are not equally available to a server.
`upcomingBills`, `projectedCashAtNextBill`, `cashFloor` and `newMilestones` all come from the
forecast engine, which is **client TypeScript that has never run on a server.** So:
- **Server-computable today: `learn_lesson` and `streak_risk` only.** Both derive from the
  `achievements` table (`lesson:<slug>` rows with `earned_at`) plus the bundled lesson list. The
  maths is `learn-streak.ts`, pure, and needs porting to `supabase/functions/_shared/` — Deno
  cannot import from `src/`.
- **NOT server-computable without porting the engine: everything money-shaped.**
Those two ARE what Tre asked for, so the first sender ships them — **and it must say in its own
code that it covers two of seven kinds**, or the next person reads a working sender and assumes
bill alerts reach dormant users when they do not. Porting the engine's signals is its own project.

**⚠️ THE TRAP:** `capacitor.config.ts:8` points the shipped app at `https://getforgenta.com` as a
WebView, so **the registration JS must be in the DEPLOYED WEB BUILD.** A native rebuild without a
matching web deploy registers nothing and reports no error. The same fact is the upside: a web
deploy reaches mobile users with no app store review.

**Blocked on Tre only:** the APNs `.p8`, Key ID, Team ID, `google-services.json` and the FCM
service-account JSON. Nothing else in the build waits on him.

✅ **THE SENDER EXISTS — this heading said "the sender is not" built until 2026-09-05.**
`supabase/functions/push-send/index.ts`, 291 lines (`664bdb10`), with the APNs HTTP/2 and FCM v1
transport in `efa5d1ee`. It ships exactly the shape this section specified: `x-cron-secret` only,
dry-run defaulting to TRUE, and a header block naming the two kinds it sends (`learn_lesson`,
`streak_risk`) and the five it does not, so nobody reads a working sender and assumes bill alerts
reach dormant users. The fork above is now DESIGN DOCUMENTATION for that code, not pending work.
**What genuinely remains is the credentials above, which are Tre's hands.**

### Caller-gate sweep of the rest of this queue, 2026-09-05
Applied `grep -rn <symbol> src/ supabase/` to each remaining item before starting any of them.
**Genuinely open, nothing written:** Chase Pay Over Time (no `payOverTime` / `pay_over_time`
anywhere in `src/`) and the OG billing-consent SURFACES (no `og_consent` in any `.tsx`; the gate
itself is in). `useLumpSumTransfers` still has no `.tsx` caller, unchanged from the earlier find.
Those three are the real remaining work in this file.

## OG billing consent — the GATE is in, the SURFACES are not (2026-09-03)

`decideAnniversary` now refuses to grant without a confirmed `og_billing_consent`
row (`needs_consent`), Stripe-native members included — `docs/og-cohort.md` states
that rule with no exception. Gate proven by deletion: remove it and three tests
fail, including "NEVER GRANTS WITHOUT A CONFIRMED ROW".

Two deliberate choices, both toward not lying in the record:
- `needs_consent` is REPORT-ONLY. Writing `reward_action_required_at` would record
  that we asked somebody we have not — the same class of lie as a
  `reward_granted_at` written by code that granted nothing.
- A failed consent READ is a failure, not an absent consent. A database blip that
  read as "never asked" would re-email someone who already confirmed.

The WEB CONFIRMATION PAGE is built too: `functions/og-consent`, server-rendered
so it stays out of the Capacitor bundle (a React route would ship inside the
mobile app whether or not anything links to it). The link is a credential —
256-bit CSPRNG, SHA-256 at rest, expiring, single-use, own table so
`og_billing_consent` never gains an UPDATE path. A GET records nothing; both
buttons are POST. Tests parse real DOM and PRESS the buttons; switch either form
to GET and three fail.

The EMAIL is built too: `functions/og-consent-ask` + pure `_shared/og-consent-email.ts`.
It reuses `decideAnniversary` rather than re-deriving who is owed, retires any
outstanding link before issuing a new one, and writes the `asked` row AFTER the
send — recording first would claim we asked someone we did not, and the unique
index would then block the retry that fixes it. Dry run is the default and is
checked at every branch; `?limit=N` caps the blast radius and a malformed limit
is a 400, never "no limit".

**`needs_consent` stays report-only in `og-anniversary` ON PURPOSE — that is not
an unfinished flip.** The notify job is its own function so the emails can be
stopped without stopping the accounting. Turning the ask on is a SCHEDULING
decision (a cron entry calling `og-consent-ask?dry_run=0`), not a code change.

**Next up here:**
1. Nothing in code. The flow is notify -> confirm -> act end to end; what remains
   is applying migrations, setting env, deploying, and scheduling — all Tre's.
2. A consent copy **v2** when convenient: v1's body says "Decline below", but the
   buttons are on the linked page, not below in the email. NEVER edit v1 in place
   (rule 1 of `og-consent-text.ts` — it would rewrite what everyone already
   consented to); add a version.
3. The Stripe grant itself stays unwired pending Tre's explicit yes; it is a real
   action on his live Stripe account.

**Migrations WRITTEN, NOT APPLIED** — `20260903_og_billing_consent.sql`,
`20260903_og_anniversary_consent_required.sql`, `20260903_og_consent_tokens.sql`.
**`og-consent` must deploy with `verify_jwt = false`** — declared in
`config.toml`, but the MCP/dashboard deploy path ignores that file and defaults
to true, which would break the page for anyone not signed in.

## DEMO FIXTURE REBUILT 2026-09-03 — a persona the app is FOR, and 12 filmable lines

The fixture is the ONLY thing that can ever be filmed (Tre): his real accounts are
not marketing material. It was measured weak on 2026-09-03 — zero balance tranches,
so the strongest line the app produces could not fire — and real card brands in the
names. Both are fixed; what follows is what it IS now.

**The persona changed, and that was the real defect.** The demo ran on the app's
`DEFAULT_PROFILE`: $1,875/wk gross, a roommate, ~$2,800/mo of surplus, and a forecast
climbing past $91,000 in eighteen months while the same fixture carried $6,482 of card
debt at 24.74%. Nobody saving $2,800 a month carries that balance. `demoProfile` in
`src/lib/demo-data.ts` is now its own object — $968/wk gross, thin surplus, a
semiannual $1,014 insurance premium — and `useSupabaseData`'s demo branch reads it.
A signed-out non-demo user still gets `DEFAULT_PROFILE`.

**What the engine now says about it** (`npx vitest run src/lib/__tests__/demo-marketing-lines.engine.test.ts`):
cards clear Dec 2027 ("CC Debt Free"), no month breaches its floor, tightest month is
$2 above it, $2,417 reprices 0% -> 24.74% on May 11 2027, minimums alone would cost
$8,924 on $6,482.

- **The harness is the reusable part:** `src/lib/__tests__/fixtures/demo-forecast-harness.ts`
  runs the app's own card sim (`useCardProjection`, so callers need jsdom) and feeds it
  to `calculateForecast`. `runDemoForecast` WITHOUT cards reads several hundred a month
  too rich — the file says why. Use `runDemoForecastWithCards` for anything about cash.
- **Twelve lines, four types** (repricing / leakage / acceleration / cash-floor), every
  figure read out of the engine run, guarded against Ruby's F1/F2/F5/F6 in
  `demo-marketing-lines.engine.test.ts`. Spec: `tre-forged-marketing/docs/DEMO-FIXTURE-SPEC.md`.
- **A cash-floor BREACH line is not producible and should not be chased.** The converged
  engine protects the floor by holding back debt payments, so a breach only happens for a
  persona the app cannot help. The honest cash-floor lines are the tightest-month headroom
  and the lumpy premium, and that is what shipped.

## RULE: verify against the DEMO FIXTURE, not Tre's live account

Set 2026-09-03 after I toggled two of his card payment preferences to answer a
marketing question, then restored both and verified. Sam's reasoning, and it is
right: **a restore that verifies is still one step short of never having changed
it.** If a sync, webhook or scheduled job had fired between the change and the
restore, the restore would have been correct and the intervening state would
still have been wrong. Low probability, real, avoidable at no cost.

**Mutate his account only when ONLY his data can answer the question.** That was
not true here — the fixture would have answered it AND given a second dataset.

⚠️ `/demo` does NOT switch while signed in — it stays on the real account, checked.
So the fixture route for a question like this is a **headless comparison**
(compute with `paymentPreference: 'statement'` vs `'min'` over `demo-data.ts` and
diff the payoff months), not the browser.

## Two open items from the "one input, one number" question

1. **Run the payment-mode toggle against the demo fixture.** On Tre's data the
   payoff MONTH did not move on either card tested — only the label changed,
   "Interest-free: 16 mo (Dec 2027)" → "Payoff: 16 months (Dec 2027)". His card
   set is promo-heavy, so his payoff months are pinned by 0% expiry schedules
   rather than payment size. **n=1: "does not move ON THIS DATA", not "cannot
   move".** Ordinary revolving debt would likely move. If it does, Ruby gets a
   second marketing asset; if it does not, that is a real product finding about
   what the control does.
2. **The recompute takes 2,499 ms** (measured, card toggle → label change). Worth
   fixing on its own merits, not just for filming: two and a half seconds of
   nothing after a tap reads as a broken control.

**The stronger finding, already routed to Ruby:** the app ALREADY renders
zero-input lines that name a number, a date and a consequence — e.g. *"$3,562 at
0% reprices to 27.49% on Jul 7, 2027 (+$82/mo) — clearing it first needs $356/mo
for 10 months"*, and the cash-floor warning naming the exact card and statement.
No tap, no wait, nothing built for a camera.

## `reach` — EXPOSED and GRANTED 2026-09-04. Containment is proven for the first time.

Supersedes the 2026-09-03 section below, whose evidence proved routing rather than
containment. Sequence, all of it verified against the live project rather than reported:

1. **Tre toggled `reach` into the exposed schemas** (via Sam). I approved it: reachable
   is not permitted, the revokes are the control, and hiding the schema was the thing
   PREVENTING the control from ever being tested.
2. **Exposure immediately revealed a bug that had been invisible since 0001.** Every
   migration ended `revoke all on schema reach from anon, authenticated, public` — and
   **PUBLIC is every role, `service_role` included**, with no explicit grant anywhere. So
   the APP had no USAGE either, and `/r/<code>` returned `permission denied for schema
   reach`: the exact words of correct containment, produced by a completely different
   fact. Third time on this schema that two failures produced one observation.
3. **`0005_service_role_grants.sql` applied by me** (migration
   `reach_service_role_grants_and_rate_limit_rls`), read in full first. Revoke FIRST then
   grant — the reverse order strips `service_role` again, which is how four consecutive
   migrations looked right and were wrong.

Verified AFTER the apply, from `has_*_privilege` and `pg_class`, not from the success flag:

    role            schema_usage  select tracked_link  insert click  execute limiter
    anon            false         false                false         false
    authenticated   false         false                false         false
    service_role    TRUE          TRUE                 TRUE          TRUE
    RLS enabled on campaign, click, rate_limit, tracked_link — all four

Piper's `verify_reach_grants.sql` also caught a real omission the first time it ran
against something live: `reach.rate_limit` had RLS off (her 0004). Closed by 0005.

**CLOSED 2026-09-04 — the app read a row, and the privacy claim is now about a real
request.** Piper's smoke test: `/r/<code>` → 302 to the real destination, `/api/briefs/…`
→ 200. The click row the APP wrote, every column: `id, link_id, at,
referrer_host='l.instagram.com', device='mobile'` — **no IP, no user agent**, against a
request that carried a real iPhone UA and a real `Referer`. The limiter row held a salted
hash (`brief-read:57a8f312…`), which also proves `rate_limit_hit` executed as
`service_role`. Anon probes after the grants: 401/42501 on both a read AND a write, with a
live-key control. Full verify 7/7 PASS.

**Cleanup verified by ME, not by her report:** `count(*)` on all four `reach` tables reads
0/0/0/0. She nearly missed the `rate_limit` row because she wrote two rows and the APP
wrote the other two — a cleanup list built from "what I inserted" misses what the system
inserted in response, and the system's rows are the ones carrying request-derived data.

**Two open notes, neither urgent:** `relforcerowsecurity` is false on all four tables, so
the table OWNER bypasses RLS (Postgres default, consistent) — only matters if anything
connects as the owner rather than `service_role`. And `alter default privileges` binds to
the role that RAN it, so a future migration applied as a different role lands ungranted —
`for role postgres` would pin it.

## ⛔ DO NOT LET ANYONE "TIDY" THE `send.treforged.com` DNS RECORDS

Forgenta's auth mail AND the OG consent email both send from
`noreply@treforged.com` through Resend (`og-consent-ask/index.ts:38`,
`CONSENT_FROM`). Ellis established 2026-09-03 that `send.treforged.com` is **not a
stray second setup**: it is the MAIL FROM / bounce subdomain Resend requires to
verify `treforged.com`, and its SPF TXT and `feedback-smtp` MX come from Resend's
own record set.

Mail from `noreply@treforged.com` aligns on DKIM strictly (`d=treforged.com`) AND
on SPF under relaxed alignment via that subdomain. **Sam moved the root domain to
`p=quarantine` today**, so removing those `send.` records would break bounce
handling and leave DMARC resting on DKIM alone — with quarantine live, that is
consent emails and password resets landing in spam or vanishing.

It looks like clutter. It is not. This is second-hand from Ellis and I have not
read the DNS zone myself, but the consequence lands on my flow, so it is recorded
here rather than only in his repo.

## MULTI-CURRENCY: Tre said PER-CURRENCY SUBTOTALS (2026-09-04). The blocker is now DATA, not the decision.

**Measured before designing anything, and it decides the whole feature: this app stores
NO currency on any money-carrying row.**

    grep currency src/integrations/supabase/types.ts  -> profiles, expenses, capital_contributions
    accounts                                          -> NO currency column
    transactions / recurring_rules                    -> NO currency column
    grep -rl currency supabase/migrations             -> ZERO files
    grep -rl "capital_contributions" src              -> types.ts only
    grep -rl "from('expenses')" src                   -> nothing

So the two tables that DO carry a currency are **not used by the app at all**, and the
one live column — `profiles.currency` — is a display preference, not a per-amount fact.
Every balance, rule and transaction in Forgenta is a bare number.

**Consequence: "per-currency subtotals" has nothing to group by yet.** The decision Tre
made is the right one and it is not the next step. The next step is attaching a currency
to money-carrying rows, and that is a migration + a write path + a backfill of every
existing row to `USD`, which is a slice in its own right and was NOT started at 84% of a
91% weekly cap.

**Design constraints, settled now so the slice does not re-litigate them:**
- Subtotal PER CURRENCY. Never a single converted total, and never a rate this app invents.
- A missing rate renders as a missing subtotal with a reason, not a converted figure. An
  empty subtotal beats a confident wrong one — Tre's own recorded preference, and currency
  is where a plausible-looking number hides a wrong one most easily.
- `formatCurrency` already takes a per-call currency override and `setMoneyDisplay` exists
  (`src/lib/calculations.ts`). The display layer is ready; the data layer is not.
- Settings' currency selector stays DISABLED with its note until rows carry a currency.
  A selector that changes the symbol on unconverted USD numbers is a lie with a dropdown.

## INTERNATIONAL RELEASE — planned, NOT started. Plan: `docs/international-release-plan.md`

Tre wants Forgenta in more countries. **No store setting has been changed, and the
app must be fixed first** — the store change is a checkbox, the app change is the
work, and adding a country before the app is right ships wrong numbers on day one.
Sam agreed the reordering.

**THE LIVE BUG THIS FOUND, fixed:** the Settings currency picker offered USD, EUR
and GBP and **did nothing**. `formatCurrency` takes a currency argument that ZERO
call sites pass, and the only reader of `profile.currency` outside Settings is the
home-screen widget. Now DISABLED with an honest note, **verified on screen**
(`disabled: true`, value `USD`, note rendering).

**Counted, not estimated:** 44 hardcoded `en-US`, 91 `toLocale` sites, 32 pinned
to `en-US`, 19 hardcoded `$`, 0 `formatCurrency` calls passing a currency.

⚠️ **I OVERSTATED THE DATE PROBLEM AND CORRECTED IT.** I first said those 32 sites
render MM/DD/YYYY. They do not: every one passes `{ month: 'short', ... }`, and
there are ZERO bare `toLocaleDateString('en-US')` calls and ZERO numeric month
options. The app renders `Sep 2026`, unambiguous in any locale. The real gap is
**hardcoded English month names** — a translation issue, not a wrong date. This
removes the argument that dates block an English-speaking first tranche. `exportPdf.ts:168` and `notification-policy.ts:307` hardcode
locale AND USD together.

**Decisions Tre has made:** real multi-currency, NOT display-only relabelling.
**Japan is EXCLUDED and decided** — Google requires publishing the business
operator's name, phone and physical address, and he declined. Do not re-ask.

**Still his to decide:** per-currency subtotals or one converted total, and which
rate applies to HISTORY (a payoff projection converted at today's rate differs
from one converted per-transaction, and it compounds over the horizon).

**Next, in order:** thread currency AND locale through `formatCurrency` → the 32
date sites → then countries. Rate-source criteria are in the plan; nothing has
been priced or read, so do not treat any provider as chosen.

## DEV SIGN-IN: Google SSO carries, and the session DOES drop

Tre is signed into Google in the Claude-controlled Chrome, so `/auth` → "Continue
with Google" signs in with **no credential typed**. Worth knowing because the
Supabase session dropped mid-verification today — a probe that read SIGNED IN at
3560s was signed out twenty minutes later. If a page bounces to `/auth`, re-run
that click rather than assuming the dev server broke.

⚠️ `Object.keys(localStorage)` can show `[BLOCKED: JWT token]` instead of the
`sb-*` key. That is the harness redacting, NOT proof of being signed out. Check
where the app actually routes.

## ✅ SHIPPED — the cash-floor warning Tre asked for. `d97f00d4` + `6c3e94fb`.

His ask (2026-08-27, approved, unstarted): *"a mandatory marker on each card is
fine. it just lets the user know a not meeting the cash floor is inevitable and
to check cash floor."*

**Do not build the marker. It already exists.** `accounts.payment_preference`
('statement' | 'full') and `autopayFullBalance` are both live and read all over
`credit-card-engine.ts`. The engine also already computes WHY a month is tight:
`ccMandatoryReasonByMonth` (useCardProjection.ts:1293) names the card whose pinned
statement sized the reserve, and `floor-protection.ts:210` prefers it over its
own heuristics — with a comment recording that the heuristic once reported a
$2,443 Prime Visa reserve as "$200 Pay sibling to watch dogs".

**THE ACTUAL GAP: that reason never reaches the user.** `CreditCardEngine.tsx:763`
builds its OWN local `saveUpMonths` set and the sim's `saveUpReason` map is
rendered nowhere — `grep saveUpReason src/components src/pages` returns nothing.
So the app computes a known-cause explanation specifically to avoid mislabelling,
then throws it away and recomputes a worse one.

So the slice is: surface `cardProjection.saveUpReason` / `saveUpMonths` on the
debt page instead of the local recomputation, and say plainly when the floor
cannot be met because a full-balance card must be paid. Warning first, engine
input second — his own ordering.

⚠️ It is a UI slice on a money page, so it needs a real press, not a green build:
`dev-signin` skill, then look at the page. Do not ship it on tests alone.

✅ **DONE, INCLUDING THE EXACT GAP NAMED ABOVE — and this heading said "NEXT SLICE" until
2026-09-05.** `d97f00d4` built `src/lib/cash-floor-warning.ts`; `6c3e94fb` pinned what a
month-0 shortfall shows, found by pressing the page rather than by a green build.
`CreditCardEngine.tsx:1087` now passes `convergedCardProjection.saveUpReason` into
`buildCashFloorWarning` instead of recomputing a worse reason locally, and the warning renders
at line 1560 behind `data-testid="cash-floor-warning"`. The local `saveUpMonths` recomputation
this section was written to remove is gone.

## iOS CI secrets are being rotated this week (2026-09-03) — what will break

Tre's Apple distribution certificate is being rotated, which invalidates every
provisioning profile built on it. `.github/workflows/ios-build.yml` consumes
`BUILD_CERTIFICATE_BASE64` and `BUILD_PROVISION_PROFILE_BASE64`; **they must be
replaced in the SAME pass.** Update one and not the other and iOS CI goes red on
a signing error that never mentions certificates — expect an hour lost to it
otherwise. Runbook lives at
`claudecontext/security-reviews/2026-09-03_credential-rotation-runbook.md` (Sam's).

App Store Connect keys, read off the live key list 2026-09-03 so nobody re-checks:
- **`VP34CQ3J84`** ("Forged CI") is the LIVE API key — the only active one, last
  used today. It is what `APP_STORE_CONNECT_API_KEY_ID` resolves to. Nothing in
  this tree names it: the workflow builds `AuthKey_${...}.p8` at runtime, so
  rotating is a secrets update, not a code change.
- **`AH86Q9RAQW`** is NOT active. Nothing to revoke; any file of that name is a
  stale artefact.
- **`G77784XFWZ`** ("Forged Subscription") is an ACTIVE in-app purchase key with
  no consumer in this repo. ⚠️ Apple shows DOWNLOADED, not LAST USED, for these,
  so **Apple cannot tell you whether anything uses it** — the only place that
  answers it is RevenueCat's app settings. Revoking it fails SILENTLY
  (subscription status going stale), never as a red build.

When the profile is regenerated, **include the App Group entitlement** — the iOS
widget slice (`docs/ios-widgets-scope.md`, scoped not started) needs it, and it
is free to fold into a regeneration that is happening anyway.

---

## LESSON — what live-pressing found that 3,272 green tests did not

A green suite is not a pressed button. Live UI verification needs the `dev-signin` skill.
The specific findings: `handoff-archive.md`.

## DECISIONS THAT ARE SETTLED — DO NOT RE-OPEN

- **The DATABASE is the truth about "premium".** The webhooks write it; Conductor
  and this cohort READ it. Never a provider API directly.
- **An OG who joined on mobile is MOVED TO A STRIPE-BILLED PLAN** at the
  anniversary; that is how the free year is granted (Tre, 2026-09-02).
- **Churn:** keeps the year if premium within 30 days of the anniversary, or if
  the lapse was a billing failure rather than a choice. `unknown` QUALIFIES —
  ambiguity goes to the customer. Only deliberate-and-stayed-gone forfeits.
- **The follow badges are claim-based ON PURPOSE.** Neither platform will tell a
  consumer app whether someone followed. They gate NOTHING, and the wording says
  "Tapped through to Instagram" because that is the event actually observed.
  Do not "fix" this by wiring it to something real.
- **Both social handles are `@treforged`,** confirmed against sources (see
  `docs/og-cohort.md`), not inferred from the brand name.

## STILL UNBUILT — recorded so a year does not pass with these in a doc only

- **The anniversary job EXISTS and is deployed, but nothing fires it.** No cron
  schedule, and the Stripe grant is unwired — both are live changes waiting on
  Tre. `docs/og-cohort.md`.
- **A mobile OG CANNOT be migrated by us** — a fact about the stores, not a gap.
  Only the user can cancel a store subscription. The ask must go BY EMAIL, never
  in-app (anti-steering). Awaiting Tre. `docs/og-cohort.md`.
- **iOS widgets are unstarted**, scoped in `docs/ios-widgets-scope.md`. Do the
  entitlements/provisioning step FIRST and separately.
- **The Android widget change is unpressed.** Strictly safer than what it
  replaced, so shipping it that way was the right risk — but a device build
  should confirm it when convenient.
- **No user-facing promise copy.** It may now say the year is free. It must never
  name the billing rail — the user is promised a year, not a rail.
- **`ForgentaRedditScout` still points at the dead pre-move path.** Sam hit
  Access denied on it (registered elevated) and it is DISABLED, so it is
  harmless where it sits. The fixed `scripts/setup-scheduler.ps1` repairs it
  whenever it is next wanted.

---

## NEW 2026-09-02 — two product asks routed in by Mona (from Tre's Instagram DMs)

Neither was recorded anywhere until Mona pulled them off Instagram. Both are his
words, verbatim, and both are DESIGN-FIRST — nothing should be built until the
forks below are answered.

**A. REVIEWS, tied to the value moment.** *"research my market and create a plan to
get more reviews. part of that was the app updates which will prompt it after the
ah ha moment(value moment)."*
**IT IS ALREADY BUILT — READ THIS BEFORE PLANNING ANYTHING.** `useInAppReview.ts`
fires the native prompt on the **3rd** qualifying action, once ever, gated on
`localStorage`. The two call sites are `BudgetControl.tsx:731` (a rule saved) and
`SavingsGoals.tsx:724` (a goal created). So this is a TRIGGER-PLACEMENT job, not a
build, and Tre's ask is precisely the criticism of what is there.

✅ **ANSWERED BY TRE 2026-09-02: "first plaid link completing."** So the trigger
moves to the moment a Plaid link succeeds and real balances land — the first time
the app shows him something he did not type in himself. Do NOT ask him again.
⚠️ Note the ordering dependency this creates: native Plaid linking is CURRENTLY
BROKEN (see the Plaid section above), so on iOS this trigger cannot fire until
that is fixed. Wire it anyway — the web/Android path still reaches it — but do not
read "no review prompts on iOS" as this feature failing.

⚠️ **THE CURRENT TRIGGER IS AIMED AT A MOMENT OF WORK, NOT A MOMENT OF VALUE.**
Saving a third budget rule is data entry — the app is asking to be rated right
after making the user do chores. The aha moments in this product are where the
user first SEES something they did not already know: a payoff DATE appearing, the
CC Debt Free milestone firing, a Plaid link completing and real balances landing,
a goal completing. Any of those is defensible; the third row typed into a form is
not. Pick with evidence, not by taste, and note that both stores RATE-LIMIT the
prompt (Apple ~3/year), so a mistimed trigger is SPENT, not retried.

⚠️ **AND THERE IS A REAL DEFECT IN IT, of the silently-wasted kind.** `KEY_DONE` is
written BEFORE `InAppReview.requestReview()` is awaited, and the catch swallows
everything. So if the call throws — or the OS declines to show anything, which it
does routinely and without telling you — the user's ONE shot is already burned and
can never fire again. Some of his existing installs may have spent their prompt on
nothing. Moving the flag after a resolved call is not a complete fix either (Apple
never confirms display), but burning it before the attempt is strictly worse than
after, and the current order cannot be defended.
Also minor: keys are `tre:review:*` where the rest of the app uses the `forged:`
prefix.

**B. FIRST 100 ORGANIC PREMIUM USERS + OG PROGRAMME.** *"we need to push for our
first 100 organic premium users. they should recieve an OGs achievement as well.
after a year, they get a year free just for being an OG. this needs to be
trackable. we also need to make revenue trackable on conductor. i use revenue cat
for mobile and stripe for desktop. note stripe is the only one where i can award
free forever plans. make an acheivement for following the socials, instagram and
tiktok."*

⚠️ **THE LOAD-BEARING CONSTRAINT IS HIS OWN: Stripe is the ONLY side that can award
free-forever plans.** So "a year free after a year as an OG" CANNOT be implemented
symmetrically — a mobile OG on RevenueCat has no equivalent lever. **This is a
MONEY PATH and an entitlement that must still be honourable in twelve months**, so
the answer has to be settled BEFORE any schema lands. Do not pick it by default.
The options, none obviously right: grant the mobile OG a Stripe-side comp that
requires them to move to web billing; issue RevenueCat promotional entitlements
(time-limited, need renewing, so someone must own that in a year); or restrict the
OG offer to Stripe signups and say so up front, which is honest but caps the
programme at desktop users.

SPLIT INTO FOUR, because they estimate very differently and only one is blocked:
 B1. OG achievement + the first-100 counter (needs "organic" DEFINED — it is doing
     real work in that sentence and currently means nothing queryable).
 B2. The year-free entitlement — BLOCKED on the fork above. Money path.
 B3. Revenue tracking surfaced on Conductor — cross-desk, RevenueCat + Stripe.
 B4. Social-follow achievement (Instagram, TikTok) — ⚠️ NOT VERIFIABLE. Neither
     platform exposes "does user X follow account Y" to a third party. So this can
     only ever be self-attested or link-click-attested; say which, visibly, rather
     than shipping an achievement that silently trusts a tap.

Relates to the existing streak/achievements items already in the queue below —
these should be ONE achievements system, not two.

## Resume queue

> **A RESUME ITEM IS A POINTER, NOT A REPORT.** One or two lines and a path to where
> the detail lives. This file is injected into every session that starts at this desk,
> so every character here is a tax paid on every cold start, forever. Closed items move
> to `handoff-archive.md`. If an item needs three paragraphs, those belong in `docs/` or
> in the commit body, and the item points at them.

**STATE, 2026-09-05 ~07:30 ET.** `origin/main` 0/0, verified by CONTENTS after every push.
Eleven commits this window, `0d91028b` through the handoff. Gates green each time:
`npx tsc --noEmit`, `npm run lint` 0 errors, `npm run test:tz` all three zones
(3671 passed, 1 skipped). Brief: `TRE-Forged/OVERDRIVE-getforgenta-2026-09-05.md`.

### 1. ✅ DONE — the `btn` rollout on the dense surfaces, verified in a browser
`b269b6aa` Settings, `51ccaa1d` BankActivity, `30297595` Budget Control.
- **BankActivity:** 17 inline row actions had NO padding and NO target and measured
  **18px** — they are the Confirm / Not this / Ignore controls on bank charges, which are
  money decisions. Now 32px. 283 controls carry `btn` on that surface.
- **Budget Control:** only SEVEN of its 22 were migrated on purpose. `icon-btn`, the
  segmented toggles, the catalog chips and the accordion headers are their own
  vocabularies, and `btn` would repaint them. The six "Add …" actions took `btn` WITHOUT
  `btn-ghost`, so they keep their gold `text-primary` and hover underline.
- **Verified in Chrome on demo data:** no sideways scroll (0px), no clipped labels,
  nothing off the right edge, layout intact in a screenshot.
- ⚠️ **TWO THINGS UNVERIFIED, do not claim them.** This Chrome reports `pointer: fine`,
  so it takes `btn`'s **32px desktop branch** — it says NOTHING about the 44px touch
  value. And the CSS viewport would not go below **657px** (`resize_window` moves the OS
  window, not `innerWidth`), so a true phone width is untested. Both need a real device,
  which is coupled to item 12 and is Tre's.

**THE MEASURING PROBE, so the next session does not re-derive it.** In demo mode
(`/demo`, no credentials) run in the console: collect
`button, a[href], [role="button"], [role="tab"]`, drop zero-sized and hidden ones, and
**keep only elements that are the topmost thing at their own centre**
(`document.elementFromPoint`). That last filter is not optional — without it the count
includes everything behind a `fixed inset-0` overlay, which is how I produced "98% under
44px" before correcting it to "10 of 18 reachable, smallest 30-36px".

### 2. ✅ DONE — item 17, text wrapping. MEASURED CLEAN, nothing to fix.
Swept `/transactions`, `/debt`, `/forecast`, `/vehicles`, `/settings`, `/dashboard` for
leaf elements whose `scrollWidth > clientWidth`. **Zero genuinely clipped strings.**
- ⚠️ The two apparent hits were `sr-only` spans — 1px wide with `overflow: hidden` BY
  DESIGN. A raw `scrollWidth > clientWidth` check flags accessibility markup as a bug, so
  **check `overflow-x` before calling anything clipped**; with `overflow: visible` the
  text spills and is perfectly readable.
- Same 657px caveat as item 1. If a real device ever shows wrapping trouble, re-run the
  sweep there rather than re-reading the CSS.

### 3. ✅ MOSTLY DONE — ONBOARDING and the review prompt. READ THIS BEFORE REBUILDING.
Two of the three halves were ALREADY SHIPPED before this session, and a cold session that
skips this paragraph will rebuild them:
- **The review prompt already fires on the VALUE MOMENT, not on activity.**
  `src/lib/review-moment.ts` replaced a "third positive action" counter (whose two call
  sites were the user doing WORK FOR the app) with real value events, including
  `first_positive_projection` — the "oh, I am actually fine" moment. Wired through
  `useValueMoments` on the Dashboard. **That IS the ah-ha trigger Tre asked for.**
- **Onboarding already ends on a real outcome**, not a tour: take-home, expenses, debt,
  goals and available-after-expenses, computed from what the user just entered.
- **The measurement gap is now CLOSED** (`821dc985`): `profiles.onboarding_furthest_step`
  + `onboarding_started_at`, monotonic, compared inside the user's own flow. The funnel is
  `select onboarding_furthest_step, count(*) from profiles where onboarding_started_at is
  not null and not onboarding_completed group by 1;`
- **What is genuinely left** is a PRODUCT judgement, not code: read that funnel once real
  users are in it and decide which step to cut. Do not guess before the data exists.
- Still open from the same ask and NOT started: "research my market and create a plan to
  get more reviews" — that is marketing research, likely Ruby's, not this repo's.

### (superseded) Item 7 — ONBOARDING, and the review prompt WITH it (Sam, 2026-09-05)
"Onboarding = value, not explain every feature." The **ah-ha moment is the trigger for
both** the first real outcome and the in-app review prompt, so build them together
rather than twice. A review prompt fired before the value moment burns the one chance
at a rating, so **the prompt's timing is the deliverable, not the dialog**. Conversion
is the metric, so whatever ships must be measurable against it.
`src/lib/review-moment.ts` and `useInAppReview` already exist — READ THEM FIRST.

### 4. ✅ MOSTLY DONE — the OG cohort. ⚠️ ONE DECISION IS TRE'S AND IT REFRAMES HIS ASK.
`e9c4bd8c`. Read this before touching anything OG-shaped.

**THE STREAK GRANT DOES NOT REUSE HERE, and it looked like it would.** The streak comp
goes to somebody who is NOT paying. The OG free year goes to somebody who IS. Writing a
comped `user_subscriptions` row over an active paid subscription would erase their real
subscription state AND not stop Stripe charging them — recording as free a person still
being billed. The free year genuinely needs a Stripe-side 100% discount so the CHARGE
stops, which is a real action on Tre's live account and **his to authorise**.

**⚠️ FOR TRE, AND IT CHANGES HIS OWN ASK: the "first 100 organic premium users" push
starts from ZERO, not five.** `claim_og_place()` tested organic as "has a
stripe_subscription_id or a revenuecat_app_user_id" — the exact heuristic
`20260905_subscriptions_is_comp.sql` disproved hours earlier, since a 100%-discount
subscription carries a real id. So the seat test admitted precisely the accounts the
cohort excludes, and **all 5 current `og_members` carry `is_comp = true`**. Fixed for
FUTURE seats; the 5 existing rows are deliberately untouched, because they were
backfilled on his direct instruction and removing somebody from a cohort is his call.
`select * from public.og_cohort_integrity();` reports it: members / comped_members /
seats_left / earliest_reward_due / rewards_due_now.

**NOTHING IS DUE UNTIL 2027-03-26**, so wiring the Stripe grant is not urgent and should
not be done speculatively against a live payment provider.

**The social-follow badge is COSMETIC and it is PROVEN, not chosen.** A user holding
`follow_instagram` + `follow_tiktok` and no lessons has `streak_days_for() = 0` and
`claim_streak_reward()` refuses. Keep it that way: those ids are client-mintable.

**Still genuinely unbuilt:** moving a live RevenueCat subscriber to Stripe without losing
access mid-switch. `docs/og-cohort.md` says so and it is still true.

### 5. ✅ DONE 2026-09-05 — the i18n scaffold plus Spanish on Landing. `c9643e6c`.
`f21d4d00` did the international plan's own STEP 1 first: **the currency picker now changes
the numbers.** `setMoneyDisplay()` had existed in `calculations.ts` — exported, documented,
with `getMoneyDisplay`/`resetMoneyDisplay` beside it — and NOTHING outside the tests had
ever called it, so all 446 `formatCurrency` sites printed USD whatever the profile said.
Shipping Spanish on top of that would have added a second language to the same wrong number.
- **Shipped:** `i18next` + `react-i18next`, `src/lib/i18n.ts`, catalogues at
  `src/locales/<lang>/<namespace>.json`, a `LanguageSwitcher` on the SIGNED-OUT Landing page
  and in Settings, and the `landing` namespace complete in Spanish (47 keys, including the
  store-badge `aria-label`s and `alt` texts a JSX-only pass misses).
  Gates: `test:tz` 3709 passed in all three zones, `tsc` clean, lint 0 errors. Nine new tests
  PRESS the switcher and were mutation-checked (3 go red when `changeLanguage` is neutered).
  Verified in Chrome, not only jsdom: `<html lang>` flips, the choice survives a reload, the
  footer year interpolates, horizontal overflow 0px.
- **Also in that commit: the currency picker is RE-ENABLED**, on the condition its own
  2026-09-03 disable note set — `f21d4d00` had already connected `MoneyDisplaySync` and the
  control was still off two commits later.
- ⚠️ **Arabic/RTL is the NEXT i18n slice and is still separate.** `dir` is set on `<html>` and
  `SUPPORTED_LANGUAGES` carries a `dir` field, so the plumbing exists — the work is mirroring
  the layout. Do not start it at the tail of a window.
- ⚠️ **A surface is all-or-nothing.** A half-translated screen is worse than an English one, so
  the next surface is a new namespace file per locale; nothing in `i18n.ts` changes.
- ⚠️ **A font-size class on ANY select in this app is inert.** `index.css:845` forces
  `font-size: 16px !important` on every input, textarea and select, because anything smaller
  makes iOS Safari zoom the page on focus.
- The 32 `toLocaleDateString` sites are NOT a blocker: they pass textual options, so they
  render `Sep 2026` — unambiguous everywhere, just English month names. The plan's own
  correction says so; do not re-derive it.

### 6. ✅ DONE — item 18, the reel. Audit in `docs/mobile-ux-rules-audit.md`.
`b8628837`. Read with `yt-dlp --skip-download --dump-json` — metadata only, nothing
downloaded, installed or run.
- **Built:** rule 9, tapping the active tab returns to top. ⚠️ The scroller is `#scroll-main`,
  NOT the window — a fix aimed at `window` looks right and is inert.
- **⚠️ The real finding, PROPOSED NOT BUILT — rule 13.** `registerForPush()` fires from
  `AuthContext` ON SIGN-IN, so the OS notification prompt appears before the user has seen
  anything worth being notified about. On iOS that prompt is a ONE-SHOT resource, exactly as
  `review-moment.ts` documents for reviews. Move it behind the first notification-shaped
  intent; keep the sign-in path only where `checkPermissions` already returns granted. Its
  own slice, because it changes a permission flow.
- **REJECTED on purpose:** rule 11, "update immediately then sync". Right for a like, wrong
  for money — an optimistic balance that fails to write shows a false number. Do not "fix"
  the current behaviour.
- Still open: rule 14 (sheets do not dismiss on swipe-down; they DO on backdrop and X).

### ✅ RULE 8, SCROLL RESTORATION — SHIPPED 2026-09-05, `0982aa18`. Verified in a browser.
The four measured constraints below were all correct and all insufficient. **The fifth was one grep
away: `App.tsx` mounted a `ScrollToTop` that ran `scrollTo(0,0)` on EVERY pathname change, POP
included**, so the restore was racing an explicit scroll-to-top on the same element in the same
commit. Nothing in the original hook was wrong. `ScrollToTop` now skips POP.
Two more found only by measuring: **the live `scrollTop` read inside the cleanup is ALREADY STALE**
(the person was at 800, the cleanup read 10, because the outgoing content shrinks and the browser
clamps first — 10 is non-zero, plausible and wrong, so the save takes `max(live, lastGesture)`);
and **`requestAnimationFrame` does not fire in a hidden tab**, so an rAF-only retry schedules itself
and does nothing, indistinguishable from working.
⚠️ **A THIRD TARGET FOR THE CALLER GREP: a SECOND WRITER to the same object.** Not code with no
caller, not a document with no code — two things writing the same DOM property.
The historical detail below is kept because its four facts are still true.

<details><summary>The original attempt, reverted — its four facts still hold</summary>

Written, 8 tests green, **and it did not work in the browser three times running.** Reverted
rather than pushed, because a feature nobody has seen work is the thing this desk keeps
finding in other people's code. The WIP is at
`…/scratchpad/scroll-restoration-wip/` (session 94435eb0); it is a starting point, NOT a
working thing.

**What is already established, so nobody re-derives it:**
- ✅ The scroller is `#scroll-main` (`DashboardLayout`), NOT the window. `main` carries
  `overflow-y-auto`, so `window.scrollY` is permanently 0.
- ✅ Navigation type detection WORKS. Verified in the console: REPLACE on landing, PUSH on a
  tap through, **POP on `history.back()`** — restore only on POP is correct and it fires.
- ✅ **`scrollTop` CLAMPS SILENTLY.** Assign 400 to a container still 600px tall because its
  data has not arrived and you get 0, no error. The Dashboard only reaches `scrollHeight`
  2517 once its queries resolve, so restoring after N frames is wrong — wait for the
  CONDITION (`scrollHeight - clientHeight >= saved`) with a deadline.
- ✅ **A PROGRAMMATIC `scrollTop` ASSIGNMENT FIRES NO `scroll` EVENT.** Measured: 0 events for
  an assignment the element accepted and read back as 400. So a saved offset tracked from a
  scroll listener misses every non-gesture move. Read `el.scrollTop` in the effect CLEANUP
  instead — no listener, nothing to miss.
- ❌ **STILL UNEXPLAINED:** with all of the above fixed, the offset still comes back 0 after a
  POP. Next step is to log inside the cleanup and confirm whether `el` there is still the
  mounted scroller, and whether `DashboardLayout` remounts across the navigation.
- ⚠️ **The jsdom harness cannot see any of this** — `scrollHeight`/`clientHeight` are 0 and
  `scrollTop` does not clamp, so tests pass against all four failures above. The WIP test file
  models height and clamping deliberately; keep that.

</details>

### 7. Housekeeping that is now DONE — do not redo
- ✅ The `handoff_hook` auto-snapshot bug is FIXED. It was appending a block per run:
  SEVEN had accumulated, 6 BEGIN markers against 7 ENDs, because the oldest had lost its
  BEGIN and `split(END, 1)[1]` then carried every later block back in. Proved on a copy
  of the real 82 KB file: 7 blocks to 1, idempotent over three runs, prose byte-identical.
- ✅ 14 CLOSED sections moved to `handoff-archive.md`.
- ✅ The `toISOString()` sweep is COMPLETE. Every client date-write already uses
  `toLocalDateStr`; the two remaining sites (`reddit-scout`'s cron run date,
  `_shared/learn-streak.ts`'s `addDaysKey`) are correct BY DESIGN and documented as such.
  **Do not "fix" them.**
- ⚠️ `.vercelignore` is still UNTRACKED ON PURPOSE. Committing it changes what
  git-integrated PRODUCTION builds see and no gate has been run on that. It is not junk.
  `.claude/settings.json.bak-deadpath-20260903`, `deno.lock` and
  `.github/workflows/handoff.md` are also untracked and each needs a deliberate decision.

### 7b. ⚠️ TWO STANDING HAZARDS on this database — check these every time
- **`user_subscriptions` has NO FOREIGN KEY to `auth.users`.** Deleting a user leaves the
  subscription row behind, and an orphan reads as REVENUE in
  `revenue_summary_lines()`. I stranded one this morning with a probe. So: after ANY
  probe that writes a subscription, re-run `select * from public.revenue_summary_lines();`
  and confirm it is byte-identical to before. This is a standing hazard, not a one-off.
- **A trigger's `UPDATE OF <columns>` list is a separate object from its function.** The
  OG seat fix was a silent no-op until `is_comp` was added to
  `user_subscriptions_claim_og`'s column list — the function body was right and the thing
  deciding WHEN it runs was elsewhere. When a trigger function starts reading a new
  column, change the trigger too, and prove it by writing that column alone.

### ⬜ THE SIGNED-IN VERIFICATION PASS — `docs/signed-in-verification-pass.md`
Four checks, in press order, that CANNOT be done from demo or signed out: BankActivity's
"Link and correct $X → $Y" (money — do it first), `GoalLumpSumPanel`'s auto-extra guard, the
identity badge in partner view, and back-from-a-deep-link. Written 2026-09-06 because three slices
shipped that day unverified for the same reason. ⚠️ Record results BY NAME, and write "not
reachable" rather than "passed" for anything that could not be run.

### ⛔ THE FOUNDER BADGE CLAIMED A PAYMENT NOBODY MADE. Wording fixed; THE DATA IS TRE'S CALL.
Measured 2026-09-06: **3 live accounts hold `og_founder`, all minted in the SAME INSTANT on
2026-09-03 20:24:25** — a backfill, not three organic events — and **none has a non-comp
subscription**. **`og_members` holds 0 rows**: the 2026-09-05 "OG place requires real money"
tightening emptied it correctly (a 100%-off subscription is not a purchase) and the badges were
left behind. The Trophy Case shipped that day was therefore telling three real people *"One of the
first hundred people to PAY for Forgenta"*, which its own database contradicts.
Wording now claims nothing about payment. ✅ **SETTLED BY TRE, 2026-09-06 (via Sam): KEEP THE BADGE, DO NOT
BACKFILL `og_members`.** Do not re-open it — `og_members` reading 0 is correct and is not evidence
against the badge now that the description claims nothing about payment.
⚠️ **AND THE WHOLE OG MACHINERY HAS NOTHING TO ACT ON.** `og_members` 0, `og_billing_consent` 0,
`og_consent_tokens` 0, `og_anniversary_runs` **0 — it has never run**. Turning the consent cron on
today would email nobody. The queue item "OG surfaces not built" is stale: the gate, the web
confirmation page and the email are all built; what is missing is members.

### ✅ STALE QUEUE LINE CORRECTED: `useLumpSumTransfers` was ALREADY REMOVED on 2026-09-05,
with a tombstone at `useSupabaseData.ts:510` explaining why (0 rows, 0 users, no writer, no
reader). The table is kept deliberately — empty makes keeping it free and dropping it permanent.
Nothing to do here.

### ✅ RECONCILIATION IS WIRED — and the MATCHING half was already built. NOT browser-verified.
⚠️ `transaction-reconciliation.ts` had **zero callers** — my own work failing this repo's own
caller-grep gate. Wiring it found the more important thing: **`bank-activity-queue.ts` has paired
bank charges to hand-typed ledger rows for ages** (the `ledgerTxn` suggestion). What was missing was
never the match. Accepting one writes only a POINTER (`status: 'linked_txn'`), so **the typed figure
survives untouched — $50 typed, $52.30 charged, rows linked, ledger keeps $50 for ever.**
Now: `describeReconciliation` (extracted so the screen and the matcher cannot disagree about the
same two numbers) surfaces the gap, the row's button reads **"Link and correct $50.00 → $52.30"**
showing BOTH figures before the press, and accepting also patches the ledger row.
⚠️ **"Accept all suggested" now EXCLUDES discrepant rows** — `isBulkAcceptable`. Its stated
invariant is that it *cannot create money*, and linking in bulk without correcting would leave the
wrong figure under a button the person believes settled it. Tested and mutation-checked.
⚠️ **NOT VERIFIED IN A BROWSER, AND THIS IS A MONEY SURFACE.** `BankActivity` does not mount in
demo (no synced charges), and the sign-in is gone. The page was confirmed to render with **no
runtime errors and no error boundary**, but the new control was never seen. **First thing to check
when the sign-in is back.**

### ✅ LUMP-SUM AUTO-EXTRA GUARD — THE TEST WAS ALREADY GREEN AND HONEST; THE GAP WAS A SURFACE.
⚠️ **The handoff said "test written, guard not built". Both halves were wrong.**
`forecast-engine.lumpSumDoubleCount.test.ts` passes 5/5 and is mutation-checked, and it MEASURED
that Tre's stated reason does not hold: with auto-extra on, a lump sum drops auto-extra by exactly
its own amount and **ending cash is unchanged to the cent**. There is no double-count. The rule is
kept for the reason he did not give — with the sweep on, the control is **inert**, which is the
"control that lies" shape from the other direction.
**The real gap was that only ONE of the two lump-sum panels had the guard.** `LumpSumPanel`
(vehicles) had it and both callers passed it; `GoalLumpSumPanel` on the Savings Goals page did not,
and that page did not mention `auto_extra` anywhere. Now shared through `src/lib/lump-sum-guard.ts`
so the two surfaces cannot describe the same rule differently.
⚠️ **NOT verified in a live browser**: `GoalLumpSumPanel` renders only when `!isDemo`, and this
desk's sign-in is gone. jsdom is legitimate here (a `disabled` attribute, no geometry) but it is
not the app. ⚠️ **And the test renders the component directly, so it CANNOT catch the call site
dropping the prop** — that wiring is verified by a deliberate-typo tsc probe and by reading only.

### ✅ NAV ITEM 3 — BACK ON PUSHED SCREENS, SHIPPED `b43e1bb1`. One case NOT browser-verified.
`BackButton.tsx`, `src/lib/nav-back.ts`, `src/lib/nav-routes.ts`. Pressed at 390px:
`/dashboard` IDENTITY (idx 0) → Settings BACK 44×44 at left=9 (idx 1) → press → `/dashboard`
IDENTITY (idx 0). **Back REPLACES the identity badge because the gap between the badge (ends x=90)
and the centred wordmark (starts x=110) is 19px** — measured, not chosen. ⚠️ **The fresh-entry
fallback is NOT browser-verified**: loading `/settings` directly while signed out redirects to
`/auth`. Mutation-verified unit tests only.

### ⚠️ THE DEV SIGN-IN WENT AWAY AT ~21:42 ON 2026-09-05, MID-SESSION.
`localStorage` lost its `sb-*-auth-token` between a successful measurement at 21:29 and the next at
21:42; the tab is now on `/auth`. Cause unknown — do NOT blame the measuring iframe without
evidence. **`/demo` needs no credentials and renders the same chrome**, which is how nav item 3 was
verified, so this only blocks checks that need Tre's REAL data. `dev-signin` skill: sign-in is
manual once, in the Claude-controlled Chrome, at `http://localhost:8080` and no other origin.

### ⛔ THE FUNNEL: THE PAYMENT STEP IS NOT WHERE IT FAILS. READ BEFORE ANY PRICING WORK.
`docs/checkout-funnel-2026-09-06.md` (`ad408802`). 31 signed up → 12 set an income → 4 recorded a
transaction → **2 linked a bank** → 5 external people ever opened a checkout → 3 ever saw $89.99
→ **0 ever paid it**. 39 sessions in all history, **31 of them Tre's own two emails**; last one
**2026-05-18**, and 11 people have signed up since without opening one. **Bank linking is
premium-gated (`plaid-create-link-token/index.ts:83`), so 29 of 31 have been asked to pay $89.99
for a feature they have never seen work, with no trial to see it with.** Checkout itself is NOT
broken — 8 sessions completed through the same code. ⚠️ Do not quote
`onboarding_completed` (a FLOOR, two completion stores). ⚠️ **CORRECTION:** I first wrote that
`onboarding_started_at` / `onboarding_furthest_step` are "written by nothing" — FALSE.
`recordFurthestStep` (`Onboarding.tsx:98`) writes both and shipped 2026-09-05 in `821dc985`; the
columns are empty because there have been NO SIGNUPS since. I made that error by piping a
multi-pattern grep through `head -20`, where `onboarding_completed`'s 30 hits hid the other two. ⚠️ `profiles` has 49 rows for 31 users — 18 are
orphans with no `auth.users` row, so it is never a headcount. **Commission programme SHELVED by
Sam on this evidence.**

### ✅ `profiles.is_premium` — A DEAD COLUMN, NOT A COMPETING TRUTH. FIXED, `d785fbfe`.
`user_subscriptions` is authoritative (`SubscriptionContext.tsx:56`). **Nothing reads or writes
`profiles.is_premium`** — checked across `src/`, `supabase/`, `pg_policies`, `pg_proc`, `pg_views`.
Backfilled (2 rows), commented as derived/deprecated, and the migration asserts itself. NOT
dropped: irreversible, and a person's call. Undo is in the migration header.

### ✅ IDENTITY AFFORDANCE — nav item 1, SHIPPED `dfb058ce`, one half of acceptance UNMET
`IdentityBadge.tsx` + `src/lib/identity-badge.ts`. Measured 70×44 at left=9, 390px, real account.
⚠️ **The partner-view frame was never obtained** — no partner is linked to Tre's account, so that
state is unreachable on real data. Unit tests cover it (the unnamed-partner case is
mutation-verified); a unit test is not a rendered frame. Do not record it as visually verified.

### ⛔ COMMISSION PROGRAMME — STAGE 1 DONE, AND IT STOPS STAGE 2's PREMISE
`docs/commission-stage-1-numbers.md` (2026-09-06). **Lifetime gross revenue is $4.99 and it is
Tre's own card** — one charge ever, 0 refunds, 0 disputes. All 8 live subscriptions redeem the
100%-off-forever coupon `8G9evoSQ` (`times_redeemed: 8`). Prices are $9.99/mo and $89.99/yr;
**`subscription_tiers` says $9/$90 and is stale — do not quote it.** There is no web trial, so
"trial-to-paid" has no funnel. ⚠️ `is_comp` and `purchase_provider` are COLUMN DEFAULTS on all
11 rows — never read them as facts. Stage 2 was not started: a percentage payout is currently a
percentage of zero, and that is Sam's call to make before design work continues.

### 8. Still open from earlier, unchanged
- Chase Pay Over Time modelled as free (section above) — money surface, not started.
- Push notification SENDER (section above) — storage half built.
- Multi-currency — PARKED deliberately, decision made, do not re-argue.
- The cash-floor warning slice (section above) — scoped and ready.

### BLOCKED ON TRE'S OWN HANDS — do not burn time rediscovering
Plaid iOS TestFlight tap + 24h log read; the auto-dedupe re-link proof; item 11
distribution (staging is NOT blocked, only the submit click); item 12 iPhone testing;
item 4 fixture recapture (needs a mid-month day, the 10th-20th); item 23(a) iOS
WidgetKit (coupled to item 12; Android widgets already exist).

### LESSON FROM THIS WINDOW, and it generalises
**A hole is worth what the NEXT feature makes it worth.** `achievements.earned_at` was
client-supplied and worth nothing until the streak started paying Premium — then it was
a free month. Written up in `docs/og-cohort.md`. Two companions: a correct error handler
is not evidence the constraint exists (the 23505 branch had never fired because no unique
index existed), and a policy must be tested AS THE ROLE THAT WOULD ATTACK IT — the first
probe ran as `postgres` and proved nothing, because a SECURITY DEFINER trigger had made
`current_user` the function owner.

<!-- AUTO-SNAPSHOT:BEGIN - machine-written, replaced each compaction -->
## Auto-snapshot

_Written 2026-09-07 22:42 by handoff_hook. Everything below this heading is
machine-generated and replaced each time; put durable notes above it._

- **Branch:** `main`
- **vs upstream:** 0 ahead, 0 behind

- **Working tree:** clean

- **Recent commits:**

```
46ab5ac5 docs(handoff): both notification defects, and the two shapes worth carrying
e912e509 [notifications]: one event could become several, because every gate reads a history written too late
1d9d27e2 [notifications]: the tap handler watched a channel that has never fired once
1e7fecd9 docs(plaid): re-measured a day on - the ledger placeholder is now stale, not just approximate
d9a79e44 [purchases]: "logIn() is never called" was recorded as a defect and is correct behaviour
787b9749 docs(handoff): the source-sweep test shape, which generalises past charts
cbbd489f [charts]: a tap selected nothing on five charts, and the fix existed in a sixth
fee8a637 fix(backup): a line on every run, and a real exit code
```

<!-- AUTO-SNAPSHOT:END -->
