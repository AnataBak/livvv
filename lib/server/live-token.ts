import { Modality } from '@google/genai';
import {
  LIVE_MODEL_DEFAULT,
  LIVE_WEB_SEARCH_ENABLED,
  modelSupportsContextWindowCompression,
  modelSupportsSessionResumption,
  modelSupportsThinkingLevel,
  type LiveModelId,
  type LiveThinkingLevel,
} from '@/lib/live-session-config';

type EnvSource = Record<string, string | undefined>;

export function getGeminiApiKey(env: EnvSource = process.env) {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it to .env.local for local runs and to your Vercel project environment variables before deploying.',
    );
  }

  return apiKey;
}

export function buildLiveTokenConfig(
  now = Date.now(),
  webSearchEnabled: boolean = LIVE_WEB_SEARCH_ENABLED,
  thinkingLevel?: LiveThinkingLevel,
  model: LiveModelId = LIVE_MODEL_DEFAULT,
) {
  const config: Record<string, unknown> = {
    responseModalities: [Modality.AUDIO],
    temperature: 0.6,
    tools: webSearchEnabled ? [{ googleSearch: {} }] : undefined,
  };

  if (modelSupportsSessionResumption(model)) {
    config.sessionResumption = {};
  }
  if (modelSupportsContextWindowCompression(model)) {
    config.contextWindowCompression = { slidingWindow: {} };
  }
  if (thinkingLevel && modelSupportsThinkingLevel(model)) {
    config.thinkingConfig = { thinkingLevel };
  }

  return {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    liveConnectConstraints: {
      model,
      config,
    },
    httpOptions: {
      apiVersion: 'v1alpha',
    },
  };
}
