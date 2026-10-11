// OWNER: Person A (render + buffer). Public API is frozen — see team/CONTRACTS.md.
// Displays the frame captured a fixed 467 ms ago (14 frames at 30 fps) from a 15-frame ring
// buffer (the look-ahead for the detector), chosen by capture time so uneven ticks and stalls
// never speed up or reverse playback,
// filtered by the 8×6 damping mask (milestones 4–5), through a coarse brightness FIELD, not per pixel:
//   pass 1: per screen region (FIELD_COLS × FIELD_ROWS texels, aligned with the mask grid) the colour is
//           low-passed over time (4 look-ahead frames + recursive history), and the gain and fill that
//           bring the region's current brightness to the smoothed one are worked out
//   pass 2: every pixel is multiplied by the smooth gain and gets the smooth fill added; red regions take
//           the smoothed hue; user settings → canvas
// Pixel detail always comes from the current frame, so moving content does not trail behind.
// Where the mask is 0 (and settings are neutral) the output equals the source exactly.
// Survives WebGL context loss: GPU objects are rebuilt on webglcontextrestored.

import { BUFFER_FRAMES, CELL_COUNT, GRID_COLS, GRID_ROWS, type FilterSettings } from '../types.ts';
import { createFrameRing } from '../buffer/frameRing.ts';
import { createProgram } from './gl.ts';
import { createLumaHistory } from './history.ts';
import { readDebugMask } from './debugMask.ts';
import { FILTER_FRAG, FULLSCREEN_VERT, HISTORY_FRAG, TEXTURE_VERT } from './shaders.ts';

export type Renderer = {
  /** Upload the newest video frame into the ring buffer. Call once per new source frame. */
  pushFrame(video: HTMLVideoElement): void;
  /** Draw the displayed (oldest buffered) frame to the output canvas, filtered by mask + settings. */
  draw(mask: readonly number[], settings: FilterSettings): void;
  /** Frames between capture and display (BUFFER_FRAMES - 1). The video delay is fixed at
   *  delayFrames / 30 fps = 467 ms, so the audio delay should be the same constant. */
  readonly delayFrames: number;
  dispose(): void;
};

/** Uniform names for the buffered frames 1..4 newer than the displayed one. */
const FUTURE_UNIFORMS = ['uFuture1', 'uFuture2', 'uFuture3', 'uFuture4'] as const;

/**
 * Fixed display delay: delayFrames at the nominal 30 fps = 467 ms. A constant delay keeps the
 * output on the capture timeline; an adaptive one (tracking the measured frame rate) shifts
 * when the frame loop stalls, which replays frames faster or backwards and can add flashes.
 */
const NOMINAL_FPS = 30;
const DISPLAY_DELAY_MS = ((BUFFER_FRAMES - 1) * 1000) / NOMINAL_FPS;

/**
 * Resolution of the smoothing field (pass 1). Each texel covers 1/40 × 1/24 of the screen, a few times
 * finer than the 8×6 damping mask. Smoothing this coarse field, not every pixel, is what stops moving
 * content from trailing; see HISTORY_FRAG.
 */
const FIELD_COLS = 8;
const FIELD_ROWS = 6;

/** maxProtection: every cell gets at least this much damping. */
const MAX_PROTECTION_FLOOR = 0.8;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  // preserveDrawingBuffer: the output detector reads this canvas back with drawImage.
  const ctx = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
  if (!ctx) throw new Error('WebGL2 is not available in this browser.');
  const gl: WebGL2RenderingContext = ctx;

  const debugMask = readDebugMask();
  const maskBytes = new Uint8Array(CELL_COUNT);
  let historyValid = false;
  // Capture time of the last frame shown. Playback must never step back in source time:
  // re-showing an older frame after a newer one can insert a flash that isn't in the source.
  let lastShownMs = -Infinity;

  // All GPU resources. null while the WebGL context is lost (GPU reset, driver hiccup, memory
  // pressure); rebuilt on restore so the output recovers instead of staying black.
  let gpu: Gpu | null = createGpu(gl);

  const onContextLost = (e: Event) => {
    e.preventDefault(); // tells the browser we will handle restoration
    gpu = null; // its objects are already invalid; nothing to delete
  };
  const onContextRestored = () => {
    gpu = createGpu(gl);
    historyValid = false;
    lastShownMs = -Infinity;
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  function uploadMask(maskTex: WebGLTexture, mask: readonly number[]) {
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
      if (!gpu) return;
      const { ring, history } = gpu;
      ring.push(video, performance.now());
      if (ring.width === 0) return;
      // Match the drawing buffer to the stored (possibly downscaled) frame size.
      if (canvas.width !== ring.width || canvas.height !== ring.height) {
        canvas.width = ring.width;
        canvas.height = ring.height;
      }
      if (history.resize(FIELD_COLS, FIELD_ROWS)) historyValid = false;
    },

    draw(mask, settings) {
      if (!gpu) return;
      const { ring, history, historyProgram, filterProgram, hu, fu, vao, maskTex } = gpu;
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Displayed frame = the one captured DISPLAY_DELAY_MS ago (while the buffer is still
      // filling, the oldest available). Newer frames after it are the look-ahead.
      let shown = ring.indexForAge(performance.now(), DISPLAY_DELAY_MS);
      while (shown < ring.count - 1 && ring.timeFromOldest(shown) < lastShownMs) shown++;
      lastShownMs = ring.timeFromOldest(shown);
      const frame = ring.textureFromOldest(shown);
      if (!frame) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      uploadMask(maskTex, debugMask ?? mask);
      const minMask = settings.maxProtection ? MAX_PROTECTION_FLOOR : 0;
      gl.bindVertexArray(vao);
      bindTex(0, frame);
      bindTex(1, maskTex);

      // Pass 1: centered low-passed colour of each screen region → field[write] (small viewport).
      gl.viewport(0, 0, FIELD_COLS, FIELD_ROWS);
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
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(filterProgram);
      bindTex(2, history.written);
      bindTex(3, history.writtenGain);
      gl.uniform1i(fu.uGain, 3);
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
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (gpu && !gl.isContextLost()) gpu.dispose();
      gpu = null;
    },
  };
}

type Gpu = ReturnType<typeof createGpu>;

/** Create every GPU object the renderer needs. Called at start and after a context restore. */
function createGpu(gl: WebGL2RenderingContext) {
  const ring = createFrameRing(gl, BUFFER_FRAMES);
  const history = createLumaHistory(gl);
  const historyProgram = createProgram(gl, TEXTURE_VERT, HISTORY_FRAG); // renders into a texture
  const filterProgram = createProgram(gl, FULLSCREEN_VERT, FILTER_FRAG);
  const hu = uniforms(gl, historyProgram, [
    'uFrame', 'uMask', 'uMinMask', 'uHistory', 'uHistoryValid',
    'uFuture1', 'uFuture2', 'uFuture3', 'uFuture4',
  ]);
  const fu = uniforms(gl, filterProgram, [
    'uFrame', 'uMask', 'uMinMask', 'uHistory', 'uGain', 'uBrightness', 'uSaturation',
  ]);
  // An empty VAO: the fullscreen triangle is generated from gl_VertexID.
  const vao = gl.createVertexArray();

  // 8×6 single-channel mask. Uploaded row 0 first, so row 0 sits at v = 0 = top of the screen.
  // LINEAR filtering interpolates between cell centres, so damping fades across cell edges.
  const maskTex = gl.createTexture();
  if (!maskTex) throw new Error('Could not create WebGL texture.');
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, GRID_COLS, GRID_ROWS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    ring, history, historyProgram, filterProgram, hu, fu, vao, maskTex,
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
