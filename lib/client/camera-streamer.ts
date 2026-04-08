import { CAMERA_FRAME_RATE, CAMERA_HEIGHT, CAMERA_WIDTH } from '@/lib/live-session-config';

type FrameCallback = (base64Data: string, mimeType: string) => void;

export class CameraStreamer {
  private mediaStream: MediaStream | null = null;
  private intervalId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;

  async start(videoElement: HTMLVideoElement, onFrame: FrameCallback) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support camera access.');
    }

    this.stop(videoElement);

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: CAMERA_WIDTH },
        height: { ideal: CAMERA_HEIGHT },
      },
      audio: false,
    });

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
