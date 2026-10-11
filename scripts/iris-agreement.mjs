// Summarises how well StrobeGuard agrees with EA IRIS, from an iris-compare report.md.
//
//   node scripts/iris-agreement.mjs results/baseline-iris.md [results/after-iris.md …]
//
// Per report: exact verdict agreement (PASS / WARN / FAIL), danger agreement (both FAIL, or both not FAIL), and the
// mean frame-level precision and recall of our "fail" frames against IRIS's, over the clips IRIS fails.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Parses the first table of an iris-compare report.md into rows. */
export function parseReport(md) {
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith('| ') || line.startsWith('| Video') || line.startsWith('|---')) continue;
    const c = line.split('|').slice(1, -1).map((s) => s.trim());
    if (c.length < 7) continue;
    const pr = /P (\d+)% R (\d+)%/.exec(c[3]);
    rows.push({ video: c[0], iris: c[1], ours: c[2], failP: pr ? Number(pr[1]) / 100 : null, failR: pr ? Number(pr[2]) / 100 : null, onset: c[5] });
  }
  if (!rows.length) throw new Error('no table rows found');
  return rows;
}

export function agreement(rows) {
  const isFail = (v) => v === 'FAIL';
  const irisFails = rows.filter((r) => isFail(r.iris));
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    clips: rows.length,
    exact: rows.filter((r) => r.iris === r.ours).length,
    danger: rows.filter((r) => isFail(r.iris) === isFail(r.ours)).length,
    disagreements: rows.filter((r) => isFail(r.iris) !== isFail(r.ours)).map((r) => `${r.video}: IRIS ${r.iris}, ours ${r.ours}`),
    irisFailClips: irisFails.length,
    meanFailPrecision: mean(irisFails.map((r) => r.failP)),
    meanFailRecall: mean(irisFails.map((r) => r.failR)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const file of process.argv.slice(2)) {
    const a = agreement(parseReport(readFileSync(file, 'utf8')));
    const pct = (x) => (x === null ? '–' : `${(100 * x).toFixed(0)}%`);
    console.log(`${file}: ${a.clips} clips · exact verdict agreement ${a.exact}/${a.clips} · danger agreement (FAIL vs not) ${a.danger}/${a.clips} · ` +
      `on the ${a.irisFailClips} clips IRIS fails: mean fail-frame precision ${pct(a.meanFailPrecision)}, recall ${pct(a.meanFailRecall)}`);
    for (const d of a.disagreements) console.log(`  disagree: ${d}`);
  }
}
