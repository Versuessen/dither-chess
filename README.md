# DITHER

Offline chess practice against human-like bots. Every opponent is a neural network trained on
human games and conditioned on a rating; it picks each move by sampling the predicted human move
distribution in a single forward pass. No engine, no search, no accounts, no servers.

Runs as a web app (installable PWA, offline after the first load) and as a desktop app for
Windows 11 and Fedora KDE, from one codebase.

> Status: Phase 1 of 7 (design system, themes, dither layer, roster and bot profile). The game,
> the model pipeline, calibration, the rating engine and the installers follow; see
> `DECISIONS.md` for what was decided and why.

## Run it

Requirements: Node 22.18+ and pnpm 10.

```bash
pnpm install
pnpm dev          # http://localhost:5173, cross-origin isolated
pnpm build        # production build in dist/, with the offline service worker
pnpm preview      # serve dist/ on http://localhost:4173
```

## Test it

```bash
pnpm test         # unit tests (Vitest)
pnpm check        # type check (svelte-check, strict TypeScript)
pnpm test:e2e     # end-to-end tests (Playwright) against the production build
```

Playwright needs a Chromium. `pnpm exec playwright install chromium` fetches its own; where
that download is blocked, point `DITHER_CHROMIUM` at any recent Chromium binary.

## Rebuild the artwork

The dither images are rendered by this project from signed distance fields; nothing is
downloaded.

```bash
pnpm art                                   # all scenes, about 6 minutes on 2 cores
node tools/art/render.ts hero mitre        # selected scenes
node tools/art/render.ts --scale 0.25 --preview /tmp/art   # quick look with greyscale previews
```

## Layout

| Path | What lives there |
|---|---|
| `src/design` | Colour tokens (the only place colours are defined), type, base styles, contrast maths |
| `src/dither` | WebGL2 dither layer: shader, renderer, motion maths, still portrait tile |
| `src/screens` | Preloader, Home roster, Bot profile, Models, Rating, History, Settings |
| `src/app` | Router, theme, boot progress, platform and service-worker registration |
| `src/bots` | Personas |
| `src/chess` | Time controls (FIDE classification), game setup |
| `src/models` | Model catalogue and installed-pack state |
| `tools/art` | Build-time SDF renderer for the subject images |
| `tools/vite` | Build plugin that writes the offline service worker |

## Licence

AGPL-3.0-or-later. See `LICENSE` and `NOTICE` for third-party models, fonts and data.
