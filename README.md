# StrobeGuard

Photosensitivity-aware livestream viewer for Chrome desktop. Share a tab with a stream (Twitch, YouTube, concerts); StrobeGuard detects rapid flashing and shows a filtered version in real time to **reduce flash risk**.

> Reduces flash risk; not a medical device.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (Chrome)
npm run build      # typecheck + production build
```

Deploys to Vercel as a static Vite site (`vercel.json`). `getDisplayMedia` requires HTTPS or localhost.

## Structure

```
src/
  capture/   getDisplayMedia + hidden <video>
  buffer/    15-frame ring buffer (WebGL textures)
  detector/  pure flash-detection functions + Web Worker
  render/    WebGL setup and shaders
  audio/     Web Audio chain
  ui/        React components
  types.ts   shared contracts (RiskReport, FilterSettings)
```

## AI assistant rules

The team's master prompt lives in `CLAUDE.md` (Claude Code) and `.cursor/rules/strobeguard.mdc` (Cursor, always applied). Keep them in sync; update the **Current task** section as you work.
