// OWNER: Person A. Ping-pong pair of single-channel textures holding the low-passed luminance
// of the displayed frame (see HISTORY_FRAG). Each frame reads one and renders into the other.

export type LumaHistory = {
  /** Reallocate for a new size if needed. Returns true if the history was reset. */
  resize(w: number, h: number): boolean;
  /** Texture holding the previous frame's history. */
  readonly read: WebGLTexture | null;
  /** Framebuffer to render this frame's history into. */
  readonly writeFbo: WebGLFramebuffer | null;
  /** Texture written by writeFbo (valid after rendering pass 1). */
  readonly written: WebGLTexture | null;
  swap(): void;
  dispose(): void;
};

export function createLumaHistory(gl: WebGL2RenderingContext): LumaHistory {
  // Half-float keeps the slow low-pass from stalling on 8-bit rounding. Needs this extension to
  // be renderable; Chrome desktop has it. Fall back to R8 if not.
  const hasFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  const internalFormat = hasFloat ? gl.R16F : gl.R8;

  let textures: WebGLTexture[] = [];
  let fbos: WebGLFramebuffer[] = [];
  let width = 0;
  let height = 0;
  let readIndex = 0;

  function free() {
    textures.forEach((t) => gl.deleteTexture(t));
    fbos.forEach((f) => gl.deleteFramebuffer(f));
    textures = [];
    fbos = [];
  }

  return {
    resize(w, h) {
      if (w === width && h === height && textures.length === 2) return false;
      free();
      for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        const fbo = gl.createFramebuffer();
        if (!tex || !fbo) throw new Error('Could not create history buffers.');
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        textures.push(tex);
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
