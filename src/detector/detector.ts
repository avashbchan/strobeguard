// OWNER: Person B (detector). Public API is frozen — see team/CONTRACTS.md.
// Main-thread side: downscale each frame to 64×36, post it to this detector's worker,
// forward the worker's RiskReports. Detection math lives in detectorCore.ts.

import type { RiskReport } from '../types.ts';
import type { FrameMessage, ReportMessage } from './messages.ts';

export type Detector = {
  /**
   * Analyze one frame. The detector downscales `source` to 64×36 itself and
   * posts the pixels to its Web Worker. May drop frames if the worker is busy.
   */
  analyze(source: CanvasImageSource): void;
  dispose(): void;
};

const WIDTH = 64;
const HEIGHT = 36;

/** Skip sources with nothing to draw yet (video not loaded, zero-size canvas). */
function hasPixels(source: CanvasImageSource): boolean {
  if (source instanceof HTMLVideoElement) {
    return source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth > 0;
  }
  if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas) {
    return source.width > 0 && source.height > 0;
  }
  return true;
}

export type FrameGrabber = (source: CanvasImageSource) => ImageData | null;

/**
 * Returns a function that downscales a frame to 64×36 RGBA, or null if there is nothing to read.
 * Shared by the live detector and the offline (IRIS comparison) runner so both see identical pixels.
 */
export function createFrameGrabber(): FrameGrabber {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    // 'high' makes Chrome average source pixels when shrinking, instead of point-sampling
    // a few of them (which would alias fine detail into fake luminance changes).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  return (source) => {
    if (!ctx || !hasPixels(source)) return null;
    try {
      ctx.drawImage(source, 0, 0, WIDTH, HEIGHT);
    } catch (err) {
      console.warn('[detector] could not read frame:', err);
      return null;
    }
    return ctx.getImageData(0, 0, WIDTH, HEIGHT);
  };
}

/** Each call creates an independent detector (own worker + own state). */
export function createDetector(onReport: (report: RiskReport) => void): Detector {
  const worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
  const grab = createFrameGrabber();

  let frameIndex = 0;
  let busy = false; // at most one frame in flight
  let disposed = false;

  worker.onmessage = (e: MessageEvent<ReportMessage>) => {
    busy = false;
    if (!disposed) onReport(e.data.report);
  };
  worker.onerror = (e) => {
    busy = false;
    console.error('[detector] worker error:', e.message);
  };

  return {
    analyze(source) {
      const index = frameIndex++; // counts every source frame, including dropped ones
      if (disposed || busy) return;
      const image = grab(source);
      if (!image) return;
      const { data } = image;
      const msg: FrameMessage = {
        buffer: data.buffer,
        width: WIDTH,
        height: HEIGHT,
        timeMs: performance.now(),
        frameIndex: index,
      };
      busy = true;
      worker.postMessage(msg, [data.buffer]); // transfer, no copy
    },
    dispose() {
      disposed = true;
      worker.terminate();
    },
  };
}
