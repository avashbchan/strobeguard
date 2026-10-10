// OWNER: Person A (render + buffer). Public API is frozen — see team/CONTRACTS.md.
// STUB: clears the output canvas to black. It must never draw the raw frame
// unfiltered at large size (safety rule), so the stub draws nothing.

import { BUFFER_FRAMES, type FilterSettings } from '../types.ts';

export type Renderer = {
  /** Upload the newest video frame into the ring buffer. Call once per new source frame. */
  pushFrame(video: HTMLVideoElement): void;
  /** Draw the displayed (oldest buffered) frame to the output canvas, filtered by mask + settings. */
  draw(mask: readonly number[], settings: FilterSettings): void;
  /** Frames between capture and display (BUFFER_FRAMES - 1). Audio delay = delayFrames / fps. */
  readonly delayFrames: number;
  dispose(): void;
};

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');

  return {
    pushFrame(video) {
      // Match the drawing buffer to the source resolution.
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    delayFrames: BUFFER_FRAMES - 1,
    dispose() {},
  };
}
