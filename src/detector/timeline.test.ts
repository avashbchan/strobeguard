import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineTracker, flaggedParts, reportLevel } from './timeline.ts';

const FRAME = 1000 / 30;
const r = (flashesPerSec: number, redRisk = 0) => ({ flashesPerSec, redRisk });

/** Feed `seconds` of reports at 30 fps starting at `from` ms; rate(t) gives flashes/s. */
function feed(t: ReturnType<typeof createTimelineTracker>, from: number, seconds: number, rate: (ms: number) => number, red = 0) {
  for (let i = 0; i < seconds * 30; i++) {
    const ms = from + i * FRAME;
    t.push(r(rate(ms), red), ms);
  }
}

test('reportLevel thresholds', () => {
  assert.equal(reportLevel(r(0)), null);
  assert.equal(reportLevel(r(1)), null);
  assert.equal(reportLevel(r(2)), 'warning');
  assert.equal(reportLevel(r(3)), 'warning');
  assert.equal(reportLevel(r(3.5)), 'fail');
  assert.equal(reportLevel(r(0, 1)), 'fail'); // dangerous red flash on its own
});

test('a calm session has no segments', () => {
  const t = createTimelineTracker();
  feed(t, 0, 10, () => 0);
  assert.deepEqual(t.segments, []);
});

test('four 3-second dangerous parts in a minute become four fail segments', () => {
  const t = createTimelineTracker();
  const parts = [5000, 20000, 35000, 50000];
  feed(t, 0, 60, (ms) => (parts.some((p) => ms >= p && ms < p + 3000) ? 5 : 0));
  assert.equal(t.segments.length, 4);
  t.segments.forEach((s, i) => {
    assert.equal(s.level, 'fail');
    assert.ok(Math.abs(s.start - parts[i]!) < 40);
    assert.ok(Math.abs(s.end - s.start - 3000) < 80);
  });
});

test('one-frame dips are bridged; real gaps split', () => {
  const t = createTimelineTracker();
  // 5/s for 2 s with a single 0 frame in the middle, then 1 s calm, then 5/s again.
  feed(t, 0, 4, (ms) => (Math.abs(ms - 1000) < FRAME / 2 || (ms >= 2000 && ms < 3000) ? 0 : 5));
  assert.deepEqual(t.segments.map((s) => s.level), ['fail', 'fail']);
  assert.ok(t.segments[0]!.end > 1900 && t.segments[1]!.start >= 3000);
});

test('sustained 2 flashes/s turns into an extended warning after ~4 s (IRIS extended failure)', () => {
  const t = createTimelineTracker();
  feed(t, 0, 7, () => 2);
  const [warn, ext] = t.segments;
  assert.equal(t.segments.length, 2);
  assert.equal(warn!.level, 'warning');
  assert.equal(ext!.level, 'extended');
  assert.ok(ext!.start > 4000 && ext!.start < 4200, `extended starts at ${ext!.start}`);
});

test('short warning bursts never become extended', () => {
  const t = createTimelineTracker();
  feed(t, 0, 20, (ms) => (ms % 5000 < 2000 ? 2 : 0)); // 2 s on, 3 s off
  assert.ok(t.segments.every((s) => s.level === 'warning'));
});

test('live growth: segments keep extending as reports arrive; reset clears', () => {
  const t = createTimelineTracker();
  feed(t, 0, 2, () => 5);
  const end1 = t.segments[0]!.end;
  feed(t, 2000, 2, () => 5);
  assert.equal(t.segments.length, 1);
  assert.ok(t.segments[0]!.end > end1 + 1900);
  t.reset();
  assert.deepEqual(t.segments, []);
});

test('flaggedParts: a burst that ramps warning → fail → warning counts as one dangerous part', () => {
  const t = createTimelineTracker();
  // Rate ramps 0 → 5 → 0 like the real 1 s window does, twice, 10 s apart.
  const ramp = (ms: number) => {
    const p = ms % 10000;
    if (p < 1000) return 0;
    if (p < 1300) return 2; // rising through warning
    if (p < 4000) return 5;
    if (p < 4300) return 2; // falling through warning
    return 0;
  };
  feed(t, 0, 20, ramp);
  assert.ok(t.segments.length >= 6); // warning, fail, warning per burst
  const parts = flaggedParts(t.segments);
  assert.deepEqual(parts.map((p) => p.level), ['fail', 'fail']);
  assert.ok(Math.abs(parts[0]!.start - 1000) < 40 && Math.abs(parts[0]!.end - 4300) < 60);
});
