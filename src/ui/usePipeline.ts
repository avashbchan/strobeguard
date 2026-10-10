// OWNER: Person C (UI). Frame loop that wires capture → renderer → detectors.
// Person A and B never edit this file; they only implement the APIs it calls.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Capture } from '../capture/capture';
import { createRenderer } from '../render/renderer.ts';
import { createDetector } from '../detector/detector.ts';
import { EMPTY_MASK, type FilterSettings, type RiskReport } from '../types.ts';

export type PipelineState = {
  input: RiskReport | null; // detector on the raw (newest) frame
  output: RiskReport | null; // detector on the filtered output canvas (proof)
  delayFrames: number;
  error: string | null;
};

export function usePipeline(
  capture: Capture | null,
  outputRef: RefObject<HTMLCanvasElement | null>,
  settings: FilterSettings,
): PipelineState {
  const [state, setState] = useState<PipelineState>({
    input: null,
    output: null,
    delayFrames: 0,
    error: null,
  });
  // Read settings through a ref so slider changes don't restart the loop.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = outputRef.current;
    if (!capture || !canvas) return;

    let renderer;
    try {
      renderer = createRenderer(canvas);
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }));
      return;
    }
    let mask: readonly number[] = EMPTY_MASK;
    const inputDetector = createDetector((r) => {
      mask = r.cellMask;
      setState((s) => ({ ...s, input: r }));
    });
    const outputDetector = createDetector((r) => setState((s) => ({ ...s, output: r })));
    setState((s) => ({ ...s, delayFrames: renderer.delayFrames, error: null }));

    const { video } = capture;
    let handle = 0;
    let stopped = false;
    // requestVideoFrameCallback fires once per NEW source frame (source frame rate).
    const onFrame = () => {
      if (stopped) return;
      renderer.pushFrame(video); // newest frame into the ring buffer
      inputDetector.analyze(video); // analyze the newest frame
      renderer.draw(mask, settingsRef.current); // display the oldest frame, filtered
      outputDetector.analyze(canvas); // proof: measure what the viewer actually sees
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);

    return () => {
      stopped = true;
      video.cancelVideoFrameCallback(handle);
      inputDetector.dispose();
      outputDetector.dispose();
      renderer.dispose();
    };
  }, [capture, outputRef]);

  return state;
}
