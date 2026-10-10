// Per-cell flash counting with turning points (hysteresis), over a sliding time window.
//
// A transition is a change of >= minDelta from the last turning point (the most recent
// peak or trough), where the darker of the two states is < maxDarker. Transitions always
// alternate direction, so two consecutive transitions = one flash (up+down or down+up).
// Rates count half-flashes (transitions / 2), like EA IRIS: 7 transitions in a second = 3.5/s,
// which already exceeds the WCAG 3/s limit (with whole flashes it would take 8).
// Small noise never crosses minDelta, and a slow fade produces only one transition per
// direction change, so fades and isolated flashes stay at low rates.

export const WINDOW_MS = 1000;

export type TransitionRule = {
  minDelta: number; // minimum change from the last turning point
  maxDarker: number; // the darker state must be below this (Infinity = no limit)
};

/** WCAG 2.3.1 general flash: luminance change >= 0.1 with darker state < 0.8. */
export const LUMINANCE_RULE: TransitionRule = { minDelta: 0.1, maxDarker: 0.8 };
/** Red flash: at least a quarter of the cell switches to/from saturated red. */
export const RED_RULE: TransitionRule = { minDelta: 0.25, maxDarker: Infinity };

export type CellTracker = {
  extreme: number; // last turning point (running max while rising, min while falling); NaN = no data yet
  dir: number; // +1 rising, -1 falling, 0 no transition yet
  times: number[]; // timestamps (ms) of transitions inside the window
};

export function createTracker(): CellTracker {
  return { extreme: NaN, dir: 0, times: [] };
}

/** Feed one sample. Returns true if it completed a transition. */
export function updateTracker(t: CellTracker, value: number, timeMs: number, rule: TransitionRule): boolean {
  if (Number.isNaN(t.extreme)) {
    t.extreme = value;
    return false;
  }
  // Keep extending the current peak (rising) or trough (falling).
  if ((t.dir > 0 && value > t.extreme) || (t.dir < 0 && value < t.extreme)) {
    t.extreme = value;
    return false;
  }
  const delta = value - t.extreme;
  const darker = Math.min(value, t.extreme);
  if (Math.abs(delta) >= rule.minDelta && darker < rule.maxDarker) {
    t.dir = delta > 0 ? 1 : -1;
    t.extreme = value; // this sample is the new turning point
    t.times.push(timeMs);
    return true;
  }
  return false;
}

/** Flashes (pairs of opposing transitions) in the last WINDOW_MS. Prunes old transitions. */
export function flashesInWindow(t: CellTracker, nowMs: number): number {
  const cutoff = nowMs - WINDOW_MS;
  let drop = 0;
  while (drop < t.times.length && (t.times[drop] ?? 0) <= cutoff) drop++;
  if (drop > 0) t.times.splice(0, drop);
  return t.times.length / 2;
}
