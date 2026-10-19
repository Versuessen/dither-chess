"""The parity test set: 2,000 positions with their move history, plus hand-picked edge cases.

Positions come from rapid games in a pinned slice of the Lichess September 2026 dump (after
every model's training data), sampled with a fixed seed. Each entry is a start FEN and the UCI
moves leading to the position, so encoders that need history (Maia-3) get the real one. Edge
cases cover black to move, castling-right combinations, legal and illegal en passant, every
promotion piece and positions with a single legal move.
"""

from __future__ import annotations

import json
import random

import chess

from .lichess import san_moves, stream_games
from .paths import POSITIONS, TOOL_ROOT

MONTH = "2026-09"
MAX_BYTES = 24 << 20
SEED = 20261019
COMMITTED = TOOL_ROOT / "positions.json"

START = chess.STARTING_FEN

EDGE_CASES: list[tuple[str, list[str]]] = [
    (START, []),
    (START, ["e2e4"]),
    (START, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"]),
    # en passant capture legal for white (d5xe6 e.p.)
    (START, ["e2e4", "a7a6", "e4e5", "d7d5"]),
    # double push with no capturing pawn: en passant square must be ignored
    (START, ["e2e4", "a7a6", "a2a3", "d7d5"]),
    # black to capture en passant
    (START, ["a2a3", "e7e5", "a3a4", "e5e4", "d2d4"]),
    # castling rights: white has lost kingside, black has lost queenside
    ("r3k2r/pppqpppp/8/8/8/8/PPPQPPPP/R3K2R w KQkq - 0 1", ["h1g1", "a8b8", "g1h1", "b8a8"]),
    ("r3k2r/8/8/8/8/8/8/R3K2R b Kq - 0 1", []),
    ("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1", []),
    # promotions for both colours, captures and pushes, all pieces
    ("1n2k3/P7/8/8/8/8/7p/4K1N1 w - - 0 40", []),
    ("1n2k3/P7/8/8/8/8/7p/4K1N1 b - - 0 40", []),
    ("3qk3/2P5/8/8/8/8/5p2/3QK1R1 w - - 0 50", []),
    # single legal move (in check)
    ("7k/8/8/8/8/8/6q1/7K w - - 0 60", []),
    ("k7/8/1K6/8/8/8/8/R7 b - - 0 60", []),
    # high half-move clock and ply beyond 255
    ("8/5k2/8/3K4/8/8/2R5/8 w - - 99 130", []),
    ("8/5k2/8/3K4/8/8/2R5/8 b - - 120 200", []),
]


def _sample(n: int) -> tuple[list[dict], dict]:
    rng = random.Random(SEED)
    out: list[dict] = []
    stats: dict = {}
    seen = 0
    for g in stream_games(MONTH, MAX_BYTES, stats):
        if not g.is_lichess_rapid() or not g.is_clean():
            continue
        sans = san_moves(g.movetext)
        if len(sans) < 4:
            continue
        seen += 1
        # One position per game, keeps the set diverse.
        k = rng.randrange(0, len(sans))
        board = chess.Board()
        moves: list[str] = []
        try:
            for san in sans[:k]:
                mv = board.parse_san(san)
                moves.append(mv.uci())
                board.push(mv)
        except ValueError:
            continue
        if board.is_game_over():
            continue
        out.append(
            {
                "fen": START,
                "moves": moves,
                "white_elo": g.white_elo,
                "black_elo": g.black_elo,
                "site": g.headers.get("Site", ""),
            }
        )
        if len(out) >= n:
            break
    stats["games_scanned"] = seen
    return out, stats


def write_positions(n: int = 2000) -> None:
    if COMMITTED.exists():
        data = json.loads(COMMITTED.read_text())
        if len(data["positions"]) >= n + len(EDGE_CASES):
            POSITIONS.write_text(json.dumps(data))
            print(f"positions: using committed {COMMITTED.name} ({len(data['positions'])})")
            return
    sampled, stats = _sample(n)
    edges = [{"fen": f, "moves": m, "white_elo": 1500, "black_elo": 1500, "site": "edge-case"} for f, m in EDGE_CASES]
    data = {"source": stats, "month": MONTH, "seed": SEED, "positions": sampled + edges}
    COMMITTED.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    POSITIONS.write_text(json.dumps(data))
    print(f"positions: {len(sampled)} sampled + {len(edges)} edge cases from {stats.get('url')}")


def load_positions() -> list[dict]:
    if not POSITIONS.exists():
        write_positions()
    return json.loads(POSITIONS.read_text())["positions"]


def boards(entry: dict) -> list[chess.Board]:
    """Every board from the start position to the entry's position (inclusive)."""
    b = chess.Board(entry["fen"])
    out = [b.copy(stack=False)]
    for u in entry["moves"]:
        b.push(chess.Move.from_uci(u))
        out.append(b.copy(stack=False))
    return out
