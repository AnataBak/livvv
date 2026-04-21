import { describe, expect, it } from 'vitest';
import { buildLiveServiceUrl, GeminiLiveClient } from '@/lib/client/gemini-live-client';

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

describe('GeminiLiveClient send guards', () => {
  // Regression: the microphone recorder keeps emitting audio chunks for a short
  // window after the server closes the websocket (e.g. quota rejection), so
  // sendAudio/sendText/sendVideo must not throw when the session is not
  // connected — otherwise the error surfaces inside the audio processor and
  // crashes the page.
  it('does not throw when send* is called before connect()', () => {
    const client = new GeminiLiveClient({ apiKey: 'test-key' });

    expect(() => client.sendAudio('YWJj')).not.toThrow();
    expect(() => client.sendText('hello')).not.toThrow();
    expect(() => client.sendVideo('YWJj')).not.toThrow();
  });
});
