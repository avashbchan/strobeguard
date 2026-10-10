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
