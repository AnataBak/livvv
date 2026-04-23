import { CAMERA_FRAME_RATE, CAMERA_HEIGHT, CAMERA_WIDTH } from '@/lib/live-session-config';

type FrameCallback = (base64Data: string, mimeType: string) => void;

export function isScreenShareSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
}

export class ScreenStreamer {
  private mediaStream: MediaStream | null = null;
  private intervalId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private endedHandler: (() => void) | null = null;

  async start(
    videoElement: HTMLVideoElement,
    onFrame: FrameCallback,
    onEndedByUser?: () => void,
  ) {
    if (!isScreenShareSupported()) {
      throw new Error('Этот браузер не поддерживает демонстрацию экрана.');
    }

    this.stop(videoElement);

    this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    const [track] = this.mediaStream.getVideoTracks();
    if (track) {
      this.endedHandler = () => {
        if (onEndedByUser) onEndedByUser();
      };
      track.addEventListener('ended', this.endedHandler);
    }

    videoElement.srcObject = this.mediaStream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    await videoElement.play();

    this.canvas = document.createElement('canvas');
    this.canvas.width = CAMERA_WIDTH;
    this.canvas.height = CAMERA_HEIGHT;
    this.context = this.canvas.getContext('2d');

    const intervalMs = 1000 / CAMERA_FRAME_RATE;
    this.intervalId = window.setInterval(() => {
      if (!this.context || !this.canvas || !this.mediaStream) {
        return;
      }

      this.context.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);
      const dataUrl = this.canvas.toDataURL('image/jpeg', 0.7);
      const [, base64Payload = ''] = dataUrl.split(',');
      onFrame(base64Payload, 'image/jpeg');
    }, intervalMs);
  }

  stop(videoElement?: HTMLVideoElement | null) {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.mediaStream) {
      if (this.endedHandler) {
        const [track] = this.mediaStream.getVideoTracks();
        if (track) {
          track.removeEventListener('ended', this.endedHandler);
        }
        this.endedHandler = null;
      }
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    this.canvas = null;
    this.context = null;
  }
}
