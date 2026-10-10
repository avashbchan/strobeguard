// Pure pixel math: sRGB → relative luminance, saturated-red test, per-cell averages.
// No DOM; works on plain RGBA arrays so it can be unit-tested.

import { CELL_COUNT, GRID_COLS, GRID_ROWS } from '../types.ts';

/** Undo sRGB gamma: c in 0–1 (encoded) → linear light 0–1. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Lookup table for 8-bit channel values (avoids pow() per pixel).
const LINEAR: Float64Array = new Float64Array(256);
for (let i = 0; i < 256; i++) LINEAR[i] = srgbToLinear(i / 255);

/** Linear value of an 8-bit sRGB channel (0–255). */
export function linear8(c: number): number {
  return LINEAR[c] ?? 0;
}

/** Relative luminance (0–1) of an 8-bit sRGB pixel: Rec. 709 weights on linear channels. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear8(r) + 0.7152 * linear8(g) + 0.0722 * linear8(b);
}

/** Saturated red: R / (R + G + B) >= 0.8, on linear channels. */
export const RED_RATIO = 0.8;
/** Ignore near-black pixels, where the ratio is just noise (linear 0.1 ≈ sRGB 89). */
export const RED_MIN_LINEAR = 0.1;

export function isSaturatedRed(r: number, g: number, b: number): boolean {
  const lr = linear8(r);
  if (lr < RED_MIN_LINEAR) return false;
  return lr / (lr + linear8(g) + linear8(b)) >= RED_RATIO;
}

export type CellSignals = {
  /** Mean relative luminance per cell, 0–1. Row-major, row 0 = top. */
  lum: Float64Array;
  /** Fraction of the cell's pixels that are saturated red, 0–1. */
  red: Float64Array;
};

/**
 * Average each 8×6 grid cell of an RGBA frame (e.g. 64×36 → 8×6 px per cell).
 * Cell edges use floor(col * width / GRID_COLS), so any frame size works.
 */
export function cellSignals(rgba: ArrayLike<number>, width: number, height: number): CellSignals {
  const lum = new Float64Array(CELL_COUNT);
  const red = new Float64Array(CELL_COUNT);
  for (let row = 0; row < GRID_ROWS; row++) {
    const y0 = Math.floor((row * height) / GRID_ROWS);
    const y1 = Math.floor(((row + 1) * height) / GRID_ROWS);
    for (let col = 0; col < GRID_COLS; col++) {
      const x0 = Math.floor((col * width) / GRID_COLS);
      const x1 = Math.floor(((col + 1) * width) / GRID_COLS);
      let sumLum = 0;
      let redCount = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const r = rgba[i] ?? 0;
          const g = rgba[i + 1] ?? 0;
          const b = rgba[i + 2] ?? 0;
          sumLum += relativeLuminance(r, g, b);
          if (isSaturatedRed(r, g, b)) redCount++;
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      const cell = row * GRID_COLS + col;
      lum[cell] = n > 0 ? sumLum / n : 0;
      red[cell] = n > 0 ? redCount / n : 0;
    }
  }
  return { lum, red };
}
