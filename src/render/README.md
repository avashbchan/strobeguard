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

## Display timing (fixes after integration)
- The displayed frame is chosen by **capture time**: the frame whose age is closest to a **fixed 467 ms**
  (`delayFrames` at a nominal 30 fps), via `frameRing.indexForAge`. Playback never steps back to an older frame.
- Why fixed: always showing the oldest slot (a frame-count delay) replays frames faster than they were captured
  when ticks are uneven: a safe 2 Hz flash measured 3–4 flashes/s at the output. An adaptive delay (tracking the
  measured frame interval) fixed most of that, but a frame-loop stall then moved the delay ~66–108 ms at once, so
  playback jumped back over a white↔black edge and inserted a flash (seen in a traced production run).
- Offline, stall-heavy timing (6% of ticks stall 120–190 ms), 6 seeds, output max flashes/s:

  | | 2 Hz (safe) | 5 Hz (danger) | 5 Hz → 2 Hz |
  |---|---|---|---|
  | adaptive delay (#8) | 3.0 on 4/6 seeds | 0–2 | up to 3.0 |
  | fixed 467 ms | **2.0 on 6/6** | **1–2** | **2.0** |
- Real tab-capture E2E (`scripts/flash-e2e.mjs`, local build): 4/4 full runs pass (32/32 checks), at 18–21 fps.
- **Audio must use the same constant**: `delayFrames / 30` s (467 ms), not `delayFrames / measuredFps`.

## Robustness
- **History orientation fix:** passes that render into a texture use `TEXTURE_VERT` (no Y flip). Before, the history
  was stored upside down and damped pixels took brightness from the vertically mirrored spot (steady
  top-white/bottom-black at m = 1 gave top/bottom luminance 0.356/0.381; now 0.604/0.033).
- **Resolution cap:** see `src/buffer/README.md` (max 1920×1080 stored; output canvas follows).
- **WebGL context loss:** all GPU objects live in `createGpu()`. On `webglcontextlost` the renderer drops them
  (`preventDefault` so the browser restores the context) and `pushFrame`/`draw` become no-ops; on
  `webglcontextrestored` it rebuilds them and resets history. Tested with `WEBGL_lose_context` in headed
  (GPU) and headless Chrome: no throws while lost, correct damping and exact passthrough after restore.
