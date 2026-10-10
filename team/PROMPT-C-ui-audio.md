You are working on StrobeGuard. Read `CLAUDE.md` (or the Cursor rule) and `team/CONTRACTS.md` first. They are the spec. Three teammates are working in parallel on separate branches, so file ownership is strict.

## My role: Person C, UI + Audio + integration (branch `c-ui-audio`)

**Milestones:** 6 (audio chain with matching delay), 7 (dual live flash graphs + risk meters; the raw thumbnail already exists), 8 (polish: sliders, max-protection toggle, disclaimer placement, error handling for cancelled share, closed tab, no audio shared).

**I may only create or edit files in:** `src/ui/**`, `src/audio/**`, `src/capture/**`.
Do NOT edit anything else: not `src/types.ts`, `src/render/**`, `src/buffer/**`, `src/detector/**`, `src/main.tsx`, `index.html`, `CLAUDE.md`, `.cursor/**`, `package.json`, `tsconfig.json`, or any config. If you think another file needs to change, stop and tell me what change to request from its owner. Do not add npm dependencies (no chart libraries). Draw graphs with a plain `<canvas>` or SVG.

## What already exists (from the scaffold)

- `src/ui/usePipeline.ts` (mine) runs the frame loop with `requestVideoFrameCallback`: `renderer.pushFrame(video)` → `inputDetector.analyze(video)` → `renderer.draw(mask, settings)` → `outputDetector.analyze(outputCanvas)`. It returns `{ input, output, delayFrames, error }`.
- The renderer (Person A) and detector (Person B) are **stubs** right now: the output canvas is black and reports are all zero. Build against the frozen APIs in `team/CONTRACTS.md`; when their branches merge, real data will flow in without changes on my side. Do not change how `usePipeline.ts` calls `createRenderer` or `createDetector`.
- `src/audio/audio.ts` is a stub with the API `createAudioChain(stream): AudioChain | null` (`setDelaySeconds`, `setBassDb`, `setVolume`, `dispose`). This one is mine, so I may extend it.

## Requirements

**Milestone 6 (audio):** `createMediaStreamSource(stream)` → `DelayNode` → low-shelf `BiquadFilter` (~200 Hz, gain from a bass slider) → `DynamicsCompressor` set as a limiter → `GainNode` (volume) → destination. Create/resume the `AudioContext` inside the "Share a tab" click handler. Video delay is `delayFrames` source frames, so set the delay to `delayFrames / measuredFps`. Measure fps in `usePipeline.ts` from `requestVideoFrameCallback` metadata (smoothed), expose it in the returned state, and update the delay when it changes. If there's no audio track, show "no audio shared" and continue video-only.

**Milestone 7 (proof):** two live line graphs over the last ~10 s: input `flashesPerSec` vs output `flashesPerSec`, with a horizontal line at 3 labelled as the WCAG general flash threshold. Keep a rolling history in a ref and draw on a canvas each animation frame; don't call setState per sample into a big array. Add small meters for `flashRisk` and `redRisk`. Avoid flashing UI: graphs and meters must change smoothly with no blinking colours. Keep the raw thumbnail small.

**Milestone 8 (polish):** sliders for brightness (0.3–1) and saturation (0–1), wired to the `settings` state passed to `usePipeline`; a max-protection toggle; bass and volume sliders for audio. Errors: user cancels the share picker, shared tab closed / "Stop sharing" (return to start state cleanly and dispose audio), WebGL2 unavailable (`pipeline.error`). The disclaimer "Reduces flash risk; not a medical device." stays visible. Wording: "reduces risk", never "prevents seizures" or "safe for everyone".

## Testing

Until B's test page lands on `main`, share any tab with a video. Once B merges `public/test/flash.html`, merge `main` into your branch and use it as the flashing source. Check audio sync by sharing a video with visible speech.

## Workflow

- Work on branch `c-ui-audio`. Before writing code, give me a 3–5 line plan. Do one milestone at a time, then tell me exactly how to test it in Chrome and what I should see.
- Run `npm run build` before every commit. Before committing, run `git status --short` and confirm every changed path starts with `src/ui/`, `src/audio/`, or `src/capture/`.
- Write progress and status notes in `src/audio/README.md` (create `src/ui/README.md` if useful), never in `CLAUDE.md`.
- You're the integrator: after A's and B's PRs merge, pull `main`, run the full app, and report any API mismatch to the owner instead of patching their files.

Start with milestone 6.
