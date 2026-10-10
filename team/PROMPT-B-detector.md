You are working on StrobeGuard. Read `CLAUDE.md` (or the Cursor rule) and `team/CONTRACTS.md` first. They are the spec. Three teammates are working in parallel on separate branches, so file ownership is strict.

## My role: Person B, Detector (branch `b-detector`)

**Milestones:** 3 (pure detection functions + Web Worker producing `RiskReport`s), plus the detector side of 7 (the same detector must also work on the filtered output canvas). I also build a flashing test page the whole team uses.

**I may only create or edit files in:** `src/detector/**` and `public/test/**`.
Do NOT edit anything else: not `src/types.ts`, `src/ui/**` (including `usePipeline.ts`), `src/render/**`, `CLAUDE.md`, `.cursor/**`, `package.json`, `tsconfig.json`, or any config. If you think another file needs to change, stop and tell me what change to request from its owner. Do not add npm dependencies (no vitest/jest).

## The API I implement (signatures are frozen)

`src/detector/detector.ts` already exists as a stub that `src/ui/usePipeline.ts` calls twice (one instance for the raw video, one for the output canvas). Replace the stub body; keep this exact API:

```ts
export function createDetector(onReport: (r: RiskReport) => void): Detector;
type Detector = {
  analyze(source: CanvasImageSource): void; // a <video> OR a WebGL <canvas>
  dispose(): void;                          // terminate the worker
};
```

`RiskReport` is in `src/types.ts` (frozen). Conventions you must follow:
- `cellMask`: 48 values, row-major, **row 0 = top**, `index = row * GRID_COLS + col`. It is the final damping value per cell, already **eased over several frames** (fast-ish attack, slower release) so the filter never flickers. The renderer uses it as-is.
- `flashesPerSec`: the flash rate reached by ≥ 25% of cells, i.e. the 12th-highest per-cell rate. The UI draws a line at 3.
- `flashRisk`, `redRisk`: 0–1.

## Structure

- Pure functions, no DOM, no `self`, no `window`, in their own files (e.g. `luminance.ts`, `flashCounter.ts`, `risk.ts`). Follow the pipeline in `CLAUDE.md` step 3 exactly: sRGB linearisation, 8×6 cells, transitions ≥ 0.1 from last turning point with darker state < 0.8, two opposing transitions = one flash, 1-second sliding window, ≥ 25% area over 3 flashes/s, saturated red R/(R+G+B) ≥ 0.8 tracked separately. Isolated single flashes and slow fades must NOT trigger. Comment the math briefly.
- Worker in `src/detector/detector.worker.ts`, created with `new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' })`. Each `createDetector` call gets its own worker and its own state.
- Downscale on the main thread inside `detector.ts`: draw the source to a 64×36 `OffscreenCanvas` (`willReadFrequently: true`), `getImageData`, transfer the buffer. Keep at most one frame in flight; drop frames while the worker is busy.
- Timestamps: use `performance.now()` for the 1-second window, not frame counts (frame rate varies).
- Type-strip-friendly TypeScript: import local files with the `.ts` extension (e.g. `import { GRID_COLS } from '../types.ts'`), no enums/namespaces/parameter properties.

## Tests (no dependencies needed)

Write `*.test.ts` files in `src/detector/` using `node:test` and `node:assert/strict`, run with:
`node --test 'src/detector/**/*.test.ts'` (Node ≥ 22.18). Feed synthetic luminance or RGBA arrays. Cover: steady frame → 0; 5 Hz full-frame flash → dangerous; single camera flash → not dangerous; slow fade → not dangerous; flash in < 25% of the area → not dangerous overall; saturated red flash → `redRisk` > 0; mask eases rather than jumping.

## Test page (do this first, merge early)

Create `public/test/flash.html` (plain HTML + JS, no build, served at `/test/flash.html`). It has buttons for: steady, 5 Hz full-screen flash, 2 Hz flash (should pass), single flash every 3 s, slow fade, 5 Hz red flash, 5 Hz flash in a small corner box. Show a clear photosensitivity warning first and default to a small window size. Merge this to `main` in its own small PR as soon as it works so A and C can use it.

## Workflow

- Work on branch `b-detector`. Before writing code, give me a 3–5 line plan. Do one step at a time, then tell me exactly how to test it (unit tests + in Chrome: share the test page and watch the "Input … flashes/s" readout under the output) and what I should see.
- Run `npm run build` and the tests before every commit. Before committing, run `git status --short` and confirm every changed path starts with `src/detector/` or `public/test/`.
- Write progress and status notes in `src/detector/README.md`, never in `CLAUDE.md`.

Start with the test page, then the pure functions and tests, then the worker.
