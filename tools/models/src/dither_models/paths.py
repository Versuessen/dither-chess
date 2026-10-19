"""Filesystem layout of the pipeline."""

from __future__ import annotations

from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = TOOL_ROOT.parents[1]
WORK = TOOL_ROOT / "work"
SOURCES = WORK / "sources"
CODE = WORK / "code"
EXPORTS = WORK / "onnx"
PACKS = REPO_ROOT / "models" / "packs"
MANIFEST = REPO_ROOT / "models" / "manifest.json"
LOCK = TOOL_ROOT / "sources.lock.json"
POSITIONS = WORK / "positions.json"
GOLDEN = REPO_ROOT / "tests" / "golden"
REPORTS = TOOL_ROOT / "reports"

for p in (WORK, SOURCES, CODE, EXPORTS, REPORTS):
    p.mkdir(parents=True, exist_ok=True)
