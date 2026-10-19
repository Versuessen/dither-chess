"""Pinned upstream sources. Every file is checked against sources.lock.json after download."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class HfSource:
    id: str
    repo: str
    revision: str
    files: tuple[str, ...]
    license: str


@dataclass(frozen=True)
class GitSource:
    id: str
    url: str
    commit: str
    license: str
    # A file taken from the repository's history rather than the checked-out tree.
    blobs: dict[str, str] = field(default_factory=dict)


HF_SOURCES: tuple[HfSource, ...] = (
    HfSource(
        id="fastelo",
        repo="irsotarriva/fastelo",
        revision="eb9e26fc363adbb74ada76d03f018be3fd398bb3",
        files=(
            "player.safetensors",
            "player.json",
            "calibration.json",
            "rating_response.json",
            "LICENSE",
            "README.md",
        ),
        license="GPL-3.0",
    ),
    HfSource(
        id="maia3-5m",
        repo="UofTCSSLab/Maia3-5M",
        revision="b6559de2398d7140b985f28fd2c19fb5e47ddabe",
        files=("maia3-5m.pt", "README.md"),
        license="AGPL-3.0",
    ),
    HfSource(
        id="maia3-23m",
        repo="UofTCSSLab/Maia3-23M",
        revision="51a0145a8178046f7de23119160b136672deeb2b",
        files=("maia3-23m.pt", "README.md"),
        license="AGPL-3.0",
    ),
)

GIT_SOURCES: tuple[GitSource, ...] = (
    GitSource(
        id="fastelo-code",
        url="https://github.com/irsotarriva/fastelo",
        commit="65c5612d15923309a2fc6d99796da2b6efe9d897",
        license="GPL-3.0",
    ),
    GitSource(
        id="maia3-code",
        url="https://github.com/CSSLab/maia3",
        commit="1e13597c42d4858b7cfd7cfdae01e297263364b2",
        license="AGPL-3.0",
    ),
    GitSource(
        id="maia2-code",
        url="https://github.com/CSSLab/maia2",
        commit="67bee6ce7e2f264344fe6d2026a2e18c76a82efa",
        license="MIT",
    ),
    GitSource(
        id="maia2-onnx",
        url="https://github.com/CSSLab/maia-platform-frontend",
        commit="a6e52f5c811ee18863cb2f0e81f2433a5b9905de",
        license="GPL-3.0",
        # Removed from the tree in c956db4 (Feb 2026); the release asset that commit points to
        # returns 404, so the blob is read from the parent commit.
        blobs={"maia_rapid.onnx": "c956db4^:public/maia2/maia_rapid.onnx"},
    ),
)
