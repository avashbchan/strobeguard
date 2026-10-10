// Objective output-quality grader: runs the REAL filter on video clips frame by frame and compares
// every output frame with the exact input frame it shows (see src/grader/metrics.ts for the measures).
//
//   npm run dev                                  # serves the grader page (src/grader)
//   node scripts/grade.mjs --save=baseline       # grade the current code, keep the result as "baseline"
//   ...change the filter...
//   node scripts/grade.mjs --compare=baseline    # grade again and show what got better or worse
//
// Options: --only=concert-strobe,dialogue  --max-protection  --corpus=<json>  --videos=<dir> (searched before clips/ and test_videos/)
//          --app=<url> (default http://localhost:5173)  --save=<name>
// Clips come from clips/ (shared via Drive, see clips/README.md) or test_videos/; missing ones are skipped.
// Output: <tmp>/strobeguard-grade/<run>/report.md, report.json, and images/ (input | output pairs:
// the 3 most damaged frames per clip plus 3 fixed points).
//
// WARNING: clips are decoded in an off-screen Chrome window; some flash. Don't watch it.

import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { launchChrome, waitFor } from './lib/cdp.mjs';
import { cacheDir } from './iris/paths.mjs';

const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APP = (opt('app') ?? 'http://localhost:5173').replace(/\/$/, '');
// Where clips are looked up, in order: --videos, the team's shared set (clips/, see clips/README.md), test_videos/.
const VIDEO_DIRS = [opt('videos'), 'clips', 'test_videos'].filter(Boolean).map((d) => resolve(d));
const CORPUS = JSON.parse(readFileSync(opt('corpus') ?? new URL('./quality/corpus.json', import.meta.url), 'utf8'));
const ONLY = opt('only')?.split(',');
const MAX_PROTECTION = process.argv.includes('--max-protection');
const SAVE = opt('save');
const COMPARE = opt('compare');
const ROOT = join(tmpdir(), 'strobeguard-grade');
const RUN = SAVE ?? `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const OUT = join(ROOT, RUN);

// ---------- resolve clips ----------
function resolveClip(c) {
  if (c.iris) return join(cacheDir(), 'videos', `${c.iris}.mp4`);
  // 'file' is a name fragment; .mp4 only (Chrome can't decode the large HEVC .mov screen recordings).
  for (const dir of VIDEO_DIRS) {
    const hit = existsSync(dir) && readdirSync(dir).sort().find((f) => /.mp4$/i.test(f) && f.includes(c.file));
    if (hit) return join(dir, hit);
  }
  return null;
}
const clips = CORPUS.clips.filter((c) => !ONLY || ONLY.includes(c.name)).map((c) => ({ ...c, path: resolveClip(c) }));
for (const c of clips) if (!c.path || !existsSync(c.path)) console.warn(`  missing video for ${c.name} (${c.file ?? c.iris}); skipped`);
const runnable = clips.filter((c) => c.path && existsSync(c.path));
if (!runnable.length) { console.error('No clips to grade.'); process.exit(2); }

// ---------- file server (Range + CORS, so Chrome can seek and read pixels) ----------
const served = new Map(runnable.map((c, i) => [`/v/${i}${extname(c.path)}`, c.path]));
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
const base = `http://127.0.0.1:${server.address().port}`;

try { await fetch(APP); } catch { console.error(`No dev server at ${APP}. Start it with: npm run dev`); process.exit(2); }

// ---------- grade ----------
mkdirSync(join(OUT, 'images'), { recursive: true });
const chrome = await launchChrome({ port: 9345 });
const results = [];
try {
  const page = await chrome.page(`${APP}/src/grader/index.html`);
  await waitFor(() => page.ev('typeof window.runGrade === "function"'));
  for (const [i, c] of runnable.entries()) {
    const t0 = Date.now();
    process.stdout.write(`  grading ${c.name} (${c.seconds} s) … `);
    try {
      const r = await page.ev(`runGrade(${JSON.stringify({ url: `${base}/v/${i}${extname(c.path)}`, start: c.start, seconds: c.seconds, maxProtection: MAX_PROTECTION })})`);
      const images = r.images.map((img, k) => {
        const file = `${c.name}-${k}.jpg`;
        writeFileSync(join(OUT, 'images', file), Buffer.from(img.dataUrl.split(',')[1], 'base64'));
        return { label: img.label, file };
      });
      results.push({ name: c.name, kind: c.kind, score: r.score, safe: r.safe, parts: r.parts, summary: r.summary, images, perFrame: r.perFrame });
      console.log(`${r.score} ${r.safe ? 'safe' : 'UNSAFE'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) {
      console.log(`FAILED: ${String(e.message).split('\n')[0]}`);
      results.push({ name: c.name, kind: c.kind, error: String(e.message).split('\n')[0] });
    }
  }
} finally {
  await chrome.close();
  server.close();
}

// ---------- report ----------
const ok = results.filter((r) => !r.error);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const overall = ok.length ? ok.reduce((s, r) => s + r.score, 0) / ok.length : 0;
const lines = [
  `# StrobeGuard output quality — ${RUN}${MAX_PROTECTION ? ' (maximum protection)' : ''}`,
  '',
  `**Overall quality ${f(overall, 1)} / 100** · safety: ${ok.every((r) => r.safe) ? 'all clips safe' : 'UNSAFE on ' + ok.filter((r) => !r.safe).map((r) => r.name).join(', ')}`,
  '',
  '| Clip | Kind | Score | Safe | Collateral ΔE | Chroma kept | Greyed | Hue shift ° | Light | Black lift | Edges | Ghost | SSIM | Out max /s | Out >3/s (s) |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const r of results) {
  if (r.error) { lines.push(`| ${r.name} | ${r.kind} | error: ${r.error} |`); continue; }
  const s = r.summary, a = s.all;
  lines.push(`| ${r.name} | ${r.kind} | **${f(r.score, 1)}** | ${r.safe ? 'yes' : '**NO**'} | ${s.untouched.frames ? f(s.untouched.dE) : '–'} | ${f(a.chromaRatio * 100, 0)}% | ${f(a.greyed * 100, 1)}% | ${f(a.hueShift, 1)} | ${f(a.lightRatio)} | ${f(a.blackLift, 3)} | ${f(a.edgeRatio)} | ${f(a.ghost, 3)} | ${f(s.ssim, 3)} | ${f(s.safety.outRateMax, 1)} | ${f(s.safety.outOver3Seconds, 1)} |`);
}
lines.push('', 'Score parts (0–1): collateral 25, colour 20, hue 10, structure 20, clarity 15, tone 10.', '');
for (const r of ok) lines.push(`- **${r.name}**: ` + Object.entries(r.parts).map(([k, v]) => `${k} ${f(v)}`).join(' · '));
lines.push('', '## Pictures (input | output)', '');
for (const r of ok) for (const img of r.images) lines.push(`- ${r.name} ${img.label}: images/${img.file}`);

if (COMPARE) {
  const basePath = join(ROOT, COMPARE, 'report.json');
  if (!existsSync(basePath)) {
    lines.push('', `(No saved run "${COMPARE}" to compare with.)`);
  } else {
    const before = new Map(JSON.parse(readFileSync(basePath, 'utf8')).results.filter((r) => !r.error).map((r) => [r.name, r]));
    lines.push('', `## Compared with "${COMPARE}"`, '', '| Clip | Score | Δ | Safe (before → now) | Collateral ΔE | Chroma kept | Edges | Ghost | SSIM |', '|---|---|---|---|---|---|---|---|---|');
    const d = (now, was, digits = 2, invert = false) => {
      const delta = now - was;
      const good = invert ? delta < 0 : delta > 0;
      return `${f(now, digits)} (${delta >= 0 ? '+' : ''}${f(delta, digits)}${Math.abs(delta) < 10 ** -digits ? '' : good ? ' ✓' : ' ✗'})`;
    };
    for (const r of ok) {
      const b = before.get(r.name);
      if (!b) { lines.push(`| ${r.name} | ${f(r.score, 1)} | new | | | | | | |`); continue; }
      lines.push(`| ${r.name} | ${f(r.score, 1)} | ${r.score - b.score >= 0 ? '+' : ''}${f(r.score - b.score, 1)} | ${b.safe ? 'yes' : 'NO'} → ${r.safe ? 'yes' : '**NO**'} | ${d(r.summary.untouched.dE, b.summary.untouched.dE, 2, true)} | ${d(r.summary.all.chromaRatio, b.summary.all.chromaRatio)} | ${d(r.summary.all.edgeRatio, b.summary.all.edgeRatio)} | ${d(r.summary.all.ghost, b.summary.all.ghost, 3, true)} | ${d(r.summary.ssim, b.summary.ssim, 3)} |`);
    }
    const bOk = [...before.values()];
    const bOverall = bOk.length ? bOk.reduce((s, r) => s + r.score, 0) / bOk.length : 0;
    lines.push('', `**Overall ${f(bOverall, 1)} → ${f(overall, 1)} (${overall - bOverall >= 0 ? '+' : ''}${f(overall - bOverall, 1)})**`);
  }
}

const md = lines.join('\n');
writeFileSync(join(OUT, 'report.md'), md);
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ run: RUN, maxProtection: MAX_PROTECTION, results }, null, 2));
console.log('\n' + md.split('\n## Pictures')[0] + (COMPARE ? '\n' + (md.split(`## Compared with`)[1] ? '## Compared with' + md.split('## Compared with')[1] : '') : ''));
console.log(`\nReport: ${join(OUT, 'report.md')}`);
process.exit(ok.length === results.length ? 0 : 1);
