"""Smaller variants, kept only when the move distribution stays within KL 0.01 of the original.

Variants per model:
  fp16w  weights stored as float16 with a Cast back to float32 at load; arithmetic stays float32
         (fastelo's published weights are float16 already, so this is lossless for it)
  int8   onnxruntime dynamic quantisation of MatMul/Gemm weights (per channel)

Criterion: for every parity position, KL(p_original || p_variant) <= 0.01, where p is the softmax
of the legal-move logits at temperature 1. The worst position decides (stricter than a mean).
The smallest passing variant becomes the pack's model; results go to reports/quantize.json.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization import QuantType, quantize_dynamic

from .parity import level_for
from .paths import EXPORTS, REPORTS
from .positions import load_positions
from .references import MODELS, adapter

KL_MAX = 0.01


def fp16_weights(src: str, dst: str, min_size: int = 1024) -> None:
    m = onnx.load(src)
    g = m.graph
    casts = []
    for init in list(g.initializer):
        if init.data_type != TensorProto.FLOAT:
            continue
        arr = numpy_helper.to_array(init)
        if arr.size < min_size:
            continue
        name = init.name
        half = numpy_helper.from_array(arr.astype(np.float16), name + "__fp16")
        g.initializer.remove(init)
        g.initializer.append(half)
        casts.append(helper.make_node("Cast", [half.name], [name], to=TensorProto.FLOAT, name=name + "__cast"))
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    onnx.checker.check_model(m)
    onnx.save(m, dst)


def int8(src: str, dst: str) -> None:
    # The dynamo exporter leaves value_info entries that disagree with onnx shape inference once
    # the quantiser rewrites MatMuls; drop them and let inference start clean.
    m = onnx.load(src)
    del m.graph.value_info[:]
    clean = dst + ".clean.onnx"
    onnx.save(m, clean)
    try:
        quantize_dynamic(clean, dst, weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["MatMul", "Gemm"])
    finally:
        Path(clean).unlink(missing_ok=True)


def _legal_probs(logits: np.ndarray, legal: np.ndarray) -> np.ndarray:
    z = logits[legal].astype(np.float64)
    z -= z.max()
    p = np.exp(z)
    return p / p.sum()


def measure(model: str, variant_path: str, positions: list[dict]) -> dict:
    ref = adapter(model)
    base = ort.InferenceSession(str(EXPORTS / f"{model}.onnx"), providers=["CPUExecutionProvider"])
    var = ort.InferenceSession(variant_path, providers=["CPUExecutionProvider"])
    out = base.get_outputs()[0].name
    rng = random.Random(f"parity-{model}")
    kls = []
    agree = 0
    for entry in positions:
        level = level_for(model, rng)
        e = ref.encode(entry, level)
        a = base.run([out], e.feeds)[0][0]
        b = var.run([out], e.feeds)[0][0]
        p = _legal_probs(a, e.legal)
        q = _legal_probs(b, e.legal)
        kls.append(float(np.sum(p * (np.log(p + 1e-300) - np.log(q + 1e-300)))))
        agree += int(np.argmax(p) == np.argmax(q))
    kl = np.array(kls)
    return {
        "kl_mean": float(kl.mean()),
        "kl_p99": float(np.quantile(kl, 0.99)),
        "kl_max": float(kl.max()),
        "top1_agreement": agree / len(positions),
    }


def quantize_all(models: list[str] | None = None) -> list[dict]:
    """Measure variants for `models` (default all) and merge the rows into reports/quantize.json."""
    positions = load_positions()
    report = REPORTS / "quantize.json"
    previous = {r["model"]: r for r in json.loads(report.read_text())} if report.exists() else {}
    results = []
    for model in models or MODELS:
        src = EXPORTS / f"{model}.onnx"
        size = src.stat().st_size
        row = {"model": model, "fp32_bytes": size, "variants": {}}
        for name, fn in (("fp16w", fp16_weights), ("int8", int8)):
            dst = EXPORTS / f"{model}.{name}.onnx"
            try:
                fn(str(src), str(dst))
            except Exception as err:  # a converter can refuse a graph; record and move on
                row["variants"][name] = {"error": str(err)}
                continue
            r = measure(model, str(dst), positions)
            r["bytes"] = dst.stat().st_size
            r["pass"] = r["kl_max"] <= KL_MAX
            row["variants"][name] = r
            print(
                f"{model:12} {name:6} {r['bytes'] / 1e6:6.1f} MB  KL mean {r['kl_mean']:.2e}  p99 {r['kl_p99']:.2e}"
                f"  max {r['kl_max']:.2e}  top-1 {r['top1_agreement'] * 100:.2f}%  {'keep' if r['pass'] else 'drop'}"
            )
        passing = [(v["bytes"], n) for n, v in row["variants"].items() if v.get("pass")]
        row["chosen"] = min(passing)[1] if passing else "fp32"
        results.append(row)
    merged = {**previous, **{r["model"]: r for r in results}}
    REPORTS.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps([merged[m] for m in MODELS if m in merged], indent=2) + "\n")
    return results
