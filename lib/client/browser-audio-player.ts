import { AUDIO_OUTPUT_SAMPLE_RATE } from '@/lib/live-session-config';
import { pcm16Base64ToFloat32 } from '@/lib/client/audio-utils';

export class BrowserAudioPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private scheduledSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;

  async ensureReady() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: AUDIO_OUTPUT_SAMPLE_RATE });
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1;
      this.gainNode.connect(this.audioContext.destination);
      this.nextStartTime = this.audioContext.currentTime;
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  async enqueueBase64Pcm(base64Audio: string) {
    await this.ensureReady();

    if (!this.audioContext || !this.gainNode) {
      return;
    }

    const float32 = pcm16Base64ToFloat32(base64Audio);
    const buffer = this.audioContext.createBuffer(1, float32.length, AUDIO_OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const now = this.audioContext.currentTime;
    const startTime = Math.max(now, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;
    this.scheduledSources.add(source);

    source.onended = () => {
      this.scheduledSources.delete(source);
    };
  }

  interrupt() {
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        // Ignore already stopped nodes.
      }
    }

    this.scheduledSources.clear();

    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  async destroy() {
    this.interrupt();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
      this.gainNode = null;
    }
  }
}
