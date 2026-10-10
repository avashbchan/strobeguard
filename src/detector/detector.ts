// OWNER: Person B (detector). Public API is frozen — see team/CONTRACTS.md.
// STUB: reports zero risk for every frame so the UI has live data to render.

import { CELL_COUNT, type RiskReport } from '../types.ts';

export type Detector = {
  /**
   * Analyze one frame. The detector downscales `source` to 64×36 itself and
   * posts the pixels to its Web Worker. May drop frames if the worker is busy.
   */
  analyze(source: CanvasImageSource): void;
  dispose(): void;
};

/** Each call creates an independent detector (own worker + own state). */
export function createDetector(onReport: (report: RiskReport) => void): Detector {
  let frameIndex = 0;
  return {
    analyze() {
      onReport({
        frameIndex: frameIndex++,
        cellMask: new Array<number>(CELL_COUNT).fill(0),
        flashRisk: 0,
        redRisk: 0,
        flashesPerSec: 0,
      });
    },
    dispose() {},
  };
}
