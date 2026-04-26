import {
  SCREEN_FRAME_RATE,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from '@/lib/live-session-config';

type FrameCallback = (base64Data: string, mimeType: string) => void;
type AutoStopCallback = () => void;

export function isScreenShareSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const md = navigator.mediaDevices as
    | (MediaDevices & { getDisplayMedia?: MediaDevices['getDisplayMedia'] })
    | undefined;
  return typeof md?.getDisplayMedia === 'function';
}

export class ScreenStreamer {
  private mediaStream: MediaStream | null = null;
  private intervalId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private onAutoStopHandler: AutoStopCallback | null = null;

  async start(
    videoElement: HTMLVideoElement,
    onFrame: FrameCallback,
    onAutoStop?: AutoStopCallback,
  ) {
    if (!isScreenShareSupported()) {
      throw new Error('Этот браузер не поддерживает трансляцию экрана.');
    }

    this.stop(videoElement);
    this.onAutoStopHandler = onAutoStop ?? null;

    this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: SCREEN_WIDTH },
        height: { ideal: SCREEN_HEIGHT },
        frameRate: { ideal: 5 },
      },
      audio: false,
    });

    // Browser-level "Stop sharing" button ends the track — propagate it up so
    // the UI can flip the toggle off.
    const videoTrack = this.mediaStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        this.onAutoStopHandler?.();
      });
    }

    videoElement.srcObject = this.mediaStream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    await videoElement.play();

    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_WIDTH;
    this.canvas.height = SCREEN_HEIGHT;
    this.context = this.canvas.getContext('2d');

    const intervalMs = 1000 / SCREEN_FRAME_RATE;
    this.intervalId = window.setInterval(() => {
      if (!this.context || !this.canvas || !this.mediaStream) {
        return;
      }

      const sourceWidth = videoElement.videoWidth || SCREEN_WIDTH;
      const sourceHeight = videoElement.videoHeight || SCREEN_HEIGHT;
      // Letterbox the source into the canvas so wide displays don't get
      // squished when re-encoded as a 16:9 JPEG.
      const sourceRatio = sourceWidth / sourceHeight;
      const targetRatio = this.canvas.width / this.canvas.height;
      let drawWidth = this.canvas.width;
      let drawHeight = this.canvas.height;
      let offsetX = 0;
      let offsetY = 0;
      if (sourceRatio > targetRatio) {
        drawHeight = Math.round(this.canvas.width / sourceRatio);
        offsetY = Math.round((this.canvas.height - drawHeight) / 2);
      } else {
        drawWidth = Math.round(this.canvas.height * sourceRatio);
        offsetX = Math.round((this.canvas.width - drawWidth) / 2);
      }

      this.context.fillStyle = '#000000';
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.drawImage(videoElement, offsetX, offsetY, drawWidth, drawHeight);
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
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    this.canvas = null;
    this.context = null;
    this.onAutoStopHandler = null;
  }

  isActive(): boolean {
    return this.mediaStream !== null;
  }
}
