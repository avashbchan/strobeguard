// OWNER: Person C. Keep renderer/detector calls compatible with the frozen APIs.
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Capture } from '../capture/capture';
import { createRenderer } from '../render/renderer.ts';
import { createDetector } from '../detector/detector.ts';
import { EMPTY_MASK, type FilterSettings, type RiskReport } from '../types.ts';
import { smoothFrameRate, type FrameTiming } from './frameTiming.ts';

export type PipelineState = {
  input: RiskReport | null;
  output: RiskReport | null;
  delayFrames: number;
  measuredFps: number;
  error: string | null;
};
const INITIAL: PipelineState = { input: null, output: null, delayFrames: 0, measuredFps: 30, error: null };

export function usePipeline(capture: Capture | null, outputRef: RefObject<HTMLCanvasElement | null>, settings: FilterSettings): PipelineState {
  const [state, setState] = useState<PipelineState>(INITIAL);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    setState(INITIAL);
    const canvas = outputRef.current;
    if (!capture || !canvas) return;
    let renderer: ReturnType<typeof createRenderer> | undefined;
    let inputDetector: ReturnType<typeof createDetector> | undefined;
    let outputDetector: ReturnType<typeof createDetector> | undefined;
    let stopped = false;
    let handle = 0;
    const { video } = capture;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
      inputDetector?.dispose();
      outputDetector?.dispose();
      renderer?.dispose();
    };
    try {
      if (!video.requestVideoFrameCallback) throw new Error('Use Chrome desktop with video frame callbacks enabled.');
      renderer = createRenderer(canvas);
      let mask: readonly number[] = EMPTY_MASK;
      inputDetector = createDetector(r => {
        if (stopped) return;
        mask = r.cellMask;
        setState(s => ({ ...s, input: r }));
      });
      outputDetector = createDetector(r => {
        if (!stopped) setState(s => ({ ...s, output: r }));
      });
      let fps = capture.stream.getVideoTracks()[0]?.getSettings().frameRate || 30;
      let previous: FrameTiming | null = null;
      let publishedAt = 0;
      setState(s => ({ ...s, delayFrames: renderer!.delayFrames, measuredFps: fps }));
      const onFrame = (now: number, metadata: VideoFrameCallbackMetadata) => {
        if (stopped) return;
        try {
          if (previous) {
            fps = smoothFrameRate(fps, previous, metadata);
          }
          previous = { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames };
          if (now - publishedAt >= 250) {
            publishedAt = now;
            setState(s => ({ ...s, measuredFps: fps }));
          }
          renderer!.pushFrame(video);
          inputDetector!.analyze(video);
          renderer!.draw(mask, settingsRef.current);
          outputDetector!.analyze(canvas);
          handle = video.requestVideoFrameCallback(onFrame);
        } catch (error) {
          cleanup();
          setState(s => ({ ...s, error: String(error) }));
        }
      };
      handle = video.requestVideoFrameCallback(onFrame);
    } catch (error) {
      cleanup();
      setState(s => ({ ...s, error: String(error) }));
    }
    return cleanup;
  }, [capture, outputRef]);
  return state;
}
