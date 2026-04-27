import {
  LIVE_MODEL_DEFAULT,
  LIVE_THINKING_LEVEL_DEFAULT,
  LIVE_VOICE,
  LIVE_WEB_SEARCH_ENABLED,
  SYSTEM_INSTRUCTION,
  isLiveModelId,
  isLiveThinkingLevel,
  type LiveModelId,
  type LiveThinkingLevel,
} from '@/lib/live-session-config';

export const PRESETS_STORAGE_KEY = 'gemini-live-presets-v1';
export const ACTIVE_PRESET_STORAGE_KEY = 'gemini-live-active-preset';
export const LEGACY_PRESETS_STORAGE_KEY = 'gemini-live-system-instruction-presets';

/** Sentinel value for the dropdown "standard" option (no saved preset). */
export const STANDARD_PRESET_VALUE = '__standard__';

/** All settings that travel with a preset. Anything not in this type stays
 *  device-local and is never copied between devices via share. */
export type PresetSettings = {
  systemInstruction: string;
  model: LiveModelId;
  temperature: number;
  voice: string;
  language: string;
  webSearchEnabled: boolean;
  thinkingLevel: LiveThinkingLevel;
};

export type PresetV1 = PresetSettings & {
  v: 1;
  name: string;
};

export const DEFAULT_PRESET_SETTINGS: PresetSettings = {
  systemInstruction: SYSTEM_INSTRUCTION,
  model: LIVE_MODEL_DEFAULT,
  temperature: 0.6,
  voice: LIVE_VOICE,
  language: '',
  webSearchEnabled: LIVE_WEB_SEARCH_ENABLED,
  thinkingLevel: LIVE_THINKING_LEVEL_DEFAULT,
};

const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;

function clampTemperature(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PRESET_SETTINGS.temperature;
  }
  return Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, value));
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Read an arbitrary object as PresetSettings, filling in defaults for any
 *  missing/invalid field. Used both for migration and for import validation. */
export function coercePresetSettings(raw: unknown): PresetSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PRESET_SETTINGS };
  }
  const r = raw as Record<string, unknown>;
  const model = isLiveModelId(r.model) ? r.model : DEFAULT_PRESET_SETTINGS.model;
  const thinkingLevel = isLiveThinkingLevel(r.thinkingLevel)
    ? r.thinkingLevel
    : DEFAULT_PRESET_SETTINGS.thinkingLevel;
  return {
    systemInstruction: coerceString(r.systemInstruction, DEFAULT_PRESET_SETTINGS.systemInstruction),
    model,
    temperature: clampTemperature(r.temperature),
    voice: coerceString(r.voice, DEFAULT_PRESET_SETTINGS.voice),
    language: coerceString(r.language, DEFAULT_PRESET_SETTINGS.language),
    webSearchEnabled: coerceBoolean(r.webSearchEnabled, DEFAULT_PRESET_SETTINGS.webSearchEnabled),
    thinkingLevel,
  };
}

/** Two settings objects equal? Used for the "modified •" dirty marker. */
export function presetSettingsEqual(a: PresetSettings, b: PresetSettings): boolean {
  return (
    a.systemInstruction === b.systemInstruction &&
    a.model === b.model &&
    a.temperature === b.temperature &&
    a.voice === b.voice &&
    a.language === b.language &&
    a.webSearchEnabled === b.webSearchEnabled &&
    a.thinkingLevel === b.thinkingLevel
  );
}

function readJsonItem(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJsonItem(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be full or disabled; ignore.
  }
}

/** Migrate legacy `{name, text}[]` presets into the V1 format. The legacy
 *  key is left untouched on disk so users who downgrade don't lose data. */
function migrateLegacyPresets(): PresetV1[] {
  const raw = readJsonItem(LEGACY_PRESETS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  const migrated: PresetV1[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as { name?: unknown; text?: unknown };
    if (typeof obj.name !== 'string' || typeof obj.text !== 'string') continue;
    const name = obj.name.trim();
    if (!name) continue;
    migrated.push({
      v: 1,
      name,
      ...DEFAULT_PRESET_SETTINGS,
      systemInstruction: obj.text,
    });
  }
  return migrated;
}

export function readPresets(): PresetV1[] {
  const raw = readJsonItem(PRESETS_STORAGE_KEY);
  if (Array.isArray(raw)) {
    const out: PresetV1[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      if (!name) continue;
      out.push({ v: 1, name, ...coercePresetSettings(obj) });
    }
    return out;
  }
  // No V1 list yet — try legacy migration once.
  const legacy = migrateLegacyPresets();
  if (legacy.length > 0) {
    writeJsonItem(PRESETS_STORAGE_KEY, legacy);
  }
  return legacy;
}

export function writePresets(presets: PresetV1[]): void {
  writeJsonItem(PRESETS_STORAGE_KEY, presets);
}

export function readActivePresetName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY);
    return raw ?? null;
  } catch {
    return null;
  }
}

export function writeActivePresetName(name: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (name === null) {
      window.localStorage.removeItem(ACTIVE_PRESET_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, name);
    }
  } catch {
    // ignore
  }
}

// ---- Share-string encoding ----
//
// Format: `livvv:preset:v1:<base64url(JSON)>`
//
// We use base64url (no padding, '+' → '-', '/' → '_') so the string is safe
// to paste anywhere — Telegram, URLs, code blocks — without escaping.

export const SHARE_PREFIX = 'livvv:preset:v1:';

function utf8ToBase64Url(input: string): string {
  // btoa() can only encode latin1; system prompts contain Cyrillic, so we
  // run UTF-8 through TextEncoder first, then base64-encode the byte stream.
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToUtf8(input: string): string | null {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  try {
    if (typeof atob === 'function') {
      const binary = atob(padded + padding);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(padded + padding, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

export function encodePresetShareString(preset: PresetV1): string {
  // We deliberately re-serialize from a known shape — extra unknown fields
  // a malicious sender might smuggle in won't make it into the payload.
  const payload = {
    v: 1 as const,
    name: preset.name,
    systemInstruction: preset.systemInstruction,
    model: preset.model,
    temperature: preset.temperature,
    voice: preset.voice,
    language: preset.language,
    webSearchEnabled: preset.webSearchEnabled,
    thinkingLevel: preset.thinkingLevel,
  };
  return `${SHARE_PREFIX}${utf8ToBase64Url(JSON.stringify(payload))}`;
}

export type DecodeResult =
  | { ok: true; preset: PresetV1 }
  | { ok: false; error: string };

export function decodePresetShareString(input: string): DecodeResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Пустая строка пресета.' };
  }
  if (!trimmed.startsWith(SHARE_PREFIX)) {
    return {
      ok: false,
      error: 'Не похоже на строку пресета — должна начинаться с «livvv:preset:v1:».',
    };
  }
  const decoded = base64UrlToUtf8(trimmed.slice(SHARE_PREFIX.length));
  if (decoded === null) {
    return { ok: false, error: 'Не удалось декодировать строку (повреждена?).' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { ok: false, error: 'Внутри строки не валидный JSON.' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Пресет должен быть JSON-объектом.' };
  }
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'У пресета не указано имя.' };
  }
  const settings = coercePresetSettings(obj);
  return { ok: true, preset: { v: 1, name, ...settings } };
}

/** Pick a non-conflicting name based on `desired`. Appends " (импорт)",
 *  " (импорт 2)", … until a free slot is found. */
export function makeUniquePresetName(desired: string, existing: PresetV1[]): string {
  const taken = new Set(existing.map((p) => p.name));
  if (!taken.has(desired)) return desired;
  const base = `${desired} (импорт)`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${desired} (импорт ${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${desired} (${Date.now()})`;
}
