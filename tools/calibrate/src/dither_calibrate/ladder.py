"""Second calibration stage: space the levels by results.

Matching human move quality (fit.py) puts a bot's average strength in the right place, but in
gauntlets its levels play closer together than the Elo curve says levels that far apart should
(see CALIBRATION.md). So the levels are re-spaced by results:

  1. Ladder: the bot's settings are followed along a path u (the human-matched settings for a
     nominal rating u, continued beyond the fitted range with the same formulas, and below the
     lowest band with a rising temperature) in steps of 200;
     neighbouring points play 400 games each, as in the gauntlets. The cumulative Elo differences
     give E(u), the strength of each point on one scale.
  2. Anchor: L(u) = E(u) + k, with k chosen so that L(u) = u on average over the band centres the
     human data covers (700–2300). The human calibration keeps the average level; results set
     the spacing.
  3. Levels: each offered level L uses the settings at u = L⁻¹(L), every 50 points (Maia-2: every
     100, from 1100) wherever the ladder reaches, within 600–2300.

A fresh gauntlet on the new levels then checks the result (gauntlet.py).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .fit import temperature_at
from .gauntlet import Settings, run_pairing
from .paths import RESULTS
from .runner import Runner

STEP = 200
RANGE = {"maia3-5m": (300, 2700), "maia3-23m": (300, 2700), "maia2-rapid": (700, 2300)}
ANCHOR = (700, 2300)


def path_settings(model: str, fit: dict, u: float) -> Settings:
    T = temperature_at(fit["temperature_curve"], u)
    if model == "maia2-rapid":
        # Maia-2's input is its 100-point bucket; the level's own rating picks it.
        return Settings(int(round(u)), round(u), round(u), round(T, 4), 1.0)
    knots = [k for k in fit["knots"] if k["conditioning"] is not None]
    ke = [k["elo"] for k in knots]
    kd = [k["conditioning"] - k["elo"] for k in knots]
    c = float(np.clip(u + np.interp(u, ke, kd), fit["grid"][0], fit["grid"][-1]))
    if u < ke[0]:
        # Below the lowest band the rating input soon reaches the bottom of the model's range, so
        # the path continues by raising the temperature (0.06 per 100 points), the other lever.
        T = min(1.5, T + 0.0006 * (ke[0] - u))
    return Settings(int(round(u)), round(c), round(c), round(T, 4), 1.0)


def run_ladder(model: str, threads: int = 2) -> dict:
    fit = json.loads((RESULTS / f"{model}.json").read_text())
    runner = Runner(model, threads)
    book = json.loads((RESULTS / "book.json").read_text())["openings"]
    lo, hi = RANGE[model]
    us = list(range(lo, hi + 1, STEP))
    settings = {u: path_settings(model, fit, u) for u in us}
    dest = RESULTS / f"ladder-{model}.json"
    done = {(r["low"], r["high"]): r for r in json.loads(dest.read_text())["pairings"]} if dest.exists() else {}
    rows = []
    for a, b in zip(us, us[1:]):
        row = done.get((a, b)) or run_pairing(runner, model, settings, a, b, book)
        rows.append(row)
        out = dict(
            model=model,
            model_sha256=runner.model_sha256,
            step=STEP,
            path={str(u): dict(eloSelf=s.elo_self, temperature=s.temperature) for u, s in settings.items()},
            pairings=rows,
        )
        dest.write_text(json.dumps(out, indent=1) + "\n")
    return apply_ladder(model)


def _elo_se(score: float, se: float) -> float:
    """Standard error of the Elo difference from a score and its standard error (delta method)."""
    s = min(max(score, 1e-3), 1 - 1e-3)
    return 400 / math.log(10) * se / (s * (1 - s))


def archive_round(model: str) -> Path | None:
    """Keep the last verification gauntlet as data for the next fit: each pairing gets the path
    points its two levels used. Returns the archive, or None when there was no gauntlet."""
    src = RESULTS / f"gauntlet-{model}.json"
    if not src.exists():
        return None
    fit = json.loads((RESULTS / f"{model}.json").read_text())
    where = {lv["level"]: lv["path"] for lv in fit["levels"]}
    g = json.loads(src.read_text())
    for r in g["pairings"]:
        r["low_path"], r["high_path"] = where[r["low"]], where[r["high"]]
    n = 1 + sum(1 for _ in RESULTS.glob(f"gauntlet-{model}-round*.json"))
    dest = RESULTS / f"gauntlet-{model}-round{n}.json"
    dest.write_text(json.dumps(g, indent=1) + "\n")
    src.unlink()
    return dest


def _observations(model: str, ladder: dict) -> list[tuple[float, float, float, float, str]]:
    """(path a, path b, Elo of b over a, its s.e., source) from the ladder and archived rounds."""
    obs = [(r["low"], r["high"], r["elo_diff"], _elo_se(r["score"], r["se"]), "ladder") for r in ladder["pairings"]]
    for f in sorted(RESULTS.glob(f"gauntlet-{model}-round*.json")):
        for r in json.loads(f.read_text())["pairings"]:
            obs.append((r["low_path"], r["high_path"], r["elo_diff"], _elo_se(r["score"], r["se"]), f.stem))
    return obs


def fit_scale(us: list[float], obs: list[tuple[float, float, float, float, str]], smooth_se: float = 60.0, min_step: float = 5.0):
    """E(u), piecewise linear between the ladder points with E(us[0]) = 0, from every measured Elo
    difference (weighted least squares, weights 1/se²), neighbouring steps tied loosely together
    (a difference between them costs as much as a measurement off by `smooth_se`) and every step
    at least `min_step` so the scale never reverses. Returns E at the points and its s.e."""
    n = len(us) - 1

    def row(u: float) -> np.ndarray:
        a = np.zeros(n)
        u = min(max(u, us[0]), us[-1])
        for j in range(n):
            if u >= us[j + 1]:
                a[j] = 1.0
            elif u > us[j]:
                a[j] = (u - us[j]) / (us[j + 1] - us[j])
        return a

    A = [row(b) - row(a) for a, b, _, _, _ in obs]
    y = [d for _, _, d, _, _ in obs]
    w = [1 / se for _, _, _, se, _ in obs]
    for j in range(n - 1):
        r = np.zeros(n)
        r[j], r[j + 1] = -1.0, 1.0
        A.append(r)
        y.append(0.0)
        w.append(1 / smooth_se)
    A, y, w = np.array(A), np.array(y), np.array(w)
    Aw, yw = A * w[:, None], y * w
    fixed = np.zeros(n, bool)
    delta = np.full(n, min_step)
    for _ in range(n + 1):
        free = ~fixed
        sol = np.linalg.lstsq(Aw[:, free], yw - Aw[:, fixed] @ delta[fixed], rcond=None)[0]
        delta[free] = sol
        low = free & (delta < min_step)
        if not low.any():
            break
        fixed |= low
        delta[fixed] = min_step
    cov = np.linalg.pinv(Aw.T @ Aw)
    E = np.concatenate([[0.0], np.cumsum(delta)])
    se = np.concatenate([[0.0], [math.sqrt(max(0.0, float(np.ones(j + 1) @ cov[: j + 1, : j + 1] @ np.ones(j + 1)))) for j in range(n)]])
    return E, se


def apply_ladder(model: str) -> dict:
    ladder = json.loads((RESULTS / f"ladder-{model}.json").read_text())
    fit = json.loads((RESULTS / f"{model}.json").read_text())
    rows = ladder["pairings"]
    us = [rows[0]["low"]] + [r["high"] for r in rows]
    obs = _observations(model, ladder)
    E, var_se = fit_scale(us, obs)
    inside = [i for i, u in enumerate(us) if ANCHOR[0] <= u <= ANCHOR[1]]
    k = float(np.mean([us[i] - E[i] for i in inside]))
    L = E + k
    step, floor = (100, 1100) if model == "maia2-rapid" else (50, 600)
    lo_l = max(floor, int(math.ceil(L[0] / step) * step))
    hi_l = min(2300, int(math.floor(L[-1] / step) * step))
    levels = []
    for level in range(lo_l, hi_l + 1, step):
        u = float(np.interp(level, L, us))
        s = path_settings(model, fit, u)
        levels.append(dict(level=level, eloSelf=s.elo_self, eloOppo=s.elo_oppo, temperature=s.temperature, topP=1.0, path=round(u, 1)))
    fit.setdefault("levels_human", fit["levels"])
    fit["levels"] = levels
    sources = sorted({o[4] for o in obs})
    fit["ladder"] = dict(
        step=STEP,
        anchor=list(ANCHOR),
        offset=round(k, 1),
        points=[dict(path=u, measured=round(float(L[i]), 1), se=round(float(var_se[i]), 1)) for i, u in enumerate(us)],
        stretch=round((us[-1] - us[0]) / (E[-1] - E[0]), 3),
        observations=len(obs),
        sources=sources,
    )
    tag = "; levels re-spaced by bot-vs-bot results (ladder), anchored to the human fit on average"
    if tag not in fit["method"]:
        fit["method"] += tag
    (RESULTS / f"{model}.json").write_text(json.dumps(fit, indent=1) + "\n")
    print(
        f"{model}: scale spans {E[-1] - E[0]:.0f} Elo over {us[-1] - us[0]} nominal points from {len(obs)} matches ({', '.join(sources)});"
        f" levels {levels[0]['level']}-{levels[-1]['level']} ({len(levels)})",
        flush=True,
    )
    return fit
