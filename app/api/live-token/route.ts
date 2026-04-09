import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { LIVE_MODEL } from '@/lib/live-session-config';
import { buildLiveTokenConfig, getGeminiApiKey } from '@/lib/server/live-token';

export const runtime = 'edge';

export async function POST() {
  try {
    const now = Date.now();
    const config = buildLiveTokenConfig(now);
    const client = new GoogleGenAI({ apiKey: getGeminiApiKey() });
    const token = await client.authTokens.create({
      config,
    });

    if (!token.name) {
      throw new Error('Gemini did not return an ephemeral token.');
    }

    return NextResponse.json({
      token: token.name,
      model: LIVE_MODEL,
      expireTime: config.expireTime,
      newSessionExpireTime: config.newSessionExpireTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create an ephemeral token.';

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
