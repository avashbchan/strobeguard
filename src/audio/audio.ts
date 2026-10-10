// OWNER: Person C. Unlock the context before the asynchronous share picker.
export type AudioChain = {
  setDelaySeconds(seconds: number): void;
  setBassDb(db: number): void;
  setVolume(volume: number): void;
  dispose(): void;
};
let prepared: AudioContext | null = null;
export function prepareAudioContext(): Promise<void> {
  releasePreparedAudioContext();
  prepared = new AudioContext();
  return prepared.resume();
}
export function releasePreparedAudioContext(): void {
  const context = prepared;
  prepared = null;
  if (context) void context.close().catch(() => {});
}
/** Keeps the frozen stream-only API. Prepare/resume the context on the share click. */
export function createAudioChain(stream: MediaStream): AudioChain | null {
  if (!stream.getAudioTracks().length) {
    releasePreparedAudioContext();
    return null;
  }
  const context = prepared ?? new AudioContext();
  prepared = null;
  let nodes: AudioNode[] = [];
  try {
    const source = context.createMediaStreamSource(stream);
    const delay = context.createDelay(5);
    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 200;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    const gain = context.createGain();
    gain.gain.value = 0; // Silent until the buffer delay is known.
    nodes = [source, delay, bass, limiter, gain];
    source.connect(delay).connect(bass).connect(limiter).connect(gain).connect(context.destination);
    let disposed = false;
    function smooth(param: AudioParam, value: number) {
      if (!disposed && Number.isFinite(value)) param.setTargetAtTime(value, context.currentTime, 0.03);
    }
    return {
      setDelaySeconds: seconds => smooth(delay.delayTime, Math.max(0, Math.min(5, seconds))),
      setBassDb: db => smooth(bass.gain, Math.max(-24, Math.min(0, db))),
      setVolume: volume => smooth(gain.gain, Math.max(0, Math.min(1, volume))),
      dispose() {
        if (disposed) return;
        disposed = true;
        nodes.forEach(node => node.disconnect());
        void context.close().catch(() => {});
      },
    };
  } catch (error) {
    nodes.forEach(node => node.disconnect());
    void context.close().catch(() => {});
    throw error;
  }
}
