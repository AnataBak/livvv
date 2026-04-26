import {
  ATTACHED_IMAGE_MAX_BYTES,
  ATTACHED_IMAGE_MAX_DIMENSION,
} from '@/lib/live-session-config';

export type PreparedImageAttachment = {
  /** Data URL including the header — for inline preview in the chat. */
  dataUrl: string;
  /** Bare base64 payload (no header) — what we send to Gemini Live. */
  base64: string;
  /** Mime type that goes alongside the base64 to Gemini Live. */
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Pixel size of the encoded image. */
  width: number;
  height: number;
  /** Original file name (for tooltips and the user message bubble). */
  name: string;
};

const ALLOWED_INPUT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Не удалось прочитать файл.'));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Не удалось прочитать файл.'));
    };
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Файл не похож на картинку.'));
    img.src = dataUrl;
  });
}

/**
 * Reads a user-selected file, scales it down to max
 * `ATTACHED_IMAGE_MAX_DIMENSION` on the longest side and re-encodes it as JPEG
 * so we have a predictable size before sending to Gemini Live.
 */
export async function prepareImageAttachment(file: File): Promise<PreparedImageAttachment> {
  if (!file.type || !ALLOWED_INPUT_TYPES.has(file.type)) {
    throw new Error('Поддерживаются только картинки (JPG, PNG, WebP, GIF, HEIC).');
  }
  if (file.size > ATTACHED_IMAGE_MAX_BYTES) {
    throw new Error(
      `Файл слишком большой (${Math.round(file.size / (1024 * 1024))} МБ). Максимум — 5 МБ.`,
    );
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);

  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > ATTACHED_IMAGE_MAX_DIMENSION ? ATTACHED_IMAGE_MAX_DIMENSION / longest : 1;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Этот браузер не умеет обрабатывать изображения через canvas.');
  }
  // White background under transparency so PNG/WebP screenshots come out
  // looking like screenshots, not random black areas.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const [, base64 = ''] = dataUrl.split(',');

  return {
    dataUrl,
    base64,
    mimeType: 'image/jpeg',
    width: targetWidth,
    height: targetHeight,
    name: file.name || 'image.jpg',
  };
}
