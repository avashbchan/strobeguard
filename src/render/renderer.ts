// OWNER: Person A (render + buffer). Public API is frozen — see team/CONTRACTS.md.
// Displays the frame captured ~14 frame intervals ago from a 15-frame ring buffer (the
// look-ahead for the detector), chosen by capture time so uneven ticks don't speed up playback,
// filtered per pixel by the 8×6 damping mask (milestones 4–5):
//   pass 1: centered temporal low-pass of luminance (4 look-ahead frames + recursive history)
//   pass 2: apply it + red desaturation + contrast reduction + user settings → canvas
// Where the mask is 0 (and settings are neutral) the output equals the source exactly.

import { BUFFER_FRAMES, CELL_COUNT, GRID_COLS, GRID_ROWS, type FilterSettings } from '../types.ts';
import { createFrameRing } from '../buffer/frameRing.ts';
import { createProgram } from './gl.ts';
import { createLumaHistory } from './history.ts';
import { readDebugMask } from './debugMask.ts';
import { FILTER_FRAG, FULLSCREEN_VERT, HISTORY_FRAG } from './shaders.ts';

export type Renderer = {
  /** Upload the newest video frame into the ring buffer. Call once per new source frame. */
  pushFrame(video: HTMLVideoElement): void;
  /** Draw the displayed (oldest buffered) frame to the output canvas, filtered by mask + settings. */
  draw(mask: readonly number[], settings: FilterSettings): void;
  /** Frames between capture and display (BUFFER_FRAMES - 1). Audio delay = delayFrames / fps. */
  readonly delayFrames: number;
  dispose(): void;
};

/** Uniform names for the buffered frames 1..4 newer than the displayed one. */
const FUTURE_UNIFORMS = ['uFuture1', 'uFuture2', 'uFuture3', 'uFuture4'] as const;

/** Frame interval assumed before any frames arrive (30 fps). */
const DEFAULT_INTERVAL_MS = 1000 / 30;
/** Ignore gaps longer than this (stalled/background tab) when estimating the frame interval. */
const MAX_INTERVAL_MS = 250;

/** maxProtection: every cell gets at least this much damping. */
const MAX_PROTECTION_FLOOR = 0.8;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  // preserveDrawingBuffer: the output detector reads this canvas back with drawImage.
  const ctx = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
  if (!ctx) throw new Error('WebGL2 is not available in this browser.');
  const gl: WebGL2RenderingContext = ctx;

  const ring = createFrameRing(gl, BUFFER_FRAMES);
  const history = createLumaHistory(gl);
  let historyValid = false;

  const historyProgram = createProgram(gl, FULLSCREEN_VERT, HISTORY_FRAG);
  const filterProgram = createProgram(gl, FULLSCREEN_VERT, FILTER_FRAG);
  const hu = uniforms(gl, historyProgram, [
    'uFrame', 'uMask', 'uMinMask', 'uHistory', 'uHistoryValid',
    'uFuture1', 'uFuture2', 'uFuture3', 'uFuture4',
  ]);
  const fu = uniforms(gl, filterProgram, [
    'uFrame', 'uMask', 'uMinMask', 'uHistory', 'uBrightness', 'uSaturation',
  ]);
  // An empty VAO: the fullscreen triangle is generated from gl_VertexID.
  const vao = gl.createVertexArray();

  // 8×6 single-channel mask. Uploaded row 0 first, so row 0 sits at v = 0 = top of the screen.
  // LINEAR filtering interpolates between cell centres, so damping fades across cell edges.
  const maskTex = gl.createTexture();
  const maskBytes = new Uint8Array(CELL_COUNT);
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, GRID_COLS, GRID_ROWS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const debugMask = readDebugMask();

  // Display delay in TIME: delayFrames × the average frame interval. This equals the audio
  // delay the UI sets (delayFrames / measured fps), and keeps playback on the capture timeline.
  let intervalMs = DEFAULT_INTERVAL_MS;
  let lastPushMs = NaN;

  function uploadMask(mask: readonly number[]) {
    for (let i = 0; i < CELL_COUNT; i++) {
      const v = mask[i] ?? 0;
      maskBytes[i] = Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 255) : 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_COLS, GRID_ROWS, gl.RED, gl.UNSIGNED_BYTE, maskBytes);
  }

  function bindTex(unit: number, tex: WebGLTexture | null) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  return {
    pushFrame(video) {
      const now = performance.now();
      if (Number.isFinite(lastPushMs)) {
        const dt = Math.min(now - lastPushMs, MAX_INTERVAL_MS);
        intervalMs += 0.05 * (dt - intervalMs); // slow average: the delay must not wobble
      }
      lastPushMs = now;
      ring.push(video, now);
      if (ring.width === 0) return;
      // Match the drawing buffer to the source resolution.
      if (canvas.width !== ring.width || canvas.height !== ring.height) {
        canvas.width = ring.width;
        canvas.height = ring.height;
      }
      if (history.resize(ring.width, ring.height)) historyValid = false;
    },

    draw(mask, settings) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Displayed frame = the one captured (delayFrames × interval) ago; while the buffer is
      // still filling that is the oldest available. Newer frames after it are the look-ahead.
      const shown = ring.indexForAge(performance.now(), (BUFFER_FRAMES - 1) * intervalMs);
      const frame = ring.textureFromOldest(shown);
      if (!frame) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      uploadMask(debugMask ?? mask);
      const minMask = settings.maxProtection ? MAX_PROTECTION_FLOOR : 0;
      gl.bindVertexArray(vao);
      bindTex(0, frame);
      bindTex(1, maskTex);

      // Pass 1: centered low-passed luminance → history[write].
      gl.bindFramebuffer(gl.FRAMEBUFFER, history.writeFbo);
      gl.useProgram(historyProgram);
      bindTex(2, history.read);
      // Look-ahead frames for centered smoothing (units 3–6). Clamped to the newest available
      // frame while the buffer is still filling.
      FUTURE_UNIFORMS.forEach((name, i) => {
        bindTex(3 + i, ring.textureFromOldest(shown + i + 1));
        gl.uniform1i(hu[name], 3 + i);
      });
      gl.uniform1i(hu.uFrame, 0);
      gl.uniform1i(hu.uMask, 1);
      gl.uniform1i(hu.uHistory, 2);
      gl.uniform1f(hu.uMinMask, minMask);
      gl.uniform1f(hu.uHistoryValid, historyValid ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 2: filtered frame → canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(filterProgram);
      bindTex(2, history.written);
      gl.uniform1i(fu.uFrame, 0);
      gl.uniform1i(fu.uMask, 1);
      gl.uniform1i(fu.uHistory, 2);
      gl.uniform1f(fu.uMinMask, minMask);
      gl.uniform1f(fu.uBrightness, settings.brightness);
      gl.uniform1f(fu.uSaturation, settings.saturation);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      history.swap();
      historyValid = true;
    },

    delayFrames: BUFFER_FRAMES - 1,

    dispose() {
      ring.dispose();
      history.dispose();
      gl.deleteTexture(maskTex);
      gl.deleteProgram(historyProgram);
      gl.deleteProgram(filterProgram);
      gl.deleteVertexArray(vao);
    },
  };
}

function uniforms<K extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly K[],
): Record<K, WebGLUniformLocation | null> {
  const out = {} as Record<K, WebGLUniformLocation | null>;
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}
