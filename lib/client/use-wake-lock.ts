'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Screen Wake Lock API. The browser releases the lock automatically when the
// document becomes hidden (e.g. tab switch, screen lock, app switch on
// mobile), so we re-acquire it on `visibilitychange` whenever the user has
// the toggle enabled. The user controls the toggle manually via a button in
// live-console.

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

type WakeLockApi = {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
};

function getWakeLockApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  const wl = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return wl ?? null;
}

export function isWakeLockSupported(): boolean {
  return getWakeLockApi() !== null;
}

export type UseWakeLockResult = {
  /** What the user has chosen — persists across sessions. */
  enabled: boolean;
  /** Is the lock actually held right now (false e.g. while tab is hidden). */
  active: boolean;
  /** Browser supports the Wake Lock API. */
  supported: boolean;
  setEnabled: (next: boolean) => void;
  toggle: () => void;
  /** If the request failed, contains a user-facing message. */
  error: string | null;
};

/**
 * Manages Screen Wake Lock with a user-controlled toggle. Persists the
 * preference in localStorage under `storageKey` so the user's choice
 * survives reloads. Automatically re-acquires the lock when the document
 * becomes visible again, since the browser releases it on every hide.
 */
export function useWakeLock(storageKey: string): UseWakeLockResult {
  const supported = typeof window !== 'undefined' && isWakeLockSupported();
  const [enabled, setEnabledState] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Restore the saved preference on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(storageKey);
    if (saved === '1') setEnabledState(true);
  }, [storageKey]);

  // Persist the preference whenever it changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, enabled ? '1' : '0');
  }, [enabled, storageKey]);

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        // Ignore — the sentinel may already be released.
      }
    }
  }, []);

  const acquire = useCallback(async () => {
    const wl = getWakeLockApi();
    if (!wl) {
      setError('Этот браузер не умеет блокировать выключение экрана.');
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      // Browser will refuse the request when the page isn't visible.
      return;
    }
    try {
      const sentinel = await wl.request('screen');
      sentinelRef.current = sentinel;
      setActive(true);
      setError(null);
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
        }
        setActive(false);
        // If the user still wants the lock, the visibilitychange handler
        // below will re-acquire it the next time the tab is visible.
      });
    } catch (e) {
      sentinelRef.current = null;
      setActive(false);
      const message = e instanceof Error ? e.message : 'Не удалось включить блокировку.';
      setError(message);
    }
  }, []);

  // Acquire / release whenever the toggle changes.
  useEffect(() => {
    if (!supported) return;
    if (enabled) {
      void acquire();
    } else {
      void release();
    }
  }, [enabled, supported, acquire, release]);

  // Re-acquire on visibility change while the toggle is on.
  useEffect(() => {
    if (!supported) return;
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabledRef.current && !sentinelRef.current) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [supported, acquire]);

  // Release on unmount.
  useEffect(() => {
    return () => {
      void release();
    };
  }, [release]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
  }, []);

  const toggle = useCallback(() => {
    setEnabledState((prev) => !prev);
  }, []);

  return { enabled, active, supported, setEnabled, toggle, error };
}
