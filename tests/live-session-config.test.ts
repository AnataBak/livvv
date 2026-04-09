import { describe, expect, it } from 'vitest';
import { buildSessionSetupMessage, LIVE_MODEL } from '@/lib/live-session-config';
import { buildLiveTokenConfig, getGeminiApiKey } from '@/lib/server/live-token';

describe('live session config', () => {
  it('builds the browser websocket setup payload', () => {
    const payload = buildSessionSetupMessage();

    expect(payload.setup.model).toBe(`models/${LIVE_MODEL}`);
    expect(payload.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(payload.setup.generationConfig.temperature).toBe(0.6);
    expect(payload.setup.inputAudioTranscription).toEqual({});
    expect(payload.setup.outputAudioTranscription).toEqual({});
  });

  it('builds the browser websocket setup payload with custom temperature', () => {
    const payload = buildSessionSetupMessage(1.2);

    expect(payload.setup.generationConfig.temperature).toBe(1.2);
  });

  it('builds a constrained ephemeral token request', () => {
    const payload = buildLiveTokenConfig(0);

    expect(payload.uses).toBe(1);
    expect(payload.liveConnectConstraints.model).toBe(LIVE_MODEL);
    expect(payload.liveConnectConstraints.config.responseModalities).toEqual(['AUDIO']);
    expect(payload.httpOptions.apiVersion).toBe('v1alpha');
    expect(payload.newSessionExpireTime).toBe('1970-01-01T00:01:00.000Z');
    expect(payload.expireTime).toBe('1970-01-01T00:30:00.000Z');
  });

  it('throws a clear error when GEMINI_API_KEY is missing', () => {
    expect(() => getGeminiApiKey({})).toThrow(/GEMINI_API_KEY is not set/);
  });
});
