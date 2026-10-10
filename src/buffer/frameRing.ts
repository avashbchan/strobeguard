// OWNER: Person A. Ring buffer of the last BUFFER_FRAMES video frames as WebGL2 textures.
// The newest frame is analyzed by the detector; the OLDEST is displayed, which gives the
// renderer a look-ahead of (BUFFER_FRAMES - 1) frames.
//
// Textures are allocated once per source resolution (texStorage2D) and reused; each new
// frame is a texSubImage2D into the next slot. Nothing is allocated per frame.

export type FrameRing = {
  /** Upload a new frame into the next slot. Reallocates only if the video size changed. */
  push(video: HTMLVideoElement): void;
  /** Number of frames currently held (0..capacity). */
  readonly count: number;
  readonly capacity: number;
  readonly width: number;
  readonly height: number;
  /**
   * Texture `k` frames newer than the oldest held frame (k = 0 is the oldest/displayed one).
   * k is clamped to the frames available, so early on this returns the newest frame instead.
   */
  textureFromOldest(k: number): WebGLTexture | null;
  dispose(): void;
};

export function createFrameRing(gl: WebGL2RenderingContext, capacity: number): FrameRing {
  let textures: WebGLTexture[] = [];
  let width = 0;
  let height = 0;
  let writeIndex = 0; // slot the NEXT push writes into
  let count = 0;

  function freeTextures() {
    textures.forEach((t) => gl.deleteTexture(t));
    textures = [];
  }

  function allocate(w: number, h: number) {
    freeTextures();
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
    // Old frames were a different size; start the buffer over.
    writeIndex = 0;
    count = 0;
  }

  return {
    push(video) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) return;
      if (w !== width || h !== height) allocate(w, h);

      const tex = textures[writeIndex];
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // No UNPACK_FLIP_Y: the video's top row lands at texture v = 0. The vertex shader maps
      // v = 0 to the top of the screen, so the image (and the mask) stay upright.
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, video);

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
    dispose() {
      freeTextures();
      width = 0;
      height = 0;
      count = 0;
    },
  };
}
