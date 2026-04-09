import { NextRequest, NextResponse } from 'next/server';
import WebSocket from 'ws';
import { buildSessionSetupMessage } from '@/lib/live-session-config';
import { parseLiveMessage } from '@/lib/client/live-message-parser';
import type { LiveServerEvent } from '@/lib/client/live-message-parser';

function buildLiveServiceUrl(accessToken: string) {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(accessToken)}`;
}

export const runtime = 'nodejs';

// Store active connections
const connections = new Map<string, {
  geminiWs: WebSocket;
  messages: LiveServerEvent[];
  isConnected: boolean;
  sessionId: string;
}>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  // WebSocket upgrade not supported in serverless, use HTTP polling instead
  return new Response('Use POST for proxy operations', { status: 400 });
}

// HTTP-based proxy using polling
export async function POST(request: NextRequest) {
  const { action, sessionId, message, token } = await request.json();

  try {
    if (action === 'connect') {
      if (!token) {
        return NextResponse.json({ error: 'Missing token' }, { status: 400 });
      }

      const newSessionId = Math.random().toString(36).substring(7);

      try {
        const geminiUrl = buildLiveServiceUrl(token);
        const geminiWs = new WebSocket(geminiUrl);

        const connection = {
          geminiWs,
          messages: [] as LiveServerEvent[],
          isConnected: false,
          sessionId: newSessionId
        };

        // Wait for Gemini WebSocket to open
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

          geminiWs.on('open', () => {
            clearTimeout(timeout);
            connection.isConnected = true;
            geminiWs.send(JSON.stringify(buildSessionSetupMessage()));
            resolve();
          });

          geminiWs.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });

        // Store connection after successful connection
        connections.set(newSessionId, connection);

        geminiWs.on('message', (data: WebSocket.Data) => {
          try {
            const rawData = data.toString();
            const parsed = JSON.parse(rawData);
            const events = parseLiveMessage(parsed);
            connection.messages.push(...events);
          } catch (error) {
            console.error('Error parsing Gemini message:', error);
          }
        });

        geminiWs.on('error', (error: Error) => {
          console.error('Gemini WebSocket error:', error);
          connection.isConnected = false;
        });

        return NextResponse.json({ sessionId: newSessionId });
      } catch (error) {
        console.error('Failed to connect to Gemini:', error);
        return NextResponse.json({ error: 'Failed to connect to Gemini' }, { status: 500 });
      }
    }

    if (action === 'send') {
      const connection = connections.get(sessionId);
      if (!connection || !connection.isConnected) {
        return NextResponse.json({ error: 'Connection not found or closed' }, { status: 404 });
      }

      connection.geminiWs.send(JSON.stringify(message));
      return NextResponse.json({ success: true });
    }

    if (action === 'receive') {
      const connection = connections.get(sessionId);
      if (!connection) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
      }

      const messages = connection.messages.splice(0);
      return NextResponse.json({ messages });
    }

    if (action === 'close') {
      const connection = connections.get(sessionId);
      if (connection) {
        connection.geminiWs.close();
        connections.delete(sessionId);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}