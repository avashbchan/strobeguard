import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameQuality, maskField, scoreClip, summarize, trailStats, type ClipFrame } from './metrics.ts';
import { CELL_COUNT } from '../types.ts';

const W = 64;
const H = 32;
type RGB = [number, number, number];

/** A colourful test picture: horizontal hue ramp, vertical brightness ramp, sharp stripes. */
function picture(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const stripe = x % 8 < 4 ? 1 : 0.6;
      const v = (0.4 + 0.6 * (y / H)) * stripe;
      px[i] = 255 * v * (x < W / 2 ? 1 : 0.2);
      px[i + 1] = 255 * v * 0.3;
      px[i + 2] = 255 * v * (x < W / 2 ? 0.2 : 1);
      px[i + 3] = 255;
    }
  }
  return px;
}
function map(src: Uint8ClampedArray, f: (rgb: RGB, x: number, y: number) => RGB): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const [r, g, b] = f([src[i]!, src[i + 1]!, src[i + 2]!], x, y);
    out.set([r, g, b, 255], i);
  }
  return out;
}
const NONE = new Array<number>(CELL_COUNT).fill(0);
const FULL = new Array<number>(CELL_COUNT).fill(1);
const grey = ([r, g, b]: RGB): RGB => { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; return [l, l, l]; };
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

test('identical output: no damage anywhere, score 100', () => {
  const p = picture();
  const q = frameQuality(p, p, W, H, NONE);
  assert.equal(q.all.dE, 0);
  assert.ok(near(q.all.chromaRatio, 1, 1e-9) && near(q.all.edgeRatio, 1, 1e-9) && near(q.ssim, 1, 1e-9));
  assert.equal(q.all.ghost, 0);
  assert.equal(q.untouched.share, 1);
  const frames: ClipFrame[] = Array.from({ length: 10 }, () => ({ quality: q, inRate: 0, outRate: 0, outRed: 0 }));
  const s = scoreClip(summarize(frames, 30));
  assert.equal(s.score, 100);
  assert.equal(s.safe, true);
});

test('greyscaling is caught by chroma retention and greyed share', () => {
  const p = picture();
  const q = frameQuality(p, map(p, grey), W, H, FULL);
  assert.ok(q.all.chromaRatio < 0.1, `chroma ${q.all.chromaRatio}`);
  assert.ok(q.all.greyed > 0.9);
  assert.ok(q.filtered.share === 1 && q.untouched.share === 0);
});

test('dimming ("mud") lowers lightRatio; a grey veil raises blackLift', () => {
  const p = picture();
  const dim = frameQuality(p, map(p, ([r, g, b]) => [r * 0.4, g * 0.4, b * 0.4]), W, H, FULL);
  assert.ok(dim.all.lightRatio < 0.8);
  const veil = frameQuality(p, map(p, ([r, g, b]) => [r * 0.6 + 70, g * 0.6 + 70, b * 0.6 + 70]), W, H, FULL);
  assert.ok(veil.all.blackLift > 0.1, `lift ${veil.all.blackLift}`);
  assert.ok(veil.all.contrastRatio < 0.8);
});

test('blur lowers edge energy and SSIM; added streaks count as ghost', () => {
  const p = picture();
  const blur = map(p, (_rgb, x, y) => {
    const s = [0, 0, 0];
    for (let d = -3; d <= 3; d++) { const xx = Math.min(W - 1, Math.max(0, x + d)); const i = (y * W + xx) * 4; s[0]! += p[i]!; s[1]! += p[i + 1]!; s[2]! += p[i + 2]!; }
    return [s[0]! / 7, s[1]! / 7, s[2]! / 7];
  });
  const qb = frameQuality(p, blur, W, H, FULL);
  assert.ok(qb.all.edgeRatio < 0.6, `edges ${qb.all.edgeRatio}`);
  assert.ok(qb.ssim < 0.95);
  const streak = map(p, (rgb, _x, y) => (y % 6 === 0 ? [255, 255, 255] : rgb));
  assert.ok(frameQuality(p, streak, W, H, FULL).all.ghost > 0.3);
});

test('hue rotation (red↔blue swap) is caught as hue shift', () => {
  const p = picture();
  const q = frameQuality(p, map(p, ([r, g, b]) => [b, g, r]), W, H, FULL);
  assert.ok(q.all.hueShift > 60, `hue ${q.all.hueShift}`);
});

test('regions: changes inside the masked area are not counted as collateral', () => {
  const p = picture();
  const mask = NONE.slice();
  for (let c = 0; c < 4; c++) for (let r = 0; r < 6; r++) mask[r * 8 + c] = 1; // left half damped
  const out = map(p, (rgb, x) => (x < W / 2 - 8 ? grey(rgb) : rgb)); // change well inside the left half
  const q = frameQuality(p, out, W, H, mask);
  assert.ok(q.untouched.dE < 0.01, `collateral ${q.untouched.dE}`);
  assert.ok(q.filtered.chromaRatio < 0.5);
});

test('maskField interpolates between cell centres like the renderer', () => {
  const mask = NONE.slice();
  mask[0] = 1; // top-left cell only
  const f = maskField(mask, 80, 60);
  assert.ok(f[2 * 80 + 2]! > 0.99); // between the edge and cell 0's centre: full weight
  assert.ok(f[5 * 80 + 5]! < 1 && f[5 * 80 + 5]! > 0.8); // just past the centre: starts fading
  assert.equal(f[59 * 80 + 79], 0); // far corner
});

test('safety gate fails when the output keeps flashing', () => {
  const p = picture();
  const q = frameQuality(p, p, W, H, NONE);
  const frames: ClipFrame[] = Array.from({ length: 60 }, () => ({ quality: q, inRate: 5, outRate: 5, outRed: 0 }));
  assert.equal(scoreClip(summarize(frames, 30)).safe, false);
});

// ---------- trail and lag ----------

const TW = 64;
const TH = 32;
/** A frame with a bright 12×12 box at x on a textured dark background (texture so blocks have structure). */
function boxFrame(x: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(TW * TH * 4);
  for (let y = 0; y < TH; y++) for (let xx = 0; xx < TW; xx++) {
    const i = (y * TW + xx) * 4;
    const bg = 30 + ((xx * 7 + y * 13) % 24);
    const inBox = xx >= x && xx < x + 12 && y >= 10 && y < 22;
    const v = inBox ? 230 - ((xx + y) % 3) * 20 : bg;
    px[i] = v; px[i + 1] = v * 0.8; px[i + 2] = v * 0.6; px[i + 3] = 255;
  }
  return px;
}
const mix = (a: Uint8ClampedArray, b: Uint8ClampedArray, t: number) => a.map((v, i) => (i % 4 === 3 ? 255 : v * (1 - t) + b[i]! * t));
const toLin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb8 = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
/** Gain in linear light, like a filter that scales light (the reference behaviour). */
const gain = (a: Uint8ClampedArray, g: number) => a.map((v, i) => (i % 4 === 3 ? 255 : toSrgb8(g * toLin(v))));
/** Gain plus a small neutral offset, in linear light. */
const gainOffset = (a: Uint8ClampedArray, g: number, off: number) => a.map((v, i) => (i % 4 === 3 ? 255 : toSrgb8(g * toLin(v) + off)));

test('trail: a pure gain (a flash filter that only dims) leaves no trail; neither does a gain plus offset', () => {
  const cur = boxFrame(30), prev = [boxFrame(26), boxFrame(22)];
  const dim = trailStats(cur, gain(cur, 0.5), TW, TH, FULL, prev);
  assert.ok(dim.blocks > 0 && dim.trail < 0.05, `trail ${dim.trail}`);
  const veiled = trailStats(cur, gainOffset(cur, 0.6, 0.04), TW, TH, FULL, prev);
  assert.ok(veiled.trail < 0.05, `veiled ${veiled.trail}`);
  assert.ok(dim.lag < 0.1);
});

test('trail: blending in the previous frame (a smeared object) shows up as a trail', () => {
  const cur = boxFrame(30), p1 = boxFrame(24);
  const smeared = trailStats(cur, gain(mix(cur, p1, 0.5), 0.7), TW, TH, FULL, [p1, boxFrame(18)]);
  const clean = trailStats(cur, gain(cur, 0.7), TW, TH, FULL, [p1, boxFrame(18)]);
  assert.ok(smeared.trail > 0.05 && smeared.trail > 5 * clean.trail, `smeared ${smeared.trail} clean ${clean.trail}`);
});

test('lag: an output that is a delayed copy of the input is explained by the earlier frame', () => {
  const prev = [boxFrame(26), boxFrame(22), boxFrame(18)];
  const lagging = trailStats(boxFrame(30), gain(prev[1]!, 0.6), TW, TH, FULL, prev); // output shows the frame two steps back
  assert.ok(lagging.motionBlocks > 0 && lagging.lag > 0.8, `lag ${lagging.lag}`);
  const onTime = trailStats(boxFrame(30), gain(boxFrame(30), 0.6), TW, TH, FULL, prev);
  assert.ok(onTime.lag < 0.1, `on time ${onTime.lag}`);
});

test('trail only counts the filtered area', () => {
  const cur = boxFrame(30), p1 = boxFrame(24);
  const smeared = mix(cur, p1, 0.5);
  const untouched = trailStats(cur, smeared, TW, TH, NONE, [p1]);
  assert.equal(untouched.blocks, 0);
  assert.equal(untouched.trail, 0);
});
