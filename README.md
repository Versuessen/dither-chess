# DITHER

Offline chess practice against human-like bots. Every opponent is a neural network trained on human
games and conditioned on a rating; it picks each move by sampling the predicted human move
distribution in one forward pass. No engine or search ever plays you, and there is no account and
no server. Stockfish is included for one job only: reviewing your finished games.

It runs as a web app (installable PWA, offline after the first visit) and as a desktop app for
Windows 11 and Fedora (KDE), from one codebase.

- **Bots that play like people of a rating**: one model, Maia-3 23M, from 600 to 2050. Every level
  is measured: matched to the move quality of held-out human games, then spaced by 400-game matches
  so that levels 200 apart play 200 Elo apart (see [CALIBRATION.md](CALIBRATION.md)). All ratings
  are on the Lichess rapid scale.
- **Ratings by FIDE's rules, one per speed**: bullet, blitz, rapid and classical (untimed games
  count as classical), each with the FIDE Rapid & Blitz Rating Regulations' method (monthly periods,
  K-factors, initial rating, 400-point rule) plus a live rating. Rated or casual is your choice for
  any clock. It is a training tool: any game can be aborted without rating, and a game's review can
  take it out of the rating (or put it back).
- **Game review**: Stockfish 19 (lite, WebAssembly, in the browser) evaluates every position: an
  evaluation bar, a timeline to scrub through, the best move and line, every move classed
  (brilliant, excellent, best, good, book, neutral, inaccuracy, mistake, blunder), and each side's
  accuracy after Lichess's method, with the better side marked on every line.
- **Puzzles**: about 48,000 well-tested puzzles from the Lichess puzzle database, filtered by
  difficulty (or your own puzzle rating), the piece that makes the key move, game phase and
  motif; picked at random without repeating recent ones, each opened by a sentence that names
  the goal ("Black has mate in three").
- **Opening names** from the Lichess opening tables, by position, during the game and in History.
- **A board like the big sites'**: last-move and premove highlights, right-click marks and arrows
  (knight arrows bend), seven piece sets, and every colour adjustable in Settings.
- **Live backgrounds**: each opponent's scene is rendered in real time on the GPU and screened in
  its own style (lines, ASCII glyphs, pixels, dots); behind the game the screens morph into each
  other across drifting blobs. Machines that cannot keep up, and reduced motion, get the
  pre-rendered stills.
- **Sound and music**: soft interface tones, CC0 board sounds, and optional quiet music: one of
  seven CC0 synth loops, or all of them in turn (see NOTICE).
- **Phones too**: the website works on phones (iOS included) with a main-menu layout.
- **Everything stays on your device**: games, ratings and backups (JSON + PGN).

## Install

### Web

Open **https://ditherchess.vercel.app** in a Chromium-based browser, Firefox or Safari, and
install it from the address bar if you like. The first visit downloads the model (Maia-3 23M,
27 MB) by itself while the start screen loads. After that it works without a connection.

### Windows 11

Download either installer from the release page; both install for the current user only and need no
administrator rights:

- `DITHER_<version>_x64-setup.exe` (NSIS)
- `DITHER_<version>_x64_en-US.msi` (Windows Installer, installs to `%LOCALAPPDATA%\Programs\DITHER`,
  or into the folder of an earlier DITHER install)

The installers carry the WebView2 runtime (offline installer), so they work without a connection.
The *offline* builds also carry the model pack.

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
pnpm test:e2e       # Playwright on the production build: a full rated game, puzzles, offline session,
                    # WCAG 2.1 AA (axe) and keyboard play, performance budgets, themes, reduced motion,
                    # the Stockfish review, and phones (iPhone size, touch)
pnpm test:static    # the website build on a plain static host: sub-path, no COOP/COEP (service-worker
                    # isolation), models installing by themselves, source archive, offline
DITHER_STATIC_URL=https://ditherchess.vercel.app pnpm test:static   # the same test on the live website
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
- **Models**: the build copies the committed pack (`models/packs`) next to the app and
  `DITHER_PREINSTALL=all` makes the site install it by itself (`DITHER_PREINSTALL` also takes a
  list of pack ids). The desktop app downloads the pack from the website too.
- **Source**: `DITHER_SOURCE_ARCHIVE=1` puts the source of the build at
  `/source/dither-source.tar.gz`, linked under Settings → System. The app is AGPL-3.0 and contains
  AGPL-3.0 (Maia-3) and GPL-3.0 (Stockfish) code, so the site has to offer its source even when this
  repository is private.

Every push to `main` deploys to production; other branches and pull requests get preview
deployments. The Vercel project is `dither-chess` in the team `dither-chess`; it answers at
`ditherchess.vercel.app` (the main address) and `dither-chess.vercel.app`. To set it up again
elsewhere: on vercel.com, **Add New → Project**, import this repository and deploy; the project
name becomes the address (`<name>.vercel.app`).

New model packs: build them (`pnpm models:all` with `DITHER_SITE_URL=https://ditherchess.vercel.app`,
so the manifest lists the website as their download address), then commit `models/packs` and
`models/manifest.json`. Keep the old pack files in `models/packs` while installed desktop apps may
still ask for them.

### Bundled data and assets

- `vendor/chess-openings`: the Lichess opening tables (CC0); `pnpm openings` rebuilds
  `src/chess/openings.json` from them.
- `vendor/stockfish`: Stockfish.js 19 lite (GPL-3.0), copied unchanged from npm, for game reviews.
- `public/sounds`: board sounds cut from CC0 packs by `python3 tools/sounds/make.py <downloads>`
  (sources in NOTICE), interface tones from `python3 tools/sounds/synth.py`;
  `public/music`: seven CC0 tracks, unchanged.
- `public/pieces`: five Lichess piece sets (licences in NOTICE), copied by
  `python3 tools/pieces/lichess.py <lila checkout>`, and the project's own 1-bit set.
- `public/puzzles`: the puzzle sample, `python3 tools/puzzles/build.py lichess_db_puzzle.csv.zst`
  (needs `zstandard`; fixed seed, the source's SHA-256 is in the file's first line).

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

The images are rendered by this project from signed distance fields; nothing is downloaded. The
staging of every scene (`src/dither/sceneSpecs.ts`) and the piece shapes
(`src/dither/pieceProfiles.ts`) are shared by the offline renderer, which makes the still images,
and the live GPU renderer (`src/dither/liveScene.ts`), so both show the same scene.

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
| `src/rating` | FIDE rating engine, ledger replay |
| `src/analysis` | Stockfish game review: evaluations, accuracy, move classes |
| `src/puzzles` | Puzzle set, filters and pick, the solving logic, puzzle rating |
| `src/storage` | One interface over IndexedDB, SQLite and memory; backups |
| `src/dither`, `src/design` | The WebGL2 dither layer, live scenes, and the design tokens |
| `src/screens`, `src/ui` | Screens and shared components |
| `src-tauri` | Desktop shell: SQLite, model store, Linux workarounds, installer config |
| `tools/models` | Model conversion, parity, quantisation and packing (uv) |
| `tools/calibrate` | Strength calibration and gauntlets (uv) |
| `tools/art`, `tools/vite` | Artwork renderer; build plugins (service worker, pack mirror) |
| `tools/puzzles`, `tools/pieces`, `tools/sounds` | Puzzle sample, piece-set import, sounds |
| `packaging` | RPM signing and installer smoke tests |

Decisions and the reasons for them are in [DECISIONS.md](DECISIONS.md).

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the models, fonts, data and
software it builds on.
