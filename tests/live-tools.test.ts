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
});
