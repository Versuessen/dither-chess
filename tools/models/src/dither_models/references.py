"""Reference encodings and outputs, computed with each model's own published Python code.

Each adapter turns a parity position (start FEN + moves + rating inputs) into:
  - the exact input tensors the reference code builds,
  - the reference outputs (policy logits over the full vocabulary, value head),
  - the legal-move mask over the vocabulary,
so the ONNX graph can be run on identical inputs and compared.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import chess
import numpy as np
import torch

from . import refcode
from .paths import SOURCES
from .positions import boards


@dataclass
class Encoded:
    feeds: dict[str, np.ndarray]
    legal: np.ndarray  # bool [V]
    turn: chess.Color


# ------------------------------------------------------------------------------------- fastelo
class FasteloRef:
    name = "fastelo"
    vocab_size = 1880

    def __init__(self) -> None:
        self.lite = refcode.fastelo("lite")
        self.vocab = refcode.fastelo("vocab")
        self.policy = self.lite.Policy(str(SOURCES / "fastelo"), "player")
        import json

        self.cal = json.loads((SOURCES / "fastelo" / "calibration.json").read_text())

    def conditioning(self, level: float) -> float:
        return self.lite.settings(self.cal, float(level))[0]

    def encode(self, entry: dict, level: float) -> Encoded:
        bs = boards(entry)
        board = bs[-1]
        ply = len(entry["moves"])
        codes, castling, ep, half = self.lite.board_features([board])
        c = np.float32(self.conditioning(level))
        feeds = {
            "board": codes.astype(np.int64),
            "castling": castling.astype(np.float32),
            "ep": ep.astype(np.int64),
            "halfmove": half.astype(np.int64),
            "ply": np.array([min(ply, 255)], np.int64),
            "tc": np.array([self.lite.RAPID], np.int64),
            "self_elo": np.array([c], np.float32),
            "opp_elo": np.array([c], np.float32),
        }
        return Encoded(feeds, self.vocab.legal_mask(board), board.turn)

    def reference(self, entry: dict, level: float) -> tuple[np.ndarray, np.ndarray]:
        bs = boards(entry)
        board = bs[-1]
        c = self.conditioning(level)
        logits = self.policy.logits(board, len(entry["moves"]), c, c).astype(np.float32)
        # lite has no value head; the PyTorch model provides it.
        value = self._torch_value(self.encode(entry, level).feeds)
        return logits, value

    _torch = None

    def _torch_value(self, feeds: dict[str, np.ndarray]) -> np.ndarray:
        if FasteloRef._torch is None:
            from .export import load_fastelo

            FasteloRef._torch = load_fastelo()
        batch = {k: torch.from_numpy(v) for k, v in feeds.items()}
        with torch.no_grad():
            _p, value = FasteloRef._torch(batch)
        return value[0].numpy().astype(np.float32)

    def reference_torch(self, entry: dict, level: float) -> np.ndarray:
        if FasteloRef._torch is None:
            from .export import load_fastelo

            FasteloRef._torch = load_fastelo()
        batch = {k: torch.from_numpy(v) for k, v in self.encode(entry, level).feeds.items()}
        with torch.no_grad():
            p, _v = FasteloRef._torch(batch)
        return p[0].numpy()


# --------------------------------------------------------------------------------------- maia3
class Maia3Ref:
    vocab_size = 4352

    def __init__(self, size: str = "5m") -> None:
        self.name = f"maia3-{size}"
        self.size = size
        self.ds = refcode.maia3("dataset")
        self.utils = refcode.maia3("utils")
        self.all_moves = self.utils.get_all_possible_moves()
        self.index = {m: i for i, m in enumerate(self.all_moves)}
        self._net = None

    @property
    def net(self):
        if self._net is None:
            from .export import load_maia3

            self._net = load_maia3(self.size)
        return self._net

    def tokens(self, entry: dict) -> torch.Tensor:
        """Exactly maia3.uci --use-uci-history: up to 8 positions, padded with the earliest."""
        bs = boards(entry)
        hist: deque = deque(maxlen=8)
        for b in bs:
            hist.append(self.ds.tokenize_board(b))

        class C:
            history = 8
            include_time_info = False

        t = self.ds.get_historical_tokens(hist, C, base=0.0, inc=0.0, clk_left_before=0.0, clk_ponder=0.0)
        return t[:, : 12 * 8]

    def encode(self, entry: dict, level: float) -> Encoded:
        board = boards(entry)[-1]
        feeds = {
            "tokens": self.tokens(entry).unsqueeze(0).numpy().astype(np.float32),
            "self_elo": np.array([int(level)], np.int64),
            "oppo_elo": np.array([int(level)], np.int64),
        }
        legal = self.ds.get_legal_moves_mask(board, self.index).numpy().astype(bool)
        return Encoded(feeds, legal, board.turn)

    def reference(self, entry: dict, level: float) -> tuple[np.ndarray, np.ndarray]:
        e = self.encode(entry, level)
        with torch.no_grad():
            move, value, _ = self.net(
                torch.from_numpy(e.feeds["tokens"]),
                torch.from_numpy(e.feeds["self_elo"]),
                torch.from_numpy(e.feeds["oppo_elo"]),
            )
        return move[0].numpy(), value[0].numpy()


# --------------------------------------------------------------------------------------- maia2
class Maia2Ref:
    name = "maia2-rapid"
    vocab_size = 1880

    def __init__(self) -> None:
        import onnxruntime as ort

        self.inference = refcode.maia2("inference")
        self.utils = refcode.maia2("utils")
        self.all_moves = self.utils.get_all_possible_moves()
        self.moves_dict = {m: i for i, m in enumerate(self.all_moves)}
        self.elo_dict = self.utils.create_elo_dict()
        self.session = ort.InferenceSession(str(SOURCES / "maia2-onnx" / "maia_rapid.onnx"), providers=["CPUExecutionProvider"])

    def encode(self, entry: dict, level: float) -> Encoded:
        board = boards(entry)[-1]
        # The published preprocessing takes a FEN; python-chess writes the en-passant square only
        # when a capture is legal, which is what the app's FENs (chess.js) do as well.
        fen = board.fen()
        board_input, elo_self, elo_oppo, legal = self.inference.preprocessing(
            fen, int(level), int(level), self.elo_dict, self.moves_dict
        )
        feeds = {
            "boards": board_input.unsqueeze(0).numpy().astype(np.float32),
            "elo_self": np.array([elo_self], np.int64),
            "elo_oppo": np.array([elo_oppo], np.int64),
        }
        return Encoded(feeds, legal.numpy().astype(bool), board.turn)

    def reference(self, entry: dict, level: float) -> tuple[np.ndarray, np.ndarray]:
        e = self.encode(entry, level)
        out = self.session.run(["logits_maia", "logits_value"], e.feeds)
        return out[0][0], np.atleast_1d(out[1][0])


def adapter(name: str):
    if name == "fastelo":
        return FasteloRef()
    if name == "maia3-5m":
        return Maia3Ref("5m")
    if name == "maia3-23m":
        return Maia3Ref("23m")
    if name == "maia2-rapid":
        return Maia2Ref()
    raise KeyError(name)


MODELS = ("fastelo", "maia3-5m", "maia3-23m", "maia2-rapid")
