"""Command line for the model pipeline.

    uv run dither-models fetch [--record]
    uv run dither-models export            ONNX for fastelo and Maia-3; Maia-2 is already ONNX
    uv run dither-models positions         the 2,000 parity positions (deterministic)
    uv run dither-models parity            ONNX vs Python reference; writes reports/ and golden fixtures
    uv run dither-models rater-golden      fixture for the TypeScript port of fastelo's Rater
    uv run dither-models quantize          fp16/int8 variants kept only within KL 0.01
    uv run dither-models pack              .dpk packs + models/manifest.json
    uv run dither-models all               everything above, in order
"""

from __future__ import annotations

import argparse


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="dither-models")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--record", action="store_true")
    sub.add_parser("export")
    p = sub.add_parser("positions")
    p.add_argument("--n", type=int, default=2000)
    q = sub.add_parser("parity")
    q.add_argument("--models", nargs="*", default=None)
    sub.add_parser("rater-golden")
    z = sub.add_parser("quantize")
    z.add_argument("--models", nargs="*", default=None)
    k = sub.add_parser("pack")
    k.add_argument("--base-url", action="append", default=None, help="download URL prefix (repeatable)")
    sub.add_parser("all")
    args = ap.parse_args(argv)

    if args.cmd in ("fetch", "all"):
        from .fetch import fetch_all

        fetch_all(record=getattr(args, "record", False))
    if args.cmd in ("export", "all"):
        from .export import export_all

        export_all()
    if args.cmd in ("positions", "all"):
        from .positions import write_positions

        write_positions(getattr(args, "n", 2000))
    if args.cmd in ("parity", "all"):
        from .parity import run_parity

        run_parity(getattr(args, "models", None))
    if args.cmd in ("rater-golden", "all"):
        from .rater import write_rater_golden

        write_rater_golden()
    if args.cmd in ("quantize", "all"):
        from .quantize import quantize_all

        quantize_all(getattr(args, "models", None))
    if args.cmd in ("pack", "all"):
        from .pack import pack_all

        pack_all(getattr(args, "base_url", None))


if __name__ == "__main__":
    main()
