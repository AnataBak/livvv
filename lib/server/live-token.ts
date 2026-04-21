import { Modality } from '@google/genai';
import {
  LIVE_MODEL,
  LIVE_WEB_SEARCH_ENABLED,
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
) {
  const config: Record<string, unknown> = {
    responseModalities: [Modality.AUDIO],
    sessionResumption: {},
    temperature: 0.6,
    tools: webSearchEnabled ? [{ googleSearch: {} }] : undefined,
  };

  if (thinkingLevel) {
    config.thinkingConfig = { thinkingLevel };
  }

  return {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    liveConnectConstraints: {
      model: LIVE_MODEL,
      config,
    },
    httpOptions: {
      apiVersion: 'v1alpha',
    },
  };
}
