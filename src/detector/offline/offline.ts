// Dev-only: runs the detector over a video FILE (not a live capture) for the IRIS comparison.
// scripts/iris-compare.mjs calls window.runOffline() over CDP.
//
// Same pixels as production (createFrameGrabber) and the same pure core (processFrame), but timed by
// MEDIA time instead of wall-clock, so results are deterministic and line up with IRIS frame numbers.

import { createFrameGrabber } from '../detector.ts';
import { createDetectorState, processFrame } from '../detectorCore.ts';

if (!import.meta.env.DEV) throw new Error('The offline runner is only available in development.');

export type OfflineOptions = {
  url: string;
  fps: number; // source frame rate (taken from IRIS's per-frame timestamps)
  mode: 'seek' | 'play'; // seek = every frame exactly (short clips); play = real time (long clips)
};
/** [frame (0-based), mediaTimeMs, flashesPerSec, flashRisk, redRisk, maskMax] */
export type OfflineRow = [number, number, number, number, number, number];
export type OfflineResult = { rows: OfflineRow[]; width: number; height: number; duration: number; error?: string };

const round = (x: number) => Math.round(x * 1000) / 1000;

async function load(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous'; // the file server sends CORS headers; keeps the canvas readable
  video.preload = 'auto';
  video.src = url;
  document.body.append(video);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(`cannot decode ${url}: ${video.error?.message ?? 'unknown error'}`));
  });
  return video;
}

/** Resolves once the frame for the current position has been presented (or after a short timeout). */
function presented(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 250);
    video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
  });
}

async function runOffline({ url, fps, mode }: OfflineOptions): Promise<OfflineResult> {
  const video = await load(url);
  const grab = createFrameGrabber();
  const state = createDetectorState();
  const rows: OfflineRow[] = [];
  const analyze = (frame: number, tMs: number) => {
    const image = grab(video);
    if (!image) return;
    const r = processFrame(state, image.data, image.width, image.height, tMs, frame);
    rows.push([frame, round(tMs), r.flashesPerSec, round(r.flashRisk), round(r.redRisk), round(Math.max(...r.cellMask))]);
  };

  if (mode === 'seek') {
    const frames = Math.floor(video.duration * fps + 1e-6);
    for (let i = 0; i < frames; i++) {
      video.currentTime = (i + 0.5) / fps; // middle of frame i
      await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
      await presented(video);
      analyze(i, (i * 1000) / fps);
    }
  } else {
    await new Promise<void>((resolve, reject) => {
      const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        analyze(Math.round(meta.mediaTime * fps), meta.mediaTime * 1000);
        if (!video.ended) video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      video.onended = () => resolve();
      video.play().catch(reject);
    });
  }
  const result = { rows, width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  video.remove();
  return result;
}

declare global {
  interface Window { runOffline: typeof runOffline }
}
window.runOffline = runOffline;
