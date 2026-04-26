'use client';

import { useEffect } from 'react';

// Registers the minimal service worker that ships in /public/sw.js. The
// only purpose is to satisfy Chrome's "installable PWA" criteria so the
// browser shows the «Add to Home Screen» / «Install Liv» prompt. We do not
// cache anything — the live audio / video / WebSocket flow must always go
// straight to the network.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore — registration failures shouldn't break the page.
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }, []);

  return null;
}
