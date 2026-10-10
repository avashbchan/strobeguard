// Session risk timeline: turns the stream of input RiskReports into flagged time segments.
// Pure (no DOM). Levels mirror EA IRIS's per-frame grades so the two can be compared:
//   fail     > 3 flashes/s over >= 25% of the screen, or a dangerous red flash (IRIS "flash failure")
//   warning  >= 2 flashes/s (IRIS warns at 4 transitions/s)
//   extended warning-or-worse for > 4 s within the last 5 s (IRIS "extended failure")
// Only segments are kept (plus 5 s of recent samples), so hours-long streams stay small.

import type { RiskReport } from '../types.ts';

export type TimelineLevel = 'warning' | 'extended' | 'fail';
/** Times in ms since the session started. `end` is the time of the last sample in the segment. */
export type TimelineSegment = { start: number; end: number; level: TimelineLevel };

export const FAIL_RATE = 3; // flashes/s, strictly above
export const WARNING_RATE = 2; // flashes/s, at or above
export const EXTENDED_AFTER_MS = 4000;
export const EXTENDED_WINDOW_MS = 5000;
/** Same-level samples closer than this join one segment, so a one-frame dip doesn't split it. */
export const BRIDGE_MS = 250;

/** Instantaneous level of one report, ignoring the extended rule. */
export function reportLevel(r: Pick<RiskReport, 'flashesPerSec' | 'redRisk'>): 'warning' | 'fail' | null {
  if (r.flashesPerSec > FAIL_RATE || r.redRisk >= 1) return 'fail';
  if (r.flashesPerSec >= WARNING_RATE) return 'warning';
  return null;
}

const RANK: Record<TimelineLevel, number> = { warning: 1, extended: 2, fail: 3 };

/**
 * Joins touching segments into "flagged parts", each labelled with its worst level. A dangerous burst
 * ramps through warning on the way up and down; that is one part to a viewer, not three.
 */
export function flaggedParts(segments: readonly TimelineSegment[]): TimelineSegment[] {
  const parts: TimelineSegment[] = [];
  for (const s of segments) {
    const last = parts[parts.length - 1];
    if (last && s.start - last.end <= BRIDGE_MS) {
      last.end = Math.max(last.end, s.end);
      if (RANK[s.level] > RANK[last.level]) last.level = s.level;
    } else {
      parts.push({ ...s });
    }
  }
  return parts;
}

export type TimelineTracker = {
  /** Add one report at `tMs` (ms since session start, non-decreasing). */
  push(report: Pick<RiskReport, 'flashesPerSec' | 'redRisk'>, tMs: number): void;
  readonly segments: readonly TimelineSegment[];
  reset(): void;
};

export function createTimelineTracker(): TimelineTracker {
  let segments: TimelineSegment[] = [];
  // Recent samples for the extended rule: [time, flagged].
  let recent: [number, boolean][] = [];

  /** Time spent at warning-or-worse within the last EXTENDED_WINDOW_MS (each sample holds until the next). */
  function flaggedMs(now: number): number {
    let total = 0;
    for (let i = 0; i < recent.length; i++) {
      const [t, flagged] = recent[i]!;
      const next = recent[i + 1]?.[0] ?? now;
      if (flagged) total += next - Math.max(t, now - EXTENDED_WINDOW_MS);
    }
    return total;
  }

  return {
    push(report, tMs) {
      const base = reportLevel(report);
      recent.push([tMs, base !== null]);
      while (recent.length > 1 && recent[1]![0] <= tMs - EXTENDED_WINDOW_MS) recent.shift();

      let level: TimelineLevel | null = base;
      if (base === 'warning' && flaggedMs(tMs) > EXTENDED_AFTER_MS) level = 'extended';
      if (level === null) return;

      const last = segments[segments.length - 1];
      if (last && last.level === level && tMs - last.end <= BRIDGE_MS) last.end = tMs;
      else segments.push({ start: tMs, end: tMs, level });
    },
    get segments() {
      return segments;
    },
    reset() {
      segments = [];
      recent = [];
    },
  };
}
