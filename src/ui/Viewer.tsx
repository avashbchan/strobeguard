import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { startCapture, type Capture } from '../capture/capture';
import { createAudioChain, prepareAudioContext, releasePreparedAudioContext, type AudioChain } from '../audio/audio';
import { DEFAULT_FILTER_SETTINGS, type FilterSettings } from '../types';
import { Disclaimer } from './Disclaimer';
import { usePipeline } from './usePipeline';
import { DampingMap, FlashChart, RiskMeters } from './FlashGraph';
import { Mark } from './Mark';
import { RiskTimeline } from './RiskTimeline';
import { OriginalPreview } from './OriginalPreview';

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
  const outputRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const pipeline = usePipeline(capture, outputRef, settings);
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;
  // Session counter: once a second, add how many flashes the filter removed in that second
  // (original area rate minus filtered area rate). Kept for the whole page session.
  const [session, setSession] = useState({ softened: 0, filteringSeconds: 0 });
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

  useEffect(() => () => {
    generation.current++;
    captureRef.current?.stop();
    audioRef.current?.dispose();
    releasePreparedAudioContext();
  }, []);

  useEffect(() => {
    if (!capture) return;
    const id = window.setInterval(() => {
      const { input, output } = pipelineRef.current;
      if (!input) return;
      const removed = Math.max(0, input.flashesPerSec - (output?.flashesPerSec ?? input.flashesPerSec));
      const filtering = input.cellMask.some((m) => m >= 0.5);
      if (removed > 0 || filtering) {
        setSession((s) => ({ softened: s.softened + removed, filteringSeconds: s.filteringSeconds + (filtering ? 1 : 0) }));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [capture]);

  // Fullscreen shows only the stage: filtered output plus the small original preview.
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  }
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.tagName === 'INPUT' || el.isContentEditable)) return;
      toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture]);

  const filteredRegions = pipeline.input?.cellMask.filter((m) => m >= 0.5).length ?? 0;
  const status = !capture
    ? { tone: 'idle', text: 'Not sharing' }
    : !pipeline.input
      ? { tone: 'idle', text: 'Starting' }
      : filteredRegions > 0 || settings.maxProtection
        ? { tone: 'active', text: settings.maxProtection ? 'Maximum protection' : 'Filtering flashes' }
        : { tone: 'watch', text: 'Watching for flashes' };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Mark /> StrobeGuard</div>
        <div className={`status status-${status.tone}`} role="status"><span className="status-dot" />{status.text}</div>
        <div className="topbar-actions">
          {capture
            ? <button onClick={stopCapture}>Stop sharing</button>
            : <button className="primary" onClick={handleStart} disabled={starting}>{starting ? 'Waiting for tab…' : 'Share a tab'}</button>}
        </div>
      </header>

      <main className="main">
        {error && <p className="banner banner-error" role="alert">{error}</p>}
        {audioNotice && <p className="banner" role="status">{audioNotice}</p>}

        <section ref={stageRef} className={`stage ${capture ? 'is-live' : ''}`} aria-label="Filtered stream"
          onDoubleClick={capture ? toggleFullscreen : undefined}>
          {capture ? <>
            <canvas ref={outputRef} className="output" aria-label="Filtered stream output" />
            <button className="stage-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}>
              {fullscreen
                ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" /></svg>
                : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" /></svg>}
            </button>
            <OriginalPreview video={capture.video} stageRef={stageRef} />
          </> : (
            <div className="empty">
              <Mark size={40} />
              <h2>Share the tab playing your stream</h2>
              <p>Pick the tab in Chrome’s share dialog and turn on “Share tab audio” to keep sound in sync.</p>
              <button className="primary" onClick={handleStart} disabled={starting}>{starting ? 'Waiting for tab…' : 'Share a tab'}</button>
            </div>
          )}
        </section>

        {capture && <RiskTimeline report={pipeline.input} sessionKey={capture} />}

        <footer className="stage-footer">
          <Disclaimer />
          {capture && (
            <dl className="stats">
              <div><dt>Frame rate</dt><dd>{pipeline.measuredFps.toFixed(0)} fps</dd></div>
              <div><dt>Delay</dt><dd>{(DELAY_SECONDS * 1000).toFixed(0)} ms</dd></div>
              <div><dt>Audio</dt><dd>{capture.hasAudio ? 'In sync' : 'Not shared'}</dd></div>
            </dl>
          )}
        </footer>
      </main>

      <aside className="sidebar" aria-label="Flash analysis and controls">
        <section className="panel tally" aria-live="polite">
          <p className="tally-number">{session.softened.toLocaleString()}</p>
          <p className="tally-label">{session.softened === 1 ? 'flash' : 'flashes'} softened this session</p>
          <p className="tally-sub">
            {session.filteringSeconds > 0
              ? `Filter active for ${formatDuration(session.filteringSeconds)}`
              : capture ? 'Nothing to soften yet' : 'Share a tab to start counting'}
          </p>
        </section>
        <section className="panel">
          <h2>Flashes per second</h2>
          <FlashChart input={pipeline.input} output={pipeline.output} />
        </section>
        <section className="panel">
          <h2>Filtered regions</h2>
          <DampingMap report={pipeline.input} />
        </section>
        <section className="panel">
          <h2>Risk</h2>
          <RiskMeters input={pipeline.input} output={pipeline.output} />
        </section>
        <section className="panel">
          <h2>Picture</h2>
          <Slider label="Brightness" value={settings.brightness} min={0.3} max={1} step={0.01}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings((s) => ({ ...s, brightness: v }))} />
          <Slider label="Saturation" value={settings.saturation} min={0} max={1} step={0.01}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings((s) => ({ ...s, saturation: v }))} />
          <label className="switch">
            <input type="checkbox" role="switch" checked={settings.maxProtection}
              onChange={(e) => setSettings((s) => ({ ...s, maxProtection: e.target.checked }))} />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-text">
              <span>Maximum protection</span>
              <small>Damps the whole picture, not just flashing regions</small>
            </span>
          </label>
        </section>
        <section className="panel">
          <h2>Audio</h2>
          <fieldset disabled={!capture?.hasAudio || !audioRef.current}>
            <Slider label="Bass reduction" value={bassDb} min={-24} max={0} step={1}
              format={(v) => `${v} dB`} onChange={setBassDb} />
            <Slider label="Volume" value={volume} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`} onChange={setVolume} />
          </fieldset>
          {capture && !capture.hasAudio && <p className="hint">Tab audio wasn’t shared. Share again with “Share tab audio” turned on to use these.</p>}
        </section>
      </aside>
    </div>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-head"><span>{label}</span><output>{format(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}
