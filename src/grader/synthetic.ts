// Deterministic synthetic test scenes for the grader, drawn frame by frame on a canvas.
// Each scene is a colourful, slowly moving picture with fine detail (so colour loss, blur and
// ghosting are measurable) plus flashes added as stage light ('lighter' compositing), so the
// scene's detail still shows through a flash, as with real strobes.
//
// Scenes (what each one tests):
//   red-full     saturated red strobe over the whole frame, 5 Hz        → red-flash handling
//   red-area     red strobe over ~35% of the frame, 4 Hz                 → red, part of the screen
//   small-flash  white strobe over 12.5% of the frame (6 grid cells), 5 Hz → under 25%: not dangerous
//   small-unaligned  same idea, ~15% straddling cell edges (touches 12 cells) → the cell-grid area over-count
//   area-30      white strobe over ~30% of the frame, 5 Hz (just over)  → the 25% area rule
//   caution      full-frame white flash at 2.5 Hz                       → the 2–3 Hz caution band
//   dark-strobe  dim, detailed scene with a bright 5 Hz strobe          → grey veil / haze on dark content
//   mixed        calm half + flashing coloured lasers half, 6 Hz        → collateral beside a strobe

export const SYNTHETIC_SCENES = ['red-full', 'red-area', 'small-flash', 'small-unaligned', 'area-30', 'caution', 'dark-strobe', 'mixed'] as const;
export type SyntheticScene = (typeof SYNTHETIC_SCENES)[number];

export const SYN_W = 1280;
export const SYN_H = 720;

const on = (t: number, hz: number) => (t * hz) % 1 < 0.5;

/** Base picture: gradient, drifting coloured discs, stripes and a checker patch for edges. */
function base(ctx: CanvasRenderingContext2D, t: number, dark: boolean, x0 = 0, x1 = SYN_W) {
  const g = ctx.createLinearGradient(0, 0, 0, SYN_H);
  g.addColorStop(0, dark ? '#05060c' : '#1d2b64');
  g.addColorStop(1, dark ? '#120714' : '#5b2a6e');
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, x1 - x0, SYN_H);
  const colours = dark
    ? ['#3a1f10', '#0f2a1a', '#101c3a', '#2e0f2a', '#2a2a0c', '#0c2a2a']
    : ['#ff7a1a', '#22c55e', '#3b82f6', '#e11d74', '#facc15', '#14b8a6'];
  for (let k = 0; k < 6; k++) {
    const cx = x0 + ((k + 0.5) / 6) * (x1 - x0) + Math.sin(t * 0.7 + k) * 40;
    const cy = SYN_H * (0.3 + 0.4 * ((k % 3) / 2)) + Math.cos(t * 0.5 + k * 1.3) * 30;
    ctx.fillStyle = colours[k]!;
    ctx.beginPath();
    ctx.arc(cx, cy, 60 + 10 * (k % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  // Fine stripes and a checker patch: high-frequency detail that blur and ghosting would destroy.
  ctx.fillStyle = dark ? '#2a2f3a' : '#f1f5f9';
  for (let y = 40; y < 120; y += 8) ctx.fillRect(x0 + 40, y, Math.min(400, x1 - x0 - 80), 3);
  const cs = 12;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
    if ((r + c) % 2) continue;
    const x = x0 + (x1 - x0) - 200 + c * cs + Math.round(Math.sin(t) * 6);
    if (x + cs <= x1) ctx.fillRect(x, SYN_H - 140 + r * cs, cs, cs);
  }
}

/** Adds light over a rectangle (or the whole frame), like a stage light hitting the scene. */
function flash(ctx: CanvasRenderingContext2D, colour: string, alpha: number, x = 0, y = 0, w = SYN_W, h = SYN_H) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Draws scene `name` at time t (seconds). */
export function drawScene(ctx: CanvasRenderingContext2D, name: SyntheticScene, t: number) {
  switch (name) {
    case 'red-full':
      base(ctx, t, false);
      if (on(t, 5)) flash(ctx, '#ff0000', 0.95);
      break;
    case 'red-area': {
      base(ctx, t, false);
      // ~35% of the frame: 0.59 × 0.59.
      if (on(t, 4)) flash(ctx, '#ff0000', 0.95, SYN_W * 0.2, SYN_H * 0.2, SYN_W * 0.59, SYN_H * 0.59);
      break;
    }
    case 'small-flash':
      base(ctx, t, false);
      // Exactly 2 × 3 detector cells (8×6 grid), so it covers 6 of 48 cells = 12.5%.
      if (on(t, 5)) flash(ctx, '#ffffff', 0.9, SYN_W * 0.25, SYN_H * (1 / 6), SYN_W * 0.25, SYN_H * 0.5);
      break;
    case 'small-unaligned':
      base(ctx, t, false);
      if (on(t, 5)) flash(ctx, '#ffffff', 0.9, SYN_W * 0.05, SYN_H * 0.08, SYN_W * 0.39, SYN_H * 0.39); // ~15%, 12 cells touched
      break;
    case 'area-30':
      base(ctx, t, false);
      if (on(t, 5)) flash(ctx, '#ffffff', 0.9, SYN_W * 0.05, SYN_H * 0.05, SYN_W * 0.55, SYN_H * 0.55); // ~30%
      break;
    case 'caution':
      base(ctx, t, false);
      if (on(t, 2.5)) flash(ctx, '#ffffff', 0.85);
      break;
    case 'dark-strobe':
      base(ctx, t, true);
      if (on(t, 5)) flash(ctx, '#fff6e0', 0.85, 0, 0, SYN_W, SYN_H * 0.75); // light rig over most of the frame
      break;
    case 'mixed': {
      base(ctx, t, false, 0, SYN_W / 2); // calm half
      ctx.fillStyle = '#05050a';
      ctx.fillRect(SYN_W / 2, 0, SYN_W / 2, SYN_H);
      if (on(t, 6)) {
        // Coloured laser fan, clipped to the right half so the left half stays calm.
        ctx.save();
        ctx.beginPath();
        ctx.rect(SYN_W / 2, 0, SYN_W / 2, SYN_H);
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        const laser = ['#00ff6a', '#ff00c8', '#00c8ff', '#fff200'];
        for (let k = 0; k < 14; k++) {
          ctx.strokeStyle = laser[k % 4]!;
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.moveTo(SYN_W * 0.75, SYN_H);
          const a = -Math.PI * (0.15 + (0.7 * k) / 13) + Math.sin(t) * 0.05;
          ctx.lineTo(SYN_W * 0.75 + Math.cos(a) * 900, SYN_H + Math.sin(a) * 900);
          ctx.stroke();
        }
        ctx.restore();
        flash(ctx, '#ffffff', 0.35, SYN_W / 2, 0, SYN_W / 2, SYN_H);
      }
      break;
    }
  }
}
