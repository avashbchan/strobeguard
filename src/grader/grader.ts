// Dev-only: grades the real output pipeline on a video FILE, frame by frame, deterministically.
// scripts/grade.mjs calls window.runGrade() over CDP.
//
// The page replaces performance.now() with a virtual clock that advances exactly 1/fps per frame.
// Two copies of the real renderer run in lockstep: the one under test (with the detector's mask)
// and a reference with an all-zero mask, which outputs the source pixels unchanged. The reference
// is the "input": same frame selection, same WebGL decode path the viewer sees, so the comparison
// isolates what the filter does (a 2D-canvas decode of the video differs slightly in noise).
// As in the live pipeline, the mask used for a frame is the input detector's report from the
// previous frame, and a second detector measures the output (safety).

import { createRenderer } from '../render/renderer.ts';
import { createFrameGrabber } from '../detector/detector.ts';
import { createDetectorState, processFrame } from '../detector/detectorCore.ts';
import { BUFFER_FRAMES, DEFAULT_FILTER_SETTINGS, EMPTY_MASK } from '../types.ts';
import { frameQuality, scoreClip, summarize, type ClipFrame } from './metrics.ts';
import { drawScene, SYN_H, SYN_W, type SyntheticScene } from './synthetic.ts';

if (!import.meta.env.DEV) throw new Error('The grader is only available in development.');

const realNow = performance.now.bind(performance); // wall clock, for timing the grader itself
let virtualNow = 0;
Object.defineProperty(performance, 'now', { value: () => virtualNow, configurable: true });

const MW = 320; // metric resolution (16:9)
const MH = 180;
const MAX_PROTECTION_FLOOR = 0.8; // must match the renderer

/** Either a video URL or a synthetic scene name (see synthetic.ts). */
export type GradeOptions = { url?: string; synthetic?: SyntheticScene; start: number; seconds: number; fps?: number; maxProtection?: boolean };

/** A frame source the renderer and detector can read: a seeked <video>, or a canvas drawn per frame. */
type Source = { el: HTMLVideoElement; duration: number; goto(t: number): Promise<void>; dispose(): void };

/**
 * Video source that steps forward by PLAYING, not seeking: one seek to the start, then for each
 * frame play until a frame at/after the target time is presented and pause there. A seek per frame
 * makes Chrome decode from the previous keyframe every time (~200 ms/frame); sequential playback
 * decodes each frame once. Exactness doesn't depend on hitting every source frame: the renderer
 * under test and the reference always receive the same frame.
 */
async function videoSource(url: string, fps: number): Promise<Source> {
  const v = await load(url);
  let started = false;
  const goto = async (t: number) => {
    if (!started) {
      started = true;
      await seek(v, t);
      return;
    }
    if (v.currentTime >= t - 0.5 / fps) return; // already showing a frame at/after t
    await new Promise<void>((resolve, reject) => {
      const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (meta.mediaTime >= t - 0.5 / fps || v.ended) {
          v.pause();
          resolve();
        } else {
          v.requestVideoFrameCallback(onFrame);
        }
      };
      v.requestVideoFrameCallback(onFrame);
      v.play().catch(reject);
    });
  };
  return { el: v, duration: v.duration, goto, dispose: () => { v.pause(); v.remove(); } };
}

/** The renderer only reads videoWidth/videoHeight and uploads the pixels, so a canvas with those
 *  two properties stands in for a video. */
function syntheticSource(name: SyntheticScene): Source {
  const c = document.createElement('canvas');
  c.width = SYN_W;
  c.height = SYN_H;
  Object.defineProperty(c, 'videoWidth', { value: SYN_W });
  Object.defineProperty(c, 'videoHeight', { value: SYN_H });
  const ctx = c.getContext('2d')!;
  return {
    el: c as unknown as HTMLVideoElement,
    duration: Infinity,
    goto: async (t) => drawScene(ctx, name, t),
    dispose: () => c.remove(),
  };
}
type Sample = { label: string; frame: number; dataUrl: string };

function metricCanvas() {
  const c = new OffscreenCanvas(MW, MH);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}
/** Letterboxed draw so non-16:9 sources keep their shape (same on input and output). */
function drawFit(ctx: OffscreenCanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number): ImageData {
  const s = Math.min(MW / w, MH / h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MW, MH);
  ctx.drawImage(src, (MW - w * s) / 2, (MH - h * s) / 2, w * s, h * s);
  return ctx.getImageData(0, 0, MW, MH);
}

async function load(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.crossOrigin = 'anonymous';
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error(`cannot decode ${url}: ${v.error?.message ?? 'unknown'}`));
  });
  return v;
}
async function seek(v: HTMLVideoElement, t: number) {
  v.currentTime = t;
  await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
  await new Promise<void>((r) => {
    const timer = setTimeout(r, 250);
    v.requestVideoFrameCallback(() => { clearTimeout(timer); r(); });
  });
}

/** Side-by-side input | output picture for the report. */
function composite(input: ImageData, output: ImageData): string {
  const c = document.createElement('canvas');
  c.width = MW * 2 + 4;
  c.height = MH;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.putImageData(input, 0, 0);
  ctx.putImageData(output, MW + 4, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

async function runGrade({ url, synthetic, start, seconds, fps = 30, maxProtection = false }: GradeOptions) {
  if (!url && !synthetic) throw new Error('runGrade needs a url or a synthetic scene');
  const source = synthetic ? syntheticSource(synthetic) : await videoSource(url!, fps);
  const video = source.el;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:320px;height:180px';
  document.body.append(canvas);
  const renderer = createRenderer(canvas);
  const refCanvas = document.createElement('canvas');
  const reference = createRenderer(refCanvas);
  const grabIn = createFrameGrabber();
  const grabOut = createFrameGrabber();
  const inCtx = metricCanvas();
  const outCtx = metricCanvas();
  const inState = createDetectorState();
  const outState = createDetectorState();
  const settings = { ...DEFAULT_FILTER_SETTINGS, maxProtection };
  const delay = BUFFER_FRAMES - 1;

  const inRates: number[] = [];
  const frames: ClipFrame[] = [];
  const perFrame: number[][] = []; // [frame, ssim, untouchedDE, chromaRatio, inRate, outRate]
  const worst: { badness: number; sample: Sample }[] = [];
  const samples: Sample[] = [];
  let mask: readonly number[] = EMPTY_MASK;

  const total = Math.max(0, Math.floor(Math.min(seconds, source.duration - start) * fps));
  const sampleAt = new Set([Math.floor(total * 0.25), Math.floor(total * 0.5), Math.floor(total * 0.75)]);
  // Wall-clock time per phase (ms, summed), to see where grading time goes.
  const timing = { seek: 0, render: 0, readback: 0, metrics: 0 };
  let lost = 0;
  const onLost = () => { lost++; };
  canvas.addEventListener('webglcontextlost', onLost);
  refCanvas.addEventListener('webglcontextlost', onLost);
  let mark = realNow();
  const lap = (k: keyof typeof timing) => { const n = realNow(); timing[k] += n - mark; mark = n; };
  for (let i = 0; i < total; i++) {
    if (lost) throw new Error('WebGL context lost while grading (too many contexts?)');
    mark = realNow();
    await source.goto(start + i / fps + (synthetic ? 0 : 0.001));
    virtualNow = (i * 1000) / fps;
    lap('seek');
    renderer.pushFrame(video);
    reference.pushFrame(video);
    const pix = grabIn(video);
    const inReport = pix ? processFrame(inState, pix.data, pix.width, pix.height, virtualNow, i) : null;
    inRates[i % BUFFER_FRAMES] = inReport?.flashesPerSec ?? 0;

    const used = maxProtection ? mask.map((m) => Math.max(m, MAX_PROTECTION_FLOOR)) : mask;
    renderer.draw(mask, settings);
    reference.draw(EMPTY_MASK, DEFAULT_FILTER_SETTINGS);
    lap('render');
    const out = drawFit(outCtx, canvas, canvas.width, canvas.height);
    const outPix = grabOut(canvas);
    const outReport = outPix ? processFrame(outState, outPix.data, outPix.width, outPix.height, virtualNow, i) : null;
    if (inReport) mask = inReport.cellMask; // next frame uses this frame's report (live lag)

    if (i < delay) continue; // buffer still filling
    const input = drawFit(inCtx, refCanvas, refCanvas.width, refCanvas.height);
    lap('readback');
    const quality = frameQuality(input.data, out.data, MW, MH, used);
    lap('metrics');
    const f: ClipFrame = { quality, inRate: inRates[(i - delay) % BUFFER_FRAMES]!, outRate: outReport?.flashesPerSec ?? 0, outRed: outReport?.redRisk ?? 0 };
    frames.push(f);
    perFrame.push([i - delay, +quality.ssim.toFixed(3), +quality.untouched.dE.toFixed(2), +quality.all.chromaRatio.toFixed(3), f.inRate, f.outRate]);

    // Keep pictures of the 3 most damaged frames (low structure, colour loss, collateral) and 3 fixed points.
    const badness = (1 - quality.ssim) + (1 - Math.min(quality.all.chromaRatio, 1)) + quality.untouched.dE / 10;
    const label = `t=${(start + (i - delay) / fps).toFixed(2)}s`;
    if (worst.length < 3 || badness > worst[worst.length - 1]!.badness) {
      worst.push({ badness, sample: { label: `worst ${label}`, frame: i - delay, dataUrl: composite(input, out) } });
      worst.sort((a, b) => b.badness - a.badness);
      worst.length = Math.min(worst.length, 3);
    }
    if (sampleAt.has(i)) samples.push({ label, frame: i - delay, dataUrl: composite(input, out) });
  }

  const sizes = { video: [video.videoWidth, video.videoHeight], output: [canvas.width, canvas.height] };
  renderer.dispose();
  reference.dispose();
  for (const c of [canvas, refCanvas]) c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.removeEventListener('webglcontextlost', onLost);
  refCanvas.removeEventListener('webglcontextlost', onLost);
  canvas.remove();
  source.dispose();
  const summary = summarize(frames, fps);
  return { summary, ...scoreClip(summary), perFrame, images: [...worst.map((w) => w.sample), ...samples], sizes, timing: Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, Math.round(v / Math.max(frames.length, 1))])) };
}

declare global {
  interface Window { runGrade: typeof runGrade }
}
window.runGrade = runGrade;
