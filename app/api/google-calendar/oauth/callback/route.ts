import { NextResponse } from 'next/server';
import {
  GOOGLE_CALENDAR_DEFAULT_ID,
  type GoogleCalendarBrowserAuth,
} from '@/lib/google-calendar';

const GOOGLE_OAUTH_STATE_COOKIE = 'google-calendar-oauth-state';

function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar OAuth is not configured on the server.');
  }

  return { clientId, clientSecret };
}

function buildRedirectUri(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}/api/google-calendar/oauth/callback`;
}

function buildCompletionUrl(request: Request, payload: Record<string, unknown>) {
  const url = new URL(request.url);
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${url.origin}/google-calendar-auth-complete#payload=${encodeURIComponent(encoded)}`;
}

async function exchangeCodeForRefreshToken(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => null)) as
    | { refresh_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok) {
    const details = json?.error_description || json?.error || `HTTP ${response.status}`;
    throw new Error(`Google token exchange failed: ${details}`);
  }

  if (!json?.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Remove the app access in your Google account and try again.',
    );
  }

  const auth: GoogleCalendarBrowserAuth = {
    refreshToken: json.refresh_token,
    calendarId: GOOGLE_CALENDAR_DEFAULT_ID,
    connectedAt: new Date().toISOString(),
  };

  return auth;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const cookieState = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GOOGLE_OAUTH_STATE_COOKIE}=`))
    ?.slice(GOOGLE_OAUTH_STATE_COOKIE.length + 1);

  const finalize = (payload: Record<string, unknown>) => {
    const isHttps = new URL(request.url).protocol === 'https:';
    const response = NextResponse.redirect(buildCompletionUrl(request, payload));
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 0,
    });
    return response;
  };

  if (error) {
    return finalize({
      status: 'error',
      message: `Google authorization failed: ${error}`,
    });
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    return finalize({
      status: 'error',
      message: 'Google authorization state did not match. Please try again.',
    });
  }

  try {
    const auth = await exchangeCodeForRefreshToken(code, buildRedirectUri(request));

    return finalize({
      status: 'success',
      auth,
    });
  } catch (exchangeError) {
    return finalize({
      status: 'error',
      message:
        exchangeError instanceof Error
          ? exchangeError.message
          : 'Failed to finish Google Calendar authorization.',
    });
  }
}
