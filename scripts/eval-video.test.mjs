import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipId, clipMetrics, displayedDamped, totals } from './eval-video.mjs';

/** displayed-frame flags from a string like "..XXXX..": X = damped. */
const frames = (s) => Uint8Array.from([...s].map((c) => (c === 'X' ? 1 : 0)));

test('clipId gives short ASCII ids', () => {
  assert.equal(clipId('C:/x/Screen Recording 2026-10-10 at 4.34.51\u202fAM.mp4'), '4.34.51-AM');
  assert.equal(clipId('C:/x/Screen Recording 2026-10-10 at 4.34.51ΓÇ»AM.mp4'), '4.34.51-AM');
  assert.equal(clipId('C:/x/salvia simulation.mp4'), 'salvia-simulation');
});

test('displayed frame k uses the damping computed for frame k + 14 (clamped to the last)', () => {
  const flags = new Uint8Array(40);
  flags[30] = 1; // the detector is damping from input frame 30 on
  for (let i = 30; i < 40; i++) flags[i] = 1;
  const d = displayedDamped(flags);
  assert.equal(d[15], 0); // sees frame 29: not damped yet
  assert.equal(d[16], 1); // sees frame 30
  assert.equal(d[39], 1); // clamped to the last frame
});

test('undamped frames per event: counts from the label start to the first damped displayed frame', () => {
  // fps 10, 40 frames. Label 1.0–3.0 s = frames 10–30. First damped displayed frame is 14 → 4 undamped.
  const d = frames('..........' + '....XXXXXXXXXXXXXXXX' + '..........');
  const m = clipMetrics(d, 10, [[1, 3]]);
  assert.equal(m.events.length, 1);
  assert.equal(m.events[0].undamped, 4);
  assert.equal(m.events[0].missed, false);
});

test('an event that is already damped when it starts has 0 undamped frames; a missed one counts to its end', () => {
  const d = frames('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
  assert.equal(clipMetrics(d, 10, [[1, 3]]).events[0].undamped, 0);
  const none = clipMetrics(frames('.'.repeat(40)), 10, [[1, 3]]);
  assert.equal(none.events[0].undamped, 20);
  assert.equal(none.events[0].missed, true);
});

test('recall counts whole labelled seconds with ≥ 50% damped frames', () => {
  // fps 10, 5 s. Label 1–4 s: seconds 1, 2, 3. Second 1: 4/10 damped (miss), 2: 5/10 (hit), 3: 10/10 (hit).
  const d = frames('.'.repeat(10) + '......XXXX' + 'XXXXX.....' + 'XXXXXXXXXX' + '..........');
  const m = clipMetrics(d, 10, [[1, 4]]);
  assert.equal(m.dangerSeconds, 3);
  assert.equal(m.hitSeconds, 2);
});

test('a label shorter than a whole second adds no recall seconds but still counts as an event', () => {
  const m = clipMetrics(frames('.'.repeat(30)), 10, [[1.2, 1.7]]);
  assert.equal(m.dangerSeconds, 0);
  assert.equal(m.events.length, 1);
});

test('strict false damping counts any damped frame in a second touching no label', () => {
  // fps 10, 5 s, label 2–3 s. Damped frame in second 0 (false), in second 2 (inside the label: ignored),
  // and in second 3 (touches no label: false in the strict count).
  const d = frames('.X........' + '..........' + 'XXXXXXXXXX' + '.....X....' + '..........');
  const m = clipMetrics(d, 10, [[2, 3]]);
  assert.equal(m.strictSafeSeconds, 4); // seconds 0, 1, 3, 4
  assert.equal(m.strictFalseSeconds, 2); // seconds 0 and 3
});

test('settle margin: damping 1 s before and 2 s after a label is not a false alarm', () => {
  // fps 10, 12 s, label 4–5 s. Margin covers seconds 3 .. 6 (1 s before, 2 s after: [3,7)), so seconds
  // 3, 5 and 6 are not safe. A damped frame in second 3 (look-ahead) and in second 6 (release) are fine;
  // a damped frame in second 1 and in second 8 are false.
  const d = frames('..........' + '.X........' + '..........' + '.X........' + 'XXXXXXXXXX' + '..........' + '.X........' + '..........' + '.X........' + '..........' + '..........' + '..........');
  const m = clipMetrics(d, 10, [[4, 5]]);
  assert.equal(m.safeSeconds, 12 - 4); // seconds 3,4,5,6 excluded
  assert.equal(m.falseSeconds, 2); // seconds 1 and 8
  assert.equal(m.strictFalseSeconds, 4); // seconds 1, 3, 6 and 8 touch no label
});

test('a label with [] never counts anything as dangerous: every second is safe', () => {
  const m = clipMetrics(frames('.'.repeat(30) + 'X'), 10, []);
  assert.equal(m.dangerSeconds, 0);
  assert.equal(m.safeSeconds, 3);
  assert.equal(m.falseSeconds, 0); // the damped frame is in the partial last second, which isn't counted
});

test('totals pool seconds and events across clips', () => {
  const a = clipMetrics(frames('.'.repeat(50)), 10, [[1, 3]]); // missed: 20 undamped, 2 danger s, 0 hit
  const b = clipMetrics(frames('X'.repeat(50)), 10, []); // 5 safe s, all false
  const t = totals([a, b]);
  assert.equal(t.dangerSeconds, 2);
  assert.equal(t.recall, 0);
  // a: label 1–3 s on a 5 s clip → margin [0, 5) leaves no safe second; b: no label → 5 safe seconds, all false.
  assert.equal(t.safeSeconds, 0 + 5);
  assert.equal(t.falseSeconds, 5);
  assert.equal(t.falsePerSafeMinute, 5 / (5 / 60));
  assert.equal(t.strictSafeSeconds, 3 + 5);
  assert.equal(t.events, 1);
  assert.equal(t.missedEvents, 1);
  assert.equal(t.undamped.worst, 20);
});
