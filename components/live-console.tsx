'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserAudioPlayer } from '@/lib/client/browser-audio-player';
import { CameraStreamer } from '@/lib/client/camera-streamer';
import { GeminiLiveClient } from '@/lib/client/gemini-live-client';
import { MicrophoneRecorder } from '@/lib/client/microphone-recorder';
import type { LiveServerEvent } from '@/lib/client/live-message-parser';
import { LIVE_MODEL } from '@/lib/live-session-config';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  pending?: boolean;
};

type TokenPayload = {
  token: string;
  model: string;
  expireTime: string | null;
  newSessionExpireTime: string | null;
};

type AuthMode = 'server-token' | 'tab-api-key';

type EventItem = {
  id: string;
  text: string;
};

const initialEvents: EventItem[] = [{ id: 'event-0', text: 'Ready to start a Gemini Live session.' }];
const API_KEY_STORAGE_KEY = 'gemini-live-api-key';
const TEMPERATURE_STORAGE_KEY = 'gemini-live-temperature';
const VOICE_STORAGE_KEY = 'gemini-live-voice';

export function LiveConsole() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<EventItem[]>(initialEvents);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'stopped' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');
  const [sessionExpiry, setSessionExpiry] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('server-token');
  const [isBusy, setIsBusy] = useState(false);
  const [temperature, setTemperature] = useState<number>(0.6);
  const [voice, setVoice] = useState<string>('Puck');

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlayerRef = useRef<BrowserAudioPlayer | null>(null);
  const microphoneRef = useRef<MicrophoneRecorder | null>(null);
  const cameraRef = useRef<CameraStreamer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingMessageIdsRef = useRef<{ user: string | null; assistant: string | null }>({
    user: null,
    assistant: null,
  });
  const messageCounterRef = useRef(0);
  const eventCounterRef = useRef(0);

  const appendEvent = useCallback((message: string) => {
    eventCounterRef.current += 1;
    setEvents((current) => [{ id: `event-${eventCounterRef.current}`, text: message }, ...current].slice(0, 8));
  }, []);

  const nextMessageId = useCallback(() => {
    messageCounterRef.current += 1;
    return `msg-${messageCounterRef.current}`;
  }, []);

  const finalizePendingMessage = useCallback((role: 'user' | 'assistant') => {
    const pendingId = pendingMessageIdsRef.current[role];

    if (!pendingId) {
      return;
    }

    setMessages((current) =>
      current.map((message) =>
        message.id === pendingId ? { ...message, pending: false } : message,
      ),
    );
    pendingMessageIdsRef.current[role] = null;
  }, []);

  const upsertTranscript = useCallback(
    (role: 'user' | 'assistant', text: string, finished: boolean) => {
      const existingId = pendingMessageIdsRef.current[role];

      if (existingId) {
        setMessages((current) =>
          current.map((message) =>
            message.id === existingId
              ? {
                  ...message,
                  text,
                  pending: !finished,
                }
              : message,
          ),
        );
      } else {
        const id = nextMessageId();
        pendingMessageIdsRef.current[role] = finished ? null : id;
        setMessages((current) => [
          ...current,
          {
            id,
            role,
            text,
            pending: !finished,
          },
        ]);
      }

      if (finished) {
        pendingMessageIdsRef.current[role] = null;
      }
    },
    [nextMessageId],
  );

  const stopMicrophone = useCallback(() => {
    microphoneRef.current?.stop();
    setIsMicEnabled(false);
  }, []);

  const stopCamera = useCallback(() => {
    cameraRef.current?.stop(videoRef.current);
    setIsCameraEnabled(false);
  }, []);

  const switchCamera = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error('Start the session before switching camera.');
    }

    if (!videoRef.current || !cameraRef.current) {
      throw new Error('Camera is not active.');
    }

    await cameraRef.current.switchCamera(videoRef.current, (frame, mimeType) => {
      clientRef.current?.sendVideo(frame, mimeType);
    });

    const newMode = cameraRef.current.getCurrentFacingMode();
    setCameraFacingMode(newMode);
    appendEvent(`Camera switched to ${newMode === 'user' ? 'front' : 'back'}.`);
  }, [appendEvent]);

  const teardownSession = useCallback(() => {
    stopMicrophone();
    stopCamera();
    clientRef.current?.close();
    clientRef.current = null;
    setSessionExpiry(null);
    audioPlayerRef.current?.interrupt();
    finalizePendingMessage('assistant');
    finalizePendingMessage('user');
  }, [finalizePendingMessage, stopCamera, stopMicrophone]);

  const handleLiveEvent = useCallback(
    async (event: LiveServerEvent) => {
      switch (event.type) {
        case 'setup-complete':
          appendEvent('Gemini Live session is ready.');
          return;
        case 'audio':
          await audioPlayerRef.current?.enqueueBase64Pcm(event.data);
          return;
        case 'text':
          setMessages((current) => [
            ...current,
            { id: nextMessageId(), role: 'assistant', text: event.text },
          ]);
          return;
        case 'input-transcription':
          upsertTranscript('user', event.text, event.finished);
          return;
        case 'output-transcription':
          upsertTranscript('assistant', event.text, event.finished);
          return;
        case 'interrupted':
          audioPlayerRef.current?.interrupt();
          appendEvent('Model response interrupted.');
          return;
        case 'turn-complete':
          finalizePendingMessage('assistant');
          appendEvent('Turn completed.');
          return;
        case 'error':
          setError(event.message);
          setStatus('error');
          appendEvent(`Gemini error: ${event.message}`);
          return;
      }
    },
    [appendEvent, finalizePendingMessage, nextMessageId, upsertTranscript],
  );

  const fetchEphemeralToken = useCallback(async () => {
    const response = await fetch('/api/live-token', {
      method: 'POST',
    });

    const data = (await response.json()) as TokenPayload | { error: string };

    if (!response.ok || !('token' in data)) {
      throw new Error('error' in data ? data.error : 'Failed to get an ephemeral token.');
    }

    return data;
  }, []);

  useEffect(() => {
    const savedKey = window.localStorage.getItem(API_KEY_STORAGE_KEY);

    if (savedKey) {
      setApiKeyInput(savedKey);
      setAuthMode('tab-api-key');
      appendEvent('Loaded API key from this browser.');
    }
  }, [appendEvent]);

  useEffect(() => {
    const savedTemp = window.localStorage.getItem(TEMPERATURE_STORAGE_KEY);
    if (savedTemp) {
      const parsedTemp = parseFloat(savedTemp);
      if (!isNaN(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 2) {
        setTemperature(parsedTemp);
        appendEvent(`Loaded temperature ${parsedTemp} from this browser.`);
      }
    }
  }, [appendEvent]);

  useEffect(() => {
    const savedVoice = window.localStorage.getItem(VOICE_STORAGE_KEY);
    if (savedVoice) {
      setVoice(savedVoice);
      appendEvent(`Loaded voice ${savedVoice} from this browser.`);
    }
  }, [appendEvent]);

  useEffect(() => {
    const trimmedKey = apiKeyInput.trim();

    if (trimmedKey) {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, trimmedKey);
      if (status === 'idle' || status === 'stopped' || status === 'error') {
        setAuthMode('tab-api-key');
      }
      return;
    }

    window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    if (status === 'idle' || status === 'stopped' || status === 'error') {
      setAuthMode('server-token');
    }
  }, [apiKeyInput, status]);

  useEffect(() => {
    window.localStorage.setItem(TEMPERATURE_STORAGE_KEY, temperature.toString());
  }, [temperature]);

  useEffect(() => {
    window.localStorage.setItem(VOICE_STORAGE_KEY, voice);
  }, [voice]);

  const startMicrophone = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error('Start the session before turning on the microphone.');
    }

    if (!microphoneRef.current) {
      microphoneRef.current = new MicrophoneRecorder();
    }

    await microphoneRef.current.start((chunk) => {
      clientRef.current?.sendAudio(chunk);
    });

    setIsMicEnabled(true);
    appendEvent('Microphone enabled.');
  }, [appendEvent]);

  const startCamera = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error('Start the session before turning on the camera.');
    }

    if (!videoRef.current) {
      throw new Error('Camera preview element is missing.');
    }

    if (!cameraRef.current) {
      cameraRef.current = new CameraStreamer();
    }

    await cameraRef.current.start(videoRef.current, (frame, mimeType) => {
      clientRef.current?.sendVideo(frame, mimeType);
    }, cameraFacingMode);

    setIsCameraEnabled(true);
    appendEvent(`Camera enabled (${cameraFacingMode === 'user' ? 'front' : 'back'}).`);
  }, [appendEvent]);

  const startSession = useCallback(
    async (options?: { resetConversation?: boolean }) => {
      setIsBusy(true);
      setError(null);

      if (options?.resetConversation) {
        setMessages([]);
        setEvents(initialEvents);
      }

      try {
        teardownSession();
        setStatus('connecting');
        const trimmedApiKey = apiKeyInput.trim();

        if (!audioPlayerRef.current) {
          audioPlayerRef.current = new BrowserAudioPlayer();
        }

        await audioPlayerRef.current.ensureReady();

        let client: GeminiLiveClient;

        if (trimmedApiKey) {
          setAuthMode('tab-api-key');
          setSessionExpiry(null);
          appendEvent('Using API key entered in this browser.');
          client = new GeminiLiveClient(
            { apiKey: trimmedApiKey },
            {
              onOpen: () => {
                setStatus('active');
                appendEvent('Connected to Gemini Live.');
              },
              onClose: (reason) => {
                setStatus('stopped');
                appendEvent(`Session closed: ${reason}`);
              },
              onEvent: (event) => {
                void handleLiveEvent(event);
              },
              onError: (message) => {
                setError(message);
                setStatus('error');
                appendEvent(message);
              },
            },
            temperature,
            voice,
          );
        } else {
          setAuthMode('server-token');
          appendEvent('Requesting ephemeral token from the server route.');
          const tokenData = await fetchEphemeralToken();
          setSessionExpiry(tokenData.expireTime);
          client = new GeminiLiveClient(
            { accessToken: tokenData.token },
            {
              onOpen: () => {
                setStatus('active');
                appendEvent('Connected to Gemini Live via proxy.');
              },
              onClose: (reason) => {
                setStatus('stopped');
                appendEvent(`Session closed: ${reason}`);
              },
              onEvent: (event) => {
                void handleLiveEvent(event);
              },
              onError: (message) => {
                setError(message);
                setStatus('error');
                appendEvent(message);
              },
            },
            temperature,
            voice,
          );
        }

        clientRef.current = client;
        await client.connect();

        try {
          await startMicrophone();
        } catch (micError) {
          const message = micError instanceof Error ? micError.message : 'Microphone could not start.';
          setError(message);
          appendEvent(message);
        }
      } catch (sessionError) {
        const message =
          sessionError instanceof Error ? sessionError.message : 'Session could not be started.';
        setError(message);
        setStatus('error');
        appendEvent(message);
      } finally {
        setIsBusy(false);
      }
    },
    [apiKeyInput, appendEvent, fetchEphemeralToken, handleLiveEvent, startMicrophone, teardownSession],
  );

  const stopConversation = useCallback(() => {
    teardownSession();
    setStatus('stopped');
    appendEvent('Conversation stopped.');
  }, [appendEvent, teardownSession]);

  const handleToggleMicrophone = useCallback(async () => {
    setError(null);

    try {
      if (isMicEnabled) {
        stopMicrophone();
        appendEvent('Microphone disabled.');
        return;
      }

      await startMicrophone();
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : 'Microphone toggle failed.';
      setError(message);
      appendEvent(message);
    }
  }, [appendEvent, isMicEnabled, startMicrophone, stopMicrophone]);

  const handleToggleCamera = useCallback(async () => {
    setError(null);

    try {
      if (isCameraEnabled) {
        stopCamera();
        appendEvent('Camera disabled.');
        return;
      }

      await startCamera();
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : 'Camera toggle failed.';
      setError(message);
      appendEvent(message);
    }
  }, [appendEvent, isCameraEnabled, startCamera, stopCamera]);

  const handleClearApiKey = useCallback(() => {
    setApiKeyInput('');
    window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    appendEvent('Saved browser API key removed.');
  }, [appendEvent]);

  const handleSendText = useCallback(() => {
    const trimmed = input.trim();

    if (!trimmed || !clientRef.current) {
      return;
    }

    clientRef.current.sendText(trimmed);
    setMessages((current) => [
      ...current,
      { id: nextMessageId(), role: 'user', text: trimmed },
    ]);
    setInput('');
  }, [input, nextMessageId]);



  useEffect(() => {
    return () => {
      teardownSession();
      void audioPlayerRef.current?.destroy();
    };
  }, [teardownSession]);

  const isSessionActive = status === 'active';
  const effectiveAuthLabel = authMode === 'tab-api-key' ? 'Browser API key' : 'Server token';

  return (
    <section className="console-shell">
      <div className="console-panel status-panel">
        <div>
          <p className="eyebrow">Session</p>
          <h2>Gemini 3.1 Flash Live Preview</h2>
        </div>

        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">State</span>
            <strong data-state={status}>{status}</strong>
          </div>
          <div className="status-card">
            <span className="status-label">Auth</span>
            <strong>{effectiveAuthLabel}</strong>
          </div>
          <div className="status-card">
            <span className="status-label">Model</span>
            <strong>{LIVE_MODEL}</strong>
          </div>
          <div className="status-card">
            <span className="status-label">Session expires</span>
            <strong>
              {authMode === 'tab-api-key'
                ? 'Managed by your API key'
                : sessionExpiry
                  ? new Date(sessionExpiry).toLocaleTimeString()
                  : 'Not started'}
            </strong>
          </div>
        </div>



        <div className="controls-row">
          <button className="primary-button" onClick={() => void startSession()} disabled={isBusy}>
            Start session
          </button>
          <button className="secondary-button" onClick={stopConversation} disabled={!clientRef.current}>
            Stop
          </button>
          <button
            className="secondary-button"
            onClick={() => void startSession({ resetConversation: true })}
            disabled={isBusy}
          >
            New dialog
          </button>
        </div>

        <div className="api-key-panel">
          <label className="api-key-label" htmlFor="gemini-api-key">
            One-time API key for this browser
          </label>
          <div className="api-key-row">
            <input
              id="gemini-api-key"
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder="Paste Gemini API key to avoid Vercel env"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="secondary-button" onClick={handleClearApiKey} disabled={!apiKeyInput}>
              Clear key
            </button>
          </div>
          <p className="api-key-note">
            If this field is filled, the app connects directly from the browser and keeps the key stored in
            this browser.
          </p>
        </div>

        <div className="camera-controls-row">
          <label>
            <input
              type="radio"
              name="camera"
              value="environment"
              checked={cameraFacingMode === 'environment'}
              onChange={(e) => setCameraFacingMode(e.target.value as 'user' | 'environment')}
              disabled={isCameraEnabled}
            />
            Back camera
          </label>
          <label>
            <input
              type="radio"
              name="camera"
              value="user"
              checked={cameraFacingMode === 'user'}
              onChange={(e) => setCameraFacingMode(e.target.value as 'user' | 'environment')}
              disabled={isCameraEnabled}
            />
            Front camera
          </label>
        </div>

        <div className="controls-row">
          <button className="primary-button" onClick={() => void startSession()} disabled={isBusy}>
            Start session
          </button>
          <button className="toggle-button" onClick={() => void handleToggleCamera()} disabled={!isSessionActive}>
            {isCameraEnabled ? 'Camera on' : 'Camera off'}
          </button>
          <button className="toggle-button" onClick={() => void handleToggleMicrophone()} disabled={!isSessionActive}>
            {isMicEnabled ? 'Mic on' : 'Mic off'}
          </button>
          <button className="toggle-button" onClick={() => void switchCamera()} disabled={!isCameraEnabled}>
            {cameraFacingMode === 'user' ? 'Front' : 'Back'}
          </button>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
      </div>

      <div className="settings-panel">
        <div>
          <p className="eyebrow">Settings</p>
          <h3>Temperature & Voice</h3>
        </div>
        <div className="settings-controls">
          <div className="temperature-section">
            <label htmlFor="temperature-slider">Temperature: {temperature.toFixed(1)}</label>
            <input
              id="temperature-slider"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
            />
            <div className="temperature-labels">
              <span>0.0 (Deterministic)</span>
              <span>2.0 (Creative)</span>
            </div>
          </div>
          <div className="voice-section">
            <label htmlFor="voice-select">Voice:</label>
            <select
              id="voice-select"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            >
              <option value="Puck">Puck</option>
              <option value="KORE">KORE</option>
              <option value="Aoede">Aoede</option>
              <option value="Charon">Charon</option>
              <option value="Fenrir">Fenrir</option>
              <option value="Kore">Kore</option>
            </select>
          </div>
        </div>
      </div>

      <div className="console-grid">
        <div className="console-panel side-panel">
          <div>
            <p className="eyebrow">Camera</p>
            <h3>Preview</h3>
          </div>

          <div className="preview-frame">
            {isCameraEnabled ? null : <span className="preview-placeholder">Camera is off</span>}
            <video ref={videoRef} autoPlay muted playsInline className={isCameraEnabled ? 'video-active' : 'video-idle'} />
          </div>
        </div>

        <div className="console-panel transcript-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dialog</p>
              <h3>Live transcript</h3>
            </div>
          </div>

          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-state">
                Start a session and speak, type, or turn on the camera.
              </div>
            ) : (
              messages.map((message) => (
                <article key={message.id} className={`message-bubble ${message.role}`}>
                  <span className="message-role">{message.role === 'assistant' ? 'Gemini' : message.role}</span>
                  <p>{message.text}</p>
                  {message.pending ? <span className="message-pending">Listening...</span> : null}
                </article>
              ))
            )}
          </div>

          <div className="composer">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSendText();
                }
              }}
              placeholder="Type a message"
              disabled={!isSessionActive}
            />
            <button className="primary-button" onClick={handleSendText} disabled={!isSessionActive || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      </div>

      <div className="console-panel events-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">System</p>
            <h3>Recent events</h3>
          </div>
        </div>
        <ul className="event-list">
          {events.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
