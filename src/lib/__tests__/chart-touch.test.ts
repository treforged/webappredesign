// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { selectPointOnTouch } from '../chart-touch';

// Recharts selects a tooltip point on `touchmove` only, never on `touchstart`, so a stationary tap
// — the normal way anyone touches a chart on a phone — selects nothing. `selectPointOnTouch`
// replays the tap as a touchmove so a finger gets what a mouse gets for free.
//
// The Safari case below is the one that matters most: it is not a missing feature, it is a CRASH
// that deleted the whole chart on iOS.

function touchEvent(el: Element, x = 10, y = 20): ReactTouchEvent<SVGGraphicsElement> {
  return {
    touches: [{ clientX: x, clientY: y }] as unknown as ReactTouchEvent<SVGGraphicsElement>['touches'],
    currentTarget: el,
  } as unknown as ReactTouchEvent<SVGGraphicsElement>;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('selectPointOnTouch', () => {
  it('replays the tap as a real touchmove, which is what recharts listens for', () => {
    const el = document.createElement('div');
    const seen: string[] = [];
    el.addEventListener('touchmove', () => seen.push('touchmove'));
    selectPointOnTouch(null, touchEvent(el));
    expect(seen).toEqual(['touchmove']);
  });

  // ⚠️ THE CRASH. Safari HAS `TouchEvent` as an interface but NOT as a constructor, so the guard
  // lets it through and `new TouchEvent(...)` throws `TypeError: Illegal constructor`. That throw
  // escaped the React handler, the chart's ErrorBoundary caught it, and the graph VANISHED — a tap
  // did not fail to select, it deleted the chart. jsdom implements the constructor, so this must be
  // simulated or no test in this repo can ever see it.
  it('does not throw on Safari, and still selects via the mouse path', () => {
    const el = document.createElement('div');
    const seen: string[] = [];
    el.addEventListener('touchmove', () => seen.push('touchmove'));
    el.addEventListener('mousemove', e => seen.push(`mousemove:${(e as MouseEvent).clientX},${(e as MouseEvent).clientY}`));

    // Exactly Safari's shape: a function that exists and refuses to be constructed.
    vi.stubGlobal('TouchEvent', function () { throw new TypeError('Illegal constructor'); });

    expect(() => selectPointOnTouch(null, touchEvent(el, 42, 99))).not.toThrow();
    // The fallback must actually SELECT, not merely swallow the error — recharts reads mousemove.
    expect(seen).toEqual(['mousemove:42,99']);
  });

  it('does nothing at all when the tap carries no touches', () => {
    const el = document.createElement('div');
    const seen: string[] = [];
    el.addEventListener('touchmove', () => seen.push('touchmove'));
    el.addEventListener('mousemove', () => seen.push('mousemove'));
    const empty = { touches: [], currentTarget: el } as unknown as ReactTouchEvent<SVGGraphicsElement>;
    expect(() => selectPointOnTouch(null, empty)).not.toThrow();
    expect(seen).toEqual([]);
  });
});

// ── THE WIRING, WHICH IS WHERE THIS ACTUALLY FAILED FOR MONTHS ──────────────────────────────────
//
// The helper was correct and lived in ONE chart while five others silently lacked it. A unit test
// on the helper would have stayed green through all of that, so the real check is a source sweep:
// any recharts chart that renders a Tooltip must also pass `onTouchStart`, or a tap does nothing
// on that surface. This is what catches the NEXT chart somebody adds.
describe('every chart with a tooltip wires the tap fix', () => {
  const roots = ['src/components', 'src/pages'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (/\.tsx$/.test(name)) files.push(full);
    }
  };
  roots.forEach(walk);

  const charted = files
    .map(f => ({ f, src: readFileSync(f, 'utf-8') }))
    // A recharts chart that shows a tooltip has something to select. One with no tooltip
    // (a decorative sparkline) has nothing, and is deliberately out of scope.
    .filter(({ src }) => /<(Line|Area|Bar)Chart/.test(src) && /<(Recharts)?Tooltip[\s/>]/.test(src));

  it('finds the charts to check, so an empty sweep cannot pass silently', () => {
    expect(charted.length).toBeGreaterThanOrEqual(5);
  });

  it.each(charted.map(c => c.f))('%s passes onTouchStart', file => {
    expect(readFileSync(file, 'utf-8')).toMatch(/onTouchStart=\{selectPointOnTouch\}/);
  });
});
