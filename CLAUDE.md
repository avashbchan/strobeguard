# Project: StrobeGuard — photosensitivity-safe livestream viewer

## Context
You are helping a 3-person team build a hackathon project in 30 hours. We need working, demoable code fast. Prefer simple, readable solutions over clever ones. Build in small, testable steps.

## What we're building
A Chrome desktop web app that makes livestreams (Twitch, YouTube, concert streams) safer for people with photosensitive epilepsy, migraines, and sensory sensitivities. The user shares a browser tab containing a stream; our app detects dangerous flashing and shows a filtered, safer version of the stream in real time.

## Hard constraints
- Runs entirely in the browser. No backend, no server-side processing.
- Target: Chrome desktop only.
- Stack: Vite + React + TypeScript (strict mode), WebGL for rendering, Web Workers for detection, Web Audio API for sound. Deployed on Vercel (HTTPS).
- Do not add new npm dependencies without asking first. Small WebGL helpers (e.g. regl) are acceptable if I approve.
- Never modify files unrelated to the current task.

## Pipeline
1. INPUT: navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: { suppressLocalAudioPlayback: true } }). Feed the stream into a hidden <video>. Optional later: OBS Virtual Camera via getUserMedia.
2. BUFFER: Ring buffer of the last 15 frames (~0.5 s at 30 fps), stored as WebGL textures. The newest frame is analyzed; the OLDEST frame is displayed. This look-ahead lets us damp the first flash before it is shown.
3. DETECT (in a Web Worker):
   - Downscale each new frame to 64×36 and send pixel data to the worker as a transferable buffer.
   - Convert to relative luminance: undo sRGB gamma (c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4), then L = 0.2126R + 0.7152G + 0.0722B.
   - Split the frame into an 8×6 grid of cells. Track each cell's average luminance over time.
   - A transition is a change of >= 0.1 in luminance from the cell's last turning point, where the darker state is < 0.8. Two opposing transitions = one flash.
   - Count flashes per cell in a sliding 1-second window.
   - A frame is dangerous if cells covering >= ~25% of the screen exceed 3 flashes/second (WCAG 2.3.1 general flash threshold).
   - Saturated red: pixel where R/(R+G+B) >= 0.8. Track red flashing separately; it is higher risk.
   - Single isolated flashes (e.g. camera flash) and slow fades must NOT trigger damping.
   - Damping values must ease in/out over several frames so the filter itself never flickers.
4. MITIGATE (WebGL fragment shader on the full-size frame):
   - Temporal low-pass: blend the displayed frame with neighboring buffered frames (past AND future — centered smoothing), weighted by the per-cell damping mask.
   - Blend luminance only; keep color/detail from the current frame to limit ghosting.
   - Reduce contrast and desaturate saturated reds in proportion to risk.
   - Apply only to flashing cells; untouched cells render normally.
5. AUDIO: createMediaStreamSource(stream) → DelayNode (equal to video buffer delay) → low-shelf BiquadFilter (~200 Hz, user bass slider) → DynamicsCompressor (limiter) → GainNode (volume) → destination. Audio context starts on a user click.
6. OUTPUT: Draw to a large <canvas> at the source frame rate.
7. PROOF: Run a second detector instance on the OUTPUT canvas. Show two live graphs: original flashes/sec vs. output flashes/sec, with a line at 3.

## Data contracts (do not change without telling me)
type RiskReport = {
  frameIndex: number;
  cellMask: number[];      // 48 values (8×6), damping 0–1 per cell
  flashRisk: number;       // overall 0–1
  redRisk: number;         // 0–1
  flashesPerSec: number;
};

type FilterSettings = {
  brightness: number;      // user slider
  saturation: number;      // user slider
  maxProtection: boolean;  // forces strong damping everywhere
};

## Suggested file structure
src/
  capture/        getDisplayMedia setup, hidden video, frame grabbing
  buffer/         ring buffer of frame textures
  detector/       worker + pure detection functions (unit-testable, no DOM)
  render/         WebGL setup and shaders
  audio/          Web Audio chain
  ui/             React components: start screen, controls, meters, thumbnail
  types.ts        shared contracts above

## Safety and wording requirements
- Show a photosensitivity warning screen before capture starts.
- Never display the raw stream at large size; the raw view is a small thumbnail only.
- Show the disclaimer: "Reduces flash risk; not a medical device."
- In UI text and comments, say the app "reduces risk", never that it "prevents seizures" or makes content "safe for everyone".

## Non-goals (do not build)
Mobile support, Safari/Firefox support, browser extension, OBS plugin, user accounts, backend, DRM content (Netflix etc.).

## How to work with me
- Before writing code for a task, give a 3–5 line plan.
- Implement one milestone at a time. After each, tell me exactly how to test it in the browser and what I should see.
- Keep detection logic as pure functions so it can be tested with plain arrays.
- If something is ambiguous or a requirement seems wrong, ask instead of guessing.
- If you hit a browser limitation, say so plainly and propose the simplest workaround.
- Comment non-obvious math (luminance, flash counting, shader blending) briefly.

## Milestones
1. Repo skeleton, start screen with warning, getDisplayMedia capture shown in a canvas.
2. WebGL passthrough + 15-frame ring buffer displaying the oldest frame.
3. Detector (pure functions) + Web Worker, producing RiskReports.
4. Shader damping driven by cellMask; red desaturation; contrast reduction.
5. Centered smoothing using future frames in the buffer.
6. Audio chain with matching delay.
7. Output detector + dual risk meters + raw thumbnail.
8. Polish: sliders, max protection toggle, disclaimer, error handling (user cancels share, tab closed, no audio shared).

## Current task
[Write the milestone or bug you're working on here]

## Repo notes
- Commands: `npm run dev` (http://localhost:5173), `npm run build` (typecheck + build), `npm run typecheck`.
- `src/types.ts` holds the data contracts plus `GRID_COLS`/`GRID_ROWS`/`CELL_COUNT`.
- `.cursor/rules/strobeguard.mdc` mirrors this file for Cursor — keep the two in sync.
- Milestone 1 status: done. Warning screen, tab capture, and raw source drawn into a small thumbnail canvas (the large output canvas waits for the WebGL filter so raw video is never shown big).
