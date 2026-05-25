import { NextResponse } from 'next/server';

const GOOGLE_OAUTH_STATE_COOKIE = 'google-calendar-oauth-state';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function getGoogleClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not set.');
  }

  return clientId;
}

function buildRedirectUri(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}/api/google-calendar/oauth/callback`;
}

export async function GET(request: Request) {
  try {
    const clientId = getGoogleClientId();
    const redirectUri = buildRedirectUri(request);
    const state = crypto.randomUUID();
    const isHttps = new URL(request.url).protocol === 'https:';
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    const response = NextResponse.redirect(authUrl);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 10 * 60,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start Google Calendar OAuth.' },
      { status: 500 },
    );
  }
}
