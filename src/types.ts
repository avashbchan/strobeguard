// Shared data contracts. Do not change without telling the whole team.

export const GRID_COLS = 8;
export const GRID_ROWS = 6;
export const CELL_COUNT = GRID_COLS * GRID_ROWS; // 48

/** Ring buffer length. The newest frame is analyzed; the oldest is displayed. */
export const BUFFER_FRAMES = 15;

export type RiskReport = {
  frameIndex: number;
  // 48 values (8×6), damping 0–1 per cell.
  // Row-major, row 0 = TOP of the frame: index = row * GRID_COLS + col.
  // Already eased over time by the detector; the renderer uses it as-is.
  cellMask: number[];
  flashRisk: number; // overall 0–1
  redRisk: number; // 0–1
  // Area-based rate: the flash rate reached by >= 25% of cells
  // (12th-highest per-cell rate). > 3 means WCAG 2.3.1 general flash threshold exceeded.
  flashesPerSec: number;
};

export type FilterSettings = {
  brightness: number; // user slider: multiplier, 1 = unchanged, range 0.3–1
  saturation: number; // user slider: multiplier, 1 = unchanged, range 0–1
  maxProtection: boolean; // forces strong damping everywhere
};

export const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  brightness: 1,
  saturation: 1,
  maxProtection: false,
};

export const EMPTY_MASK: number[] = new Array<number>(CELL_COUNT).fill(0);
