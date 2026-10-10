import { useEffect, useRef } from 'react';
import type { RiskReport } from '../types';

type Sample = { time: number; value: number };
export function FlashGraph({ title, report, color }: { title: string; report: RiskReport | null; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(report);
  latest.current = report;
  const history = useRef<Sample[]>([]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let handle = 0;
    let lastFrame = -1;
    let lastSampleAt = -Infinity;
    let ceiling = 6;
    const draw = (now: number) => {
      const current = latest.current;
      if (current && current.frameIndex !== lastFrame && now - lastSampleAt >= 50) {
        lastFrame = current.frameIndex;
        lastSampleAt = now;
        history.current.push({ time: now, value: Math.max(0, current.flashesPerSec) });
      }
      const samples = history.current;
      while (samples.length && samples[0]!.time < now - 10_000) samples.shift();
      const width = Math.max(280, canvas.clientWidth);
      const height = 180;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const targetCeiling = Math.max(6, ...samples.map(sample => sample.value * 1.2));
      ceiling += (targetCeiling - ceiling) * 0.04;
      const left = 34, right = width - 12, top = 30, bottom = 150;
      const y = (value: number) => bottom - value / ceiling * (bottom - top);
      ctx.font = '11px system-ui';
      ctx.fillStyle = '#a8b6c9';
      ctx.strokeStyle = '#344253';
      ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
      ctx.fillText('0', 15, bottom + 3);
      ctx.fillText(ceiling.toFixed(0), 15, top + 3);
      ctx.fillText('10 s ago', left, 173);
      ctx.fillText('now', right - 23, 173);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#b5ac82';
      ctx.beginPath(); ctx.moveTo(left, y(3)); ctx.lineTo(right, y(3)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#c8c0a2';
      ctx.fillText('3 · WCAG general flash threshold', left + 4, 15);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      samples.forEach((sample, index) => {
        const x = left + Math.max(0, 1 - (now - sample.time) / 10_000) * (right - left);
        if (index === 0) ctx.moveTo(x, y(sample.value)); else ctx.lineTo(x, y(sample.value));
      });
      ctx.stroke();
      ctx.lineWidth = 1;
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [color]);
  return (
    <figure className="graph">
      <figcaption><strong>{title}</strong><span>{report ? report.flashesPerSec.toFixed(1) : '–'} flashes/s</span></figcaption>
      <canvas ref={canvasRef} role="img" aria-label={title + ': flash rate over the last ten seconds, with threshold at three flashes per second'} />
    </figure>
  );
}
export function RiskMeters({ title, report }: { title: string; report: RiskReport | null }) {
  return <section className="risk-meters" aria-label={title + ' risk'}>
    <h3>{title} risk</h3>
    {(['flashRisk', 'redRisk'] as const).map(key => {
      const value = Math.min(1, Math.max(0, report?.[key] ?? 0));
      const label = key === 'flashRisk' ? 'General flash' : 'Saturated red';
      return <div key={key} className="risk-row">
        <span>{label}</span>
        <div className="meter" role="meter" aria-label={title + ' ' + label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
          <span style={{ width: value * 100 + '%' }} />
        </div>
        <output>{report ? Math.round(value * 100) + '%' : '–'}</output>
      </div>;
    })}
  </section>;
}
