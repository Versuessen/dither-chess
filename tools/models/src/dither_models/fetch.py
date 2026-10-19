"""Download pinned sources and verify their SHA-256 checksums.

    dither-models fetch            verify against sources.lock.json (fails on any mismatch)
    dither-models fetch --record   (re)write the lock from what was downloaded; review the diff
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from huggingface_hub import hf_hub_download

from .paths import CODE, LOCK, SOURCES
from .sources import GIT_SOURCES, HF_SOURCES


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _git(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def _checkout(url: str, commit: str, dest: Path) -> None:
    if (dest / ".git").exists():
        head = _git("rev-parse", "HEAD", cwd=dest).strip()
        if head == commit:
            return
    else:
        dest.mkdir(parents=True, exist_ok=True)
        _git("init", "-q", cwd=dest)
        _git("remote", "add", "origin", url, cwd=dest)
    _git("-c", "gc.auto=0", "fetch", "-q", "--filter=blob:none", "origin", commit, cwd=dest)
    _git("-c", "gc.auto=0", "checkout", "-q", "--force", commit, cwd=dest)


def fetch_all(record: bool = False) -> dict[str, dict[str, str]]:
    lock: dict[str, dict[str, str]] = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    seen: dict[str, dict[str, str]] = {}

    for src in HF_SOURCES:
        out = SOURCES / src.id
        out.mkdir(parents=True, exist_ok=True)
        hashes: dict[str, str] = {}
        for name in src.files:
            path = Path(hf_hub_download(src.repo, name, revision=src.revision, local_dir=out))
            hashes[name] = sha256(path)
        seen[src.id] = hashes
        print(f"{src.id}: {src.repo}@{src.revision[:12]} ({len(hashes)} files)")

    for src in GIT_SOURCES:
        dest = CODE / src.id
        _checkout(src.url, src.commit, dest)
        hashes = {}
        if src.blobs:
            # Blobs from history need the full commit graph.
            try:
                _git("-c", "gc.auto=0", "fetch", "-q", "--filter=blob:none", "--unshallow", "origin", cwd=dest)
            except subprocess.CalledProcessError:
                _git("-c", "gc.auto=0", "fetch", "-q", "--filter=blob:none", "origin", cwd=dest)
            out = SOURCES / src.id
            out.mkdir(parents=True, exist_ok=True)
            for name, spec in src.blobs.items():
                target = out / name
                if not target.exists():
                    with open(target, "wb") as f:
                        subprocess.run(["git", "-c", "gc.auto=0", "cat-file", "blob", spec], cwd=dest, check=True, stdout=f)
                hashes[name] = sha256(target)
        hashes["commit"] = src.commit
        seen[src.id] = hashes
        print(f"{src.id}: {src.url}@{src.commit[:12]}")

    if record:
        LOCK.write_text(json.dumps(seen, indent=2, sort_keys=True) + "\n")
        print(f"recorded {LOCK}")
        return seen

    problems = []
    for sid, files in seen.items():
        for name, digest in files.items():
            want = lock.get(sid, {}).get(name)
            if want is None:
                problems.append(f"{sid}/{name}: not in the lock (run with --record and review)")
            elif want != digest:
                problems.append(f"{sid}/{name}: sha256 {digest} != locked {want}")
    if problems:
        raise SystemExit("checksum verification failed:\n  " + "\n  ".join(problems))
    print("all sources match sources.lock.json")
    return seen


def clean() -> None:
    shutil.rmtree(SOURCES, ignore_errors=True)
    shutil.rmtree(CODE, ignore_errors=True)
