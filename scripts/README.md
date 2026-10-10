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

Needs Node ≥ 22 and Google Chrome (set `CHROME=/path/to/chrome` if it isn't in the default macOS
location). No npm dependencies. Takes about 80 s. Exit code 0 = all checks pass, 1 = a check failed,
2 = the run broke.

Chrome opens off-screen with a temporary profile and is closed afterwards. The test page flashes on
purpose, so don't watch those windows if you are photosensitive.

| Check | Pass condition |
|---|---|
| Static source | the big canvas shows a frame even though the shared tab isn't changing |
| `flash5`, `red5` (dangerous) | input > 3 flashes/s **and** output < 3 flashes/s (red: input red risk > 0) |
| `steady`, `flash2`, `single`, `fade`, `corner5` (safe) | input < 3 flashes/s |
| all patterns | output never flashes more than input (+0.5) |
