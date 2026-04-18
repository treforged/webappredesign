import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

export type LockType = 'pin' | 'biometric' | 'passkey';

const K = {
  enabled:   'forged:lock_enabled',
  type:      'forged:lock_type',
  pinHash:   'forged:lock_pin_hash',
  passkeyId: 'forged:lock_passkey_id',
  unlockedAt:'forged:lock_unlocked_at',
} as const;

const UNLOCK_GRACE_MS = 5 * 60 * 1000; // 5 minutes
const RP_ID = 'app.treforged.com';
const RP_NAME = 'Forged';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isWithinGrace(): boolean {
  const t = localStorage.getItem(K.unlockedAt);
  if (!t) return false;
  return Date.now() - parseInt(t) < UNLOCK_GRACE_MS;
}

function markUnlocked() {
  localStorage.setItem(K.unlockedAt, String(Date.now()));
}

export function useAppLock() {
  const isNative = Capacitor.isNativePlatform();
  const lockEnabled  = localStorage.getItem(K.enabled) === '1';
  const lockType     = (localStorage.getItem(K.type) ?? 'pin') as LockType;

  const [isLocked, setIsLocked] = useState<boolean>(() => {
    if (!lockEnabled) return false;
    return !isWithinGrace();
  });

  useEffect(() => {
    if (!lockEnabled) { setIsLocked(false); return; }
    if (isWithinGrace()) { setIsLocked(false); return; }
    setIsLocked(true);
  }, [lockEnabled]);

  // ── Unlock ────────────────────────────────────────────────
  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const stored = localStorage.getItem(K.pinHash);
    if (!stored) return false;
    const hash = await sha256(pin);
    if (hash !== stored) return false;
    markUnlocked();
    setIsLocked(false);
    return true;
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    if (!isNative) return false;
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Unlock Forged' });
      // authenticate() resolves on success, throws BiometryError on failure
      markUnlocked();
      setIsLocked(false);
      return true;
    } catch {
      return false;
    }
  }, [isNative]);

  const unlockWithPasskey = useCallback(async (): Promise<boolean> => {
    if (!window.PublicKeyCredential) return false;
    const credId = localStorage.getItem(K.passkeyId);
    if (!credId) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: location.hostname === 'localhost' ? 'localhost' : RP_ID,
          allowCredentials: [{ type: 'public-key', id: Uint8Array.from(atob(credId), c => c.charCodeAt(0)) }],
          userVerification: 'required',
        },
      }) as PublicKeyCredential | null;
      if (!cred) return false;
      markUnlocked();
      setIsLocked(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Setup ─────────────────────────────────────────────────
  const setupPin = useCallback(async (pin: string): Promise<void> => {
    const hash = await sha256(pin);
    localStorage.setItem(K.pinHash, hash);
    localStorage.setItem(K.type, 'pin');
    localStorage.setItem(K.enabled, '1');
    markUnlocked();
  }, []);

  const checkBiometricAvailable = useCallback(async (): Promise<boolean> => {
    if (!isNative) return false;
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      const info = await BiometricAuth.checkBiometry();
      return info.isAvailable ?? false;
    } catch {
      return false;
    }
  }, [isNative]);

  const setupBiometric = useCallback(async (): Promise<boolean> => {
    const available = await checkBiometricAvailable();
    if (!available) return false;
    localStorage.setItem(K.type, 'biometric');
    localStorage.setItem(K.enabled, '1');
    markUnlocked();
    return true;
  }, [checkBiometricAvailable]);

  const registerPasskey = useCallback(async (userId: string, email: string): Promise<boolean> => {
    if (!window.PublicKeyCredential) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const uid = new TextEncoder().encode(userId.slice(0, 16).padEnd(16, '0'));
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { id: location.hostname === 'localhost' ? 'localhost' : RP_ID, name: RP_NAME },
          user: { id: uid, name: email, displayName: email },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;
      if (!cred) return false;
      const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      localStorage.setItem(K.passkeyId, id);
      localStorage.setItem(K.type, 'passkey');
      localStorage.setItem(K.enabled, '1');
      markUnlocked();
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Disable lock ──────────────────────────────────────────
  const disableLock = useCallback(() => {
    localStorage.removeItem(K.enabled);
    localStorage.removeItem(K.type);
    localStorage.removeItem(K.pinHash);
    localStorage.removeItem(K.passkeyId);
    localStorage.removeItem(K.unlockedAt);
    setIsLocked(false);
  }, []);

  const setLockType = useCallback((type: LockType) => {
    localStorage.setItem(K.type, type);
  }, []);

  return {
    isNative,
    isLocked,
    lockEnabled,
    lockType,
    unlockWithPin,
    unlockWithBiometric,
    unlockWithPasskey,
    setupPin,
    setupBiometric,
    checkBiometricAvailable,
    registerPasskey,
    disableLock,
    setLockType,
  };
}
