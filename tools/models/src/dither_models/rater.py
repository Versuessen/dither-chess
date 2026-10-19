"""Golden fixture for the TypeScript port of fastelo's Rater (move-quality estimate).

fastelo rates a player from the likelihood of their own moves under the player network
(fastelo/likelihood.py) and corrects the estimate's bias with rating_response.json
(fastelo/response.py); lite.Engine.rating ties the two together. This runs exactly that on a few
games, side by side, and writes every intermediate (log-likelihood matrix, posterior, corrected
value and errors) to tests/golden/fastelo-rater.json.

Games: two published 19th/20th-century games (move lists are facts) and one seeded random game,
which exercises the per-move clip on blunders.
"""

from __future__ import annotations

import json
import random

import chess
import numpy as np

from . import refcode
from .paths import GOLDEN, SOURCES

GAMES = {
    "morphy-opera-1858": "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 "
    "O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#",
    "byrne-fischer-1956": "Nf3 Nf6 c4 g6 Nc3 Bg7 d4 O-O Bf4 d5 Qb3 dxc4 Qxc4 c6 e4 Nbd7 Rd1 Nb6 Qc5 Bg4 Bg5 Na4 Qa3 Nxc3 "
    "bxc3 Nxe4 Bxe7 Qb6 Bc4 Nxc3 Bc5 Rfe8+ Kf1 Be6 Bxb6 Bxc4+ Kg1 Ne2+ Kf1 Nxd4+ Kg1 Ne2+ Kf1 Nc3+ Kg1 axb6 Qb4 Ra4 "
    "Qxb6 Nxd1 h3 Rxa2 Kh2 Nxf2 Re1 Rxe1 Qd8+ Bf8 Nxe1 Bd5 Nf3 Ne4 Qb8 b5 h4 h5 Ne5 Kg7 Kg1 Bc5+ Kf1 Ng3+ Ke1 Bb4+ "
    "Kd1 Bb3+ Kc1 Ne2+ Kb1 Nc3+ Kc1 Rc2#",
}


def _random_game(seed: int, plies: int) -> list[chess.Move]:
    rng = random.Random(seed)
    b = chess.Board()
    out = []
    while len(out) < plies and not b.is_game_over():
        m = rng.choice(sorted(b.legal_moves, key=lambda x: x.uci()))
        out.append(m)
        b.push(m)
    return out


def _moves(san: str) -> list[chess.Move]:
    b = chess.Board()
    out = []
    for s in san.split():
        m = b.parse_san(s)
        out.append(m)
        b.push(m)
    return out


def write_rater_golden() -> None:
    lite = refcode.fastelo("lite")
    lik = refcode.fastelo("likelihood")
    resp_mod = refcode.fastelo("response")
    policy = lite.Policy(str(SOURCES / "fastelo"), "player")
    response = json.loads((SOURCES / "fastelo" / "rating_response.json").read_text())

    games = {name: _moves(san) for name, san in GAMES.items()}
    games["random-seed-7"] = _random_game(7, 60)

    cases = []
    finals = []
    for name, moves in games.items():
        boards = []
        b = chess.Board()
        for m in moves:
            boards.append(b.copy(stack=False))
            b.push(m)
        for side in (0, 1):
            own = list(range(side, len(moves), 2))
            logp = np.array([policy.move_logp(boards[p], p, moves[p], lik.GRID) for p in own])
            mu, sd = lik.curve(logp)
            seen = 2 * np.arange(1, len(mu) + 1)
            out = resp_mod.apply(response, mu, sd, seen)
            syst = np.array([resp_mod.systematic(response, v, k)[0] for v, k in zip(out["value"], seen)])
            res = resp_mod.resolution(response, seen)
            cases.append(
                {
                    "game": name,
                    "side": side,
                    "moves": [m.uci() for m in moves],
                    "logp": logp.tolist(),
                    "mean": mu.tolist(),
                    "sd": sd.tolist(),
                    "value": out["value"].tolist(),
                    "lo": out["lo"].tolist(),
                    "hi": out["hi"].tolist(),
                    "lo2": out["lo2"].tolist(),
                    "hi2": out["hi2"].tolist(),
                    "syst": syst.tolist(),
                    "resolution": np.asarray(res).tolist(),
                }
            )
            v = float(out["value"][-1])
            finals.append(
                {
                    "mean": v,
                    "minus": float(v - out["lo"][-1]),
                    "plus": float(out["hi"][-1] - v),
                    "syst": float(syst[-1]),
                    "resolution": float(res[-1]),
                }
            )
            print(f"{name:20} side {side}: {len(own):3} moves -> {v:7.1f} (-{finals[-1]['minus']:.0f}/+{finals[-1]['plus']:.0f})")
    combined = lite.combine_measurements(finals)
    dest = GOLDEN / "fastelo-rater.json"
    dest.write_text(
        json.dumps(
            {
                "grid": lik.GRID.tolist(),
                "clip": lik.CLIP,
                "report_range": list(resp_mod.REPORT_RANGE),
                "response": response,
                "cases": cases,
                "combine": {"measurements": finals, "expected": combined},
            },
            separators=(",", ":"),
        )
        + "\n"
    )
    print(f"wrote {dest}")
