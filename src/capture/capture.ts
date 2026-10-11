// Tab capture: getDisplayMedia → hidden <video>.

export type Capture = {
  stream: MediaStream;
  video: HTMLVideoElement;
  hasAudio: boolean;
  /**
   * Whether Chrome silenced the original tab's own playback. false means the user hears the
   * original AND our delayed copy (it only works when a Chrome tab is shared, not a window or
   * screen). null when no audio was shared or the browser doesn't report it.
   */
  localAudioSuppressed: boolean | null;
  /** 'browser' (a tab), 'window' or 'monitor', when the browser reports it. */
  surface: string | null;
  stop: () => void;
};

// Tab audio as-is: no voice processing (it would pump music and duck the stream), and the original
// tab silenced so the only thing the user hears is our delayed, processed copy.
const AUDIO_CONSTRAINTS = {
  suppressLocalAudioPlayback: true, // silence the original tab but keep capturing it
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export async function startCapture(onEnded: () => void): Promise<Capture> {
  // Throws NotAllowedError if the user cancels the share picker.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: AUDIO_CONSTRAINTS as MediaTrackConstraints,
    // Never offer this StrobeGuard tab or whole-system audio: capturing our own delayed output
    // would play it back again (an echo of the audio we already play).
    selfBrowserSurface: 'exclude',
    systemAudio: 'exclude',
  } as DisplayMediaStreamOptions);

  const video = document.createElement('video');
  video.muted = true; // audio goes through Web Audio later, never the <video>
  video.playsInline = true;
  video.srcObject = stream;
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach(t => t.stop());
    throw new Error('The shared source has no video track.');
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    videoTrack.removeEventListener('ended', ended);
    stream.getTracks().forEach(t => t.stop());
    video.pause();
    video.srcObject = null;
  };
  const ended = () => { stop(); onEnded(); };
  // Fires when the user clicks "Stop sharing" or the shared tab closes.
  videoTrack.addEventListener('ended', ended);
  try {
    await video.play();
    if (stopped || videoTrack.readyState === 'ended') throw new Error('The shared tab closed before capture started.');
  } catch (error) {
    stop();
    throw error;
  }

  const audioTrack = stream.getAudioTracks()[0];
  let localAudioSuppressed: boolean | null = null;
  if (audioTrack) {
    type AudioSettings = MediaTrackSettings & { suppressLocalAudioPlayback?: boolean };
    let settings = audioTrack.getSettings() as AudioSettings;
    // If Chrome didn't apply it at capture time, ask again on the live track.
    if (settings.suppressLocalAudioPlayback !== true) {
      try {
        await audioTrack.applyConstraints(AUDIO_CONSTRAINTS as MediaTrackConstraints);
        settings = audioTrack.getSettings() as AudioSettings;
      } catch {
        // Not supported for this surface: reported below as not suppressed.
      }
    }
    localAudioSuppressed = typeof settings.suppressLocalAudioPlayback === 'boolean' ? settings.suppressLocalAudioPlayback : null;
  }
  const surface = (videoTrack.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface ?? null;

  return {
    stream,
    video,
    hasAudio: stream.getAudioTracks().length > 0,
    localAudioSuppressed,
    surface,
    stop,
  };
}
