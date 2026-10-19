"""Assemble model packs (.dpk) and models/manifest.json.

DPK container (read by src/models/pack.ts and src-tauri/src/models.rs):
  bytes 0-3   "DPK1"
  bytes 4-7   little-endian u32: length H of the JSON header
  bytes 8..   header (UTF-8 JSON): {"id", "version", "family", "meta", "files": [{"name", "offset",
              "size", "sha256"}]}; offsets count from the first byte after the header
  then        the files, back to back
The manifest lists each pack's SHA-256 over the whole .dpk; the app refuses unverified packs.
"""

from __future__ import annotations

import hashlib
import json
import os
import struct
from pathlib import Path

from .fetch import sha256
from .paths import EXPORTS, MANIFEST, PACKS, REPORTS, SOURCES
from .sources import GIT_SOURCES, HF_SOURCES

PACK_VERSION = "1.0.0"
FORMAT = 1

CALIBRATION_DIR = Path(__file__).resolve().parents[3] / "calibrate" / "results"


def _source(sid: str) -> dict:
    for s in HF_SOURCES:
        if s.id == sid:
            return {"type": "huggingface", "repo": s.repo, "revision": s.revision, "license": s.license}
    for g in GIT_SOURCES:
        if g.id == sid:
            return {"type": "git", "url": g.url, "commit": g.commit, "license": g.license}
    raise KeyError(sid)


def write_dpk(path: Path, pack_id: str, family: str, meta: dict, files: list[tuple[str, bytes]]) -> dict:
    entries = []
    offset = 0
    for name, data in files:
        entries.append({"name": name, "offset": offset, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        offset += len(data)
    header = json.dumps(
        {"id": pack_id, "version": PACK_VERSION, "family": family, "meta": meta, "files": entries},
        separators=(",", ":"),
    ).encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"DPK1")
        f.write(struct.pack("<I", len(header)))
        f.write(header)
        for _name, data in files:
            f.write(data)
    return {"sha256": sha256(path), "size": path.stat().st_size}


def _calibration(model: str) -> dict | None:
    """Maia levels come from tools/calibrate; None until it has run for this model."""
    p = CALIBRATION_DIR / f"{model}.json"
    return json.loads(p.read_text()) if p.exists() else None


def _report(name: str) -> dict[str, dict]:
    p = REPORTS / name
    if not p.exists():
        return {}
    return {r["model"]: r for r in json.loads(p.read_text())}


SPECS = {
    "fastelo": {
        "pack": "fastelo-7m",
        "family": "fastelo",
        "source": "fastelo",
        "code": "fastelo-code",
        "license": "GPL-3.0",
        "title": "fastelo 7M",
        "extra": [("calibration.json", SOURCES / "fastelo" / "calibration.json"), ("rating_response.json", SOURCES / "fastelo" / "rating_response.json"), ("LICENSE", SOURCES / "fastelo" / "LICENSE")],
        "levels": list(range(600, 1901, 50)),
        "optional": False,
    },
    "maia3-5m": {
        "pack": "maia3-5m",
        "family": "maia3",
        "source": "maia3-5m",
        "code": "maia3-code",
        "license": "AGPL-3.0",
        "title": "Maia-3 5M",
        "extra": [],
        "levels": None,
        "optional": False,
    },
    "maia3-23m": {
        "pack": "maia3-23m",
        "family": "maia3",
        "source": "maia3-23m",
        "code": "maia3-code",
        "license": "AGPL-3.0",
        "title": "Maia-3 23M (high quality)",
        "extra": [],
        "levels": None,
        "optional": True,
    },
    "maia2-rapid": {
        "pack": "maia2-rapid",
        "family": "maia2",
        "source": "maia2-onnx",
        "code": "maia2-code",
        "license": "MIT (model), GPL-3.0 (ONNX export repository)",
        "title": "Maia-2 rapid",
        "extra": [],
        "levels": None,
        "optional": False,
    },
}

VOCAB = {"fastelo": "fastelo.vocab.json", "maia3": "maia3.vocab.json", "maia2": "maia2.vocab.json"}


def base_urls(cli: list[str] | None) -> list[str]:
    if cli:
        return cli
    env = os.environ.get("DITHER_MODEL_BASE_URLS")
    if env:
        return [u.strip() for u in env.split(",") if u.strip()]
    urls = []
    repo = os.environ.get("GITHUB_REPOSITORY")
    if repo:
        owner, name = repo.split("/", 1)
        # The packs are committed to the repository and the GitHub Pages site serves them. Once
        # they are committed, add raw.githubusercontent.com/<repo>/<that commit>/models/packs/ as a
        # second source by hand, so installed apps can still download them after newer packs
        # replace them on main.
        urls.append(f"https://{owner.lower()}.github.io/{name}/models/packs/")
    # Mirror: the web build serves the packs next to the app (not precached by the service worker).
    urls.append("models/packs/")
    return urls


def pack_all(cli_urls: list[str] | None = None) -> dict:
    parity = _report("parity.json")
    quant = _report("quantize.json")
    entries = []
    for model, spec in SPECS.items():
        q = quant.get(model, {})
        chosen = q.get("chosen", "fp32")
        onnx_path = EXPORTS / (f"{model}.onnx" if chosen == "fp32" else f"{model}.{chosen}.onnx")
        calibration = _calibration(model) if spec["levels"] is None else None
        meta = {
            "title": spec["title"],
            "license": spec["license"],
            "weights": _source(spec["source"]),
            "code": _source(spec["code"]),
            "variant": chosen,
            "parity": parity.get(model),
            "quantization": q.get("variants", {}).get(chosen) if chosen != "fp32" else None,
        }
        files: list[tuple[str, bytes]] = [
            ("model.onnx", onnx_path.read_bytes()),
            ("vocab.json", (EXPORTS / VOCAB[spec["family"]]).read_bytes()),
        ]
        for name, p in spec["extra"]:
            files.append((name, Path(p).read_bytes()))
        if calibration is not None:
            files.append(("calibration.json", json.dumps(calibration).encode()))
        filename = f"{spec['pack']}-{PACK_VERSION}.dpk"
        info = write_dpk(PACKS / filename, spec["pack"], spec["family"], meta, files)
        levels = spec["levels"] if spec["levels"] is not None else [r["level"] for r in (calibration or {}).get("levels", [])]
        entries.append(
            {
                "id": spec["pack"],
                "version": PACK_VERSION,
                "family": spec["family"],
                "title": spec["title"],
                "file": filename,
                "sha256": info["sha256"],
                "size": info["size"],
                "license": spec["license"],
                "source": meta["weights"],
                "variant": chosen,
                "optional": spec["optional"],
                "calibration": {
                    "method": "published (fastelo calibration.json)" if spec["family"] == "fastelo" else "tools/calibrate",
                    "levels": levels,
                },
            }
        )
        print(f"{filename}: {info['size'] / 1e6:.1f} MB, {chosen}, {len(levels)} levels, sha256 {info['sha256'][:16]}")
    manifest = {"format": FORMAT, "sources": base_urls(cli_urls), "packs": entries}
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {MANIFEST}")
    return manifest
