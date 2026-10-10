import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { startCapture, type Capture } from '../capture/capture';
import { createAudioChain, prepareAudioContext, releasePreparedAudioContext, type AudioChain } from '../audio/audio';
import { DEFAULT_FILTER_SETTINGS, type FilterSettings } from '../types';
import { Disclaimer } from './Disclaimer';
import { Logo } from './Logo';
import { usePipeline } from './usePipeline';
import { RatesPanel, RegionMap, RiskPanel, effectiveMask, useFullscreen } from './Panels';

// Drives the filled part of the styled range track (see input[type=range] in styles.css).
const fill = (value: number, min: number, max: number) =>
  ({ '--fill': ((value - min) / (max - min)) * 100 + '%' }) as CSSProperties;

type Status = { label: string; tone: 'idle' | 'neutral' | 'active' };

const FILTERING = 0.05; // any cell damped above this → "Filtering flashes"

function statusOf(capture: Capture | null, starting: boolean, maxProtection: boolean, mask: readonly number[] | undefined): Status {
  if (!capture) return starting ? { label: 'Starting', tone: 'neutral' } : { label: 'Not sharing', tone: 'idle' };
  if (maxProtection) return { label: 'Maximum protection', tone: 'active' };
  if (mask?.some((m) => m > FILTERING)) return { label: 'Filtering flashes', tone: 'active' };
  return { label: 'Watching for flashes', tone: 'neutral' };
}

export function Viewer() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<FilterSettings>(DEFAULT_FILTER_SETTINGS);
  const [bassDb, setBassDb] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const captureRef = useRef<Capture | null>(null);
  const audioRef = useRef<AudioChain | null>(null);
  const startingRef = useRef(false);
  const generation = useRef(0);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(stageRef);
  const toggleFullscreen = fullscreen.toggle;
  const pipeline = usePipeline(capture, outputRef, settings);
  // Match the renderer's fixed capture-time delay, independent of GPU throughput.
  const DELAY_SECONDS = pipeline.delayFrames / 30;

  function stopCapture() {
    generation.current++;
    captureRef.current?.stop();
    captureRef.current = null;
    audioRef.current?.dispose();
    audioRef.current = null;
    releasePreparedAudioContext();
    setCapture(null);
    setAudioNotice(null);
  }

  async function handleStart() {
    if (startingRef.current) return;
    startingRef.current = true;
    const request = ++generation.current;
    setStarting(true);
    setError(null);
    setAudioNotice(null);
    // Both context creation/resume and getDisplayMedia start in this click, before any await.
    let audioReady: Promise<string | null>;
    try {
      audioReady = prepareAudioContext().then(() => null, e => 'Audio unavailable: ' + String(e));
    } catch (e) {
      audioReady = Promise.resolve('Audio unavailable: ' + String(e));
    }
    let acquired: Capture | null = null;
    try {
      acquired = await startCapture(stopCapture);
      if (request !== generation.current) { acquired.stop(); return; }
      const audioError = await audioReady;
      if (request !== generation.current) { acquired.stop(); return; }
      if (audioError) {
        releasePreparedAudioContext();
        setAudioNotice(audioError + '. Video continues without processed audio.');
      } else {
        try {
          audioRef.current = createAudioChain(acquired.stream);
        } catch (e) {
          setAudioNotice('Audio processing could not start: ' + String(e) + '. Video continues.');
        }
      }
      captureRef.current = acquired;
      setCapture(acquired);
    } catch (e) {
      acquired?.stop();
      releasePreparedAudioContext();
      if (request !== generation.current) return;
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        setError('Sharing was cancelled or denied. Click “Share a tab” to try again.');
      } else {
        setError('Could not start capture: ' + String(e));
      }
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!capture || !audio) return;
    audio.setDelaySeconds(DELAY_SECONDS);
    audio.setBassDb(bassDb);
    audio.setVolume(pipeline.delayFrames > 0 ? volume : 0);
  }, [capture, pipeline.delayFrames, DELAY_SECONDS, bassDb, volume]);

  useEffect(() => {
    if (!capture || !pipeline.error) return;
    setError(pipeline.error);
    stopCapture();
  }, [capture, pipeline.error]);

  useEffect(() => {
    if (!capture) return;
    const canvas = thumbRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let handle = 0;
    const draw = () => {
      const video = capture.video;
      if (video.readyState >= 2 && video.videoWidth > 0) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [capture]);

  useEffect(() => () => {
    generation.current++;
    captureRef.current?.stop();
    audioRef.current?.dispose();
    releasePreparedAudioContext();
  }, []);

  // F toggles fullscreen while sharing (ignored while typing or adjusting a control).
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture, toggleFullscreen]);

  // Leave fullscreen when sharing stops, so the empty stage isn't left filling the screen.
  useEffect(() => {
    if (!capture && document.fullscreenElement) void document.exitFullscreen();
  }, [capture]);

  const status = statusOf(capture, starting, settings.maxProtection, pipeline.input?.cellMask);
  const mask = effectiveMask(pipeline.input, settings.maxProtection);
  const audioOn = !!capture && !!audioRef.current;
  const audioState = !capture ? '–' : audioOn ? 'In sync' : capture.hasAudio ? 'Unavailable' : 'Not shared';
  const shareButton = (
    <button className="primary" onClick={handleStart} disabled={starting}>{starting ? 'Waiting for tab…' : 'Share a tab'}</button>
  );

  return (
    <div className="viewer">
      <header className="topbar">
        <div className="brand"><Logo /> StrobeGuard</div>
        <p className={'status ' + status.tone} role="status"><i aria-hidden="true" />{status.label}</p>
        <div className="topbar-action">
          {capture ? <button className="secondary" onClick={stopCapture}>Stop sharing</button> : shareButton}
        </div>
      </header>

      <div className="workspace">
        <main className="main">
          {error && <p className="error" role="alert">{error}</p>}
          {audioNotice && <p className="notice" role="status">{audioNotice}</p>}
          <section ref={stageRef} className={'stage' + (capture ? ' live' : '')} aria-label="Filtered stream">
            {capture ? <>
              <canvas ref={outputRef} className="output" aria-label="Filtered stream output" />
              <button
                className="icon fullscreen-toggle"
                onClick={fullscreen.toggle}
                aria-label={fullscreen.on ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
                title={fullscreen.on ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  {fullscreen.on
                    ? <path d="M6 1.5V6H1.5M10 1.5V6h4.5M6 14.5V10H1.5M10 14.5V10h4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    : <path d="M1.5 6V1.5H6M14.5 6V1.5H10M1.5 10v4.5H6M14.5 10v4.5H10" fill="none" stroke="currentColor" strokeWidth="1.5" />}
                </svg>
                <kbd>F</kbd>
              </button>
              {/* The unfiltered stream only ever appears at this small size (safety rule). */}
              <figure className="thumb">
                <canvas ref={thumbRef} width={176} height={99} aria-label="Small unfiltered source preview" />
                <figcaption><i className="swatch amber" />Original</figcaption>
              </figure>
              <p className="fs-disclaimer">Reduces flash risk; not a medical device.</p>
            </> : (
              <div className="empty">
                <Logo size={36} />
                <h2>Share the tab playing your stream</h2>
                <p>Pick the tab in Chrome’s share dialog and turn on “Share tab audio” to keep sound in sync.</p>
                {shareButton}
              </div>
            )}
          </section>
          <div className="below">
            <Disclaimer />
            <dl className="readout">
              <div><dt>Frame rate</dt><dd>{capture ? Math.round(pipeline.measuredFps) + ' fps' : '–'}</dd></div>
              <div><dt>Delay</dt><dd>{capture ? (DELAY_SECONDS * 1000).toFixed(0) + ' ms' : '–'}</dd></div>
              <div><dt>Audio</dt><dd>{audioState}</dd></div>
            </dl>
          </div>
        </main>

        <aside className="sidebar" aria-label="Flash measurements and controls">
          <RatesPanel input={capture ? pipeline.input : null} output={capture ? pipeline.output : null} />
          <RegionMap mask={capture ? mask : null} waiting={!capture || !pipeline.input} />
          <RiskPanel input={capture ? pipeline.input : null} output={capture ? pipeline.output : null} />

          <section className="panel controls" aria-labelledby="picture-title">
            <h2 id="picture-title">Picture</h2>
            <label>
              <span className="row"><span>Brightness</span><output>{Math.round(settings.brightness * 100)}%</output></span>
              <input type="range" min="0.3" max="1" step="0.01" style={fill(settings.brightness, 0.3, 1)} value={settings.brightness} onChange={e => setSettings(s => ({ ...s, brightness: Number(e.target.value) }))} />
            </label>
            <label>
              <span className="row"><span>Saturation</span><output>{Math.round(settings.saturation * 100)}%</output></span>
              <input type="range" min="0" max="1" step="0.01" style={fill(settings.saturation, 0, 1)} value={settings.saturation} onChange={e => setSettings(s => ({ ...s, saturation: Number(e.target.value) }))} />
            </label>
            <label className="toggle">
              <input type="checkbox" role="switch" checked={settings.maxProtection} onChange={e => setSettings(s => ({ ...s, maxProtection: e.target.checked }))} />
              <span><span className="toggle-title">Maximum protection</span><span className="helper">Damps the whole picture, not just flashing regions</span></span>
            </label>
          </section>

          <section className="panel controls" aria-labelledby="audio-title">
            <h2 id="audio-title">Audio</h2>
            <fieldset disabled={!audioOn}>
              <legend className="visually-hidden">Audio controls</legend>
              <label>
                <span className="row"><span>Bass reduction</span><output>{bassDb} dB</output></span>
                <input type="range" min="-24" max="0" step="1" style={fill(bassDb, -24, 0)} value={bassDb} onChange={e => setBassDb(Number(e.target.value))} />
              </label>
              <label>
                <span className="row"><span>Volume</span><output>{Math.round(volume * 100)}%</output></span>
                <input type="range" min="0" max="1" step="0.01" style={fill(volume, 0, 1)} value={volume} onChange={e => setVolume(Number(e.target.value))} />
              </label>
            </fieldset>
            {capture && !audioOn && <p className="helper">Tab audio wasn’t shared. Share again with “Share tab audio” turned on to use these.</p>}
            {!capture && <p className="helper">Available after you share a tab with “Share tab audio” turned on.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
