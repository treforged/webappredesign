import { useState, useEffect, useCallback } from 'react';
import {
  CookieConsentState,
  loadConsent,
  saveConsent,
} from '@/lib/cookie-consent';

export type ConsentStatus = 'pending' | 'decided';

interface UseCookieConsentReturn {
  /** null while loading; populated once localStorage is read */
  consent: CookieConsentState | null;
  status: ConsentStatus;
  /** Accept all non-essential categories */
  acceptAll: () => void;
  /** Accept only essential cookies */
  rejectNonEssential: () => void;
  /** Save a custom selection */
  saveCustom: (prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>) => void;
}

export function useCookieConsent(): UseCookieConsentReturn {
  const [consent, setConsent] = useState<CookieConsentState | null>(null);
  const [status, setStatus] = useState<ConsentStatus>('pending');

  useEffect(() => {
    const stored = loadConsent();
    if (stored) {
      setConsent(stored);
      setStatus('decided');
    }
    // If null, status stays 'pending' → banner shows
  }, []);

  const acceptAll = useCallback(() => {
    const state = saveConsent({ analytics: true, marketing: true });
    setConsent(state);
    setStatus('decided');
  }, []);

  const rejectNonEssential = useCallback(() => {
    const state = saveConsent({ analytics: false, marketing: false });
    setConsent(state);
    setStatus('decided');
  }, []);

  const saveCustom = useCallback(
    (prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>) => {
      const state = saveConsent(prefs);
      setConsent(state);
      setStatus('decided');
    },
    [],
  );

  return { consent, status, acceptAll, rejectNonEssential, saveCustom };
}
