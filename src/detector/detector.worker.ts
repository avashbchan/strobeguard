// Detector worker: one per createDetector() call, so each has its own state.
// Receives 64×36 RGBA frames, replies with one RiskReport per frame.

import { createDetectorState, processFrame } from './detectorCore.ts';
import type { FrameMessage, ReportMessage } from './messages.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const state = createDetectorState();

ctx.onmessage = (e: MessageEvent<FrameMessage>) => {
  const { buffer, width, height, timeMs, frameIndex } = e.data;
  const report = processFrame(state, new Uint8ClampedArray(buffer), width, height, timeMs, frameIndex);
  const reply: ReportMessage = { report };
  ctx.postMessage(reply);
};
