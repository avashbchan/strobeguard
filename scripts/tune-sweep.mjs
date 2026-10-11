// Tries detector tuning constants on the TUNING clips only and prints one row per combination.
//
//   node scripts/tune-sweep.mjs [--split=results/split.json] [--dir=clips-small] [--out=results/tune-sweep.txt]
//
// Allowed knobs (src/detector/risk.ts): where the cellTarget ramp starts and how steep it is (luminance and red),
// ATTACK_MS, and RELEASE_MS. The WCAG constants and the 1 s window are never touched. Each combination runs on a
// temporary copy of src/detector with the constants replaced, so the repo's risk.ts is not edited by the sweep.
// Constraints checked per row: recall 100% on the tuning set, and false damping no more than +0.5 s per safe
// minute over the baseline (the repo's current constants, row "base").

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clipId, clipMetrics, decodeClip, dampedFlags, displayedDamped, loadDetector, readLabels, totals } from './eval-video.mjs';

const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SPLIT = opt('split') ?? 'results/split.json';
const DIR = resolve(opt('dir') ?? 'clips-small');
const OUT = opt('out') ?? 'results/tune-sweep.txt';
const FPS = 30;
const REPO = resolve(import.meta.dirname, '..');

// [label, lumStart, lumSlope, redStart, redSlope, attackMs, releaseMs]; the first row must be the current constants.
const COMBOS = [
  ['base', 2.5, 2, 1.5, 2, 60, 600],
  ['attack 30', 2.5, 2, 1.5, 2, 30, 600],
  ['attack 15', 2.5, 2, 1.5, 2, 15, 600],
  ['lum start 2.25', 2.25, 2, 1.5, 2, 60, 600],
  ['lum start 2.0', 2.0, 2, 1.5, 2, 60, 600],
  ['lum slope 4', 2.5, 4, 1.5, 2, 60, 600],
  ['lum 2.25 / slope 4', 2.25, 4, 1.5, 2, 60, 600],
  ['lum 2.0 / slope 4', 2.0, 4, 1.5, 2, 60, 600],
  ['red start 1.0', 2.5, 2, 1.0, 2, 60, 600],
  ['red slope 4', 2.5, 2, 1.5, 4, 60, 600],
  ['attack 30 + lum 2.25', 2.25, 2, 1.5, 2, 30, 600],
  ['attack 30 + slope 4', 2.5, 4, 1.5, 2, 30, 600],
  ['attack 30 + 2.25 / 4', 2.25, 4, 1.5, 2, 30, 600],
  ['release 400', 2.5, 2, 1.5, 2, 60, 400],
  ['release 900', 2.5, 2, 1.5, 2, 60, 900],
  ['lum start 2.75 + att 30', 2.75, 2, 1.5, 2, 30, 600],
  ['lum start 3.0 + att 30', 3.0, 2, 1.5, 2, 30, 600],
  // finer ramp starts between 2.25 (catches the 0.2 s blip, too much false damping) and 2.5 (base)
  ['lum start 2.4', 2.4, 2, 1.5, 2, 60, 600],
  ['lum start 2.3', 2.3, 2, 1.5, 2, 60, 600],
  ['lum 2.25 / slope 1.5', 2.25, 1.5, 1.5, 2, 60, 600],
];

/** Copies src/detector + src/types.ts to a temp dir with the given constants. Returns the detector dir. */
function patchedDetector(root, [, lumStart, lumSlope, redStart, redSlope, attack, release]) {
  mkdirSync(join(root, 'src'), { recursive: true });
  cpSync(join(REPO, 'src', 'detector'), join(root, 'src', 'detector'), { recursive: true });
  cpSync(join(REPO, 'src', 'types.ts'), join(root, 'src', 'types.ts'));
  const p = join(root, 'src', 'detector', 'risk.ts');
  let s = readFileSync(p, 'utf8');
  const rep = (re, to) => {
    if (!re.test(s)) throw new Error(`risk.ts no longer matches ${re}; update tune-sweep.mjs`);
    s = s.replace(re, to);
  };
  rep(/clamp01\(\(flashRate - [\d.]+\) \* [\d.]+\)/, `clamp01((flashRate - ${lumStart}) * ${lumSlope})`);
  rep(/clamp01\(\(redRate - [\d.]+\) \* [\d.]+\)/, `clamp01((redRate - ${redStart}) * ${redSlope})`);
  rep(/export const ATTACK_MS = [\d.]+;/, `export const ATTACK_MS = ${attack};`);
  rep(/export const RELEASE_MS = [\d.]+;/, `export const RELEASE_MS = ${release};`);
  writeFileSync(p, s);
  return join(root, 'src', 'detector');
}

const split = JSON.parse(readFileSync(SPLIT, 'utf8'));
const files = readdirSync(DIR).filter((f) => /\.mp4$/i.test(f)).map((f) => join(DIR, f));
const tuning = files.filter((f) => split.tuning.includes(clipId(f)));
if (tuning.length !== split.tuning.length) throw new Error(`found ${tuning.length} of ${split.tuning.length} tuning clips in ${DIR}`);

console.log(`decoding ${tuning.length} tuning clips …`);
const decoded = tuning.map((f) => ({ id: clipId(f), labels: readLabels(f), frames: decodeClip(f, FPS) }));

const tmp = mkdtempSync(join(tmpdir(), 'sg-sweep-'));
const lines = [];
const say = (l) => { console.log(l); lines.push(l); };
say(`tune-sweep on the tuning set (${tuning.length} clips: ${split.tuning.join(', ')}), fps ${FPS}`);
say(['combination'.padEnd(26), 'lum start/slope', 'red start/slope', 'attack', 'release', 'recall'.padStart(12), 'false/m'.padStart(8), 'strict/m'.padStart(8), 'undamp μ'.padStart(8), 'worst'.padStart(5), 'missed'.padStart(6), ' ok?'].join(' '));
let base = null;
const results = [];
try {
  for (const [i, combo] of COMBOS.entries()) {
    const det = await loadDetector(patchedDetector(join(tmp, String(i)), combo));
    const metrics = decoded.map((c) => clipMetrics(displayedDamped(dampedFlags(c.frames, FPS, det)), FPS, c.labels));
    const t = totals(metrics);
    if (!base) base = t;
    const ok = t.recall === 1 && t.falsePerSafeMinute <= base.falsePerSafeMinute + 0.5 + 1e-9;
    results.push({ combo, t, ok, metrics });
    const [label, ls, lsl, rs, rsl, att, rel] = combo;
    say([
      label.padEnd(26), `${ls} / ${lsl}`.padEnd(15), `${rs} / ${rsl}`.padEnd(15), String(att).padStart(6), String(rel).padStart(7),
      `${(100 * t.recall).toFixed(0)}% (${t.hitSeconds}/${t.dangerSeconds})`.padStart(12), t.falsePerSafeMinute.toFixed(2).padStart(8), t.strictFalsePerSafeMinute.toFixed(2).padStart(8),
      t.undamped.mean.toFixed(2).padStart(8), String(t.undamped.worst).padStart(5), String(t.missedEvents).padStart(6), ok ? '  yes' : '  NO',
    ].join(' '));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
say(`\nconstraints: recall 100% and false damping ≤ base + 0.5 = ${(base.falsePerSafeMinute + 0.5).toFixed(2)} s per safe minute`);
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`wrote ${OUT}`);

// --ratio=id1,id2,…: per-clip trade-off against "base": flash frames saved per extra second of false damping.
const RATIO = opt('ratio')?.split(',');
if (RATIO) {
  const out = [];
  const sayR = (l) => { console.log(l); out.push(l); };
  sayR(`\nper-clip trade-off vs base (tuning clips ${RATIO.join(', ')}): frames saved = fewer undamped frames summed over the clip's events;`);
  sayR(`extra false = more false-damping seconds (settle margin). ratio = frames saved per extra false second.`);
  for (const id of RATIO) {
    const k = decoded.findIndex((c) => c.id === id);
    if (k < 0) { sayR(`\n${id}: not in the tuning set`); continue; }
    const b = results[0].metrics[k];
    const sumU = (m) => m.events.reduce((a, e) => a + e.undamped, 0);
    sayR(`\n${id}: ${b.events.length} events, ${b.dangerSeconds} labelled whole seconds, ${b.safeSeconds} safe seconds`);
    sayR(['  combination'.padEnd(28), 'undamped Σ'.padStart(10), 'worst'.padStart(5), 'missed'.padStart(6), 'false s'.padStart(7), 'saved'.padStart(6), 'extra false'.padStart(11), '  ratio'].join(' '));
    for (const r of results) {
      const m = r.metrics[k];
      const saved = sumU(b) - sumU(m);
      const extra = m.falseSeconds - b.falseSeconds;
      const ratio = saved === 0 && extra === 0 ? 'same' : extra <= 0 && saved >= 0 ? 'better on both' : saved <= 0 && extra >= 0 ? 'worse on both' : extra > 0 ? `${(saved / extra).toFixed(2)} frames per false s` : `${(-extra / -saved).toFixed(2)} false s saved per frame lost`;
      const worst = m.events.length ? Math.max(...m.events.map((e) => e.undamped)) : 0;
      sayR(['  ' + r.combo[0].padEnd(26), String(sumU(m)).padStart(10), String(worst).padStart(5), String(m.events.filter((e) => e.missed).length).padStart(6), String(m.falseSeconds).padStart(7), String(saved).padStart(6), String(extra).padStart(11), '  ' + ratio].join(' '));
    }
  }
  const ratioOut = opt('ratio-out') ?? 'results/tune-ratio.txt';
  writeFileSync(ratioOut, out.join('\n') + '\n');
  console.log(`wrote ${ratioOut}`);
}
