"""Import the upstream reference code from the pinned checkouts in work/code/."""

from __future__ import annotations

import importlib
import sys
from types import ModuleType

from .paths import CODE


def _add(path: str) -> None:
    if path not in sys.path:
        sys.path.insert(0, path)


def fastelo(module: str) -> ModuleType:
    """e.g. fastelo('models'), fastelo('lite'), fastelo('vocab')."""
    _add(str(CODE / "fastelo-code"))
    return importlib.import_module(f"fastelo.{module}")


def maia3(module: str) -> ModuleType:
    _add(str(CODE / "maia3-code"))
    return importlib.import_module(f"maia3.{module}")


def maia2(module: str) -> ModuleType:
    _add(str(CODE / "maia2-code"))
    return importlib.import_module(f"maia2.{module}")
