'use client';

import { useEffect, useMemo } from 'react';
import {
  GOOGLE_CALENDAR_AUTH_STORAGE_KEY,
  GOOGLE_CALENDAR_OAUTH_MESSAGE_TYPE,
  type GoogleCalendarBrowserAuth,
} from '@/lib/google-calendar';

type CompletionPayload =
  | { status: 'success'; auth: GoogleCalendarBrowserAuth }
  | { status: 'error'; message: string };

function decodePayload(hash: string): CompletionPayload | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const encoded = params.get('payload');

  if (!encoded) {
    return null;
  }

  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as CompletionPayload;
  } catch {
    return null;
  }
}

export default function GoogleCalendarAuthCompletePage() {
  const payload = useMemo(
    () => (typeof window === 'undefined' ? null : decodePayload(window.location.hash)),
    [],
  );

  useEffect(() => {
    if (!payload) {
      return;
    }

    if (payload.status === 'success') {
      try {
        window.localStorage.setItem(
          GOOGLE_CALENDAR_AUTH_STORAGE_KEY,
          JSON.stringify(payload.auth),
        );
      } catch {
        // localStorage can be unavailable; the opener still receives the token.
      }
    }

    window.opener?.postMessage(
      {
        type: GOOGLE_CALENDAR_OAUTH_MESSAGE_TYPE,
        payload,
      },
      window.location.origin,
    );

    window.setTimeout(() => {
      window.close();
    }, 250);
  }, [payload]);

  return (
    <main className="page-shell">
      <section className="console-card">
        <h1 className="page-title">
          {payload?.status === 'success'
            ? 'Google Calendar connected'
            : 'Google Calendar connection failed'}
        </h1>
        <p className="hero-copy">
          {payload?.status === 'success'
            ? 'You can close this window now.'
            : payload?.message || 'Something went wrong while finishing Google authorization.'}
        </p>
      </section>
    </main>
  );
}
