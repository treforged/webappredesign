/**
 * WHEN to ask for a review. Pure, so the decision can be tested without a store or a device.
 *
 * THE PROMPT IS A ONE-SHOT RESOURCE. Both stores rate-limit `requestReview` hard — iOS allows a
 * handful per year per user and silently shows nothing beyond that; Android's is quota-based and
 * equally silent. So a prompt spent at the wrong moment is not merely ineffective, it is GONE,
 * and the app cannot tell that it was wasted.
 *
 * WHAT THIS REPLACED, and why it was wrong. `useInAppReview.ts` counted "positive actions" in
 * `localStorage` (`tre:review:actionCount`, threshold 3) and fired on the third one of any kind.
 * Its two call sites were creating a budget rule and creating a savings goal — both of which are
 * the user doing WORK FOR THE APP, not the app giving the user anything. Asking someone to rate
 * you immediately after they finish typing in their third form is asking at the moment of highest
 * effort and lowest payoff.
 *
 * A VALUE EVENT is the opposite: a moment the app has just handed the user good news that is
 * TRUE and that they did not have before. The four below are the only ones that qualify today,
 * and each one is a fact rather than an activity count.
 *
 * ⚠️ Never add an event here that can fire on bad news, or on a projection that has not happened.
 * Prompting the user in the same second they learn they are short is how an app earns one star.
 */

export type ValueEvent =
  /** A savings goal actually reached 100% — banked, not projected. */
  | 'goal_reached'
  /** A debt hit zero. The single loudest good-news moment this app has. */
  | 'debt_cleared'
  /**
   * The first time the app can show a complete, positive picture: accounts linked, forecast
   * computed, and the projection above the floor. This is the "oh — I am actually fine" moment,
   * and it is the only one on the list a brand-new user can reach in their first session.
   */
  | 'first_positive_projection';

export interface ReviewState {
  /** ISO timestamp of the prompt already spent, or null if we have never asked. */
  promptedAt: string | null;
  /** Value events already seen, so the same fact cannot be counted twice. */
  seenEvents: ValueEvent[];
}

export interface ReviewDecision {
  shouldPrompt: boolean;
  event: ValueEvent | null;
  /** Why, in words — this is what a log line or a test failure has to read. */
  reason: string;
}

/**
 * Loudest first. A user who has just cleared a debt AND crossed a projection in the same render
 * is asked on the debt, because that is the one they will remember while the dialog is open.
 */
const PRIORITY: readonly ValueEvent[] = [
  'goal_reached',
  'debt_cleared',
  'first_positive_projection',
];

/*
 * A fourth event — "the month ENDED above the floor" — belongs on this list and is deliberately
 * NOT here yet: nothing in the app currently records a closed month's outcome, and declaring an
 * event no caller can emit is the same dishonesty as a gauge that draws a zero it never read.
 * Add it with the code that can actually detect it.
 */

/*
 * ── EVALUATED 2026-09-07 AGAINST A COMPETITOR TACTIC, AND THIS FILE ALREADY WINS ────────────────
 *
 * Ruby routed a teardown recommending the review prompt move OUT of onboarding and into the end of
 * the activation flow, so it is asked once the user has seen real value from their own data.
 * Teardown: `tre-forged-marketing/docs/evidence/2026-09-07_app-store-reviews-reel-teardown.md`.
 *
 * That is exactly what the three events above already are, and by construction rather than by
 * placement: `goal_reached` and `debt_cleared` are banked facts, and `first_positive_projection`
 * needs linked accounts plus a computed forecast. **None of them is reachable during onboarding**,
 * so there is nothing to move.
 *
 * Two of the teardown's supporting details are NOT applicable, and it is worth saying why so the
 * next reader does not try:
 *  - **Extra animation and haptics to interrupt the reflex "Not now" tap** cannot be done. This
 *    calls `InAppReview.requestReview()`, the OS dialog. Neither platform lets an app decorate,
 *    delay or detect it — that advice applies to a CUSTOM pre-prompt, not to the system one.
 *  - **Its Apple-policy claim** ("prompts in onboarding are no longer allowed") was explicitly
 *    unverified by Ruby, and it does not matter here either way, because we never prompt there.
 *
 * ⚠️ **THE ONE GENUINELY ADDITIVE IDEA, DELIBERATELY NOT BUILT: a custom pre-prompt.** Asking
 * "enjoying Forgenta?" first, and only calling `requestReview()` on a yes, would protect the
 * one-shot this file exists to ration — a user who would have left three stars never spends it.
 * That is a real gain and it is not an A/B optimisation, so low traffic is not an argument against
 * it. It is unbuilt because it is speculative product work with 2 users active in 7 days, not
 * because it is wrong. Build it when there is traffic to spend the prompt on.
 */

/** Runtime list of the valid events. Separate from the type on purpose — a union has no runtime
 *  form, so anything validating parsed input has to check against a real array. */
const ALL_EVENTS: readonly string[] = PRIORITY;

export function decideReviewPrompt(
  candidates: readonly ValueEvent[],
  state: ReviewState,
  _now: Date,
): ReviewDecision {
  // Spent. Never ask twice: the second ask is invisible to the user and burns the store's quota.
  if (state.promptedAt !== null) {
    return { shouldPrompt: false, event: null, reason: 'already prompted' };
  }

  // A fact that has already been seen is not news. Without this, re-opening the dashboard would
  // re-offer the same "first positive projection" every mount.
  const fresh = candidates.filter(candidate => !state.seenEvents.includes(candidate));
  if (fresh.length === 0) {
    return { shouldPrompt: false, event: null, reason: 'no new value event' };
  }

  const chosen = PRIORITY.find(event => fresh.includes(event));
  if (!chosen) {
    // Unreachable while `fresh` only holds ValueEvents, and deliberately not an exception: a
    // review prompt must never be the thing that breaks a page.
    return { shouldPrompt: false, event: null, reason: 'no recognised value event' };
  }

  return { shouldPrompt: true, event: chosen, reason: `value event: ${chosen}` };
}

/** Immutable. A repeated event is not appended twice — `seenEvents` is a set in list clothing. */
export function recordEvent(state: ReviewState, event: ValueEvent): ReviewState {
  if (state.seenEvents.includes(event)) return state;
  return { ...state, seenEvents: [...state.seenEvents, event] };
}

export function recordPrompt(state: ReviewState, now: Date): ReviewState {
  return { ...state, promptedAt: now.toISOString() };
}

/**
 * Tolerant parse. Anything unrecognised reads as "never prompted, nothing seen".
 *
 * Failing OPEN is right here, unlike in `notification-prefs.ts` where failing open means talking
 * to someone who asked for silence. The worst case here is one extra prompt to a user whose
 * stored state was corrupt, and the stores' own rate limits are the backstop.
 */
export function parseReviewState(raw: unknown): ReviewState {
  const empty: ReviewState = { promptedAt: null, seenEvents: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return empty;

  const obj = raw as Record<string, unknown>;
  const promptedAt = typeof obj.promptedAt === 'string' ? obj.promptedAt : null;

  const seenEvents = Array.isArray(obj.seenEvents)
    ? obj.seenEvents.filter((item): item is ValueEvent =>
        typeof item === 'string' && ALL_EVENTS.includes(item))
    : [];

  return { promptedAt, seenEvents };
}
