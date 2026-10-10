import { useEffect, useRef, useState } from 'react';
import { startCapture, type Capture } from '../capture/capture';
import { Disclaimer } from './Disclaimer';

// Milestone 1: the capture is drawn with Canvas 2D at thumbnail size only.
// The large output canvas arrives with the WebGL filter (milestones 2–4), so the
// raw stream is never shown big.
export function Viewer() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);

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

  // Draw loop: copy the hidden video into the thumbnail canvas every frame.
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

      {error && <p className="error">{error}</p>}

      {capture ? (
        <section className="stage">
          <div className="output-placeholder">Filtered output appears here (milestone 2+)</div>
          <figure className="thumb">
            <canvas ref={thumbRef} width={256} height={144} />
            <figcaption>
              Raw source {capture.hasAudio ? '' : '· no audio shared'}
            </figcaption>
          </figure>
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
