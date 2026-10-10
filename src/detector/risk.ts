// Turning per-cell flash rates into area-based risk and an eased per-cell damping mask.

import { CELL_COUNT } from '../types.ts';

/** WCAG 2.3.1: more than 3 flashes in any one second is a failure. */
export const DANGER_RATE = 3;
/** Fraction of the screen that must flash (≈ WCAG's 25% of the visual field). */
export const AREA_FRACTION = 0.25;
/** 25% of 48 cells = 12 cells. */
export const AREA_CELLS = Math.ceil(CELL_COUNT * AREA_FRACTION);

/** The rate reached by at least AREA_CELLS cells, i.e. the 12th-highest per-cell rate. */
export function areaRate(rates: ArrayLike<number>): number {
  const sorted = Array.from(rates).sort((a, b) => b - a);
  return sorted[AREA_CELLS - 1] ?? 0;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// Rates come in half-flash steps (transitions / 2), so the ramps below are written in those steps.

/** Overall flash risk: 0 at ≤ 1 flash/s (isolated flashes), 1 once over the 3/s threshold (≥ 3.5). */
export function flashRiskFromRate(rate: number): number {
  return clamp01((rate - 1) / 2.5);
}

/** Red flashes are higher risk: 0 at ≤ 1 red flash/s, 1 at ≥ 3. */
export function redRiskFromRate(rate: number): number {
  return clamp01((rate - 1) / 2);
}

/**
 * Damping target for one cell, from its own rates (not the area rule), so only the cells
 * that actually flash get filtered. Luminance: 0 at ≤ 2.5 flashes/s (5 transitions), full at
 * ≥ 3 (6 transitions); starting just below the threshold buys time to damp before the delayed
 * frame is shown. Red: 0 at ≤ 1.5, full at ≥ 2 red flashes/s.
 */
export function cellTarget(flashRate: number, redRate: number): number {
  return Math.max(clamp01((flashRate - 2.5) * 2), clamp01((redRate - 1.5) * 2));
}

/** Time constants for easing the mask (exponential approach to the target). */
export const ATTACK_MS = 60; // ~90% in 4 frames at 30 fps
export const RELEASE_MS = 600; // slow fade-out so damping never flickers off and on
/** Cap on the time step so a stalled tab doesn't cause a jump. */
export const MAX_DT_MS = 100;
/** Below this the cell renders untouched. */
const SNAP_TO_ZERO = 0.01;

/** Ease `mask` toward `target` in place. Exponential smoothing: m += (target − m)·(1 − e^(−dt/τ)). */
export function easeMask(mask: Float64Array, target: ArrayLike<number>, dtMs: number): void {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS);
  const attack = 1 - Math.exp(-dt / ATTACK_MS);
  const release = 1 - Math.exp(-dt / RELEASE_MS);
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i] ?? 0;
    const goal = target[i] ?? 0;
    let next = m + (goal - m) * (goal > m ? attack : release);
    if (goal === 0 && next < SNAP_TO_ZERO) next = 0;
    mask[i] = clamp01(next);
  }
}
