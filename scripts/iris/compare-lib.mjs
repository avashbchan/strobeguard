// Pure helpers for comparing StrobeGuard's detector with EA IRIS, frame by frame.
//
// IRIS grades per frame (luminance and red): 0 pass, 1 warning, 2 extended failure, 3 flash failure.
// Pattern: 0 pass, 1 fail. We map our RiskReports onto the same scale so the two can be compared.

/** IRIS writes "00:00.4" (expected CSVs) or "00:00:00.040000" (app output). Returns seconds. */
export function parseTimestamp(s) {
  return s.trim().split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

/**
 * Parses either IRIS CSV flavour into [{ frame, t, lum, red, pattern, lumTransitions }].
 * Expected CSVs name the grade columns Flash*FailedFrame; the app writes *FrameResult.
 */
export function parseIrisCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.trim());
  const col = (...names) => {
    const i = head.findIndex((h) => names.includes(h));
    if (i < 0) throw new Error(`IRIS CSV is missing column ${names.join(' / ')}`);
    return i;
  };
  const c = {
    frame: col('Frame'), t: col('TimeStamp'), trans: col('LuminanceTransitions'),
    lum: col('LuminanceFrameResult', 'FlashLuminanceFailedFrame'),
    red: col('RedFrameResult', 'FlashRedFailedFrame'),
    pattern: col('PatternFrameResult', 'PatternFailedFrame'),
  };
  return lines.slice(1).map((line) => {
    const v = line.split(',');
    return {
      frame: Number(v[c.frame]), t: parseTimestamp(v[c.t]), lum: Number(v[c.lum]), red: Number(v[c.red]),
      pattern: Number(v[c.pattern]), lumTransitions: Number(v[c.trans]),
    };
  });
}

/** Frame rate from IRIS timestamps (app CSVs have microsecond precision). */
export function estimateFps(frames) {
  const a = frames[0];
  const b = frames[frames.length - 1];
  if (!a || !b || b.t <= a.t) return 30;
  return (b.frame - a.frame) / (b.t - a.t);
}

/**
 * Our report → IRIS-style luminance/red grades.
 * Fail: > 3 flashes/s over >= 25% of the area. Warning: >= 2 flashes/s (IRIS warns at 4 transitions/s).
 * Red fail: redRisk 1 (>= 3 red flashes/s in our scale). We have no extended-failure rule yet (gap G2).
 */
export function ourGrades([, , flashesPerSec, , redRisk]) {
  return {
    lum: flashesPerSec > 3 ? 3 : flashesPerSec >= 2 ? 1 : 0,
    red: redRisk >= 1 ? 3 : redRisk > 0 ? 1 : 0,
  };
}

/** IRIS-style overall result from per-frame grades. */
export function verdict(grades) {
  if (grades.some((g) => g.lum >= 2 || g.red >= 2 || g.pattern >= 1)) return 'FAIL';
  if (grades.some((g) => g.lum === 1 || g.red === 1)) return 'WARN';
  return 'PASS';
}

/** Contiguous runs where pred(grade) holds → [{ start, end }] in seconds (end exclusive). */
export function segments(grades, fps, pred) {
  const out = [];
  let start = null;
  grades.forEach((g, i) => {
    if (pred(g) && start === null) start = i;
    if (!pred(g) && start !== null) { out.push({ start: start / fps, end: i / fps }); start = null; }
  });
  if (start !== null) out.push({ start: start / fps, end: grades.length / fps });
  return out;
}

/** Confusion counts for a yes/no question asked of both sides, frame by frame. */
export function confusion(iris, ours, pred) {
  const m = { tp: 0, fp: 0, fn: 0, tn: 0 };
  iris.forEach((g, i) => {
    const o = ours[i];
    if (!o) return;
    const a = pred(g);
    const b = pred(o);
    if (a && b) m.tp++; else if (!a && b) m.fp++; else if (a && !b) m.fn++; else m.tn++;
  });
  return m;
}

const firstIndex = (arr, pred) => arr.findIndex(pred);

/**
 * Compare one video. `irisFrames` from parseIrisCsv; `ourRows` from the offline runner
 * ([frame0, tMs, flashesPerSec, flashRisk, redRisk, maskMax]). IRIS frame n (1-based) ↔ our frame n-1.
 */
export function compareVideo(irisFrames, ourRows, fps) {
  const byFrame = new Map(ourRows.map((r) => [r[0], r]));
  const iris = [];
  const ours = [];
  for (const f of irisFrames) {
    const r = byFrame.get(f.frame - 1);
    iris.push(f);
    ours.push(r ? { ...ourGrades(r), pattern: 0, rate: r[2] } : null);
  }
  const covered = ours.filter(Boolean).length;
  const fail = (g) => g.lum === 3;
  const flagged = (g) => g.lum >= 2 || g.red >= 2;
  const any = (g) => g.lum >= 1 || g.red >= 1;
  const irisFail = firstIndex(iris, fail);
  const ourFail = firstIndex(ours, (g) => g && fail(g));
  return {
    frames: iris.length,
    coverage: iris.length ? covered / iris.length : 0,
    irisVerdict: verdict(iris),
    ourVerdict: verdict(ours.filter(Boolean)),
    fail: confusion(iris, ours, fail),
    flagged: confusion(iris, ours, flagged),
    any: confusion(iris, ours, any),
    redFlagged: confusion(iris, ours, (g) => g.red >= 2),
    patternFrames: iris.filter((g) => g.pattern >= 1).length,
    extendedFrames: iris.filter((g) => g.lum === 2).length,
    onsetDelaySec: irisFail >= 0 && ourFail >= 0 ? (ourFail - irisFail) / fps : null,
    irisSegments: segments(iris, fps, any).map((s) => ({ ...s, level: maxLevel(iris, s, fps) })),
    ourSegments: segments(ours.map((g) => g ?? { lum: 0, red: 0 }), fps, any).map((s) => ({ ...s, level: maxLevel(ours, s, fps) })),
  };
}

function maxLevel(grades, seg, fps) {
  let m = 0;
  for (let i = Math.round(seg.start * fps); i < Math.round(seg.end * fps); i++) {
    const g = grades[i];
    if (g) m = Math.max(m, g.lum, g.red);
  }
  return ['pass', 'warning', 'extended', 'fail'][m];
}

export const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
