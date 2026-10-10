// Downloads EA's IRIS test data and prebuilt Windows app into a cache OUTSIDE the repo.
//
//   node scripts/iris/fetch.mjs
//
// Cache: <os tmpdir>/strobeguard-iris (override with IRIS_CACHE=<dir>)
//   videos/<name>.mp4          IRIS test videos
//   expected/<name>.csv        IRIS's expected per-frame results for those videos
//   app/                       IRIS console app (Windows only; skipped elsewhere)
// IRIS: https://github.com/electronicarts/IRIS (BSD-3-Clause). Nothing here is committed.

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cacheDir, IRIS_VIDEOS } from './paths.mjs';

const RAW = 'https://raw.githubusercontent.com/electronicarts/IRIS/main/test/Iris.Tests/data';
const APP_ZIP = 'https://github.com/electronicarts/IRIS/releases/download/1.1.0/iris-1.1.0-windows-app.zip';

async function download(url, file) {
  if (existsSync(file)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

const root = cacheDir();
for (const sub of ['videos', 'expected', 'app']) mkdirSync(join(root, sub), { recursive: true });

for (const name of IRIS_VIDEOS) {
  const v = await download(`${RAW}/TestVideos/${encodeURIComponent(name)}.mp4`, join(root, 'videos', `${name}.mp4`));
  const c = await download(`${RAW}/ExpectedVideoLogFiles/${encodeURIComponent(name)}_RELATIVE.csv`, join(root, 'expected', `${name}.csv`));
  console.log(`${v || c ? 'downloaded' : 'cached    '}  ${name}`);
}

if (process.platform === 'win32') {
  const zip = join(root, 'iris-windows-app.zip');
  if (await download(APP_ZIP, zip)) console.log('downloaded  IRIS Windows app');
  if (readdirSync(join(root, 'app')).length === 0) {
    // Windows' own bsdtar reads zip. Call it by full path: Git Bash's GNU tar would treat "C:" as a host.
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zip, '-C', join(root, 'app')]);
    console.log('unzipped    IRIS Windows app');
  }
} else {
  console.log('skipped     IRIS app (prebuilt binary is Windows-only; expected CSVs still work)');
}
console.log(`\nCache: ${root}`);
