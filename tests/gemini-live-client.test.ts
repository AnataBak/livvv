import { describe, expect, it } from 'vitest';
import { buildLiveServiceUrl } from '@/lib/client/gemini-live-client';

describe('buildLiveServiceUrl', () => {
  it('builds a direct browser websocket URL for an API key', () => {
    const url = buildLiveServiceUrl({ apiKey: 'abc 123' });

    expect(url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=abc%20123',
    );
  });

  it('builds a constrained websocket URL for an ephemeral token', () => {
    const url = buildLiveServiceUrl({ accessToken: 'short token' });

    expect(url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=short%20token',
    );
  });
});
