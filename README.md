<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/strobeguard-logo-tagline-dark.svg">
    <img src="public/brand/strobeguard-logo-tagline-light.svg" alt="StrobeGuard: Cut the flash. Keep the show." width="562">
  </picture>
</h1>

**Live site: [strobeguardlive.us](https://strobeguardlive.us)** (Chrome on desktop)

StrobeGuard is a photosensitivity-aware livestream viewer. You share a browser tab that is playing a stream (Twitch, YouTube, a concert). StrobeGuard watches it for dangerous flashing and shows you a filtered version in real time, with the audio delayed to match. It runs entirely in your browser: no backend, no uploads, no accounts.

> Reduces flash risk; not a medical device.

---

## Contents

1. [Why it exists](#why-it-exists)
2. [What the product does](#what-the-product-does)
3. [How it works](#how-it-works)
4. [Safety design](#safety-design)
5. [Data contracts](#data-contracts)
6. [Project structure](#project-structure)
7. [How it was built](#how-it-was-built)
8. [Results](#results)
9. [Testing and evaluation tooling](#testing-and-evaluation-tooling)
10. [Limitations](#limitations)
11. [Brand assets](#brand-assets)

---

## Why it exists

Flashing video can trigger seizures in people with photosensitive epilepsy and migraines in many more. Pre-recorded video can be screened ahead of time. **Live content can't**: a concert's strobe lighting, a game's explosion effects or a stream overlay arrive without warning, and the viewer has no chance to look away first.

The goal was a tool that sits between the viewer and any live source and **reduces the risk** before the picture reaches their eyes, without making the stream unwatchable. That produced the working rules for the project:

- **Real time, with look-ahead.** The first flash is the most dangerous one, so the app deliberately shows you video that is about half a second old. In that time it sees the flash coming and calms it before you do.
- **Only touch what flashes.** A calm part of the picture, or a calm stream, should come out pixel-identical. A camera flash or a slow fade should not trigger anything.
- **Prove it.** Instead of asking for trust, the app runs a second detector on its own output and graphs "original flashes per second" against "filtered flashes per second", with the 3 per second limit marked.
- **Browser only.** Chrome desktop, static hosting, no server processing, no data leaving the machine.

Non-goals: mobile, Safari/Firefox, a browser extension, an OBS plugin, accounts, a backend, DRM content (Netflix and similar can't be captured).

## What the product does

1. A **warning screen** explains the app and what it can and can't do.
2. You click **Share a tab**, pick a Chrome tab and tick "Share tab audio".
3. The large canvas shows the **filtered** stream. The unfiltered view exists only as a small, blurred "Original" thumbnail you can choose to unblur, collapse or resize.
4. While it runs you get:
   - **Two live graphs** (last 10 s): original vs filtered flashes per second, threshold line at 3.
   - **Risk meters** for general flash and saturated red, for both original and filtered.
   - A **session timeline** that marks every flagged stretch of the whole share (high risk, caution, sustained caution) and keeps growing, so it works for hour-long streams.
   - A **tally** of flashes softened this session and how long the filter has been active.
   - **Controls:** brightness, saturation, a *Maximum protection* switch that forces strong damping everywhere, bass (low-shelf cut) and volume.
   - Fullscreen (button, `F` or double-click), frame rate, delay and audio-sync readouts.
5. Errors are recoverable: cancelling the picker, closing the shared tab, sharing without audio, WebGL being unavailable and a lost GPU context are all handled.

## How it works

```
 shared tab ──► hidden <video> ─┬─► 15-frame ring buffer (WebGL textures) ──► shader filter ──► large <canvas>
 (getDisplayMedia)              │        newest frame ▲ analysed      oldest frame ▲ shown          │
                                │                                                                  │
                                ├─► 64×36 downscale ──► Web Worker detector ──► cellMask ──────────┤ (damping per cell)
                                │                                                                  │
                                │                                  second detector on the output ◄─┘ ──► proof graphs
                                └─► audio ──► delay ──► low-shelf ──► limiter ──► gain ──► speakers
```

Every new source frame goes through the same four steps (`src/ui/usePipeline.ts`): `pushFrame` into the ring buffer, analyse the input, `draw` the delayed, filtered frame, analyse the output canvas.

### 1. Capture (`src/capture/`)
`getDisplayMedia` at 30 fps feeds a hidden, muted `<video>`. Audio constraints are chosen for fidelity and to avoid hearing the stream twice: `suppressLocalAudioPlayback: true` (Chrome mutes the original tab while still capturing it), and echo cancellation, noise suppression and auto gain **off** (voice processing pumps music and ducks the stream). `selfBrowserSurface` and `systemAudio` are excluded so StrobeGuard can't capture its own delayed output. After sharing, the track's real settings are read; if the original tab isn't actually silenced (a window or screen was shared instead of a tab) the viewer shows a notice. Cancel, "Stop sharing" and tab-close events all return to the start state and release every track.

### 2. Frame loop and ring buffer (`src/ui/frameClock.ts`, `src/buffer/`)
Tab capture doesn't deliver frames for a static or paused tab, so a `requestAnimationFrame` clock capped at 30 fps pushes the current pixels every tick (accepting callbacks up to 4 ms early so a 60 Hz display still gets 30 fps cadence). The ring (`frameRing.ts`) holds 15 RGBA8 textures allocated once with `texStorage2D` and refreshed with `texSubImage2D`, so there is no per-frame allocation. Frames are stored at most 1920×1080 (larger sources go through a mipmapped staging texture and a trilinear downscale), which keeps a 5K display from exhausting GPU memory.

Each slot is stamped with its capture time and the frame displayed is the one whose **age is closest to a fixed 467 ms** (14 frames at a nominal 30 fps), never stepping backwards. This took three PRs to get right: showing "the oldest slot" replayed frames faster than they were captured when ticks were uneven, so a safe 2 Hz flash measured 3 to 4 flashes/s at the output, and an adaptive delay that tracked measured fps still jumped after a stall and inserted a flash. A constant delay fixed both. The audio delay uses the same constant.

### 3. Detection (`src/detector/`)
All maths lives in pure, DOM-free functions that are tested with plain arrays; a Worker wraps them. The main thread downscales each frame to **64×36** on an `OffscreenCanvas` and transfers the pixel buffer to the worker (one frame in flight at a time).

- **Luminance.** Each pixel is converted to linear light (`c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`), then `L = 0.2126R + 0.7152G + 0.0722B`. The frame is split into an **8×6 grid** (48 cells) and each cell's mean luminance is tracked over time.
- **Transitions with hysteresis (`flashCounter.ts`).** A transition is a change of at least **0.1** from the cell's last turning point (its most recent peak or trough) where the darker state is **below 0.8**, the WCAG 2.3.1 general-flash definition. Transitions alternate direction by construction. Noise never crosses 0.1, and a slow fade produces one transition per direction change, so fades and isolated camera flashes stay at low rates.
- **Half-flash counting.** Rates count `transitions / 2` within a sliding 1 s window, the way EA's IRIS does, so 7 transitions in a second (3.5/s) already fails. Counting whole flashes would have needed 8.
- **Area rule (`risk.ts`).** A frame is dangerous when cells covering at least 25% of the screen exceed 3 flashes/s. With 48 cells that is the **12th-highest per-cell rate**, which becomes `flashesPerSec`. `flashRisk` ramps from 0 at 1/s to 1 at 3.5/s.
- **Saturated red.** A pixel is saturated red when `R/(R+G+B) >= 0.8` on linear channels. Red is tracked separately as a per-cell fraction, with a transition being a change of 0.25 or more, because red flashing is higher risk. `redRisk` ramps from 1/s to 3/s.
- **Per-cell damping mask.** Each cell's target damping comes from *its own* rate: 0 at 2.5 flashes/s or below, 1 at 3 (red: 0 at 1.5, 1 at 2). Starting just under the threshold buys time to react before the delayed frame is shown, and a small flashing corner gets damped locally even when the frame as a whole isn't "dangerous".
- **Easing.** The mask moves toward its target exponentially: attack τ = 60 ms (about 90% in four frames), release τ = 600 ms, time step capped at 100 ms, values under 0.01 snap to 0. The filter itself must never flicker, so it eases in fast and out slowly.
- **Session timeline (`timeline.ts`).** Turns the stream of reports into flagged segments mirroring IRIS's grades: *fail* (over 3/s over 25% of the screen, or dangerous red), *warning* (2/s and up) and *extended* (warning or worse for more than 4 s in any 5 s). Only segments are stored, so multi-hour sessions stay small.
- **Offline page (`offline/`).** Runs the same detector over a video file frame by frame, used by the IRIS comparison and evaluation scripts.

### 4. Filtering (`src/render/`)
A WebGL2 renderer with two shader passes, driven by the 8×6 mask (uploaded as a linearly-filtered R8 texture so damping fades smoothly across cell borders).

- **Pass 1, a coarse brightness field.** For each of the 8×6 regions it averages the colour of the displayed frame plus the next four buffered (newer) frames with weights 5-4-3-2-1, so the filter sees a flash coming before it is on screen (**centered smoothing: past and future**). That is blended with the previous field through a recursive low-pass, in cube-root (lightness-like) space so a rare bright flash barely lifts a dark scene. From the smoothed brightness it computes a per-region **gain** (capped at 4×) and the **share of light a gain can't supply** (pixels already too bright to scale up). Gain is stored divided by its maximum so an 8-bit render-target fallback still works.
- **Pass 2, apply.** Each pixel is *scaled* by the smooth gain and gets the smooth fill added, so brightness is pulled toward the smoothed value in both directions (the dark half of a flash is lifted, the bright half is dimmed). Because only a smooth gain and fill are applied, **all pixel detail, hue and edges come from the current frame** and nothing can trail. Saturated-red regions take the smoothed hue at the pixel's own brightness, so red flicker settles instead of flashing, and contrast is reduced in proportion to risk. Brightness and saturation sliders apply last; *Maximum protection* raises the mask floor everywhere.
- **Exact passthrough.** With the mask at 0 and neutral settings the output is the source texel, bit for bit, so calm content is untouched.
- **Robustness.** Passes that render into textures use a non-flipping vertex shader (an early bug stored the history upside down so damped areas borrowed brightness from the mirrored position). On `webglcontextlost` the renderer drops its GPU objects and becomes a no-op, then rebuilds and resets history on `webglcontextrestored`. A dev-only `?debugMask=all|top|checker` override exists for visual checks and is ignored in production.

### 5. Audio (`src/audio/`)
`MediaStreamSource → DelayNode (467 ms, same constant as the renderer) → low-shelf BiquadFilter (200 Hz, user bass, 0 to -24 dB) → DynamicsCompressor (limiter) → GainNode (volume) → destination`. The audio context is created and resumed inside the "Share a tab" click, parameters ramp smoothly, and gain starts muted until the delay is set. Controls disable themselves when no audio was shared.

### 6. Proof and UI (`src/ui/`)
A second detector instance analyses the **output canvas** (the renderer keeps `preserveDrawingBuffer: true` so it can be read back), feeding the dual graphs and meters. Graph histories live in refs, are sampled at 20 Hz at most and expire after 10 s. The UI is React with plain CSS (no component library).

## Safety design

- A **photosensitivity warning screen** comes before any capture starts.
- The **raw stream is never shown large**. The Original preview is a small thumbnail, blurred and dimmed until the viewer opts in.
- The interface itself avoids flashing: no animated backgrounds, glows or pulsing, 150 ms colour transitions, zero motion under `prefers-reduced-motion`.
- Colour is never the only signal (timeline segments have a text key and a screen-reader list; striped fill marks sustained caution).
- Wording is deliberate: the app **reduces risk**. It does not claim to prevent seizures or make content safe for everyone, and the disclaimer "Reduces flash risk; not a medical device." stays visible.

## Data contracts

The shared types live in `src/types.ts`, along with `GRID_COLS` / `GRID_ROWS` / `CELL_COUNT`.

```ts
type RiskReport = {
  frameIndex: number;
  cellMask: number[];      // 48 values (8×6), row-major, row 0 = top; damping 0–1 per cell
  flashRisk: number;       // overall 0–1
  redRisk: number;         // 0–1
  flashesPerSec: number;   // rate reached by >= 25% of cells (the graph's line at 3 is WCAG)
};

type FilterSettings = {
  brightness: number;      // multiplier, 1 = unchanged
  saturation: number;      // multiplier, 1 = unchanged
  maxProtection: boolean;  // forces strong damping everywhere
};
```

Three function-level APIs were frozen at the start so three people could work in parallel: `createRenderer(canvas)` (`pushFrame`, `draw`, `delayFrames`, `dispose`), `createDetector(onReport)` (`analyze(source)`, which accepts the video **and** the output canvas) and `createAudioChain(stream)`.

## Project structure

```
src/
  main.tsx              React entry
  types.ts              RiskReport, FilterSettings, grid constants (frozen contract)

  capture/              Tab capture
    capture.ts            getDisplayMedia, audio constraints, hidden video, "original not silenced" check,
                          cleanup on cancel / stop / tab close
    capture.test.mjs      tests with fake tracks and streams

  buffer/               GPU frame store
    frameRing.ts          15 immutable-storage RGBA8 textures, capture-time stamps, indexForAge(),
                          1920×1080 cap with mipmapped staging

  detector/             Flash detection (pure functions + Worker)
    luminance.ts          sRGB→linear, relative luminance, saturated-red test, 8×6 cell averages
    flashCounter.ts       turning-point transition tracker + 1 s sliding window (half-flash counting)
    risk.ts               12th-highest-cell area rule, flashRisk/redRisk, per-cell targets, mask easing
    detectorCore.ts       processFrame(state, rgba, w, h, t, i) → RiskReport, no DOM
    detector.worker.ts    owns one detector state per worker
    detector.ts           main-thread side: 64×36 OffscreenCanvas downscale, transferable buffers
    messages.ts           worker message types
    timeline.ts           session risk segments (fail / warning / extended), bridged into flagged parts
    offline/              page that runs the detector over a video file frame by frame
    *.test.ts             steady, 5 Hz, 2 Hz, single flash, slow fade, <25% area, red, easing, timeline

  render/               WebGL2 filter
    renderer.ts           createRenderer: ring buffer, two passes, display timing, context-loss recovery
    shaders.ts            GLSL: fullscreen triangle, coarse-field pass, apply pass
    history.ts            ping-pong field textures (smoothed colour + gain / fill share)
    gl.ts                 compile and link helpers
    debugMask.ts          dev-only ?debugMask override

  audio/                Web Audio chain
    audio.ts              source → delay → low-shelf → limiter → gain, smooth parameter ramps
    audio.test.mjs

  ui/                   React UI and pipeline glue
    usePipeline.ts        the frame loop: push, analyse input, draw, analyse output
    frameClock.ts         30 fps tick clock for static or paused sources
    frameTiming.ts        smoothed measured source frame rate
    previewSize.ts        resizable Original preview bounds
    App.tsx               warning → viewer switch
    WarningScreen.tsx     pre-capture warning
    Viewer.tsx            stage, controls, sidebar, fullscreen, errors
    FlashGraph.tsx        input vs output graphs with the 3/s line, hover crosshair
    RiskTimeline.tsx      whole-session flagged-parts bar
    OriginalPreview.tsx   small, blurred, collapsible raw thumbnail
    Disclaimer.tsx, Mark.tsx, styles.css
    testing/              dev-only harness with synthetic video and tone, no real screen or mic

  grader/               Objective output-quality grader (dev-only page)
    grader.ts             virtual clock, real renderer and detector, input|output pairs
    metrics.ts            OKLab per-frame metrics, score, safety gate
    synthetic.ts          deterministic test scenes drawn frame by frame

public/test/flash.html  Test page with every flash pattern (5 Hz, red, 2 Hz, single, fade, corner)
public/brand/, favicon…  Logos and app icons

scripts/                Evaluation tooling (no npm dependencies, Node ≥ 22 + Chrome)
  flash-e2e.mjs           real Chrome, real tab capture, checks the app's own readouts
  grade.mjs               frame-by-frame quality grading against the unfiltered frame
  iris-compare.mjs        our detector vs EA IRIS, frame by frame (+ iris/, lib/cdp.mjs)
  eval-video.mjs          recall / false damping / undamped frames on labelled clips
  iris-to-labels.mjs, iris-agreement.mjs, tune-sweep.mjs
  quality/corpus.json     clips and synthetic scenes the grader uses

results/                Measured results: RESULTS.md, raw outputs, labels, split, sweep tables
clips/README.md         How to fetch the shared test clips (kept out of git)
team/                   Ownership map and frozen APIs used during the parallel build
```

Each of `src/render/`, `src/detector/`, `src/buffer/`, `src/audio/` and `scripts/` has its own README with the measurements behind its decisions.

## How it was built

The project was built by three people over roughly two days (October 9 to 11, 2026), using 30 pull requests. The scaffold fixed the data contracts, three function-level APIs and a file-ownership map (`team/CONTRACTS.md`), so a render owner, a detector owner and a UI/audio owner could work on separate branches and merge cleanly.

**1. Scaffold and parallel build (PRs #1 to #6).** Skeleton, warning screen, tab capture and the frozen stubs. Then, in parallel: the WebGL2 ring buffer that displays the oldest frame, the pure detector with 23 unit tests and its Web Worker (plus a flashing test page so the others could test against it), the first damping shader (past-only low-pass, red desaturation, contrast reduction) and the audio chain with graphs and controls. Milestone 5 added centered smoothing from look-ahead frames: a 5 Hz black/white flash's output swing fell from 0.060 to 0.025.

**2. Integration made the timing honest (PRs #7 to #13).** Putting the parts together exposed bugs no unit test had: a static tab delivered no frames and left the canvas black (#7), uneven animation ticks made a safe 2 Hz flash read 3 to 4 flashes/s at the output (#8), a frame-loop stall in an adaptive-delay design replayed a white/black edge and inserted a flash in 1 of 14 runs (#11), and 60 Hz jitter skipped ticks (#10). The answer was a fixed 467 ms capture-time delay, with audio matched to the same constant (#12). The same stretch fixed an upside-down history texture, capped buffered frames at 1080p and added WebGL context-loss recovery (#13).

**3. Testing against reality (#9, #14, #18).** An end-to-end script drives real Chrome with real tab capture of the test page and reads the app's own meters. An offline detector page and an IRIS comparison harness graded our detector against EA's reference tool; that comparison led to counting half-flashes so 7 transitions per second fails, as it does in IRIS.

**4. UI iteration (#15, #16, #19, #21, #22).** A Catppuccin dark theme, then a calm redesign with a filtered-regions map, then v2 with a session tally, a blurred and resizable original preview and a hover chart, plus a fit-to-stage fix so the video is never cropped. The whole-session risk timeline arrived alongside.

**5. Quality versus safety (#17, #20, #23, #29).** A change to keep stage lighting from going grey was merged without running the flash test and let a 5 Hz black/white strobe through unchanged (5 per second in, 5 out). It was reverted within hours (#20), re-applied with a fix that lifts the dark half of a flash (#23), and finally replaced by the coarse-field filter (#29), which removed the grey wash, the veil over dark scenes and the trailing behind moving objects. The lesson that shaped everything after: **no filter change counts unless quality goes up and the safety gate still passes.**

**6. Measurement (#24 to #28).** Test clips moved to a shared Drive archive (3.3 GB shrunk to 68 MB at 360p with strobes verified to survive), an objective grader scores every output frame against the exact input frame it shows (#25, #26), the detector was evaluated against IRIS labels with a frozen held-out split and a tuning sweep (#27), and the audio path was fixed so the stream isn't heard twice (#28).

**7. Brand (#30).** Shield mark, favicon, app icons and logo files; the app now lives at [strobeguardlive.us](https://strobeguardlive.us).

## Results

**Detector against EA IRIS** (14 clips, 11.1 min of real streams and concerts at 360p / 30 fps, split by clip before any tuning; full write-up in [`results/RESULTS.md`](results/RESULTS.md)):

| Held-out set (5 clips, 4.2 min) | Result |
|---|---|
| Recall: IRIS-flagged dangerous seconds that were damped | **100%** (97 of 97) |
| Unfiltered flash frames before damping engaged | **0** (2 events) |
| False damping on safe content | **1.56 s per safe minute** |

Across all 14 clips the detector agrees with IRIS on dangerous-or-not for 12 of 14. It is stricter on a lit juggler stage and on Geometry Dash, because IRIS averages brightness over the whole changing area while StrobeGuard judges 48 cells separately. A 20-combination sweep of the ramp and easing constants found nothing that reduced late damping without adding more than 0.5 s per safe minute of false damping, so the constants were kept.

**Filter quality** (`scripts/grade.mjs`, 22 shared scenarios, frame by frame, from PR #29):

| | Before (#28 filter) | Coarse-field filter |
|---|---|---|
| Mean quality score (0 to 100) | 81.9 | **92.3** |
| Scenarios made worse | n/a | **0** (17 improved) |
| Scenarios safe | 100% | **100%** |
| Mean trail, 8 motion scenarios | 0.43 | **0.09** |
| Mean lag, same | 47% | **2%** |

End-to-end flash patterns pass 8 of 8 in real Chrome, and 77 unit tests pass. Numbers are from the test sets above and are not a clinical claim.

## Testing and evaluation tooling

The unit tests (`node --test`) cover the detector, capture, audio, frame clock and grader metrics with plain arrays and fakes. Beyond those, three tools check the whole product:

- **Flash E2E** launches real Chrome with real tab capture of `public/test/flash.html` and steps through every pattern. Dangerous patterns (5 Hz, red 5 Hz) must read over 3/s in and under 3/s out. Safe patterns (steady, 2 Hz, single flash, slow fade, small corner) must read under 3/s in. Output may never flash more than input. The session timeline must mark the right segments.
- **Quality grader** compares each output frame with the exact unfiltered frame it displays, in OKLab: collateral change in untouched areas, chroma kept and "greyed" share, hue shift, lightness, black lift (haze), edges and SSIM, plus trail and lag, then re-runs the detector on the output as a **safety gate**. Synthetic scenes (red strobes, partial flashes, a strobe over a dark scene, a calm half beside flashing lasers) make the results reproducible without video files.
- **IRIS comparison and eval** grade our detector against EA's IRIS frame by frame and report recall, false damping and undamped frames per event.

Details and usage are in [`scripts/README.md`](scripts/README.md).

## Limitations

- Chrome desktop only. DRM-protected streams can't be captured.
- The picture is about **467 ms** behind the source; that delay is the look-ahead that makes damping possible, and audio is delayed to match.
- Detection works on an 8×6 grid, so very small or misaligned flashes can be over-counted (a ~15% flash straddling cells can read as 25% or more), and the detector is stricter than IRIS on busy stage lighting and game effects.
- Under a strobe, dark scenes come out a little hazier than the original (a trade-off kept for a safety margin), and a faint soft smear can remain around very fast, large moving objects during the flash phase.
- The output red-risk meter can read 100% on a red 5 Hz pattern even though the output flash rate is near zero (known, not yet investigated).
- The evaluation set is small (14 clips; 2 dangerous events in the held-out set), and clips are 360p files rather than live capture.
- Sharing a window or screen instead of a tab can't silence the original audio, so the stream may be heard twice (the app warns you).
- **Reduces flash risk; not a medical device.** It lowers risk and doesn't remove it. If you have photosensitive epilepsy, follow your doctor's advice.

## Brand assets

Logos, the mark and app icons are in `public/brand/` and `public/`. Each logo comes in a dark variant (for dark backgrounds) and a light one.

| File | Use |
|---|---|
| `public/favicon.svg`, `favicon-16.png`, `favicon-32.png` | Browser tab icon (the PNGs are fallbacks) |
| `public/apple-touch-icon.png` (180), `icon-512.png` | Home-screen / install icons (`site.webmanifest`) |
| `public/brand/strobeguard-mark*.svg`, `strobeguard-mark-512.png` | The shield mark alone |
| `public/brand/strobeguard-logo-{dark,light}.svg` | Mark + wordmark |
| `public/brand/strobeguard-logo-tagline-{dark,light}.svg` | Horizontal, with "Cut the flash. Keep the show." |
| `public/brand/strobeguard-stacked-tagline-{dark,light}.svg` | Stacked, with tagline (slides, posters) |
