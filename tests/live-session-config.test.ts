import { describe, expect, it } from 'vitest';
import {
  buildSessionSetupMessage,
  isLiveThinkingLevel,
  LIVE_MODEL,
  LIVE_THINKING_LEVELS,
  LIVE_THINKING_LEVEL_DEFAULT,
  SYSTEM_INSTRUCTION,
} from '@/lib/live-session-config';
import { buildLiveTokenConfig, getGeminiApiKey } from '@/lib/server/live-token';

describe('live session config', () => {
  it('builds the browser websocket setup payload', () => {
    const payload = buildSessionSetupMessage();

    expect(payload.setup.model).toBe(`models/${LIVE_MODEL}`);
    const generationConfig = payload.setup.generationConfig as Record<string, unknown>;
    expect(generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(generationConfig.temperature).toBe(0.6);
    const speechConfig = generationConfig.speechConfig as {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: string } };
    };
    expect(speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
    expect(generationConfig.thinkingConfig).toBeUndefined();
    expect(payload.setup.inputAudioTranscription).toEqual({});
    expect(payload.setup.outputAudioTranscription).toEqual({});
  });

  it('builds the browser websocket setup payload with custom temperature and voice', () => {
    const payload = buildSessionSetupMessage(1.2, 'KORE');
    const generationConfig = payload.setup.generationConfig as Record<string, unknown>;
    const speechConfig = generationConfig.speechConfig as {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: string } };
    };

    expect(generationConfig.temperature).toBe(1.2);
    expect(speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('KORE');
  });

  it('adds Google Search tool when web search is enabled', () => {
    const payload = buildSessionSetupMessage(0.6, 'Puck', true);

    expect(payload.setup.tools).toEqual([{ googleSearch: {} }]);
  });

  it('adds thinkingConfig when a thinking level is provided', () => {
    const payload = buildSessionSetupMessage(0.6, 'Puck', false, 'medium');
    const generationConfig = payload.setup.generationConfig as Record<string, unknown>;

    expect(generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
  });

  it('enables session resumption (empty handle) and sliding-window compression by default', () => {
    const payload = buildSessionSetupMessage();

    expect(payload.setup.sessionResumption).toEqual({});
    expect(payload.setup.contextWindowCompression).toEqual({ slidingWindow: {} });
  });

  it('passes a session resumption handle through to the setup payload', () => {
    const payload = buildSessionSetupMessage(0.6, 'Puck', false, undefined, 'handle-abc');

    expect(payload.setup.sessionResumption).toEqual({ handle: 'handle-abc' });
  });

  it('uses the default SYSTEM_INSTRUCTION when no custom prompt is provided', () => {
    const payload = buildSessionSetupMessage();
    const systemInstruction = payload.setup.systemInstruction as { parts: Array<{ text: string }> };

    expect(systemInstruction.parts[0].text).toBe(SYSTEM_INSTRUCTION);
  });

  it('substitutes a custom system instruction when provided', () => {
    const custom = 'Ты режиссёр-консультант, отвечай только списками идей.';
    const payload = buildSessionSetupMessage(0.6, 'Puck', false, undefined, undefined, custom);
    const systemInstruction = payload.setup.systemInstruction as { parts: Array<{ text: string }> };

    expect(systemInstruction.parts[0].text).toBe(custom);
  });

  it('defaults the thinking level to "minimal"', () => {
    expect(LIVE_THINKING_LEVEL_DEFAULT).toBe('minimal');
    expect(LIVE_THINKING_LEVELS).toEqual(['minimal', 'low', 'medium', 'high']);
  });

  it('validates supported thinking levels', () => {
    expect(isLiveThinkingLevel('minimal')).toBe(true);
    expect(isLiveThinkingLevel('high')).toBe(true);
    expect(isLiveThinkingLevel('extreme')).toBe(false);
    expect(isLiveThinkingLevel(undefined)).toBe(false);
    expect(isLiveThinkingLevel(2)).toBe(false);
  });

  it('builds a constrained ephemeral token request', () => {
    const payload = buildLiveTokenConfig(0);

    expect(payload.uses).toBe(1);
    expect(payload.liveConnectConstraints.model).toBe(LIVE_MODEL);
    const config = payload.liveConnectConstraints.config as Record<string, unknown>;
    expect(config.responseModalities).toEqual(['AUDIO']);
    expect(config.thinkingConfig).toBeUndefined();
    expect(payload.httpOptions.apiVersion).toBe('v1alpha');
    expect(payload.newSessionExpireTime).toBe('1970-01-01T00:01:00.000Z');
    expect(payload.expireTime).toBe('1970-01-01T00:30:00.000Z');
  });

  it('adds Google Search tool to constrained token config when enabled', () => {
    const payload = buildLiveTokenConfig(0, true);
    const config = payload.liveConnectConstraints.config as Record<string, unknown>;

    expect(config.tools).toEqual([{ googleSearch: {} }]);
  });

  it('adds thinkingConfig to constrained token config when thinking level is provided', () => {
    const payload = buildLiveTokenConfig(0, false, 'high');
    const config = payload.liveConnectConstraints.config as Record<string, unknown>;

    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'high' });
  });

  it('enables session resumption and context window compression in the token config', () => {
    const payload = buildLiveTokenConfig(0);
    const config = payload.liveConnectConstraints.config as Record<string, unknown>;

    expect(config.sessionResumption).toEqual({});
    expect(config.contextWindowCompression).toEqual({ slidingWindow: {} });
  });

  it('throws a clear error when GEMINI_API_KEY is missing', () => {
    expect(() => getGeminiApiKey({})).toThrow(/GEMINI_API_KEY is not set/);
  });
});
