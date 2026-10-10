// OWNER: Person A (render + buffer). Public API is frozen — see team/CONTRACTS.md.
// Milestone 2: WebGL2 passthrough of the OLDEST frame in a 15-frame ring buffer.
// The 14-frame delay is the detector's look-ahead. Damping (milestones 4–5) comes next.

import { BUFFER_FRAMES, type FilterSettings } from '../types.ts';
import { createFrameRing } from '../buffer/frameRing.ts';
import { createProgram } from './gl.ts';
import { FULLSCREEN_VERT, PASSTHROUGH_FRAG } from './shaders.ts';

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
  // preserveDrawingBuffer: the output detector reads this canvas back with drawImage.
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');

  const ring = createFrameRing(gl, BUFFER_FRAMES);
  const program = createProgram(gl, FULLSCREEN_VERT, PASSTHROUGH_FRAG);
  const uFrame = gl.getUniformLocation(program, 'uFrame');
  // An empty VAO: the fullscreen triangle is generated from gl_VertexID.
  const vao = gl.createVertexArray();

  return {
    pushFrame(video) {
      ring.push(video);
      // Match the drawing buffer to the source resolution.
      if (ring.width > 0 && (canvas.width !== ring.width || canvas.height !== ring.height)) {
        canvas.width = ring.width;
        canvas.height = ring.height;
      }
    },
    draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Displayed frame = oldest held frame (until the buffer fills, the oldest available).
      const frame = ring.textureFromOldest(0);
      if (!frame) {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frame);
      gl.uniform1i(uFrame, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    delayFrames: BUFFER_FRAMES - 1,
    dispose() {
      ring.dispose();
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}
