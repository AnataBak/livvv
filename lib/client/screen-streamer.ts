import {
  SCREEN_FRAME_RATE,
  SCREEN_RESOLUTION_MAX,
  type ScreenFormat,
  type ScreenResolution,
} from '@/lib/live-session-config';

type FrameCallback = (base64Data: string, mimeType: string) => void;
type AutoStopCallback = () => void;

export type ScreenStreamerOptions = {
  format: ScreenFormat;
  /** Only used when `format === 'jpeg'`. */
  jpegQuality: number;
  resolution: ScreenResolution;
};

export function isScreenShareSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const md = navigator.mediaDevices as
    | (MediaDevices & { getDisplayMedia?: MediaDevices['getDisplayMedia'] })
    | undefined;
  return typeof md?.getDisplayMedia === 'function';
}

function resolveCanvasSize(
  sourceWidth: number,
  sourceHeight: number,
  resolution: ScreenResolution,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 1280, height: 720 };
  }
  const maxLongest = SCREEN_RESOLUTION_MAX[resolution];
  const longest = Math.max(sourceWidth, sourceHeight);
  if (!Number.isFinite(maxLongest) || longest <= maxLongest) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = maxLongest / longest;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export class ScreenStreamer {
  private mediaStream: MediaStream | null = null;
  private intervalId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private onAutoStopHandler: AutoStopCallback | null = null;
  private options: ScreenStreamerOptions | null = null;

  async start(
    videoElement: HTMLVideoElement,
    onFrame: FrameCallback,
    options: ScreenStreamerOptions,
    onAutoStop?: AutoStopCallback,
  ) {
    if (!isScreenShareSupported()) {
      throw new Error('Этот браузер не поддерживает трансляцию экрана.');
    }

    this.stop(videoElement);
    this.onAutoStopHandler = onAutoStop ?? null;
    this.options = options;

    // Hint the browser at the desired ideal — for `native` we still don't
    // request a fixed size so we get the source's true resolution.
    const targetMax = SCREEN_RESOLUTION_MAX[options.resolution];
    const constraints: MediaTrackConstraints = Number.isFinite(targetMax)
      ? {
          width: { ideal: targetMax },
          height: { ideal: Math.round(targetMax * (9 / 16)) },
          frameRate: { ideal: 5 },
        }
      : { frameRate: { ideal: 5 } };

    this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: constraints,
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
    this.context = this.canvas.getContext('2d');

    const intervalMs = 1000 / SCREEN_FRAME_RATE;
    this.intervalId = window.setInterval(() => {
      if (!this.context || !this.canvas || !this.mediaStream || !this.options) {
        return;
      }

      const sourceWidth = videoElement.videoWidth;
      const sourceHeight = videoElement.videoHeight;
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        return;
      }

      // Recompute canvas size every tick — `getDisplayMedia` doesn't lock the
      // source dimensions until the user picks a window, and the user can
      // also resize the captured window mid-stream.
      const { width, height } = resolveCanvasSize(
        sourceWidth,
        sourceHeight,
        this.options.resolution,
      );
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      // No letterbox: the canvas matches the source aspect ratio so every
      // pixel is useful (important for legible text in IDEs and chat apps).
      this.context.drawImage(videoElement, 0, 0, width, height);

      const dataUrl = this.options.format === 'png'
        ? this.canvas.toDataURL('image/png')
        : this.canvas.toDataURL('image/jpeg', this.options.jpegQuality);
      const [, base64Payload = ''] = dataUrl.split(',');
      onFrame(base64Payload, this.options.format === 'png' ? 'image/png' : 'image/jpeg');
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
    this.options = null;
  }

  isActive(): boolean {
    return this.mediaStream !== null;
  }
}
