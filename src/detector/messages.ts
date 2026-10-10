// Messages between detector.ts (main thread) and detector.worker.ts.

import type { RiskReport } from '../types.ts';

/** Main → worker. `buffer` is transferred (RGBA, width × height × 4 bytes). */
export type FrameMessage = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  timeMs: number; // main-thread performance.now() when the frame was grabbed
  frameIndex: number;
};

/** Worker → main. */
export type ReportMessage = { report: RiskReport };
