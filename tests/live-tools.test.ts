import { describe, expect, it, vi } from 'vitest';
import { executeLiveFunctionCalls } from '@/lib/server/live-tools';

describe('executeLiveFunctionCalls', () => {
  it('returns a clear error when Google Calendar is not connected', async () => {
    const [response] = await executeLiveFunctionCalls(
      [
        {
          id: '1',
          name: 'google_calendar_create_event',
          args: {
            title: 'Watch TV',
            startDateTime: '2026-05-26T18:00:00+03:00',
          },
        },
      ],
      'gemini-3.1-flash-live-preview',
    );

    expect(response.response).toEqual({
      ok: false,
      error: 'Google Calendar is not connected in this browser.',
    });
  });

  it('creates a Google Calendar event through the REST API when auth is present', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'evt-1',
          htmlLink: 'https://calendar.google.com/event?eid=evt-1',
          summary: 'Watch TV',
          description: 'Channel 6',
          status: 'confirmed',
          start: { dateTime: '2026-05-26T18:00:00+03:00' },
          end: { dateTime: '2026-05-26T19:30:00+03:00' },
        }),
      });

    const originalFetch = global.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const [response] = await executeLiveFunctionCalls(
        [
          {
            id: '1',
            name: 'google_calendar_create_event',
            args: {
              title: 'Watch TV',
              description: 'Channel 6',
              startDateTime: '2026-05-26T18:00:00+03:00',
              durationMinutes: 90,
            },
          },
        ],
        'gemini-3.1-flash-live-preview',
        {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        {
          googleCalendarAuth: {
            refreshToken: 'refresh-123',
            connectedAt: '2026-05-25T00:00:00.000Z',
          },
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.response).toEqual({
        ok: true,
        eventId: 'evt-1',
        htmlLink: 'https://calendar.google.com/event?eid=evt-1',
        title: 'Watch TV',
        description: 'Channel 6',
        startDateTime: '2026-05-26T18:00:00+03:00',
        endDateTime: '2026-05-26T19:30:00+03:00',
        status: 'confirmed',
        calendarId: 'primary',
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('lists Google Calendar events for a requested time range', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'evt-1',
              htmlLink: 'https://calendar.google.com/event?eid=evt-1',
              summary: 'Ужин',
              description: 'С друзьями',
              location: 'Центр',
              status: 'confirmed',
              start: { dateTime: '2026-05-26T19:00:00+03:00', timeZone: 'Europe/Moscow' },
              end: { dateTime: '2026-05-26T20:00:00+03:00', timeZone: 'Europe/Moscow' },
            },
          ],
        }),
      });

    const originalFetch = global.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const [response] = await executeLiveFunctionCalls(
        [
          {
            id: '1',
            name: 'google_calendar_list_events',
            args: {
              timeMin: '2026-05-26T00:00:00+03:00',
              timeMax: '2026-05-27T00:00:00+03:00',
              maxResults: 5,
            },
          },
        ],
        'gemini-3.1-flash-live-preview',
        {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        {
          googleCalendarAuth: {
            refreshToken: 'refresh-123',
            connectedAt: '2026-05-25T00:00:00.000Z',
          },
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.response).toEqual({
        ok: true,
        calendarId: 'primary',
        count: 1,
        events: [
          {
            eventId: 'evt-1',
            htmlLink: 'https://calendar.google.com/event?eid=evt-1',
            title: 'Ужин',
            description: 'С друзьями',
            location: 'Центр',
            startDateTime: '2026-05-26T19:00:00+03:00',
            endDateTime: '2026-05-26T20:00:00+03:00',
            timeZone: 'Europe/Moscow',
            status: 'confirmed',
          },
        ],
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('updates a Google Calendar event', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'evt-1',
          summary: 'Старое название',
          start: { dateTime: '2026-05-26T19:00:00+03:00', timeZone: 'Europe/Moscow' },
          end: { dateTime: '2026-05-26T20:00:00+03:00', timeZone: 'Europe/Moscow' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'evt-1',
          htmlLink: 'https://calendar.google.com/event?eid=evt-1',
          summary: 'Новое название',
          status: 'confirmed',
          start: { dateTime: '2026-05-26T20:00:00+03:00', timeZone: 'Europe/Moscow' },
          end: { dateTime: '2026-05-26T21:00:00+03:00', timeZone: 'Europe/Moscow' },
        }),
      });

    const originalFetch = global.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const [response] = await executeLiveFunctionCalls(
        [
          {
            id: '1',
            name: 'google_calendar_update_event',
            args: {
              eventId: 'evt-1',
              title: 'Новое название',
              startDateTime: '2026-05-26T20:00:00+03:00',
            },
          },
        ],
        'gemini-3.1-flash-live-preview',
        {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        {
          googleCalendarAuth: {
            refreshToken: 'refresh-123',
            connectedAt: '2026-05-25T00:00:00.000Z',
          },
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(response.response).toEqual({
        ok: true,
        calendarId: 'primary',
        eventId: 'evt-1',
        htmlLink: 'https://calendar.google.com/event?eid=evt-1',
        title: 'Новое название',
        description: null,
        location: null,
        startDateTime: '2026-05-26T20:00:00+03:00',
        endDateTime: '2026-05-26T21:00:00+03:00',
        timeZone: 'Europe/Moscow',
        status: 'confirmed',
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('deletes a Google Calendar event', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

    const originalFetch = global.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const [response] = await executeLiveFunctionCalls(
        [
          {
            id: '1',
            name: 'google_calendar_delete_event',
            args: {
              eventId: 'evt-1',
            },
          },
        ],
        'gemini-3.1-flash-live-preview',
        {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        {
          googleCalendarAuth: {
            refreshToken: 'refresh-123',
            connectedAt: '2026-05-25T00:00:00.000Z',
          },
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.response).toEqual({
        ok: true,
        deleted: true,
        eventId: 'evt-1',
        calendarId: 'primary',
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});
