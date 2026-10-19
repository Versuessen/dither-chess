"""Stockfish analysis of the human positions and of the opening book.

Positions: every legal move scored (fastelo/eval_strength.analyse: 20,000 nodes per legal move,
one thread), turned into expected-score loss with the Lichess win-probability model:
loss(move) = max over moves of W - W(move). Resumable: finished positions are kept in
work/analysis.jsonl and skipped on the next run; the complete table goes to
results/analysis.json.gz.

Book: each candidate 8-ply opening is evaluated at 2,000,000 nodes; the first 200 within 35 cp of
equality (White's view) are the gauntlet book.
"""

from __future__ import annotations

import gzip
import json
import multiprocessing as mp
import time

import chess

from .paths import RESULTS, WORK
from .positions import board_of, load_positions
from .stockfish import ensure_stockfish, open_engine, score_all_moves, score_cp, win_prob

NODES_PER_MOVE = 20_000
BOOK_NODES = 2_000_000
BOOK_SIZE = 200
BOOK_MAX_CP = 35

_engine = None


def _init() -> None:
    global _engine
    _engine = open_engine(threads=1, hash_mb=64)


def _analyse(item: dict) -> dict:
    board = board_of(item["moves"])
    assert _engine is not None
    scores = score_all_moves(_engine, board, NODES_PER_MOVE)
    w = {m: win_prob(cp) for m, cp in scores.items()}
    best = max(w.values())
    return {"id": item["id"], "cp": scores, "loss": {m: best - v for m, v in w.items()}}


def analyse_positions(workers: int = 2) -> None:
    positions = load_positions()
    part = WORK / "analysis.jsonl"
    done: dict[str, dict] = {}
    if part.exists():
        for line in part.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                done[r["id"]] = r
    todo = [p for p in positions if p["id"] not in done]
    print(f"{len(done)} positions analysed already, {len(todo)} to go ({NODES_PER_MOVE} nodes per legal move)", flush=True)
    t0 = time.time()
    if todo:
        ensure_stockfish()  # once, before the workers start it
        with mp.Pool(workers, initializer=_init) as pool, part.open("a") as out:
            for i, r in enumerate(pool.imap_unordered(_analyse, todo, chunksize=2)):
                out.write(json.dumps(r, separators=(",", ":")) + "\n")
                out.flush()
                done[r["id"]] = r
                if (i + 1) % 50 == 0:
                    rate = (i + 1) / (time.time() - t0)
                    print(f"  {i + 1}/{len(todo)}  {rate:.2f}/s  eta {(len(todo) - i - 1) / rate / 60:.0f} min", flush=True)
    table = []
    missing = 0
    for p in positions:
        r = done[p["id"]]
        if p["played"] not in r["loss"]:
            missing += 1
        table.append({**p, "cp": r["cp"], "loss": r["loss"]})
    with gzip.open(RESULTS / "analysis.json.gz", "wt") as f:
        json.dump({"nodes_per_move": NODES_PER_MOVE, "positions": table}, f, separators=(",", ":"))
    print(f"wrote results/analysis.json.gz ({len(table)} positions, {missing} played moves missing)", flush=True)


def load_analysis() -> list[dict]:
    with gzip.open(RESULTS / "analysis.json.gz", "rt") as f:
        return json.load(f)["positions"]


def _book_eval(moves: list[str]) -> tuple[list[str], int]:
    assert _engine is not None
    board = board_of(moves)
    info = _engine.analyse(board, chess.engine.Limit(nodes=BOOK_NODES))
    return moves, score_cp(info["score"], chess.WHITE)


def balance_book(workers: int = 2) -> None:
    candidates = json.loads((RESULTS / "book-candidates.json").read_text())
    book: list[dict] = []
    ensure_stockfish()
    with mp.Pool(workers, initializer=_init) as pool:
        for moves, cp in pool.imap(_book_eval, candidates, chunksize=4):
            if abs(cp) <= BOOK_MAX_CP:
                book.append({"moves": moves, "cp": cp})
                if len(book) >= BOOK_SIZE:
                    pool.terminate()
                    break
    (RESULTS / "book.json").write_text(
        json.dumps({"plies": len(book[0]["moves"]) if book else 0, "nodes": BOOK_NODES, "max_cp": BOOK_MAX_CP, "openings": book}, indent=0) + "\n"
    )
    print(f"book: {len(book)} openings within {BOOK_MAX_CP} cp", flush=True)
