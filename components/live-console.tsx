'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserAudioPlayer } from '@/lib/client/browser-audio-player';
import { CameraStreamer } from '@/lib/client/camera-streamer';
import { GeminiLiveClient } from '@/lib/client/gemini-live-client';
import { MicrophoneRecorder } from '@/lib/client/microphone-recorder';
import type { LiveServerEvent } from '@/lib/client/live-message-parser';
import {
  LIVE_MODELS,
  LIVE_MODEL_DEFAULT,
  LIVE_THINKING_LEVELS,
  LIVE_THINKING_LEVEL_DEFAULT,
  LIVE_WEB_SEARCH_ENABLED,
  SYSTEM_INSTRUCTION,
  isLiveModelId,
  isLiveThinkingLevel,
  modelSupportsThinkingLevel,
  type LiveModelId,
  type LiveThinkingLevel,
} from '@/lib/live-session-config';

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

const initialEvents: EventItem[] = [{ id: 'event-0', text: 'Все готово к запуску сессии Gemini Live.' }];
const API_KEY_STORAGE_KEY = 'gemini-live-api-key';
const TEMPERATURE_STORAGE_KEY = 'gemini-live-temperature';
const VOICE_STORAGE_KEY = 'gemini-live-voice';
const WEB_SEARCH_STORAGE_KEY = 'gemini-live-web-search';
const THINKING_LEVEL_STORAGE_KEY = 'gemini-live-thinking-level';
const RESUMPTION_HANDLE_STORAGE_KEY = 'gemini-live-session-handle';
const RESUMPTION_HANDLE_MODEL_STORAGE_KEY = 'gemini-live-session-handle-model';
const SYSTEM_INSTRUCTION_STORAGE_KEY = 'gemini-live-system-instruction';
const MODEL_STORAGE_KEY = 'gemini-live-model';
const THINKING_LEVEL_LABELS: Record<LiveThinkingLevel, string> = {
  minimal: 'Минимальные (по умолчанию)',
  low: 'Низкие',
  medium: 'Средние',
  high: 'Высокие',
};
// Gemini closes the WS with one of these strings when the stored resumption
// handle is no longer usable (handles expire after ~24h and are also invalid
// across models / quota resets). On any of them we want to drop the saved
// handle so the next click on «Запустить сессию» starts a fresh dialogue.
const STALE_HANDLE_REASON_PATTERNS = [
  'session expired',
  'invalid session handle',
  'bidigeneratecontent session expired',
];

function isStaleHandleReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  const lower = reason.toLowerCase();
  return STALE_HANDLE_REASON_PATTERNS.some((pattern) => lower.includes(pattern));
}

const STATUS_LABELS: Record<'idle' | 'connecting' | 'active' | 'stopped' | 'error', string> = {
  idle: 'Ожидание',
  connecting: 'Подключение',
  active: 'Активна',
  stopped: 'Остановлена',
  error: 'Ошибка',
};

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
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(LIVE_WEB_SEARCH_ENABLED);
  const [thinkingLevel, setThinkingLevel] = useState<LiveThinkingLevel>(LIVE_THINKING_LEVEL_DEFAULT);
  const [systemInstruction, setSystemInstruction] = useState<string>(SYSTEM_INSTRUCTION);
  const [model, setModel] = useState<LiveModelId>(LIVE_MODEL_DEFAULT);
  const [hasResumptionHandle, setHasResumptionHandle] = useState<boolean>(false);
  const thinkingLevelSupported = modelSupportsThinkingLevel(model);
  const resumptionHandleRef = useRef<string | null>(null);
  const modelRef = useRef<LiveModelId>(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

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
    const eventId = `event-${eventCounterRef.current}`;
    setEvents((current) => [{ id: eventId, text: message }, ...current].slice(0, 8));
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
    (role: 'user' | 'assistant', chunk: string, finished: boolean) => {
      const existingId = pendingMessageIdsRef.current[role];

      if (existingId) {
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== existingId) {
              return message;
            }
            // Gemini Live streams transcripts as incremental deltas. If the new
            // chunk already starts with the previously-accumulated text, assume
            // the server is sending cumulative text and replace. Otherwise
            // append so the chat keeps the full sentence instead of rendering
            // only the last word.
            const nextText = chunk.startsWith(message.text) ? chunk : message.text + chunk;
            return {
              ...message,
              text: nextText,
              pending: !finished,
            };
          }),
        );
      } else {
        const id = nextMessageId();
        pendingMessageIdsRef.current[role] = finished ? null : id;
        setMessages((current) => [
          ...current,
          {
            id,
            role,
            text: chunk,
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
      throw new Error('Сначала запустите сессию, а потом переключайте камеру.');
    }

    if (!videoRef.current || !cameraRef.current) {
      throw new Error('Камера сейчас не активна.');
    }

    await cameraRef.current.switchCamera(videoRef.current, (frame, mimeType) => {
      clientRef.current?.sendVideo(frame, mimeType);
    });

    const newMode = cameraRef.current.getCurrentFacingMode();
    setCameraFacingMode(newMode);
    appendEvent(`Камера переключена на ${newMode === 'user' ? 'фронтальную' : 'основную'}.`);
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
          appendEvent('Сессия Gemini Live готова.');
          return;
        case 'audio':
          // Audio from the model signals the user's turn is over: close their
          // pending chat bubble so their next utterance renders as a new
          // message instead of being appended to the previous one.
          finalizePendingMessage('user');
          await audioPlayerRef.current?.enqueueBase64Pcm(event.data);
          return;
        case 'text':
          finalizePendingMessage('user');
          setMessages((current) => [
            ...current,
            { id: nextMessageId(), role: 'assistant', text: event.text },
          ]);
          return;
        case 'input-transcription':
          upsertTranscript('user', event.text, event.finished);
          return;
        case 'output-transcription':
          // Same reasoning as 'audio': when the model starts speaking, the
          // user's turn has ended — finalize their bubble so the next
          // utterance is a new message.
          finalizePendingMessage('user');
          upsertTranscript('assistant', event.text, event.finished);
          return;
        case 'interrupted':
          audioPlayerRef.current?.interrupt();
          finalizePendingMessage('assistant');
          finalizePendingMessage('user');
          appendEvent('Ответ модели был прерван.');
          return;
        case 'turn-complete':
          finalizePendingMessage('assistant');
          finalizePendingMessage('user');
          appendEvent('Ход завершён.');
          return;
        case 'session-resumption-update':
          // Gemini periodically issues a new handle we can use to resume this
          // dialogue later (even after stopping the session or reloading).
          if (event.resumable && event.handle) {
            resumptionHandleRef.current = event.handle;
            try {
              window.localStorage.setItem(RESUMPTION_HANDLE_STORAGE_KEY, event.handle);
              window.localStorage.setItem(RESUMPTION_HANDLE_MODEL_STORAGE_KEY, modelRef.current);
              setHasResumptionHandle(true);
            } catch {
              // localStorage may be disabled (private mode); ignore.
            }
          }
          return;
        case 'error':
          setError(event.message);
          setStatus('error');
          appendEvent(`Ошибка Gemini: ${event.message}`);
          return;
      }
    },
    [appendEvent, finalizePendingMessage, nextMessageId, upsertTranscript],
  );

  const fetchEphemeralToken = useCallback(
    async (searchEnabled: boolean, thinkingLevelValue: LiveThinkingLevel, modelId: LiveModelId) => {
    const response = await fetch('/api/live-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webSearchEnabled: searchEnabled,
        thinkingLevel: thinkingLevelValue,
        model: modelId,
      }),
    });

    const data = (await response.json()) as TokenPayload | { error: string };

    if (!response.ok || !('token' in data)) {
      throw new Error('error' in data ? data.error : 'Не удалось получить временный токен.');
    }

    return data;
  },
  [],
);

  useEffect(() => {
    const savedKey = window.localStorage.getItem(API_KEY_STORAGE_KEY);

    if (savedKey) {
      setApiKeyInput(savedKey);
      setAuthMode('tab-api-key');
      appendEvent('API-ключ загружен из этого браузера.');
    }
  }, [appendEvent]);

  useEffect(() => {
    const savedTemp = window.localStorage.getItem(TEMPERATURE_STORAGE_KEY);
    if (savedTemp) {
      const parsedTemp = parseFloat(savedTemp);
      if (!isNaN(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 2) {
        setTemperature(parsedTemp);
        appendEvent(`Температура ${parsedTemp} загружена из этого браузера.`);
      }
    }
  }, [appendEvent]);

  useEffect(() => {
    const savedVoice = window.localStorage.getItem(VOICE_STORAGE_KEY);
    if (savedVoice) {
      setVoice(savedVoice);
      appendEvent(`Голос ${savedVoice} загружен из этого браузера.`);
    }
  }, [appendEvent]);

  useEffect(() => {
    const savedWebSearch = window.localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
    if (savedWebSearch) {
      setWebSearchEnabled(savedWebSearch === 'true');
    }
  }, []);

  useEffect(() => {
    const savedThinking = window.localStorage.getItem(THINKING_LEVEL_STORAGE_KEY);
    if (savedThinking && isLiveThinkingLevel(savedThinking)) {
      setThinkingLevel(savedThinking);
    }
  }, []);

  useEffect(() => {
    const savedHandle = window.localStorage.getItem(RESUMPTION_HANDLE_STORAGE_KEY);
    const savedHandleModel = window.localStorage.getItem(RESUMPTION_HANDLE_MODEL_STORAGE_KEY);
    if (savedHandle && (!savedHandleModel || savedHandleModel === model)) {
      resumptionHandleRef.current = savedHandle;
      setHasResumptionHandle(true);
    }
    // If a handle exists but was issued by a different model, we silently
    // discard it — resumption handles are model-specific and Gemini rejects
    // them with "Invalid session handle" if reused across models.
    // We intentionally do NOT run this effect when `model` changes; the
    // model-change effect below is responsible for clearing the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user switches to a different Live model, previously saved
  // resumption handles are invalid. Drop them so the next session starts
  // fresh instead of hitting "Invalid session handle" from Gemini.
  useEffect(() => {
    const savedHandleModel = window.localStorage.getItem(RESUMPTION_HANDLE_MODEL_STORAGE_KEY);
    if (savedHandleModel && savedHandleModel !== model) {
      resumptionHandleRef.current = null;
      try {
        window.localStorage.removeItem(RESUMPTION_HANDLE_STORAGE_KEY);
        window.localStorage.removeItem(RESUMPTION_HANDLE_MODEL_STORAGE_KEY);
      } catch {
        // ignore
      }
      setHasResumptionHandle(false);
    }
  }, [model]);

  useEffect(() => {
    const savedInstruction = window.localStorage.getItem(SYSTEM_INSTRUCTION_STORAGE_KEY);
    if (savedInstruction !== null) {
      setSystemInstruction(savedInstruction);
    }
  }, []);

  useEffect(() => {
    const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel && isLiveModelId(savedModel)) {
      setModel(savedModel);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, model);
    } catch {
      // ignore localStorage errors
    }
  }, [model]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SYSTEM_INSTRUCTION_STORAGE_KEY, systemInstruction);
    } catch {
      // localStorage may be full or disabled; ignore — in-memory state still works.
    }
  }, [systemInstruction]);

  const resetSystemInstruction = useCallback(() => {
    setSystemInstruction(SYSTEM_INSTRUCTION);
    appendEvent('Промт сброшен к стандартному. Применится при следующем запуске сессии.');
  }, [appendEvent]);

  const dropStoredResumptionHandle = useCallback(() => {
    resumptionHandleRef.current = null;
    try {
      window.localStorage.removeItem(RESUMPTION_HANDLE_STORAGE_KEY);
      window.localStorage.removeItem(RESUMPTION_HANDLE_MODEL_STORAGE_KEY);
    } catch {
      // ignore
    }
    setHasResumptionHandle(false);
  }, []);

  const clearSessionMemory = useCallback(() => {
    // Stop the active session first. Otherwise (a) Gemini keeps streaming new
    // resumption handles and immediately repopulates localStorage, and (b) the
    // open connection still holds the prior dialogue context server-side, so
    // clearing only localStorage wouldn't actually start a fresh dialogue.
    if (clientRef.current) {
      teardownSession();
      setStatus('stopped');
    }
    dropStoredResumptionHandle();
    setMessages([]);
    appendEvent('Память диалога очищена. Запустите сессию заново — диалог начнётся с нуля.');
  }, [appendEvent, dropStoredResumptionHandle, teardownSession]);

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

  useEffect(() => {
    window.localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(webSearchEnabled));
  }, [webSearchEnabled]);

  useEffect(() => {
    window.localStorage.setItem(THINKING_LEVEL_STORAGE_KEY, thinkingLevel);
  }, [thinkingLevel]);

  const startMicrophone = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error('Сначала запустите сессию, а потом включайте микрофон.');
    }

    if (!microphoneRef.current) {
      microphoneRef.current = new MicrophoneRecorder();
    }

    await microphoneRef.current.start((chunk) => {
      clientRef.current?.sendAudio(chunk);
    });

    setIsMicEnabled(true);
    appendEvent('Микрофон включен.');
  }, [appendEvent]);

  const startCamera = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error('Сначала запустите сессию, а потом включайте камеру.');
    }

    if (!videoRef.current) {
      throw new Error('Не найден элемент предпросмотра камеры.');
    }

    if (!cameraRef.current) {
      cameraRef.current = new CameraStreamer();
    }

    await cameraRef.current.start(videoRef.current, (frame, mimeType) => {
      clientRef.current?.sendVideo(frame, mimeType);
    }, cameraFacingMode);

    setIsCameraEnabled(true);
    appendEvent(`Камера включена (${cameraFacingMode === 'user' ? 'фронтальная' : 'основная'}).`);
  }, [appendEvent]);

  const startSession = useCallback(
    async (options?: { resetConversation?: boolean }) => {
      setIsBusy(true);
      setError(null);

      if (options?.resetConversation) {
        setMessages([]);
        setEvents(initialEvents);
        eventCounterRef.current = 0;
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
          appendEvent('Используется API-ключ, введённый в этом браузере.');
          appendEvent(
            `Параметры сессии: температура ${temperature}, голос ${voice}, размышления ${thinkingLevel}.`,
          );
          client = new GeminiLiveClient(
            { apiKey: trimmedApiKey },
            {
              onOpen: () => {
                setStatus('active');
                appendEvent(
                  resumptionHandleRef.current
                    ? 'Подключение к Gemini Live установлено. Продолжаем прошлый диалог.'
                    : 'Подключение к Gemini Live установлено.',
                );
              },
              onClose: (reason) => {
                setStatus('stopped');
                appendEvent(`Сессия закрыта: ${reason}`);
                if (isStaleHandleReason(reason) && resumptionHandleRef.current) {
                  dropStoredResumptionHandle();
                  appendEvent(
                    'Сохранённый handle диалога протух. Он очищен — нажми «Запустить сессию» ещё раз, диалог начнётся с нуля.',
                  );
                }
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
            webSearchEnabled,
            thinkingLevelSupported ? thinkingLevel : undefined,
            resumptionHandleRef.current ?? undefined,
            systemInstruction.trim().length > 0 ? systemInstruction : undefined,
            model,
          );
        } else {
          setAuthMode('server-token');
          appendEvent('Запрашивается временный токен через серверный маршрут.');
          appendEvent(
            `Параметры сессии: температура ${temperature}, голос ${voice}, размышления ${thinkingLevelSupported ? thinkingLevel : 'не поддерживаются для этой модели'}.`,
          );
          const tokenData = await fetchEphemeralToken(
            webSearchEnabled,
            thinkingLevelSupported ? thinkingLevel : LIVE_THINKING_LEVEL_DEFAULT,
            model,
          );
          setSessionExpiry(tokenData.expireTime);
          client = new GeminiLiveClient(
            { accessToken: tokenData.token },
            {
              onOpen: () => {
                setStatus('active');
                appendEvent(
                  resumptionHandleRef.current
                    ? 'Подключение к Gemini Live через прокси установлено. Продолжаем прошлый диалог.'
                    : 'Подключение к Gemini Live через прокси установлено.',
                );
              },
              onClose: (reason) => {
                setStatus('stopped');
                appendEvent(`Сессия закрыта: ${reason}`);
                if (isStaleHandleReason(reason) && resumptionHandleRef.current) {
                  dropStoredResumptionHandle();
                  appendEvent(
                    'Сохранённый handle диалога протух. Он очищен — нажми «Запустить сессию» ещё раз, диалог начнётся с нуля.',
                  );
                }
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
            webSearchEnabled,
            thinkingLevelSupported ? thinkingLevel : undefined,
            resumptionHandleRef.current ?? undefined,
            systemInstruction.trim().length > 0 ? systemInstruction : undefined,
            model,
          );
        }

        clientRef.current = client;
        await client.connect();

        try {
          await startMicrophone();
        } catch (micError) {
          const message = micError instanceof Error ? micError.message : 'Не удалось запустить микрофон.';
          setError(message);
          appendEvent(message);
        }
      } catch (sessionError) {
        const message =
          sessionError instanceof Error ? sessionError.message : 'Не удалось запустить сессию.';
        setError(message);
        setStatus('error');
        appendEvent(message);
      } finally {
        setIsBusy(false);
      }
    },
    [apiKeyInput, appendEvent, fetchEphemeralToken, handleLiveEvent, startMicrophone, teardownSession, temperature, voice, webSearchEnabled, thinkingLevel, thinkingLevelSupported, systemInstruction, model],
  );

  const stopConversation = useCallback(() => {
    teardownSession();
    setStatus('stopped');
    appendEvent('Диалог остановлен.');
  }, [appendEvent, teardownSession]);

  const handleToggleMicrophone = useCallback(async () => {
    setError(null);

    try {
      if (isMicEnabled) {
        stopMicrophone();
        appendEvent('Микрофон выключен.');
        return;
      }

      await startMicrophone();
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : 'Не удалось переключить микрофон.';
      setError(message);
      appendEvent(message);
    }
  }, [appendEvent, isMicEnabled, startMicrophone, stopMicrophone]);

  const handleToggleCamera = useCallback(async () => {
    setError(null);

    try {
      if (isCameraEnabled) {
        stopCamera();
        appendEvent('Камера выключена.');
        return;
      }

      await startCamera();
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : 'Не удалось переключить камеру.';
      setError(message);
      appendEvent(message);
    }
  }, [appendEvent, isCameraEnabled, startCamera, stopCamera]);

  const handleClearApiKey = useCallback(() => {
    setApiKeyInput('');
    window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    appendEvent('Сохранённый API-ключ браузера удалён.');
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
  const effectiveAuthLabel = authMode === 'tab-api-key' ? 'API-ключ браузера' : 'Серверный токен';

  return (
    <section className="console-shell">
      <div className="console-panel status-panel">
        <div>
          <p className="eyebrow">Сессия</p>
          <h2>Gemini 3.1 Flash Live Preview</h2>
        </div>

        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">Состояние</span>
            <strong data-state={status}>{STATUS_LABELS[status]}</strong>
          </div>
          <div className="status-card">
            <span className="status-label">Авторизация</span>
            <strong>{effectiveAuthLabel}</strong>
          </div>
          <div className="status-card status-card--model">
            <span className="status-label">Модель</span>
            <select
              className="status-model-select"
              value={model}
              disabled={status === 'connecting' || status === 'active'}
              onChange={(event) => {
                const next = event.target.value;
                if (isLiveModelId(next)) {
                  setModel(next);
                }
              }}
              title="Выбор модели Gemini Live. Применится при следующем запуске сессии."
            >
              {LIVE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="status-card">
            <span className="status-label">Сессия истекает</span>
            <strong>
              {authMode === 'tab-api-key'
                ? 'Управляется вашим API-ключом'
                : sessionExpiry
                  ? new Date(sessionExpiry).toLocaleTimeString()
                  : 'Ещё не запущена'}
            </strong>
          </div>
        </div>



        <div className="controls-row">
          <button className="primary-button" onClick={() => void startSession()} disabled={isBusy}>
            Запустить сессию
          </button>
          <button className="secondary-button" onClick={stopConversation} disabled={!clientRef.current}>
            Остановить
          </button>
          <button
            className="secondary-button"
            onClick={() => void startSession({ resetConversation: true })}
            disabled={isBusy}
          >
            Новый диалог
          </button>
        </div>

        <div className="api-key-panel">
          <label className="api-key-label" htmlFor="gemini-api-key">
            Одноразовый API-ключ для этого браузера
          </label>
          <div className="api-key-row">
            <input
              id="gemini-api-key"
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder="Вставьте API-ключ Gemini, чтобы не использовать переменные Vercel"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="secondary-button" onClick={handleClearApiKey} disabled={!apiKeyInput}>
              Очистить ключ
            </button>
          </div>
          <p className="api-key-note">
            Если поле заполнено, приложение подключается напрямую из браузера и хранит ключ только в этом
            браузере.
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
            Основная камера
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
            Фронтальная камера
          </label>
        </div>

        <div className="controls-row">
          <button className="primary-button" onClick={() => void startSession()} disabled={isBusy}>
            Запустить сессию
          </button>
          <button className="toggle-button" onClick={() => void handleToggleCamera()} disabled={!isSessionActive}>
            {isCameraEnabled ? 'Камера включена' : 'Камера выключена'}
          </button>
          <button className="toggle-button" onClick={() => void handleToggleMicrophone()} disabled={!isSessionActive}>
            {isMicEnabled ? 'Микрофон включен' : 'Микрофон выключен'}
          </button>
          <button className="toggle-button" onClick={() => void switchCamera()} disabled={!isCameraEnabled}>
            {cameraFacingMode === 'user' ? 'Фронтальная' : 'Основная'}
          </button>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
      </div>

      <div className="settings-panel">
        <div>
          <p className="eyebrow">Настройки</p>
          <h3>Температура и голос</h3>
        </div>
        <div className="settings-controls">
          <div className="temperature-section">
            <label htmlFor="temperature-slider">Температура: {temperature.toFixed(1)}</label>
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
              <span>0.0 (Предсказуемо)</span>
              <span>2.0 (Творчески)</span>
            </div>
          </div>
          <div className="voice-section">
            <label htmlFor="voice-select">Голос:</label>
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
          <div className="thinking-section" data-disabled={!thinkingLevelSupported}>
            <label htmlFor="thinking-level-select">Размышления модели:</label>
            <select
              id="thinking-level-select"
              value={thinkingLevel}
              disabled={!thinkingLevelSupported}
              onChange={(event) => {
                const next = event.target.value;
                if (isLiveThinkingLevel(next)) {
                  setThinkingLevel(next);
                }
              }}
            >
              {LIVE_THINKING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {THINKING_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
            <p className="thinking-note">
              {thinkingLevelSupported
                ? 'По умолчанию «минимальные» — самая низкая задержка. Применяется при следующем запуске сессии.'
                : 'Недоступно для выбранной модели (Gemini 2.5 Live). Смените модель, чтобы управлять размышлениями.'}
            </p>
          </div>
          <div className="system-instruction-section">
            <label htmlFor="system-instruction">Промт модели (роль и правила):</label>
            <textarea
              id="system-instruction"
              className="system-instruction-textarea"
              value={systemInstruction}
              onChange={(event) => setSystemInstruction(event.target.value)}
              rows={8}
              placeholder="Например: ты коуч по английскому, всегда отвечай только по-английски..."
            />
            <div className="system-instruction-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={resetSystemInstruction}
                disabled={systemInstruction === SYSTEM_INSTRUCTION}
              >
                Сбросить к стандартному
              </button>
              <p className="system-instruction-note">
                Сохраняется в браузере. Применится при следующем запуске сессии.
              </p>
            </div>
          </div>
          <div className="memory-section">
            <label>Память диалога:</label>
            <p className="memory-status">
              {hasResumptionHandle
                ? 'Есть сохранённый диалог — при запуске модель продолжит с того места, где остановились.'
                : 'Памяти пока нет. После первой сессии модель сможет продолжать диалог между запусками.'}
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={clearSessionMemory}
              disabled={!hasResumptionHandle}
            >
              Очистить память диалога
            </button>
          </div>
          <div className="search-section">
            <label className="search-toggle" htmlFor="web-search-toggle">
              <input
                id="web-search-toggle"
                type="checkbox"
                checked={webSearchEnabled}
                onChange={(event) => setWebSearchEnabled(event.target.checked)}
              />
              <span>Поиск в интернете</span>
            </label>
            <p className="search-note">
              По умолчанию выключен. Включите, если хотите дать Gemini доступ к Google Search для актуальной информации.
            </p>
          </div>
        </div>
      </div>

      <div className="console-grid">
        <div className="console-panel side-panel">
          <div>
            <p className="eyebrow">Камера</p>
            <h3>Предпросмотр</h3>
          </div>

          <div className="preview-frame">
            {isCameraEnabled ? null : <span className="preview-placeholder">Камера выключена</span>}
            <video ref={videoRef} autoPlay muted playsInline className={isCameraEnabled ? 'video-active' : 'video-idle'} />
          </div>
        </div>

        <div className="console-panel transcript-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Диалог</p>
              <h3>Живая расшифровка</h3>
            </div>
          </div>

          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-state">
                Запустите сессию и говорите, печатайте или включите камеру.
              </div>
            ) : (
              messages.map((message) => (
                <article key={message.id} className={`message-bubble ${message.role}`}>
                  <span className="message-role">
                    {message.role === 'assistant'
                      ? 'Gemini'
                      : message.role === 'user'
                        ? 'Вы'
                        : 'Система'}
                  </span>
                  <p>{message.text}</p>
                  {message.pending ? <span className="message-pending">Слушаю...</span> : null}
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
              placeholder="Введите сообщение"
              disabled={!isSessionActive}
            />
            <button className="primary-button" onClick={handleSendText} disabled={!isSessionActive || !input.trim()}>
              Отправить
            </button>
          </div>
        </div>
      </div>

      <div className="console-panel events-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Система</p>
            <h3>Последние события</h3>
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
