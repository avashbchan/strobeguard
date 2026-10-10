// OWNER: Person C (audio + UI).
// STUB: no audio processing yet. Milestone 6 replaces this with
// source → DelayNode → low-shelf Biquad → DynamicsCompressor → Gain → destination.

export type AudioChain = {
  setDelaySeconds(seconds: number): void;
  setBassDb(db: number): void;
  setVolume(volume: number): void;
  dispose(): void;
};

/** Returns null when the shared tab has no audio track. Must be called from a user click. */
export function createAudioChain(stream: MediaStream): AudioChain | null {
  if (stream.getAudioTracks().length === 0) return null;
  return {
    setDelaySeconds() {},
    setBassDb() {},
    setVolume() {},
    dispose() {},
  };
}
