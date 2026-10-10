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
- [ ] Milestone 5: centered temporal smoothing over past + future buffered frames.

## Files
- `renderer.ts` — frozen API (`createRenderer`), wires ring buffer + shader.
- `shaders.ts` — GLSL. Fullscreen triangle from `gl_VertexID`; `vUv.y = 0` is the TOP of the screen.
- `gl.ts` — compile/link helpers.
- `history.ts` — ping-pong low-passed luminance textures.
- `debugMask.ts` — dev-only `?debugMask=` override.
