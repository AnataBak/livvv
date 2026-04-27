import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVE_PRESET_STORAGE_KEY,
  DEFAULT_PRESET_SETTINGS,
  LEGACY_PRESETS_STORAGE_KEY,
  PRESETS_STORAGE_KEY,
  SHARE_PREFIX,
  coercePresetSettings,
  decodePresetShareString,
  encodePresetShareString,
  makeUniquePresetName,
  presetSettingsEqual,
  readActivePresetName,
  readPresets,
  writeActivePresetName,
  writePresets,
  type PresetV1,
} from '@/lib/client/presets';

const SAMPLE: PresetV1 = {
  v: 1,
  name: 'Режиссёр',
  systemInstruction: 'Ты режиссёр. Думай кадрами 🎬.',
  model: 'gemini-3.1-flash-live-preview',
  temperature: 0.9,
  voice: 'Kore',
  language: 'ru-RU',
  webSearchEnabled: true,
  thinkingLevel: 'medium',
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('coercePresetSettings', () => {
  it('returns defaults for non-objects', () => {
    expect(coercePresetSettings(null)).toEqual(DEFAULT_PRESET_SETTINGS);
    expect(coercePresetSettings('nope')).toEqual(DEFAULT_PRESET_SETTINGS);
  });

  it('clamps temperature into [0, 2] and falls back when invalid', () => {
    expect(coercePresetSettings({ temperature: 5 }).temperature).toBe(2);
    expect(coercePresetSettings({ temperature: -1 }).temperature).toBe(0);
    expect(coercePresetSettings({ temperature: 'hot' }).temperature).toBe(
      DEFAULT_PRESET_SETTINGS.temperature,
    );
  });

  it('falls back when model or thinkingLevel are unknown', () => {
    const out = coercePresetSettings({ model: 'gemini-omg', thinkingLevel: 'extreme' });
    expect(out.model).toBe(DEFAULT_PRESET_SETTINGS.model);
    expect(out.thinkingLevel).toBe(DEFAULT_PRESET_SETTINGS.thinkingLevel);
  });
});

describe('presetSettingsEqual', () => {
  it('returns true for identical settings', () => {
    expect(presetSettingsEqual({ ...DEFAULT_PRESET_SETTINGS }, { ...DEFAULT_PRESET_SETTINGS })).toBe(
      true,
    );
  });

  it('returns false when any field differs', () => {
    const a = { ...DEFAULT_PRESET_SETTINGS };
    const b = { ...DEFAULT_PRESET_SETTINGS, temperature: 0.7 };
    expect(presetSettingsEqual(a, b)).toBe(false);
  });
});

describe('readPresets / writePresets', () => {
  it('round-trips a preset list', () => {
    writePresets([SAMPLE]);
    const got = readPresets();
    expect(got).toEqual([SAMPLE]);
  });

  it('migrates legacy {name,text} presets on first read', () => {
    window.localStorage.setItem(
      LEGACY_PRESETS_STORAGE_KEY,
      JSON.stringify([
        { name: 'Старый', text: 'старый текст' },
        { name: '', text: 'без имени — будет отброшен' },
        'мусор',
      ]),
    );

    const got = readPresets();
    expect(got).toHaveLength(1);
    expect(got[0]?.name).toBe('Старый');
    expect(got[0]?.systemInstruction).toBe('старый текст');
    // Migration result is persisted under the new key:
    const persisted = JSON.parse(window.localStorage.getItem(PRESETS_STORAGE_KEY) ?? '[]');
    expect(persisted).toHaveLength(1);
  });

  it('drops entries without a name', () => {
    window.localStorage.setItem(
      PRESETS_STORAGE_KEY,
      JSON.stringify([{ ...SAMPLE, name: '' }, SAMPLE, 'x']),
    );
    expect(readPresets()).toEqual([SAMPLE]);
  });
});

describe('readActivePresetName / writeActivePresetName', () => {
  it('round-trips an active preset name', () => {
    expect(readActivePresetName()).toBeNull();
    writeActivePresetName('Режиссёр');
    expect(readActivePresetName()).toBe('Режиссёр');
    writeActivePresetName(null);
    expect(readActivePresetName()).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY)).toBeNull();
  });
});

describe('encodePresetShareString / decodePresetShareString', () => {
  it('round-trips a preset with cyrillic + emoji content', () => {
    const encoded = encodePresetShareString(SAMPLE);
    expect(encoded.startsWith(SHARE_PREFIX)).toBe(true);
    // base64url has no '+' or '/' or '=' chars
    expect(encoded.slice(SHARE_PREFIX.length)).not.toMatch(/[+/=]/);

    const result = decodePresetShareString(encoded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset).toEqual(SAMPLE);
    }
  });

  it('tolerates surrounding whitespace', () => {
    const encoded = encodePresetShareString(SAMPLE);
    const result = decodePresetShareString(`   \n${encoded}\n  `);
    expect(result.ok).toBe(true);
  });

  it('rejects strings without the prefix', () => {
    const result = decodePresetShareString('hello world');
    expect(result.ok).toBe(false);
  });

  it('rejects corrupted payloads', () => {
    const broken = `${SHARE_PREFIX}!!!not-base64!!!`;
    const result = decodePresetShareString(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects empty preset names', () => {
    const encoded = encodePresetShareString({ ...SAMPLE, name: '   ' });
    const result = decodePresetShareString(encoded);
    expect(result.ok).toBe(false);
  });

  it('coerces invalid imported settings to defaults', () => {
    // Hand-roll a payload with an unknown model + bad temperature.
    const payload = {
      v: 1,
      name: 'Подделка',
      systemInstruction: 'x',
      model: 'gemini-omg',
      temperature: 99,
      voice: 'Kore',
      language: 'ru-RU',
      webSearchEnabled: 'truthy',
      thinkingLevel: 'extreme',
    };
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/u, '');
    const encoded = `${SHARE_PREFIX}${b64}`;

    const result = decodePresetShareString(encoded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset.model).toBe(DEFAULT_PRESET_SETTINGS.model);
      expect(result.preset.temperature).toBe(2);
      expect(result.preset.thinkingLevel).toBe(DEFAULT_PRESET_SETTINGS.thinkingLevel);
      expect(result.preset.webSearchEnabled).toBe(DEFAULT_PRESET_SETTINGS.webSearchEnabled);
    }
  });
});

describe('makeUniquePresetName', () => {
  it('returns the desired name when it is free', () => {
    expect(makeUniquePresetName('A', [])).toBe('A');
  });

  it('appends "(импорт)" when the name is taken', () => {
    const existing: PresetV1[] = [{ ...SAMPLE, name: 'A' }];
    expect(makeUniquePresetName('A', existing)).toBe('A (импорт)');
  });

  it('keeps incrementing the suffix when impорт is also taken', () => {
    const existing: PresetV1[] = [
      { ...SAMPLE, name: 'A' },
      { ...SAMPLE, name: 'A (импорт)' },
      { ...SAMPLE, name: 'A (импорт 2)' },
    ];
    expect(makeUniquePresetName('A', existing)).toBe('A (импорт 3)');
  });
});
