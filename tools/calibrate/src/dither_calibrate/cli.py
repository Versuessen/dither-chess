"""dither-calibrate: measure the bots on the Lichess rapid scale.

    uv run dither-calibrate positions      held-out human positions per band + book candidates
    uv run dither-calibrate analyse        Stockfish: expected-score loss of every legal move
    uv run dither-calibrate book           Stockfish: 200 balanced openings for the gauntlets
    uv run dither-calibrate cache MODEL    network logits on the analysed positions
    uv run dither-calibrate fit MODEL      fastelo's method -> results/MODEL.json (fastelo: check only)
    uv run dither-calibrate gauntlet MODEL 400 games per pairing -> results/gauntlet-MODEL.json
    uv run dither-calibrate report         CALIBRATION.md
    uv run dither-calibrate all            everything above, every model

MODEL is fastelo, maia3-5m, maia3-23m or maia2-rapid. After `fit`, re-run
`dither-models pack` so the Maia packs carry their calibration.
"""

from __future__ import annotations

import argparse

MODELS = ("fastelo", "maia3-5m", "maia3-23m", "maia2-rapid")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="dither-calibrate", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("positions")
    p.add_argument("--per-band", type=int, default=1000)
    a = sub.add_parser("analyse")
    a.add_argument("--workers", type=int, default=2)
    b = sub.add_parser("book")
    b.add_argument("--workers", type=int, default=2)
    for name in ("cache", "fit", "gauntlet"):
        s = sub.add_parser(name)
        s.add_argument("models", nargs="*", default=list(MODELS))
    sub.add_parser("report")
    sub.add_parser("all")
    args = ap.parse_args(argv)
    every = args.cmd == "all"

    if args.cmd in ("positions",) or every:
        from .positions import collect

        collect(getattr(args, "per_band", 1000))
    if args.cmd in ("analyse",) or every:
        from .analyse import analyse_positions

        analyse_positions(getattr(args, "workers", 2))
    if args.cmd in ("book",) or every:
        from .analyse import balance_book

        balance_book(getattr(args, "workers", 2))
    if args.cmd in ("cache",) or every:
        from .fit import build_cache

        for m in getattr(args, "models", MODELS):
            build_cache(m)
    if args.cmd in ("fit",) or every:
        from .fit import fit

        for m in getattr(args, "models", MODELS):
            fit(m)
    if args.cmd in ("gauntlet",) or every:
        from .gauntlet import run_gauntlet

        for m in getattr(args, "models", MODELS):
            run_gauntlet(m)
    if args.cmd in ("report",) or every:
        from .report import write_report

        write_report()


if __name__ == "__main__":
    main()
