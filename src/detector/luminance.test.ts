import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellSignals, isSaturatedRed, relativeLuminance, srgbToLinear } from './luminance.ts';
import { CELL_COUNT } from '../types.ts';

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

test('srgbToLinear endpoints and mid gray', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.ok(near(srgbToLinear(1), 1));
  assert.ok(near(srgbToLinear(0.5), 0.214)); // sRGB 50% ≈ 21.4% linear light
  assert.ok(near(srgbToLinear(0.04), 0.04 / 12.92, 1e-9)); // linear segment
});

test('relativeLuminance uses Rec. 709 weights', () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.ok(near(relativeLuminance(255, 255, 255), 1));
  assert.ok(near(relativeLuminance(255, 0, 0), 0.2126));
  assert.ok(near(relativeLuminance(0, 255, 0), 0.7152));
  assert.ok(near(relativeLuminance(0, 0, 255), 0.0722));
});

test('isSaturatedRed', () => {
  assert.equal(isSaturatedRed(255, 0, 0), true);
  assert.equal(isSaturatedRed(200, 30, 30), true);
  assert.equal(isSaturatedRed(255, 255, 255), false);
  assert.equal(isSaturatedRed(255, 165, 0), false); // orange: linear ratio ≈ 0.73
  assert.equal(isSaturatedRed(255, 128, 0), true); // red-orange: linear ratio ≈ 0.82
  assert.equal(isSaturatedRed(40, 0, 0), false); // too dark to matter
});

test('cellSignals: row 0 is the top, index = row * 8 + col', () => {
  const w = 64;
  const h = 36;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // Top-left cell (x 0–7, y 0–5) white; bottom-right cell (x 56–63, y 30–35) pure red.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < 8 && y < 6) rgba.set([255, 255, 255, 255], i);
      else if (x >= 56 && y >= 30) rgba.set([255, 0, 0, 255], i);
      else rgba.set([0, 0, 0, 255], i);
    }
  }
  const { lum, red } = cellSignals(rgba, w, h);
  assert.equal(lum.length, CELL_COUNT);
  assert.ok(near(lum[0]!, 1));
  assert.ok(near(lum[47]!, 0.2126));
  assert.equal(red[47], 1);
  assert.equal(red[0], 0);
  for (let i = 1; i < 47; i++) assert.equal(lum[i], 0);
});
