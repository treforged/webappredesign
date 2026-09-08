import { Capacitor } from '@capacitor/core';
import { decideNotification } from '@/lib/notification-policy';
import { loadPrefs, savePrefs } from '@/lib/notification-prefs';
import type {
  NotificationDecision, NotificationRecord, NotificationSignals,
} from '@/lib/notification-policy';

export const HISTORY_KEY = 'forged:notif_history';
export const ENABLED_KEY = 'forged:notif_enabled';
export const MAX_HISTORY = 50;

export async function getHistory(): Promise<NotificationRecord[]> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: HISTORY_KEY });
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is NotificationRecord =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.key === 'string' &&
      typeof item.sentAt === 'string' &&
      typeof item.kind === 'string' &&
      ['bill_due', 'floor_risk', 'milestone', 'weekly_checkin', 'stale_accounts', 'learn_lesson', 'streak_risk'].includes(item.kind)
    );
  } catch {
    return [];
  }
}

export async function recordSent(record: NotificationRecord): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const history = await getHistory();
    const updated = [...history, record].slice(-MAX_HISTORY);
    await Preferences.set({ key: HISTORY_KEY, value: JSON.stringify(updated) });
  } catch { /* never block the app */ }
}

/**
 * The master switch, kept as a thin read over `notification-prefs.ts`.
 *
 * The account row is the source of truth now (see that file for why a device-local switch was
 * unreadable by anything that sends). `ENABLED_KEY` is still honoured on the way IN so that a
 * user who switched notifications off on this device before the change stays off: the old value
 * is a real answer they gave, and losing it would start notifying someone who had said no.
 */
export async function isEnabled(): Promise<boolean> {
  const prefs = await loadPrefs();
  if (!prefs.enabled) return false;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: ENABLED_KEY });
    return value !== 'false';
  } catch {
    return true;
  }
}

export async function setEnabled(enabled: boolean): Promise<void> {
  const prefs = await loadPrefs();
  await savePrefs({ ...prefs, enabled });
  try {
    const { Preferences } = await import('@capacitor/preferences');
    // Kept in step so the legacy key can never disagree with the account and re-mute a user
    // who has just turned notifications back on.
    await Preferences.set({ key: ENABLED_KEY, value: enabled ? 'true' : 'false' });
  } catch { /* never block the app */ }
}

export async function ensurePermission(): Promise<boolean> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const { display } = await LocalNotifications.checkPermissions();
    if (display === 'granted') return true;
    // A user who has said no has answered. Asking again is how an app earns an uninstall, and
    // on both platforms a second prompt is not even shown - the call just returns denied again.
    // They can still turn notifications back on from the OS settings, or from ours.
    if (display === 'denied') return false;
    const { display: newDisplay } = await LocalNotifications.requestPermissions();
    return newDisplay === 'granted';
  } catch {
    return false;
  }
}

/**
 * Checks are SERIALISED, and that is what stops one event becoming several notifications.
 *
 * ⚠️ THE BUG: `runNotificationCheck` reads history, decides, and only records the send at the very
 * END — with two awaits in between, one of which is `ensurePermission()`. On a first run that await
 * is an OS permission dialog sitting open for as long as the person takes to answer it. Any second
 * check starting inside that window reads a history that does not yet contain the pending send,
 * decides afresh, and schedules again. It is a plain check-then-act race, and it is the only
 * mechanism the policy's own gates leave open: `MIN_HOURS_BETWEEN` (16h), `MAX_PER_WEEK` (5) and
 * the per-kind caps are all computed FROM that history, so every one of them is defeated by
 * reading it before the previous send is written rather than by being wrong.
 *
 * Chaining every call through one promise means the second check evaluates against the history the
 * first WROTE, not the one it read, and correctly decides nothing.
 *
 * ⚠️ A hung check blocks the ones behind it, deliberately. The realistic way to hang here is an
 * unanswered permission dialog — and somebody who has not answered it is precisely who should not
 * be sent a second notification.
 */
let checkChain: Promise<unknown> = Promise.resolve();

export function runNotificationCheck(signals: NotificationSignals): Promise<NotificationDecision | null> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(null);
  // Both arms run the check: a previous failure must not stop the next one from being considered.
  const run = checkChain.then(() => performCheck(signals), () => performCheck(signals));
  checkChain = run.catch(() => undefined);
  return run;
}

async function performCheck(signals: NotificationSignals): Promise<NotificationDecision | null> {
  try {
    if (!(await isEnabled())) return null;
    // The per-category opt-outs travel with the decision rather than being checked afterwards:
    // a candidate the user silenced must FALL THROUGH to the next one, not silence the week.
    const prefs = await loadPrefs();
    const history = await getHistory();
    const decision = decideNotification(signals, history, prefs);
    if (!decision) return null;
    // PERMISSION IS ASKED HERE, AND NOWHERE ELSE. Not at launch, not at sign-up: at the first
    // moment there is a real, specific thing to tell this user. Prompting before showing the
    // value is the single biggest cause of a low opt-in rate, and the prompt can only be
    // answered once.
    if (!(await ensurePermission())) return null;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const id = notificationId(decision.key);
    const now = new Date(signals.now);
    now.setSeconds(now.getSeconds() + 5);
    await LocalNotifications.schedule({
      notifications: [{
        id,
        title: decision.title,
        body: decision.body,
        schedule: { at: now },
        // ⚠️ WITHOUT THIS A TAP HAS NOTHING TO ROUTE ON, and the notification just foregrounds the
        // app wherever the person left it. `PushTapHandler` reads `extra.key` and hands it to
        // `routeForNotificationKey`; the remote path carries the identical key in `data`, so the
        // two channels reach the same destination. This is the half of the lesson deep link that
        // was missing on the SENDING side — the listening side was watching the wrong plugin.
        extra: { key: decision.key },
      }]
    });
    await recordSent({ kind: decision.kind, key: decision.key, sentAt: signals.now.toISOString() });
    return decision;
  } catch {
    return null;
  }
}

/**
 * A stable notification id for a decision key.
 *
 * The id is what stops one fact being scheduled twice: two callers deciding the same thing
 * produce the same id, and the OS replaces rather than duplicates. So it must be deterministic,
 * and it must land in the range the platforms accept - a positive 32-bit signed integer.
 *
 * djb2, kept inside 32 bits with `| 0` on every step. Letting it grow past 2^53 first and taking
 * the modulus afterwards would lose precision and stop being stable for long keys, which is
 * exactly what the long keys here look like (`bill_due:2026-09-04:Rent`). The modulus is 2147483646
 * and the result is shifted up by one so the range is 1..2147483646: a hash of 0 is reachable, and
 * 0 is not a positive id.
 */
export function notificationId(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash * 33) ^ key.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2147483646) + 1;
}
