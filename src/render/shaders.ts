// OWNER: Person A. GLSL ES 3.00 shaders.

// One oversized triangle covers the whole viewport; no vertex buffer needed (uses gl_VertexID).
// uv.y is flipped so v = 0 is the TOP of the screen: textures are uploaded top row first
// (no UNPACK_FLIP_Y), and mask row 0 = top, so both stay upright.
export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
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

// Pass 1 → history texture. Centered temporal low-pass on linear luminance (milestones 4–5):
//   future side: weighted average of the displayed frame and the next 4 buffered (newer) frames,
//                weights 5,4,3,2,1 — a flash starts pulling the average before it is on screen;
//   past side:   recursive (IIR) blend with the previous output, hist_prev.
//   Lc   = mix(L_0, futureAvg, m)
//   hist = mix(Lc, hist_prev, k * m)
// With m = 0 this is exactly L_0; with m = 1 a 5 Hz on/off flash collapses to a small ripple.
// The history holds the luminance actually shown, so the filter's own output is what gets smoothed.
export const HISTORY_FRAG = `#version 300 es
${COMMON}
uniform sampler2D uHistory;  // previous low-passed luminance (r channel)
uniform float uHistoryValid; // 0 on the first frame / after a resize
uniform sampler2D uFuture1;  // buffered frames 1..4 newer than the displayed one
uniform sampler2D uFuture2;
uniform sampler2D uFuture3;
uniform sampler2D uFuture4;
out vec4 outColor;

const float K_TEMPORAL = 0.9;

float lumaOf(sampler2D tex) {
  return luminance(toLinear(texture(tex, vUv).rgb));
}

void main() {
  float m = maskAt(vUv);
  float l0 = lumaOf(uFrame);
  float futureAvg = (5.0 * l0 + 4.0 * lumaOf(uFuture1) + 3.0 * lumaOf(uFuture2)
                   + 2.0 * lumaOf(uFuture3) + 1.0 * lumaOf(uFuture4)) / 15.0;
  float lc = mix(l0, futureAvg, m);
  float lPrev = texture(uHistory, vUv).r;
  float a = K_TEMPORAL * m * uHistoryValid;
  outColor = vec4(mix(lc, lPrev, a), 0.0, 0.0, 1.0);
}
`;

// Pass 2 → canvas. Uses the low-passed luminance from pass 1, then reduces contrast and red.
export const FILTER_FRAG = `#version 300 es
${COMMON}
uniform sampler2D uHistory;  // low-passed luminance for THIS frame (written by pass 1)
uniform float uBrightness;   // multiplier, 1 = unchanged
uniform float uSaturation;   // multiplier, 1 = unchanged
out vec4 outColor;

const float CONTRAST_CUT = 0.4; // at m = 1, pull 40% of the way to mid-grey
const float RED_RATIO = 0.8;    // saturated red: R/(R+G+B) >= 0.8 (same as detector)

void main() {
  vec3 src = texture(uFrame, vUv).rgb;
  float m = maskAt(vUv);
  vec3 rgb = src; // m = 0 → exactly the source texel

  if (m > 0.0) {
    // Temporal low-pass, luminance only: add the same linear offset to R, G and B so the
    // pixel's luminance becomes the smoothed value while its colour differences and edges
    // stay from the current frame (blending whole frames would ghost moving detail).
    vec3 lin = toLinear(src);
    float target = texture(uHistory, vUv).r;
    lin = clamp(lin + (target - luminance(lin)), 0.0, 1.0);
    rgb = toSrgb(lin);

    // Saturated-red desaturation. Ramp in just below the threshold so there is no hard edge,
    // and ignore near-black pixels where the ratio is noise.
    float sum = rgb.r + rgb.g + rgb.b;
    float redness = rgb.r / max(sum, 1e-4);
    float redW = smoothstep(RED_RATIO - 0.1, RED_RATIO, redness) * smoothstep(0.05, 0.2, sum);
    float grey = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = mix(rgb, vec3(grey), redW * m);

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
