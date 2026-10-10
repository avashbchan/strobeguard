// OWNER: Person A. Dev-only mask override for testing the renderer without the detector:
//   ?debugMask=all      every cell 1
//   ?debugMask=top      top row only (checks orientation: row 0 must be the TOP)
//   ?debugMask=checker  alternating cells (checks per-cell placement and edge fades)
// Ignored in production builds.

import { CELL_COUNT, GRID_COLS } from '../types.ts';

export function readDebugMask(): number[] | null {
  if (!import.meta.env.DEV) return null;
  const mode = new URLSearchParams(window.location.search).get('debugMask');
  if (!mode) return null;

  const mask = new Array<number>(CELL_COUNT).fill(0);
  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;
    if (mode === 'all') mask[i] = 1;
    else if (mode === 'top') mask[i] = row === 0 ? 1 : 0;
    else if (mode === 'checker') mask[i] = (row + col) % 2 === 0 ? 1 : 0;
  }
  return mask;
}
