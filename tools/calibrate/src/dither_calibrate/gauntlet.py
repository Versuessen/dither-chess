"""Gauntlets: the bots against themselves at different levels, as the app plays them.

For each pairing (two levels 100-300 apart) 400 games: every opening of the balanced book twice,
colours swapped. Each move is one forward pass and one draw from the tempered, top-p'd legal-move
distribution with the level's calibrated settings (src/inference/sampler.ts). Draw claims and
resignation follow src/bots/behaviour.ts; results follow the FIDE Laws as src/chess/rules.ts
(automatic fivefold and 75-move draws, dead positions by material). Many games run at once so
the network sees full batches.

A pairing passes when the expected score of the stronger level on the Elo curve,
1 / (1 + 10^(-d/400)), lies inside the 95% confidence interval of its measured score. The
interval comes from the scores of game pairs (same opening, both colours), which removes the
opening's own bias from the error estimate.
"""

from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass, field

import chess
import numpy as np

from dither_models import refcode

from .paths import RESULTS
from .runner import Runner

GAMES_PER_OPENING = 2
MAX_PLIES = 600
CONCURRENT = 64
PIECE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


@dataclass
class Settings:
    level: int
    elo_self: float
    elo_oppo: float
    temperature: float
    top_p: float


def level_settings(runner: Runner, model: str) -> dict[int, Settings]:
    if model == "fastelo":
        lite = refcode.fastelo("lite")
        cal = runner.calibration
        assert cal is not None
        out = {}
        for L in range(600, 1901, 50):
            c, T, mix = lite.settings(cal, float(L))
            assert mix == 0.0
            out[L] = Settings(L, c, c, T, 1.0)
        return out
    rows = json.loads((RESULTS / f"{model}.json").read_text())["levels"]
    return {r["level"]: Settings(r["level"], r["eloSelf"], r["eloOppo"], r["temperature"], r["topP"]) for r in rows}


def pairings_for(levels: list[int]) -> list[tuple[int, int]]:
    """A chain 200 apart across the range (closing on the top level), one pair 100 apart and one
    300 apart in the middle."""
    lo, hi = min(levels), max(levels)
    have = set(levels)
    pairs = []
    a = lo
    while a + 200 <= hi:
        pairs.append((a, a + 200))
        a += 200
    if pairs and pairs[-1][1] != hi and hi - 200 in have:
        pairs.append((hi - 200, hi))
    mid = (lo + hi) // 2 // 50 * 50
    if mid in have and mid + 100 in have:
        pairs.append((mid, mid + 100))
    m3 = (mid - 150) // 50 * 50
    if m3 in have and m3 + 300 in have:
        pairs.append((m3, m3 + 300))
    return pairs


# ----------------------------------------------------------------------------- rules
def _square_colour(sq: int) -> int:
    return (chess.square_file(sq) + chess.square_rank(sq)) % 2


def insufficient_material(board: chess.Board) -> bool:
    """FIDE 5.2.2 by material, as src/chess/rules.ts: K v K, K + minor v K, and K + B(s) v K + B(s)
    with every bishop on one colour."""
    pieces = [(p, sq) for sq, p in board.piece_map().items() if p.piece_type != chess.KING]
    if not pieces:
        return True
    if any(p.piece_type in (chess.PAWN, chess.ROOK, chess.QUEEN) for p, _ in pieces):
        return False
    if len(pieces) == 1:
        return True
    if all(p.piece_type == chess.BISHOP for p, _ in pieces):
        return len({_square_colour(sq) for _, sq in pieces}) == 1
    return False


def material(board: chess.Board, color: chess.Color) -> int:
    s = 0
    for p in board.piece_map().values():
        v = PIECE[p.piece_type]
        s += v if p.color == color else -v
    return s


@dataclass
class Game:
    index: int
    opening: list[str]
    white: Settings
    black: Settings
    rng: random.Random
    history: object = None
    lost_streak: dict = field(default_factory=lambda: {chess.WHITE: 0, chess.BLACK: 0})
    result: str | None = None
    termination: str | None = None
    inexpressible: int = 0


def _distribution(logits: np.ndarray, T: float, top_p: float) -> np.ndarray:
    z = logits.astype(np.float64) / T
    z -= z.max()
    p = np.exp(z)
    p /= p.sum()
    if top_p >= 1:
        return p
    order = sorted(range(len(p)), key=lambda i: (-p[i], i))
    keep = np.zeros(len(p), bool)
    cum = 0.0
    for rank, i in enumerate(order):
        cum += p[i]
        if cum <= top_p or rank == 0:
            keep[i] = True
    p = np.where(keep, p, 0.0)
    return p / p.sum()


def _automatic_end(board: chess.Board) -> tuple[str, str] | None:
    if board.is_checkmate():
        return ("0-1" if board.turn == chess.WHITE else "1-0"), "checkmate"
    if board.is_stalemate():
        return "1/2-1/2", "stalemate"
    if insufficient_material(board):
        return "1/2-1/2", "insufficient material"
    if board.is_fivefold_repetition():
        return "1/2-1/2", "fivefold repetition"
    if board.halfmove_clock >= 150:
        return "1/2-1/2", "75-move rule"
    return None


def play_games(runner: Runner, games: list[Game]) -> None:
    pending = list(games)
    active: list[Game] = []
    while pending or active:
        while pending and len(active) < CONCURRENT:
            g = pending.pop(0)
            g.history = runner.history_of(g.opening)
            active.append(g)
        feeds, elos, legal = [], [], []
        for g in active:
            h = g.history
            s = g.white if h.board.turn == chess.WHITE else g.black
            moves = list(h.board.legal_moves)
            idx = np.array([runner.move_index(h.board, m) for m in moves])
            legal.append((moves, idx))
            feeds.append(runner.encode(h))
            elos.append((s.elo_self, s.elo_oppo))
        policy, value = runner.run(feeds, elos)
        still = []
        for g, (moves, idx), logits, e in zip(active, legal, policy, value):
            h = g.history
            board = h.board
            color = board.turn
            s = g.white if color == chess.WHITE else g.black
            # draw claim when not better (behaviour.claimsDraw)
            if (board.is_repetition(3) or board.halfmove_clock >= 100) and e <= 0.5:
                g.result, g.termination = "1/2-1/2", "threefold repetition" if board.is_repetition(3) else "50-move rule"
                continue
            # rare resignation (behaviour.resigns)
            g.lost_streak[color] = g.lost_streak[color] + 1 if e <= 0.03 else 0
            if s.level >= 1000:
                mb = material(board, color)
                if s.level < 1500:
                    resign = e <= 0.02 and mb <= -9 and g.lost_streak[color] >= 5 and g.rng.random() < 0.25
                else:
                    resign = e <= 0.03 and mb <= -5 and g.lost_streak[color] >= 3 and g.rng.random() < 0.5
                if resign:
                    g.result, g.termination = ("0-1" if color == chess.WHITE else "1-0"), "resignation"
                    continue
            ok = idx >= 0
            if not ok.any():
                # Only moves outside the model's vocabulary (a lone underpromotion): the app cannot
                # get here either; play the first legal move and count it.
                g.inexpressible += 1
                ok[0] = True
                idx = np.where(ok, 0, idx)
            p = _distribution(logits[idx[ok]], s.temperature, s.top_p)
            u = g.rng.random()
            k = int(min(np.searchsorted(np.cumsum(p), u, side="right"), len(p) - 1))
            move = [m for m, o in zip(moves, ok) if o][k]
            runner.push(h, move)
            end = _automatic_end(h.board)
            if end:
                g.result, g.termination = end
                continue
            if len(h.board.move_stack) >= MAX_PLIES:
                g.result, g.termination = "1/2-1/2", "move cap"
                continue
            still.append(g)
        active = still


def _score(r: str, white_is_hi: bool) -> float:
    if r == "1/2-1/2":
        return 0.5
    white_won = r == "1-0"
    return 1.0 if white_won == white_is_hi else 0.0


def _elo(s: float) -> float:
    s = min(max(s, 1e-4), 1 - 1e-4)
    return -400 * math.log10(1 / s - 1)


def run_pairing(runner: Runner, model: str, settings: dict[int, Settings], lo: int, hi: int, book: list[dict]) -> dict:
    games: list[Game] = []
    for i, o in enumerate(book):
        for j in range(GAMES_PER_OPENING):
            hi_white = j % 2 == 0
            w, b = (settings[hi], settings[lo]) if hi_white else (settings[lo], settings[hi])
            games.append(Game(i * GAMES_PER_OPENING + j, o["moves"], w, b, random.Random(f"{model}-{lo}-{hi}-{i}-{j}")))
    t0 = time.time()
    play_games(runner, games)
    scores = np.array([_score(g.result or "1/2-1/2", g.white is settings[hi]) for g in games])
    pairs = scores.reshape(-1, GAMES_PER_OPENING).mean(1)
    n = len(scores)
    s = float(scores.mean())
    se = float(pairs.std(ddof=1) / math.sqrt(len(pairs)))
    lo_ci, hi_ci = s - 1.96 * se, s + 1.96 * se
    d = hi - lo
    expected = 1 / (1 + 10 ** (-d / 400))
    wins = int((scores == 1).sum())
    draws = int((scores == 0.5).sum())
    losses = int((scores == 0).sum())
    terms: dict[str, int] = {}
    for g in games:
        terms[g.termination or "?"] = terms.get(g.termination or "?", 0) + 1
    plies = [len(g.history.board.move_stack) for g in games]  # type: ignore[union-attr]
    row = dict(
        low=lo,
        high=hi,
        gap=d,
        games=n,
        high_wins=wins,
        draws=draws,
        high_losses=losses,
        score=round(s, 4),
        se=round(se, 4),
        ci95=[round(lo_ci, 4), round(hi_ci, 4)],
        expected=round(expected, 4),
        within_ci=bool(lo_ci <= expected <= hi_ci),
        elo_diff=round(_elo(s), 1),
        elo_diff_ci95=[round(_elo(lo_ci), 1), round(_elo(hi_ci), 1)],
        mean_plies=round(float(np.mean(plies)), 1),
        inexpressible_positions=sum(g.inexpressible for g in games),
        terminations=dict(sorted(terms.items())),
        seconds=round(time.time() - t0),
    )
    print(
        f"  {model} {lo} v {hi}: {wins}-{draws}-{losses}  score {s:.3f} [{lo_ci:.3f}, {hi_ci:.3f}]  expected {expected:.3f}"
        f"  {'ok' if row['within_ci'] else 'OUTSIDE'}  Δ≈{row['elo_diff']:+.0f}  ({row['seconds']}s, {row['mean_plies']} plies)",
        flush=True,
    )
    return row


def run_gauntlet(model: str, threads: int = 2) -> dict:
    runner = Runner(model, threads)
    settings = level_settings(runner, model)
    book = json.loads((RESULTS / "book.json").read_text())["openings"]
    dest = RESULTS / f"gauntlet-{model}.json"
    done = {(r["low"], r["high"]): r for r in json.loads(dest.read_text())["pairings"]} if dest.exists() else {}
    rows = []
    for lo, hi in pairings_for(sorted(settings)):
        row = done.get((lo, hi)) or run_pairing(runner, model, settings, lo, hi, book)
        rows.append(row)
        out = dict(
            model=model,
            model_sha256=runner.model_sha256,
            variant=runner.variant,
            book=len(book),
            games_per_pairing=len(book) * GAMES_PER_OPENING,
            pairings=rows,
        )
        dest.write_text(json.dumps(out, indent=1) + "\n")
    out["passed"] = sum(r["within_ci"] for r in rows)
    out["total"] = len(rows)
    dest.write_text(json.dumps(out, indent=1) + "\n")
    print(f"{model}: {out['passed']}/{out['total']} pairings on the Elo curve within the 95% CI", flush=True)
    return out
