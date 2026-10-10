You are working on StrobeGuard. Read `CLAUDE.md` (or the Cursor rule) and `team/CONTRACTS.md` first. They are the spec. Three teammates are working in parallel on separate branches, so file ownership is strict.

## My role: Person A, Render + Buffer (branch `a-render`)

**Milestones:** 2 (WebGL passthrough + 15-frame ring buffer), 4 (shader damping driven by `cellMask`, red desaturation, contrast reduction), 5 (centered temporal smoothing using past AND future buffered frames).

**I may only create or edit files in:** `src/render/**` and `src/buffer/**`.
Do NOT edit anything else: not `src/types.ts`, `src/ui/**` (including `usePipeline.ts` and `Viewer.tsx`), `src/detector/**`, `CLAUDE.md`, `.cursor/**`, `package.json`, `tsconfig.json`, or any config. If you think another file needs to change, stop and tell me what change to request from its owner. Do not add npm dependencies (no regl). Use raw WebGL2.

## The API I implement (signatures are frozen)

`src/render/renderer.ts` already exists as a stub that `src/ui/usePipeline.ts` calls. Replace the stub body; keep this exact API:

```ts
export function createRenderer(canvas: HTMLCanvasElement): Renderer;
type Renderer = {
  pushFrame(video: HTMLVideoElement): void;                      // called once per new source frame
  draw(mask: readonly number[], settings: FilterSettings): void;  // called right after pushFrame
  readonly delayFrames: number;                                  // keep = BUFFER_FRAMES - 1
  dispose(): void;                                               // free textures, programs, buffers
};
```

The frame loop (already written, not mine): `pushFrame(video)` → detector analyzes the newest frame → `draw(latestMask, settings)` → a second detector reads my output canvas via `drawImage`. Keep `preserveDrawingBuffer: true` on the context so that read-back works.

## Requirements

- Ring buffer of `BUFFER_FRAMES` (15) textures in `src/buffer/`. Upload with `texImage2D`/`texSubImage2D` from the video. Reuse textures; never allocate per frame. Until the buffer is full, display the oldest frame available.
- `draw` displays the **oldest** buffered frame (the 14-frame delay is the look-ahead).
- Mask: upload the 48 values as an 8×6 single-channel texture with LINEAR filtering so damping fades smoothly across cell edges. Row 0 = **top** of the frame; watch out for WebGL's flipped Y.
- Damping (milestone 4), per pixel, scaled by the mask value m (0–1):
  - temporal low-pass on **luminance only**; keep chroma/detail from the displayed frame to limit ghosting,
  - reduce contrast toward mid-grey in proportion to m,
  - desaturate saturated reds (R/(R+G+B) ≥ 0.8) in proportion to m.
  - Where m = 0, the output must equal the input exactly.
- Centered smoothing (milestone 5): the displayed frame has 14 *newer* frames in the buffer, so average luminance over a window centered on it (e.g. ±4 frames, weighted). Bind several buffer textures to texture units and pass ring indices as uniforms.
- `settings.brightness` and `settings.saturation` are global multipliers (1 = unchanged). `settings.maxProtection` = treat every cell as at least ~0.8 damping.
- Comment the shader math briefly (what is blended, why luminance only).
- Safety: the output canvas must never show anything brighter or flashier than the source. Never draw raw frames anywhere else at large size.

## Testing without the detector

The real detector is being built in parallel, and until it merges you'll get all-zero masks. Add a dev-only override **inside `renderer.ts`** read from the URL: `?debugMask=all` (all 1), `?debugMask=top` (top row only), `?debugMask=checker`. That lets you verify orientation and damping strength without touching anyone else's files. Once B merges `public/test/flash.html` to `main`, merge `main` into your branch and share that tab as a flashing test source.

## Workflow

- Work on branch `a-render`. Before writing code, give me a 3–5 line plan. Do one milestone at a time, then tell me exactly how to test it in Chrome and what I should see.
- Run `npm run build` before every commit. Before committing, run `git status --short` and confirm every changed path starts with `src/render/` or `src/buffer/`.
- Write progress and status notes in `src/render/README.md` and `src/buffer/README.md`, never in `CLAUDE.md`.

Start with milestone 2.
