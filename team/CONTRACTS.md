# Parallel work: ownership and frozen APIs

Three people work at the same time on separate branches. Merge conflicts are avoided by one rule:
**every file has exactly one owner, and you only edit files you own.**

## File ownership

| Owner | Branch | Milestones | Owns (may create/edit anything inside) |
|---|---|---|---|
| **A: Render** | `a-render` | 2, 4, 5 | `src/render/**`, `src/buffer/**` |
| **B: Detector** | `b-detector` | 3 (+ detector side of 7) | `src/detector/**`, `public/test/**` |
| **C: UI + Audio** | `c-ui-audio` | 6, 7, 8 | `src/ui/**`, `src/audio/**`, `src/capture/**` |

**Frozen, nobody edits during the parallel phase:** `src/types.ts`, `src/main.tsx`, `CLAUDE.md`,
`.cursor/**`, `team/**`, `README.md`, `package.json`, `package-lock.json`, `tsconfig.json`,
`vite.config.ts`, `vercel.json`, `index.html`.

- No new npm dependencies. Install with `npm ci` (never `npm install`, which can rewrite the lockfile).
- Progress notes go in your own folder's `README.md` (`src/render/README.md`, `src/detector/README.md`,
  `src/audio/README.md`), not in `CLAUDE.md`.
- Need a change to a frozen file or someone else's API? Post it in the group chat. The file's owner
  (or the whole team, for frozen files) makes the change in a separate small PR.

Before every commit, check that you only touched your own paths:

```bash
git diff --name-only main...HEAD; git status --short
```

## Frozen APIs (signatures must not change)

The scaffold commit already contains working stubs with these exact signatures, and
`src/ui/usePipeline.ts` already calls them. Replace the stub bodies; keep the signatures.

```ts
// src/render/renderer.ts (A)
export function createRenderer(canvas: HTMLCanvasElement): Renderer;
type Renderer = {
  pushFrame(video: HTMLVideoElement): void;                     // newest frame → ring buffer
  draw(mask: readonly number[], settings: FilterSettings): void; // oldest frame → canvas, filtered
  readonly delayFrames: number;                                 // BUFFER_FRAMES - 1 = 14
  dispose(): void;
};

// src/detector/detector.ts (B)
export function createDetector(onReport: (r: RiskReport) => void): Detector;
type Detector = {
  analyze(source: CanvasImageSource): void; // works for the <video> AND the WebGL output canvas
  dispose(): void;
};

// src/audio/audio.ts (C)
export function createAudioChain(stream: MediaStream): AudioChain | null;
```

## Frame loop (`src/ui/usePipeline.ts`, owned by C)

Once per new source frame (`requestVideoFrameCallback`):

1. `renderer.pushFrame(video)`
2. `inputDetector.analyze(video)` → its latest `cellMask` is kept as `mask`
3. `renderer.draw(mask, settings)`
4. `outputDetector.analyze(outputCanvas)` → proof graph

## Shared conventions (also in `src/types.ts`)

- `cellMask`: 48 values, row-major, **row 0 = top of frame**, `index = row * 8 + col`.
  The detector already eases it over time; the renderer uses it as-is (it may blur it spatially).
- `flashesPerSec`: the flash rate reached by ≥ 25% of cells (12th-highest per-cell rate). The graph line at 3 = WCAG threshold.
- `FilterSettings.brightness` and `.saturation`: multipliers, 1 = unchanged (brightness 0.3–1, saturation 0–1).
- `maxProtection: true` means the renderer applies strong damping everywhere regardless of the mask.

## Merge order

1. Scaffold commit lands on `main` first; everyone branches from it.
2. B merges `public/test/flash.html` as early as possible (small PR) so A and C can test against it.
3. Then merge in any order. Since paths are disjoint, PRs merge cleanly; run `npm run build` on `main` after each merge.
