"""Export fastelo and Maia-3 to ONNX; take Maia-2's published ONNX as is.

Graph interfaces (B = batch, all dynamic):

fastelo  (fastelo.models.PlayerNet)
  in   board int64[B,64]   piece codes, mover's perspective (0 empty, 1-6 own PNBRQK, 7-12 opponent)
       castling float32[B,4]  own K, own Q, opponent K, opponent Q
       ep int64[B]         en-passant file 0-7 when a capture is legal, else 8
       halfmove int64[B]   clamped to 100 in the graph
       ply int64[B]        plies played, clamped to 255 in the graph
       tc int64[B]         time-control category (3 = rapid)
       self_elo float32[B], opp_elo float32[B]
  out  policy float32[B,1880] over fastelo.vocab.MOVES; value float32[B,3] = loss, draw, win (mover)

maia3  (maia3.models.MAIA3Model, 8 positions of history)
  in   tokens float32[B,64,96]  12 one-hot planes per position, oldest first, each position from
                                its own side-to-move perspective (mirrored when Black is to move)
       self_elo int64[B], oppo_elo int64[B]
  out  logits_move float32[B,4352]; logits_value float32[B,3] = loss, draw, win (side to move)

maia2  (published by CSSLab in maia-platform-frontend, opset 11)
  in   boards float32[B,18,8,8]; elo_self int64[B]; elo_oppo int64[B]  (rating buckets 0-10)
  out  logits_maia float32[B,1880]; logits_side_info; logits_value float32[B] in [-1, 1]
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import onnx
import torch
from torch import nn

from . import refcode
from .paths import CODE, EXPORTS, SOURCES

OPSET = 18


class FasteloGraph(nn.Module):
    def __init__(self, net: nn.Module):
        super().__init__()
        self.net = net

    def forward(self, board, castling, ep, halfmove, ply, tc, self_elo, opp_elo):
        batch = {
            "board": board,
            "castling": castling,
            "ep": ep,
            "halfmove": halfmove.clamp(max=100),
            "ply": ply.clamp(min=0, max=255),
            "tc": tc,
            "self_elo": self_elo,
            "opp_elo": opp_elo,
        }
        policy, value = self.net(batch)
        return policy, value


class Maia3Graph(nn.Module):
    def __init__(self, net: nn.Module):
        super().__init__()
        self.net = net

    def forward(self, tokens, self_elo, oppo_elo):
        logits_move, logits_value, _ponder = self.net(tokens, self_elo, oppo_elo)
        return logits_move, logits_value


def load_fastelo() -> nn.Module:
    models = refcode.fastelo("models")
    net, _info = models.load_model(str(SOURCES / "fastelo" / "player.safetensors"))
    return net.float().eval()


def fastelo_example(batch: int = 2):
    return (
        torch.zeros(batch, 64, dtype=torch.long),
        torch.zeros(batch, 4),
        torch.full((batch,), 8, dtype=torch.long),
        torch.zeros(batch, dtype=torch.long),
        torch.zeros(batch, dtype=torch.long),
        torch.full((batch,), 3, dtype=torch.long),
        torch.full((batch,), 1500.0),
        torch.full((batch,), 1500.0),
    )


class _Cfg:
    def __init__(self, d: dict):
        self.__dict__.update(d)


def load_maia3(size: str) -> nn.Module:
    registry = refcode.maia3("model_registry")
    models = refcode.maia3("models")
    spec = registry.resolve_model_spec(f"maia3-{size}")
    cfg = _Cfg(dict(spec.config))
    net = models.MAIA3Model(cfg)
    ckpt = torch.load(SOURCES / f"maia3-{size}" / f"maia3-{size}.pt", map_location="cpu", weights_only=True)
    state = ckpt["model_state_dict"] if isinstance(ckpt, dict) and "model_state_dict" in ckpt else ckpt
    state = {k.replace("smolgen", "gab"): v for k, v in state.items()}
    missing, unexpected = net.load_state_dict(state, strict=False)
    if missing or unexpected:
        raise RuntimeError(f"maia3-{size}: missing {missing[:5]} unexpected {unexpected[:5]}")
    return net.float().eval()


def maia3_example(batch: int = 2):
    return (
        torch.zeros(batch, 64, 96),
        torch.full((batch,), 1500, dtype=torch.long),
        torch.full((batch,), 1500, dtype=torch.long),
    )


def _export(model: nn.Module, example: tuple, names_in: list[str], names_out: list[str], path: Path) -> None:
    batch = torch.export.Dim("batch", min=1, max=64)
    dynamic = {n: {0: batch} for n in names_in}
    with torch.no_grad():
        prog = torch.onnx.export(
            model,
            example,
            input_names=names_in,
            output_names=names_out,
            dynamic_shapes=dynamic,
            opset_version=OPSET,
            dynamo=True,
            external_data=False,
            optimize=True,
        )
    prog.save(str(path))
    m = onnx.load(str(path))
    onnx.checker.check_model(m)
    params = sum(onnx.numpy_helper.to_array(t).size for t in m.graph.initializer)
    print(f"  {path.name}: opset {OPSET}, {params / 1e6:.2f}M initialised values, {path.stat().st_size / 1e6:.1f} MB")


def export_all() -> None:
    EXPORTS.mkdir(parents=True, exist_ok=True)
    print("fastelo")
    _export(
        FasteloGraph(load_fastelo()),
        fastelo_example(),
        ["board", "castling", "ep", "halfmove", "ply", "tc", "self_elo", "opp_elo"],
        ["policy", "value"],
        EXPORTS / "fastelo.onnx",
    )
    for size in ("5m", "23m"):
        print(f"maia3-{size}")
        _export(
            Maia3Graph(load_maia3(size)),
            maia3_example(),
            ["tokens", "self_elo", "oppo_elo"],
            ["logits_move", "logits_value"],
            EXPORTS / f"maia3-{size}.onnx",
        )
    print("maia2")
    shutil.copyfile(SOURCES / "maia2-onnx" / "maia_rapid.onnx", EXPORTS / "maia2-rapid.onnx")
    print("  maia2-rapid.onnx: published ONNX, unchanged")
    write_vocabularies()


def write_vocabularies() -> None:
    """Each pack carries its move vocabulary so the TS side never re-derives it."""
    vocab = refcode.fastelo("vocab")
    (EXPORTS / "fastelo.vocab.json").write_text(json.dumps(list(vocab.MOVES)))
    utils3 = refcode.maia3("utils")
    moves3 = utils3.get_all_possible_moves()
    (EXPORTS / "maia3.vocab.json").write_text(json.dumps(moves3))
    utils2 = refcode.maia2("utils")
    moves2 = utils2.get_all_possible_moves()
    (EXPORTS / "maia2.vocab.json").write_text(json.dumps(moves2))
    print(f"  vocabularies: fastelo {len(vocab.MOVES)}, maia3 {len(moves3)}, maia2 {len(moves2)}")
    _ = CODE
