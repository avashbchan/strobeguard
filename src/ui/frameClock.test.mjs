import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameClock } from './frameClock.ts';

for (const displayHz of [60, 120]) {
  test('30 fps cadence survives ±1 ms rAF jitter at ' + displayHz + ' Hz for 10 seconds', () => {
    const clock = createFrameClock(30);
    const ticks = [];
    let seed = 12345;
    for (let frame = 0; frame <= displayHz * 10; frame++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const jitter = seed / 0x100000000 * 2 - 1;
      const now = frame === 0 ? 0 : frame * 1000 / displayHz + jitter;
      if (clock.tick(now)) ticks.push(now);
    }
    assert.ok(ticks.length >= 290 && ticks.length <= 310, 'accepted ' + ticks.length + ' ticks');
    const gaps = ticks.slice(1).map((time, index) => time - ticks[index]);
    assert.ok(Math.max(...gaps) <= 40, 'largest gap ' + Math.max(...gaps) + ' ms');
    assert.ok(Math.abs(clock.measuredFps - 30) <= 1, 'measured ' + clock.measuredFps + ' fps');
  });
}

test('static pixels still get 30 buffer ticks per second at common display rates', () => {
  for (const displayHz of [60, 120, 144]) {
    const clock = createFrameClock(30);
    const ticks = [];
    for (let frame = 0; frame <= displayHz * 3; frame++) {
      const now = frame * 1000 / displayHz;
      if (clock.tick(now)) ticks.push(now);
    }
    assert.ok(ticks.length >= 89 && ticks.length <= 91, displayHz + ' Hz cadence');
    assert.ok(Math.abs(ticks[14] - 14 * 1000 / 30) <= 1000 / displayHz + 0.1);
    assert.ok(Math.abs(clock.measuredFps - 30) < 1);
  }
});
test('cadence caps at 30, honors lower negotiated rates, and avoids catch-up bursts', () => {
  assert.equal(createFrameClock(60).measuredFps, 30);
  assert.equal(createFrameClock(15).measuredFps, 15);
  assert.equal(createFrameClock(NaN).measuredFps, 30);
  const clock = createFrameClock(30);
  assert.equal(clock.tick(0), true);
  assert.equal(clock.tick(16), false);
  assert.equal(clock.tick(2000), true);
  assert.equal(clock.tick(2000), false);
  assert.ok(clock.measuredFps < 30, 'reports slower actual buffer ticks after a stall');
});
