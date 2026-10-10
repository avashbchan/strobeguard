/** Drive the buffer by elapsed time, including duplicate frames from static sources. */
export function createFrameClock(sourceRate: number) {
  const rate = Number.isFinite(sourceRate) && sourceRate > 0 ? Math.min(30, sourceRate) : 30;
  const interval = 1000 / rate;
  let nextAt: number | null = null;
  let sampleAt = 0;
  let count = 0;
  let measuredFps = rate;
  return {
    get measuredFps() { return measuredFps; },
    tick(now: number): boolean {
      if (nextAt === null) {
        nextAt = now + interval;
        sampleAt = now;
        return true;
      }
      if (now + 0.01 < nextAt) return false;
      // Preserve cadence without catch-up bursts after a stalled/background tab.
      nextAt += (Math.floor(Math.max(0, now - nextAt) / interval) + 1) * interval;
      count++;
      const elapsed = now - sampleAt;
      if (elapsed >= 500) {
        measuredFps += 0.3 * (count * 1000 / elapsed - measuredFps);
        sampleAt = now;
        count = 0;
      }
      return true;
    },
  };
}
