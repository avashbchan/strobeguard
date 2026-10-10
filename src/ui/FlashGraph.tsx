import { useEffect, useRef, type CSSProperties } from 'react';
import { GRID_COLS, type RiskReport } from '../types';

// Validated two-series palette (dark surface #0E121A): amber = original stream, teal = filtered.
export const ORIGINAL_COLOR = '#BD833B';
export const FILTERED_COLOR = '#24A190';
const WINDOW_MS = 10_000;
const LIMIT = 3; // WCAG 2.3.1 general flash threshold

type Sample = { time: number; value: number };

function useSamples(report: RiskReport | null) {
  const latest = useRef(report);
  latest.current = report;
  const samples = useRef<Sample[]>([]);
  const last = useRef({ frame: -1, at: -Infinity });
  return (now: number) => {
    const r = latest.current;
    if (r && r.frameIndex !== last.current.frame && now - last.current.at >= 50) {
      last.current = { frame: r.frameIndex, at: now };
      samples.current.push({ time: now, value: Math.max(0, r.flashesPerSec) });
    }
    const s = samples.current;
    while (s.length && s[0]!.time < now - WINDOW_MS) s.shift();
    return s;
  };
}

function nearest(samples: Sample[], time: number): Sample | null {
  let best: Sample | null = null;
  for (const s of samples) if (!best || Math.abs(s.time - time) < Math.abs(best.time - time)) best = s;
  return best && Math.abs(best.time - time) < 400 ? best : null;
}

/** Both flash rates on one axis, last 10 s, with the 3/s limit. Hover for exact values. */
export function FlashChart({ input, output }: { input: RiskReport | null; output: RiskReport | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverX = useRef<number | null>(null);
  const sampleInput = useSamples(input);
  const sampleOutput = useSamples(output);
  const samplers = useRef({ sampleInput, sampleOutput });
  samplers.current = { sampleInput, sampleOutput };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let handle = 0;
    let ceiling = 6;
    const draw = (now: number) => {
      const original = samplers.current.sampleInput(now);
      const filtered = samplers.current.sampleOutput(now);
      const width = canvas.clientWidth || 300;
      const height = canvas.clientHeight || 150;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const peak = Math.max(0, ...original.map((s) => s.value), ...filtered.map((s) => s.value));
      ceiling += (Math.max(6, Math.ceil(peak * 1.2)) - ceiling) * 0.05; // ease axis changes
      const left = 22, right = width - 4, top = 10, bottom = height - 22;
      const x = (t: number) => right - ((now - t) / WINDOW_MS) * (right - left);
      const y = (v: number) => bottom - (v / ceiling) * (bottom - top);

      ctx.font = '500 11px Geist, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      // Recessive axes: baseline + top tick only.
      ctx.strokeStyle = '#232A36';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, bottom + 0.5); ctx.lineTo(right, bottom + 0.5); ctx.stroke();
      ctx.fillStyle = '#6B7484';
      ctx.textAlign = 'right';
      ctx.fillText('0', left - 6, bottom);
      ctx.fillText(String(Math.round(ceiling)), left - 6, top);
      ctx.textAlign = 'left';
      ctx.fillText('10 s ago', left, height - 8);
      ctx.textAlign = 'right';
      ctx.fillText('now', right, height - 8);

      // The limit line.
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = '#4A5263';
      ctx.beginPath(); ctx.moveTo(left, y(LIMIT) + 0.5); ctx.lineTo(right, y(LIMIT) + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8C95A5';
      ctx.fillText('limit 3/s', right, y(LIMIT) - 8);

      const line = (samples: Sample[], color: string) => {
        if (samples.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        samples.forEach((s, i) => (i ? ctx.lineTo(x(s.time), y(s.value)) : ctx.moveTo(x(s.time), y(s.value))));
        ctx.stroke();
      };
      line(original, ORIGINAL_COLOR);
      line(filtered, FILTERED_COLOR);

      // Hover: crosshair, ringed markers, and a small readout box.
      if (hoverX.current !== null && hoverX.current >= left && hoverX.current <= right) {
        const hx = hoverX.current;
        const t = now - ((right - hx) / (right - left)) * WINDOW_MS;
        ctx.strokeStyle = '#3A4252';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hx + 0.5, top); ctx.lineTo(hx + 0.5, bottom); ctx.stroke();
        const a = nearest(original, t);
        const b = nearest(filtered, t);
        for (const [s, color] of [[a, ORIGINAL_COLOR], [b, FILTERED_COLOR]] as const) {
          if (!s) continue;
          ctx.fillStyle = color;
          ctx.strokeStyle = '#0E121A';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x(s.time), y(s.value), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        const rows: [string, string, number | undefined][] = [
          ['Original', ORIGINAL_COLOR, a?.value],
          ['Filtered', FILTERED_COLOR, b?.value],
        ];
        const boxW = 118, boxH = 54;
        const bx = hx + 10 + boxW > right ? hx - 10 - boxW : hx + 10;
        ctx.fillStyle = '#1A2029';
        ctx.strokeStyle = '#2A3240';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bx, top, boxW, boxH, 6); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8C95A5';
        ctx.fillText(`${((now - t) / 1000).toFixed(1)} s ago`, bx + 10, top + 12);
        rows.forEach(([label, color, v], i) => {
          const ry = top + 29 + i * 15;
          ctx.fillStyle = color;
          ctx.fillRect(bx + 10, ry - 4, 8, 8);
          ctx.fillStyle = '#E4E8EE';
          ctx.fillText(label, bx + 24, ry);
          ctx.textAlign = 'right';
          ctx.fillText(v === undefined ? '–' : `${v}/s`, bx + boxW - 10, ry);
          ctx.textAlign = 'left';
        });
      }
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, []);

  const rate = (r: RiskReport | null) => (r ? r.flashesPerSec.toFixed(1) : '–');
  const value = (r: RiskReport | null) => (r ? <>{r.flashesPerSec.toFixed(1)}<small>/s</small></> : '–');
  return (
    <figure className="chart">
      <div className="chart-keys">
        <div className="chart-key">
          <span className="swatch" style={{ background: ORIGINAL_COLOR }} />
          <span className="chart-key-label">Original</span>
          <span className="chart-key-value">{value(input)}</span>
        </div>
        <div className="chart-key">
          <span className="swatch" style={{ background: FILTERED_COLOR }} />
          <span className="chart-key-label">Filtered</span>
          <span className="chart-key-value">{value(output)}</span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Flashes per second over the last 10 seconds. Original ${rate(input)}, filtered ${rate(output)}. Limit is 3.`}
        onPointerMove={(e) => { hoverX.current = e.nativeEvent.offsetX; }}
        onPointerLeave={() => { hoverX.current = null; }}
      />
    </figure>
  );
}

/** 8×6 map of where the filter is currently damping (the detector's eased cellMask). */
export function DampingMap({ report }: { report: RiskReport | null }) {
  const mask = report?.cellMask ?? [];
  const active = mask.filter((m) => m >= 0.5).length;
  return (
    <figure className="damping">
      <div className="damping-grid" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }} role="img"
        aria-label={`${active} of ${mask.length || 48} screen regions are being filtered`}>
        {Array.from({ length: 48 }, (_, i) => (
          <span key={i} style={{ '--m': Math.min(1, Math.max(0, mask[i] ?? 0)) } as CSSProperties} />
        ))}
      </div>
      <figcaption>
        {!report ? 'Waiting for the stream' : active === 0 ? 'No regions filtered right now' : `${active} of 48 regions filtered`}
      </figcaption>
    </figure>
  );
}

/** Flash and red-flash risk, original vs filtered, as paired bars. */
export function RiskMeters({ input, output }: { input: RiskReport | null; output: RiskReport | null }) {
  const rows = [
    { key: 'flashRisk', label: 'General flash' },
    { key: 'redRisk', label: 'Red flash' },
  ] as const;
  const pct = (r: RiskReport | null, k: 'flashRisk' | 'redRisk') => Math.round(Math.min(1, Math.max(0, r?.[k] ?? 0)) * 100);
  return (
    <div className="risks">
      {rows.map(({ key, label }) => (
        <div className="risk" key={key}>
          <span className="risk-label">{label}</span>
          {([['Original', input, ORIGINAL_COLOR], ['Filtered', output, FILTERED_COLOR]] as const).map(([who, r, color]) => (
            <div className="risk-bar" key={who}>
              <span>{who}</span>
              <div className="track" role="meter" aria-label={`${label} risk, ${who.toLowerCase()}`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(r, key)}>
                <span style={{ width: `${pct(r, key)}%`, background: color }} />
              </div>
              <output>{r ? `${pct(r, key)}%` : '–'}</output>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
