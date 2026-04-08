export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);

  if (typeof window === 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string) {
  if (typeof window === 'undefined') {
    const buffer = Buffer.from(base64, 'base64');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function float32ToPcm16Buffer(input: Float32Array) {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = Math.round(sample * 0x7fff);
  }

  return output.buffer;
}

export function pcm16Base64ToFloat32(base64: string) {
  const buffer = base64ToArrayBuffer(base64);
  const input = new Int16Array(buffer);
  const output = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] / 32768;
  }

  return output;
}

export function downsampleBuffer(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
) {
  if (targetSampleRate >= sourceSampleRate) {
    return input;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.round((outputIndex + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let cursor = inputIndex; cursor < nextInputIndex && cursor < input.length; cursor += 1) {
      sum += input[cursor];
      count += 1;
    }

    output[outputIndex] = count > 0 ? sum / count : 0;
    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}
