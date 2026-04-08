import { describe, expect, it } from 'vitest';
import {
  arrayBufferToBase64,
  downsampleBuffer,
  float32ToPcm16Buffer,
  pcm16Base64ToFloat32,
} from '@/lib/client/audio-utils';

describe('audio utils', () => {
  it('clamps float audio samples when converting to PCM16', () => {
    const pcm = new Int16Array(float32ToPcm16Buffer(new Float32Array([-2, -1, 0, 0.5, 2])));

    expect(Array.from(pcm)).toEqual([-32767, -32767, 0, 16384, 32767]);
  });

  it('round-trips PCM audio through base64', () => {
    const input = new Float32Array([0, 0.25, -0.25, 0.8]);
    const encoded = arrayBufferToBase64(float32ToPcm16Buffer(input));
    const decoded = pcm16Base64ToFloat32(encoded);

    expect(decoded).toHaveLength(input.length);
    expect(decoded[1]).toBeCloseTo(0.25, 2);
    expect(decoded[2]).toBeCloseTo(-0.25, 2);
    expect(decoded[3]).toBeCloseTo(0.8, 2);
  });

  it('downsamples audio buffers to the target rate', () => {
    const input = new Float32Array(480).fill(0.5);
    const output = downsampleBuffer(input, 48000, 16000);

    expect(output.length).toBe(160);
    expect(output[0]).toBeCloseTo(0.5, 4);
  });
});
