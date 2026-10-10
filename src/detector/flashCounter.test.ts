import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LUMINANCE_RULE, createTracker, flashesInWindow, updateTracker } from './flashCounter.ts';

const FRAME_MS = 1000 / 30;

/** Run a luminance signal f(tMs) through a tracker; return the max flashes/s seen. */
function maxRate(f: (t: number) => number, seconds: number): number {
  const tr = createTracker();
  let max = 0;
  for (let i = 0; i <= seconds * 30; i++) {
    const t = i * FRAME_MS;
    updateTracker(tr, f(t), t, LUMINANCE_RULE);
    max = Math.max(max, flashesInWindow(tr, t));
  }
  return max;
}

const square = (hz: number, hi: number, lo: number) => (t: number) => ((t * hz) / 1000) % 1 < 0.5 ? hi : lo;

test('steady signal and small noise produce no flashes', () => {
  assert.equal(maxRate(() => 0.5, 3), 0);
  assert.equal(maxRate((t) => 0.5 + 0.04 * Math.sin(t), 3), 0);
});

test('5 Hz square wave counts ~5 flashes/s', () => {
  const r = maxRate(square(5, 1, 0), 3);
  assert.ok(r >= 4 && r <= 6, `got ${r}`);
});

test('2 Hz square wave stays at 2–2.5 flashes/s (a 5th transition can sit on the window edge)', () => {
  const r = maxRate(square(2, 1, 0), 3);
  assert.ok(r >= 2 && r <= 2.5, `got ${r}`);
});

test('half-flashes count, like IRIS: 7 transitions in a second = 3.5/s (over the 3/s limit)', () => {
  const tr = createTracker();
  updateTracker(tr, 0, 0, LUMINANCE_RULE);
  for (let i = 1; i <= 7; i++) updateTracker(tr, i % 2, i * 100, LUMINANCE_RULE);
  assert.equal(flashesInWindow(tr, 700), 3.5);
});

test('3.5 Hz square wave exceeds 3 flashes/s', () => {
  assert.ok(maxRate(square(3.5, 1, 0), 3) > 3);
});

test('transitions where the darker state is >= 0.8 are ignored', () => {
  assert.equal(maxRate(square(5, 1, 0.85), 3), 0);
});

test('changes below 0.1 are ignored', () => {
  assert.equal(maxRate(square(5, 0.3, 0.22), 3), 0);
});

test('a single opposing pair is one flash, and it ages out of the window', () => {
  const tr = createTracker();
  updateTracker(tr, 0, 0, LUMINANCE_RULE);
  assert.equal(updateTracker(tr, 1, 33, LUMINANCE_RULE), true);
  assert.equal(updateTracker(tr, 0, 133, LUMINANCE_RULE), true);
  assert.equal(flashesInWindow(tr, 133), 1);
  assert.equal(flashesInWindow(tr, 1200), 0);
});

test('slow fade yields at most one flash per second', () => {
  const fade = (t: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 4000);
  assert.ok(maxRate(fade, 8) <= 1);
});
