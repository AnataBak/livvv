import {
  AUDIO_INPUT_SAMPLE_RATE,
  LIVE_MODEL_DEFAULT,
  buildSessionSetupMessage,
  type LiveModelId,
  type LiveThinkingLevel,
} from '@/lib/live-session-config';
import { parseLiveMessage, type LiveServerEvent } from '@/lib/client/live-message-parser';

type ServerMessageShape = {
  setupComplete?: unknown;
  sessionResumptionUpdate?: { resumable?: boolean };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
  };
  error?: { message?: string };
};

function peakOfBase64Pcm16(base64: string): number | null {
  if (typeof atob !== 'function') return null;
  try {
    // Sample only a slice of the base64 string to keep this cheap even on
    // 20KB audio chunks. A middle slice is representative enough to tell
    // silent-PCM (all zeros) from real speech.
    const start = Math.floor(base64.length * 0.25);
    const slice = base64.slice(start, start + 2048);
    const bytes = atob(slice);
    let peak = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const lo = bytes.charCodeAt(i);
      const hi = bytes.charCodeAt(i + 1);
      let sample = (hi << 8) | lo;
      if (sample & 0x8000) sample = sample - 0x10000;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }
    return peak / 32768;
  } catch {
    return null;
  }
}

export function summarizeServerMessage(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'unknown';
  const msg = raw as ServerMessageShape;
  const bits: string[] = [];

  if (msg.setupComplete) bits.push('setup-complete');
  if (msg.error?.message) bits.push(`error="${msg.error.message}"`);

  const sc = msg.serverContent;
  if (sc) {
    const parts = sc.modelTurn?.parts ?? [];
    let audioBytes = 0;
    let audioChunks = 0;
    let peakSum = 0;
    let peakCount = 0;
    const textSnippets: string[] = [];
    for (const p of parts) {
      if (p.inlineData?.data) {
        audioChunks += 1;
        audioBytes += p.inlineData.data.length;
        const peak = peakOfBase64Pcm16(p.inlineData.data);
        if (peak !== null) {
          peakSum += peak;
          peakCount += 1;
        }
      }
      if (typeof p.text === 'string' && p.text.length > 0) {
        textSnippets.push(p.text);
      }
    }
    if (audioChunks > 0) {
      const peakLabel = peakCount > 0
        ? (peakSum / peakCount < 0.001 ? ', SILENT' : `, peak=${(peakSum / peakCount).toFixed(2)}`)
        : '';
      bits.push(`audio×${audioChunks} (${audioBytes}B${peakLabel})`);
    }
    if (textSnippets.length > 0) {
      const joined = textSnippets.join('').replace(/\s+/g, ' ').trim();
      const preview = joined.length > 80 ? `${joined.slice(0, 80)}…` : joined;
      bits.push(`TEXT-PART×${textSnippets.length} "${preview}"`);
    }
    const out = sc.outputTranscription;
    if (out?.text) {
      const t = out.text.replace(/\s+/g, ' ').trim();
      const preview = t.length > 60 ? `${t.slice(0, 60)}…` : t;
      bits.push(`out-trans${out.finished ? '✔' : ''}="${preview}"`);
    }
    const inp = sc.inputTranscription;
    if (inp?.text) {
      const t = inp.text.replace(/\s+/g, ' ').trim();
      const preview = t.length > 60 ? `${t.slice(0, 60)}…` : t;
      bits.push(`in-trans${inp.finished ? '✔' : ''}="${preview}"`);
    }
    if (sc.interrupted) bits.push('INTERRUPTED');
    if (sc.generationComplete) bits.push('generation-complete');
    if (sc.turnComplete) bits.push('turn-complete');
  }

  if (msg.sessionResumptionUpdate) {
    bits.push(`resumption-update(resumable=${Boolean(msg.sessionResumptionUpdate.resumable)})`);
  }

  return bits.length > 0 ? bits.join(' | ') : 'empty';
}

type ClientCallbacks = {
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onEvent?: (event: LiveServerEvent) => void;
  onError?: (message: string) => void;
};

type GeminiLiveClientAuth =
  | { apiKey: string; accessToken?: never }
  | { accessToken: string; apiKey?: never };

export function buildLiveServiceUrl(auth: GeminiLiveClientAuth) {
  if ('apiKey' in auth && typeof auth.apiKey === 'string') {
    return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(auth.apiKey)}`;
  }

  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(auth.accessToken || '')}`;
}

export class GeminiLiveClient {
  private sessionId: string | null = null;
  private auth: GeminiLiveClientAuth;
  private callbacks: ClientCallbacks;
  private temperature: number;
  private voice: string;
  private webSearchEnabled: boolean;
  private thinkingLevel: LiveThinkingLevel | undefined;
  private resumptionHandle: string | undefined;
  private systemInstruction: string | undefined;
  private model: LiveModelId;
  private pollInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private socket: WebSocket | null = null;

  constructor(
    auth: GeminiLiveClientAuth,
    callbacks: ClientCallbacks = {},
    temperature: number = 0.6,
    voice: string = 'Puck',
    webSearchEnabled: boolean = false,
    thinkingLevel?: LiveThinkingLevel,
    resumptionHandle?: string,
    systemInstruction?: string,
    model: LiveModelId = LIVE_MODEL_DEFAULT,
  ) {
    this.auth = auth;
    this.callbacks = callbacks;
    this.temperature = temperature;
    this.voice = voice;
    this.webSearchEnabled = webSearchEnabled;
    this.thinkingLevel = thinkingLevel;
    this.resumptionHandle = resumptionHandle;
    this.systemInstruction = systemInstruction;
    this.model = model;
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    if ('apiKey' in this.auth && this.auth.apiKey) {
      // Direct WebSocket connection for API key
      await this.connectDirect();
    } else if ('accessToken' in this.auth && this.auth.accessToken) {
      // Proxy connection for access token
      await this.connectViaProxy();
    } else {
      throw new Error('Invalid authentication');
    }
  }

  private async connectDirect() {
    const serviceUrl = buildLiveServiceUrl(this.auth);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(serviceUrl);
      this.socket = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify(
            buildSessionSetupMessage(
              this.temperature,
              this.voice,
              this.webSearchEnabled,
              this.thinkingLevel,
              this.resumptionHandle,
              this.systemInstruction,
              this.model,
            ),
          ),
        );
        this.callbacks.onOpen?.();
        this.isConnected = true;
        resolve();
      };

      socket.onerror = () => {
        const message = 'Could not connect to Gemini Live.';
        this.callbacks.onError?.(message);
        reject(new Error(message));
      };

      socket.onclose = (event) => {
        this.callbacks.onClose?.(event.reason || 'Connection closed.');
        this.isConnected = false;
      };

      socket.onmessage = async (event) => {
        try {
          const rawData = await this.readMessageData(event.data);
          const parsed = JSON.parse(rawData);
          if (typeof window !== 'undefined') {
            // Diagnostic: compact summary visible without expanding objects.
            // Shows per-message what Gemini actually sent — audio bytes, text
            // parts, transcripts, interrupt/turn-complete flags.
            console.debug('[gemini-live]', summarizeServerMessage(parsed), parsed);
          }
          const events = parseLiveMessage(parsed);

          for (const liveEvent of events) {
            this.callbacks.onEvent?.(liveEvent);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to parse Gemini Live response.';
          this.callbacks.onError?.(message);
        }
      };
    });
  }

  private async connectViaProxy() {
    const token = (this.auth as { accessToken: string }).accessToken;

    try {
      const response = await fetch('/api/live-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'connect',
          token,
          webSearchEnabled: this.webSearchEnabled,
          thinkingLevel: this.thinkingLevel,
          resumptionHandle: this.resumptionHandle,
          systemInstruction: this.systemInstruction,
          model: this.model,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.sessionId) {
        throw new Error(data.error || 'Failed to connect to proxy');
      }

      this.sessionId = data.sessionId;

      // Wait for setup-complete event before starting polling
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Setup timeout'));
        }, 5000);

        // Start polling to receive messages
        this.startPolling();

        const originalOnEvent = this.callbacks.onEvent;
        this.callbacks.onEvent = (event) => {
          if (event.type === 'setup-complete') {
            clearTimeout(timeout);
            this.callbacks.onEvent = originalOnEvent;
            this.isConnected = true;
            this.callbacks.onOpen?.();
            resolve();
          }
          originalOnEvent?.(event);
        };

        const originalOnError = this.callbacks.onError;
        this.callbacks.onError = (message) => {
          clearTimeout(timeout);
          this.callbacks.onError = originalOnError;
          reject(new Error(message));
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect to Gemini Live.';
      this.callbacks.onError?.(message);
      throw new Error(message);
    }
  }

  sendText(text: string) {
    this.send({
      realtimeInput: {
        text,
      },
    });
  }

  sendAudio(base64Audio: string) {
    this.send({
      realtimeInput: {
        audio: {
          data: base64Audio,
          mimeType: `audio/pcm;rate=${AUDIO_INPUT_SAMPLE_RATE}`,
        },
      },
    });
  }

  sendVideo(base64Image: string, mimeType = 'image/jpeg') {
    this.send({
      realtimeInput: {
        video: {
          data: base64Image,
          mimeType,
        },
      },
    });
  }

  close() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    if (this.sessionId) {
      fetch('/api/live-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close',
          sessionId: this.sessionId,
        }),
      }).catch(console.error);
    }

    this.isConnected = false;
    this.sessionId = null;
    this.callbacks.onClose?.('Connection closed.');
  }

  private send(payload: unknown) {
    if (!this.isConnected) {
      throw new Error('Gemini Live session is not connected.');
    }

    if (this.socket) {
      // Direct WebSocket mode
      this.socket.send(JSON.stringify(payload));
    } else if (this.sessionId) {
      // Proxy mode
      fetch('/api/live-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          sessionId: this.sessionId,
          message: payload,
        }),
      }).catch((error) => {
        console.error('Error sending message:', error);
        this.callbacks.onError?.('Failed to send message');
      });
    } else {
      throw new Error('Gemini Live session is not connected.');
    }
  }

  private startPolling() {
    this.pollInterval = setInterval(async () => {
      if (!this.sessionId) {
        return;
      }

      try {
        const response = await fetch('/api/live-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'receive',
            sessionId: this.sessionId,
          }),
        });

        const data = await response.json();

        if (data.messages) {
          for (const event of data.messages) {
            this.callbacks.onEvent?.(event);
          }
        }
      } catch (error) {
        console.error('Error polling messages:', error);
      }
    }, 5); // Poll every 5ms for faster response
  }

  private async readMessageData(data: Blob | ArrayBuffer | string) {
    if (typeof data === 'string') {
      return data;
    }

    if (data instanceof Blob) {
      return data.text();
    }

    return new TextDecoder().decode(data);
  }
}
