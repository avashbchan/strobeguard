// OWNER: Person A. GLSL ES 3.00 shaders.

// One oversized triangle covers the whole viewport; no vertex buffer needed (uses gl_VertexID).
// Texture convention everywhere: v = 0 is the TOP of the image (frames are uploaded top row
// first with no UNPACK_FLIP_Y, and mask row 0 = top).
//
// FULLSCREEN_VERT is for drawing to the CANVAS: the screen's top is clip y = +1, so uv.y is
// flipped to keep v = 0 at the top of the screen.
export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

// TEXTURE_VERT is for drawing INTO a texture (framebuffer): there clip y = -1 writes texel
// row 0 (v = 0), so uv must NOT be flipped. Otherwise the target is stored upside down and
// later reads at the same uv fetch the vertically mirrored pixel.
export const TEXTURE_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

// Shared helpers: sRGB <-> linear and relative luminance (same formula as the detector).
const COMMON = `
precision highp float;
in vec2 vUv;
uniform sampler2D uFrame;    // displayed (oldest buffered) frame, sRGB
uniform sampler2D uMask;     // 8x6 damping mask, LINEAR filtered so damping fades across cell edges
uniform float uMinMask;      // maxProtection floor (0 = off)

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float luminance(vec3 lin) {
  return dot(lin, vec3(0.2126, 0.7152, 0.0722));
}
float maskAt(vec2 uv) {
  return max(texture(uMask, uv).r, uMinMask);
}
`;

// Pass 1 → history texture. Centered temporal low-pass of the pixel's COLOUR (milestones 4–5):
//   future side: weighted average of the displayed frame and the next 4 buffered (newer) frames,
//                weights 5,4,3,2,1 — a flash starts pulling the average before it is on screen;
//   past side:   recursive (IIR) blend with the previous output, hist_prev.
//   Cc   = mix(C_0, futureAvg, m)
//   hist = mix(Cc, hist_prev, k * m)
// Averaged in cube-root space (the lightness scale of OKLab), not linear light or sRGB: a rare
// flash barely moves the average, so a dark scene stays dark instead of turning into a grey veil,
// while an even black/white flash settles at the perceived middle.
// Keeping colour (not just luminance) lets pass 2 fill dark frames with the pixel's own average
// colour instead of grey. With m = 0 this is exactly C_0.
export const HISTORY_FRAG = `#version 300 es
${COMMON}
uniform sampler2D uHistory;  // previous low-passed colour (rgb, cube-root of linear)
uniform float uHistoryValid; // 0 on the first frame / after a resize
uniform sampler2D uFuture1;  // buffered frames 1..4 newer than the displayed one
uniform sampler2D uFuture2;
uniform sampler2D uFuture3;
uniform sampler2D uFuture4;
out vec4 outColor;

const float K_TEMPORAL = 0.82;

vec3 colourOf(sampler2D tex) {
  return pow(toLinear(texture(tex, vUv).rgb), vec3(1.0 / 3.0));
}

void main() {
  float m = maskAt(vUv);
  vec3 c0 = colourOf(uFrame);
  vec3 futureAvg = (5.0 * c0 + 4.0 * colourOf(uFuture1) + 3.0 * colourOf(uFuture2)
                  + 2.0 * colourOf(uFuture3) + 1.0 * colourOf(uFuture4)) / 15.0;
  vec3 cc = mix(c0, futureAvg, m);
  vec3 cPrev = texture(uHistory, vUv).rgb;
  float a = K_TEMPORAL * m * uHistoryValid;
  outColor = vec4(mix(cc, cPrev, a), 1.0);
}
`;

// Pass 2 → canvas. Brings each damped pixel to the smoothed brightness while keeping its colour,
// and steadies colour flicker (incl. red) toward the pixel's smoothed colour.
export const FILTER_FRAG = `#version 300 es
${COMMON}
uniform sampler2D uHistory;  // low-passed colour for THIS frame, cube-root of linear (pass 1)
uniform float uBrightness;   // multiplier, 1 = unchanged
uniform float uSaturation;   // multiplier, 1 = unchanged
out vec4 outColor;

const float CONTRAST_CUT = 0.0; // at m = 1, pull 40% of the way to mid-grey
const float RED_RATIO = 0.8;    // saturated red: R/(R+G+B) >= 0.8 (same as detector)
const float GAIN_MAX = 8.0;     // most a dark pixel is brightened by scaling (limits noise)
const float CHROMA_SMOOTH = 0.0; // how far a damped pixel's colour eases toward its smoothed colour

void main() {
  vec3 src = texture(uFrame, vUv).rgb;
  float m = maskAt(vUv);
  vec3 rgb = src; // m = 0 → exactly the source texel

  if (m > 0.0) {
    // Temporal low-pass without grey: scale the current pixel to the smoothed luminance (keeps its
    // hue, saturation and edges). Whatever a capped gain can't reach (near-black frames between
    // flashes) is filled with the pixel's own smoothed colour, not neutral grey.
    vec3 lin = toLinear(src);
    vec3 h = texture(uHistory, vUv).rgb;
    vec3 avg = h * h * h; // back to linear
    float y = luminance(lin);
    float target = luminance(avg);
    float gain = min(target / max(y, 1e-5), GAIN_MAX);
    vec3 scaled = lin * gain;
    float missing = max(target - y * gain, 0.0);
    lin = clamp(scaled + avg * (missing / max(target, 1e-5)), 0.0, 1.0);

    // Colour can flash too (e.g. red ↔ blue at the same brightness). Ease the colour toward the
    // pixel's smoothed colour (same luminance, so brightness stays steady): partly everywhere
    // damped, fully where saturated red is involved, so red goes steady instead of grey.
    float redCur = smoothstep(RED_RATIO - 0.1, RED_RATIO, lin.r / max(lin.r + lin.g + lin.b, 1e-4));
    float redAvg = smoothstep(RED_RATIO - 0.1, RED_RATIO, avg.r / max(avg.r + avg.g + avg.b, 1e-4));
    float settle = m * mix(CHROMA_SMOOTH, 1.0, max(redCur, redAvg));
    lin = mix(lin, avg, settle);
    rgb = toSrgb(lin);

    // Contrast reduction toward mid-grey (perceptual space), proportional to risk.
    rgb = mix(rgb, vec3(0.5), CONTRAST_CUT * m);
  }

  // Global user settings. With both at 1 these are exact no-ops.
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, uSaturation);
  rgb *= uBrightness;

  outColor = vec4(rgb, 1.0);
}
`;
