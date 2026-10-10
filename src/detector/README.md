Milestone 3: pure detection functions (no DOM, testable with plain arrays) + Web Worker that emits `RiskReport`s.

## Status

- Done: test page `public/test/flash.html`, pure detector, unit tests, worker, real `createDetector`.
- The same `createDetector` works on the raw `<video>` and on the WebGL output canvas (milestone 7 detector side).
  Reading the output canvas relies on the renderer's `preserveDrawingBuffer: true` (or `analyze` being called
  in the same task as `draw`, which `usePipeline` already does).

## Files

| File | What |
|---|---|
| `luminance.ts` | sRGB → linear, relative luminance, saturated-red test, 8×6 cell averages |
| `flashCounter.ts` | Per-cell turning-point transition tracker + 1 s sliding window |
| `risk.ts` | Area rate (12th-highest cell), `flashRisk`/`redRisk`, per-cell target, mask easing |
| `detectorCore.ts` | `processFrame(state, rgba, w, h, timeMs, frameIndex) → RiskReport` (pure) |
| `detector.worker.ts` | One `DetectorState` per worker |
| `detector.ts` | Main thread: 64×36 `OffscreenCanvas` downscale, one frame in flight, transfer buffer |
| `node-test.d.ts` | Minimal types for `node:test`/`node:assert` so `tsc` passes without `@types/node` |

## Behaviour (numbers to know)

- Transition: luminance change ≥ 0.1 from the last peak/trough, darker side < 0.8. Two transitions = one flash.
- Red: per-cell fraction of saturated-red pixels (R/(R+G+B) ≥ 0.8 on **linear** channels, linear R ≥ 0.1);
  a transition is a ≥ 0.25 change in that fraction.
- `flashesPerSec` = 12th-highest per-cell flash count in the last 1000 ms (integer). Dangerous when > 3.
- `flashRisk` = clamp((rate − 1) / 3): 0 at ≤ 1, 1 at ≥ 4. `redRisk` = clamp((redRate − 1) / 2).
- `cellMask` target per cell uses **that cell's own rate**: 0 at ≤ 2 flashes/s, 1 at ≥ 3 (red: 1 at ≥ 2 red flashes/s).
  So a small flashing corner is damped locally even though the frame is not "dangerous" overall.
- Easing: attack τ = 60 ms (~90% in 4 frames), release τ = 600 ms, dt capped at 100 ms, < 0.01 snaps to 0.
- Timing: full damping is reached ~0.5–0.6 s after a 5 Hz flash starts; the 14-frame (~0.47 s) look-ahead
  covers most of that, so roughly the first flash may still be shown before damping. Milestone 5 smoothing helps.

## Tests

```bash
node --test 'src/detector/**/*.test.ts'
```

Covers: steady, 5 Hz (also at 15 fps), 2 Hz, single camera flash, slow fade, < 25% area, the 11/12-cell
boundary, red flash, darker ≥ 0.8, sub-0.1 changes, mask easing in/out.

## Known risks / notes for the team

- `willReadFrequently` puts the 64×36 canvas on the CPU, so each `drawImage` reads the full source frame
  back from the GPU. Two detectors at 30 fps should be fine; if it's slow on a weak laptop, tell me.
