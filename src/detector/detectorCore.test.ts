import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetectorState, processFrame } from './detectorCore.ts';
import { areaRate } from './risk.ts';
import { CELL_COUNT, GRID_COLS, type RiskReport } from '../types.ts';

const W = 64;
const H = 36;
type RGB = readonly [number, number, number];
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
const GRAY: RGB = [128, 128, 128];
const RED: RGB = [255, 0, 0];

/** Build a 64×36 RGBA frame; color(cell) picks the color of each 8×6 cell. */
function frame(color: (cell: number) => RGB): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = Math.floor(y / 6) * GRID_COLS + Math.floor(x / 8);
      const [r, g, b] = color(cell);
      rgba.set([r, g, b, 255], (y * W + x) * 4);
    }
  }
  return rgba;
}

/** Simulate `seconds` of video at `fps`; scene(tMs, cell) gives each cell's color. */
function run(scene: (t: number, cell: number) => RGB, seconds: number, fps = 30): RiskReport[] {
  const state = createDetectorState();
  const reports: RiskReport[] = [];
  for (let i = 0; i <= seconds * fps; i++) {
    const t = (i * 1000) / fps;
    reports.push(processFrame(state, frame((c) => scene(t, c)), W, H, t, i));
  }
  return reports;
}

const square = (t: number, hz: number, a: RGB, b: RGB): RGB => (((t * hz) / 1000) % 1 < 0.5 ? a : b);
const maxOf = (rs: RiskReport[], f: (r: RiskReport) => number) => Math.max(...rs.map(f));
const maxMask = (rs: RiskReport[]) => maxOf(rs, (r) => Math.max(...r.cellMask));

test('report shape: 48 mask values in 0–1, frameIndex passed through', () => {
  const rs = run((t) => square(t, 5, WHITE, BLACK), 1);
  rs.forEach((r, i) => {
    assert.equal(r.frameIndex, i);
    assert.equal(r.cellMask.length, CELL_COUNT);
    for (const v of r.cellMask) assert.ok(v >= 0 && v <= 1);
    for (const v of [r.flashRisk, r.redRisk]) assert.ok(v >= 0 && v <= 1);
  });
});

test('steady frame → zero everything', () => {
  const rs = run(() => GRAY, 3);
  assert.equal(maxOf(rs, (r) => r.flashesPerSec), 0);
  assert.equal(maxOf(rs, (r) => r.flashRisk), 0);
  assert.equal(maxOf(rs, (r) => r.redRisk), 0);
  assert.equal(maxMask(rs), 0);
});

test('5 Hz full-frame flash → dangerous, full damping, no red risk', () => {
  const last = run((t) => square(t, 5, WHITE, BLACK), 3).at(-1)!;
  assert.ok(last.flashesPerSec > 3, `rate ${last.flashesPerSec}`);
  assert.equal(last.flashRisk, 1);
  assert.equal(last.redRisk, 0);
  for (const v of last.cellMask) assert.ok(v > 0.95);
});

test('5 Hz flash still detected at 15 fps (worker dropping frames)', () => {
  const last = run((t) => square(t, 5, WHITE, BLACK), 3, 15).at(-1)!;
  assert.ok(last.flashesPerSec > 3, `rate ${last.flashesPerSec}`);
});

test('3.5 Hz full-frame flash → dangerous (IRIS fails at 7 transitions/s)', () => {
  const last = run((t) => square(t, 3.5, WHITE, BLACK), 3).at(-1)!;
  assert.ok(last.flashesPerSec > 3, `rate ${last.flashesPerSec}`);
  assert.equal(last.flashRisk, 1);
});

test('2 Hz flash → passes, no damping', () => {
  const rs = run((t) => square(t, 2, WHITE, BLACK), 4);
  assert.ok(maxOf(rs, (r) => r.flashesPerSec) <= 3);
  assert.equal(maxMask(rs), 0);
});

test('single camera flash every 3 s → not dangerous, no damping', () => {
  const rs = run((t) => (t % 3000 < 100 ? WHITE : [32, 32, 32]), 9);
  assert.ok(maxOf(rs, (r) => r.flashesPerSec) <= 1);
  assert.equal(maxOf(rs, (r) => r.flashRisk), 0);
  assert.equal(maxMask(rs), 0);
});

test('slow fade → not dangerous, no damping', () => {
  const rs = run((t) => {
    const v = Math.round(255 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 4000)));
    return [v, v, v];
  }, 8);
  assert.ok(maxOf(rs, (r) => r.flashesPerSec) <= 1);
  assert.equal(maxMask(rs), 0);
});

test('flash in < 25% of the area → not dangerous overall, only those cells damped', () => {
  const corner = new Set([0, 1, 8, 9]); // 2×2 cells top-left
  const last = run((t, c) => (corner.has(c) ? square(t, 5, WHITE, BLACK) : GRAY), 3).at(-1)!;
  assert.equal(last.flashesPerSec, 0);
  assert.equal(last.flashRisk, 0);
  last.cellMask.forEach((v, i) => assert.ok(corner.has(i) ? v > 0.95 : v === 0, `cell ${i} = ${v}`));
});

test('area boundary: 11 flashing cells pass, 12 cells (25%) are dangerous', () => {
  const lastFor = (n: number) => run((t, c) => (c < n ? square(t, 5, WHITE, BLACK) : GRAY), 3).at(-1)!;
  assert.equal(lastFor(11).flashesPerSec, 0);
  assert.ok(lastFor(12).flashesPerSec > 3);
});

test('saturated red flash → redRisk > 0', () => {
  const last = run((t) => square(t, 5, RED, BLACK), 3).at(-1)!;
  assert.ok(last.redRisk > 0);
  assert.equal(last.redRisk, 1);
  assert.ok(last.flashesPerSec > 3);
});

test('mask eases in (no jump to 1) and eases out slowly after flashing stops', () => {
  // 5 Hz flash for 2 s, then steady gray for 5 s.
  const rs = run((t) => (t < 2000 ? square(t, 5, WHITE, BLACK) : GRAY), 7);
  const m = rs.map((r) => r.cellMask[0]!);
  const firstOn = m.findIndex((v) => v > 0);
  assert.ok(firstOn > 0);
  assert.ok(m[firstOn]! < 0.6, `first step ${m[firstOn]}`);
  // Attack: monotonic rise to near 1 within a few frames.
  let i = firstOn;
  while (m[i]! < 0.9) {
    assert.ok(m[i + 1]! >= m[i]!);
    i++;
  }
  assert.ok(i - firstOn >= 2 && i - firstOn <= 6, `attack took ${i - firstOn} frames`);
  // Release: never drops more than 0.1 per frame, and is back to 0 by the end.
  for (let k = 1; k < m.length; k++) assert.ok(m[k - 1]! - m[k]! < 0.1, `drop at frame ${k}`);
  assert.equal(m.at(-1), 0);
  // Still mostly damped half a second after the flashing stopped (slow release).
  assert.ok(m[Math.round(2.5 * 30)]! > 0.5);
});

test('areaRate is the 12th-highest per-cell rate', () => {
  const rates = Array.from({ length: CELL_COUNT }, (_, i) => i); // 0..47
  assert.equal(areaRate(rates), 36);
});
