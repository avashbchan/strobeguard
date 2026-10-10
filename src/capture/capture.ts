// Tab capture: getDisplayMedia → hidden <video>.

export type Capture = {
  stream: MediaStream;
  video: HTMLVideoElement;
  hasAudio: boolean;
  stop: () => void;
};

export async function startCapture(onEnded: () => void): Promise<Capture> {
  // Throws NotAllowedError if the user cancels the share picker.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    // suppressLocalAudioPlayback mutes the original tab so the user only hears our filtered audio.
    audio: { suppressLocalAudioPlayback: true } as MediaTrackConstraints,
  });

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

  return {
    stream,
    video,
    hasAudio: stream.getAudioTracks().length > 0,
    stop,
  };
}
