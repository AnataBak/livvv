export const GOOGLE_CALENDAR_AUTH_STORAGE_KEY = 'google-calendar-auth';
export const GOOGLE_CALENDAR_CREATE_EVENT_FUNCTION_NAME = 'google_calendar_create_event';
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
