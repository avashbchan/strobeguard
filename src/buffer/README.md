# Buffer (Person A)

Milestone 2: ring buffer of the last 15 frames as WebGL textures. Newest is analyzed, oldest is displayed.

## Status
- [x] `frameRing.ts`: `BUFFER_FRAMES` RGBA8 textures, allocated once per source size with `texStorage2D`,
  each frame uploaded with `texSubImage2D` (no per-frame allocation). Resolution change → reallocate and restart.
- `textureFromOldest(k)`: k = 0 is the displayed (oldest) frame, k = 1..14 are newer frames (look-ahead for
  centered smoothing, milestone 5). Clamped while the buffer is still filling.
- Each slot stores its capture time; `indexForAge(now, targetAge)` picks the displayed frame by age.
- Orientation: no `UNPACK_FLIP_Y`; texture v = 0 is the top row of the video.
