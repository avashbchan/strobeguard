// Size rules for the resizable "Original" preview (pure, so they can be unit-tested).
// The original stream is unfiltered, so it must stay a small preview: width is clamped to
// [MIN, min(40% of the stage, 480 px)], and re-clamped whenever the stage shrinks.

export const PREVIEW_DEFAULT_WIDTH = 176;
export const PREVIEW_MIN_WIDTH = 120;
export const PREVIEW_MAX_WIDTH = 480;
export const PREVIEW_MAX_STAGE_FRACTION = 0.4;
export const PREVIEW_ASPECT = 16 / 9;
export const PREVIEW_KEY_STEP = 16;
/** Canvas backing-store cap: enough for a sharp 480 px preview at 1.33×, never full-size. */
export const PREVIEW_MAX_CANVAS = { width: 640, height: 360 };

/** Largest allowed width for a stage of this width. MIN wins on very small stages. */
export function maxPreviewWidth(stageWidth: number): number {
  const byStage = Number.isFinite(stageWidth) && stageWidth > 0 ? stageWidth * PREVIEW_MAX_STAGE_FRACTION : PREVIEW_MAX_WIDTH;
  return Math.max(PREVIEW_MIN_WIDTH, Math.min(byStage, PREVIEW_MAX_WIDTH));
}

export function clampPreviewWidth(width: number, stageWidth: number): number {
  const w = Number.isFinite(width) ? width : PREVIEW_DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(w, PREVIEW_MIN_WIDTH), maxPreviewWidth(stageWidth)));
}

/**
 * Width while dragging the TOP-LEFT handle of a bottom-right-anchored preview.
 * Moving up/left grows it, down/right shrinks it. With a fixed 16:9 ratio, follow whichever
 * axis moved further (in width units), so the corner tracks the pointer on that axis.
 */
export function dragPreviewWidth(startWidth: number, dx: number, dy: number): number {
  const byX = -dx;
  const byY = -dy * PREVIEW_ASPECT;
  return startWidth + (Math.abs(byX) >= Math.abs(byY) ? byX : byY);
}

/** Backing-store size for a displayed width: width × devicePixelRatio, capped at 640×360. */
export function previewCanvasSize(displayWidth: number, dpr: number): { width: number; height: number } {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const width = Math.min(PREVIEW_MAX_CANVAS.width, Math.round(displayWidth * ratio));
  return { width, height: Math.min(PREVIEW_MAX_CANVAS.height, Math.round(width / PREVIEW_ASPECT)) };
}
