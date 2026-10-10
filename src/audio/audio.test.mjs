import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioChain, prepareAudioContext, releasePreparedAudioContext } from './audio.ts';
test('audio uses the required chain, smooth controls, bounds, and idempotent disposal', async () => {
  const contexts = [];
  class Param {
    value = 0;
    changes = [];
    setTargetAtTime(value, time, constant) { this.changes.push({ value, time, constant }); }
  }
  class Node {
    connections = [];
    disconnected = 0;
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.disconnected++; }
  }
  class Context {
    currentTime = 1;
    closed = 0;
    resumed = 0;
    destination = new Node();
    nodes = [];
    constructor() { contexts.push(this); }
    resume() { this.resumed++; return Promise.resolve(); }
    close() { this.closed++; return Promise.resolve(); }
    createMediaStreamSource() { const node = new Node(); this.nodes.push(node); return node; }
    createDelay(max) { const node = new Node(); node.delayTime = new Param(); node.max = max; this.nodes.push(node); return node; }
    createBiquadFilter() { const node = new Node(); node.frequency = new Param(); node.gain = new Param(); this.nodes.push(node); return node; }
    createDynamicsCompressor() { const node = new Node(); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param(); this.nodes.push(node); return node; }
    createGain() { const node = new Node(); node.gain = new Param(); this.nodes.push(node); return node; }
  }
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const ready = prepareAudioContext();
    assert.equal(contexts[0].resumed, 1, 'resume begins synchronously on the gesture');
    await ready;
    const chain = createAudioChain({ getAudioTracks: () => [{}] });
    const context = contexts[0];
    const [source, delay, bass, limiter, gain] = context.nodes;
    assert.equal(source.connections[0], delay);
    assert.equal(delay.connections[0], bass);
    assert.equal(bass.connections[0], limiter);
    assert.equal(limiter.connections[0], gain);
    assert.equal(gain.connections[0], context.destination);
    assert.equal(bass.type, 'lowshelf');
    assert.equal(bass.frequency.value, 200);
    assert.equal(limiter.ratio.value, 20);
    chain.setDelaySeconds(14 / 30);
    assert.equal(delay.delayTime.changes.at(-1).value, 14 / 30);
    chain.setDelaySeconds(14 / 60);
    assert.equal(delay.delayTime.changes.at(-1).value, 14 / 60);
    chain.setBassDb(-12);
    assert.equal(bass.gain.changes.at(-1).value, -12);
    chain.setVolume(0.7);
    assert.equal(gain.gain.changes.at(-1).value, 0.7);
    chain.setVolume(2);
    assert.equal(gain.gain.changes.at(-1).value, 1);
    chain.setDelaySeconds(NaN);
    assert.equal(delay.delayTime.changes.length, 2);
    chain.dispose(); chain.dispose();
    assert.equal(context.closed, 1);
    assert.ok(context.nodes.every(node => node.disconnected === 1));
    const changes = gain.gain.changes.length;
    chain.setVolume(0.9);
    assert.equal(gain.gain.changes.length, changes);
    await prepareAudioContext();
    assert.equal(createAudioChain({ getAudioTracks: () => [] }), null);
    assert.equal(contexts[1].closed, 1, 'video-only sharing releases unused context');
    await prepareAudioContext();
    releasePreparedAudioContext(); releasePreparedAudioContext();
    assert.equal(contexts[2].closed, 1, 'cancel releases prepared context');
  } finally { globalThis.AudioContext = original; }
});
