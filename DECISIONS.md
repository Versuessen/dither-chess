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

- During Phase 1 the build workspace could not reach huggingface.co or database.lichess.org; from Phase 2 on it can, so model conversion, parity and calibration ran here and their reports are committed. Playwright's browser CDN stays unreachable.
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

## Phase 2 — rules, clocks, game screen, storage

### Rules (FIDE Laws of Chess, 1 Jan 2023)
- **chess.js for move generation only.** Results are decided in `src/chess/rules.ts` and `game.ts`, because chess.js's `isDraw()` mixes claimable and automatic draws.
- **Threefold repetition and the 50-move rule are claims** (9.2, 9.3): the human gets a "Claim draw" button when one is available; bots claim when their expected score is at most 0.5. **Fivefold and 75 moves end the game automatically** (9.6). Repetition keys follow 9.2.2: placement, side to move, castling rights and an en-passant square only when a legal en-passant capture exists.
- **Insufficient material** (5.2.2) is "no sequence of legal moves can mate": K vs K, K+minor vs K, and K+B vs K+B with all bishops on one colour. Other dead positions (blocked pawn chains) are not detected, which FIDE allows to be settled by arbiter or agreement.
- **Flag fall** (6.9): a loss, unless the opponent cannot mate by any series of legal moves, then a draw. The test for "cannot mate" is ported from scalachess `InsufficientMatingMaterial` (MIT), which is conservative in the same direction FIDE is.
- **Abort**: a game that ends before both sides have moved is aborted, not lost or drawn, and never rated. Leaving a running game after that point is a loss by abandonment.
- **Takebacks** are allowed in any game; one takeback makes the game unrated for good, shown at once in the header.
- **Time control**: rapid, blitz and bullet are classified by the FIDE R&B definition (base + 60 × increment); only rapid can be rated, and untimed games are always casual.

### Clocks and PGN
- **The clock is timestamp-based** (`performance.now()` differences), not a ticking counter, so a throttled tab or a slow frame never loses time; the increment is added after each completed move (Fischer).
- **PGN**: the Seven Tag Roster plus `UTCDate`, `UTCTime`, `TimeControl`, `Termination`, `SetUp/FEN` and `[%clk]` comments, lines wrapped at 80 columns, as Lichess exports them.

### Game screen
- **chessground 9** (GPL-3.0, compatible with AGPL) for the board. The squares are drawn by the app (an 8×8 grid of token colours), so the board follows the theme and the duotone board set without bitmap assets.
- **Pieces**: chessground's cburnett set (GPL-2.0+, by Colin M.L. Burnett) and a 1-bit set generated in `tools/art/pieces1bit.ts` from the same SDF pieces as the artwork.
- **chessground must start interactive.** It only binds its input events if `viewOnly` is false when it is created, so the board is never created view-only; read-only states (review, game over) clear `movable.color` and premoves instead.
- **Sounds are synthesised** with WebAudio (move, capture, check, end, low-time tick), so there are no audio files to license or download.
- **Review**: arrow keys, Home and End step through the game; a new move returns to the live position; `F` flips the board.
- **The game always ends somewhere on record**: leaving, closing the tab (`beforeunload` asks first) and a crash all leave a stored game. On the next start an unfinished game is settled as abandoned or aborted under the same rules.

### Bots' human behaviour
- **Think time** comes from a per-move budget (remaining / expected moves left + ¾ increment), scaled by the normalised entropy of the bot's own move distribution, faster in the opening, with log-normal noise. Forced moves take 0.25–0.7 s, near-certain moves at most 2.5 s, and a bot never spends more than 6% of its remaining clock on one move or lets its clock fall below 2 s by thinking. Inference time is subtracted, so the visible pause is the planned one. "Instant bot" in Settings removes the pause.
- **Draw offers**: with a WDL head a bot accepts from move 10 when its expected score is at most 0.47; models without a WDL head accept only dead draws (insufficient material). The human may offer once every ten plies.
- **Resignation is rare**: never below 1000; from 1000 a bot needs an expected score of 2% or less, a material deficit of at least a queen and five such moves in a row, then resigns with probability ¼; from 1500 it needs 3%, five points down for three moves, probability ½.

### Storage
- **One `AppStorage` interface** with IndexedDB (web), SQLite through `tauri-plugin-sql` (desktop) and memory (tests, and a fallback when the browser refuses IndexedDB, e.g. some private windows; History then says that games last only until the tab closes).
- **The rating ledger is append-only**: SQLite enforces it with `BEFORE UPDATE`/`BEFORE DELETE` triggers; IndexedDB exposes no update or delete for it. Restoring a backup is the only way to replace it, and replays it.
- **Backup**: one JSON file (games, ledger, settings, format version) plus a PGN of every game; import validates the format before replacing anything.
- Records are cloned through JSON on the way in, which also unwraps Svelte state proxies (IndexedDB's structured clone rejects them).

## Phase 3 — model pipeline, inference worker, Model Manager

### Pipeline (`tools/models`, a uv project)
- **Every upstream input is pinned** by revision and SHA-256 in `sources.lock.json`; `dither-models fetch` refuses a file whose checksum differs.
- **Maia-2 rapid** is taken from `maia-platform-frontend` git history (`c956db4^:public/maia2/maia_rapid.onnx`), its last published location; the ONNX is used as is.
- **fastelo and Maia-3 are exported from PyTorch** with the dynamo exporter at opset 18 (onnxruntime-web 1.30 supports up to opset 23). Only the policy and value heads used at play time are exported.
- **Parity**: 2,016 positions (2,000 sampled from Lichess rapid games plus 16 edge cases: promotions, en passant, castling, mates, a 99-halfmove clock), each with a rating drawn from the model's range. The reference for fastelo is its NumPy `lite` implementation (the published inference path), for Maia-3 the official PyTorch model, for Maia-2 the official preprocessing feeding the original ONNX. All four pass: top-1 agreement 100%, max |Δlogit| ≤ 2.7e-5 (`tools/models/reports/parity.md`).
- **Golden tests in TypeScript** compare our encoders bit for bit with the Python encoders on 136 positions per model (the first 120 sampled positions plus all 16 edge cases), and run the exported ONNX through onnxruntime-web (Node) against the Python logits.
- **Quantisation**: a float16-weights variant (weights stored as fp16, cast to fp32 once at load) and an int8 dynamic variant (MatMul/Gemm, per channel). A variant ships only if the KL divergence from the fp32 model is at most 0.01 at **every** parity position (the brief's threshold, applied to the worst position rather than the mean); the smallest passing variant becomes the pack's model.

### Encodings (ported exactly)
- **fastelo**: the side to move's perspective, castling as [own K, own Q, opponent K, opponent Q], en-passant file or 8, halfmove clock clamped at 100, ply clamped at 255, time-control token 3 (rapid). Value head = [loss, draw, win] logits.
- **Maia-3**: eight positions, each tokenised from its own side to move's perspective (mirrored for Black) and front-padded with the earliest; self and opponent Elo as int64.
- **Maia-2**: 18 planes on the mirrored board; Elo buckets as in Maia-2 (<1100, 100-point bands to 1999, ≥2000). The value head is a scalar in [−1, 1], mapped to an expected score; Maia-2 has no draw probability, so draw offers fall back to dead positions only.

### Sampling
- One forward pass per move, softmax of the legal-move logits at the calibrated temperature, then top-p as in Maia-3's sampler (keep moves while the cumulative probability ≤ p, always at least one), drawn from a seeded sfc32 generator; the seed is stored with the game.
- **fastelo levels use fastelo's published calibration exactly**: conditioning Elo = level + interpolated offset (edge-clamped), temperature from the two-slope curve around 1650, the strong network mixed in only from 2100, so never at 600–1900.
- **Maia levels are hidden until measured.** A Maia pack exposes only the levels in its calibration file from `tools/calibrate`; until then it is listed but not selectable.

### Runtime
- **One dedicated worker** runs onnxruntime-web in browser and desktop alike. WASM SIMD always; threads (up to 4, one core kept free) only when the page is cross-origin isolated, otherwise one thread.
- **WebGPU only when an adapter exists**: the worker imports onnxruntime-web's WebGPU build (in 1.30 the native WebGPU execution provider on an asyncify WASM, 27 MB) only after `navigator.gpu.requestAdapter()` returns one, and the plain WASM build (14 MB) otherwise; a WebGPU session that fails to create falls back to WASM. Both are precached by the service worker so either works offline.

### Model Manager and packs
- **Pack format `.dpk`**: "DPK1", a JSON header listing each file's offset, size and SHA-256, then the files (`model.onnx`, `vocab.json`, `calibration.json`, `LICENSE`). One file per model keeps downloads resumable and verifiable as a unit.
- **`models/manifest.json`** is generated by `dither-models pack` and lists id, version, sha256, size, licence, upstream revision, variant and calibrated levels.
- **Sources**: a GitHub Release of this repository first, then a mirror. Browsers cannot follow GitHub's release redirect (no CORS headers on the asset host), so on the web the same-origin mirror (`models/packs/` next to the app) is used; the desktop app downloads in Rust and can use either. Both are editable in Models → Sources.
- **Storage**: OPFS on the web, the app-data directory on desktop. Downloads resume with HTTP `Range` into a `.part` file; the whole pack is hashed in a worker with a streaming SHA-256 before it is moved into place.
- **A pack is verified before every first use in a session** (cached by size and modification time); an unverified or damaged pack is never loaded, and the Models screen says why.
- **Import from file** accepts a `.dpk` only if its size and SHA-256 match a manifest entry; anything else is refused.

## Phase 4 — calibration

See [CALIBRATION.md](CALIBRATION.md) for method, data and results; the decisions behind them:
- **Held-out data**: Lichess rapid games from September 2026 (CC0), published after the training data of every model (fastelo: 2025 dumps; Maia-3: Jan 2023 – Jul 2025; Maia-2 earlier). A fixed compressed byte prefix of the monthly file is read; its SHA-256 is recorded.
- **Stockfish 19** (official `sf_19` Linux build, SHA-256 pinned in `tools/calibrate/sources.lock.json`) is used only to score moves: every legal move at 20,000 nodes per move, as fastelo's own calibration does. It never plays.
- **fastelo keeps its published calibration** (the brief); it is measured on the same held-out positions and in the gauntlet, not refitted.
- **Maia-3 (5M and 23M) are fitted with fastelo's method** (`fastelo/calibrate.py`): temperature curve, then a rating-input offset per band within ±300; no strong-model mixing, since Maia has none, and no top-p (1.0), since fastelo's method has none. Both rating inputs of the model get the same value, as fastelo does.
- **Maia-2 takes ratings in 100-point buckets**, so there is no continuous input to solve for. Deviation: every level from 1100 to 2000 uses its own bucket and a temperature solved so the expected loss equals the human loss at that rating.
- **Calibration runs on the shipped (quantised) model** inside the pack, after the pack's checksum is verified against the manifest.
- **Gauntlets** play the bots as the app does (same sampling, draw claims, resignation, FIDE automatic draws) from 200 openings of 8 plies taken from games of players rated 1600+, kept when Stockfish judges them within 35 cp at 2M nodes; every opening twice, colours swapped. The 95% interval comes from the scores of these game pairs.

## Phase 5 — rating

- **The rules are the FIDE Rapid & Blitz Rating Regulations 2024** with the shared tables of B02 (8.1.1 dp, 8.1.2 PD); both were read from handbook.fide.com on 19 Oct 2026. The R&B text has its own K rules (40 / 20 / 10, junior 40, n × K ≤ 700), the 400-point rule for everyone, and the 600-point rule above 2600 (from 1 Dec 2024).
- **Not a FIDE rating, and labelled so**: opponents are bots rated on the Lichess rapid scale, so the number is FIDE's method on that scale ("Rapid rating · FIDE method · Lichess rapid scale").
- **Rating period = local calendar month** (R&B 6.1: a list on the first day of each month). Each ledger row stores the time zone at the game's end, so a replay never depends on where the device is later.
- **"Event" = one rating period** wherever the regulations speak of events (zero first event disregarded, 7.2.2; "completed events with at least 30 games", 7.3.3), since there are no tournaments.
- **Live rating**: the published rating plus what the current month's games would change if the month ended now; for an unrated player, the provisional initial rating once five games are pooled. The published rating changes only when the month turns.
- **Initial rating**: games pooled over at most 26 consecutive months, at least 5, average of opponents plus two hypothetical opponents with a draw each, `Ru = Ra + dp` rounded, at most 2200. Shown as "UNRATED (n/5)" until then.
- **Deviations as settings**: the 1400 floor is off by default (FIDE: on); the hypothetical opponents' rating is 1800 by default and can be changed, and the Rating screen shows what FIDE's 1800 would give; an optional birth year enables the junior K.
- **Settings changes are ledger rows** and apply from the month they are made, so past periods never change and a replay is deterministic.
- **Rounding**: rating change to the nearest whole number with 0.5 away from zero (7.3.4); ΣΔR is summed in hundredths so binary floating point cannot tip a half; the initial rating rounds half up (7.2.4 says "nearest whole number"); p is rounded to the nearest hundredth for the dp table.
- **Takebacks** are allowed in any game but make it unrated at once, so a rated game has none (the brief's "no takebacks" for rated games).
- **Tests**: the regulations contain no worked examples, so the test cases are computed by hand from the tables with the arithmetic written next to each expectation, plus property tests (determinism, PD symmetry and monotonicity, |change| ≤ K·n, n·K ≤ 700, a better result never lowers the period's rating).
