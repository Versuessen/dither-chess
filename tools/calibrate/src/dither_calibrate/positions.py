"""Held-out human positions per rating band, from Lichess rapid games (CC0).

As fastelo/eval_strength.analyse: positions of human rapid games, at least 10 plies in, where the
player to move is in the band (their pre-game Lichess rapid rating) and not in time trouble
(at least 30 s on their clock, fastelo's PLAYER_OK). Bots and abnormal terminations are skipped.
At most one position per player per game, chosen by a generator seeded with the game and side
(so a larger sample contains every smaller one), and no position twice.

Also collects the opening book for the gauntlets: the first 8 plies of games between players
rated 1600 or more, distinct move sequences, judged balanced later by Stockfish.
"""

from __future__ import annotations

import json
import random
import re

import chess

from dither_models.lichess import LichessGame, stream_games

from .paths import RESULTS, lock

BANDS = [(lo, lo + 200) for lo in range(600, 2400, 200)]  # 600-800 ... 2200-2400
PER_BAND = 1000
MIN_PLY = 10
MIN_CLOCK = 30
BOOK_PLIES = 8
BOOK_CANDIDATES = 1200
PREFIX_BYTES = 1_500_000_000

CLK = re.compile(r"\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]")
TOKEN = re.compile(r"\{[^}]*\}|\S+")


def parse_moves_and_clocks(movetext: str) -> tuple[list[str], list[float | None]]:
    """SAN moves and the clock after each move (seconds), from a Lichess movetext."""
    sans: list[str] = []
    clocks: list[float | None] = []
    for tok in TOKEN.findall(movetext):
        if tok.startswith("{"):
            m = CLK.search(tok)
            if m and clocks:
                clocks[-1] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
            continue
        if re.fullmatch(r"\d+\.(\.\.)?", tok) or tok in ("1-0", "0-1", "1/2-1/2", "*") or tok.startswith("$"):
            continue
        sans.append(re.sub(r"[?!]+$", "", tok))
        clocks.append(None)
    return sans, clocks


def band_of(elo: int) -> int | None:
    for i, (lo, hi) in enumerate(BANDS):
        if lo <= elo < hi:
            return i
    return None


def collect(per_band: int = PER_BAND, prefix_bytes: int = PREFIX_BYTES, seed: int = 0) -> None:
    month = lock()["lichess"]["month"]
    bands: list[list[dict]] = [[] for _ in BANDS]
    seen: set[str] = set()
    book: dict[tuple[str, ...], int] = {}
    stats: dict = {}
    games = used = 0
    for g in stream_games(month, prefix_bytes, stats):
        if all(len(b) >= per_band for b in bands) and len(book) >= BOOK_CANDIDATES:
            break
        if not (g.is_lichess_rapid() and g.is_clean()):
            continue
        games += 1
        tc = g.time_control
        assert tc is not None
        sans, clocks = parse_moves_and_clocks(g.movetext)
        if len(sans) < MIN_PLY + 2:
            continue
        board = chess.Board()
        ucis: list[str] = []
        try:
            for san in sans:
                mv = board.parse_san(san)
                ucis.append(mv.uci())
                board.push(mv)
        except ValueError:
            continue
        we, be = g.white_elo, g.black_elo
        assert we is not None and be is not None
        if min(we, be) >= 1600 and len(ucis) > BOOK_PLIES + 10 and len(book) < BOOK_CANDIDATES:
            key = tuple(ucis[:BOOK_PLIES])
            book[key] = book.get(key, 0) + 1
        for side, elo, oppo in ((0, we, be), (1, be, we)):
            b = band_of(elo)
            if b is None or len(bands[b]) >= per_band:
                continue
            plies = []
            for p in range(MIN_PLY, len(ucis)):
                if p % 2 != side:
                    continue
                # Clock of the mover before this move: after their previous move, or the base time.
                before = clocks[p - 2] if p >= 2 else float(tc[0])
                if before is not None and before >= MIN_CLOCK:
                    plies.append(p)
            if not plies:
                continue
            p = random.Random(f"{seed}-{g.headers.get('Site', '')}-{side}").choice(plies)
            pos = chess.Board()
            for u in ucis[:p]:
                pos.push_uci(u)
            key = " ".join(pos.fen().split(" ")[:4])
            if key in seen:
                continue
            seen.add(key)
            bands[b].append(
                {
                    "id": f"{g.headers.get('Site', '').rsplit('/', 1)[-1]}-{p}",
                    "band": f"{BANDS[b][0]}-{BANDS[b][1]}",
                    "elo": elo,
                    "oppo_elo": oppo,
                    "moves": ucis[:p],
                    "played": ucis[p],
                    "clock": clocks[p - 2] if p >= 2 else float(tc[0]),
                    "time_control": f"{tc[0]}+{tc[1]}",
                }
            )
            used += 1
    positions = [p for b in bands for p in b]
    (RESULTS / "positions.json").write_text(json.dumps(positions, separators=(",", ":")) + "\n")
    candidates = [list(k) for k, _ in sorted(book.items(), key=lambda kv: (-kv[1], kv[0]))]
    (RESULTS / "book-candidates.json").write_text(json.dumps(candidates, separators=(",", ":")) + "\n")
    meta = {
        "source": stats,
        "month": month,
        "license": "CC0-1.0 (Lichess open database)",
        "rapid_clean_games_read": games,
        "positions": {f"{lo}-{hi}": len(b) for (lo, hi), b in zip(BANDS, bands)},
        "book_candidates": len(candidates),
        "rules": {"min_ply": MIN_PLY, "min_clock_s": MIN_CLOCK, "per_band": per_band, "seed": seed, "one_per_player_per_game": True},
    }
    (RESULTS / "positions.meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(json.dumps(meta["positions"]), f"from {games} rapid games; {len(candidates)} book candidates", flush=True)


def load_positions() -> list[dict]:
    return json.loads((RESULTS / "positions.json").read_text())


def board_of(moves: list[str]) -> chess.Board:
    b = chess.Board()
    for u in moves:
        b.push_uci(u)
    return b


__all__ = ["BANDS", "LichessGame", "board_of", "collect", "load_positions", "parse_moves_and_clocks"]
