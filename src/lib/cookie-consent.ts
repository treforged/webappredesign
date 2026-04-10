export type CookieCategoryId = 'essential' | 'analytics' | 'marketing';

export interface CookieConsentState {
  /** Semver string — bump to re-prompt users after policy changes */
  version: string;
  /** ISO timestamp of last decision */
  decidedAt: string;
  /** Always true — required for auth and session */
  essential: true;
  /** Usage analytics (e.g. Vercel Speed Insights) */
  analytics: boolean;
  /** Marketing / advertising cookies (currently unused) */
  marketing: boolean;
}

export interface CookieCategoryDef {
  id: CookieCategoryId;
  label: string;
  description: string;
  required: boolean;
  examples: string[];
}

export const COOKIE_CATEGORIES: CookieCategoryDef[] = [
  {
    id: 'essential',
    label: 'Essential',
    description:
      'Required for the site to function. These enable core features like authentication, security, and session management. They cannot be disabled.',
    required: true,
    examples: ['Supabase session token', 'CSRF protection', 'login state'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description:
      'Help us understand how you use Budget OS so we can improve the experience. Data is aggregated and never sold.',
    required: false,
    examples: ['Vercel Speed Insights', 'page load timing', 'feature usage'],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description:
      'TRE Forged Budget OS does not currently use marketing cookies. This category is listed for transparency.',
    required: false,
    examples: ['(none currently active)'],
  },
];

const STORAGE_KEY = 'tre_cookie_consent';
const CURRENT_VERSION = '1.0';

export function loadConsent(): CookieConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieConsentState;
    // Re-prompt if policy version changed
    if (parsed.version !== CURRENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveConsent(
  prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>,
): CookieConsentState {
  const state: CookieConsentState = {
    version: CURRENT_VERSION,
    decidedAt: new Date().toISOString(),
    essential: true,
    analytics: prefs.analytics,
    marketing: prefs.marketing,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

export function clearConsent(): void {
  localStorage.removeItem(STORAGE_KEY);
}
