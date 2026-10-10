# Render (Person A)

Milestone 2/4/5: WebGL setup and shaders (passthrough → damping → centered smoothing).

## Status
- [x] Milestone 2: WebGL2 passthrough of the oldest buffered frame (14-frame delay). `preserveDrawingBuffer: true`
  so the output detector can read the canvas back. Canvas drawing buffer matches source resolution.
- [x] Milestone 4: mask-driven damping (two passes).
  - Pass 1 (`HISTORY_FRAG`): per-pixel IIR low-pass of linear luminance into a ping-pong R16F history
    texture (`history.ts`): `hist = mix(L_now, hist_prev, 0.93·m)`.
  - Pass 2 (`FILTER_FRAG`): adds the grey offset `(hist − L)` in linear RGB (luminance only, colour/detail from
    the current frame), desaturates saturated reds (R/(R+G+B) ≥ 0.8, soft ramp from 0.7), pulls contrast
    40% toward mid-grey at m = 1, then applies brightness/saturation multipliers.
  - Mask: 8×6 R8 texture, LINEAR filtered, row 0 = top. `maxProtection` → m ≥ 0.8.
  - m = 0 with neutral settings → output is the source texel, bit-exact.
  - Dev-only `?debugMask=all|top|checker` (`debugMask.ts`), ignored in production builds.
  - Headless check (SwiftShader, synthetic frames): m = 0 max diff 0; 5 Hz full-frame black/white at m = 1 →
    output luminance swing 0.055 (source 1.0, flash threshold 0.1); top-row mask damps only the top.
- [x] Milestone 5: centered temporal smoothing. Pass 1 now averages linear luminance over the displayed frame
  and the next 4 buffered (newer) frames, weights 5,4,3,2,1 (`uFuture1..4`, texture units 3–6), then blends with
  the recursive history: `Lc = mix(L0, futureAvg, m)`, `hist = mix(Lc, hist_prev, 0.9·m)`. m = 0 is still exact.
  Headless comparison (m = 1, luminance swing of the output; source swing 1.0):

  | | M4 (past only) | M5 (centered) |
  |---|---|---|
  | 5 Hz b/w flash | 0.060 | 0.025 |
  | 3 Hz b/w flash | 0.095 | 0.075 |
  | 5 Hz red flash | 0.063 | 0.057 |
  | hard cut: output starts moving before it is shown | 0 frames | 4 frames |
  | hard cut: frames to reach 90% (lag / ghosting) | 25 | 17 |

## Files
- `renderer.ts` — frozen API (`createRenderer`), wires ring buffer + shader.
- `shaders.ts` — GLSL. Fullscreen triangle from `gl_VertexID`; `vUv.y = 0` is the TOP of the screen.
- `gl.ts` — compile/link helpers.
- `history.ts` — ping-pong low-passed luminance textures.
- `debugMask.ts` — dev-only `?debugMask=` override.
