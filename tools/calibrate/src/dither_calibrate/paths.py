"""Filesystem layout of the calibration tools."""

from __future__ import annotations

import json
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = TOOL_ROOT.parents[1]
WORK = TOOL_ROOT / "work"
RESULTS = TOOL_ROOT / "results"
REPORTS = TOOL_ROOT / "reports"
LOCK = TOOL_ROOT / "sources.lock.json"
PACKS = REPO_ROOT / "models" / "packs"
MANIFEST = REPO_ROOT / "models" / "manifest.json"
CALIBRATION_MD = REPO_ROOT / "CALIBRATION.md"

for p in (WORK, RESULTS, REPORTS):
    p.mkdir(parents=True, exist_ok=True)


def lock() -> dict:
    return json.loads(LOCK.read_text())
