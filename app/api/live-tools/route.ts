import { NextResponse } from 'next/server';
import { LIVE_MODEL_DEFAULT, isLiveModelId } from '@/lib/live-session-config';
import {
  executeLiveFunctionCalls,
  type LiveFunctionCall,
} from '@/lib/server/live-tools';
import type { GoogleCalendarBrowserAuth } from '@/lib/google-calendar';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const functionCalls = Array.isArray(body?.functionCalls)
      ? (body.functionCalls as LiveFunctionCall[])
      : [];
    const model = isLiveModelId(body?.model) ? body.model : LIVE_MODEL_DEFAULT;
    const googleCalendarAuth =
      body?.googleCalendarAuth &&
      typeof body.googleCalendarAuth === 'object' &&
      typeof body.googleCalendarAuth.refreshToken === 'string'
        ? (body.googleCalendarAuth as GoogleCalendarBrowserAuth)
        : null;

    if (functionCalls.length === 0) {
      return NextResponse.json({ error: 'No function calls provided.' }, { status: 400 });
    }

    const functionResponses = await executeLiveFunctionCalls(functionCalls, model, process.env, {
      googleCalendarAuth,
    });

    return NextResponse.json({ functionResponses });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to execute Live tool calls.';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
