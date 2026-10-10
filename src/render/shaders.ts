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

const float CONTRAST_CUT = 0.4; // at m = 1, attenuate linear light by 40%
const float RED_RATIO = 0.8;    // saturated red: R/(R+G+B) >= 0.8 (same as detector)
const float RED_TARGET_RATIO = 0.65; // retain red hue below the saturated-red boundary

void main() {
  vec3 src = texture(uFrame, vUv).rgb;
  float m = maskAt(vUv);
  vec3 rgb = src; // m = 0 → exactly the source texel

  if (m > 0.0) {
    // Use the smoothed luminance as a ceiling: dim bright excursions without carrying
    // a previous flash into dark pixels. Scaling current-frame linear RGB preserves its
    // channel proportions and avoids the grey veil produced by an additive RGB offset.
    vec3 lin = toLinear(src);
    float target = texture(uHistory, vUv).r;
    float sourceLuma = luminance(lin);
    float gain = clamp(target / max(sourceLuma, 1e-5), 0.0, 1.0);
    lin *= gain;
    rgb = toSrgb(lin);

    // Compress excessive red saturation instead of erasing all chroma. Ramp in below the
    // threshold and ignore near-black pixels, retaining the existing gradual risk response.
    float sum = rgb.r + rgb.g + rgb.b;
    float redness = rgb.r / max(sum, 1e-4);
    float redW = smoothstep(RED_RATIO - 0.1, RED_RATIO, redness) * smoothstep(0.05, 0.2, sum);
    float grey = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    // For c = mix(grey, rgb, s), solve c.r / sum(c) = RED_TARGET_RATIO for s.
    // This keeps the largest chroma compatible with the target ratio at full damping.
    float numerator = grey * (3.0 * RED_TARGET_RATIO - 1.0);
    float excessRed = max(0.0, rgb.r - RED_TARGET_RATIO * sum);
    float retainedChroma = clamp(numerator / max(numerator + excessRed, 1e-4), 0.0, 1.0);
    rgb = mix(rgb, vec3(grey), (1.0 - retainedChroma) * redW * m);

    // Attenuate light without lifting dark stage areas toward grey. Scaling linear RGB
    // retains channel proportions while reducing absolute luminance excursions.
    rgb = toSrgb(toLinear(rgb) * (1.0 - CONTRAST_CUT * m));
  }

  // Global user settings. With both at 1 these are exact no-ops.
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, uSaturation);
  rgb *= uBrightness;

  outColor = vec4(rgb, 1.0);
}
`;
