// Measures StrobeGuard's detector on video files against labelled dangerous time ranges.
// No browser and no npm dependencies: ffmpeg decodes each clip to 64×36 RGBA, and every frame is fed
// to the real detector (src/detector/detectorCore.ts).
//
//   node scripts/eval-video.mjs [--fps 30] [--json out.json] [--split split.json] <files or folders…>
//   node scripts/eval-video.mjs --make-synthetic clips-small/synthetic     # the four synthetic clips
//
// A folder means the .mp4 files directly inside it. Labels live next to each clip, as
// <clip>.labels.json = [[startSec, endSec], …]; [] means "never damp". A clip without a labels file is
// listed as unlabelled and left out of the totals.
//
// What is on screen: the renderer shows each frame 14 frames (467 ms) after the detector has seen it,
// so displayed frame k is filtered with the damping mask computed for frame min(k + 14, last). A
// displayed frame counts as DAMPED when at least 25% of the cells (12 of 48) have damping ≥ 0.8.
//
// Metrics per clip (see the README for details):
//   recall            labelled-dangerous whole seconds in which ≥ 50% of the displayed frames are damped
//   false damping     safe seconds in which any displayed frame is damped, per safe minute. A second is safe if it
//                     is further than SETTLE_BEFORE_S before / SETTLE_AFTER_S after every label: the look-ahead
//                     damps just before an event and the release easing lingers just after it, on purpose. The
//                     strict number (any second touching no label) is reported next to it.
//   undamped / event  displayed frames from the start of each label until the first damped frame
//
// WARNING: the clips flash on purpose. This script only reads pixels; it doesn't play anything.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const W = 64;
export const H = 36;
export const LOOK_AHEAD = 14; // frames between detection and display (renderer delay 467 ms at 30 fps)
export const DAMP_LEVEL = 0.8; // a cell counts as damped at or above this mask value
export const DAMP_CELLS = 12; // 25% of the 48 cells
export const SETTLE_BEFORE_S = 1; // damping this long before a label (look-ahead) is not a false alarm
export const SETTLE_AFTER_S = 2; // nor this long after it (release easing and the 1 s flash window)
const FRAME_BYTES = W * H * 4;

// ---------- small helpers ----------

/** Short, ASCII-only id for a clip: "Screen Recording 2026-10-10 at 4.34.51 AM.mp4" → "4.34.51-AM". */
export function clipId(file) {
  return basename(file, extname(file))
    .replace(/^Screen Recording 2026-10-10( at)?\s*/, '')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '');
}

export function labelsPath(file) {
  return join(file, '..', basename(file, extname(file)) + '.labels.json');
}

export function readLabels(file) {
  const p = labelsPath(file);
  if (!existsSync(p)) return null;
  const ranges = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(ranges) || !ranges.every((r) => Array.isArray(r) && r.length === 2 && r[0] < r[1])) {
    throw new Error(`${p}: expected [[startSec, endSec], …] with start < end`);
  }
  return ranges;
}

function ffmpegBin(name) {
  const env = process.env[name.toUpperCase()];
  if (env) return env;
  const probe = spawnSync(name, ['-version'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0) return name;
  // Fresh winget installs aren't on the PATH of terminals that were already open.
  const root = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (root && existsSync(root)) {
    for (const pkg of readdirSync(root).filter((d) => d.startsWith('Gyan.FFmpeg'))) {
      for (const sub of readdirSync(join(root, pkg))) {
        const exe = join(root, pkg, sub, 'bin', name + '.exe');
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error(`${name} not found. Install it (winget install Gyan.FFmpeg) and open a new terminal, or set ${name.toUpperCase()}=<path>.`);
}

// ---------- decoding and detection ----------

/** Decodes a clip to raw 64×36 RGBA frames at `fps`. Returns { buffer, count }. */
export function decodeClip(file, fps = 30) {
  const r = spawnSync(
    ffmpegBin('ffmpeg'),
    ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H},fps=${fps}`, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
    { maxBuffer: 1 << 30 },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.stderr?.toString().slice(0, 300)}`);
  if (r.stdout.length % FRAME_BYTES) throw new Error(`unexpected ffmpeg output size for ${file}`);
  return { buffer: r.stdout, count: r.stdout.length / FRAME_BYTES };
}

/** Loads a detector core module (default: the repo's). `dir` may be a copy with different constants. */
export async function loadDetector(dir = resolve(import.meta.dirname, '..', 'src', 'detector')) {
  return import(pathToFileURL(join(dir, 'detectorCore.ts')).href);
}

/** Feeds every frame to the detector. Returns 1 where ≥ 12 cells are damped ≥ 0.8, else 0, per input frame. */
export function dampedFlags(decoded, fps, detector) {
  const state = detector.createDetectorState();
  const flags = new Uint8Array(decoded.count);
  for (let i = 0; i < decoded.count; i++) {
    const px = decoded.buffer.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES);
    const report = detector.processFrame(state, px, W, H, (i * 1000) / fps, i);
    let cells = 0;
    for (const m of report.cellMask) if (m >= DAMP_LEVEL) cells++;
    flags[i] = cells >= DAMP_CELLS ? 1 : 0;
  }
  return flags;
}

/** Displayed frame k is filtered with the mask from frame min(k + LOOK_AHEAD, last). */
export function displayedDamped(flags) {
  const out = new Uint8Array(flags.length);
  for (let k = 0; k < flags.length; k++) out[k] = flags[Math.min(k + LOOK_AHEAD, flags.length - 1)];
  return out;
}

// ---------- metrics (pure) ----------

const EPS = 1e-9;

/**
 * displayed: Uint8Array (1 = damped) per displayed frame; labels: [[startSec, endSec], …].
 * Returns the counts behind recall, false damping and undamped-frames-per-event.
 */
export function clipMetrics(displayed, fps, labels) {
  const n = displayed.length;
  const seconds = Math.floor(n / fps + EPS); // whole seconds only
  const damped = (t) => {
    let c = 0;
    for (let k = Math.round(t * fps); k < Math.round((t + 1) * fps); k++) c += displayed[k];
    return c;
  };
  const anyDamped = (t) => damped(t) > 0;

  let dangerSeconds = 0, hitSeconds = 0;
  let safeSeconds = 0, falseSeconds = 0; // with the settle margin
  let strictSafeSeconds = 0, strictFalseSeconds = 0; // any second touching no label
  for (let t = 0; t < seconds; t++) {
    const inside = labels.some(([s, e]) => s <= t + EPS && t + 1 <= e + EPS); // whole second inside a label
    const touches = labels.some(([s, e]) => s < t + 1 - EPS && e > t + EPS); // overlaps a label at all
    const settling = labels.some(([s, e]) => s - SETTLE_BEFORE_S < t + 1 - EPS && e + SETTLE_AFTER_S > t + EPS);
    if (inside) {
      dangerSeconds++;
      if (damped(t) >= 0.5 * Math.round(fps)) hitSeconds++;
    }
    if (!touches) {
      strictSafeSeconds++;
      if (anyDamped(t)) strictFalseSeconds++;
    }
    if (!settling) {
      safeSeconds++;
      if (anyDamped(t)) falseSeconds++;
    }
  }

  const events = [];
  for (const [s, e] of labels) {
    const start = Math.round(s * fps);
    const end = Math.min(n, Math.round(e * fps));
    if (start >= n) continue;
    let first = -1;
    for (let k = start; k < end; k++) if (displayed[k]) { first = k; break; }
    events.push({ start: s, end: e, undamped: first < 0 ? end - start : first - start, missed: first < 0 });
  }
  return { seconds, dangerSeconds, hitSeconds, safeSeconds, falseSeconds, strictSafeSeconds, strictFalseSeconds, events };
}

/** Combines per-clip metrics into totals (pooled, so long clips weigh more). */
export function totals(list) {
  const sum = (f) => list.reduce((a, m) => a + f(m), 0);
  const events = list.flatMap((m) => m.events);
  const undamped = events.map((e) => e.undamped);
  const safeSeconds = sum((m) => m.safeSeconds);
  return {
    clips: list.length,
    seconds: sum((m) => m.seconds),
    dangerSeconds: sum((m) => m.dangerSeconds),
    hitSeconds: sum((m) => m.hitSeconds),
    recall: sum((m) => m.dangerSeconds) ? sum((m) => m.hitSeconds) / sum((m) => m.dangerSeconds) : null,
    safeSeconds,
    falseSeconds: sum((m) => m.falseSeconds),
    falsePerSafeMinute: safeSeconds ? sum((m) => m.falseSeconds) / (safeSeconds / 60) : null,
    strictSafeSeconds: sum((m) => m.strictSafeSeconds),
    strictFalseSeconds: sum((m) => m.strictFalseSeconds),
    strictFalsePerSafeMinute: sum((m) => m.strictSafeSeconds) ? sum((m) => m.strictFalseSeconds) / (sum((m) => m.strictSafeSeconds) / 60) : null,
    events: events.length,
    missedEvents: events.filter((e) => e.missed).length,
    undamped: { mean: undamped.length ? undamped.reduce((a, b) => a + b, 0) / undamped.length : null, worst: undamped.length ? Math.max(...undamped) : null },
  };
}

// ---------- synthetic clips ----------

/** ffmpeg lavfi definitions; every clip is 640×360, 30 fps, 10 s, no audio. */
export const SYNTHETIC = [
  {
    name: 'white-5hz-burst', labels: [[3, 7]],
    // grey; black/white at 5 Hz from 3 s to 7 s (3 frames white, 3 frames black)
    vf: "color=c=0x808080:s=640x360:r=30:d=10,drawbox=w=iw:h=ih:t=fill:c=white:enable='gte(t,3)*lt(t,7)*lt(mod(t*5,1),0.5)',drawbox=w=iw:h=ih:t=fill:c=black:enable='gte(t,3)*lt(t,7)*gte(mod(t*5,1),0.5)'",
  },
  {
    name: 'red-5hz-burst', labels: [[3, 7]],
    vf: "color=c=0x808080:s=640x360:r=30:d=10,drawbox=w=iw:h=ih:t=fill:c=0xff0000:enable='gte(t,3)*lt(t,7)*lt(mod(t*5,1),0.5)',drawbox=w=iw:h=ih:t=fill:c=black:enable='gte(t,3)*lt(t,7)*gte(mod(t*5,1),0.5)'",
  },
  {
    name: 'single-flashes', labels: [],
    // one 2-frame white flash at 1.5 s, 4.5 s and 7.5 s
    vf: "color=c=0x808080:s=640x360:r=30:d=10,drawbox=w=iw:h=ih:t=fill:c=white:enable='gte(t,1.5)*lt(mod(t-1.5,3),0.0667)'",
  },
  {
    name: 'slow-fade', labels: [],
    // black → white → black over 10 s
    vf: "color=c=black:s=640x360:r=30:d=10,format=yuv420p,geq=lum='255*(1-abs(1-2*T/10))':cb=128:cr=128",
  },
];

export function makeSynthetic(dir) {
  mkdirSync(dir, { recursive: true });
  for (const clip of SYNTHETIC) {
    const out = join(dir, clip.name + '.mp4');
    const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', clip.vf, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', out], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${clip.name}: ${r.stderr}`);
    writeFileSync(join(dir, clip.name + '.labels.json'), JSON.stringify(clip.labels) + '\n');
    console.log(`  wrote ${out}  labels ${JSON.stringify(clip.labels)}`);
  }
}

// ---------- CLI ----------

function collect(args) {
  const files = [];
  for (const a of args) {
    const p = resolve(a);
    if (!existsSync(p)) throw new Error(`not found: ${a}`);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (/\.mp4$/i.test(f)) files.push(join(p, f));
    } else files.push(p);
  }
  return files;
}

const f1 = (x, d = 1) => (x === null || x === undefined ? '–' : x.toFixed(d));
const pct = (hit, den) => (den ? `${((100 * hit) / den).toFixed(0)}% (${hit}/${den})` : '–');

function row(id, len, m) {
  const t = totals([m]);
  return [
    id.padEnd(22), String(len).padStart(5), String(m.dangerSeconds).padStart(6), pct(m.hitSeconds, m.dangerSeconds).padStart(12),
    String(m.safeSeconds).padStart(6), String(m.falseSeconds).padStart(6), f1(t.falsePerSafeMinute).padStart(7), f1(t.strictFalsePerSafeMinute).padStart(8),
    String(m.events.length).padStart(6), f1(t.undamped.mean).padStart(8), String(t.undamped.worst ?? '–').padStart(6),
  ].join(' ');
}
const HEADER = ['clip'.padEnd(22), 'sec'.padStart(5), 'danger'.padStart(6), 'recall'.padStart(12), 'safe s'.padStart(6), 'false'.padStart(6), 'false/m'.padStart(7), 'strict/m'.padStart(8), 'events'.padStart(6), 'undamp μ'.padStart(8), 'worst'.padStart(6)].join(' ');

function summaryLine(label, t, fps) {
  const ms = (fr) => (fr === null ? '–' : `${f1((fr / fps) * 1000, 0)} ms`);
  return `${label}: ${t.clips} clips, ${f1(t.seconds / 60, 1)} min · recall ${pct(t.hitSeconds, t.dangerSeconds)} · false damping ${f1(t.falsePerSafeMinute, 2)} s per safe minute (${t.falseSeconds} s in ${f1(t.safeSeconds / 60, 1)} min; strict, no settle margin: ${f1(t.strictFalsePerSafeMinute, 2)} s per minute) · ` +
    `undamped frames per event: mean ${f1(t.undamped.mean, 2)} (${ms(t.undamped.mean)}), worst ${t.undamped.worst ?? '–'} (${ms(t.undamped.worst)}) over ${t.events} events, ${t.missedEvents} never damped`;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
  const fps = Number(opt('fps') ?? 30);
  const jsonOut = opt('json');
  const splitFile = opt('split');
  const synth = opt('make-synthetic');
  if (synth) { makeSynthetic(resolve(synth)); return; }
  if (!argv.length) { console.error('usage: node scripts/eval-video.mjs [--fps 30] [--json out.json] [--split split.json] <files or folders…>'); process.exit(2); }

  const detector = await loadDetector();
  const clips = [];
  const unlabelled = [];
  for (const file of collect(argv)) {
    const labels = readLabels(file);
    const id = clipId(file);
    if (!labels) { unlabelled.push(id); continue; }
    const decoded = decodeClip(file, fps);
    const displayed = displayedDamped(dampedFlags(decoded, fps, detector));
    clips.push({ id, file, seconds: decoded.count / fps, labels, ...clipMetrics(displayed, fps, labels) });
  }

  console.log(`eval-video: ${clips.length} labelled clips, fps ${fps}, look-ahead ${LOOK_AHEAD} frames, damped = ≥ ${DAMP_CELLS} cells at ≥ ${DAMP_LEVEL}\n`);
  console.log(HEADER);
  for (const c of clips) console.log(row(c.id, Math.round(c.seconds), c));
  if (unlabelled.length) console.log(`\nunlabelled (skipped): ${unlabelled.join(', ')}`);
  const all = totals(clips);
  console.log('\n' + summaryLine('TOTAL', all, fps));

  const sets = {};
  if (splitFile) {
    const split = JSON.parse(readFileSync(splitFile, 'utf8'));
    for (const [name, ids] of Object.entries(split)) {
      if (!Array.isArray(ids)) continue;
      const members = clips.filter((c) => ids.includes(c.id));
      sets[name] = totals(members);
      console.log(summaryLine(name.toUpperCase(), sets[name], fps));
    }
  }
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ fps, lookAhead: LOOK_AHEAD, clips: clips.map(({ file, ...c }) => c), unlabelled, total: all, sets }, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
