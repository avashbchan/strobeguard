// Shared data contracts. Do not change without telling the whole team.

export const GRID_COLS = 8;
export const GRID_ROWS = 6;
export const CELL_COUNT = GRID_COLS * GRID_ROWS; // 48

export type RiskReport = {
  frameIndex: number;
  cellMask: number[]; // 48 values (8×6), damping 0–1 per cell
  flashRisk: number; // overall 0–1
  redRisk: number; // 0–1
  flashesPerSec: number;
};

export type FilterSettings = {
  brightness: number; // user slider
  saturation: number; // user slider
  maxProtection: boolean; // forces strong damping everywhere
};
