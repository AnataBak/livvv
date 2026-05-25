import {
  TAVILY_SEARCH_FUNCTION_NAME,
  type LiveModelId,
  modelUsesTavilySearch,
} from '@/lib/live-session-config';
import {
  GOOGLE_CALENDAR_CREATE_EVENT_FUNCTION_NAME,
  GOOGLE_CALENDAR_DELETE_EVENT_FUNCTION_NAME,
  GOOGLE_CALENDAR_DEFAULT_ID,
  GOOGLE_CALENDAR_LIST_EVENTS_FUNCTION_NAME,
  GOOGLE_CALENDAR_UPDATE_EVENT_FUNCTION_NAME,
  type GoogleCalendarBrowserAuth,
} from '@/lib/google-calendar';

type EnvSource = Record<string, string | undefined>;

export type LiveFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type LiveFunctionResponse = {
  id: string;
  name: string;
  response: Record<string, unknown>;
};

export type LiveToolExecutionContext = {
  googleCalendarAuth?: GoogleCalendarBrowserAuth | null;
};

type TavilyTopic = 'general' | 'news';
type TavilyTimeRange = 'day' | 'week' | 'month' | 'year';
type TavilySearchDepth = 'basic' | 'advanced';

type TavilySearchArgs = {
  query: string;
  topic?: TavilyTopic;
  timeRange?: TavilyTimeRange;
  maxResults?: number;
  searchDepth?: TavilySearchDepth;
  includeDomains?: string[];
  excludeDomains?: string[];
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  raw_content?: string | null;
  favicon?: string | null;
};

type TavilyResponse = {
  query?: string;
  answer?: string;
  results?: TavilyResult[];
  response_time?: string;
  auto_parameters?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  request_id?: string;
};

const TAVILY_API_URL = 'https://api.tavily.com/search';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

function getTavilyApiKey(env: EnvSource = process.env) {
  const apiKey = env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY is not set. Add it to .env.local before enabling Tavily search.',
    );
  }

  return apiKey;
}

function getGoogleOAuthCredentials(env: EnvSource = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google Calendar OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.',
    );
  }

  return { clientId, clientSecret };
}

function asStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTavilyArgs(args: Record<string, unknown>): TavilySearchArgs {
  const query = typeof args.query === 'string' ? args.query.trim() : '';

  if (!query) {
    throw new Error('Tavily search requires a non-empty query.');
  }

  const topic = args.topic === 'news' ? 'news' : 'general';
  const timeRange =
    args.timeRange === 'day' ||
    args.timeRange === 'week' ||
    args.timeRange === 'month' ||
    args.timeRange === 'year'
      ? args.timeRange
      : undefined;
  const maxResultsRaw =
    typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
      ? args.maxResults
      : 5;
  const maxResults = Math.min(10, Math.max(1, Math.round(maxResultsRaw)));
  const searchDepth = args.searchDepth === 'advanced' ? 'advanced' : 'basic';

  return {
    query,
    topic,
    timeRange,
    maxResults,
    searchDepth,
    includeDomains: asStringArray(args.includeDomains, 20),
    excludeDomains: asStringArray(args.excludeDomains, 20),
  };
}

async function runTavilySearch(
  args: Record<string, unknown>,
  env: EnvSource = process.env,
): Promise<Record<string, unknown>> {
  const normalized = normalizeTavilyArgs(args);
  const response = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getTavilyApiKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: normalized.query,
      topic: normalized.topic,
      time_range: normalized.timeRange,
      max_results: normalized.maxResults,
      search_depth: normalized.searchDepth,
      include_answer: 'advanced',
      include_raw_content: false,
      include_domains: normalized.includeDomains,
      exclude_domains: normalized.excludeDomains,
    }),
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => null)) as TavilyResponse | null;

  if (!response.ok) {
    const fallback = `Tavily request failed with status ${response.status}.`;
    throw new Error(
      typeof json === 'object' && json !== null && 'detail' in json && typeof json.detail === 'string'
        ? json.detail
        : fallback,
    );
  }

  return {
    query: json?.query ?? normalized.query,
    answer: json?.answer ?? null,
    results: (json?.results ?? []).slice(0, normalized.maxResults).map((result) => ({
      title: result.title ?? '',
      url: result.url ?? '',
      content: result.content ?? '',
      score: result.score ?? null,
      favicon: result.favicon ?? null,
    })),
    responseTime: json?.response_time ?? null,
    requestId: json?.request_id ?? null,
    autoParameters: json?.auto_parameters ?? null,
    usage: json?.usage ?? null,
  };
}

type GoogleCalendarCreateEventArgs = {
  title: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime?: string;
  durationMinutes?: number;
  timeZone?: string;
  calendarId?: string;
};

type GoogleCalendarListEventsArgs = {
  timeMin?: string;
  timeMax?: string;
  query?: string;
  maxResults: number;
  calendarId?: string;
};

type GoogleCalendarUpdateEventArgs = {
  eventId: string;
  title?: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  endDateTime?: string;
  durationMinutes?: number;
  timeZone?: string;
  calendarId?: string;
};

type GoogleCalendarDeleteEventArgs = {
  eventId: string;
  calendarId?: string;
};

function normalizeGoogleCalendarCreateEventArgs(
  args: Record<string, unknown>,
): GoogleCalendarCreateEventArgs {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const startDateTime =
    typeof args.startDateTime === 'string' ? args.startDateTime.trim() : '';

  if (!title) {
    throw new Error('Google Calendar requires a non-empty title.');
  }

  if (!startDateTime) {
    throw new Error('Google Calendar requires startDateTime in ISO 8601 format.');
  }

  if (Number.isNaN(Date.parse(startDateTime))) {
    throw new Error('Google Calendar startDateTime must be a valid ISO 8601 datetime.');
  }

  const endDateTime =
    typeof args.endDateTime === 'string' && args.endDateTime.trim().length > 0
      ? args.endDateTime.trim()
      : undefined;

  if (endDateTime && Number.isNaN(Date.parse(endDateTime))) {
    throw new Error('Google Calendar endDateTime must be a valid ISO 8601 datetime.');
  }

  const durationMinutesRaw =
    typeof args.durationMinutes === 'number' && Number.isFinite(args.durationMinutes)
      ? Math.round(args.durationMinutes)
      : 60;

  return {
    title,
    description: typeof args.description === 'string' ? args.description.trim() : undefined,
    location: typeof args.location === 'string' ? args.location.trim() : undefined,
    startDateTime,
    endDateTime,
    durationMinutes: Math.min(24 * 60, Math.max(1, durationMinutesRaw)),
    timeZone: typeof args.timeZone === 'string' ? args.timeZone.trim() : undefined,
    calendarId: typeof args.calendarId === 'string' ? args.calendarId.trim() : undefined,
  };
}

function ensureGoogleCalendarAuth(
  auth: GoogleCalendarBrowserAuth | null | undefined,
): GoogleCalendarBrowserAuth {
  if (!auth?.refreshToken) {
    throw new Error('Google Calendar is not connected in this browser.');
  }

  return auth;
}

function normalizeGoogleCalendarListEventsArgs(
  args: Record<string, unknown>,
): GoogleCalendarListEventsArgs {
  const timeMin = typeof args.timeMin === 'string' ? args.timeMin.trim() : undefined;
  const timeMax = typeof args.timeMax === 'string' ? args.timeMax.trim() : undefined;

  if (timeMin && Number.isNaN(Date.parse(timeMin))) {
    throw new Error('Google Calendar timeMin must be a valid ISO 8601 datetime.');
  }

  if (timeMax && Number.isNaN(Date.parse(timeMax))) {
    throw new Error('Google Calendar timeMax must be a valid ISO 8601 datetime.');
  }

  if (timeMin && timeMax && !(new Date(timeMax).getTime() > new Date(timeMin).getTime())) {
    throw new Error('Google Calendar timeMax must be after timeMin.');
  }

  const maxResultsRaw =
    typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
      ? Math.round(args.maxResults)
      : 10;

  return {
    timeMin,
    timeMax,
    query: typeof args.query === 'string' && args.query.trim().length > 0 ? args.query.trim() : undefined,
    maxResults: Math.min(50, Math.max(1, maxResultsRaw)),
    calendarId: typeof args.calendarId === 'string' ? args.calendarId.trim() : undefined,
  };
}

function normalizeGoogleCalendarUpdateEventArgs(
  args: Record<string, unknown>,
): GoogleCalendarUpdateEventArgs {
  const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : '';

  if (!eventId) {
    throw new Error('Google Calendar update requires a non-empty eventId.');
  }

  const startDateTime =
    typeof args.startDateTime === 'string' && args.startDateTime.trim().length > 0
      ? args.startDateTime.trim()
      : undefined;
  const endDateTime =
    typeof args.endDateTime === 'string' && args.endDateTime.trim().length > 0
      ? args.endDateTime.trim()
      : undefined;

  if (startDateTime && Number.isNaN(Date.parse(startDateTime))) {
    throw new Error('Google Calendar startDateTime must be a valid ISO 8601 datetime.');
  }

  if (endDateTime && Number.isNaN(Date.parse(endDateTime))) {
    throw new Error('Google Calendar endDateTime must be a valid ISO 8601 datetime.');
  }

  if (startDateTime && endDateTime && !(new Date(endDateTime).getTime() > new Date(startDateTime).getTime())) {
    throw new Error('Google Calendar endDateTime must be after startDateTime.');
  }

  const durationMinutes =
    typeof args.durationMinutes === 'number' && Number.isFinite(args.durationMinutes)
      ? Math.min(24 * 60, Math.max(1, Math.round(args.durationMinutes)))
      : undefined;

  return {
    eventId,
    title: typeof args.title === 'string' ? args.title.trim() : undefined,
    description: typeof args.description === 'string' ? args.description.trim() : undefined,
    location: typeof args.location === 'string' ? args.location.trim() : undefined,
    startDateTime,
    endDateTime,
    durationMinutes,
    timeZone: typeof args.timeZone === 'string' ? args.timeZone.trim() : undefined,
    calendarId: typeof args.calendarId === 'string' ? args.calendarId.trim() : undefined,
  };
}

function normalizeGoogleCalendarDeleteEventArgs(
  args: Record<string, unknown>,
): GoogleCalendarDeleteEventArgs {
  const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : '';

  if (!eventId) {
    throw new Error('Google Calendar delete requires a non-empty eventId.');
  }

  return {
    eventId,
    calendarId: typeof args.calendarId === 'string' ? args.calendarId.trim() : undefined,
  };
}

function getGoogleCalendarApiCalendarId(
  requestedCalendarId: string | undefined,
  googleAuth: GoogleCalendarBrowserAuth,
): string {
  return encodeURIComponent(requestedCalendarId || googleAuth.calendarId || GOOGLE_CALENDAR_DEFAULT_ID);
}

type GoogleCalendarApiEvent = {
  id?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
};

function mapGoogleCalendarEvent(event: GoogleCalendarApiEvent) {
  return {
    eventId: event.id ?? null,
    htmlLink: event.htmlLink ?? null,
    title: event.summary ?? '',
    description: event.description ?? null,
    location: event.location ?? null,
    startDateTime: event.start?.dateTime ?? null,
    endDateTime: event.end?.dateTime ?? null,
    timeZone: event.start?.timeZone ?? event.end?.timeZone ?? null,
    status: event.status ?? null,
  };
}

async function refreshGoogleCalendarAccessToken(
  refreshToken: string,
  env: EnvSource = process.env,
): Promise<string> {
  const { clientId, clientSecret } = getGoogleOAuthCredentials(env);
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => null)) as
    | { access_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !json?.access_token) {
    const details = json?.error_description || json?.error || `HTTP ${response.status}`;
    throw new Error(`Google access token refresh failed: ${details}`);
  }

  return json.access_token;
}

async function runGoogleCalendarCreateEvent(
  args: Record<string, unknown>,
  auth: GoogleCalendarBrowserAuth | null | undefined,
  env: EnvSource = process.env,
): Promise<Record<string, unknown>> {
  const normalized = normalizeGoogleCalendarCreateEventArgs(args);
  const googleAuth = ensureGoogleCalendarAuth(auth);
  const accessToken = await refreshGoogleCalendarAccessToken(googleAuth.refreshToken, env);
  const start = new Date(normalized.startDateTime);
  const end = normalized.endDateTime
    ? new Date(normalized.endDateTime)
    : new Date(start.getTime() + (normalized.durationMinutes ?? 60) * 60_000);

  if (!(end.getTime() > start.getTime())) {
    throw new Error('Google Calendar end time must be after start time.');
  }

  const calendarId = encodeURIComponent(
    normalized.calendarId || googleAuth.calendarId || GOOGLE_CALENDAR_DEFAULT_ID,
  );
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${calendarId}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: normalized.title,
      description: normalized.description,
      location: normalized.location,
      start: {
        dateTime: normalized.startDateTime,
        timeZone: normalized.timeZone,
      },
      end: {
        dateTime: normalized.endDateTime ?? end.toISOString(),
        timeZone: normalized.timeZone,
      },
    }),
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => null)) as
    | {
        id?: string;
        htmlLink?: string;
        summary?: string;
        description?: string;
        status?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    const details = json?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google Calendar create event failed: ${details}`);
  }

  return {
    ok: true,
    eventId: json?.id ?? null,
    htmlLink: json?.htmlLink ?? null,
    title: json?.summary ?? normalized.title,
    description: json?.description ?? normalized.description ?? null,
    startDateTime: json?.start?.dateTime ?? normalized.startDateTime,
    endDateTime: json?.end?.dateTime ?? normalized.endDateTime ?? end.toISOString(),
    status: json?.status ?? 'confirmed',
    calendarId: decodeURIComponent(calendarId),
  };
}

async function runGoogleCalendarListEvents(
  args: Record<string, unknown>,
  auth: GoogleCalendarBrowserAuth | null | undefined,
  env: EnvSource = process.env,
): Promise<Record<string, unknown>> {
  const normalized = normalizeGoogleCalendarListEventsArgs(args);
  const googleAuth = ensureGoogleCalendarAuth(auth);
  const accessToken = await refreshGoogleCalendarAccessToken(googleAuth.refreshToken, env);
  const calendarId = getGoogleCalendarApiCalendarId(normalized.calendarId, googleAuth);
  const url = new URL(`${GOOGLE_CALENDAR_API_BASE}/calendars/${calendarId}/events`);

  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', String(normalized.maxResults));
  if (normalized.timeMin) url.searchParams.set('timeMin', normalized.timeMin);
  if (normalized.timeMax) url.searchParams.set('timeMax', normalized.timeMax);
  if (normalized.query) url.searchParams.set('q', normalized.query);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => null)) as
    | { items?: GoogleCalendarApiEvent[]; error?: { message?: string } }
    | null;

  if (!response.ok) {
    const details = json?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google Calendar list events failed: ${details}`);
  }

  const events = (json?.items ?? []).map(mapGoogleCalendarEvent);

  return {
    ok: true,
    calendarId: decodeURIComponent(calendarId),
    count: events.length,
    events,
  };
}

async function fetchGoogleCalendarEvent(
  calendarId: string,
  eventId: string,
  accessToken: string,
): Promise<GoogleCalendarApiEvent> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    },
  );

  const json = (await response.json().catch(() => null)) as
    | (GoogleCalendarApiEvent & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    const details = json?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google Calendar fetch event failed: ${details}`);
  }

  return json ?? {};
}

async function runGoogleCalendarUpdateEvent(
  args: Record<string, unknown>,
  auth: GoogleCalendarBrowserAuth | null | undefined,
  env: EnvSource = process.env,
): Promise<Record<string, unknown>> {
  const normalized = normalizeGoogleCalendarUpdateEventArgs(args);
  const googleAuth = ensureGoogleCalendarAuth(auth);
  const accessToken = await refreshGoogleCalendarAccessToken(googleAuth.refreshToken, env);
  const calendarId = getGoogleCalendarApiCalendarId(normalized.calendarId, googleAuth);
  const current = await fetchGoogleCalendarEvent(calendarId, normalized.eventId, accessToken);
  const patch: Record<string, unknown> = {};

  if (normalized.title !== undefined) patch.summary = normalized.title;
  if (normalized.description !== undefined) patch.description = normalized.description;
  if (normalized.location !== undefined) patch.location = normalized.location;

  if (normalized.startDateTime) {
    const start = new Date(normalized.startDateTime);
    let endDateTime = normalized.endDateTime;

    if (!endDateTime && normalized.durationMinutes !== undefined) {
      endDateTime = new Date(start.getTime() + normalized.durationMinutes * 60_000).toISOString();
    }

    if (!endDateTime && current.start?.dateTime && current.end?.dateTime) {
      const currentDuration = new Date(current.end.dateTime).getTime() - new Date(current.start.dateTime).getTime();
      if (currentDuration > 0) {
        endDateTime = new Date(start.getTime() + currentDuration).toISOString();
      }
    }

    patch.start = {
      dateTime: normalized.startDateTime,
      timeZone: normalized.timeZone || current.start?.timeZone,
    };

    if (endDateTime) {
      patch.end = {
        dateTime: endDateTime,
        timeZone: normalized.timeZone || current.end?.timeZone || current.start?.timeZone,
      };
    }
  } else if (normalized.endDateTime) {
    patch.end = {
      dateTime: normalized.endDateTime,
      timeZone: normalized.timeZone || current.end?.timeZone || current.start?.timeZone,
    };
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Google Calendar update requires at least one field to change.');
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${calendarId}/events/${encodeURIComponent(normalized.eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
      cache: 'no-store',
    },
  );

  const json = (await response.json().catch(() => null)) as
    | (GoogleCalendarApiEvent & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    const details = json?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google Calendar update event failed: ${details}`);
  }

  return {
    ok: true,
    calendarId: decodeURIComponent(calendarId),
    ...mapGoogleCalendarEvent(json ?? {}),
  };
}

async function runGoogleCalendarDeleteEvent(
  args: Record<string, unknown>,
  auth: GoogleCalendarBrowserAuth | null | undefined,
  env: EnvSource = process.env,
): Promise<Record<string, unknown>> {
  const normalized = normalizeGoogleCalendarDeleteEventArgs(args);
  const googleAuth = ensureGoogleCalendarAuth(auth);
  const accessToken = await refreshGoogleCalendarAccessToken(googleAuth.refreshToken, env);
  const calendarId = getGoogleCalendarApiCalendarId(normalized.calendarId, googleAuth);
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${calendarId}/events/${encodeURIComponent(normalized.eventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    const details = json?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google Calendar delete event failed: ${details}`);
  }

  return {
    ok: true,
    deleted: true,
    eventId: normalized.eventId,
    calendarId: decodeURIComponent(calendarId),
  };
}

export async function executeLiveFunctionCalls(
  functionCalls: LiveFunctionCall[],
  model: LiveModelId,
  env: EnvSource = process.env,
  context: LiveToolExecutionContext = {},
): Promise<LiveFunctionResponse[]> {
  return Promise.all(
    functionCalls.map(async (call) => {
      if (call.name === TAVILY_SEARCH_FUNCTION_NAME && modelUsesTavilySearch(model)) {
        try {
          const result = await runTavilySearch(call.args, env);
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: true,
              ...result,
            },
          };
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: false,
              error: error instanceof Error ? error.message : 'Tavily search failed.',
            },
          };
        }
      }

      if (call.name === GOOGLE_CALENDAR_CREATE_EVENT_FUNCTION_NAME) {
        try {
          const result = await runGoogleCalendarCreateEvent(
            call.args,
            context.googleCalendarAuth,
            env,
          );
          return {
            id: call.id,
            name: call.name,
            response: result,
          };
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Google Calendar event creation failed.',
            },
          };
        }
      }

      if (call.name === GOOGLE_CALENDAR_LIST_EVENTS_FUNCTION_NAME) {
        try {
          const result = await runGoogleCalendarListEvents(call.args, context.googleCalendarAuth, env);
          return {
            id: call.id,
            name: call.name,
            response: result,
          };
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: false,
              error:
                error instanceof Error ? error.message : 'Google Calendar event listing failed.',
            },
          };
        }
      }

      if (call.name === GOOGLE_CALENDAR_UPDATE_EVENT_FUNCTION_NAME) {
        try {
          const result = await runGoogleCalendarUpdateEvent(call.args, context.googleCalendarAuth, env);
          return {
            id: call.id,
            name: call.name,
            response: result,
          };
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: false,
              error:
                error instanceof Error ? error.message : 'Google Calendar event update failed.',
            },
          };
        }
      }

      if (call.name === GOOGLE_CALENDAR_DELETE_EVENT_FUNCTION_NAME) {
        try {
          const result = await runGoogleCalendarDeleteEvent(call.args, context.googleCalendarAuth, env);
          return {
            id: call.id,
            name: call.name,
            response: result,
          };
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            response: {
              ok: false,
              error:
                error instanceof Error ? error.message : 'Google Calendar event deletion failed.',
            },
          };
        }
      }

      return {
        id: call.id,
        name: call.name,
        response: {
          ok: false,
          error: `Unsupported tool: ${call.name}`,
        },
      };
    }),
  );
}
