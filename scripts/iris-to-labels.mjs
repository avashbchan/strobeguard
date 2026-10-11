// Turns EA IRIS's per-frame grades into <clip>.labels.json files for scripts/eval-video.mjs.
//
//   node scripts/iris-to-labels.mjs [--dir=clips-small] [--gap=0.5] [--include-extended] [--summary=results/iris-labels.json] [--dry]
//
// Run scripts/iris-compare.mjs --dir=<same folder> --iris=full first: it runs IrisApp on every clip and leaves IRIS's
// per-frame output (frameData.json or framedata*.csv) in the IRIS results folder, which is what this reads.
//
// A label is a range of frames IRIS grades as a FLASH FAILURE (luminance or red grade 3), with gaps shorter
// than --gap seconds merged. IRIS's other findings are counted but not labelled unless asked:
//   extended failure (grade 2: 2–3 flashes/s sustained > 4 s; StrobeGuard does not damp this on purpose),
//   pattern failure (striped patterns; StrobeGuard does not detect patterns).
// Labels are written next to each clip; a summary (no video data) goes to --summary.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { estimateFps, joinCsvChunks, joinSegments, parseIrisCsv, parseIrisFrameJson, segments } from './iris/compare-lib.mjs';
import { irisResultsDir } from './iris/paths.mjs';
import { clipId, labelsPath } from './eval-video.mjs';

const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIR = resolve(opt('dir') ?? 'clips-small');
const GAP = Number(opt('gap') ?? 0.5);
const INCLUDE_EXTENDED = process.argv.includes('--include-extended');
const SUMMARY = opt('summary') ?? 'results/iris-labels.json';
const DRY = process.argv.includes('--dry');

/** IRIS's per-frame grades for a clip, or null if IRIS hasn't analysed it. */
export function readIrisFrames(file) {
  const dir = irisResultsDir(file);
  if (!existsSync(join(dir, 'result.json'))) return null;
  const json = join(dir, 'frameData.json');
  if (existsSync(json)) return parseIrisFrameJson(JSON.parse(readFileSync(json, 'utf8')));
  const chunks = readdirSync(dir)
    .map((f) => [f, /^framedata(?:\.(\d+))?\.csv$/i.exec(f)])
    .filter(([, m]) => m)
    .sort(([, a], [, b]) => Number(b[1] ?? 0) - Number(a[1] ?? 0)) // highest number = oldest chunk
    .map(([f]) => readFileSync(join(dir, f), 'utf8'));
  return parseIrisCsv(joinCsvChunks(chunks));
}

const round3 = (x) => Math.round(x * 1000) / 1000;
const total = (segs) => segs.reduce((a, s) => a + (s.end - s.start), 0);

/** Label ranges from IRIS frames: flash-failure frames (plus extended failure if asked), gaps < gap merged. */
export function labelRanges(frames, fps, { gap = 0.5, includeExtended = false } = {}) {
  const fail = (g) => g.lum === 3 || g.red === 3 || (includeExtended && (g.lum === 2 || g.red === 2));
  return joinSegments(segments(frames, fps, fail), gap).map((s) => [round3(s.start), round3(s.end)]);
}

function main() {
  const files = readdirSync(DIR).filter((f) => /\.mp4$/i.test(f)).sort().map((f) => join(DIR, f));
  const summary = [];
  console.log(`IRIS → labels for ${files.length} clips in ${DIR} (flash failure${INCLUDE_EXTENDED ? ' + extended failure' : ''}, gaps < ${GAP} s merged)\n`);
  console.log(['clip'.padEnd(20), 'sec'.padStart(5), 'fail s'.padStart(7), 'ext-only s'.padStart(10), 'pattern s'.padStart(9), 'labels'.padStart(6), '  label ranges (s)'].join(' '));
  for (const file of files) {
    const id = clipId(file);
    const frames = readIrisFrames(file);
    if (!frames) { console.log(`${id.padEnd(20)} no IRIS results (run iris-compare first)`); continue; }
    const fps = estimateFps(frames);
    const ranges = labelRanges(frames, fps, { gap: GAP, includeExtended: INCLUDE_EXTENDED });
    const failSec = total(segments(frames, fps, (g) => g.lum === 3 || g.red === 3));
    const extOnlySec = total(segments(frames, fps, (g) => (g.lum === 2 || g.red === 2) && g.lum !== 3 && g.red !== 3));
    const patternSec = total(segments(frames, fps, (g) => g.pattern >= 1));
    const redFailSec = total(segments(frames, fps, (g) => g.red === 3));
    const seconds = frames.length / fps;
    if (!DRY) writeFileSync(labelsPath(file), JSON.stringify(ranges) + '\n');
    summary.push({ id, file: basename(file), fps: round3(fps), seconds: round3(seconds), irisFailSeconds: round3(failSec), irisRedFailSeconds: round3(redFailSec), irisExtendedOnlySeconds: round3(extOnlySec), irisPatternSeconds: round3(patternSec), labels: ranges });
    const shown = ranges.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join(', ');
    console.log([id.padEnd(20), seconds.toFixed(0).padStart(5), failSec.toFixed(1).padStart(7), extOnlySec.toFixed(1).padStart(10), patternSec.toFixed(1).padStart(9), String(ranges.length).padStart(6), '  ' + (shown.length > 90 ? shown.slice(0, 90) + '…' : shown || '[]')].join(' '));
  }
  if (!DRY && SUMMARY) {
    mkdirSync(dirname(resolve(SUMMARY)), { recursive: true });
    writeFileSync(SUMMARY, JSON.stringify({ source: 'EA IRIS 1.1.0 (IrisApp, full settings)', labelRule: `flash failure (grade 3, luminance or red)${INCLUDE_EXTENDED ? ' + extended failure (grade 2)' : ''}, gaps < ${GAP} s merged`, clips: summary }, null, 2) + '\n');
    console.log(`\nwrote ${summary.length} labels files next to the clips, and ${SUMMARY}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
