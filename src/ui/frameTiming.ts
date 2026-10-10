export type FrameTiming = { mediaTime: number; presentedFrames: number };
/** A smoothed source rate, counting presented frames skipped between callbacks. */
export function smoothFrameRate(fps: number, previous: FrameTiming, next: FrameTiming): number {
  const elapsed = next.mediaTime - previous.mediaTime;
  const frames = next.presentedFrames - previous.presentedFrames;
  const sample = frames / elapsed;
  return elapsed > 0 && frames > 0 && sample >= 1 && sample <= 240
    ? fps + 0.15 * (sample - fps) : fps;
}
