# Scripts

## `flash-e2e.mjs` — end-to-end flash test

Runs the real app in real Chrome with real tab capture of `/test/flash.html`, steps through every
flash pattern, and checks the app's own readouts (input vs output flashes/s, risk meters).

```bash
node scripts/flash-e2e.mjs                              # production (https://strobeguard.vercel.app)
node scripts/flash-e2e.mjs http://localhost:5173        # local `npm run dev`
node scripts/flash-e2e.mjs --max-protection             # with Maximum protection on
ONLY=flash5,flash2 node scripts/flash-e2e.mjs           # subset of patterns
TRACE=1 node scripts/flash-e2e.mjs                      # also dump detector reports to trace-*.json
```

Needs Node ≥ 22 and Google Chrome. The default install location is found automatically on macOS,
Windows (`Program Files`, `Program Files (x86)` or `%LOCALAPPDATA%`) and Linux (`google-chrome`);
otherwise set `CHROME=/path/to/chrome`. Works from Git Bash, PowerShell or cmd on Windows. No npm dependencies. Takes about 80 s. Exit code 0 = all checks pass, 1 = a check failed,
2 = the run broke.

Chrome opens off-screen with a temporary profile and is closed afterwards. The test page flashes on
purpose, so don't watch those windows if you are photosensitive.

| Check | Pass condition |
|---|---|
| Static source | the big canvas shows a frame even though the shared tab isn't changing |
| `flash5`, `red5` (dangerous) | input > 3 flashes/s **and** output < 3 flashes/s (red: input red risk > 0) |
| `steady`, `flash2`, `single`, `fade`, `corner5` (safe) | input < 3 flashes/s |
| all patterns | output never flashes more than input (+0.5) |
| Session timeline | `flash5`, `red5` add a **high risk** segment; `flash2` (2 Hz for > 4 s) adds a **sustained caution** segment; calm patterns add nothing new (after a 1.5 s tail from the previous pattern). Skipped on builds without the timeline. |

## `iris-compare.mjs` — compare our detector with EA IRIS

Grades videos with EA's [IRIS](https://github.com/electronicarts/IRIS) and with our detector, frame by frame.

```bash
npm run dev                                         # serves the offline runner (src/detector/offline)
node scripts/iris/fetch.mjs                         # once: IRIS test videos, expected CSVs, Windows app (cached in %TEMP%)
node scripts/iris-compare.mjs                       # IRIS's 8 test videos
node scripts/iris-compare.mjs --dir=<folder>        # every video in a folder (IRIS runs with its fast settings)
```

Options: `--only=2Hz_6s,3Hz_6s`, `--mode=seek|play`, `--fresh` (ignore cached results), `--app=<url>`.
Our results are cached per video and detector version, and the report is rewritten after every video,
so an interrupted run resumes. Reports land in `<tmp>/strobeguard-iris/report/`. Long clips take about as
long as their duration (real-time playback). Needs Windows for the IRIS app; the 8 test videos can fall back
to IRIS's published expected CSVs elsewhere.

## `grade.mjs` — objective output-quality grading

Runs the **real** filter on video clips frame by frame and compares every output frame with the exact
unfiltered frame it shows. Use it to grade any change to the filter: save a baseline, change the code,
compare.

```bash
npm run dev
node scripts/grade.mjs --save=baseline        # grade the current code and keep it as "baseline"
# ...change the filter...
node scripts/grade.mjs --compare=baseline     # grade again; shows per-clip deltas (✓ better, ✗ worse)
```

Options: `--only=concert-strobe,dialogue`, `--max-protection`, `--corpus=<json>`, `--videos=<dir>`
(searched before `clips/`, the Drive set, and `test_videos/`), `--app=<url>`, `--save=<name>`. Clips are listed in `scripts/quality/corpus.json`
(`calm` clips should come out unchanged; `strobe` clips must be damped; `partial` and `caution` cover
small flashing areas and the 2–3 Hz band). Besides real clips, `synthetic` entries are scenes drawn frame by frame by
`src/grader/synthetic.ts`, so everyone grades identical pictures with no video files: full-screen and partial red strobes,
a 12.5% flash and a misaligned ~15% one (the detector over-counts that one as 25%+, see the IRIS gap G4), a flash just over
the 25% rule, a 2.5 Hz caution-band flash, a strobe over a dark scene (veil test) and a calm half beside flashing lasers
(collateral test). Reports and input|output
pictures (the 3 most damaged frames per clip plus 3 fixed points) go to `<tmp>/strobeguard-grade/<run>/`.

How it stays exact: the grader page (`src/grader/`) runs on a virtual clock (one frame = 1/30 s), so the
renderer shows exactly the frame from 14 steps earlier, and the reference "input" is a second copy of
the renderer with an all-zero mask (same frame, same decode path the viewer sees). A calm clip scores
100.0 with every metric at its ideal value.

| What can go wrong | Metric (OKLab, per frame, averaged) | Ideal |
|---|---|---|
| Pixels changed where nothing flashes | **Collateral ΔE** in areas the mask doesn't touch (≈1 just noticeable, ≥5 obvious) | 0 |
| Greyscaling / lost colour | **Chroma kept** (out / in), **Greyed** (% colourful pixels that lost > half their chroma) | 100%, 0% |
| Colour shifts | **Hue shift** (chroma-weighted, degrees) | 0 |
| Dimming / mud | **Light** (mean lightness out / in) | 1.00 |
| Grey haze / veil | **Black lift** (5th-percentile lightness out − in) | 0 |
| Blur, lost detail | **Edges** (edge energy out / in), **SSIM** (structure) | 1.00 |
| Trails / ghosting | **Ghost** (edges in the output that aren't in the input / input edges) | 0 |
| Flashes getting through (safety) | The detector run on the output: **Out max /s**, **Out >3/s (s)**, red risk | < 3, 0 |

**Score** (0–100) = collateral 25 + colour 20 + hue 10 + structure 20 + clarity 15 + tone 10.
**Safe** = output over 3 flashes/s for at most 0.5 s per clip and no full red-flash risk. A change only
counts as an improvement if the score goes up **and** every clip stays safe. Strobe clips can't reach
100: suppressing a flash necessarily changes those frames. Compare them between versions, not to 100.
Metric unit tests: `node --test src/grader/metrics.test.ts`.
