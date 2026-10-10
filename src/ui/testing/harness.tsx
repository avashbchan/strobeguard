// Development-only synthetic tab sharing: no real screen or microphone capture.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import '../styles.css';
if (!import.meta.env.DEV) throw new Error('This page is only available in development.');
let active: MediaStream | null = null;
let mode = 'audio';
const checks = document.getElementById('checks')!;
checks.style.cssText = 'padding:16px;border-bottom:1px solid #5676a1';
checks.innerHTML = '<strong>Development checks · synthetic source only</strong> <label>Scenario <select id="scenario"><option value="audio">With audio</option><option value="silent">No audio</option><option value="cancel">Cancel sharing</option><option value="webgl">WebGL unavailable</option></select></label> <button id="end">Simulate tab closed</button> <output id="tracks"></output>';
const scenario = document.getElementById('scenario') as HTMLSelectElement;
scenario.onchange = () => { mode = scenario.value; };
document.getElementById('end')!.onclick = () => {
  active?.getVideoTracks()[0]?.dispatchEvent(new Event('ended'));
};
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
  if (mode === 'webgl' && args[0] === 'webgl2') return null;
  return getContext.apply(this, args);
} as typeof getContext;
navigator.mediaDevices.getDisplayMedia = async () => {
  if (mode === 'cancel') throw new DOMException('Synthetic cancelled picker', 'NotAllowedError');
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  const stream = canvas.captureStream(30);
  let generatedAudio: AudioContext | null = null;
  active = stream;
  if (mode === 'audio') {
    generatedAudio = new AudioContext();
    await generatedAudio.resume();
    const tone = generatedAudio.createOscillator();
    tone.frequency.value = 220;
    const gain = generatedAudio.createGain();
    gain.gain.value = 0.025;
    const destination = generatedAudio.createMediaStreamDestination();
    tone.connect(gain).connect(destination);
    tone.start();
    stream.addTrack(destination.stream.getAudioTracks()[0]!);
  }
  const timer = window.setInterval(() => {
    if (stream.getVideoTracks()[0]?.readyState !== 'live') {
      clearInterval(timer);
      void generatedAudio?.close();
      generatedAudio = null;
      return;
    }
    ctx.fillStyle = '#24384c'; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#e6edf5'; ctx.font = '24px system-ui';
    ctx.fillText('Synthetic source · frame ' + frame++, 40, 170);
  }, 1000 / 30);
  return stream;
};
setInterval(() => {
  document.getElementById('tracks')!.textContent = ' Live tracks: ' + (active?.getTracks().filter(track => track.readyState === 'live').length ?? 0);
}, 100);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
