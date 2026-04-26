'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { BrowserAudioPlayer } from '@/lib/client/browser-audio-player';
import { CameraStreamer } from '@/lib/client/camera-streamer';
import { GeminiLiveClient } from '@/lib/client/gemini-live-client';
import { MicrophoneRecorder } from '@/lib/client/microphone-recorder';
import { ScreenStreamer, isScreenShareSupported } from '@/lib/client/screen-streamer';
import { prepareImageAttachment, type PreparedImageAttachment } from '@/lib/client/image-attachment';
import {
  IMAGE_ATTACHMENT_FORMAT_DEFAULT,
  IMAGE_ATTACHMENT_FORMATS,
  IMAGE_ATTACHMENT_JPEG_QUALITIES,
  IMAGE_ATTACHMENT_JPEG_QUALITY_DEFAULT,
  IMAGE_ATTACHMENT_MAX_DIMENSION_DEFAULT,
  IMAGE_ATTACHMENT_MAX_DIMENSIONS,
  SCREEN_FORMAT_DEFAULT,
  SCREEN_FORMATS,
  SCREEN_JPEG_QUALITIES,
  SCREEN_JPEG_QUALITY_DEFAULT,
  SCREEN_RESOLUTION_DEFAULT,
  SCREEN_RESOLUTIONS,
  isImageAttachmentFormat,
  isImageAttachmentJpegQuality,
  isImageAttachmentMaxDimension,
  isScreenFormat,
  isScreenJpegQuality,
  isScreenResolution,
  type ImageAttachmentFormat,
  type ImageAttachmentJpegQuality,
  type ImageAttachmentMaxDimension,
  type ScreenFormat,
  type ScreenJpegQuality,
  type ScreenResolution,
} from '@/lib/live-session-config';
import type { LiveServerEvent } from '@/lib/client/live-message-parser';
import {
  LIVE_LANGUAGES,
  LIVE_MODELS,
  LIVE_MODEL_DEFAULT,
  LIVE_THINKING_LEVELS,
  LIVE_THINKING_LEVEL_DEFAULT,
  LIVE_VOICES,
  LIVE_WEB_SEARCH_ENABLED,
  SYSTEM_INSTRUCTION,
  isLiveModelId,
  isLiveThinkingLevel,
  modelSupportsSessionResumption,
  modelSupportsThinkingLevel,
  type LiveModelId,
  type LiveThinkingLevel,
} from '@/lib/live-session-config';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  pending?: boolean;
  imageDataUrl?: string;
  imageName?: string;
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
const LANGUAGE_STORAGE_KEY = 'gemini-live-language';
const WEB_SEARCH_STORAGE_KEY = 'gemini-live-web-search';
const THINKING_LEVEL_STORAGE_KEY = 'gemini-live-thinking-level';
const RESUMPTION_HANDLE_STORAGE_KEY = 'gemini-live-session-handle';
const RESUMPTION_HANDLE_MODEL_STORAGE_KEY = 'gemini-live-session-handle-model';
const SYSTEM_INSTRUCTION_STORAGE_KEY = 'gemini-live-system-instruction';
const SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY = 'gemini-live-system-instruction-presets';
const MODEL_STORAGE_KEY = 'gemini-live-model';
const MEMORY_ENABLED_STORAGE_KEY = 'gemini-live-memory-enabled';
const SCREEN_FORMAT_STORAGE_KEY = 'gemini-live-screen-format';
const SCREEN_JPEG_QUALITY_STORAGE_KEY = 'gemini-live-screen-jpeg-quality';
const SCREEN_RESOLUTION_STORAGE_KEY = 'gemini-live-screen-resolution';
const IMAGE_ATTACHMENT_FORMAT_STORAGE_KEY = 'gemini-live-image-attachment-format';
const IMAGE_ATTACHMENT_JPEG_QUALITY_STORAGE_KEY = 'gemini-live-image-attachment-jpeg-quality';
const IMAGE_ATTACHMENT_MAX_DIMENSION_STORAGE_KEY = 'gemini-live-image-attachment-max-dimension';

const SCREEN_FORMAT_LABELS: Record<ScreenFormat, string> = {
  jpeg: 'JPEG (по умолчанию — легче по трафику)',
  png: 'PNG (без потерь, идеально для текста)',
};

const SCREEN_JPEG_QUALITY_LABELS: Record<string, string> = {
  '0.5': '0.5 — низкое',
  '0.7': '0.7 — среднее (по умолчанию)',
  '0.85': '0.85 — высокое',
  '0.95': '0.95 — максимальное',
};

const SCREEN_RESOLUTION_LABELS: Record<ScreenResolution, string> = {
  hd: '1280×720 — HD (по умолчанию)',
  'full-hd': '1920×1080 — Full HD',
  '2k': '2560×1440 — 2K',
  native: 'Родное (без сжатия)',
};

const IMAGE_ATTACHMENT_FORMAT_LABELS: Record<ImageAttachmentFormat, string> = {
  jpeg: 'JPEG (по умолчанию)',
  png: 'PNG (без потерь)',
};

const IMAGE_ATTACHMENT_JPEG_QUALITY_LABELS: Record<string, string> = {
  '0.5': '0.5 — низкое',
  '0.7': '0.7 — среднее',
  '0.85': '0.85 — высокое (по умолчанию)',
  '0.95': '0.95 — максимальное',
};

const IMAGE_ATTACHMENT_MAX_DIMENSION_LABELS: Record<ImageAttachmentMaxDimension, string> = {
  small: '640 px — экономно',
  medium: '1280 px (по умолчанию)',
  large: '1920 px — Full HD',
  xl: '2560 px — 2K',
  native: 'Родное (без сжатия)',
};
const STANDARD_PROMPT_PRESET_VALUE = '__standard__';
const CUSTOM_PROMPT_PRESET_VALUE = '__custom__';

type SystemInstructionPreset = { name: string; text: string };

function readPresets(): SystemInstructionPreset[] {
  try {
    const raw = window.localStorage.getItem(SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is SystemInstructionPreset =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as { name?: unknown }).name === 'string' &&
          typeof (p as { text?: unknown }).text === 'string',
      )
      .map((p) => ({ name: p.name.trim(), text: p.text }))
      .filter((p) => p.name.length > 0);
  } catch {
    return [];
  }
}

function writePresets(presets: SystemInstructionPreset[]) {
  try {
    window.localStorage.setItem(
      SYSTEM_INSTRUCTION_PRESETS_STORAGE_KEY,
      JSON.stringify(presets),
    );
  } catch {
    // localStorage may be full or disabled; ignore.
  }
}
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
  const [isCameraFloating, setIsCameraFloating] = useState(false);
  const [cameraStreamVersion, setCameraStreamVersion] = useState(0);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');
  const [isScreenEnabled, setIsScreenEnabled] = useState(false);
  const [canShareScreen, setCanShareScreen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PreparedImageAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [screenFormat, setScreenFormat] = useState<ScreenFormat>(SCREEN_FORMAT_DEFAULT);
  const [screenJpegQuality, setScreenJpegQuality] = useState<ScreenJpegQuality>(SCREEN_JPEG_QUALITY_DEFAULT);
  const [screenResolution, setScreenResolution] = useState<ScreenResolution>(SCREEN_RESOLUTION_DEFAULT);
  const [imageAttachmentFormat, setImageAttachmentFormat] = useState<ImageAttachmentFormat>(IMAGE_ATTACHMENT_FORMAT_DEFAULT);
  const [imageAttachmentJpegQuality, setImageAttachmentJpegQuality] = useState<ImageAttachmentJpegQuality>(IMAGE_ATTACHMENT_JPEG_QUALITY_DEFAULT);
  const [imageAttachmentMaxDimension, setImageAttachmentMaxDimension] = useState<ImageAttachmentMaxDimension>(IMAGE_ATTACHMENT_MAX_DIMENSION_DEFAULT);
  const [sessionExpiry, setSessionExpiry] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('server-token');
  const [isBusy, setIsBusy] = useState(false);
  const [temperature, setTemperature] = useState<number>(0.6);
  const [voice, setVoice] = useState<string>('Puck');
  const [language, setLanguage] = useState<string>('');
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(LIVE_WEB_SEARCH_ENABLED);
  const [thinkingLevel, setThinkingLevel] = useState<LiveThinkingLevel>(LIVE_THINKING_LEVEL_DEFAULT);
  const [systemInstruction, setSystemInstruction] = useState<string>(SYSTEM_INSTRUCTION);
  const [promptPresets, setPromptPresets] = useState<SystemInstructionPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [model, setModel] = useState<LiveModelId>(LIVE_MODEL_DEFAULT);
  const [hasResumptionHandle, setHasResumptionHandle] = useState<boolean>(false);
  const [memoryEnabled, setMemoryEnabled] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<'prompt' | 'model'>('prompt');
  const thinkingLevelSupported = modelSupportsThinkingLevel(model);
  const resumptionHandleRef = useRef<string | null>(null);
  const modelRef = useRef<LiveModelId>(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  const memoryEnabledRef = useRef<boolean>(memoryEnabled);
  useEffect(() => {
    memoryEnabledRef.current = memoryEnabled;
  }, [memoryEnabled]);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioPlayerRef = useRef<BrowserAudioPlayer | null>(null);
  const microphoneRef = useRef<MicrophoneRecorder | null>(null);
  const cameraRef = useRef<CameraStreamer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const floatingVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenRef = useRef<ScreenStreamer | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  const stopScreen = useCallback(() => {
    screenRef.current?.stop(screenVideoRef.current);
    setIsScreenEnabled(false);
  }, []);

  const stopCamera = useCallback(() => {
    cameraRef.current?.stop(videoRef.current);
    setIsCameraEnabled(false);
    setIsCameraFloating(false);
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
    setCameraStreamVersion((v) => v + 1);
    appendEvent(`Камера переключена на ${newMode === 'user' ? 'фронтальную' : 'основную'}.`);
  }, [appendEvent]);

  const teardownSession = useCallback(() => {
    stopMicrophone();
    stopCamera();
    stopScreen();
    clientRef.current?.close();
    clientRef.current = null;
    setSessionExpiry(null);
    audioPlayerRef.current?.interrupt();
    finalizePendingMessage('assistant');
    finalizePendingMessage('user');
  }, [finalizePendingMessage, stopCamera, stopMicrophone, stopScreen]);

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
          // When memory is disabled, we ignore these updates so the saved
          // handle (from the last "memory on" session) stays untouched and
          // this session remains a throwaway branch.
          if (!memoryEnabledRef.current) {
            return;
          }
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
    const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (savedLanguage !== null) {
      setLanguage(savedLanguage);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(MEMORY_ENABLED_STORAGE_KEY);
    if (saved !== null) {
      setMemoryEnabled(saved !== 'false');
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MEMORY_ENABLED_STORAGE_KEY, memoryEnabled ? 'true' : 'false');
  }, [memoryEnabled]);

  // ---- Screen-share + image-attachment quality settings ----
  // These all follow the same pattern: hydrate state from localStorage on
  // mount, and persist back whenever the value changes.

  useEffect(() => {
    const saved = window.localStorage.getItem(SCREEN_FORMAT_STORAGE_KEY);
    if (isScreenFormat(saved)) setScreenFormat(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(SCREEN_FORMAT_STORAGE_KEY, screenFormat);
  }, [screenFormat]);

  useEffect(() => {
    const saved = window.localStorage.getItem(SCREEN_JPEG_QUALITY_STORAGE_KEY);
    const parsed = saved !== null ? parseFloat(saved) : NaN;
    if (isScreenJpegQuality(parsed)) setScreenJpegQuality(parsed);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(SCREEN_JPEG_QUALITY_STORAGE_KEY, screenJpegQuality.toString());
  }, [screenJpegQuality]);

  useEffect(() => {
    const saved = window.localStorage.getItem(SCREEN_RESOLUTION_STORAGE_KEY);
    if (isScreenResolution(saved)) setScreenResolution(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(SCREEN_RESOLUTION_STORAGE_KEY, screenResolution);
  }, [screenResolution]);

  useEffect(() => {
    const saved = window.localStorage.getItem(IMAGE_ATTACHMENT_FORMAT_STORAGE_KEY);
    if (isImageAttachmentFormat(saved)) setImageAttachmentFormat(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(IMAGE_ATTACHMENT_FORMAT_STORAGE_KEY, imageAttachmentFormat);
  }, [imageAttachmentFormat]);

  useEffect(() => {
    const saved = window.localStorage.getItem(IMAGE_ATTACHMENT_JPEG_QUALITY_STORAGE_KEY);
    const parsed = saved !== null ? parseFloat(saved) : NaN;
    if (isImageAttachmentJpegQuality(parsed)) setImageAttachmentJpegQuality(parsed);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(
      IMAGE_ATTACHMENT_JPEG_QUALITY_STORAGE_KEY,
      imageAttachmentJpegQuality.toString(),
    );
  }, [imageAttachmentJpegQuality]);

  useEffect(() => {
    const saved = window.localStorage.getItem(IMAGE_ATTACHMENT_MAX_DIMENSION_STORAGE_KEY);
    if (isImageAttachmentMaxDimension(saved)) setImageAttachmentMaxDimension(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(IMAGE_ATTACHMENT_MAX_DIMENSION_STORAGE_KEY, imageAttachmentMaxDimension);
  }, [imageAttachmentMaxDimension]);

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

  useEffect(() => {
    setPromptPresets(readPresets());
  }, []);

  const [isPortalReady, setIsPortalReady] = useState(false);
  useEffect(() => {
    setIsPortalReady(true);
    // getDisplayMedia is desktop-only in practice (no Android Chrome / Safari
    // iOS support), so the toggle is rendered conditionally. We check once on
    // mount; the answer doesn't change between renders.
    setCanShareScreen(isScreenShareSupported());
  }, []);

  useEffect(() => {
    const primary = videoRef.current;
    const floating = floatingVideoRef.current;
    if (!primary || !floating) return;
    if (isCameraEnabled && isCameraFloating) {
      if (floating.srcObject !== primary.srcObject) {
        floating.srcObject = primary.srcObject;
        floating.muted = true;
        floating.playsInline = true;
        void floating.play().catch(() => {});
      }
    } else {
      if (floating.srcObject) {
        floating.pause();
        floating.srcObject = null;
      }
    }
  }, [isCameraEnabled, isCameraFloating, cameraStreamVersion]);

  const savePromptPreset = useCallback(() => {
    const name = newPresetName.trim();
    if (!name) {
      appendEvent('Введи имя пресета перед сохранением.');
      return;
    }
    setPromptPresets((current) => {
      const existingIndex = current.findIndex((p) => p.name === name);
      const next: SystemInstructionPreset = { name, text: systemInstruction };
      const updated =
        existingIndex >= 0
          ? current.map((p, i) => (i === existingIndex ? next : p))
          : [...current, next];
      writePresets(updated);
      return updated;
    });
    setNewPresetName('');
    appendEvent(`Пресет «${name}» сохранён.`);
  }, [appendEvent, newPresetName, systemInstruction]);

  const loadPromptPreset = useCallback(
    (preset: SystemInstructionPreset) => {
      setSystemInstruction(preset.text);
      appendEvent(`Загружен пресет «${preset.name}». Применится при следующем запуске сессии.`);
    },
    [appendEvent],
  );

  const deletePromptPreset = useCallback(
    (name: string) => {
      setPromptPresets((current) => {
        const updated = current.filter((p) => p.name !== name);
        writePresets(updated);
        return updated;
      });
      appendEvent(`Пресет «${name}» удалён.`);
    },
    [appendEvent],
  );

  const currentPromptPreset = promptPresets.find((preset) => preset.text === systemInstruction) ?? null;
  const currentPromptPresetValue =
    systemInstruction === SYSTEM_INSTRUCTION
      ? STANDARD_PROMPT_PRESET_VALUE
      : currentPromptPreset?.name ?? CUSTOM_PROMPT_PRESET_VALUE;

  const applySelectedPromptPreset = useCallback(
    (value: string) => {
      if (value === STANDARD_PROMPT_PRESET_VALUE) {
        resetSystemInstruction();
        return;
      }

      const preset = promptPresets.find((item) => item.name === value);
      if (preset) {
        loadPromptPreset(preset);
      }
    },
    [loadPromptPreset, promptPresets, resetSystemInstruction],
  );

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
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

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

    // Camera and screen share both fight for the same video channel — only
    // one source should be streaming frames at a time.
    if (screenRef.current?.isActive()) {
      stopScreen();
      appendEvent('Трансляция экрана остановлена — включена камера.');
    }

    if (!cameraRef.current) {
      cameraRef.current = new CameraStreamer();
    }

    await cameraRef.current.start(videoRef.current, (frame, mimeType) => {
      clientRef.current?.sendVideo(frame, mimeType);
    }, cameraFacingMode);

    setIsCameraEnabled(true);
    setIsCameraFloating(true);
    setCameraStreamVersion((v) => v + 1);
    appendEvent(`Камера включена (${cameraFacingMode === 'user' ? 'фронтальная' : 'основная'}).`);
  }, [appendEvent, cameraFacingMode, stopScreen]);

  const startScreen = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error('Сначала запустите сессию, а потом включайте трансляцию экрана.');
    }

    if (!screenVideoRef.current) {
      throw new Error('Не найден элемент для предпросмотра экрана.');
    }

    if (isCameraEnabled) {
      stopCamera();
      appendEvent('Камера выключена — включена трансляция экрана.');
    }

    if (!screenRef.current) {
      screenRef.current = new ScreenStreamer();
    }

    await screenRef.current.start(
      screenVideoRef.current,
      (frame, mimeType) => {
        clientRef.current?.sendVideo(frame, mimeType);
      },
      {
        format: screenFormat,
        jpegQuality: screenJpegQuality,
        resolution: screenResolution,
      },
      () => {
        // User clicked browser's native «Stop sharing» button.
        screenRef.current?.stop(screenVideoRef.current);
        setIsScreenEnabled(false);
        appendEvent('Трансляция экрана остановлена.');
      },
    );

    setIsScreenEnabled(true);
    appendEvent(
      `Трансляция экрана включена (${screenFormat.toUpperCase()}, ${SCREEN_RESOLUTION_LABELS[screenResolution]}).`,
    );
  }, [appendEvent, isCameraEnabled, screenFormat, screenJpegQuality, screenResolution, stopCamera]);

  const handleToggleScreen = useCallback(async () => {
    setError(null);

    try {
      if (isScreenEnabled) {
        stopScreen();
        appendEvent('Трансляция экрана выключена.');
        return;
      }

      await startScreen();
    } catch (toggleError) {
      // The browser surface picker raises NotAllowedError when the user
      // clicks Cancel — that's not really an error, swallow it quietly.
      const isCancel =
        toggleError instanceof Error &&
        (toggleError.name === 'NotAllowedError' || toggleError.name === 'AbortError');
      if (isCancel) {
        appendEvent('Трансляция экрана отменена.');
        return;
      }
      const message = toggleError instanceof Error ? toggleError.message : 'Не удалось включить трансляцию экрана.';
      setError(message);
      appendEvent(message);
    }
  }, [appendEvent, isScreenEnabled, startScreen, stopScreen]);

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
            memoryEnabled ? resumptionHandleRef.current ?? undefined : undefined,
            systemInstruction.trim().length > 0 ? systemInstruction : undefined,
            model,
            language || undefined,
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
            memoryEnabled ? resumptionHandleRef.current ?? undefined : undefined,
            systemInstruction.trim().length > 0 ? systemInstruction : undefined,
            model,
            language || undefined,
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
    [apiKeyInput, appendEvent, fetchEphemeralToken, handleLiveEvent, startMicrophone, teardownSession, temperature, voice, webSearchEnabled, thinkingLevel, thinkingLevelSupported, systemInstruction, model, language, memoryEnabled],
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
    const attachment = pendingAttachment;

    if (!clientRef.current) {
      return;
    }
    if (!trimmed && !attachment) {
      return;
    }

    if (attachment) {
      clientRef.current.sendVideo(attachment.base64, attachment.mimeType);
    }

    const messageText = trimmed.length > 0
      ? trimmed
      : attachment
        ? '🖼 Картинка'
        : '';

    if (trimmed) {
      clientRef.current.sendText(trimmed);
    } else if (attachment) {
      // Without any accompanying text Liv often does nothing with a bare
      // image, so nudge it to actually look at and describe the picture.
      clientRef.current.sendText('Опиши, что на этой картинке.');
    }

    setMessages((current) => [
      ...current,
      {
        id: nextMessageId(),
        role: 'user',
        text: messageText,
        imageDataUrl: attachment?.dataUrl,
        imageName: attachment?.name,
      },
    ]);
    setInput('');
    setPendingAttachment(null);
    setAttachmentError(null);
  }, [input, nextMessageId, pendingAttachment]);

  const handleAttachmentPicked = useCallback(
    async (file: File) => {
      setAttachmentError(null);
      try {
        const prepared = await prepareImageAttachment(file, {
          format: imageAttachmentFormat,
          jpegQuality: imageAttachmentJpegQuality,
          maxDimension: imageAttachmentMaxDimension,
        });
        setPendingAttachment(prepared);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось прочитать картинку.';
        setAttachmentError(message);
        setPendingAttachment(null);
      }
    },
    [imageAttachmentFormat, imageAttachmentJpegQuality, imageAttachmentMaxDimension],
  );

  const handleAttachmentInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await handleAttachmentPicked(file);
      }
      // Reset so the same file can be picked again later.
      event.target.value = '';
    },
    [handleAttachmentPicked],
  );



  useEffect(() => {
    return () => {
      teardownSession();
      void audioPlayerRef.current?.destroy();
    };
  }, [teardownSession]);

  const isSessionActive = status === 'active';
  const isSessionRunning = status === 'connecting' || status === 'active';

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const bodyStyle = document.body.style;
    const htmlStyle = document.documentElement.style;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousHtmlOverflow = htmlStyle.overflow;

    bodyStyle.overflow = 'hidden';
    htmlStyle.overflow = 'hidden';

    return () => {
      bodyStyle.overflow = previousBodyOverflow;
      htmlStyle.overflow = previousHtmlOverflow;
    };
  }, [isSettingsOpen]);

  return (
    <section className="console-shell">
      {/* Off-screen video element used by the screen-share streamer to grab
          frames from the captured display stream. The user already sees the
          shared content on their own monitor, so we don't render a preview. */}
      <video
        ref={screenVideoRef}
        autoPlay
        muted
        playsInline
        aria-hidden="true"
        className="hidden-video"
      />
      <div className="console-panel status-panel">
        <div className="status-grid status-grid--single">
          <div className="status-card">
            <span className="status-label">Состояние</span>
            <strong data-state={status}>{STATUS_LABELS[status]}</strong>
          </div>
        </div>

        <div className="preset-loader-row">
          <select
            className="prompt-presets-select preset-loader-select"
            value={currentPromptPresetValue}
            onChange={(event) => {
              applySelectedPromptPreset(event.target.value);
            }}
            aria-label="Загрузить пресет промта"
          >
            <option value={STANDARD_PROMPT_PRESET_VALUE}>Стандартный</option>
            {currentPromptPresetValue === CUSTOM_PROMPT_PRESET_VALUE ? (
              <option value={CUSTOM_PROMPT_PRESET_VALUE}>Текущий промт</option>
            ) : null}
            {promptPresets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>

        <div className="controls-row controls-row--primary">
          <button className="primary-button" onClick={() => void startSession()} disabled={isBusy}>
            Запустить сессию
          </button>
          <button className="secondary-button" onClick={stopConversation} disabled={!clientRef.current}>
            Остановить
          </button>
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

        <div className="icon-row" role="toolbar" aria-label="Быстрые действия">
          <button
            type="button"
            className={`icon-button${isCameraEnabled ? ' icon-button--on' : ''}`}
            onClick={() => void handleToggleCamera()}
            disabled={!isSessionActive}
            aria-label={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
            title={isCameraEnabled ? 'Камера включена' : 'Камера выключена'}
          >
            <span aria-hidden="true">📷</span>
          </button>
          {canShareScreen ? (
            <button
              type="button"
              className={`icon-button${isScreenEnabled ? ' icon-button--on' : ''}`}
              onClick={() => void handleToggleScreen()}
              disabled={!isSessionActive}
              aria-label={isScreenEnabled ? 'Остановить трансляцию экрана' : 'Транслировать экран'}
              title={
                isScreenEnabled
                  ? 'Экран транслируется. Liv видит, что вы показываете.'
                  : 'Транслировать экран — Liv будет видеть выбранное окно или весь экран.'
              }
            >
              <span aria-hidden="true">🖥️</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`icon-button${isMicEnabled ? ' icon-button--on' : ''}`}
            onClick={() => void handleToggleMicrophone()}
            disabled={!isSessionActive}
            aria-label={isMicEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
            title={isMicEnabled ? 'Микрофон включен' : 'Микрофон выключен'}
          >
            <span aria-hidden="true">🎤</span>
          </button>
          <button
            type="button"
            className={`icon-button icon-button--memory${memoryEnabled ? ' icon-button--on' : ''}`}
            onClick={() => setMemoryEnabled((v) => !v)}
            disabled={!modelSupportsSessionResumption(model)}
            aria-label={memoryEnabled ? 'Выключить память диалога' : 'Включить память диалога'}
            title={
              !modelSupportsSessionResumption(model)
                ? 'У Gemini 2.5 (native audio) память между сессиями не поддерживается.'
                : memoryEnabled
                  ? 'Память: вкл. Следующая сессия продолжит прошлый диалог.'
                  : 'Память: выкл. Каждая сессия стартует с чистого листа.'
            }
          >
            <span aria-hidden="true" className="icon-stack">
              🧠
              <span className={`icon-badge${memoryEnabled ? ' icon-badge--on' : ' icon-badge--off'}`}>
                {memoryEnabled ? '✓' : '×'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={clearSessionMemory}
            disabled={!hasResumptionHandle}
            aria-label="Очистить память диалога"
            title={hasResumptionHandle ? 'Очистить память диалога' : 'Очищать пока нечего — память пуста'}
          >
            <span aria-hidden="true">🧹</span>
          </button>
        </div>

        <div className="settings-trigger-row">
          <button
            type="button"
            className="secondary-button settings-trigger"
            onClick={() => setIsSettingsOpen(true)}
          >
            ⚙️ Настройки и промт
          </button>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
      </div>

      <div className="console-grid">
        <div className="console-panel side-panel">
          <div>
            <p className="eyebrow">Камера</p>
            <h3>Предпросмотр</h3>
          </div>

          <div className="preview-frame">
            {isCameraEnabled ? null : <span className="preview-placeholder">Камера выключена</span>}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={isCameraEnabled ? 'video-active' : 'video-idle'}
            />
            {isCameraEnabled && !isCameraFloating ? (
              <button
                type="button"
                className="preview-expand"
                onClick={() => setIsCameraFloating(true)}
                title="Развернуть обратно в плавающее окно"
              >
                Развернуть
              </button>
            ) : null}
          </div>
          {isPortalReady && isCameraEnabled && isCameraFloating
            ? createPortal(
                <div className="floating-camera" role="dialog" aria-label="Плавающее превью камеры">
                  <video
                    ref={floatingVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="floating-camera-video"
                  />
                  <button
                    type="button"
                    className="floating-camera-flip"
                    onClick={() => void switchCamera()}
                    aria-label="Перевернуть камеру"
                    title={cameraFacingMode === 'user' ? 'Переключить на основную' : 'Переключить на фронтальную'}
                  >
                    ↺
                  </button>
                  <button
                    type="button"
                    className="floating-camera-close"
                    onClick={stopCamera}
                    aria-label="Выключить камеру"
                    title="Выключить камеру"
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="floating-camera-minimize"
                    onClick={() => setIsCameraFloating(false)}
                    title="Свернуть — камера продолжит работать"
                  >
                    Свернуть
                  </button>
                </div>,
                document.body,
              )
            : null}
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
                  {message.imageDataUrl ? (
                    <img
                      src={message.imageDataUrl}
                      alt={message.imageName || 'Прикреплённая картинка'}
                      className="message-image"
                    />
                  ) : null}
                  <p>{message.text}</p>
                  {message.pending ? <span className="message-pending">Слушаю...</span> : null}
                </article>
              ))
            )}
          </div>

          {pendingAttachment ? (
            <div className="composer-attachment" role="group" aria-label="Прикреплённая картинка">
              <img
                src={pendingAttachment.dataUrl}
                alt={pendingAttachment.name}
                className="composer-attachment-thumb"
              />
              <div className="composer-attachment-meta">
                <span className="composer-attachment-name" title={pendingAttachment.name}>
                  {pendingAttachment.name}
                </span>
                <span className="composer-attachment-hint">
                  Liv увидит эту картинку вместе с вашим следующим сообщением.
                </span>
              </div>
              <button
                type="button"
                className="composer-attachment-remove"
                onClick={() => {
                  setPendingAttachment(null);
                  setAttachmentError(null);
                }}
                aria-label="Убрать картинку"
                title="Убрать картинку"
              >
                ×
              </button>
            </div>
          ) : null}
          {attachmentError ? (
            <p className="composer-attachment-error">{attachmentError}</p>
          ) : null}

          <div className="composer">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void handleAttachmentInputChange(event)}
            />
            <button
              type="button"
              className="icon-button composer-attach-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isSessionActive}
              aria-label="Прикрепить картинку"
              title="Прикрепить картинку — Liv увидит её и сможет о ней рассказать."
            >
              <span aria-hidden="true">📎</span>
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSendText();
                }
              }}
              placeholder={pendingAttachment ? 'Подпишите картинку или отправьте сразу' : 'Введите сообщение'}
              disabled={!isSessionActive}
            />
            <button
              className="primary-button"
              onClick={handleSendText}
              disabled={!isSessionActive || (!input.trim() && !pendingAttachment)}
            >
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

      {isPortalReady && !isSettingsOpen
        ? createPortal(
            <div className="sticky-controls" role="toolbar" aria-label="Быстрые действия">
              <span
                className={`icon-button icon-button--mini icon-button--status${isSessionActive ? ' icon-button--status-active' : ' icon-button--status-inactive'}`}
                role="status"
                aria-label={`Состояние сессии: ${STATUS_LABELS[status]}`}
                title={`Состояние сессии: ${STATUS_LABELS[status]}`}
              >
                <span aria-hidden="true">{isSessionActive ? '✓' : '✕'}</span>
              </span>
              <button
                type="button"
                className={`icon-button icon-button--mini${isSessionRunning ? ' icon-button--on' : ''}`}
                onClick={isSessionRunning ? stopConversation : () => void startSession()}
                disabled={isBusy}
                aria-label={isSessionRunning ? 'Остановить сессию' : 'Запустить сессию'}
                title={isSessionRunning ? 'Остановить сессию' : 'Запустить сессию'}
              >
                <span aria-hidden="true">{isSessionRunning ? '⏸' : '▶'}</span>
              </button>
              <button
                type="button"
                className={`icon-button icon-button--mini${isMicEnabled ? ' icon-button--on' : ''}`}
                onClick={() => void handleToggleMicrophone()}
                disabled={!isSessionActive}
                aria-label={isMicEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
                title={isMicEnabled ? 'Микрофон включен' : 'Микрофон выключен'}
              >
                <span aria-hidden="true">🎤</span>
              </button>
              <button
                type="button"
                className={`icon-button icon-button--mini${isCameraEnabled ? ' icon-button--on' : ''}`}
                onClick={() => void handleToggleCamera()}
                disabled={!isSessionActive}
                aria-label={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
                title={isCameraEnabled ? 'Камера включена' : 'Камера выключена'}
              >
                <span aria-hidden="true">📷</span>
              </button>
              {canShareScreen ? (
                <button
                  type="button"
                  className={`icon-button icon-button--mini${isScreenEnabled ? ' icon-button--on' : ''}`}
                  onClick={() => void handleToggleScreen()}
                  disabled={!isSessionActive}
                  aria-label={isScreenEnabled ? 'Остановить трансляцию экрана' : 'Транслировать экран'}
                  title={isScreenEnabled ? 'Экран транслируется' : 'Транслировать экран'}
                >
                  <span aria-hidden="true">🖥️</span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {isPortalReady && isSettingsOpen
        ? createPortal(
            <div
              className="settings-drawer-backdrop"
              role="presentation"
              onClick={() => setIsSettingsOpen(false)}
            >
              <div
                className="settings-drawer"
                role="dialog"
                aria-modal="true"
                aria-label="Настройки и промт"
                onClick={(e) => e.stopPropagation()}
              >
                <header className="settings-drawer-header">
                  <h3>Настройки</h3>
                  <button
                    type="button"
                    className="settings-drawer-close"
                    onClick={() => setIsSettingsOpen(false)}
                    aria-label="Закрыть"
                  >
                    ×
                  </button>
                </header>
                <div className="settings-drawer-body">
                  <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
                    <button
                      type="button"
                      className={`settings-tab${activeSettingsSection === 'prompt' ? ' settings-tab--active' : ''}`}
                      onClick={() => setActiveSettingsSection('prompt')}
                      role="tab"
                      aria-selected={activeSettingsSection === 'prompt'}
                    >
                      Промт модели
                    </button>
                    <button
                      type="button"
                      className={`settings-tab${activeSettingsSection === 'model' ? ' settings-tab--active' : ''}`}
                      onClick={() => setActiveSettingsSection('model')}
                      role="tab"
                      aria-selected={activeSettingsSection === 'model'}
                    >
                      Настройки модели
                    </button>
                  </div>
                  <div className="settings-tab-panel">
                    {activeSettingsSection === 'prompt' ? (
                      <div className="settings-panel-content">
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
                      <div className="prompt-presets">
                        <div className="prompt-presets-header">Пресеты промта:</div>
                        <div className="prompt-presets-select-row">
                          <select
                            className="prompt-presets-select"
                            value={currentPromptPresetValue}
                            onChange={(event) => {
                              applySelectedPromptPreset(event.target.value);
                            }}
                          >
                            <option value={STANDARD_PROMPT_PRESET_VALUE}>Стандартный</option>
                            {currentPromptPresetValue === CUSTOM_PROMPT_PRESET_VALUE ? (
                              <option value={CUSTOM_PROMPT_PRESET_VALUE}>Текущий промт</option>
                            ) : null}
                            {promptPresets.map((preset) => (
                              <option key={preset.name} value={preset.name}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="prompt-presets-select prompt-presets-delete-select"
                            value=""
                            onChange={(event) => {
                              const name = event.target.value;
                              if (!name) return;
                              deletePromptPreset(name);
                              event.target.value = '';
                            }}
                            disabled={promptPresets.length === 0}
                            aria-label="Удалить пресет"
                            title="Удалить пресет"
                          >
                            <option value="">Удалить…</option>
                            {promptPresets.map((preset) => (
                              <option key={preset.name} value={preset.name}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="prompt-presets-save">
                          <input
                            type="text"
                            className="prompt-preset-name-input"
                            placeholder="Имя пресета (например: режиссёр)"
                            value={newPresetName}
                            onChange={(event) => setNewPresetName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                savePromptPreset();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={savePromptPreset}
                            disabled={newPresetName.trim().length === 0}
                          >
                            Сохранить как пресет
                          </button>
                        </div>
                      </div>
                      </div>
                    ) : null}

                    {activeSettingsSection === 'model' ? (
                      <div className="settings-panel-content settings-panel-content--grid">
                      <div className="voice-section">
                        <label htmlFor="model-select">Модель Gemini Live:</label>
                        <select
                          id="model-select"
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
                          {LIVE_VOICES.map((v) => (
                            <option key={v.id} value={v.id}>
                              {`${v.id} — ${v.style} (${v.gender})`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="voice-section">
                        <label htmlFor="language-select">Язык:</label>
                        <select
                          id="language-select"
                          value={language}
                          onChange={(e) => setLanguage(e.target.value)}
                          disabled={!modelSupportsThinkingLevel(model)}
                        >
                          {LIVE_LANGUAGES.map((l) => (
                            <option key={l.code || 'auto'} value={l.code}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                        <p className="thinking-note">
                          {modelSupportsThinkingLevel(model)
                            ? 'Применяется при следующем запуске сессии. «Авто» — модель определяет язык по твоей речи.'
                            : 'У Gemini 2.5 (native audio) язык выбирается автоматически — явный выбор недоступен.'}
                        </p>
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
                            : 'Недоступно для выбранной модели (Gemini 2.5 Live).'}
                        </p>
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
                          По умолчанию выключен. Включите, если хотите дать Gemini доступ к Google Search.
                        </p>
                      </div>
                      <div className="memory-section">
                        <label>Память диалога (запасная очистка):</label>
                        <p className="memory-status">
                          {hasResumptionHandle
                            ? 'Есть сохранённый диалог — при запуске модель продолжит с того места.'
                            : 'Памяти пока нет.'}
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
                      <div className="quality-section">
                        <h3 className="quality-section-title">Трансляция экрана</h3>
                        <p className="quality-section-hint">
                          Если Liv путается с мелким текстом (например, в IDE) — поднимите разрешение и/или переключитесь на PNG.
                        </p>
                        <div className="quality-row">
                          <label htmlFor="screen-format-select">Формат:</label>
                          <select
                            id="screen-format-select"
                            value={screenFormat}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (isScreenFormat(v)) setScreenFormat(v);
                            }}
                          >
                            {SCREEN_FORMATS.map((f) => (
                              <option key={f} value={f}>
                                {SCREEN_FORMAT_LABELS[f]}
                              </option>
                            ))}
                          </select>
                        </div>
                        {screenFormat === 'jpeg' ? (
                          <div className="quality-row">
                            <label htmlFor="screen-jpeg-quality-select">Качество JPEG:</label>
                            <select
                              id="screen-jpeg-quality-select"
                              value={screenJpegQuality.toString()}
                              onChange={(e) => {
                                const parsed = parseFloat(e.target.value);
                                if (isScreenJpegQuality(parsed)) setScreenJpegQuality(parsed);
                              }}
                            >
                              {SCREEN_JPEG_QUALITIES.map((q) => (
                                <option key={q} value={q.toString()}>
                                  {SCREEN_JPEG_QUALITY_LABELS[q.toString()]}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        <div className="quality-row">
                          <label htmlFor="screen-resolution-select">Разрешение:</label>
                          <select
                            id="screen-resolution-select"
                            value={screenResolution}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (isScreenResolution(v)) setScreenResolution(v);
                            }}
                          >
                            {SCREEN_RESOLUTIONS.map((r) => (
                              <option key={r} value={r}>
                                {SCREEN_RESOLUTION_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="quality-section-note">
                          Изменения применятся при следующем включении трансляции.
                        </p>
                      </div>
                      <div className="quality-section">
                        <h3 className="quality-section-title">Прикреплённые картинки</h3>
                        <p className="quality-section-hint">
                          Влияет на скрепку 📎. Чем выше разрешение — тем лучше Liv разбирает мелкий текст на скриншотах.
                        </p>
                        <div className="quality-row">
                          <label htmlFor="image-format-select">Формат:</label>
                          <select
                            id="image-format-select"
                            value={imageAttachmentFormat}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (isImageAttachmentFormat(v)) setImageAttachmentFormat(v);
                            }}
                          >
                            {IMAGE_ATTACHMENT_FORMATS.map((f) => (
                              <option key={f} value={f}>
                                {IMAGE_ATTACHMENT_FORMAT_LABELS[f]}
                              </option>
                            ))}
                          </select>
                        </div>
                        {imageAttachmentFormat === 'jpeg' ? (
                          <div className="quality-row">
                            <label htmlFor="image-jpeg-quality-select">Качество JPEG:</label>
                            <select
                              id="image-jpeg-quality-select"
                              value={imageAttachmentJpegQuality.toString()}
                              onChange={(e) => {
                                const parsed = parseFloat(e.target.value);
                                if (isImageAttachmentJpegQuality(parsed)) setImageAttachmentJpegQuality(parsed);
                              }}
                            >
                              {IMAGE_ATTACHMENT_JPEG_QUALITIES.map((q) => (
                                <option key={q} value={q.toString()}>
                                  {IMAGE_ATTACHMENT_JPEG_QUALITY_LABELS[q.toString()]}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        <div className="quality-row">
                          <label htmlFor="image-max-dimension-select">Макс. сторона:</label>
                          <select
                            id="image-max-dimension-select"
                            value={imageAttachmentMaxDimension}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (isImageAttachmentMaxDimension(v)) setImageAttachmentMaxDimension(v);
                            }}
                          >
                            {IMAGE_ATTACHMENT_MAX_DIMENSIONS.map((d) => (
                              <option key={d} value={d}>
                                {IMAGE_ATTACHMENT_MAX_DIMENSION_LABELS[d]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="api-key-panel">
                        <label className="api-key-label" htmlFor="gemini-api-key">
                          Свой API-ключ для этого браузера
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
                          Если поле заполнено, приложение подключается напрямую из браузера и хранит ключ только в этом браузере.
                        </p>
                      </div>
                      </div>
                    ) : null}
                </div>
              </div>
            </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
