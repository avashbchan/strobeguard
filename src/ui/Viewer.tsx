import { useEffect, useRef, useState } from 'react';
import { startCapture, type Capture } from '../capture/capture';
import { createAudioChain, prepareAudioContext, releasePreparedAudioContext, type AudioChain } from '../audio/audio';
import { DEFAULT_FILTER_SETTINGS, type FilterSettings } from '../types';
import { Disclaimer } from './Disclaimer';
import { usePipeline } from './usePipeline';
import { FlashGraph, RiskMeters } from './FlashGraph';

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
  const pipeline = usePipeline(capture, outputRef, settings);

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
    audio.setDelaySeconds(pipeline.delayFrames / Math.max(1, pipeline.measuredFps));
    audio.setBassDb(bassDb);
    audio.setVolume(pipeline.delayFrames > 0 ? volume : 0);
  }, [capture, pipeline.delayFrames, pipeline.measuredFps, bassDb, volume]);

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

  return (
    <main className="viewer">
      <header>
        <div><h1>StrobeGuard</h1><p className="hint">Stream viewing with flash risk reduction</p></div>
        {capture ? <button onClick={stopCapture}>Stop sharing</button> :
          <button onClick={handleStart} disabled={starting}>{starting ? 'Waiting for tab…' : 'Share a tab'}</button>}
      </header>
      <Disclaimer />
      {error && <p className="error" role="alert">{error}</p>}
      {audioNotice && <p className="notice" role="status">{audioNotice}</p>}
      {capture ? <>
        <section className="stage" aria-label="Stream preview">
          <canvas ref={outputRef} className="output" aria-label="Filtered stream output" />
          <figure className="thumb">
            <canvas ref={thumbRef} width={256} height={144} aria-label="Small unfiltered source preview" />
            <figcaption>Raw source {capture.hasAudio ? '' : '· no audio shared'}</figcaption>
          </figure>
        </section>
        <p className="readout">
          {pipeline.measuredFps.toFixed(1)} source fps · Video buffer {pipeline.delayFrames} frames · Buffer delay {(pipeline.delayFrames / Math.max(1, pipeline.measuredFps) * 1000).toFixed(0)} ms
          {!capture.hasAudio && ' · no audio shared'}
        </p>
        <section className="graphs" aria-label="Flash rate comparison">
          <FlashGraph title="Original input" report={pipeline.input} color="#9bbcf5" />
          <FlashGraph title="Filtered output" report={pipeline.output} color="#91d4bc" />
        </section>
        <section className="risks">
          <RiskMeters title="Input" report={pipeline.input} />
          <RiskMeters title="Output" report={pipeline.output} />
        </section>
      </> : <p className="hint">Share a Chrome tab with your stream. Enable “Share tab audio” for synchronized audio.</p>}
      <section className="controls" aria-label="Viewing controls">
        <fieldset>
          <legend>Picture</legend>
          <label>Brightness <output>{Math.round(settings.brightness * 100)}%</output>
            <input type="range" min="0.3" max="1" step="0.01" value={settings.brightness} onChange={e => setSettings(s => ({ ...s, brightness: Number(e.target.value) }))} />
          </label>
          <label>Saturation <output>{Math.round(settings.saturation * 100)}%</output>
            <input type="range" min="0" max="1" step="0.01" value={settings.saturation} onChange={e => setSettings(s => ({ ...s, saturation: Number(e.target.value) }))} />
          </label>
          <label className="toggle"><input type="checkbox" checked={settings.maxProtection} onChange={e => setSettings(s => ({ ...s, maxProtection: e.target.checked }))} /> Maximum protection</label>
          <p className="hint">Applies stronger damping across the whole picture.</p>
        </fieldset>
        <fieldset disabled={!capture?.hasAudio || !audioRef.current}>
          <legend>Audio</legend>
          <label>Bass reduction <output>{bassDb} dB</output>
            <input type="range" min="-24" max="0" step="1" value={bassDb} onChange={e => setBassDb(Number(e.target.value))} />
          </label>
          <label>Volume <output>{Math.round(volume * 100)}%</output>
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))} />
          </label>
        </fieldset>
      </section>
    </main>
  );
}
