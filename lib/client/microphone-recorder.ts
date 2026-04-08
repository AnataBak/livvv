import { AUDIO_INPUT_SAMPLE_RATE } from '@/lib/live-session-config';
import { arrayBufferToBase64, downsampleBuffer, float32ToPcm16Buffer } from '@/lib/client/audio-utils';

type AudioChunkCallback = (base64Pcm: string) => void;

export class MicrophoneRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sinkNode: GainNode | null = null;
  private onChunk: AudioChunkCallback | null = null;

  async start(onChunk: AudioChunkCallback) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support microphone access.');
    }

    this.stop();
    this.onChunk = onChunk;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext();

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (!this.audioContext.createScriptProcessor) {
      throw new Error('This browser does not expose ScriptProcessorNode, so live microphone capture cannot start.');
    }

    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.sinkNode = this.audioContext.createGain();
    this.sinkNode.gain.value = 0;

    this.processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      const copiedChannel = new Float32Array(channel);
      const downsampled = downsampleBuffer(
        copiedChannel,
        this.audioContext?.sampleRate ?? AUDIO_INPUT_SAMPLE_RATE,
        AUDIO_INPUT_SAMPLE_RATE,
      );
      const pcmBuffer = float32ToPcm16Buffer(downsampled);
      this.onChunk?.(arrayBufferToBase64(pcmBuffer));
    };

    this.source.connect(this.processor);
    this.processor.connect(this.sinkNode);
    this.sinkNode.connect(this.audioContext.destination);
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.sinkNode) {
      this.sinkNode.disconnect();
      this.sinkNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}
