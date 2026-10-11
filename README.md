<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/strobeguard-logo-tagline-dark.svg">
    <img src="public/brand/strobeguard-logo-tagline-light.svg" alt="StrobeGuard: Cut the flash. Keep the show." width="562">
  </picture>
</h1>

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

## Brand assets

Logos, the mark and the app icons are in `public/brand/` and `public/`. Each logo comes in a dark variant (for dark backgrounds) and a light one:

| File | Use |
|---|---|
| `public/favicon.svg`, `favicon-16.png`, `favicon-32.png` | Browser tab icon (the PNGs are fallbacks) |
| `public/apple-touch-icon.png` (180), `icon-512.png` | Home-screen / install icons (`site.webmanifest`) |
| `public/brand/strobeguard-mark*.svg`, `strobeguard-mark-512.png` | The shield mark alone |
| `public/brand/strobeguard-logo-{dark,light}.svg` | Mark + wordmark |
| `public/brand/strobeguard-logo-tagline-{dark,light}.svg` | Horizontal, with "Cut the flash. Keep the show." |
| `public/brand/strobeguard-stacked-tagline-{dark,light}.svg` | Stacked, with tagline (slides, posters) |
