import { useState, useCallback } from 'react';

/**
 * A useState wrapper that persists to localStorage.
 * Falls back to defaultValue if localStorage is empty or invalid.
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return JSON.parse(stored);
    } catch { /* ignore */ }
    return defaultValue;
  });

  const setPersisted = useCallback((val: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof val === 'function' ? (val as (prev: T) => T)(prev) : val;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);

  return [value, setPersisted];
}
