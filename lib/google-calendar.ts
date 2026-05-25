export const GOOGLE_CALENDAR_AUTH_STORAGE_KEY = 'google-calendar-auth';
export const GOOGLE_CALENDAR_CREATE_EVENT_FUNCTION_NAME = 'google_calendar_create_event';
export const GOOGLE_CALENDAR_LIST_EVENTS_FUNCTION_NAME = 'google_calendar_list_events';
export const GOOGLE_CALENDAR_UPDATE_EVENT_FUNCTION_NAME = 'google_calendar_update_event';
export const GOOGLE_CALENDAR_DELETE_EVENT_FUNCTION_NAME = 'google_calendar_delete_event';
export const GOOGLE_CALENDAR_DEFAULT_ID = 'primary';
export const GOOGLE_CALENDAR_OAUTH_MESSAGE_TYPE = 'google-calendar-oauth-result';

export type GoogleCalendarBrowserAuth = {
  refreshToken: string;
  calendarId?: string;
  connectedAt: string;
};

export const GOOGLE_CALENDAR_CREATE_EVENT_DECLARATION = {
  name: GOOGLE_CALENDAR_CREATE_EVENT_FUNCTION_NAME,
  description:
    'Create an event in the connected Google Calendar. Use absolute ISO datetimes and the user timezone when possible.',
  parameters: {
    type: 'OBJECT',
    properties: {
      title: {
        type: 'STRING',
        description: 'Event title / summary.',
      },
      description: {
        type: 'STRING',
        description: 'Optional event description.',
      },
      location: {
        type: 'STRING',
        description: 'Optional event location.',
      },
      startDateTime: {
        type: 'STRING',
        description: 'Event start in ISO 8601 format, for example 2026-05-26T18:00:00+03:00.',
      },
      endDateTime: {
        type: 'STRING',
        description: 'Optional end datetime in ISO 8601 format.',
      },
      durationMinutes: {
        type: 'INTEGER',
        description: 'Optional duration in minutes when endDateTime is omitted. Defaults to 60.',
      },
      timeZone: {
        type: 'STRING',
        description: 'IANA timezone for the event, for example Europe/Moscow.',
      },
      calendarId: {
        type: 'STRING',
        description: 'Optional target calendar id. Defaults to the connected primary calendar.',
      },
    },
    required: ['title', 'startDateTime'],
  },
} as const;

export const GOOGLE_CALENDAR_LIST_EVENTS_DECLARATION = {
  name: GOOGLE_CALENDAR_LIST_EVENTS_FUNCTION_NAME,
  description:
    'Read events from the connected Google Calendar for a time range or search query. Use this to answer questions about today, tomorrow, this week, or this month.',
  parameters: {
    type: 'OBJECT',
    properties: {
      timeMin: {
        type: 'STRING',
        description: 'Optional inclusive range start in ISO 8601 format.',
      },
      timeMax: {
        type: 'STRING',
        description: 'Optional exclusive range end in ISO 8601 format.',
      },
      query: {
        type: 'STRING',
        description: 'Optional full-text search query for event title, description, or location.',
      },
      maxResults: {
        type: 'INTEGER',
        description: 'Maximum number of events to return, from 1 to 50. Defaults to 10.',
      },
      calendarId: {
        type: 'STRING',
        description: 'Optional target calendar id. Defaults to the connected primary calendar.',
      },
    },
    required: [],
  },
} as const;

export const GOOGLE_CALENDAR_UPDATE_EVENT_DECLARATION = {
  name: GOOGLE_CALENDAR_UPDATE_EVENT_FUNCTION_NAME,
  description:
    'Update an existing event in the connected Google Calendar. Use eventId from a prior list/read result.',
  parameters: {
    type: 'OBJECT',
    properties: {
      eventId: {
        type: 'STRING',
        description: 'Google Calendar event id to update.',
      },
      title: {
        type: 'STRING',
        description: 'Optional new event title / summary.',
      },
      description: {
        type: 'STRING',
        description: 'Optional new event description.',
      },
      location: {
        type: 'STRING',
        description: 'Optional new event location.',
      },
      startDateTime: {
        type: 'STRING',
        description: 'Optional new event start in ISO 8601 format.',
      },
      endDateTime: {
        type: 'STRING',
        description: 'Optional new event end in ISO 8601 format.',
      },
      durationMinutes: {
        type: 'INTEGER',
        description: 'Optional duration in minutes used when changing startDateTime without explicit endDateTime.',
      },
      timeZone: {
        type: 'STRING',
        description: 'Optional IANA timezone for updated start/end datetimes.',
      },
      calendarId: {
        type: 'STRING',
        description: 'Optional target calendar id. Defaults to the connected primary calendar.',
      },
    },
    required: ['eventId'],
  },
} as const;

export const GOOGLE_CALENDAR_DELETE_EVENT_DECLARATION = {
  name: GOOGLE_CALENDAR_DELETE_EVENT_FUNCTION_NAME,
  description:
    'Delete an existing event from the connected Google Calendar. Use eventId from a prior list/read result.',
  parameters: {
    type: 'OBJECT',
    properties: {
      eventId: {
        type: 'STRING',
        description: 'Google Calendar event id to delete.',
      },
      calendarId: {
        type: 'STRING',
        description: 'Optional target calendar id. Defaults to the connected primary calendar.',
      },
    },
    required: ['eventId'],
  },
} as const;
