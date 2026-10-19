"""Stockfish, pinned to an official release and verified by SHA-256. Analysis only: it measures
how much expected score a move gives away; it never plays in DITHER."""

from __future__ import annotations

import hashlib
import os
import stat
import tarfile
import urllib.request

import chess
import chess.engine

from .paths import WORK, lock


def win_prob(cp: float) -> float:
    """Lichess expected-score model (as fastelo/eval_strength.win_prob), cp from the mover's side."""
    import math

    return 1.0 / (1.0 + math.exp(-0.00368208 * cp))


def score_cp(score: chess.engine.PovScore, pov: chess.Color) -> int:
    """Centipawns from `pov`'s side, mates as +-10000 (fastelo: score(mate_score=10000))."""
    return score.pov(pov).score(mate_score=10000)


def ensure_stockfish() -> str:
    info = lock()["stockfish"]
    dest = WORK / "stockfish" / info["release"]
    binary = dest / info["binary"]
    if binary.exists():
        return str(binary)
    dest.mkdir(parents=True, exist_ok=True)
    archive = dest / "stockfish.tar.gz"
    if not archive.exists():
        print(f"downloading {info['url']}", flush=True)
        urllib.request.urlretrieve(info["url"], archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != info["sha256"]:
        archive.unlink()
        raise SystemExit(f"Stockfish archive checksum mismatch: {digest} != {info['sha256']}")
    tmp = dest / "extract.tmp"
    with tarfile.open(archive) as tar:
        tar.extractall(tmp, filter="data")
    staged = tmp / info["binary"]
    os.chmod(staged, os.stat(staged).st_mode | stat.S_IXUSR)
    binary.parent.mkdir(parents=True, exist_ok=True)
    os.replace(staged, binary)
    return str(binary)


def open_engine(threads: int = 1, hash_mb: int = 64) -> chess.engine.SimpleEngine:
    engine = chess.engine.SimpleEngine.popen_uci(ensure_stockfish())
    engine.configure({"Threads": threads, "Hash": hash_mb})
    return engine


def score_all_moves(engine: chess.engine.SimpleEngine, board: chess.Board, nodes_per_move: int) -> dict[str, int]:
    """Centipawn score (mover's side, after the move) of every legal move: multi-PV over all moves
    with `nodes_per_move` x moves nodes, as fastelo/eval_strength.analyse; moves the search did
    not report (small budgets can stop early) are searched again on their own, as sf_label does."""
    todo = list(board.legal_moves)
    out: dict[str, int] = {}
    for _ in range(4):
        if not todo:
            break
        infos = engine.analyse(board, chess.engine.Limit(nodes=nodes_per_move * len(todo)), multipv=len(todo), root_moves=todo)
        for i in infos:
            if "pv" in i and i["pv"] and i["pv"][0].uci() not in out:
                out[i["pv"][0].uci()] = score_cp(i["score"], board.turn)
        todo = [m for m in todo if m.uci() not in out]
    for m in todo:
        info = engine.analyse(board, chess.engine.Limit(nodes=nodes_per_move), root_moves=[m])
        out[m.uci()] = score_cp(info["score"], board.turn)
    return out
