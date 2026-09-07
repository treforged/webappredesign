import type { TouchEvent as ReactTouchEvent } from 'react';

/**
 * MOBILE TAP DID NOT SELECT A POINT ON ANY CHART, EVEN THOUGH MOUSE HOVER ALWAYS HAS.
 *
 * Recharts only turns finger MOVEMENT into a selected tooltip point — `touchEventsMiddleware`
 * wires `setMouseOverAxisIndex` to `touchmove` alone, never to `touchstart`. A stationary tap,
 * the normal way anyone touches a chart on a phone, is a `touchstart` immediately followed by a
 * `touchend` with no `touchmove` between them, so nothing is ever selected. A mouse gets the same
 * first-contact selection for free, because merely entering the chart already fires `mousemove`
 * and that alone picks the nearest point — no drag required.
 *
 * Replaying the tap's own touch list as a `touchmove` on the same element, at the moment of
 * `touchstart`, gives a tap the same immediate selection a mouse gets. `onTouchStart` is a
 * documented Recharts chart prop (`ExternalMouseEvents.onTouchStart`), so this stays inside
 * Recharts' own event API rather than reaching into its internal Redux store.
 *
 * ⚠️ AND SAFARI DOES NOT IMPLEMENT THE `TouchEvent` CONSTRUCTOR — WHICH IS WHY THE FIRST VERSION
 * OF THIS FIX TOOK THE WHOLE CHART DOWN ON THE ONE PLATFORM IT WAS WRITTEN FOR.
 *
 * `TouchEvent` EXISTS on iOS Safari, so a `typeof TouchEvent === 'undefined'` guard lets it
 * through; `new TouchEvent(...)` then throws `TypeError: Illegal constructor`. The throw escaped a
 * React touch handler, the `ErrorBoundary` wrapping the chart caught it, and the chart vanished —
 * so on iOS "tap a point" did not fail to select, it DELETED THE GRAPH. jsdom implements the
 * constructor, so no test in this repo could see it.
 *
 * Two things follow, and both matter:
 *  1. THE REPLAY CAN NEVER THROW. A tap that cannot be replayed must leave the chart standing.
 *  2. THERE IS A REAL FALLBACK, not just a swallowed error. Recharts selects on `mousemove` too —
 *     that is the mouse path this whole comment is about — so a synthetic `mousemove` at the
 *     touch's own coordinates reaches the same machinery without constructing a `TouchEvent` at
 *     all. Safari implements `MouseEvent` as a constructor, universally.
 *
 * Lives here rather than in one chart because five surfaces need it and only one had it:
 * `LiabilityTrajectoryChart` (where it was written), plus the credit-card engine, the net-worth
 * trend, the forecast charts, the loan card and the savings-goal projection. A second copy would
 * be a second chance to reintroduce the Safari crash above.
 *
 * Pass it straight to a Recharts chart: `<LineChart onTouchStart={selectPointOnTouch}>`.
 */
export function selectPointOnTouch(_state: unknown, event: ReactTouchEvent<SVGGraphicsElement>): void {
  const touches = event.touches;
  const target = event.currentTarget;
  if (!touches || touches.length === 0 || !target) return;
  const { clientX, clientY } = touches[0];

  try {
    if (typeof TouchEvent === 'function') {
      // React's `Touch` type is a narrowed view of the DOM's own `Touch` — the runtime objects in
      // `touches` ARE real `Touch` instances (React wraps, it does not reconstruct), so this is a
      // type-only widening, not a runtime lie.
      target.dispatchEvent(new TouchEvent('touchmove', {
        touches: Array.from(touches) as unknown as Touch[],
        bubbles: true,
        cancelable: true,
      }));
      return;
    }
  } catch {
    // Safari: the interface is there, the constructor is not. Fall through to the mouse path.
  }

  target.dispatchEvent(new MouseEvent('mousemove', {
    clientX, clientY, bubbles: true, cancelable: true,
  }));
}
