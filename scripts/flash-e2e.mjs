// End-to-end flash test: real Chrome, real tab capture, the real StrobeGuard app.
//
//   node scripts/flash-e2e.mjs [appUrl] [--max-protection]
//
// appUrl defaults to https://strobeguard.vercel.app (use http://localhost:5173 for `npm run dev`).
// Launches Chrome with a temporary profile and off-screen windows, opens /test/flash.html in its own
// window, shares it into the app with a real mouse click (script click with user activation as a
// fallback), then runs every flash pattern and checks
// the app's own readouts (input vs output flashes/s, risk meters).
//
// Exit code: 0 all checks pass, 1 a check failed, 2 the run itself broke.
// Env: CHROME=<path to Chrome binary> (default: the usual install path on macOS, Windows or Linux),
//      ONLY=flash5,flash2 (subset of patterns),
//      TRACE=1 (also write per-report detector traces to trace-<pattern>.json in the cwd).
// Needs Node >= 22 (global WebSocket) and Google Chrome. No npm dependencies.
//
// WARNING: this drives the intentionally flashing test page. Its windows are placed off-screen,
// but do not watch them if you are photosensitive.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://strobeguard.vercel.app').replace(/\/$/, '');
const MAX_PROTECTION = process.argv.includes('--max-protection');

function defaultChrome() {
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const found = roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(existsSync);
    return found ?? 'chrome.exe';
  }
  if (process.platform === 'linux') return 'google-chrome';
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}
const CHROME = process.env.CHROME || defaultChrome();
const PORT = 9335;
const WARMUP_MS = 4000; // 1 s detector window + mask easing + buffer delay
const SAMPLE_MS = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// expect: 'danger' = input must exceed 3/s and output must stay under 3/s
//         'safe'   = input should stay under 3/s; output must not flash more than input
const ALL_PATTERNS = [
  { key: 'steady', expect: 'safe' },
  { key: 'flash5', expect: 'danger' },
  { key: 'flash2', expect: 'safe' },
  { key: 'single', expect: 'safe' },
  { key: 'fade', expect: 'safe' },
  { key: 'red5', expect: 'danger', red: true },
  { key: 'corner5', expect: 'safe' },
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const PATTERNS = ONLY ? ALL_PATTERNS.filter((p) => ONLY.includes(p.key)) : ALL_PATTERNS;

const profile = mkdtempSync(join(tmpdir(), 'sg-e2e-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-position=-3000,-3000', '--window-size=1100,900',
  // The share picker auto-selects the tab whose title contains this (the flash test page).
  '--auto-select-tab-capture-source-by-title=flash test page',
  '--autoplay-policy=no-user-gesture-required',
  // Keep the off-screen windows painting. Without these, Windows treats them as occluded and
  // stops rendering, so tab capture delivers no frames.
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  `${APP}/`,
], { stdio: 'ignore' });
chrome.on('error', (e) => {
  console.error(`Could not start Chrome at "${CHROME}" (${e.message}). Set CHROME=<path to Chrome>.`);
  process.exit(2);
});

// Minimal Chrome DevTools Protocol client.
async function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
    return res.result?.result?.value;
  };
  return { send, ev };
}

async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(300);
  }
  throw new Error('timeout');
}

const listTargets = async () => (await fetch(`http://127.0.0.1:${PORT}/json`)).json();

// getDisplayMedia needs user activation, so "Share a tab" gets a real (CDP input) mouse click.
async function realClick(page, selectorJs) {
  await page.send('Page.bringToFront');
  const pos = await page.ev(`(() => { const b = ${selectorJs}; b.scrollIntoView(); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: pos[0], y: pos[1], button: 'left', clickCount: 1 });
  }
}

// Fallback when the mouse click is lost (Windows doesn't deliver CDP mouse events to an off-screen
// window): a script click with userGesture, which also counts as user activation.
async function gestureClick(page, selectorJs) {
  await page.send('Runtime.evaluate', { userGesture: true, expression: `(${selectorJs}).click()` });
}

// Reads the app's own UI: the big flash-rate numbers ([data-rate]) and the role="meter" risk bars.
const READ = `(() => {
  const rate = (k) => parseFloat(document.querySelector('[data-rate=' + k + ']')?.textContent ?? '');
  const g = [rate('input'), rate('output')];
  const m = Object.fromEntries([...document.querySelectorAll('[role=meter]')].map((e) => [e.getAttribute('aria-label'), Number(e.getAttribute('aria-valuenow'))]));
  return { inFps: g[0], outFps: g[1], m, err: document.querySelector('.error')?.textContent ?? null };
})()`;

// TRACE: wrap Worker so every RiskReport from the two detector workers (0 = input, 1 = output)
// is recorded in window.__rep.
const TRACE_SCRIPT = `
  window.__rep = [[], []]; let __n = 0; const W0 = window.Worker;
  window.Worker = class extends W0 {
    constructor(...a) { super(...a); this.__i = __n++; }
    set onmessage(fn) {
      const i = this.__i;
      super.onmessage = (e) => {
        const r = e.data && e.data.report;
        if (r && window.__rep[i]) window.__rep[i].push({ t: performance.now(), f: r.flashesPerSec, maskMax: Math.max(...r.cellMask), maskMean: r.cellMask.reduce((a, b) => a + b, 0) / 48 });
        fn(e);
      };
    }
    get onmessage() { return super.onmessage; }
  };`;

let exitCode = 0;
try {
  const appTarget = await waitFor(async () => (await listTargets()).find((x) => x.type === 'page' && x.url.startsWith(APP)));
  const app = await cdpConnect(appTarget.webSocketDebuggerUrl);
  await app.send('Runtime.enable');
  await app.send('Page.enable');
  if (process.env.TRACE) {
    await app.send('Page.addScriptToEvaluateOnNewDocument', { source: TRACE_SCRIPT });
    await app.send('Page.reload');
    await sleep(2000);
  }

  // Flash page in its OWN window: Chrome stops painting background tabs, and tab capture only
  // delivers frames from a tab that is painting.
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await cdpConnect(version.webSocketDebuggerUrl);
  const { result: { targetId } } = await browser.send('Target.createTarget', {
    url: `${APP}/test/flash.html#go`, newWindow: true, left: -3000, top: -2000, width: 640, height: 420,
  });
  const flashTarget = await waitFor(async () => (await listTargets()).find((x) => x.id === targetId));
  const flash = await cdpConnect(flashTarget.webSocketDebuggerUrl);
  await waitFor(() => flash.ev(`document.getElementById('app')?.style.display === 'flex'`));

  // App: accept the warning, then share the flash page.
  await waitFor(() => app.ev(`!!document.querySelector('button')`));
  await app.ev(`[...document.querySelectorAll('button')].find((b) => /understand|continue/i.test(b.textContent))?.click()`);
  await sleep(500);
  const SHARE_BUTTON = `[...document.querySelectorAll('button')].find((b) => /share a tab/i.test(b.textContent))`;
  await realClick(app, SHARE_BUTTON);
  await sleep(1000);
  // Still showing an enabled "Share a tab" button means the click didn't register.
  if (await app.ev(`!!(${SHARE_BUTTON}) && !(${SHARE_BUTTON}).disabled`)) await gestureClick(app, SHARE_BUTTON);

  const results = [];
  // Static source check: the flash page starts on a steady grey screen, and tab capture sends
  // no new frames for unchanging content. The big canvas must still show it.
  await sleep(2000);
  const staticWidth = await app.ev(`document.querySelector('canvas.output')?.width ?? 0`);
  const staticOk = staticWidth > 300; // 300 = default canvas width, i.e. never drew a frame
  results.push(staticOk);
  console.log(`${staticOk ? 'PASS' : 'FAIL'}  static source shows on the big canvas (width ${staticWidth})`);
  if (!staticOk) {
    // Moving content makes tab capture deliver frames, so the rest of the run can continue.
    await flash.ev(`document.querySelector('[data-p="fade"]').click()`);
    await waitFor(() => app.ev(`(document.querySelector('canvas.output')?.width ?? 0) > 300`)).catch(async (e) => {
      console.error('Share never produced output. Page text:', await app.ev(`document.body.innerText.slice(0, 400)`));
      throw e;
    });
  }

  if (MAX_PROTECTION) await app.ev(`document.querySelector('label.toggle input').click()`);
  console.log(`App: ${APP}${MAX_PROTECTION ? '  (Maximum protection ON)' : ''}`);
  console.log(`Pipeline: ${await app.ev(`[...document.querySelectorAll('.readout > *')].map((e) => e.textContent).join(' · ')`)}\n`);

  for (const p of PATTERNS) {
    await flash.ev(`document.querySelector('[data-p="${p.key}"]').click()`);
    await sleep(WARMUP_MS);
    const samples = [];
    const end = Date.now() + SAMPLE_MS;
    while (Date.now() < end) {
      samples.push(await app.ev(READ));
      await sleep(250);
    }
    if (process.env.TRACE) {
      writeFileSync(`trace-${p.key}.json`, await app.ev(`JSON.stringify(window.__rep)`));
      await app.ev(`window.__rep = [[], []]`);
    }

    const ok = samples.filter((s) => Number.isFinite(s.inFps) && Number.isFinite(s.outFps));
    const max = (k) => Math.max(...ok.map((s) => s[k]));
    const mean = (k) => ok.reduce((a, s) => a + s[k], 0) / Math.max(1, ok.length);
    const maxMeter = (label) => Math.max(...ok.map((s) => s.m[label] ?? 0));
    const r = {
      inMax: max('inFps'), inMean: mean('inFps'), outMax: max('outFps'), outMean: mean('outFps'),
      inRisk: maxMeter('Original general flash'), outRisk: maxMeter('Filtered general flash'),
      inRed: maxMeter('Original red flash'), outRed: maxMeter('Filtered red flash'),
    };
    const problems = [];
    const err = samples.find((s) => s.err)?.err;
    if (!ok.length) problems.push('no readings');
    if (err) problems.push('app error: ' + err);
    if (p.expect === 'danger') {
      if (!(r.inMax > 3)) problems.push('input never exceeded 3/s (detector missed it?)');
      if (!(r.outMax < 3)) problems.push(`OUTPUT reached ${r.outMax.toFixed(1)}/s (>= 3)`);
      if (p.red && !(r.inRed > 0)) problems.push('input red risk stayed 0');
    } else if (!(r.inMax < 3)) {
      problems.push(`input reached ${r.inMax.toFixed(1)}/s on a pattern that should be safe`);
    }
    if (r.outMax > r.inMax + 0.5) problems.push('output flashes more than input');
    results.push(problems.length === 0);
    console.log(
      `${problems.length ? 'FAIL' : 'PASS'}  ${p.key.padEnd(8)}  in max ${r.inMax.toFixed(1)} (mean ${r.inMean.toFixed(1)})` +
      `  out max ${r.outMax.toFixed(1)} (mean ${r.outMean.toFixed(1)})  flashRisk in/out ${r.inRisk}/${r.outRisk}%` +
      `  red in/out ${r.inRed}/${r.outRed}%${problems.length ? '  <- ' + problems.join('; ') : ''}`,
    );
  }
  await flash.ev(`document.querySelector('[data-p="steady"]').click()`);

  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('E2E run failed:', e);
  exitCode = 2;
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  process.exit(exitCode);
}
