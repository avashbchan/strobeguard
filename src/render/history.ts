// OWNER: Person A. Ping-pong pair of small RGBA textures (the "field": one texel per screen region, see
// FIELD_COLS / FIELD_ROWS in renderer.ts). Two render targets per slot (see HISTORY_FRAG): the low-passed
// colour of each region, and the correction to apply to it (gain, fill share). Each frame reads one slot and
// renders into the other. LINEAR filtered, so the correction pass 2 derives varies smoothly across the screen.

export type LumaHistory = {
  /** Reallocate for a new size if needed. Returns true if the history was reset. */
  resize(w: number, h: number): boolean;
  /** Texture holding the previous frame's history. */
  readonly read: WebGLTexture | null;
  /** Framebuffer to render this frame's history into. */
  readonly writeFbo: WebGLFramebuffer | null;
  /** Texture written by writeFbo (valid after rendering pass 1). */
  readonly written: WebGLTexture | null;
  /** Second render target of writeFbo: the per-region gain and fill share (valid after pass 1). */
  readonly writtenGain: WebGLTexture | null;
  swap(): void;
  dispose(): void;
};

export function createLumaHistory(gl: WebGL2RenderingContext): LumaHistory {
  // Half-float keeps the slow low-pass from stalling on 8-bit rounding. Needs this extension to
  // be renderable; Chrome desktop has it. Fall back to RGBA8 if not.
  const hasFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  const internalFormat = hasFloat ? gl.RGBA16F : gl.RGBA8;

  let textures: WebGLTexture[] = [];
  let gainTextures: WebGLTexture[] = [];
  let fbos: WebGLFramebuffer[] = [];
  let width = 0;
  let height = 0;
  let readIndex = 0;

  function free() {
    textures.forEach((t) => gl.deleteTexture(t));
    gainTextures.forEach((t) => gl.deleteTexture(t));
    fbos.forEach((f) => gl.deleteFramebuffer(f));
    textures = [];
    gainTextures = [];
    fbos = [];
  }

  return {
    resize(w, h) {
      if (w === width && h === height && textures.length === 2) return false;
      free();
      const makeTexture = () => {
        const tex = gl.createTexture();
        if (!tex) throw new Error('Could not create history buffers.');
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
      };
      for (let i = 0; i < 2; i++) {
        const tex = makeTexture();
        const gain = makeTexture();
        const fbo = gl.createFramebuffer();
        if (!fbo) throw new Error('Could not create history buffers.');
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gain, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        textures.push(tex);
        gainTextures.push(gain);
        fbos.push(fbo);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      width = w;
      height = h;
      readIndex = 0;
      return true;
    },
    get read() {
      return textures[readIndex] ?? null;
    },
    get writeFbo() {
      return fbos[1 - readIndex] ?? null;
    },
    get written() {
      return textures[1 - readIndex] ?? null;
    },
    get writtenGain() {
      return gainTextures[1 - readIndex] ?? null;
    },
    swap() {
      readIndex = 1 - readIndex;
    },
    dispose() {
      free();
      width = 0;
      height = 0;
    },
  };
}
