# Opening names

`a.tsv` … `e.tsv` are copied unchanged from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
at commit `a6189a30dc273ccb21fc2536a9a2fefd5592a67a` (2026-10-06). The data set is dedicated to the
public domain under CC0 1.0 (`COPYING.txt`).

`pnpm openings` turns them into `src/chess/openings.json`, which the app loads to name the opening
of a game by its position (so transpositions get the right name).
