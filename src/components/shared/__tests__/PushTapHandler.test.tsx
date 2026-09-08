// @vitest-environment jsdom
//
// TAPPING A NOTIFICATION MUST GO SOMEWHERE — FROM EITHER PLUGIN.
//
// ⚠️ THE BUG THIS FILE EXISTS FOR: `PushTapHandler` listened to `pushNotificationActionPerformed`
// on the REMOTE push plugin, and nothing else. As of 2026-09-07 `push_sends` holds zero rows
// across all users and there are zero iOS tokens on the system, so that listener has never fired
// once — while EVERY notification the app actually shows is a LOCAL one from
// `notification-service.ts`, whose taps raise `localNotificationActionPerformed` on a DIFFERENT
// plugin that nothing was listening to.
//
// So the handler was correct code aimed at the wrong object: a channel that is silent, watched,
// beside a channel that fires, unwatched. That is why "the lesson deep link does not open" — it
// was never wired, not broken. There was no test on this component at all, which is how it
// survived; the routing lib underneath it was tested and passed throughout.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => navigate }));

let isNative = true;
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative } }));

type Handler = (action: unknown) => void;
const listeners: Record<string, Handler> = {};
const removed: string[] = [];

const addListener = (name: string) => async (event: string, cb: Handler) => {
  listeners[`${name}:${event}`] = cb;
  return { remove: async () => { removed.push(`${name}:${event}`); } };
};

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: { addListener: addListener('push') },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { addListener: addListener('local') },
}));

import PushTapHandler from '../PushTapHandler';

beforeEach(() => {
  navigate.mockClear();
  removed.length = 0;
  isNative = true;
  for (const k of Object.keys(listeners)) delete listeners[k];
  sessionStorage.clear();
});
afterEach(() => cleanup());

/** Mount and wait for both dynamic imports to have registered. */
async function mountHandler() {
  render(<PushTapHandler />);
  await waitFor(() => {
    expect(listeners['push:pushNotificationActionPerformed']).toBeTypeOf('function');
    expect(listeners['local:localNotificationActionPerformed']).toBeTypeOf('function');
  });
}

describe('PushTapHandler', () => {
  // THE REGRESSION THAT MATTERS. Remove the LocalNotifications listener and this goes red.
  it('routes a LOCAL notification tap, which is the only kind this app actually sends', async () => {
    await mountHandler();
    listeners['local:localNotificationActionPerformed']({
      // LocalNotifications surfaces what was scheduled in `extra`, NOT `data`.
      notification: { extra: { key: 'learn_lesson:what-a-cash-floor-is' } },
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate.mock.calls[0][0]).toContain('lesson');
  });

  it('still routes a REMOTE push tap, reading `data` rather than `extra`', async () => {
    await mountHandler();
    listeners['push:pushNotificationActionPerformed']({
      notification: { data: { key: 'learn_lesson:what-a-cash-floor-is' } },
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate.mock.calls[0][0]).toContain('lesson');
  });

  // The two channels must not disagree about where one key goes — that is why the routing was
  // lifted into a single `handleTap` rather than copied into the second listener.
  it('sends the same key to the same place from either plugin', async () => {
    await mountHandler();
    const key = 'learn_lesson:what-a-cash-floor-is';
    listeners['local:localNotificationActionPerformed']({ notification: { extra: { key } } });
    listeners['push:pushNotificationActionPerformed']({ notification: { data: { key } } });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(navigate.mock.calls[0][0]).toBe(navigate.mock.calls[1][0]);
  });

  // An unrecognised key must still land somewhere rather than appearing to do nothing.
  it('falls back to a real destination for an unknown or missing key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountHandler();
    listeners['local:localNotificationActionPerformed']({ notification: { extra: {} } });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate.mock.calls[0][0]).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('removes BOTH listeners on unmount, so a remount does not double-navigate', async () => {
    await mountHandler();
    cleanup();
    await waitFor(() => expect(removed).toHaveLength(2));
    expect(removed).toContain('local:localNotificationActionPerformed');
    expect(removed).toContain('push:pushNotificationActionPerformed');
  });

  it('registers nothing on the web, where neither plugin exists', async () => {
    isNative = false;
    render(<PushTapHandler />);
    await new Promise(r => setTimeout(r, 0));
    expect(listeners['local:localNotificationActionPerformed']).toBeUndefined();
    expect(listeners['push:pushNotificationActionPerformed']).toBeUndefined();
  });
});
