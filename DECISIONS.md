# Decisions

One line of reasoning per decision. Newest phase last. "Deviation" marks a place where the
brief could not be followed literally; the closest faithful option is described instead.

## Facts checked before building (19 Oct 2026)

| Claim in the brief | Checked against | Result |
|---|---|---|
| fastelo on Hugging Face, GPL-3.0, ~7M params, `calibration.json`, NumPy `fastelo.lite`, `Rater` | HF `irsotarriva/fastelo` @ `eb9e26fc363adbb74ada76d03f018be3fd398bb3`; code `github.com/irsotarriva/fastelo` @ `65c5612d15923309a2fc6d99796da2b6efe9d897` | Correct. Two 6.93M-parameter safetensors networks (`player`, `strong_player`), plus a WDL head. Code lives on GitHub, not on HF. |
| fastelo calibration "interpolate between rows" | `fastelo/lite.py::settings()` | The published calibration is a piecewise-linear temperature curve (knot 1650), an Elo-input offset interpolated between knots (edge-clamped below 700), and a strong-player ramp from 2100. See Phase 3 below. |
| Maia-3 5M on HF, code in `CSSLab/maia3`, AGPL-3.0 | HF `UofTCSSLab/Maia3-5M` @ `b6559de2398d7140b985f28fd2c19fb5e47ddabe`; code @ `1e13597c42d4858b7cfd7cfdae01e297263364b2` | Correct; code is AGPL-3.0. Inputs: 8 positions of 12 piece planes (mirrored for black), no castling or en-passant input; SelfElo/OppoElo linearly interpolated over 0–5000; policy 4352 moves; WDL value head. |
| Maia-2 rapid ONNX in `maia-platform-frontend` | repo @ `a6e52f5c811ee18863cb2f0e81f2433a5b9905de` | Removed from the tree in commit `c956db4` (Feb 2026); the release URL that commit points to now returns 404. The file survives in git history (`public/maia2/maia_rapid.onnx`, 93 MB). Maia-2 is MIT; the frontend repo is GPL-3.0. |
| FIDE B02 in force since 1 March 2024 | handbook.fide.com `B022024`, `B02RBRegulations2024` | Correct. Later amendments: R&B 7.3.1 (1 Dec 2024, 600-point rule above 2600) and standard 8.3.1 (1 Oct 2025, 400-point rule only below 2650). Neither changes results in a 600–2200 pool; both are implemented. The text contains **no worked examples**. |
| Fedora 45, Plasma 6.7, signature enforcement | Fedora schedule and Changes/Enforcing_signature_checking_by_default | Release 20 Oct 2026 with Plasma 6.7; enforcement accepted for F45. |
| Tooling versions | npm registry | Vite 8.3, Svelte 5.57, Tauri 2.12, onnxruntime-web 1.30, chess.js 1.4, chessground 9.2. |

## Environment

- The build workspace cannot reach huggingface.co, database.lichess.org or Playwright's browser CDN (GitHub, npm, PyPI and Ubuntu apt work). Model conversion, parity and calibration tools are written to run in CI or on a developer machine; their results are committed when they have run.
- The attached reference screenshots did not arrive; the design follows the written description of hyper-dreams.com.
- End-to-end tests run locally on Chromium 153 from the `@sparticuz/chromium` npm package (set `DITHER_CHROMIUM`); CI uses `playwright install chromium`.

## Phase 1 — scaffold, tokens, themes, dither hero

### Stack
- **Svelte 5 over SolidJS**: built-in transitions cover the panel fade-and-scale and the preloader choreography, runes give fine-grained state without a store library, and the compiled output is small (94 kB JS before gzip for Phase 1).
- **TypeScript 6.0, not 7.0**: `svelte-check` supports TS ^5 || ^6 only; TS 7 (native) has no compatible language-service API yet.
- **Vite 8** with a single app plus `src-tauri`; Python tooling lives in separate `uv` projects under `tools/`.
- **Raw WebGL2, no OGL or three.js**: one full-screen triangle and three textures; a library would add code without removing any.
- **Hash routing**: identical behaviour on a static host, offline from the service worker, and inside Tauri's custom protocol.
- **Own service worker instead of Workbox**: it must also add COOP/COEP/CORP headers to every response so the page is cross-origin isolated on hosts that cannot send headers; a 60-line worker and a 40-line Vite plugin do that plus precaching. First visit on such a host reloads once when the worker takes control.

### Palette and design language
- **Concept: the duplicate scoresheet.** Tournament scoresheets are carbonless sets; the copy is yellow and the writing comes through blue-violet. That gives a duotone that is vivid, chess-specific and not the reference's blue/orange.
  - Light: shadow ink carbon blue `#7486F7`, light ink copy yellow `#F1DE52`, amber `#F0A93A` bleeding in along the top edge; chrome ink `#121212` on scoresheet white `#F5F5F2` (cool, not cream).
  - Dark: shadow `#0A0A0A`, light ink carbon blue `#3A3CF2`, violet `#6A2BEA` bleed, violet `#7B3DFF` as the thin tint in the brightest line cores; chrome `#EDEDED` on `#0A0A0A`.
  - One accent: flag red `#E5391F`, reserved for the clock flag.
  - Board sets: classic stone (`#ECEBE5`/`#A8A294` light, dimmer in dark) and duotone (the two inks).
- **WCAG AA is measured, not assumed**: `tests/unit/contrast.test.ts` parses `tokens.css` and checks every text token against every ink it can sit on, including the bleed and the tint. No text halo is needed, so `--text-halo` is `none`.
- **Deviation — text over the dither in light theme is ink, not off-white.** Off-white on yellow is about 1.2:1; dark ink passes at 6:1 or better on every light-theme ink.
- **Deviation — the bottom corners (SETTINGS, HISTORY) are at 90% opacity and a smaller size, not 50%.** At 50% the dark-theme text drops to about 2.5:1 on carbon blue; 90% keeps 4.8:1, and the smaller size carries the lower emphasis.
- **Deviation — the PLAY button is ink-on-paper in light theme.** An off-white button on a paper panel disappears; in dark theme it is off-white with black text as described.
- **The logo uses ink in light theme** and white in dark theme and on the preloader.
- **Logo**: a concave four-point star whose points lie on knight moves from the centre square ((2,1), (−1,2), (−2,−1), (1,−2)), so it sits turned by atan(½); the heavy italic wordmark runs through it and each cuts the other (XOR), letting the dither show through. A first version with forked points on all eight knight targets read as a cross pattée and was dropped; the star crosses the word rather than sitting between letters, to stay clear of the H✦D arrangement.
- **Type**: Departure Mono 1.500 (OFL) for UI at 14 px, uppercase, 0.12em; Archivo variable (OFL, wdth 62–125, wght 100–900) at weight 800 and 92% width for display. Departure Mono is drawn on an 11 px grid, so it is crisp at DPR 2 and slightly soft at DPR 1 at the brief's 13–15 px; the brief's size range was kept.
- **Display size** reduced to `clamp(38px, 4.5vw, 66px)` and the logo centred at 61% of the width, so the longest roster row clears the logo at common desktop widths.
- **Personas** describe typical human play at their level on Lichess rapid, because that is what the models imitate. A persona never changes how a bot plays; it is a name, an image and a default level.

### The dither layer
- **Pipeline**: luminance texture → horizontal line screen (line thickness follows tone, sampled at the line centre so each line stays symmetric) → ripple `sin(2π·x / (width/8))` whose amplitude itself varies along x → duotone → hash grain on every pixel, flat areas and the preloader black included.
- **Depth layers**: each subject texture packs R = subject luminance, G = subject coverage, B = background luminance, so the subject and background planes take separate parallax offsets from one texture; the grain is the third plane.
- **Board rhythm**: the ripple wavelength is exactly one eighth of the viewport width.
- **Knight drift**: the planes move on an invisible 5×5 board in knight moves, long leg first then short leg, each with an eased snap (6.5 s period, 1.2 s per move); deterministic from a seed.
- **Swap**: a 400 ms threshold dissolve per line segment: old lines thin and break, then new ones form.
- **Promotion**: hovering or focusing PLAY morphs a pawn into a queen (12 pre-rendered frames, interpolated). Because the open panel covers most of the background, the morph also plays in the panel's portrait tile; the tile is otherwise a still image, so it only moves in answer to that action.
- **Budget**: rendering at device pixels capped at DPR 2, frame-limited to 60 fps, stopped when the tab is hidden, stopped entirely once the calm game backdrop or the still portrait has settled; idle work in the shader (outgoing image, morph atlas) sits behind uniform branches.
- **Reduced motion** (system setting or Settings → Motion → Reduce): one static frame per state change, no parallax or drift, frozen wave and grain, instant swaps, CSS transitions cut.

### Subject images
- **Rendered by this project**: `tools/art` is a CPU sphere tracer for Staunton-style SDF pieces (lathe profiles, extruded knight head, board slab with box-filtered checkers), with soft shadows, AO and a rim light. 15 scenes plus a 12-frame promotion atlas, 2.1 MB of PNG in total. No third-party images or models are used, so there is nothing to attribute.
- "A hand lifting a piece" was left out: it is people-adjacent and could not be modelled convincingly as an SDF.

### Preloader
- Black with live grain while the bar fills (fonts, first image; later the inference worker), then the logo alone, then the lines grow in. With everything cached it lasts about 1.2 s; with reduced motion it is a plain fade.
