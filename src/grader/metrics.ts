// Objective output-quality metrics: compare an output frame with the exact input frame it shows.
// Pure (no DOM): works on RGBA byte arrays so it can be unit-tested.
//
// Everything is measured in OKLab (perceptual lightness L 0–1, colour a/b), split by region:
//   untouched — mask < 0.02: the filter should leave these pixels EXACTLY as they were
//   filtered  — mask ≥ 0.3:  some change is expected here; we measure how much is lost doing it
//   all       — every pixel
// What each metric catches:
//   dE            mean perceptual colour difference ×100 (≈1 just noticeable, ≥5 clearly visible)
//   chromaRatio   output colourfulness / input colourfulness (greyscaling → < 1)
//   greyed        share of colourful pixels that lost more than half their chroma
//   hueShift      chroma-weighted mean hue change, degrees (e.g. orange fire turning cyan)
//   lightRatio    mean lightness out / in (dimming, "mud" → < 1)
//   blackLift     5th-percentile lightness out − in (grey haze / veil → > 0)
//   contrastRatio lightness spread out / in (flattening → < 1)
//   edgeRatio     edge energy out / in (blur → < 1)
//   ghost         edge energy present in the output but not the input, / input edges (trails, smears)
//   ssim          structural similarity of lightness, 8×8 blocks (1 = identical structure)
//   trail         structure in the output that the current input doesn't explain: per 8×8 block of the filtered
//                 area, the output is fitted to the current input with the best gain and offset (what a flash
//                 filter should do); the leftover, relative to the output's own contrast, is a trail (0 = none)
//   lag           of the blocks where the input is moving, the share whose output is better explained by an
//                 EARLIER input frame than the current one (the output is running behind the picture)

import { GRID_COLS, GRID_ROWS } from '../types.ts';

const LINEAR: Float32Array = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export type Oklab = { L: Float32Array; a: Float32Array; b: Float32Array };

/** sRGB bytes → OKLab (Björn Ottosson's matrices). */
export function toOklab(rgba: ArrayLike<number>, pixels: number): Oklab {
  const L = new Float32Array(pixels);
  const a = new Float32Array(pixels);
  const b = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const r = LINEAR[rgba[i * 4] ?? 0]!;
    const g = LINEAR[rgba[i * 4 + 1] ?? 0]!;
    const bl = LINEAR[rgba[i * 4 + 2] ?? 0]!;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    a[i] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    b[i] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  return { L, a, b };
}

/** Per-pixel damping weight, bilinear between cell centres like the renderer's LINEAR mask texture. */
export function maskField(mask: readonly number[], w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const at = (c: number, r: number) =>
    mask[Math.min(GRID_ROWS - 1, Math.max(0, r)) * GRID_COLS + Math.min(GRID_COLS - 1, Math.max(0, c))] ?? 0;
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) / h) * GRID_ROWS - 0.5;
    const r0 = Math.floor(fy);
    const ty = fy - r0;
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) / w) * GRID_COLS - 0.5;
      const c0 = Math.floor(fx);
      const tx = fx - c0;
      const top = at(c0, r0) * (1 - tx) + at(c0 + 1, r0) * tx;
      const bot = at(c0, r0 + 1) * (1 - tx) + at(c0 + 1, r0 + 1) * tx;
      out[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

export type RegionStats = {
  share: number; // fraction of the frame in this region
  dE: number;
  chromaRatio: number;
  greyed: number;
  hueShift: number;
  lightRatio: number;
  blackLift: number;
  contrastRatio: number;
  edgeRatio: number;
  ghost: number;
};
export type TrailStats = { trail: number; lag: number; blocks: number; motionBlocks: number };
export type FrameQuality = { all: RegionStats; untouched: RegionStats; filtered: RegionStats; ssim: number; trails: TrailStats };

export const UNTOUCHED_BELOW = 0.02;
export const FILTERED_FROM = 0.3;
const CHROMATIC = 0.05; // OKLab chroma above which a pixel counts as colourful

class Acc {
  n = 0; dE = 0; cIn = 0; cOut = 0; colourful = 0; greyed = 0; hueW = 0; hueSum = 0;
  lIn = 0; lOut = 0; l2In = 0; l2Out = 0; gIn = 0; gOut = 0; ghost = 0;
  histIn = new Uint32Array(256); histOut = new Uint32Array(256);
}

function p5(hist: Uint32Array, n: number): number {
  let seen = 0;
  for (let i = 0; i < 256; i++) {
    seen += hist[i]!;
    if (seen >= n * 0.05) return i / 255;
  }
  return 1;
}

function finish(acc: Acc, total: number): RegionStats {
  const n = Math.max(acc.n, 1);
  const sdIn = Math.sqrt(Math.max(acc.l2In / n - (acc.lIn / n) ** 2, 0));
  const sdOut = Math.sqrt(Math.max(acc.l2Out / n - (acc.lOut / n) ** 2, 0));
  return {
    share: acc.n / total,
    dE: (acc.dE / n) * 100,
    chromaRatio: acc.cIn > 1e-6 ? acc.cOut / acc.cIn : 1,
    greyed: acc.colourful ? acc.greyed / acc.colourful : 0,
    hueShift: acc.hueW > 1e-6 ? acc.hueSum / acc.hueW : 0,
    lightRatio: acc.lIn > 1e-6 ? acc.lOut / acc.lIn : 1,
    blackLift: acc.n ? p5(acc.histOut, acc.n) - p5(acc.histIn, acc.n) : 0,
    contrastRatio: sdIn > 1e-4 ? sdOut / sdIn : 1,
    edgeRatio: acc.gIn > 1e-6 ? acc.gOut / acc.gIn : 1,
    ghost: acc.gIn > 1e-6 ? acc.ghost / acc.gIn : 0,
  };
}

/** SSIM of lightness over non-overlapping 8×8 blocks, averaged. */
export function ssim(Lin: Float32Array, Lout: Float32Array, w: number, h: number): number {
  const C1 = 0.01 ** 2;
  const C2 = 0.03 ** 2;
  let sum = 0;
  let blocks = 0;
  for (let by = 0; by + 8 <= h; by += 8) {
    for (let bx = 0; bx + 8 <= w; bx += 8) {
      let mx = 0, my = 0;
      for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { mx += Lin[y * w + x]!; my += Lout[y * w + x]!; }
      mx /= 64; my /= 64;
      let vx = 0, vy = 0, cov = 0;
      for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) {
        const dx = Lin[y * w + x]! - mx;
        const dy = Lout[y * w + x]! - my;
        vx += dx * dx; vy += dy * dy; cov += dx * dy;
      }
      vx /= 63; vy /= 63; cov /= 63;
      sum += ((2 * mx * my + C1) * (2 * cov + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
      blocks++;
    }
  }
  return blocks ? sum / blocks : 1;
}

const BLOCK = 8;
const MOTION_RMS = 0.02; // linear-luminance change between consecutive input frames that counts as moving
const LAG_GAIN = 0.8; // an earlier frame must leave under 80% of the current frame's residual to win
/** Linear-luminance structure below this RMS is invisible (and is mostly 8-bit rounding), so it adds no weight. */
const NOISE_RMS = 0.01;
const NOISE_ENERGY = BLOCK * BLOCK * NOISE_RMS * NOISE_RMS;

const lumaCache = new WeakMap<object, Float32Array>(); // earlier frames are passed again on later calls

/** Linear luminance (0–1) of an RGBA frame (cached per frame object). */
function linearLuma(rgba: ArrayLike<number>, pixels: number): Float32Array {
  const hit = lumaCache.get(rgba);
  if (hit && hit.length === pixels) return hit;
  const y = new Float32Array(pixels);
  lumaCache.set(rgba, y);
  for (let i = 0; i < pixels; i++) y[i] = 0.2126 * LINEAR[rgba[i * 4] ?? 0]! + 0.7152 * LINEAR[rgba[i * 4 + 1] ?? 0]! + 0.0722 * LINEAR[rgba[i * 4 + 2] ?? 0]!;
  return y;
}

/** Residual energy (sum of squares) of fitting o ≈ a·x + b over one block, and the block's total output energy. */
function affineResidual(o: Float32Array, x: Float32Array, w: number, bx: number, by: number): { res: number; energy: number } {
  const n = BLOCK * BLOCK;
  let mo = 0, mx = 0;
  for (let y = by; y < by + BLOCK; y++) for (let xx = bx; xx < bx + BLOCK; xx++) { mo += o[y * w + xx]!; mx += x[y * w + xx]!; }
  mo /= n; mx /= n;
  let vxx = 0, vxo = 0, voo = 0;
  for (let y = by; y < by + BLOCK; y++) for (let xx = bx; xx < bx + BLOCK; xx++) {
    const dx = x[y * w + xx]! - mx, d = o[y * w + xx]! - mo;
    vxx += dx * dx; vxo += dx * d; voo += d * d;
  }
  const a = vxx > 1e-9 ? vxo / vxx : 0;
  return { res: Math.max(0, voo - a * vxo), energy: voo };
}

/**
 * Trail and lag (see the header). `prev` = earlier input frames, newest first (prev[0] is one frame back).
 * Only blocks mostly inside the filtered area (mask ≥ FILTERED_FROM) count.
 */
export function trailStats(input: ArrayLike<number>, output: ArrayLike<number>, w: number, h: number, mask: readonly number[], prev: ArrayLike<number>[] = []): TrailStats {
  const px = w * h;
  const C = linearLuma(input, px), O = linearLuma(output, px);
  const P = prev.map((p) => linearLuma(p, px));
  const m = maskField(mask, w, h);
  let blocks = 0, motionBlocks = 0, trailSum = 0, lagged = 0;
  for (let by = 0; by + BLOCK <= h; by += BLOCK) {
    for (let bx = 0; bx + BLOCK <= w; bx += BLOCK) {
      let mm = 0;
      for (let y = by; y < by + BLOCK; y++) for (let x = bx; x < bx + BLOCK; x++) mm += m[y * w + x]!;
      if (mm / (BLOCK * BLOCK) < FILTERED_FROM) continue;
      const cur = affineResidual(O, C, w, bx, by);
      if (cur.energy < NOISE_ENERGY) continue; // a flat output block has no structure to explain
      blocks++;
      trailSum += Math.sqrt(Math.max(0, cur.res - NOISE_ENERGY * 0.5) / cur.energy);
      const p1 = P[0];
      if (!p1) continue;
      let moved = 0;
      for (let y = by; y < by + BLOCK; y++) for (let x = bx; x < bx + BLOCK; x++) { const d = C[y * w + x]! - p1[y * w + x]!; moved += d * d; }
      if (Math.sqrt(moved / (BLOCK * BLOCK)) < MOTION_RMS) continue;
      motionBlocks++;
      let best = cur.res;
      for (const p of P) best = Math.min(best, affineResidual(O, p, w, bx, by).res);
      if (best < LAG_GAIN * cur.res && cur.res > NOISE_ENERGY) lagged++;
    }
  }
  return { trail: blocks ? trailSum / blocks : 0, lag: motionBlocks ? lagged / motionBlocks : 0, blocks, motionBlocks };
}

/** Compare one output frame with the input frame it displays. `mask` = the 48 damping values used; `prev` = earlier input frames, newest first. */
export function frameQuality(input: ArrayLike<number>, output: ArrayLike<number>, w: number, h: number, mask: readonly number[], prev: ArrayLike<number>[] = []): FrameQuality {
  const px = w * h;
  const A = toOklab(input, px);
  const B = toOklab(output, px);
  const m = maskField(mask, w, h);
  const all = new Acc();
  const untouched = new Acc();
  const filtered = new Acc();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lI = A.L[i]!, lO = B.L[i]!;
      const cI = Math.hypot(A.a[i]!, A.b[i]!);
      const cO = Math.hypot(B.a[i]!, B.b[i]!);
      const dE = Math.hypot(lO - lI, B.a[i]! - A.a[i]!, B.b[i]! - A.b[i]!);
      // Edge strength: forward differences (0 at the right/bottom border).
      const gI = (x + 1 < w ? Math.abs(A.L[i + 1]! - lI) : 0) + (y + 1 < h ? Math.abs(A.L[i + w]! - lI) : 0);
      const gO = (x + 1 < w ? Math.abs(B.L[i + 1]! - lO) : 0) + (y + 1 < h ? Math.abs(B.L[i + w]! - lO) : 0);
      let hue = 0;
      if (cI > CHROMATIC && cO > 0.02) {
        hue = Math.abs(Math.atan2(B.b[i]!, B.a[i]!) - Math.atan2(A.b[i]!, A.a[i]!));
        if (hue > Math.PI) hue = 2 * Math.PI - hue;
      }
      const mv = m[i]!;
      for (const acc of [all, mv < UNTOUCHED_BELOW ? untouched : null, mv >= FILTERED_FROM ? filtered : null]) {
        if (!acc) continue;
        acc.n++;
        acc.dE += dE;
        acc.cIn += cI; acc.cOut += cO;
        if (cI > CHROMATIC) {
          acc.colourful++;
          if (cO < 0.5 * cI) acc.greyed++;
          if (cO > 0.02) { acc.hueW += cI; acc.hueSum += cI * (hue * 180) / Math.PI; }
        }
        acc.lIn += lI; acc.lOut += lO; acc.l2In += lI * lI; acc.l2Out += lO * lO;
        acc.gIn += gI; acc.gOut += gO; acc.ghost += Math.max(0, gO - gI);
        acc.histIn[Math.min(255, Math.max(0, Math.round(lI * 255)))]!++;
        acc.histOut[Math.min(255, Math.max(0, Math.round(lO * 255)))]!++;
      }
    }
  }
  return { all: finish(all, px), untouched: finish(untouched, px), filtered: finish(filtered, px), ssim: ssim(A.L, B.L, w, h), trails: trailStats(input, output, w, h, mask, prev) };
}

// ---------- Clip summary and score ----------

export type ClipFrame = { quality: FrameQuality; inRate: number; outRate: number; outRed: number };
type Avg = Omit<RegionStats, 'share'> & { share: number; frames: number };
export type ClipSummary = {
  frames: number;
  all: Avg; untouched: Avg; filtered: Avg; ssim: number;
  /** Mean trail and lag over frames that had filtered blocks (moving blocks for lag); see trailStats. */
  trails: { trail: number; lag: number; frames: number };
  safety: { inRateMax: number; outRateMax: number; outOver3Seconds: number; outRedMax: number; inOver3Seconds: number };
};

const KEYS = ['share', 'dE', 'chromaRatio', 'greyed', 'hueShift', 'lightRatio', 'blackLift', 'contrastRatio', 'edgeRatio', 'ghost'] as const;

/** Averages per-frame stats (a region only counts in frames where it covers ≥ 1% of the picture). */
export function summarize(frames: ClipFrame[], fps: number): ClipSummary {
  const avg = (region: 'all' | 'untouched' | 'filtered'): Avg => {
    const use = frames.filter((f) => f.quality[region].share >= 0.01);
    const out = { frames: use.length } as Avg;
    for (const k of KEYS) out[k] = use.length ? use.reduce((s, f) => s + f.quality[region][k], 0) / use.length : 0;
    return out;
  };
  return {
    frames: frames.length,
    all: avg('all'), untouched: avg('untouched'), filtered: avg('filtered'),
    ssim: frames.length ? frames.reduce((s, f) => s + f.quality.ssim, 0) / frames.length : 1,
    trails: (() => {
      const t = frames.filter((f) => f.quality.trails.blocks > 0);
      const l = frames.filter((f) => f.quality.trails.motionBlocks > 0);
      return {
        trail: t.length ? t.reduce((a, f) => a + f.quality.trails.trail, 0) / t.length : 0,
        lag: l.length ? l.reduce((a, f) => a + f.quality.trails.lag, 0) / l.length : 0,
        frames: t.length,
      };
    })(),
    safety: {
      inRateMax: Math.max(0, ...frames.map((f) => f.inRate)),
      outRateMax: Math.max(0, ...frames.map((f) => f.outRate)),
      inOver3Seconds: frames.filter((f) => f.inRate > 3).length / fps,
      outOver3Seconds: frames.filter((f) => f.outRate > 3).length / fps,
      outRedMax: Math.max(0, ...frames.map((f) => f.outRed)),
    },
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Quality score 0–100 (100 = output identical to input), plus each part's 0–1 value.
 * Weights favour what viewers notice most: collateral changes, colour, and structure/clarity.
 * Safety is reported separately as a pass/fail gate: a change that scores higher but lets
 * flashes through is not an improvement.
 */
export function scoreClip(s: ClipSummary): { score: number; safe: boolean; parts: Record<string, number> } {
  const a = s.all;
  const parts = {
    collateral: s.untouched.frames ? clamp01(1 - s.untouched.dE / 5) : 1,               // untouched areas unchanged
    colour: clamp01(Math.min(a.chromaRatio, 1) * (1 - a.greyed)),                        // no greyscaling
    hue: clamp01(1 - a.hueShift / 30),                                                   // no colour shifts
    structure: clamp01((s.ssim - 0.5) / 0.5),                                            // SSIM
    clarity: clamp01(Math.min(a.edgeRatio, 1) - a.ghost),                                // sharp, no trails
    tone: clamp01(1 - Math.abs(1 - a.lightRatio) * 2 - Math.max(0, a.blackLift) * 5),    // no mud, no haze
  };
  const weights = { collateral: 25, colour: 20, hue: 10, structure: 20, clarity: 15, tone: 10 };
  let score = 0;
  for (const k of Object.keys(weights) as (keyof typeof weights)[]) score += weights[k] * parts[k];
  // Safe = the output is over the 3 flashes/s line for at most 0.5 s in total (the onset, before
  // damping engages) and never shows full red-flash risk.
  const safe = s.safety.outOver3Seconds <= 0.5 && s.safety.outRedMax < 1;
  return { score: Math.round(score * 10) / 10, safe, parts };
}
