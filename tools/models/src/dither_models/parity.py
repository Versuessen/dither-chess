"""ONNX vs Python reference on the parity positions, and golden fixtures for the TypeScript side.

Pass criteria per model (all 2,000 sampled positions plus the edge cases):
  - top-1 agreement (argmax over legal moves) >= 99.9 %
  - maximum absolute logit difference over the whole vocabulary < 1e-3
Results go to reports/parity.json and reports/parity.md; the run fails if a model misses.

Golden fixtures (tests/golden/<model>.json) hold, for the first 120 sampled positions and every
edge case, the reference encoding and the reference logits of the legal moves, so the
TypeScript encoders and the onnxruntime-web runtime can be checked against the Python code.
"""

from __future__ import annotations

import json
import random
import time

import numpy as np
import onnxruntime as ort

from .paths import EXPORTS, GOLDEN, REPORTS
from .positions import load_positions
from .references import MODELS, adapter

TOP1_MIN = 0.999
MAX_DIFF = 1e-3
GOLDEN_SAMPLED = 120


def level_for(model: str, rng: random.Random) -> int:
    lo = 1100 if model == "maia2-rapid" else 600
    return rng.randrange(lo, 1901, 50)


def compact(model: str, feeds: dict[str, np.ndarray]) -> dict:
    if model == "fastelo":
        return {
            "board": feeds["board"][0].tolist(),
            "castling": feeds["castling"][0].tolist(),
            "ep": int(feeds["ep"][0]),
            "halfmove": int(feeds["halfmove"][0]),
            "ply": int(feeds["ply"][0]),
            "tc": int(feeds["tc"][0]),
            "elo": float(feeds["self_elo"][0]),
        }
    if model.startswith("maia3"):
        return {
            "ones": np.flatnonzero(feeds["tokens"][0].reshape(-1) > 0.5).tolist(),
            "self_elo": int(feeds["self_elo"][0]),
            "oppo_elo": int(feeds["oppo_elo"][0]),
        }
    return {
        "ones": np.flatnonzero(feeds["boards"][0].reshape(-1) > 0.5).tolist(),
        "elo_self": int(feeds["elo_self"][0]),
        "elo_oppo": int(feeds["elo_oppo"][0]),
    }


def run_model(model: str, positions: list[dict]) -> dict:
    ref = adapter(model)
    sess = ort.InferenceSession(str(EXPORTS / f"{model}.onnx"), providers=["CPUExecutionProvider"])
    out_names = [o.name for o in sess.get_outputs()]
    policy_out = out_names[0]
    value_out = "value" if "value" in out_names else "logits_value"
    rng = random.Random(f"parity-{model}")
    agree = 0
    max_diff = 0.0
    max_legal_diff = 0.0
    max_value_diff = 0.0
    golden_cases = []
    t0 = time.time()
    sampled = [p for p in positions if p["site"] != "edge-case"]
    edges = [p for p in positions if p["site"] == "edge-case"]
    for idx, entry in enumerate(sampled + edges):
        level = level_for(model, rng)
        enc = ref.encode(entry, level)
        ref_logits, ref_value = ref.reference(entry, level)
        outs = sess.run([policy_out, value_out], enc.feeds)
        onnx_logits = outs[0][0].astype(np.float64)
        onnx_value = np.atleast_1d(outs[1][0]).astype(np.float64)
        diff = np.abs(onnx_logits - ref_logits)
        max_diff = max(max_diff, float(diff.max()))
        max_legal_diff = max(max_legal_diff, float(diff[enc.legal].max()))
        max_value_diff = max(max_value_diff, float(np.abs(onnx_value - ref_value).max()))
        legal_idx = np.flatnonzero(enc.legal)
        a = legal_idx[np.argmax(ref_logits[legal_idx])]
        b = legal_idx[np.argmax(onnx_logits[legal_idx])]
        agree += int(a == b)
        if idx < GOLDEN_SAMPLED or entry["site"] == "edge-case":
            golden_cases.append(
                {
                    "fen": entry["fen"],
                    "moves": entry["moves"],
                    "level": level,
                    "encoded": compact(model, enc.feeds),
                    "legal": legal_idx.tolist(),
                    "logits": [round(float(ref_logits[i]), 6) for i in legal_idx],
                    "value": [round(float(v), 6) for v in np.atleast_1d(ref_value)],
                    "top1": int(a),
                }
            )
    n = len(sampled) + len(edges)
    result = {
        "model": model,
        "positions": n,
        "top1_agreement": agree / n,
        "max_abs_logit_diff": max_diff,
        "max_abs_legal_logit_diff": max_legal_diff,
        "max_abs_value_diff": max_value_diff,
        "seconds": round(time.time() - t0, 1),
    }
    result["pass"] = result["top1_agreement"] >= TOP1_MIN and result["max_abs_logit_diff"] < MAX_DIFF
    GOLDEN.mkdir(parents=True, exist_ok=True)
    (GOLDEN / f"{model}.json").write_text(
        json.dumps({"model": model, "vocab_size": ref.vocab_size, "cases": golden_cases}, separators=(",", ":")) + "\n"
    )
    return result


def write_calibration_golden() -> None:
    """fastelo's settings() on every app level, for the TypeScript port of the calibration."""
    from .references import FasteloRef

    ref = FasteloRef()
    rows = []
    for level in range(600, 1901, 50):
        cond, temperature, mix = ref.lite.settings(ref.cal, float(level))
        rows.append({"level": level, "conditioning": cond, "temperature": temperature, "mix": mix})
    GOLDEN.mkdir(parents=True, exist_ok=True)
    (GOLDEN / "fastelo-calibration.json").write_text(
        json.dumps({"calibration": ref.cal, "settings": rows}, indent=1) + "\n"
    )


def run_parity(models: list[str] | None = None) -> list[dict]:
    positions = load_positions()
    if not models or "fastelo" in models:
        write_calibration_golden()
    results = []
    for m in models or MODELS:
        if not (EXPORTS / f"{m}.onnx").exists():
            raise SystemExit(f"{m}.onnx missing: run `dither-models export` first")
        r = run_model(m, positions)
        results.append(r)
        flag = "PASS" if r["pass"] else "FAIL"
        print(
            f"{m:12} {flag}  top-1 {r['top1_agreement'] * 100:.2f}%  max|dlogit| {r['max_abs_logit_diff']:.2e}"
            f"  (legal {r['max_abs_legal_logit_diff']:.2e})  max|dvalue| {r['max_abs_value_diff']:.2e}  {r['seconds']}s"
        )
    REPORTS.mkdir(parents=True, exist_ok=True)
    old = json.loads((REPORTS / "parity.json").read_text()) if (REPORTS / "parity.json").exists() else []
    merged = {r["model"]: r for r in old} | {r["model"]: r for r in results}
    (REPORTS / "parity.json").write_text(json.dumps(list(merged.values()), indent=2) + "\n")
    lines = [
        "# ONNX parity",
        "",
        f"Criteria: top-1 agreement >= {TOP1_MIN * 100:.1f}% and max |logit difference| < {MAX_DIFF:g} over the full vocabulary.",
        "",
        "| Model | Positions | Top-1 agreement | Max abs logit diff | (legal moves) | Max abs value diff | Result |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in merged.values():
        lines.append(
            f"| {r['model']} | {r['positions']} | {r['top1_agreement'] * 100:.2f}% | {r['max_abs_logit_diff']:.2e} | "
            f"{r['max_abs_legal_logit_diff']:.2e} | {r['max_abs_value_diff']:.2e} | {'pass' if r['pass'] else 'FAIL'} |"
        )
    (REPORTS / "parity.md").write_text("\n".join(lines) + "\n")
    failed = [r["model"] for r in results if not r["pass"]]
    if failed:
        raise SystemExit(f"parity failed: {', '.join(failed)}")
    return results
