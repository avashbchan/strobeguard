# Person C: UI, audio, integration

Branch: c-ui-audio. Milestones 6, 7 and 8 are implemented in Person C's owned paths.
Frozen contracts, renderer/detector code and package/config files are unchanged.

## Milestone 6: audio
- Context creation and resume start in the Share a tab click, before the share picker resolves.
- Chain: source → delay → 200 Hz low-shelf → compressor/limiter → volume → destination.
- Audio parameters ramp smoothly; gain starts muted until the buffer delay is initialized.
- Delay follows renderer.delayFrames / smoothed source FPS from video frame callback metadata.
- Bass range: -24 to 0 dB; volume: 0 to 1.
- Cancellation, stop, external track end, playback errors, unmount and no-audio sessions release resources.

Chrome check: open the app, acknowledge the warning, share a video tab with tab audio.
Bass and volume controls should enable. At 30 fps and 14 delay frames the buffer delay is about
467 ms; at 60 fps about 233 ms. Change volume/bass and stop sharing; audio should stop.
Visible speech synchronization still needs verification once Person A's renderer is merged.

## Milestone 7: proof
- Two independent canvas graphs show the last ten seconds, with the labelled 3 flashes/s threshold.
- Sample histories stay in refs, are sampled at at most 20 Hz and expire after ten seconds.
- Input/output general flash and saturated red meters use steady colors and eased widths.
- The raw source preview remains small; only the renderer draws the large output.

Chrome check: share a video; both graphs should scroll while rates and meters update.
After Person B merges the detector/test page, use public/test/flash.html to check nonzero rates.
The current detector stub reports zero; the current renderer stub produces black output.
Do not infer actual flash mitigation from these stub values.

## Milestone 8: controls and recovery
- Brightness 0.3–1, saturation 0–1 and maximum protection update the existing settings pipeline.
- Audio controls disable when audio is absent/unavailable.
- Cancellation/denial is recoverable; external stop/tab close returns to the start state.
- WebGL initialization and pipeline errors stop capture/audio and remain visible for retry.
- Disclaimer remains visible; controls have labels, keyboard access and focus indicators.

Chrome check: change picture controls; their displayed values should update. Their visual effect
requires Person A's renderer. Cancel the picker and retry. Share without audio, then stop/close
the source tab. The app should return to Share a tab with no active tracks/audio.

## Validation
- TypeScript and production build pass.
- Three Node tests pass: audio wiring/control/cleanup, capture lifecycle/failure cleanup,
  and FPS smoothing including dropped callbacks, changing rates and invalid metadata.
- Browser synthetic checks passed: warning acknowledgement; active audio; all control ranges;
  graphs and meters; manual stop; source closure; no audio; cancellation; WebGL unavailable.
- No browser console errors/warnings during those checks.
- Real tab audio/lip sync and real flash mitigation are not claimed as verified.

Run the tests using Node >= 22.18 (Node 24 is bundled locally):
    node --test src/audio/audio.test.mjs src/capture/capture.test.mjs src/ui/frameTiming.test.mjs
    npm run build

A development-only harness is at /src/ui/testing/index.html.
It produces a steady synthetic video and quiet tone, with selectable With audio / No audio /
Cancel sharing / WebGL unavailable scenarios and a Simulate tab closed button. It never captures
a real screen or microphone. It is outside the production entry and refuses production mode.

## Integration handoff
After A and B merge their PRs, merge origin/main into c-ui-audio, run npm run build, then
perform the Chrome checks above. Report API mismatches to the appropriate owner instead of
editing their files. This implementation is delivered on c-ui-audio; integration checks remain
pending until the renderer and detector branches merge.
