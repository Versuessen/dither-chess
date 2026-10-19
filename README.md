# DITHER

Offline chess practice against human-like bots. Every opponent is a neural network trained on human
games and conditioned on a rating; it picks each move by sampling the predicted human move
distribution in one forward pass. There is no engine, no search, no account and no server.

It runs as a web app (installable PWA, offline after the first visit) and as a desktop app for
Windows 11 and Fedora (KDE), from one codebase.

- **Bots that play like people of a rating**: fastelo (600–1900), Maia-3 5M (600–1950), Maia-3 23M
  (600–2050, optional download) and Maia-2 (1100–1800). Every level is measured: matched to the move
  quality of held-out human games, then (Maia) spaced by 400-game matches so that levels 200 apart
  play 200 Elo apart. fastelo keeps its own published calibration; its matches show levels between
  800 and 1800 playing closer together than labelled (see [CALIBRATION.md](CALIBRATION.md)). All
  ratings are on the Lichess rapid scale.
- **A rating by FIDE's rules**: rated rapid games are rated with the FIDE Rapid & Blitz Rating
  Regulations (monthly periods, K-factors, initial rating, 400-point rule), plus a live rating.
- **A move-quality estimate** after each game (fastelo's Rater), shown apart from the rating.
- **Everything stays on your device**: games, ratings and backups (JSON + PGN).

## Install

### Web

Open **https://dither-chess.vercel.app** in a Chromium-based browser, Firefox or Safari, and
install it from the address bar if you like. The first visit downloads every model by itself:
the one for your first game while the start screen loads (fastelo, 15 MB), the others (76 MB) in
the background while you play. After that it works without a connection.

### Windows 11

Download either installer from the release page; both install for the current user only and need no
administrator rights:

- `DITHER_<version>_x64-setup.exe` (NSIS)
- `DITHER_<version>_x64_en-US.msi` (Windows Installer, installs to `%LOCALAPPDATA%\Programs\DITHER`)

The installers carry the WebView2 runtime (offline installer), so they work without a connection.
The *offline* builds also carry every model pack.

### Fedora 44 and 45

The RPM is signed. Download it and the public key `dither-rpm-signing.asc` from the release page,
check the key's fingerprint against the one published there, import the key once, then install as
usual; signature checking stays on:

```bash
gpg --show-keys dither-rpm-signing.asc      # compare the fingerprint with the release page
sudo rpm --import dither-rpm-signing.asc
sudo dnf install ./DITHER-<version>-1.x86_64.rpm
```

An AppImage is also provided: `chmod +x DITHER_<version>_amd64.AppImage` and run it.

With NVIDIA's proprietary driver, WebKitGTK can show a blank window. DITHER detects the driver and
turns off WebKitGTK's DMA-BUF renderer for itself only (Settings → System shows when it did). Set
`DITHER_DMABUF=on` to keep the renderer, or `DITHER_DMABUF=off` to turn it off on any GPU.

## Develop

Requirements: Node 22.18+, pnpm 10; for the desktop app Rust 1.85+ and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/); for the model and calibration
tools [uv](https://docs.astral.sh/uv/).

```bash
pnpm install
pnpm dev            # http://localhost:5173 (cross-origin isolated)
pnpm build          # dist/, with the offline service worker and the model packs as a mirror
pnpm preview        # serve dist/ on http://localhost:4173
pnpm tauri dev      # desktop app against the dev server
pnpm tauri build    # desktop installers for this platform
pnpm tauri build --config src-tauri/tauri.offline.conf.json   # full-offline build (packs bundled)
```

### Tests

```bash
pnpm test           # unit tests: rules, clocks, PGN, rating, storage, encoders, model parity, packs
pnpm check          # strict type check
pnpm models:fetch   # check models/packs against models/manifest.json (SHA-256), fetch what is missing
pnpm test:e2e       # Playwright on the production build: a full rated game per model, offline session,
                    # WCAG 2.1 AA (axe) and keyboard play, performance budgets, themes, reduced motion
pnpm test:static    # the website build on a plain static host: sub-path, no COOP/COEP (service-worker
                    # isolation), models installing by themselves, source archive, offline
```

The model-parity tests run the exported ONNX models through onnxruntime-web when they are present in
`tools/models/work/onnx` (`DITHER_REQUIRE_MODELS=1` makes their absence an error). End-to-end tests
need the model packs in `models/packs` (committed; `pnpm models:fetch` checks them) and a Chromium
(`pnpm exec playwright install chromium`, or point `DITHER_CHROMIUM` at one).

### Website (Vercel)

The website is this repository deployed by Vercel's Git integration; `vercel.json` holds the whole
configuration, so the Vercel project needs no settings beyond importing the repository:

- **Build**: `DITHER_PREINSTALL=all DITHER_SOURCE_ARCHIVE=1 pnpm build` into `dist`. Vercel installs
  with the pnpm version that matches `pnpm-lock.yaml` (do not set an install command: an override
  runs pnpm 6) and builds with Node 24.
- **Headers**: COOP/COEP/CORP on every path, so the page is cross-origin isolated (multi-threaded
  inference) from the first load; long caching only for hashed assets and versioned packs.
- **Models**: the build copies the committed packs (`models/packs`) next to the app and
  `DITHER_PREINSTALL=all` makes the site install all of them by itself (`DITHER_PREINSTALL` also
  takes a list of pack ids). The desktop app downloads packs from the website too.
- **Source**: `DITHER_SOURCE_ARCHIVE=1` puts the source of the build at
  `/source/dither-source.tar.gz`, linked under Settings → System. The app is AGPL-3.0 and contains
  GPL-3.0 and AGPL-3.0 code, so the site has to offer its source even when this repository is
  private.

Every push to `main` deploys to production; other branches and pull requests get preview
deployments. Set up once: on vercel.com, **Add New → Project**, import this repository, keep the
project name `dither-chess` (it becomes `dither-chess.vercel.app`), and deploy.

New model packs: build them (`pnpm models:all` with `DITHER_SITE_URL=https://dither-chess.vercel.app`,
so the manifest lists the website as their download address), then commit `models/packs` and
`models/manifest.json`. Keep the old pack files in `models/packs` while installed desktop apps may
still ask for them.

### Models

```bash
cd tools/models
uv run dither-models all    # fetch (pinned), export to ONNX, parity, quantise, pack
```

This fetches the pinned upstream weights, exports them to ONNX (opset 18), checks parity on 2,016
positions against each model's own Python code (top-1 ≥ 99.9%, max |Δlogit| < 1e-3), keeps a smaller
variant only within KL 0.01, and writes `models/packs/*.dpk` and `models/manifest.json`. Reports are
in `tools/models/reports/`.

### Calibration

```bash
cd tools/calibrate
uv run dither-calibrate all   # positions, Stockfish analysis, fits, gauntlets, CALIBRATION.md
```

Stockfish (pinned official release) is used here only to score moves. It is never an opponent.

### Artwork

The images are rendered by this project from signed distance fields; nothing is downloaded.

```bash
pnpm art                                   # all scenes, about 6 minutes on 2 cores
pnpm art:pieces                            # the 1-bit piece set
```

## Layout

| Path | What lives there |
|---|---|
| `src/chess` | Rules and results (FIDE Laws), clock, PGN, time controls |
| `src/game` | Game controller, board, clocks, move list, sounds |
| `src/bots` | Personas and human behaviour (think time, draws, resignation) |
| `src/inference` | Encoders, sampling, calibration settings, the onnxruntime-web worker |
| `src/models` | Model Manager: manifest, packs, OPFS / desktop store, SHA-256 |
| `src/rating` | FIDE rating engine, ledger replay, move-quality estimate |
| `src/storage` | One interface over IndexedDB, SQLite and memory; backups |
| `src/dither`, `src/design` | The WebGL2 dither layer and the design tokens |
| `src/screens`, `src/ui` | Screens and shared components |
| `src-tauri` | Desktop shell: SQLite, model store, Linux workarounds, installer config |
| `tools/models` | Model conversion, parity, quantisation and packing (uv) |
| `tools/calibrate` | Strength calibration and gauntlets (uv) |
| `tools/art`, `tools/vite` | Artwork renderer; build plugins (service worker, pack mirror) |
| `packaging` | RPM signing and installer smoke tests |

Decisions and the reasons for them are in [DECISIONS.md](DECISIONS.md).

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the models, fonts, data and
software it builds on.
