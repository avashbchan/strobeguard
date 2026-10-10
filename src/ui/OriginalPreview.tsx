// The small "Original" (unfiltered) preview, anchored bottom-right of the stage.
// Starts blurred and dimmed ("Unblur original"), can be collapsed to a pill, and can be resized
// from its top-left corner. Width is clamped so the raw stream always stays a small preview.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import {
  PREVIEW_ASPECT, PREVIEW_DEFAULT_WIDTH, PREVIEW_KEY_STEP,
  clampPreviewWidth, dragPreviewWidth, previewCanvasSize,
} from './previewSize';

const STORAGE_KEY = 'strobeguard.originalPreviewWidth';

function readStoredWidth(): number {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : PREVIEW_DEFAULT_WIDTH;
  } catch {
    return PREVIEW_DEFAULT_WIDTH;
  }
}

function storeWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Storage blocked (private mode, policy): the size just isn't remembered.
  }
}

type Props = { video: HTMLVideoElement; stageRef: RefObject<HTMLElement | null> };

export function OriginalPreview({ video, stageRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // The width the viewer chose (remembered). What's shown is this clamped to the current stage.
  const [chosen, setChosen] = useState(readStoredWidth);
  const [stageWidth, setStageWidth] = useState(() => stageRef.current?.clientWidth ?? 0);
  const drag = useRef<{ id: number; x: number; y: number; width: number } | null>(null);
  const latestWidth = useRef(PREVIEW_DEFAULT_WIDTH); // what's on screen now, for saving on pointer-up

  // Track the stage size so the preview re-clamps when the window or layout shrinks.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setStageWidth(stage.clientWidth);
    const ro = new ResizeObserver(() => setStageWidth(stage.clientWidth));
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stageRef]);

  const width = clampPreviewWidth(chosen, stageWidth);
  const height = Math.round(width / PREVIEW_ASPECT);
  latestWidth.current = width;

  // Drawing resolution follows the displayed size (× devicePixelRatio, capped at 640×360).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = previewCanvasSize(width, window.devicePixelRatio || 1);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
  }, [width, collapsed]);

  // Copy the hidden source video into the preview every animation frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let handle = 0;
    const draw = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [video, collapsed]);

  function setWidth(next: number, persist: boolean) {
    const w = clampPreviewWidth(next, stageWidth);
    latestWidth.current = w;
    setChosen(w);
    if (persist) storeWidth(w);
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection / focus jump while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, width };
  }
  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setWidth(dragPreviewWidth(d.width, e.clientX - d.x, e.clientY - d.y), false);
  }
  function onPointerEnd(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    storeWidth(latestWidth.current);
  }
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // The handle is the top-left corner: up/left grows the preview, down/right shrinks it.
    const step = { ArrowLeft: 1, ArrowUp: 1, ArrowRight: -1, ArrowDown: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    setWidth(width + step * PREVIEW_KEY_STEP, true);
  }

  return (
    <figure
      className={`thumb${collapsed ? ' is-collapsed' : ''}${revealed ? ' is-revealed' : ''}`}
      // Double-clicks inside the preview (handle, buttons) must not toggle the stage's fullscreen.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {!collapsed && (
        <button
          className="thumb-resize"
          aria-label="Resize original preview"
          title="Drag to resize · double-click to reset"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
          onDoubleClick={() => setWidth(PREVIEW_DEFAULT_WIDTH, true)}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 7.5l6-6M1.5 11l9.5-9.5M5 11l6-6" /></svg>
        </button>
      )}
      <figcaption className="thumb-head">
        <span className="thumb-label">Original</span>
        {!collapsed && (
          <button className="thumb-icon" onClick={() => setRevealed((v) => !v)} aria-pressed={revealed}
            aria-label={revealed ? 'Blur the original preview' : 'Unblur the original preview'} title={revealed ? 'Blur' : 'Unblur'}>
            {revealed
              ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" /><circle cx="10" cy="10" r="2.5" /><path d="M3 3l14 14" /></svg>
              : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" /><circle cx="10" cy="10" r="2.5" /></svg>}
          </button>
        )}
        <button className="thumb-icon" onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show the original preview' : 'Collapse the original preview'} title={collapsed ? 'Expand' : 'Collapse'}>
          <svg viewBox="0 0 20 20" aria-hidden="true">{collapsed ? <path d="M6 12l4-4 4 4" /> : <path d="M6 8l4 4 4-4" />}</svg>
        </button>
      </figcaption>
      {!collapsed && (
        <div className="thumb-body">
          <canvas ref={canvasRef} style={{ width, height }} aria-label="Small preview of the original, unfiltered stream" />
          {!revealed && <button className="thumb-reveal" onClick={() => setRevealed(true)}>Unblur original</button>}
        </div>
      )}
    </figure>
  );
}
