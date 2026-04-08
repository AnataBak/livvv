import { AUDIO_INPUT_SAMPLE_RATE, buildSessionSetupMessage } from '@/lib/live-session-config';
import { parseLiveMessage, type LiveServerEvent } from '@/lib/client/live-message-parser';

type ClientCallbacks = {
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onEvent?: (event: LiveServerEvent) => void;
  onError?: (message: string) => void;
};

export class GeminiLiveClient {
  private readonly serviceUrl: string;
  private socket: WebSocket | null = null;
  private callbacks: ClientCallbacks;

  constructor(token: string, callbacks: ClientCallbacks = {}) {
    this.serviceUrl =
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
    this.callbacks = callbacks;
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.serviceUrl);
      this.socket = socket;

      socket.onopen = () => {
        this.send(buildSessionSetupMessage());
        this.callbacks.onOpen?.();
        resolve();
      };

      socket.onerror = () => {
        const message = 'Could not connect to Gemini Live.';
        this.callbacks.onError?.(message);

        if (socket.readyState !== WebSocket.OPEN) {
          reject(new Error(message));
        }
      };

      socket.onclose = (event) => {
        this.callbacks.onClose?.(event.reason || 'Connection closed.');
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
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private send(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Gemini Live session is not connected.');
    }

    this.socket.send(JSON.stringify(payload));
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
