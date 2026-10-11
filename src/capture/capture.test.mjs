import test from 'node:test';
import assert from 'node:assert/strict';
import { startCapture } from './capture.ts';
test('capture cleans up on playback failure, external end, and repeated stop', async () => {
  let current;
  let fail = false;
  let endedCount = 0;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = globalThis.document;
  class Track extends EventTarget {
    readyState = 'live';
    stopped = 0;
    stop() { this.readyState = 'ended'; this.stopped++; }
    // startCapture reads the track settings and re-applies constraints (audio fix #28).
    getSettings() { return {}; }
    async applyConstraints() {}
  }
  const makeStream = () => {
    const video = new Track(), audio = new Track();
    return { video, audio, getVideoTracks: () => [video], getAudioTracks: () => [audio], getTracks: () => [video, audio] };
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getDisplayMedia: async () => current,
  } } });
  globalThis.document = { createElement: () => ({ play: async () => { if (fail) throw new Error('play failed'); }, pause() {}, srcObject: null }) };
  try {
    current = makeStream(); fail = true;
    await assert.rejects(startCapture(() => {}), /play failed/);
    assert.equal(current.video.stopped, 1); assert.equal(current.audio.stopped, 1);
    current = makeStream(); fail = false;
    const capture = await startCapture(() => endedCount++);
    assert.equal(capture.hasAudio, true);
    current.video.dispatchEvent(new Event('ended'));
    assert.equal(endedCount, 1);
    assert.equal(current.audio.stopped, 1);
    assert.equal(capture.video.srcObject, null);
    capture.stop();
    assert.equal(current.video.stopped, 1);
    current = makeStream();
    const stopped = await startCapture(() => endedCount++);
    stopped.stop(); stopped.stop();
    assert.equal(current.video.stopped, 1);
    assert.equal(endedCount, 1, 'manual stop does not deliver a stale external-ended callback');
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    globalThis.document = originalDocument;
  }
});
