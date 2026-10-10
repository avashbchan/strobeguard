import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothFrameRate } from './frameTiming.ts';
test('FPS measurement handles skipped frames, rate changes, invalid and reset timestamps', () => {
  const previous = { mediaTime: 1, presentedFrames: 30 };
  assert.ok(Math.abs(smoothFrameRate(30, previous, { mediaTime: 1.1, presentedFrames: 33 }) - 30) < 1e-10);
  let fps = 30;
  for (let index = 0; index < 60; index++) fps = smoothFrameRate(fps, previous, { mediaTime: 1.1, presentedFrames: 36 });
  assert.ok(Math.abs(fps - 60) < .01);
  assert.equal(smoothFrameRate(30, previous, previous), 30);
  assert.equal(smoothFrameRate(30, previous, { mediaTime: .5, presentedFrames: 10 }), 30);
  assert.equal(smoothFrameRate(30, previous, { mediaTime: 1.001, presentedFrames: 50 }), 30);
});
