// Sidebar panels: flash rates + chart, filtered-regions map, risk bars.
// Nothing here may flash: values change through ~400 ms CSS transitions, and the chart is a
// steady line plot (no blinking markers).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { CELL_COUNT, GRID_COLS, type RiskReport } from '../types';

const AMBER = '#bd833b';
const TEAL = '#24a190';
const WINDOW_MS = 10_000;
const LIMIT = 3; // WCAG 2.3.1 general flash threshold

const rate = (r: RiskReport | null) => (r ? Math.max(0, r.flashesPerSec) : null);

type Sample = { time: number; input: number; output: number };

export function RatesPanel({ input, output }: { input: RiskReport | null; output: RiskReport | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ input, output });
  latest.current = { input, output };
  const samples = useRef<Sample[]>([]);
  const hoverX = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const tip = tipRef.current;
    if (!canvas || !ctx || !tip) return;
    let handle = 0;
    let lastKey = '';
    let lastSampleAt = -Infinity;
    let ceiling = 6;
    const draw = (now: number) => {
      const { input: i, output: o } = latest.current;
      const key = `${i?.frameIndex}:${o?.frameIndex}`;
      if (i && o && key !== lastKey && now - lastSampleAt >= 50) {
        lastKey = key;
        lastSampleAt = now;
        samples.current.push({ time: now, input: rate(i) ?? 0, output: rate(o) ?? 0 });
      }
      const list = samples.current;
      while (list.length && list[0]!.time < now - WINDOW_MS) list.shift();

      const width = Math.max(240, canvas.clientWidth);
      const height = canvas.clientHeight || 150;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // Ceiling eases toward its target so the scale never jumps.
      const target = Math.max(6, ...list.map((s) => Math.max(s.input, s.output) * 1.2));
      ceiling += (target - ceiling) * 0.04;
      const left = 22, right = width - 4, top = 8, bottom = height - 22;
      const x = (t: number) => left + Math.max(0, 1 - (now - t) / WINDOW_MS) * (right - left);
      const y = (v: number) => bottom - (v / ceiling) * (bottom - top);

      ctx.font = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#7d8796';
      ctx.fillText('0', 6, bottom + 3);
      ctx.fillText(ceiling.toFixed(0), 6, top + 8);
      ctx.fillText('10 s ago', left, height - 4);
      ctx.textAlign = 'right';
      ctx.fillText('now', right, height - 4);
      ctx.textAlign = 'left';
      ctx.strokeStyle = '#1f2833';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, bottom + 0.5); ctx.lineTo(right, bottom + 0.5); ctx.stroke();

      // Dashed limit line, labelled so it doesn't rely on colour.
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = '#5b6573';
      ctx.beginPath(); ctx.moveTo(left, y(LIMIT)); ctx.lineTo(right, y(LIMIT)); ctx.stroke();
      ctx.setLineDash([]);

      const line = (key: 'input' | 'output', color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.75;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        list.forEach((s, n) => (n ? ctx.lineTo(x(s.time), y(s[key])) : ctx.moveTo(x(s.time), y(s[key]))));
        ctx.stroke();
      };
      line('input', AMBER);
      line('output', TEAL);

      // Limit label on a small backing (drawn last) so a line passing through can't hide it.
      const label = `limit ${LIMIT}/s`;
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(right - lw - 6, y(LIMIT) - 18, lw + 6, 14);
      ctx.fillStyle = '#9aa5b4';
      ctx.textAlign = 'right';
      ctx.fillText(label, right - 2, y(LIMIT) - 7);
      ctx.textAlign = 'left';

      // Hover: vertical guide + tooltip with both values at that moment.
      const hx = hoverX.current;
      const nearest = hx === null || !list.length ? null
        : list.reduce((best, s) => (Math.abs(x(s.time) - hx) < Math.abs(x(best.time) - hx) ? s : best));
      if (nearest && hx !== null) {
        const sx = x(nearest.time);
        ctx.strokeStyle = '#3a4554';
        ctx.beginPath(); ctx.moveTo(sx + 0.5, top); ctx.lineTo(sx + 0.5, bottom); ctx.stroke();
        tip.hidden = false;
        tip.style.left = Math.min(Math.max(sx, 70), width - 70) + 'px';
        tip.querySelector('[data-k=ago]')!.textContent = ((now - nearest.time) / 1000).toFixed(1) + ' s ago';
        tip.querySelector('[data-k=in]')!.textContent = nearest.input.toFixed(1) + '/s';
        tip.querySelector('[data-k=out]')!.textContent = nearest.output.toFixed(1) + '/s';
      } else {
        tip.hidden = true;
      }
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, []);

  const inRate = rate(input);
  const outRate = rate(output);
  return (
    <section className="panel" aria-labelledby="rates-title">
      <h2 id="rates-title">Flashes per second</h2>
      <div className="rates">
        <div className="rate">
          <span className="key"><i className="swatch amber" />Original</span>
          <output data-rate="input" className="big">{inRate === null ? '–' : <>{inRate.toFixed(1)}<small>/s</small></>}</output>
        </div>
        <div className="rate">
          <span className="key"><i className="swatch teal" />Filtered</span>
          <output data-rate="output" className="big">{outRate === null ? '–' : <>{outRate.toFixed(1)}<small>/s</small></>}</output>
        </div>
      </div>
      <div className="chart">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Original and filtered flash rate over the last ten seconds, with a limit line at three flashes per second"
          onPointerMove={(e) => { hoverX.current = e.nativeEvent.offsetX; }}
          onPointerLeave={() => { hoverX.current = null; }}
        />
        <div ref={tipRef} className="tooltip" hidden>
          <div data-k="ago" className="ago" />
          <div><i className="swatch amber" />Original <b data-k="in" /></div>
          <div><i className="swatch teal" />Filtered <b data-k="out" /></div>
        </div>
      </div>
    </section>
  );
}

/** Effective damping per cell, as the renderer applies it (max protection floors it at 0.8). */
export function effectiveMask(report: RiskReport | null, maxProtection: boolean): number[] | null {
  if (!report) return null;
  return Array.from({ length: CELL_COUNT }, (_, i) => Math.max(report.cellMask[i] ?? 0, maxProtection ? 0.8 : 0));
}

const ACTIVE = 0.05; // a cell counts as "filtered" above this damping

export function RegionMap({ mask, waiting }: { mask: number[] | null; waiting: boolean }) {
  const active = mask ? mask.filter((m) => m > ACTIVE).length : 0;
  const caption = waiting || !mask ? 'Waiting for the stream'
    : active === 0 ? 'No regions filtered right now'
    : `${active} of ${CELL_COUNT} regions filtered`;
  return (
    <section className="panel" aria-labelledby="regions-title">
      <h2 id="regions-title">Filtered regions</h2>
      <div className="region-grid" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }} aria-hidden="true">
        {Array.from({ length: CELL_COUNT }, (_, i) => {
          const m = mask?.[i] ?? 0;
          // Opacity of the teal fill follows the damping strength; CSS eases changes over 400 ms.
          return <span key={i} style={{ '--m': m.toFixed(2) } as CSSProperties} />;
        })}
      </div>
      <p className="caption" aria-live="polite">{caption}</p>
    </section>
  );
}

function RiskBar({ label, name, value, tone }: { label: string; name: string; value: number | null; tone: 'amber' | 'teal' }) {
  const v = value === null ? 0 : Math.min(1, Math.max(0, value));
  return (
    <div className="risk-bar">
      <span>{label}</span>
      <div className={'track ' + tone} role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
        <span style={{ width: v * 100 + '%' }} />
      </div>
      <output>{value === null ? '–' : Math.round(v * 100) + '%'}</output>
    </div>
  );
}

export function RiskPanel({ input, output }: { input: RiskReport | null; output: RiskReport | null }) {
  return (
    <section className="panel" aria-labelledby="risk-title">
      <h2 id="risk-title">Risk</h2>
      <div className="risk-group">
        <h3>General flash</h3>
        <RiskBar label="Original" name="Original general flash" value={input?.flashRisk ?? null} tone="amber" />
        <RiskBar label="Filtered" name="Filtered general flash" value={output?.flashRisk ?? null} tone="teal" />
      </div>
      <div className="risk-group">
        <h3>Red flash</h3>
        <RiskBar label="Original" name="Original red flash" value={input?.redRisk ?? null} tone="amber" />
        <RiskBar label="Filtered" name="Filtered red flash" value={output?.redRisk ?? null} tone="teal" />
      </div>
    </section>
  );
}

/** Small hook: is the stage element currently fullscreen? */
export function useFullscreen(el: RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement !== null && document.fullscreenElement === el.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [el]);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.current?.requestFullscreen();
  }, [el]);
  return { on, toggle };
}
