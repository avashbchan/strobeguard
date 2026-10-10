# Render (Person A)

Milestone 2/4/5: WebGL setup and shaders (passthrough → damping → centered smoothing).

## Status
- [x] Milestone 2: WebGL2 passthrough of the oldest buffered frame (14-frame delay). `preserveDrawingBuffer: true`
  so the output detector can read the canvas back. Canvas drawing buffer matches source resolution.
- [ ] Milestone 4: mask-driven damping, red desaturation, contrast reduction, `?debugMask=` override.
- [ ] Milestone 5: centered temporal smoothing over past + future buffered frames.

## Files
- `renderer.ts` — frozen API (`createRenderer`), wires ring buffer + shader.
- `shaders.ts` — GLSL. Fullscreen triangle from `gl_VertexID`; `vUv.y = 0` is the TOP of the screen.
- `gl.ts` — compile/link helpers.
