import { AUDIO_INPUT_SAMPLE_RATE, buildSessionSetupMessage } from '@/lib/live-session-config';
import { parseLiveMessage, type LiveServerEvent } from '@/lib/client/live-message-parser';

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
  private pollInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private socket: WebSocket | null = null;

  constructor(
    auth: GeminiLiveClientAuth,
    callbacks: ClientCallbacks = {},
    temperature: number = 0.6,
    voice: string = 'Puck',
    webSearchEnabled: boolean = false,
  ) {
    this.auth = auth;
    this.callbacks = callbacks;
    this.temperature = temperature;
    this.voice = voice;
    this.webSearchEnabled = webSearchEnabled;
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
        socket.send(JSON.stringify(buildSessionSetupMessage(this.temperature, this.voice, this.webSearchEnabled)));
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
    // Silently drop payloads when the session isn't connected. The microphone
    // keeps emitting audio chunks for a short window after the server has
    // closed the socket (e.g. quota rejection), and throwing here would
    // surface as an uncaught runtime error inside the audio processor.
    // Connection-loss surfacing is handled via the onClose callback.
    if (!this.isConnected) {
      return;
    }

    if (this.socket) {
      // Direct WebSocket mode. readyState guard prevents the race where the
      // socket is mid-close when a pending chunk arrives.
      if (this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
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
