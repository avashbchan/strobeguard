// Compare StrobeGuard's detector with EA IRIS on the same videos, frame by frame.
//
//   npm run dev                                   # in another terminal (serves the offline runner)
//   node scripts/iris/fetch.mjs                   # once: IRIS test videos, expected CSVs, Windows app
//   node scripts/iris-compare.mjs                 # IRIS's 8 test videos (graded by IrisApp; expected CSVs if no app)
//   node scripts/iris-compare.mjs clip.mp4 ...    # extra clips, graded by running IrisApp.exe (Windows)
//   node scripts/iris-compare.mjs --dir=<folder>  # every video in a folder
//
// Options: --app=<url> (default http://localhost:5173), --only=2Hz_6s,3Hz_6s, --mode=seek|play, --fresh,
//          --iris=full|fast (IRIS settings for extra clips; default fast)
// Output: a table per video, plus report.json and report.md in the IRIS cache directory.
//
// WARNING: clips are decoded in an off-screen Chrome window; some may flash. Don't watch it.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, resolve } from 'node:path';
import { cacheDir, IRIS_VIDEOS, safeClipName } from './iris/paths.mjs';
import { compareVideo, estimateFps, fmtTime, joinCsvChunks, parseIrisCsv, parseIrisFrameJson } from './iris/compare-lib.mjs';
import { launchChrome, waitFor } from './lib/cdp.mjs';

const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APP = (opt('app') ?? 'http://localhost:5173').replace(/\/$/, '');
const ONLY = opt('only')?.split(',');
const MODE = opt('mode');
// IRIS settings for extra clips: fast (default; 20% resize, no pattern detection) or full. Use full for
// small clips such as the 360p set, where a 20% resize would leave IRIS only ~128×72 pixels.
const CLIP_IRIS = opt('iris') ?? 'fast';
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;
const clipDir = opt('dir');
const clips = [
  ...process.argv.slice(2).filter((a) => !a.startsWith('--')),
  ...(clipDir ? readdirSync(clipDir).filter((f) => VIDEO_EXT.test(f)).sort().map((f) => join(clipDir, f)) : []),
];
const root = cacheDir();
const appDir = join(root, 'app', 'iris-1.1.0-windows-app');

// ---------- IRIS side ----------
// IrisApp reads paths as ANSI, so non-ASCII file names are copied to a safe name first.
function safeCopy(file) {
  const dir = join(root, 'clips');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, safeClipName(file));
  if (!existsSync(dest) || statSync(dest).size !== statSync(file).size) copyFileSync(file, dest);
  return dest;
}

// IRIS options: full = pattern detection on, full-size frames (IRIS's short test videos);
// fast = IRIS's defaults (no pattern detection) plus its own 20% frame resize, for long real-world clips.
// Full settings run far slower than real time on 1080p/4K.
const IRIS_ARGS = { full: ['-p', '1', '-r', '0'], fast: ['-p', '0', '-r', '1'] };

/** Runs IrisApp (cached by result.json) and returns its per-frame grades. */
function runIrisApp(video, settings) {
  if (!existsSync(join(appDir, 'IrisApp.exe'))) throw new Error('IrisApp.exe not found. Run node scripts/iris/fetch.mjs (Windows only).');
  const dir = join(appDir, 'Results', basename(video));
  const done = join(dir, 'result.json');
  if (!existsSync(done) || statSync(done).mtimeMs < statSync(video).mtimeMs) {
    console.log(`  IRIS analysing ${basename(video)} (${settings}) …`);
    try {
      execFileSync(join(appDir, 'IrisApp.exe'), ['-v', video, '-j', '1', ...IRIS_ARGS[settings]], { cwd: appDir, stdio: 'ignore', timeout: 3 * 60 * 60 * 1000 });
    } catch { /* checked below */ }
    if (!existsSync(done)) throw new Error('IRIS could not analyse this video (no result.json; likely an unsupported codec)');
  }
  // frameData.json (non-passing videos) has complete arrays; otherwise stitch the rotated CSV chunks.
  const json = join(dir, 'frameData.json');
  if (existsSync(json)) return parseIrisFrameJson(JSON.parse(readFileSync(json, 'utf8')));
  const chunks = readdirSync(dir)
    .map((f) => [f, /^framedata(?:\.(\d+))?\.csv$/i.exec(f)])
    .filter(([, m]) => m)
    .sort(([, a], [, b]) => Number(b[1] ?? 0) - Number(a[1] ?? 0)) // highest number = oldest
    .map(([f]) => readFileSync(join(dir, f), 'utf8'));
  return parseIrisCsv(joinCsvChunks(chunks));
}

const jobs = [];
for (const name of IRIS_VIDEOS) {
  if (clips.length || (ONLY && !ONLY.includes(name))) continue;
  // Prefer grading with the real IRIS app; its unit-test CSVs use mixed schemas and test-only settings.
  const useApp = existsSync(join(appDir, 'IrisApp.exe'));
  jobs.push({ name, video: join(root, 'videos', `${name}.mp4`), irisCsv: useApp ? null : join(root, 'expected', `${name}.csv`), iris: 'full', source: useApp ? 'IrisApp (full)' : 'expected CSV' });
}
for (const clip of clips) {
  const video = safeCopy(resolve(clip));
  const settings = CLIP_IRIS === 'full' ? 'full' : 'fast';
  jobs.push({ name: basename(clip), video, irisCsv: null, iris: settings, source: `IrisApp (${settings})` });
}
for (const j of jobs) if (!existsSync(j.video)) throw new Error(`Missing ${j.video}. Run node scripts/iris/fetch.mjs first.`);

// ---------- file server for the videos (Range + CORS so Chrome can seek and read pixels) ----------
const served = new Map(jobs.map((j, i) => [`/v/${i}${extname(j.video)}`, j.video]));
const server = http.createServer((req, res) => {
  const file = served.get(req.url ?? '');
  if (!file) { res.writeHead(404).end(); return; }
  const size = statSync(file).size;
  const headers = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    createReadStream(file).pipe(res);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const fileBase = `http://127.0.0.1:${server.address().port}`;

// ---------- run ----------
try { await fetch(APP); } catch { console.error(`No dev server at ${APP}. Start it with: npm run dev`); process.exit(2); }

// Our per-video results are cached so an interrupted batch resumes where it stopped. The key includes
// a hash of the detector source, so any detector change re-runs everything. --fresh ignores the cache.
const FRESH = process.argv.includes('--fresh');
const detectorDir = new URL('../src/detector/', import.meta.url);
const detectorHash = createHash('sha1')
  .update(readdirSync(detectorDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()
    .map((f) => readFileSync(new URL(f, detectorDir), 'utf8')).join('\0'))
  .digest('hex').slice(0, 10);
const oursCache = (job, mode) => {
  const st = statSync(job.video);
  return join(root, 'ours', `${basename(job.video)}.${st.size}.${mode}.${detectorHash}.json`);
};

const firstLine = (e) => String(e?.message ?? e).split('\n')[0].trim();
const results = [];
const failures = [];
let exitCode = 0;

// ---------- report (rewritten after every video, so partial runs still leave a report) ----------
const pct = (m) => {
  const p = m.tp + m.fp ? m.tp / (m.tp + m.fp) : 1;
  const r = m.tp + m.fn ? m.tp / (m.tp + m.fn) : 1;
  return `P ${(p * 100).toFixed(0)}% R ${(r * 100).toFixed(0)}%`;
};
const segText = (segs) => segs.length ? segs.map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)} ${s.level}`).join(', ') : '—';
function writeReport() {
  const lines = [
    '| Video | IRIS | Ours | Fail frames (P/R) | Any-flag frames (P/R) | Onset Δ | IRIS extended / pattern frames |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    const onset = r.onsetDelaySec === null ? '—' : `${r.onsetDelaySec >= 0 ? '+' : ''}${r.onsetDelaySec.toFixed(2)} s`;
    lines.push(`| ${r.name} | ${r.irisVerdict} | ${r.ourVerdict} | ${pct(r.fail)} | ${pct(r.any)} | ${onset} | ${r.extendedFrames} / ${r.patternFrames} |`);
  }
  lines.push('', '### Flagged segments (IRIS vs ours)', '');
  for (const r of results) {
    lines.push(`**${r.name}** (${r.seconds.toFixed(1)} s, ${r.mode}, ${r.source}, coverage ${(r.coverage * 100).toFixed(0)}%)`, '', `- IRIS: ${segText(r.irisSegments)}`, `- Ours: ${segText(r.ourSegments)}`, '');
  }
  for (const f of failures) lines.push(`**${f.name}**: skipped (${f.error})`, '');
  const md = lines.join('\n');
  mkdirSync(join(root, 'report'), { recursive: true });
  writeFileSync(join(root, 'report', 'report.json'), JSON.stringify({ detectorHash, results, failures }, null, 2));
  writeFileSync(join(root, 'report', 'report.md'), md);
  return md;
}

mkdirSync(join(root, 'ours'), { recursive: true });
const chrome = await launchChrome();
try {
  const page = await chrome.page(`${APP}/src/detector/offline/index.html`);
  await waitFor(() => page.ev('typeof window.runOffline === "function"'));

  for (const [i, job] of jobs.entries()) {
    try {
      const irisFrames = job.irisCsv ? parseIrisCsv(readFileSync(job.irisCsv, 'utf8')) : runIrisApp(job.video, job.iris);
      const fps = estimateFps(irisFrames);
      const seconds = irisFrames.length / fps;
      // Seek mode is frame-exact but decodes from the previous keyframe on every frame, so it is only
      // practical for short clips (IRIS's synthetic test videos are <= 8 s).
      const mode = MODE ?? (seconds <= 20 ? 'seek' : 'play');
      const cached = oursCache(job, mode);
      let ours;
      if (!FRESH && existsSync(cached)) {
        ours = JSON.parse(readFileSync(cached, 'utf8'));
        console.log(`  StrobeGuard ${job.name}: cached`);
      } else {
        const url = `${fileBase}/v/${i}${extname(job.video)}`;
        console.log(`  StrobeGuard analysing ${job.name} (${seconds.toFixed(1)} s, ${fps.toFixed(2)} fps, ${mode}) …`);
        ours = await page.ev(`runOffline(${JSON.stringify({ url, fps, mode })})`);
        writeFileSync(cached, JSON.stringify(ours));
      }
      const r = compareVideo(irisFrames, ours.rows, fps);
      results.push({ name: job.name, source: job.source, fps, mode, seconds, size: `${ours.width}x${ours.height}`, ...r });
    } catch (e) {
      // One undecodable clip (e.g. HEVC .mov in Chrome) shouldn't sink the whole batch.
      console.error(`  SKIPPED ${job.name}: ${firstLine(e)}`);
      failures.push({ name: job.name, error: firstLine(e) });
      exitCode = 1;
    }
    writeReport();
  }
} catch (e) {
  console.error('Comparison failed:', e.message);
  exitCode = 2;
} finally {
  await chrome.close();
  server.close();
}

console.log('\n' + writeReport());
console.log(`Report: ${join(root, 'report')}`);
process.exit(exitCode);
