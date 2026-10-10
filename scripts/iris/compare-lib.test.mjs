import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVideo, estimateFps, ourGrades, parseIrisCsv, parseTimestamp, segments, verdict } from './compare-lib.mjs';

const EXPECTED = `Frame,TimeStamp,AverageLuminance,FlashAreaLuminance,AverageLuminanceDiff,AverageLuminanceDiffAcc,AverageRed,FlashAreaRed,AverageRedDiff,AverageRedDiffAcc,PatternRisk,LuminanceTransitions,RedTransitions,LuminanceExtendedFailCount,RedExtendedFailCount,FlashLuminanceFailedFrame,FlashRedFailedFrame,PatternFailedFrame
1,00:00.0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
2,00:00.0,1,1,1,1,0,0,0,0,0,7,0,0,0,3,0,0
3,00:00.1,0,1,-1,-1,0,0,0,0,0,7,0,0,0,3,0,1`;

const APP = `Frame,TimeStamp,AverageLuminance,FlashAreaLuminance,AverageLuminanceDiff,AverageLuminanceDiffAcc,AverageRed,FlashAreaRed,AverageRedDiff,AverageRedDiffAcc,LuminanceTransitions,RedTransitions,LuminanceExtendedFailCount,RedExtendedFailCount,LuminanceFrameResult,RedFrameResult,PatternArea,PatternDetectedLines,PatternFrameResult
1,00:00:00.000000,0.000000,0.00%,0.000000,0.000000,0.000000,0.00%,0.000000,0.000000,0,0,0,0,0,0,0.00%,0,0
2,00:00:00.040000,1.000000,100.00%,1.000000,1.000000,0.000000,0.00%,0.000000,0.000000,4,0,1,0,2,0,0.00%,0,0 `;

test('parseTimestamp handles both IRIS formats', () => {
  assert.equal(parseTimestamp('00:00.4'), 0.4);
  assert.ok(Math.abs(parseTimestamp('00:01:02.040000') - 62.04) < 1e-9);
});

test('parseIrisCsv reads expected-CSV and app-CSV column names', () => {
  const e = parseIrisCsv(EXPECTED);
  assert.deepEqual(e.map((f) => [f.frame, f.lum, f.red, f.pattern, f.lumTransitions]), [[1, 0, 0, 0, 0], [2, 3, 0, 0, 7], [3, 3, 0, 1, 7]]);
  const a = parseIrisCsv(APP);
  assert.deepEqual(a.map((f) => [f.frame, f.lum, f.lumTransitions]), [[1, 0, 0], [2, 2, 4]]);
  assert.ok(Math.abs(estimateFps(a) - 25) < 1e-6);
});

test('ourGrades maps flash rates onto the IRIS scale', () => {
  assert.deepEqual(ourGrades([0, 0, 0, 0, 0, 0]), { lum: 0, red: 0 });
  assert.deepEqual(ourGrades([0, 0, 2, 0.33, 0, 0]), { lum: 1, red: 0 });
  assert.deepEqual(ourGrades([0, 0, 4, 1, 1, 1]), { lum: 3, red: 3 });
});

test('verdict: fail beats warning beats pass', () => {
  assert.equal(verdict([{ lum: 0, red: 0, pattern: 0 }]), 'PASS');
  assert.equal(verdict([{ lum: 1, red: 0, pattern: 0 }]), 'WARN');
  assert.equal(verdict([{ lum: 2, red: 0, pattern: 0 }]), 'FAIL');
  assert.equal(verdict([{ lum: 0, red: 0, pattern: 1 }]), 'FAIL');
});

test('segments groups contiguous frames, end-exclusive, in seconds', () => {
  const g = [0, 3, 3, 0, 1, 1].map((lum) => ({ lum }));
  assert.deepEqual(segments(g, 2, (x) => x.lum >= 1), [{ start: 0.5, end: 1.5 }, { start: 2, end: 3 }]);
});

test('compareVideo aligns IRIS frame n with our frame n-1 and scores agreement', () => {
  const iris = parseIrisCsv(EXPECTED);
  const ours = [[0, 0, 0, 0, 0, 0], [1, 40, 0, 0, 0, 0], [2, 80, 4, 1, 0, 1]];
  const r = compareVideo(iris, ours, 25);
  assert.equal(r.coverage, 1);
  assert.deepEqual(r.fail, { tp: 1, fp: 0, fn: 1, tn: 1 });
  assert.equal(r.onsetDelaySec, 1 / 25); // we fail one frame later
  assert.equal(r.irisVerdict, 'FAIL');
  assert.equal(r.ourVerdict, 'FAIL');
  assert.equal(r.patternFrames, 1);
});
