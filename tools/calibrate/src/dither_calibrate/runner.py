"""The bots' networks as the app runs them: the model inside the shipped .dpk pack (checked
against models/manifest.json), fed with each model's own published encoding.

Encoding follows the app (src/inference/encoders.ts), which the golden tests tie to the same
reference code used here:
  fastelo   lite.board_features, ply from the start of the game, time control "rapid"
  maia3     up to 8 positions, each tokenised from its own side to move, front-padded
  maia2     the published preprocessing (mirrored board when Black moves, Elo buckets)
Value heads give the mover's expected score E = P(win) + P(draw)/2 (Maia-2: v/2 + 1/2).
"""

from __future__ import annotations

import hashlib
import json
import struct
from collections import deque
from dataclasses import dataclass, field

import chess
import numpy as np
import onnxruntime as ort

from dither_models import refcode

from .paths import MANIFEST, PACKS

FAMILY = {"fastelo": "fastelo", "maia3-5m": "maia3", "maia3-23m": "maia3", "maia2-rapid": "maia2"}
PACK_ID = {"fastelo": "fastelo-7m", "maia3-5m": "maia3-5m", "maia3-23m": "maia3-23m", "maia2-rapid": "maia2-rapid"}


def read_pack(model: str) -> tuple[dict, dict[str, bytes], dict]:
    manifest = json.loads(MANIFEST.read_text())
    entry = next(p for p in manifest["packs"] if p["id"] == PACK_ID[model])
    data = (PACKS / entry["file"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise SystemExit(f"{entry['file']} does not match models/manifest.json; run `dither-models pack`")
    if data[:4] != b"DPK1":
        raise SystemExit(f"{entry['file']} is not a model pack")
    (n,) = struct.unpack("<I", data[4:8])
    header = json.loads(data[8 : 8 + n])
    start = 8 + n
    files = {}
    for f in header["files"]:
        blob = data[start + f["offset"] : start + f["offset"] + f["size"]]
        if hashlib.sha256(blob).hexdigest() != f["sha256"]:
            raise SystemExit(f"{entry['file']}/{f['name']} is damaged")
        files[f["name"]] = blob
    return header, files, entry


@dataclass
class History:
    """A game from the standard start: python-chess board plus what the encoders need."""

    board: chess.Board = field(default_factory=chess.Board)
    maia3_tokens: deque = field(default_factory=lambda: deque(maxlen=8))

    @property
    def ply(self) -> int:
        return len(self.board.move_stack)


class Runner:
    def __init__(self, model: str, threads: int = 2) -> None:
        self.model = model
        self.family = FAMILY[model]
        header, files, entry = read_pack(model)
        self.pack_sha256 = entry["sha256"]
        self.model_sha256 = hashlib.sha256(files["model.onnx"]).hexdigest()
        self.variant = header["meta"].get("variant", "fp32")
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        self.session = ort.InferenceSession(files["model.onnx"], so, providers=["CPUExecutionProvider"])
        self.vocab = {m: i for i, m in enumerate(json.loads(files["vocab.json"]))}
        self.calibration = json.loads(files["calibration.json"]) if "calibration.json" in files else None
        if self.family == "fastelo":
            self.lite = refcode.fastelo("lite")
            self.fvocab = refcode.fastelo("vocab")
            self.outputs = ["policy", "value"]
        elif self.family == "maia3":
            self.ds = refcode.maia3("dataset")
            self.outputs = ["logits_move", "logits_value"]

            class _Cfg:
                history = 8
                include_time_info = False

            self._cfg = _Cfg
        else:
            self.m2 = refcode.maia2("inference")
            self.m2utils = refcode.maia2("utils")
            self.elo_dict = self.m2utils.create_elo_dict()
            self.outputs = ["logits_maia", "logits_value"]

    # ---------------------------------------------------------------- history bookkeeping
    def new_history(self) -> History:
        h = History()
        if self.family == "maia3":
            h.maia3_tokens.append(self.ds.tokenize_board(h.board))
        return h

    def push(self, h: History, move: chess.Move) -> None:
        h.board.push(move)
        if self.family == "maia3":
            h.maia3_tokens.append(self.ds.tokenize_board(h.board))

    def history_of(self, moves: list[str]) -> History:
        h = self.new_history()
        for u in moves:
            self.push(h, chess.Move.from_uci(u))
        return h

    # ---------------------------------------------------------------------- encoding
    def move_index(self, board: chess.Board, move: chess.Move) -> int:
        """Vocabulary index of a legal move, -1 if the model cannot express it."""
        if self.family == "fastelo":
            return int(self.fvocab.encode_move(move, board.turn))
        if board.turn == chess.WHITE:
            u = move.uci()
        else:
            u = chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square), move.promotion).uci()
        return self.vocab.get(u, -1)

    def encode(self, h: History) -> dict[str, np.ndarray]:
        """Input tensors for the position, without the rating inputs."""
        b = h.board
        if self.family == "fastelo":
            codes, castling, ep, half = self.lite.board_features([b])
            return {
                "board": codes.astype(np.int64),
                "castling": castling.astype(np.float32),
                "ep": ep.astype(np.int64),
                "halfmove": half.astype(np.int64),
                "ply": np.array([min(h.ply, 255)], np.int64),
                "tc": np.array([self.lite.RAPID], np.int64),
            }
        if self.family == "maia3":
            t = self.ds.get_historical_tokens(h.maia3_tokens, self._cfg, base=0.0, inc=0.0, clk_left_before=0.0, clk_ponder=0.0)
            return {"tokens": t[:, : 12 * 8].unsqueeze(0).numpy().astype(np.float32)}
        board_input, _s, _o, _legal = self.m2.preprocessing(b.fen(), 1500, 1500, self.elo_dict, self.vocab)
        return {"boards": board_input.unsqueeze(0).numpy().astype(np.float32)}

    def elo_feeds(self, elo_self: float, elo_oppo: float, n: int) -> dict[str, np.ndarray]:
        if self.family == "fastelo":
            return {"self_elo": np.full(n, elo_self, np.float32), "opp_elo": np.full(n, elo_oppo, np.float32)}
        if self.family == "maia3":
            return {"self_elo": np.full(n, int(elo_self), np.int64), "oppo_elo": np.full(n, int(elo_oppo), np.int64)}
        cs = self.m2utils.map_to_category(int(elo_self), self.elo_dict)
        co = self.m2utils.map_to_category(int(elo_oppo), self.elo_dict)
        return {"elo_self": np.full(n, cs, np.int64), "elo_oppo": np.full(n, co, np.int64)}

    def run(self, feeds: list[dict[str, np.ndarray]], elos: list[tuple[float, float]]) -> tuple[np.ndarray, np.ndarray]:
        """Policy logits [B, V] and the mover's expected score [B] for encoded positions."""
        batch = {k: np.concatenate([f[k] for f in feeds]) for k in feeds[0]}
        for k in self.elo_feeds(0, 0, 1):
            batch[k] = np.concatenate([self.elo_feeds(s, o, 1)[k] for s, o in elos])
        policy, value = self.session.run(self.outputs, batch)
        if self.family == "maia2":
            e = np.reshape(value, (-1,)) / 2 + 0.5
        else:
            z = value - value.max(-1, keepdims=True)
            p = np.exp(z)
            p /= p.sum(-1, keepdims=True)
            e = p[:, 2] + 0.5 * p[:, 1]  # [loss, draw, win]
        return policy, e
