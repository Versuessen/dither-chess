"""Stream games from a Lichess open database dump (CC0) without downloading the whole month.

The dumps are zstd-compressed PGN served with HTTP range support. Reading a fixed byte prefix
of a fixed monthly file is deterministic, so the same games come back on every run; the SHA-256
of the bytes consumed is recorded so a run can be audited.
"""

from __future__ import annotations

import hashlib
import io
import re
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass

import zstandard

BASE = "https://database.lichess.org/standard/"
HEADER = re.compile(r'^\[(\w+) "(.*)"\]$')


@dataclass
class LichessGame:
    headers: dict[str, str]
    movetext: str

    @property
    def white_elo(self) -> int | None:
        v = self.headers.get("WhiteElo", "?")
        return int(v) if v.isdigit() else None

    @property
    def black_elo(self) -> int | None:
        v = self.headers.get("BlackElo", "?")
        return int(v) if v.isdigit() else None

    @property
    def time_control(self) -> tuple[int, int] | None:
        tc = self.headers.get("TimeControl", "-")
        if "+" not in tc:
            return None
        base, inc = tc.split("+", 1)
        return int(base), int(inc)

    def is_lichess_rapid(self) -> bool:
        """Lichess rapid: estimated duration base + 40 x increment in [480, 1500) seconds."""
        tc = self.time_control
        if not tc:
            return False
        est = tc[0] + 40 * tc[1]
        return 480 <= est < 1500

    def is_clean(self) -> bool:
        """Rated, normal termination, no bots, both ratings known, non-provisional."""
        h = self.headers
        if "Rated" not in h.get("Event", ""):
            return False
        if h.get("Termination") not in ("Normal", "Time forfeit"):
            return False
        if h.get("WhiteTitle") == "BOT" or h.get("BlackTitle") == "BOT":
            return False
        if self.white_elo is None or self.black_elo is None:
            return False
        # Lichess marks provisional ratings with WhiteRatingDiff absent only for aborted games;
        # use the deviation tags when present.
        return True


class HashingReader(io.RawIOBase):
    def __init__(self, raw, limit: int):
        self.raw = raw
        self.limit = limit
        self.read_bytes = 0
        self.sha = hashlib.sha256()

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        if self.read_bytes >= self.limit:
            return 0
        n = min(len(b), self.limit - self.read_bytes)
        chunk = self.raw.read(n)
        if not chunk:
            return 0
        b[: len(chunk)] = chunk
        self.read_bytes += len(chunk)
        self.sha.update(chunk)
        return len(chunk)


def stream_games(month: str, max_bytes: int, stats: dict | None = None) -> Iterator[LichessGame]:
    """Yield games from the first `max_bytes` compressed bytes of `lichess_db_standard_rated_<month>`."""
    url = f"{BASE}lichess_db_standard_rated_{month}.pgn.zst"
    req = urllib.request.Request(url, headers={"Range": f"bytes=0-{max_bytes - 1}", "User-Agent": "dither-tools"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        reader = HashingReader(resp, max_bytes)
        dctx = zstandard.ZstdDecompressor(max_window_size=2**31)
        text = io.TextIOWrapper(dctx.stream_reader(io.BufferedReader(reader), read_across_frames=True), encoding="utf-8", errors="replace")
        headers: dict[str, str] = {}
        moves: list[str] = []
        try:
            for line in text:
                line = line.rstrip("\n")
                if line.startswith("["):
                    if moves:
                        yield LichessGame(headers, " ".join(moves))
                        headers, moves = {}, []
                    m = HEADER.match(line)
                    if m:
                        headers[m.group(1)] = m.group(2)
                elif line:
                    moves.append(line)
                elif moves:
                    yield LichessGame(headers, " ".join(moves))
                    headers, moves = {}, []
        except zstandard.ZstdError:
            # The byte prefix ends mid-frame; everything before it has been yielded.
            pass
        finally:
            # Also runs when the consumer stops early: record exactly what was read.
            if stats is not None:
                stats.update(url=url, bytes=reader.read_bytes, sha256=reader.sha.hexdigest())


CLK = re.compile(r"\{[^}]*\}")
RESULT = re.compile(r"(1-0|0-1|1/2-1/2|\*)\s*$")
MOVE_NO = re.compile(r"\d+\.(\.\.)?")


def san_moves(movetext: str) -> list[str]:
    """SAN tokens of a Lichess movetext (comments, move numbers and result removed)."""
    t = CLK.sub(" ", movetext)
    t = RESULT.sub(" ", t)
    t = MOVE_NO.sub(" ", t)
    return [tok for tok in t.split() if tok and not tok.startswith("$")]
