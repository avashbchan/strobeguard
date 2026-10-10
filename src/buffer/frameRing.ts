// OWNER: Person A. Ring buffer of the last BUFFER_FRAMES video frames as WebGL2 textures.
// The newest frame is analyzed by the detector; the renderer displays the frame captured about
// (BUFFER_FRAMES - 1) frame intervals ago (see indexForAge), so the newer ones are its look-ahead.
//
// Textures are allocated once per source resolution (texStorage2D) and reused; each new
// frame is a texSubImage2D into the next slot. Nothing is allocated per frame.
//
// Frames are stored at most MAX_WIDTH × MAX_HEIGHT. A larger source (big or 5K display) is
// uploaded once into a mipmapped staging texture and drawn down into the slot with trilinear
// filtering, instead of keeping 15 full-size copies (~1 GB of GPU memory at 5K).

import { createProgram } from '../render/gl.ts';
import { TEXTURE_VERT } from '../render/shaders.ts';

export const MAX_WIDTH = 1920;
export const MAX_HEIGHT = 1080;

// Copy the staging frame into a slot. Both use v = 0 = top, and TEXTURE_VERT doesn't flip.
const COPY_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 outColor;
void main() {
  outColor = texture(uSrc, vUv);
}
`;

export type FrameRing = {
  /** Upload a new frame into the next slot, stamped with its capture time (ms). */
  push(video: HTMLVideoElement, timeMs: number): void;
  /** Number of frames currently held (0..capacity). */
  readonly count: number;
  readonly capacity: number;
  /** Stored (possibly downscaled) frame size. */
  readonly width: number;
  readonly height: number;
  /**
   * Texture `k` frames newer than the oldest held frame (k = 0 is the oldest).
   * k is clamped to the frames available, so early on this returns the newest frame instead.
   */
  textureFromOldest(k: number): WebGLTexture | null;
  /**
   * k (from oldest) of the held frame whose age at `nowMs` is closest to `targetAgeMs`.
   * Selecting by age instead of always showing the oldest slot keeps the displayed sequence
   * on the capture timeline: with uneven frame ticks, a fixed frame-count delay would replay
   * frames faster or slower than they happened, which can make flashes look faster.
   */
  indexForAge(nowMs: number, targetAgeMs: number): number;
  /** Capture time (ms) of the frame `k` newer than the oldest (clamped like textureFromOldest). */
  timeFromOldest(k: number): number;
  dispose(): void;
};

export function createFrameRing(gl: WebGL2RenderingContext, capacity: number): FrameRing {
  let textures: WebGLTexture[] = [];
  let width = 0; // stored size
  let height = 0;
  let srcWidth = 0; // source size the buffer was allocated for
  let srcHeight = 0;
  let staging: WebGLTexture | null = null; // full-size upload target, only when downscaling
  let copyProgram: WebGLProgram | null = null;
  let copySrc: WebGLUniformLocation | null = null;
  const fbo = gl.createFramebuffer();
  let writeIndex = 0; // slot the NEXT push writes into
  let count = 0;
  const times = new Float64Array(capacity); // capture time of each slot

  function freeTextures() {
    textures.forEach((t) => gl.deleteTexture(t));
    textures = [];
    if (staging) gl.deleteTexture(staging);
    staging = null;
  }

  function allocate(sw: number, sh: number) {
    freeTextures();
    const scale = Math.min(1, MAX_WIDTH / sw, MAX_HEIGHT / sh);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    if (scale < 1) {
      staging = gl.createTexture();
      if (!staging) throw new Error('Could not create WebGL texture.');
      gl.bindTexture(gl.TEXTURE_2D, staging);
      const levels = Math.floor(Math.log2(Math.max(sw, sh))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, sw, sh);
      // Trilinear: averages source pixels when shrinking, so fine detail doesn't alias/shimmer.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (!copyProgram) {
        copyProgram = createProgram(gl, TEXTURE_VERT, COPY_FRAG);
        copySrc = gl.getUniformLocation(copyProgram, 'uSrc');
      }
    }
    for (let i = 0; i < capacity; i++) {
      const tex = gl.createTexture();
      if (!tex) throw new Error('Could not create WebGL texture.');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.push(tex);
    }
    width = w;
    height = h;
    srcWidth = sw;
    srcHeight = sh;
    // Old frames were a different size; start the buffer over.
    writeIndex = 0;
    count = 0;
  }

  return {
    push(video, timeMs) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) return;
      if (w !== srcWidth || h !== srcHeight) allocate(w, h);

      const tex = textures[writeIndex];
      if (!tex) return;
      // No UNPACK_FLIP_Y: the video's top row lands at texture v = 0. The canvas pass maps
      // v = 0 to the top of the screen, so the image (and the mask) stay upright.
      if (!staging) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, video);
      } else {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, staging);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.viewport(0, 0, width, height);
        gl.useProgram(copyProgram);
        gl.uniform1i(copySrc, 0);
        gl.bindVertexArray(null);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      times[writeIndex] = timeMs;

      writeIndex = (writeIndex + 1) % capacity;
      count = Math.min(count + 1, capacity);
    },
    get count() {
      return count;
    },
    capacity,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    textureFromOldest(k) {
      if (count === 0) return null;
      const clamped = Math.max(0, Math.min(k, count - 1));
      const oldest = (writeIndex - count + capacity) % capacity;
      return textures[(oldest + clamped) % capacity] ?? null;
    },
    indexForAge(nowMs, targetAgeMs) {
      const oldest = (writeIndex - count + capacity) % capacity;
      let best = 0;
      let bestErr = Infinity;
      for (let k = 0; k < count; k++) {
        const err = Math.abs(nowMs - (times[(oldest + k) % capacity] ?? 0) - targetAgeMs);
        if (err < bestErr) {
          bestErr = err;
          best = k;
        }
      }
      return best;
    },
    timeFromOldest(k) {
      if (count === 0) return -Infinity;
      const clamped = Math.max(0, Math.min(k, count - 1));
      const oldest = (writeIndex - count + capacity) % capacity;
      return times[(oldest + clamped) % capacity] ?? -Infinity;
    },
    dispose() {
      freeTextures();
      if (copyProgram) gl.deleteProgram(copyProgram);
      copyProgram = null;
      gl.deleteFramebuffer(fbo);
      width = 0;
      height = 0;
      srcWidth = 0;
      srcHeight = 0;
      count = 0;
    },
  };
}
