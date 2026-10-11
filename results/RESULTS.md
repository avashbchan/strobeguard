# StrobeGuard detector vs EA IRIS: measured results

All numbers below come from scripts in this repo (eval-video, iris-compare, iris-agreement, tune-sweep), run on 2026-10-10.
Raw outputs: `baseline.txt`, `after.txt` (+ `.json`), `baseline-iris.md`, `after-iris.md`, `tune-sweep.txt`, `tune-ratio.txt`, `after-e2e.txt`.

## Setup

- **Clips:** 14 clips, 11.1 min, 360p at 30 fps: the 13 clips of the shared Drive set plus one extra screen recording (`175331-(1)`, converted from 1312×732).
- **Categories** (confirmed by the team from still-frame contact sheets in `sheets/`): 5 dangerous (175331-(1), 4.18.03-PM, 4.19.02-AM, 4.23.11-AM, 4.34.51-AM); 9 safe (4.19.52-PM, 4.22.11-PM, 4.27.40-PM, 4.30.25-PM, 4.32.23-PM, 4.35.58-PM, 4.37.50-PM, 4.40.05-PM, salvia-simulation).
- **Labels** (`iris-labels.json`): frames EA IRIS 1.1.0 (full settings) grades as *flash failure* (luminance or red, grade 3), gaps < 0.5 s merged. Safe clips are labelled `[]`; `4.40.05-PM` had 3 IRIS blips (0.5 s) and was confirmed safe.
- **Split** (`split.json`, by clip, frozen before any tuning): tuning 9 clips, held-out 5 clips (175331-(1), 4.34.51-AM, 4.32.23-PM, 4.35.58-PM, 4.30.25-PM).
- **Commits:** detector before and after = `origin/main` b545936 (unchanged; see Tuning). Tools added on branch `results-tuning`.
- **Eval settings:** `eval-video --fps 30`, 14-frame look-ahead (the renderer's 467 ms delay); a displayed frame is damped when ≥ 12 of 48 cells have damping ≥ 0.8. False damping uses a settle margin (1 s before / 2 s after each label); the strict number without it is shown too.

## Before / after

Held-out first. **Before and after are identical:** the tuning sweep found no constraint-meeting improvement, so the constants were not changed (see Tuning).

| Set | Recall (dangerous seconds damped) | False damping, s per safe min | Strict false, s/min | Undamped frames per event, mean | Worst | Events |
|---|---|---|---|---|---|---|
| **Held-out, before** | 100% (97/97 s) | 1.56 (4 s / 2.6 min) | 1.56 | 0.00 (0 ms) | 0 (0 ms) | 2 (0 never damped) |
| **Held-out, after** | 100% (97/97 s) | 1.56 (4 s / 2.6 min) | 1.56 | 0.00 (0 ms) | 0 (0 ms) | 2 (0 never damped) |
| Tuning, before | 100% (24/24 s) | 10.15 (57 s / 5.6 min) | 11.97 | 0.40 (13 ms) | 6 (200 ms) | 15 (1 never damped) |
| Tuning, after | 100% (24/24 s) | 10.15 (57 s / 5.6 min) | 11.97 | 0.40 (13 ms) | 6 (200 ms) | 15 (1 never damped) |
| All clips | 100% (121/121 s) | 7.45 (61 s / 8.2 min) | 8.85 | 0.35 (12 ms) | 6 (200 ms) | 17 (1 never damped) |

Notes: the held-out set has only 2 dangerous events, both continuous strobes that start in the first second. The only event in any set not damped from its first frame is a 0.2 s IRIS blip in `4.19.02-AM` (tuning set; 6 frames, never damped). Most false damping on the tuning set comes from `4.40.05-PM` (Fortnite, fast cuts: 33 s damped in 43 s).

## IRIS agreement

| | Exact verdict (PASS/WARN/FAIL) | Dangerous or not | Mean fail-frame precision / recall (clips IRIS fails) |
|---|---|---|---|
| Before | 9/14 | 12/14 | 60% / 95% (6 clips) |
| After | 9/14 | 12/14 | 60% / 95% (6 clips) |

Disagreements (both runs): `4.19.52-PM` (juggler on a lit stage) and `4.30.25-PM` (Geometry Dash), which IRIS passes and our detector flags. IRIS averages brightness over the changing area of the frame; our detector judges 48 screen cells separately, so it is stricter on busy lighting and game effects. "IRIS fails" includes `4.40.05-PM` (3 short blips), which the team labelled safe.

## Tuning (tuning set only)

Goal: fewer undamped frames per event without more false damping (limit +0.5 s per safe minute), with recall staying 100%.
20 combinations of the cellTarget ramp start and slope (luminance and red), ATTACK_MS and RELEASE_MS were tried (`tune-sweep.txt`):

```
tune-sweep on the tuning set (9 clips: 4.19.02-AM, 4.23.11-AM, 4.18.03-PM, 4.19.52-PM, salvia-simulation, 4.37.50-PM, 4.40.05-PM, 4.27.40-PM, 4.22.11-PM), fps 30
combination                lum start/slope red start/slope attack release       recall  false/m strict/m undamp μ worst missed  ok?
base                       2.5 / 2         1.5 / 2             60     600 100% (24/24)    10.15    11.97     0.40     6      1   yes
attack 30                  2.5 / 2         1.5 / 2             30     600 100% (24/24)    10.50    12.30     0.40     6      1   yes
attack 15                  2.5 / 2         1.5 / 2             15     600 100% (24/24)    10.68    12.47     0.40     6      1   NO
lum start 2.25             2.25 / 2        1.5 / 2             60     600 100% (24/24)    10.86    12.63     0.00     0      0   NO
lum start 2.0              2 / 2           1.5 / 2             60     600 100% (24/24)    12.82    14.46     0.00     0      0   NO
lum slope 4                2.5 / 4         1.5 / 2             60     600 100% (24/24)    10.15    11.97     0.40     6      1   yes
lum 2.25 / slope 4         2.25 / 4        1.5 / 2             60     600 100% (24/24)    12.82    14.46     0.00     0      0   NO
lum 2.0 / slope 4          2 / 4           1.5 / 2             60     600 100% (24/24)    12.82    14.46     0.00     0      0   NO
red start 1.0              2.5 / 2         1 / 2               60     600 100% (24/24)    11.22    12.96     0.40     6      1   NO
red slope 4                2.5 / 2         1.5 / 4             60     600 100% (24/24)    10.15    11.97     0.40     6      1   yes
attack 30 + lum 2.25       2.25 / 2        1.5 / 2             30     600 100% (24/24)    11.57    13.30     0.00     0      0   NO
attack 30 + slope 4        2.5 / 4         1.5 / 2             30     600 100% (24/24)    10.50    12.30     0.40     6      1   yes
attack 30 + 2.25 / 4       2.25 / 4        1.5 / 2             30     600 100% (24/24)    13.00    14.79     0.00     0      0   NO
release 400                2.5 / 2         1.5 / 2             60     400 100% (24/24)     9.79    11.63     0.40     6      1   yes
release 900                2.5 / 2         1.5 / 2             60     900 100% (24/24)    11.22    12.96     0.40     6      1   NO
lum start 2.75 + att 30    2.75 / 2        1.5 / 2             30     600 100% (24/24)     8.01     9.81     0.40     6      1   yes
lum start 3.0 + att 30     3 / 2           1.5 / 2             30     600  96% (23/24)     7.66     9.31     1.47    16      2   NO
lum start 2.4              2.4 / 2         1.5 / 2             60     600 100% (24/24)    10.50    12.30     0.40     6      1   yes
lum start 2.3              2.3 / 2         1.5 / 2             60     600 100% (24/24)    10.86    12.63     0.40     6      1   NO
lum 2.25 / slope 1.5       2.25 / 1.5      1.5 / 2             60     600 100% (24/24)    10.86    12.63     0.40     6      1   NO

constraints: recall 100% and false damping ≤ base + 0.5 = 10.65 s per safe minute
```

**No combination reduced undamped frames within the false-damping limit, so the constants were kept.** Only starting the luminance ramp earlier (2.25 instead of 2.5) caught the missed 0.2 s blip (worst 6 → 0 frames; synthetic white burst 3 → 2 frames), but it raised false damping by 0.71 s per safe minute, over the limit. Per clip it had the best trade-off (6 frames saved for 1 extra false second on three clips of differing danger, `tune-ratio.txt`), and the team chose not to break the limit.

## For the slide (held-out numbers only)

- "Damped 100% of IRIS-flagged dangerous seconds (97 of 97) across 4.2 minutes of held-out real footage."
- "Zero unfiltered flash frames before damping engaged on the held-out dangerous events (0 ms; 2 events)."
- "1.56 false-damping seconds per minute on safe held-out content."

## Caveats

- **Small set:** 14 clips, 11.1 minutes. The held-out set is 5 clips (4.2 min) with only 2 dangerous events, so the held-out undamped-frames figure rests on 2 events; the tuning set shows the harder case (one 0.2 s blip never damped).
- **No tuning gain:** the task goal (fewer undamped frames) was not met within the constraints, so before = after.
- **eval-video was written during this task** from the spec, because it wasn't in the repo. One documented deviation: false damping uses a settle margin (1 s before / 2 s after each label), because the look-ahead and release easing damp just outside a label on purpose; strict numbers are reported alongside. On the synthetic clips it measured 3 undamped frames on the white 5 Hz burst, where about 4 was expected.
- **Files vs live capture:** the 360p/30 fps files and ffmpeg's downscale differ slightly from live tab capture and the browser's canvas smoothing.
- **Labels are IRIS flash failures only:** IRIS extended failure (2.0 s on `4.19.02-AM`) and pattern failures (none found) are not labelled. `175331-(1)` isn't in the shared zip, so others can't reproduce its row from Drive.
- **E2E:** 8/8 (`after-e2e.txt`). Observed but not investigated: the output red-risk meter reads 100% on the red 5 Hz pattern although the output flash rate is ~0.
