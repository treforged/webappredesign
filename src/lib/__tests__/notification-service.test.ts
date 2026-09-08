// NOTIFICATION SERVICE — the platform layer under the pure policy module.
//
// The plugins are mocked so every branch RUNS here rather than being reasoned about on a laptop
// and discovered on a phone. The failures this file exists to catch are the quiet ones: a
// notification scheduled twice for one fact, a permission prompt fired at launch, a denied user
// asked again, corrupt stored history taking down the screen that called it.
//
// What it deliberately does NOT prove: that the OS actually displays anything. That needs a
// device, and the commit says so.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prefs = new Map<string, string>();
type ScheduleArg = {
  notifications: { id: number; title: string; body: string; schedule: { at: Date }; extra?: { key?: string } }[];
};
const schedule = vi.fn(async (_opts: ScheduleArg): Promise<void> => undefined);
const checkPermissions = vi.fn(async () => ({ display: 'granted' as string }));
const requestPermissions = vi.fn(async () => ({ display: 'granted' as string }));
let isNative = true;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.has(key) ? prefs.get(key) : null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefs.set(key, value); },
  },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: (opts: ScheduleArg) => schedule(opts),
    checkPermissions: () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
  },
}));

import {
  getHistory, recordSent, isEnabled, setEnabled, ensurePermission,
  runNotificationCheck, notificationId,
  HISTORY_KEY, ENABLED_KEY, MAX_HISTORY,
} from '@/lib/notification-service';
import type { NotificationSignals } from '@/lib/notification-policy';

/** A Wednesday 10am with one unaffordable bill due in two days: the policy's top candidate. */
const signals = (over: Partial<NotificationSignals> = {}): NotificationSignals => ({
  now: new Date('2026-09-02T10:00:00'),
  upcomingBills: [{ name: 'Rent', amount: 1915, dueDate: '2026-09-04' }],
  projectedCashAtNextBill: 1200,
  cashFloor: 2500,
  nextMonthProjectedEndingCash: null,
  nextMonthFloor: null,
  newMilestones: [],
  lastAccountSyncAt: '2026-09-02T06:00:00',
  netWorth: null,
  monthEndCash: null,
  nextLesson: null,
  learnStreak: 0,
  learnedToday: false,
  ...over,
});

beforeEach(() => {
  prefs.clear();
  schedule.mockClear();
  checkPermissions.mockClear();
  requestPermissions.mockClear();
  checkPermissions.mockResolvedValue({ display: 'granted' });
  requestPermissions.mockResolvedValue({ display: 'granted' });
  isNative = true;
});

describe('notification service — stored history', () => {
  it('starts empty and round-trips a record', async () => {
    expect(await getHistory()).toEqual([]);
    await recordSent({ kind: 'milestone', key: 'k1', sentAt: '2026-09-02T10:00:00.000Z' });
    expect(await getHistory()).toEqual([{ kind: 'milestone', key: 'k1', sentAt: '2026-09-02T10:00:00.000Z' }]);
  });

  it('survives corrupt storage instead of taking the caller down with it', async () => {
    for (const junk of ['not json at all', '{"not":"an array"}', '[1,2,3]', '']) {
      prefs.set(HISTORY_KEY, junk);
      await expect(getHistory()).resolves.toEqual([]);
    }
  });

  it('drops malformed entries but keeps the good ones beside them', async () => {
    prefs.set(HISTORY_KEY, JSON.stringify([
      { kind: 'milestone', key: 'good', sentAt: '2026-09-01T10:00:00.000Z' },
      { kind: 'milestone', key: 42, sentAt: 'x' },
      null,
      'a string',
      { key: 'no kind', sentAt: 'x' },
    ]));
    const out = await getHistory();
    expect(out.map(r => r.key)).toEqual(['good']);
  });

  it('keeps only the most recent MAX_HISTORY records', async () => {
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      await recordSent({ kind: 'milestone', key: `k${i}`, sentAt: '2026-09-02T10:00:00.000Z' });
    }
    const out = await getHistory();
    expect(out).toHaveLength(MAX_HISTORY);
    // The OLD ones go, not the new ones - dropping the newest would let a fact be re-sent.
    expect(out[out.length - 1].key).toBe(`k${MAX_HISTORY + 9}`);
    expect(out[0].key).toBe('k10');
  });
});

describe('notification service — the enabled switch', () => {
  it('defaults ON, because a user who has not chosen has not opted out', async () => {
    expect(await isEnabled()).toBe(true);
  });

  it('only the exact stored false disables it', async () => {
    await setEnabled(false);
    expect(prefs.get(ENABLED_KEY)).toBe('false');
    expect(await isEnabled()).toBe(false);
    await setEnabled(true);
    expect(await isEnabled()).toBe(true);
  });
});

describe('notification service — permission is asked late and only once', () => {
  it('does not prompt when permission is already granted', async () => {
    expect(await ensurePermission()).toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('NEVER re-prompts a user who has denied', async () => {
    checkPermissions.mockResolvedValue({ display: 'denied' });
    expect(await ensurePermission()).toBe(false);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('prompts once when the answer is still unknown, and honours the reply', async () => {
    checkPermissions.mockResolvedValue({ display: 'prompt' });
    requestPermissions.mockResolvedValue({ display: 'granted' });
    expect(await ensurePermission()).toBe(true);
    expect(requestPermissions).toHaveBeenCalledTimes(1);

    requestPermissions.mockResolvedValue({ display: 'denied' });
    expect(await ensurePermission()).toBe(false);
  });

  it('is false, not an exception, when the plugin itself throws', async () => {
    checkPermissions.mockRejectedValue(new Error('no such plugin'));
    await expect(ensurePermission()).resolves.toBe(false);
  });
});

describe('notification service — runNotificationCheck', () => {
  it('schedules the decision, and records it so it cannot repeat', async () => {
    const out = await runNotificationCheck(signals());
    expect(out?.kind).toBe('bill_due');
    expect(schedule).toHaveBeenCalledTimes(1);

    const n = schedule.mock.calls[0][0].notifications[0];
    expect(n.title).toContain('Rent');
    expect(n.body).toContain('$1,915');
    expect(n.id).toBe(notificationId(out?.key ?? ''));
    expect(n.schedule.at.getTime()).toBeGreaterThan(signals().now.getTime());

    // ⚠️ WITHOUT `extra.key` A TAP HAS NOTHING TO ROUTE ON and the notification simply
    // foregrounds the app wherever the person left it — which is exactly why the lesson deep
    // link "did not open". `PushTapHandler` reads this field and hands it to
    // `routeForNotificationKey`; the remote path carries the identical key in `data`.
    expect(n.extra?.key).toBe(out?.key);

    // The same call again is silent: the record it just wrote suppresses the repeat.
    schedule.mockClear();
    expect(await runNotificationCheck(signals())).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does nothing at all on the web build', async () => {
    isNative = false;
    expect(await runNotificationCheck(signals())).toBeNull();
    expect(checkPermissions).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does nothing when the user has switched notifications off', async () => {
    await setEnabled(false);
    expect(await runNotificationCheck(signals())).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('NEVER asks for permission when there is nothing worth sending', async () => {
    // Nothing qualifies: the bill is affordable and no other signal is present.
    const quiet = signals({ projectedCashAtNextBill: 9000, upcomingBills: [] });
    expect(await runNotificationCheck(quiet)).toBeNull();
    expect(checkPermissions).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('does not record anything when permission is refused, so it can ask again another day', async () => {
    checkPermissions.mockResolvedValue({ display: 'denied' });
    expect(await runNotificationCheck(signals())).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
    expect(await getHistory()).toEqual([]);
  });

  it('returns null rather than throwing when scheduling fails', async () => {
    schedule.mockRejectedValueOnce(new Error('scheduling exploded'));
    await expect(runNotificationCheck(signals())).resolves.toBeNull();
  });
});

describe('notification service — notificationId', () => {
  it('is stable, positive and in range for the long keys this app produces', () => {
    const keys = [
      'bill_due:2026-09-04:Rent',
      'floor_risk:2026-10',
      'milestone:Jul 2028:CC Debt Free',
      'weekly_checkin:2026-09-06',
      'stale_accounts:2026-09-02',
      '',
    ];
    for (const k of keys) {
      const id = notificationId(k);
      expect(id).toBe(notificationId(k));
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(2147483646);
    }
  });

  it('separates keys that differ only at the end, which is where these keys differ', () => {
    expect(notificationId('bill_due:2026-09-04:Rent')).not.toBe(notificationId('bill_due:2026-09-04:Rens'));
    expect(notificationId('weekly_checkin:2026-09-06')).not.toBe(notificationId('weekly_checkin:2026-09-13'));
  });
});
