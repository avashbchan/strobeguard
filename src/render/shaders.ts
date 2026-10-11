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

// Most a dark region is brightened by scaling (bright pixels get less: headroom). The gain is stored in the
// field divided by this, so it fits in 0..1 even if the GPU falls back to 8-bit render targets.
const float GAIN_MAX = 4.0;

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

// Pass 1 → history FIELD. A small texture (FIELD_COLS × FIELD_ROWS texels, see renderer.ts), not a
// full-size one: each texel holds the temporal low-pass of the mean colour of the screen region it
// covers. Smoothing a coarse field instead of every pixel is what keeps moving detail from trailing:
// the correction applied in pass 2 is a smooth gain and fill, and all pixel detail comes from the
// current frame.
//   target 0 rgb = low-passed colour of the region (cube root of linear light, the lightness scale of
//                  OKLab: a rare flash barely moves the average, so dark scenes stay dark instead of
//                  getting a veil)
//   target 1 r   = the gain that brings the region's current mean luminance to the smoothed one (÷ GAIN_MAX)
//            g   = the share of the smoothed luminance a gain alone cannot deliver (filled in pass 2)
//   Both are worked out here, where the frame's pixels are being averaged anyway, so the fill covers
//   exactly the light the gain fails to deliver, including pixels too bright to be scaled up.
// Temporal filter, per region:
//   future side: weighted average of the displayed frame and the next 4 buffered (newer) frames,
//                weights 5,4,3,2,1; a flash starts pulling the average before it is on screen
//   past side:   recursive (IIR) blend with the previous field
//   Cc   = mix(C_0, futureAvg, m)
//   hist = mix(Cc, hist_prev, k * m)
// With m = 0 the field is exactly the current frame's, so the gain is 1 and nothing changes.
export const HISTORY_FRAG = `#version 300 es
${COMMON}
uniform sampler2D uHistory;  // previous field (rgb = cube root of linear colour)
uniform float uHistoryValid; // 0 on the first frame / after a resize
uniform sampler2D uFuture1;  // buffered frames 1..4 newer than the displayed one
uniform sampler2D uFuture2;
uniform sampler2D uFuture3;
uniform sampler2D uFuture4;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outGain;

const float K_TEMPORAL = 0.82;
const int TAPS = 16; // TAPS × TAPS bilinear taps cover one field texel's footprint

// Mean LINEAR colour of a frame over the screen region this field texel covers.
vec3 regionMean(sampler2D tex) {
  vec2 footprint = 1.0 / vec2(textureSize(uHistory, 0)); // uv size of one field texel
  vec3 sum = vec3(0.0);
  for (int j = 0; j < TAPS; j++) {
    for (int i = 0; i < TAPS; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / float(TAPS) - 0.5;
      sum += toLinear(texture(tex, vUv + o * footprint).rgb);
    }
  }
  return sum / float(TAPS * TAPS);
}

// Mean luminance the region would have after scaling every pixel by min(gain, headroom), where headroom
// stops a pixel from being scaled past full brightness.
float achievedLuminance(sampler2D tex, float gain) {
  vec2 footprint = 1.0 / vec2(textureSize(uHistory, 0));
  float sum = 0.0;
  for (int j = 0; j < TAPS; j++) {
    for (int i = 0; i < TAPS; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / float(TAPS) - 0.5;
      vec3 lin = toLinear(texture(tex, vUv + o * footprint).rgb);
      float headroom = 1.0 / max(max(lin.r, max(lin.g, lin.b)), 1e-3);
      sum += luminance(lin) * min(gain, headroom);
    }
  }
  return sum / float(TAPS * TAPS);
}

vec3 cubeRoot(vec3 x) {
  return pow(max(x, vec3(0.0)), vec3(1.0 / 3.0));
}

void main() {
  float m = maskAt(vUv);
  vec3 l0 = regionMean(uFrame);
  vec3 c0 = cubeRoot(l0);
  vec3 futureAvg = (5.0 * c0 + 4.0 * cubeRoot(regionMean(uFuture1)) + 3.0 * cubeRoot(regionMean(uFuture2))
                  + 2.0 * cubeRoot(regionMean(uFuture3)) + 1.0 * cubeRoot(regionMean(uFuture4))) / 15.0;
  vec3 cc = mix(c0, futureAvg, m);
  vec3 cPrev = texture(uHistory, vUv).rgb;
  float a = K_TEMPORAL * m * uHistoryValid;
  vec3 hist = mix(cc, cPrev, a);
  outColor = vec4(hist, 1.0);

  // Gain and fill share for this region. With m = 0 the field is the frame's own colour: gain 1, no fill.
  vec3 avg = hist * hist * hist;
  float smoothY = luminance(avg);
  float currentY = max(luminance(l0), 1e-4);
  float gain = min(smoothY / currentY, GAIN_MAX);
  float achieved = achievedLuminance(uFrame, gain);
  float fillShare = max(smoothY - achieved, 0.0) / max(smoothY, 1e-5);
  outGain = vec4(gain / GAIN_MAX, fillShare, 0.0, 1.0);
}
`;

// Pass 2 → canvas. Multiplies each pixel by a smooth gain that brings its region's brightness to the
// smoothed level, and adds a smooth fill (the region's smoothed colour) for the light a capped gain
// can't supply (dark frames between flashes). Pixel detail, hue and edges are the current frame's, only
// scaled, so there is nothing to trail. Saturated-red regions also take the smoothed hue (at the pixel's
// own brightness) so red / other-colour flicker settles instead of flashing.
export const FILTER_FRAG = `#version 300 es
${COMMON}
uniform sampler2D uHistory;  // the field's smoothed colour from pass 1 (LINEAR filtered: varies smoothly)
uniform sampler2D uGain;     // its second target: r = gain, g = share of the smoothed light to fill in
uniform float uBrightness;   // multiplier, 1 = unchanged
uniform float uSaturation;   // multiplier, 1 = unchanged
out vec4 outColor;

const float RED_RATIO = 0.8; // saturated red: R/(R+G+B) >= 0.8 (same as detector)

float redness(vec3 c) {
  return smoothstep(RED_RATIO - 0.1, RED_RATIO, c.r / max(c.r + c.g + c.b, 1e-4));
}

void main() {
  vec3 src = texture(uFrame, vUv).rgb;
  float m = maskAt(vUv);
  vec3 rgb = src; // m = 0 → exactly the source texel

  if (m > 0.0) {
    vec3 field = texture(uHistory, vUv).rgb;
    vec3 avg = field * field * field;             // smoothed colour of this region, linear
    float smoothY = luminance(avg);
    vec2 correction = texture(uGain, vUv).rg;     // gain / GAIN_MAX, share of the smoothed light still to fill
    vec3 lin = toLinear(src);

    // A pixel is never scaled past full brightness: bright content that stays bright while the rest
    // of the region flashes would clip, losing exactly the light the gain was meant to move. Pass 1
    // measured what that costs the region and set the fill to make it up.
    float headroom = 1.0 / max(max(lin.r, max(lin.g, lin.b)), 1e-3);
    lin = lin * min(correction.x * GAIN_MAX, headroom) + avg * correction.y;

    // Red (or red-to-other) colour flicker: take the smoothed hue, keep the pixel's own brightness.
    float w = m * max(redness(lin), redness(avg));
    lin = mix(lin, (avg / max(smoothY, 1e-5)) * luminance(lin), w);

    rgb = toSrgb(clamp(lin, 0.0, 1.0));
  }

  // Global user settings. With both at 1 these are exact no-ops.
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, uSaturation);
  rgb *= uBrightness;

  outColor = vec4(rgb, 1.0);
}
`;
