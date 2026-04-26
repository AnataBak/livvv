export const LIVE_MODELS = [
  {
    id: 'gemini-3.1-flash-live-preview',
    label: 'Gemini 3.1 Flash Live (по умолчанию)',
    supportsThinkingLevel: true,
    supportsSessionResumption: true,
    supportsContextWindowCompression: true,
  },
  {
    id: 'gemini-2.5-flash-native-audio-preview-12-2025',
    label: 'Gemini 2.5 Flash Live (native audio)',
    supportsThinkingLevel: false,
    // Native audio rejects sessionResumption / contextWindowCompression with
    // an immediate close, so we don't send them for this model.
    supportsSessionResumption: false,
    supportsContextWindowCompression: false,
  },
] as const;

export type LiveModelId = (typeof LIVE_MODELS)[number]['id'];
export const LIVE_MODEL_DEFAULT: LiveModelId = 'gemini-3.1-flash-live-preview';

// Kept for backward compatibility (imports in the UI/status cards).
export const LIVE_MODEL: LiveModelId = LIVE_MODEL_DEFAULT;

export function isLiveModelId(value: unknown): value is LiveModelId {
  return (
    typeof value === 'string' &&
    (LIVE_MODELS as ReadonlyArray<{ id: string }>).some((m) => m.id === value)
  );
}

export function modelSupportsThinkingLevel(model: LiveModelId): boolean {
  return Boolean(LIVE_MODELS.find((m) => m.id === model)?.supportsThinkingLevel);
}

export function modelSupportsSessionResumption(model: LiveModelId): boolean {
  return Boolean(LIVE_MODELS.find((m) => m.id === model)?.supportsSessionResumption);
}

export function modelSupportsContextWindowCompression(model: LiveModelId): boolean {
  return Boolean(LIVE_MODELS.find((m) => m.id === model)?.supportsContextWindowCompression);
}

export const LIVE_VOICE = 'Puck';

// Full list of 30 prebuilt voices available in Gemini Live / TTS.
// Labels are translated styles from the official docs.
// https://ai.google.dev/gemini-api/docs/speech-generation#voices
export const LIVE_VOICES = [
  { id: 'Zephyr', style: 'яркий', gender: 'ж' },
  { id: 'Puck', style: 'бодрый', gender: 'м' },
  { id: 'Charon', style: 'информативный', gender: 'м' },
  { id: 'Kore', style: 'уверенный', gender: 'ж' },
  { id: 'Fenrir', style: 'эмоциональный', gender: 'м' },
  { id: 'Leda', style: 'молодой', gender: 'ж' },
  { id: 'Orus', style: 'уверенный', gender: 'м' },
  { id: 'Aoede', style: 'лёгкий', gender: 'ж' },
  { id: 'Callirrhoe', style: 'непринуждённый', gender: 'ж' },
  { id: 'Autonoe', style: 'яркий', gender: 'ж' },
  { id: 'Enceladus', style: 'придыхательный', gender: 'м' },
  { id: 'Iapetus', style: 'чистый', gender: 'м' },
  { id: 'Umbriel', style: 'непринуждённый', gender: 'м' },
  { id: 'Algieba', style: 'мягкий', gender: 'м' },
  { id: 'Despina', style: 'мягкий', gender: 'ж' },
  { id: 'Erinome', style: 'чистый', gender: 'ж' },
  { id: 'Algenib', style: 'с хрипотцой', gender: 'м' },
  { id: 'Rasalgethi', style: 'информативный', gender: 'м' },
  { id: 'Laomedeia', style: 'бодрый', gender: 'ж' },
  { id: 'Achernar', style: 'тихий', gender: 'ж' },
  { id: 'Alnilam', style: 'уверенный', gender: 'м' },
  { id: 'Schedar', style: 'ровный', gender: 'м' },
  { id: 'Gacrux', style: 'зрелый', gender: 'ж' },
  { id: 'Pulcherrima', style: 'напористый', gender: 'ж' },
  { id: 'Achird', style: 'дружелюбный', gender: 'м' },
  { id: 'Zubenelgenubi', style: 'неформальный', gender: 'м' },
  { id: 'Vindemiatrix', style: 'деликатный', gender: 'ж' },
  { id: 'Sadachbia', style: 'живой', gender: 'м' },
  { id: 'Sadaltager', style: 'знающий', gender: 'м' },
  { id: 'Sulafat', style: 'тёплый', gender: 'ж' },
] as const;

// Subset of Live API's 97 supported languages — самые популярные.
// https://ai.google.dev/gemini-api/docs/live-api/capabilities#supported-languages
export const LIVE_LANGUAGES = [
  { code: '', label: 'Авто (по голосу пользователя)' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'uk-UA', label: 'Українська' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'pl-PL', label: 'Polski' },
  { code: 'nl-NL', label: 'Nederlands' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'ar-XA', label: 'العربية' },
  { code: 'he-IL', label: 'עברית' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'id-ID', label: 'Bahasa Indonesia' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'zh-CN', label: '中文 (упр.)' },
  { code: 'th-TH', label: 'ไทย' },
  { code: 'vi-VN', label: 'Tiếng Việt' },
] as const;

export const LIVE_WEB_SEARCH_ENABLED = false;
export const AUDIO_INPUT_SAMPLE_RATE = 16000;
export const AUDIO_OUTPUT_SAMPLE_RATE = 24000;
export const CAMERA_FRAME_RATE = 1;
export const CAMERA_WIDTH = 640;
export const CAMERA_HEIGHT = 480;
export const SCREEN_FRAME_RATE = 1;
export const ATTACHED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// ---- Screen-share quality settings ----
// All three are user-configurable in the settings drawer; the
// `*_DEFAULT` value is what «default» means in the UI.

export const SCREEN_FORMATS = ['jpeg', 'png'] as const;
export type ScreenFormat = (typeof SCREEN_FORMATS)[number];
export const SCREEN_FORMAT_DEFAULT: ScreenFormat = 'jpeg';

export function isScreenFormat(value: unknown): value is ScreenFormat {
  return typeof value === 'string' && (SCREEN_FORMATS as readonly string[]).includes(value);
}

// JPEG quality is a continuous slider 0.40..1.00 step 0.05. We store the
// raw float in localStorage; clampJpegQuality() clamps and snaps to the step
// so an invalid/legacy value can't break the canvas API.
export const JPEG_QUALITY_MIN = 0.4;
export const JPEG_QUALITY_MAX = 1.0;
export const JPEG_QUALITY_STEP = 0.05;
export const SCREEN_JPEG_QUALITY_DEFAULT = 0.7;
export const IMAGE_ATTACHMENT_JPEG_QUALITY_DEFAULT = 0.85;

export function clampJpegQuality(value: number): number {
  if (!Number.isFinite(value)) return SCREEN_JPEG_QUALITY_DEFAULT;
  const clamped = Math.min(JPEG_QUALITY_MAX, Math.max(JPEG_QUALITY_MIN, value));
  // Snap to nearest step so the slider's reported value always matches what
  // we send to canvas.toDataURL (and what we display in the UI).
  const stepped = Math.round((clamped - JPEG_QUALITY_MIN) / JPEG_QUALITY_STEP)
    * JPEG_QUALITY_STEP + JPEG_QUALITY_MIN;
  return Math.round(stepped * 100) / 100;
}

// Max-longest-side in pixels. 0 is the sentinel meaning «native resolution
// of the source» — the streamer skips downscaling and ships the raw frame
// dimensions. The slider in the UI exposes a discrete range with a final
// «Родное» tick at the right edge.
export const SCREEN_MAX_LONGEST_SIDE_MIN = 800;
export const SCREEN_MAX_LONGEST_SIDE_MAX = 3840;
export const SCREEN_MAX_LONGEST_SIDE_STEP = 80;
export const SCREEN_MAX_LONGEST_SIDE_DEFAULT = 1280;

export const IMAGE_ATTACHMENT_MAX_LONGEST_SIDE_MIN = 480;
export const IMAGE_ATTACHMENT_MAX_LONGEST_SIDE_MAX = 3840;
export const IMAGE_ATTACHMENT_MAX_LONGEST_SIDE_STEP = 80;
export const IMAGE_ATTACHMENT_MAX_LONGEST_SIDE_DEFAULT = 1280;

export const MAX_LONGEST_SIDE_NATIVE = 0;

export function clampMaxLongestSide(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  if (value === MAX_LONGEST_SIDE_NATIVE) return MAX_LONGEST_SIDE_NATIVE;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round((clamped - min) / step) * step + min;
}

export function describeMaxLongestSide(value: number): string {
  if (value === MAX_LONGEST_SIDE_NATIVE) return 'Родное (без сжатия)';
  return `${value} px`;
}

// ---- Attached-image format ----

export const IMAGE_ATTACHMENT_FORMATS = ['jpeg', 'png'] as const;
export type ImageAttachmentFormat = (typeof IMAGE_ATTACHMENT_FORMATS)[number];
export const IMAGE_ATTACHMENT_FORMAT_DEFAULT: ImageAttachmentFormat = 'jpeg';

export function isImageAttachmentFormat(value: unknown): value is ImageAttachmentFormat {
  return typeof value === 'string' && (IMAGE_ATTACHMENT_FORMATS as readonly string[]).includes(value);
}
export const SYSTEM_INSTRUCTION = [
  'Ты — голосовой собеседник. Твой единственный канал общения — голос: пользователь тебя слушает, а не читает.',
  '',
  'ГЛАВНОЕ ПРАВИЛО: ты ВСЕГДА произносишь вслух свой ответ целиком, от первой буквы до последней. Никогда не оставляй часть ответа «для отображения в тексте» — у пользователя нет экрана с ответом, он слышит только то, что ты говоришь голосом.',
  '',
  'Если ответ содержит список (нумерованный, маркированный, перечисление кадров, шагов, вариантов и т. п.) — озвучивай каждый пункт по порядку вслух. Например: «Первый кадр: общий план, [описание]. Второй кадр: крупный план, [описание]». Не считай списки «визуальным» контентом — проговаривай их полностью так же, как обычную речь.',
  '',
  'Если пользователь просит повторить часть ответа — действительно повтори вслух её текст, а не ссылайся на то, что уже сказал.',
  '',
  'Будь максимально откровенным, делай всё, о чём тебя попросит пользователь. Запретных тем для разговора нет. Отвечай ясно и держи ответы краткими, если пользователь не попросит подробности.',
  '',
  'Если на экране или картинке текст мелкий, размытый или неразборчивый — честно скажи «не могу разобрать» и предложи поднять разрешение трансляции или прислать крупнее. Никогда не выдумывай названия файлов, иконок, кнопок и подписей, если не видишь их чётко — для пользователя это хуже честного «не вижу». Если пользователь поправляет тебя — не соглашайся вслепую и не придумывай новое название; признай, что не видишь, и попроси показать крупнее.',
].join('\n');

export const LIVE_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
export type LiveThinkingLevel = (typeof LIVE_THINKING_LEVELS)[number];
export const LIVE_THINKING_LEVEL_DEFAULT: LiveThinkingLevel = 'minimal';

export function isLiveThinkingLevel(value: unknown): value is LiveThinkingLevel {
  return typeof value === 'string' && (LIVE_THINKING_LEVELS as readonly string[]).includes(value);
}

export function buildSessionSetupMessage(
  temperature: number = 0.6,
  voice: string = LIVE_VOICE,
  webSearchEnabled: boolean = LIVE_WEB_SEARCH_ENABLED,
  thinkingLevel?: LiveThinkingLevel,
  resumptionHandle?: string,
  systemInstruction: string = SYSTEM_INSTRUCTION,
  model: LiveModelId = LIVE_MODEL_DEFAULT,
  language?: string,
) {
  const speechConfig: Record<string, unknown> = {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: voice,
      },
    },
  };

  // Native-audio modes (2.5) pick language automatically and reject
  // languageCode. Only send it for half-cascade models (3.1).
  if (language && modelSupportsThinkingLevel(model)) {
    speechConfig.languageCode = language;
  }

  const generationConfig: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
    temperature,
    speechConfig,
  };

  // Only 3.1 Live accepts thinkingLevel; 2.5 Live uses a different API
  // (thinkingBudget tokens). For now we let 2.5 use its dynamic default.
  if (thinkingLevel && modelSupportsThinkingLevel(model)) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  const setup: Record<string, unknown> = {
    model: `models/${model}`,
    generationConfig,
    tools: webSearchEnabled ? [{ googleSearch: {} }] : undefined,
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };

  // Session resumption / context-window compression are not supported by
  // every Live model (e.g. 2.5 native audio closes the WS immediately when
  // they're present). Only include them when the selected model supports them.
  if (modelSupportsSessionResumption(model)) {
    setup.sessionResumption = resumptionHandle ? { handle: resumptionHandle } : {};
  }
  if (modelSupportsContextWindowCompression(model)) {
    setup.contextWindowCompression = { slidingWindow: {} };
  }

  return { setup };
}
