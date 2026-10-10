import { useEffect, useRef, useState } from 'react';
import { startCapture, type Capture } from '../capture/capture';
import { DEFAULT_FILTER_SETTINGS, type FilterSettings } from '../types.ts';
import { Disclaimer } from './Disclaimer';
import { usePipeline } from './usePipeline';

// The large output canvas only ever shows the renderer's FILTERED frame.
// The raw stream appears only in the small thumbnail (safety rule).
export function Viewer() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings] = useState<FilterSettings>(DEFAULT_FILTER_SETTINGS); // sliders: milestone 8
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);

  const pipeline = usePipeline(capture, outputRef, settings);

  async function handleStart() {
    setError(null);
    try {
      const c = await startCapture(() => setCapture(null));
      setCapture(c);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        setError('Sharing was cancelled. Click "Share a tab" to try again.');
      } else {
        setError(`Could not start capture: ${String(e)}`);
      }
    }
  }

  // Thumbnail draw loop: copy the hidden video into the small raw-preview canvas.
  useEffect(() => {
    if (!capture) return;
    const canvas = thumbRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      const { video } = capture;
      if (video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [capture]);

  // Stop tracks when the component unmounts.
  useEffect(() => () => capture?.stop(), [capture]);

  return (
    <main className="viewer">
      <header>
        <h1>StrobeGuard</h1>
        {capture ? (
          <button onClick={() => { capture.stop(); setCapture(null); }}>Stop</button>
        ) : (
          <button onClick={handleStart}>Share a tab</button>
        )}
      </header>

      {(error ?? pipeline.error) && <p className="error">{error ?? pipeline.error}</p>}

      {capture ? (
        <section className="stage">
          <canvas ref={outputRef} className="output" />
          <figure className="thumb">
            <canvas ref={thumbRef} width={256} height={144} />
            <figcaption>
              Raw source {capture.hasAudio ? '' : '· no audio shared'}
            </figcaption>
          </figure>
          {/* Temporary readout until the graphs land (milestone 7). */}
          <p className="readout">
            Input {pipeline.input?.flashesPerSec.toFixed(1) ?? '–'} flashes/s · Output{' '}
            {pipeline.output?.flashesPerSec.toFixed(1) ?? '–'} flashes/s
          </p>
        </section>
      ) : (
        <p className="hint">
          Click “Share a tab”, pick the tab with your stream, and tick “Share tab audio”.
        </p>
      )}

      <Disclaimer />
    </main>
  );
}
