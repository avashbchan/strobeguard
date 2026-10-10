import { useEffect, useRef, useState } from 'react';
import type { RiskReport } from '../types';
import { createTimelineTracker, flaggedParts, type TimelineLevel, type TimelineSegment } from '../detector/timeline.ts';

// Session timeline of flagged flashing: starts when sharing starts and grows while the stream runs,
// so it works for finished videos and endless livestreams alike. The whole bar always spans 0 → now.

const LABEL: Record<TimelineLevel, string> = { fail: 'high risk', extended: 'sustained caution', warning: 'caution' };
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]; // seconds

export const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? h + ':' : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};

export function RiskTimeline({ report, sessionKey }: { report: RiskReport | null; sessionKey: unknown }) {
  const tracker = useRef(createTimelineTracker());
  const startedAt = useRef(performance.now());
  const lastFrame = useRef(-1);
  const [now, setNow] = useState(0);

  // New capture → new timeline.
  useEffect(() => {
    tracker.current.reset();
    startedAt.current = performance.now();
    lastFrame.current = -1;
    setNow(0);
  }, [sessionKey]);

  useEffect(() => {
    if (!report || report.frameIndex === lastFrame.current) return;
    lastFrame.current = report.frameIndex;
    tracker.current.push(report, performance.now() - startedAt.current);
  }, [report]);

  // Redraw four times a second; the bar grows even while nothing is flagged.
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now() - startedAt.current), 250);
    return () => clearInterval(id);
  }, []);

  const total = Math.max(now, 1000);
  const segments: readonly TimelineSegment[] = tracker.current.segments;
  const step = (TICK_STEPS.find((s) => (total / 1000) / s <= 6) ?? 3600) * 1000;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);
  // Count "parts" (touching segments joined, worst level wins) so one burst reads as one part.
  const parts = flaggedParts(segments);
  const counts = { fail: 0, extended: 0, warning: 0 };
  parts.forEach((p) => counts[p.level]++);
  const summary = parts.length
    ? `${parts.length} flagged part${parts.length === 1 ? '' : 's'} (` +
      (['fail', 'extended', 'warning'] as const).filter((l) => counts[l]).map((l) => `${counts[l]} ${LABEL[l]}`).join(', ') + ')'
    : 'Nothing flagged yet';

  return (
    <figure className="timeline">
      <figcaption>
        <h2>Session timeline</h2>
        <span>{fmt(now)} · {summary}</span>
      </figcaption>
      <div className="timeline-bar" data-now={Math.round(now)}>
        {segments.map((s) => (
          <span
            key={`${s.level}-${s.start}`}
            className={`timeline-seg level-${s.level}`}
            data-level={s.level}
            data-start={Math.round(s.start)}
            data-end={Math.round(s.end)}
            style={{ left: `${(s.start / total) * 100}%`, width: `${(Math.max(s.end - s.start, 0) / total) * 100}%` }}
            title={`${fmt(s.start)}–${fmt(s.end)} ${LABEL[s.level]}`}
          />
        ))}
        <span className="timeline-now" aria-hidden="true" />
      </div>
      <div className="timeline-ticks" aria-hidden="true">
        {ticks.map((t) => <span key={t} style={{ left: `${(t / total) * 100}%` }}>{fmt(t)}</span>)}
      </div>
      <ul className="timeline-parts" aria-label="Flagged parts of this session">
        {parts.map((p) => <li key={`${p.level}-${p.start}`}>{fmt(p.start)} to {fmt(p.end)}: {LABEL[p.level]}</li>)}
      </ul>
      {parts.length > 0 && (
        <ul className="timeline-legend" aria-label="Timeline key">
          <li><span className="tl-swatch level-fail" />High risk (over 3 flashes/s, or red flashing)</li>
          <li><span className="tl-swatch level-extended" />Sustained caution (2–3 flashes/s for over 4 s)</li>
          <li><span className="tl-swatch level-warning" />Caution (2–3 flashes/s)</li>
        </ul>
      )}
    </figure>
  );
}
