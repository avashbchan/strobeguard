import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREVIEW_DEFAULT_WIDTH, PREVIEW_MIN_WIDTH, clampPreviewWidth, dragPreviewWidth, maxPreviewWidth, previewCanvasSize,
} from './previewSize.ts';

test('max width is the smaller of 40% of the stage and 480 px', () => {
  assert.equal(maxPreviewWidth(1000), 400);
  assert.equal(maxPreviewWidth(2000), 480);
  assert.equal(maxPreviewWidth(600), 240);
});

test('min width wins on very small stages', () => {
  assert.equal(maxPreviewWidth(200), PREVIEW_MIN_WIDTH);
  assert.equal(clampPreviewWidth(400, 200), PREVIEW_MIN_WIDTH);
});

test('clamp keeps the chosen width inside [120, max] and re-clamps when the stage shrinks', () => {
  assert.equal(clampPreviewWidth(50, 1000), 120);
  assert.equal(clampPreviewWidth(300, 1000), 300);
  assert.equal(clampPreviewWidth(900, 1000), 400);
  assert.equal(clampPreviewWidth(300, 500), 200); // window shrank: 40% of 500
  assert.equal(clampPreviewWidth(Number.NaN, 1000), PREVIEW_DEFAULT_WIDTH);
});

test('dragging the top-left handle up/left grows, down/right shrinks, following the dominant axis', () => {
  assert.equal(dragPreviewWidth(200, -40, 0), 240); // left
  assert.equal(dragPreviewWidth(200, 30, 0), 170); // right
  assert.equal(Math.round(dragPreviewWidth(200, 0, -18)), 232); // up 18 px = 32 px wider at 16:9
  assert.equal(dragPreviewWidth(200, -10, -90), 200 + 160); // vertical dominates
});

test('canvas resolution follows displayed size × DPR, capped at 640×360', () => {
  assert.deepEqual(previewCanvasSize(176, 1), { width: 176, height: 99 });
  assert.deepEqual(previewCanvasSize(176, 2), { width: 352, height: 198 });
  assert.deepEqual(previewCanvasSize(480, 2), { width: 640, height: 360 });
});
