// The whole detector as one pure step function: (state, RGBA frame, time) → RiskReport.
// The worker owns one DetectorState; tests drive it directly with synthetic frames.

import { CELL_COUNT, type RiskReport } from '../types.ts';
import { cellSignals } from './luminance.ts';
import {
  LUMINANCE_RULE,
  RED_RULE,
  createTracker,
  flashesInWindow,
  updateTracker,
  type CellTracker,
} from './flashCounter.ts';
import { areaRate, cellTarget, easeMask, flashRiskFromRate, redRiskFromRate } from './risk.ts';

export type DetectorState = {
  lum: CellTracker[];
  red: CellTracker[];
  mask: Float64Array; // eased damping, persists between frames
  lastTimeMs: number; // NaN before the first frame
};

export function createDetectorState(): DetectorState {
  return {
    lum: Array.from({ length: CELL_COUNT }, createTracker),
    red: Array.from({ length: CELL_COUNT }, createTracker),
    mask: new Float64Array(CELL_COUNT),
    lastTimeMs: NaN,
  };
}

/** Analyze one frame. `timeMs` must come from a monotonic clock (performance.now()). */
export function processFrame(
  state: DetectorState,
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  timeMs: number,
  frameIndex: number,
): RiskReport {
  const signals = cellSignals(rgba, width, height);
  const flashRates = new Array<number>(CELL_COUNT);
  const redRates = new Array<number>(CELL_COUNT);
  const target = new Array<number>(CELL_COUNT);

  for (let i = 0; i < CELL_COUNT; i++) {
    const lumT = state.lum[i]!;
    const redT = state.red[i]!;
    updateTracker(lumT, signals.lum[i] ?? 0, timeMs, LUMINANCE_RULE);
    updateTracker(redT, signals.red[i] ?? 0, timeMs, RED_RULE);
    flashRates[i] = flashesInWindow(lumT, timeMs);
    redRates[i] = flashesInWindow(redT, timeMs);
    target[i] = cellTarget(flashRates[i]!, redRates[i]!);
  }

  const dt = Number.isNaN(state.lastTimeMs) ? 0 : timeMs - state.lastTimeMs;
  state.lastTimeMs = timeMs;
  easeMask(state.mask, target, dt);

  const flashesPerSec = areaRate(flashRates);
  return {
    frameIndex,
    cellMask: Array.from(state.mask),
    flashRisk: flashRiskFromRate(flashesPerSec),
    redRisk: redRiskFromRate(areaRate(redRates)),
    flashesPerSec,
  };
}
