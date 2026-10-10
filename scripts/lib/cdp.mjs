// Minimal Chrome DevTools Protocol helpers (no npm dependencies). Same approach as flash-e2e.mjs.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function defaultChrome() {
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(existsSync) ?? 'chrome.exe';
  }
  if (process.platform === 'linux') return 'google-chrome';
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

export async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(300);
  }
  throw new Error('timeout');
}

export async function cdpConnect(wsUrl) {
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
    if (res.result?.exceptionDetails) {
      const d = res.result.exceptionDetails;
      throw new Error(d.exception?.description ?? d.text ?? JSON.stringify(d));
    }
    return res.result?.result?.value;
  };
  return { send, ev, close: () => ws.close() };
}

/**
 * Launches Chrome with a temporary profile and an off-screen window that keeps painting.
 * Returns { port, page(url) → cdp client, close() }.
 */
export async function launchChrome({ port = 9340, chrome = process.env.CHROME || defaultChrome() } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'sg-cdp-'));
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--window-position=-3000,-3000', '--window-size=800,600', '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    'about:blank',
  ], { stdio: 'ignore' });
  proc.on('error', (e) => { console.error(`Could not start Chrome at "${chrome}" (${e.message}). Set CHROME=<path>.`); process.exit(2); });
  const json = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();
  await waitFor(() => json('/json/version'));
  return {
    async page(url) {
      const target = await waitFor(async () => (await json('/json/list')).find((t) => t.type === 'page'));
      const page = await cdpConnect(target.webSocketDebuggerUrl);
      await page.send('Page.enable');
      await page.send('Page.navigate', { url });
      return page;
    },
    async close() {
      proc.kill();
      await sleep(500);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
