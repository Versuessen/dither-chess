"""Fit the Maia bots to human strength with fastelo's method (fastelo/calibrate.py), and check
fastelo's own published calibration on the same held-out positions.

fastelo's method: on Stockfish-analysed human positions of each 200-point band, the policy's
expected-score loss per move, sum over moves of p(move) * loss(move), must equal the loss of the
moves the humans of that band actually played.
  1. temperature T(e): with the rating input c = e, the T that matches each band; a continuous
     two-segment line through those (non-increasing, knot fitted) is the schedule;
  2. (mixing in a strong model: not used; no Maia has one)
  3. rating input c(e): with T(e) fixed, the input that matches each band, within +-300 of e.
Levels between band centres interpolate the input offset (flat beyond the end knots), exactly
as fastelo's settings() does, so the app's TableCalibration rows are that interpolation.

Maia-2 takes its rating input in 100-point buckets (<1100, 1100-1199, ..., >=2000), so step 3
has no continuous input to solve for. Deviation, closest faithful option: each level 1100-2000
uses its own bucket, and its temperature is solved directly so that the expected loss equals the
human loss at that rating (interpolated between band centres).

cache: logits of every analysed legal move, at every rating input of the grid, once per model.
"""

from __future__ import annotations

import json
import time

import chess
import numpy as np

from .analyse import load_analysis
from .paths import RESULTS, WORK
from .positions import BANDS
from .runner import Runner

T_MIN, T_MAX = 0.3, 1.5
MAX_CORRECTION = 300.0
GRIDS = {
    "fastelo": list(range(400, 2701, 100)),
    "maia3-5m": list(range(400, 2701, 100)),
    "maia3-23m": list(range(400, 2701, 100)),
    # one input per Maia-2 bucket: <1100, 1100-1199, ..., 1900-1999, >=2000
    "maia2-rapid": list(range(1000, 2001, 100)),
}
BATCH = 64


# ------------------------------------------------------------------------------ cache
def build_cache(model: str, threads: int = 2) -> None:
    out = WORK / f"cache-{model}.npz"
    table = load_analysis()
    runner = Runner(model, threads)
    grid = GRIDS[model]
    K = max(len(p["loss"]) for p in table)
    N = len(table)
    moves_idx = np.full((N, K), -1, np.int64)  # vocabulary index, -1 = padding or not expressible
    loss = np.full((N, K), np.nan, np.float32)
    pad = np.ones((N, K), bool)
    played_k = np.zeros(N, np.int64)
    feeds = []
    for i, p in enumerate(table):
        h = runner.history_of(p["moves"])
        b = h.board
        for k, (u, l) in enumerate(sorted(p["loss"].items())):
            moves_idx[i, k] = runner.move_index(b, chess.Move.from_uci(u))
            loss[i, k] = l
            pad[i, k] = False
            if u == p["played"]:
                played_k[i] = k
        feeds.append(runner.encode(h))
    logits = np.full((len(grid), N, K), -np.inf, np.float32)
    t0 = time.time()
    for g, e in enumerate(grid):
        for s in range(0, N, BATCH):
            policy, _ = runner.run(feeds[s : s + BATCH], [(e, e)] * len(feeds[s : s + BATCH]))
            mi = moves_idx[s : s + BATCH]
            got = np.take_along_axis(policy, np.maximum(mi, 0), 1)
            logits[g, s : s + BATCH] = np.where(mi >= 0, got, -np.inf)
        print(f"  {model}: input {e} done ({(g + 1) / len(grid) * 100:.0f}%, {time.time() - t0:.0f}s)", flush=True)
    np.savez_compressed(
        out,
        grid=np.array(grid, np.float64),
        logits=logits.astype(np.float16),
        loss=loss,
        pad=pad,
        played_k=played_k,
        elo=np.array([p["elo"] for p in table], np.float64),
        expressible=moves_idx >= 0,
        model_sha256=runner.model_sha256,
        variant=runner.variant,
    )
    print(f"wrote {out.name}: {N} positions x {len(grid)} inputs", flush=True)


# -------------------------------------------------------------------------------- fit
def _log_softmax(z: np.ndarray) -> np.ndarray:
    m = np.max(np.where(np.isfinite(z), z, -1e30), -1, keepdims=True)
    e = np.where(np.isfinite(z), np.exp(z - m), 0.0)
    return z - m - np.log(e.sum(-1, keepdims=True))


class Scorer:
    """Expected loss of the tempered policy on a set of positions (fastelo Scorer without mixing)."""

    def __init__(self, c: dict, sel: np.ndarray, discrete: bool = False) -> None:
        self.grid = c["grid"]
        self.act = _log_softmax(c["logits"][:, sel].astype(np.float64))  # [G, N, K]
        self.loss = np.nan_to_num(c["loss"][sel], nan=0.0)
        self.played = c["played_k"][sel]
        self.discrete = discrete

    def logp(self, elo_in: float, T: float) -> np.ndarray:
        x = float(np.clip(elo_in, self.grid[0], self.grid[-1]))
        if self.discrete:
            a = self.act[int(np.argmin(np.abs(self.grid - x)))]
        else:
            i = int(min(np.searchsorted(self.grid, x, "right") - 1, len(self.grid) - 2))
            t = (x - self.grid[i]) / (self.grid[i + 1] - self.grid[i])
            with np.errstate(invalid="ignore"):  # moves a model cannot express are -inf at every input
                a = (1 - t) * self.act[i] + t * self.act[i + 1]
        z = np.where(np.isfinite(a), a / T, -1e9)
        return _log_softmax(z)

    def expected_loss(self, elo_in: float, T: float) -> float:
        return float((np.exp(self.logp(elo_in, T)) * self.loss).sum(-1).mean())

    def likeness(self, elo_in: float, T: float) -> tuple[float, float]:
        lp = self.logp(elo_in, T)
        hit = float((lp.argmax(-1) == self.played).mean())
        return float(lp[np.arange(len(self.played)), self.played].mean()), hit


def fit_temperature(e, t, t_min=T_MIN, t_max=T_MAX) -> dict:
    """fastelo calibrate.fit_temperature with segments=2: continuous, non-increasing, knot searched every 25."""
    e, t = np.asarray(e, float), np.asarray(t, float)

    def lsq(knot):
        if knot is None:
            A = np.stack([np.ones_like(e), e - e[0]], 1)
            coef = np.linalg.lstsq(A, t, rcond=None)[0]
            coef = np.array([coef[0], min(coef[1], 0.0)])
            if coef[1] == 0.0:
                coef[0] = t.mean()
            return dict(knot=float(e[0]), value=float(coef[0]), slope_lo=float(coef[1]), slope_hi=float(coef[1])), float(((A @ coef - t) ** 2).sum())
        A = np.stack([np.ones_like(e), np.minimum(e - knot, 0), np.maximum(e - knot, 0)], 1)
        coef = np.linalg.lstsq(A, t, rcond=None)[0]
        for _ in range(2):
            free = [0] + [i for i in (1, 2) if coef[i] < 0]
            coef = np.zeros(3)
            coef[free] = np.linalg.lstsq(A[:, free], t, rcond=None)[0]
        return dict(knot=float(knot), value=float(coef[0]), slope_lo=float(coef[1]), slope_hi=float(coef[2])), float(((A @ coef - t) ** 2).sum())

    best = lsq(None)
    if len(e) >= 4:
        for k in np.arange(e[1], e[-2] + 1, 25.0):
            cand = lsq(k)
            if cand[1] < best[1]:
                best = cand
    return dict(best[0], t_min=t_min, t_max=t_max, rss=best[1])


def temperature_at(c: dict, e: float) -> float:
    d = e - c["knot"]
    return float(np.clip(c["value"] + (c["slope_lo"] if d < 0 else c["slope_hi"]) * d, c["t_min"], c["t_max"]))


def solve(f, target, lo, hi, increasing=True, iters=40):
    flo, fhi = f(lo), f(hi)
    if increasing and not (flo <= target <= fhi) or not increasing and not (fhi <= target <= flo):
        return None
    for _ in range(iters):
        mid = (lo + hi) / 2
        if (f(mid) < target) == increasing:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def isotonic(y: list[float], w: list[float]) -> list[float]:
    """Non-decreasing weighted least-squares fit (pool adjacent violators), as fastelo/response.py."""
    blocks = [[float(v), float(wt), 1] for v, wt in zip(y, w)]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] > blocks[i + 1][0] + 1e-12:
            a, b = blocks[i], blocks[i + 1]
            blocks[i : i + 2] = [[(a[0] * a[1] + b[0] * b[1]) / (a[1] + b[1]), a[1] + b[1], a[2] + b[2]]]
            i = max(i - 1, 0)
        else:
            i += 1
    return [v for v, _, n in blocks for _ in range(n)]


def _bands(c: dict, discrete: bool = False) -> list[dict]:
    elo = c["elo"]
    human_all = np.take_along_axis(np.nan_to_num(c["loss"], nan=0.0), c["played_k"][:, None], 1)[:, 0]
    out = []
    for lo, hi in BANDS:
        sel = (elo >= lo) & (elo < hi)
        if sel.sum() < 100:
            continue
        h = human_all[sel]
        out.append(
            dict(
                band=f"{lo}-{hi}",
                elo=(lo + hi) / 2,
                n=int(sel.sum()),
                human=float(h.mean()),
                human_se=float(h.std(ddof=1) / np.sqrt(len(h))),
                scorer=Scorer(c, sel, discrete),
            )
        )
    return out


def smooth_targets(bands: list[dict]) -> dict:
    """The human loss per band, smoothed: a weighted least-squares line through log(loss) against
    the band centre (weights 1/se² on the log scale). With 1000 positions per band, neighbouring
    bands differ by less than their standard errors in the middle of the range, and matching each
    band's raw value would let the rating inputs cross. The fitted curve is strictly decreasing.
    Each band gets b["target"]; returns the fit."""
    e = np.array([b["elo"] for b in bands])
    y = np.log([b["human"] for b in bands])
    w = np.array([(b["human"] / b["human_se"]) ** 2 for b in bands])  # se of log(loss) = se / loss
    A = np.stack([np.ones_like(e), e - 1500.0], 1)
    W = np.sqrt(w)[:, None]
    coef = np.linalg.lstsq(A * W, y * W[:, 0], rcond=None)[0]
    fitted = np.exp(A @ coef)
    for b, f in zip(bands, fitted):
        b["target"] = float(f)
        b["target_minus_human_se"] = (float(f) - b["human"]) / b["human_se"]
    chi2 = float((((np.log(fitted) - y) ** 2) * w).sum())
    return dict(form="log(loss) = a + b * (rating - 1500)", a=float(coef[0]), b=float(coef[1]), chi2=chi2, dof=len(bands) - 2)


def _clean(b: dict) -> dict:
    return {k: (round(v, 6) if isinstance(v, float) else v) for k, v in b.items() if k != "scorer"}


def fit_maia3(model: str) -> dict:
    c = dict(np.load(WORK / f"cache-{model}.npz"))
    bands = _bands(c)
    smooth = smooth_targets(bands)
    g = c["grid"]
    for b in bands:
        b["t_match"] = solve(lambda T: b["scorer"].expected_loss(b["elo"], T), b["target"], T_MIN, T_MAX)
    pts = np.array([(b["elo"], b["t_match"]) for b in bands if b["t_match"] is not None])
    if len(pts) < 2:
        raise SystemExit(f"{model}: no band can be matched by temperature alone")
    tcurve = fit_temperature(pts[:, 0], pts[:, 1])
    for b in bands:
        s, T = b["scorer"], temperature_at(tcurve, b["elo"])
        b["temperature"] = T
        lo_in = float(max(g[0], b["elo"] - MAX_CORRECTION))
        hi_in = float(min(g[-1], b["elo"] + MAX_CORRECTION))
        b["conditioning"] = solve(lambda x: s.expected_loss(x, T), b["target"], lo_in, hi_in, increasing=False)
        ci = b["conditioning"] if b["conditioning"] is not None else b["elo"]
        b["policy_loss"] = s.expected_loss(ci, T)
        b["raw_loss"] = s.expected_loss(b["elo"], 1.0)
        b["raw_logp"], b["raw_top1"] = s.likeness(b["elo"], 1.0)
        b["cal_logp"], b["cal_top1"] = s.likeness(ci, T)
    # A stronger target must never get a weaker input. The smoothed targets make crossings
    # unlikely; any that remain are removed by weighted isotonic regression (weights 1/se²).
    idx = [i for i, b in enumerate(bands) if b["conditioning"] is not None]
    mono = isotonic([bands[i]["conditioning"] for i in idx], [1 / bands[i]["human_se"] ** 2 for i in idx])
    for i, m in zip(idx, mono):
        b = bands[i]
        b["conditioning_raw"] = b["conditioning"]
        b["conditioning"] = m
        b["policy_loss"] = b["scorer"].expected_loss(m, b["temperature"])
        b["cal_logp"], b["cal_top1"] = b["scorer"].likeness(m, b["temperature"])
    for b in bands:
        b["gap_se"] = (b["policy_loss"] - b["human"]) / b["human_se"]
        b["gap_target"] = b["policy_loss"] - b["target"]
    knots = [dict(elo=b["elo"], conditioning=b["conditioning"], temperature=round(b["temperature"], 4)) for b in bands]
    solved = [k for k in knots if k["conditioning"] is not None]
    # Levels: every 50 points across the solved knots, plus half a band beyond each end (the
    # band's positions span +-100 around its centre); never outside 600-2300.
    lo_level = max(600, int(np.ceil((solved[0]["elo"] - 100) / 50) * 50))
    hi_level = min(2300, int(np.floor((solved[-1]["elo"] + 100) / 50) * 50))
    ke = [k["elo"] for k in solved]
    kd = [k["conditioning"] - k["elo"] for k in solved]
    levels = []
    for L in range(lo_level, hi_level + 1, 50):
        cond = float(L + np.interp(L, ke, kd))
        levels.append(dict(level=L, eloSelf=round(cond), eloOppo=round(cond), temperature=round(temperature_at(tcurve, L), 4), topP=1.0))
    return dict(
        model=model,
        method="fastelo calibrate.fit (expected-score loss per move matched to Lichess rapid humans, smoothed across bands), no strong-model mixing",
        human_fit=smooth,
        model_sha256=str(c["model_sha256"]),
        variant=str(c["variant"]),
        temperature_curve=tcurve,
        max_correction=MAX_CORRECTION,
        grid=[float(x) for x in g],
        knots=knots,
        bands=[_clean(b) for b in bands],
        levels=levels,
    )


def fit_maia2(model: str) -> dict:
    """fastelo's step 1 only: Maia-2's input is a 100-point bucket, so there is no continuous input
    for step 3. Each band's temperature is matched with the input in the band centre's bucket, a
    non-increasing two-segment line is fitted through those, and every level from 1100 uses its
    own bucket and the line's temperature. Levels whose band no temperature in [0.3, 1.5] can
    match are not offered."""
    c = dict(np.load(WORK / f"cache-{model}.npz"))
    bands = _bands(c, discrete=True)
    smooth = smooth_targets(bands)
    for b in bands:
        b["t_match"] = solve(lambda T: b["scorer"].expected_loss(b["elo"], T), b["target"], T_MIN, T_MAX)
        b["raw_loss"] = b["scorer"].expected_loss(b["elo"], 1.0)
        b["raw_logp"], b["raw_top1"] = b["scorer"].likeness(b["elo"], 1.0)
    pts = np.array([(b["elo"], b["t_match"]) for b in bands if b["t_match"] is not None])
    if len(pts) < 2:
        raise SystemExit(f"{model}: no band can be matched by temperature")
    tcurve = fit_temperature(pts[:, 0], pts[:, 1])
    for b in bands:
        b["temperature"] = temperature_at(tcurve, b["elo"])
        b["policy_loss"] = b["scorer"].expected_loss(b["elo"], b["temperature"])
        b["cal_logp"], b["cal_top1"] = b["scorer"].likeness(b["elo"], b["temperature"])
        b["gap_se"] = (b["policy_loss"] - b["human"]) / b["human_se"]
    levels = []
    rows = []
    for L in range(1100, 2001, 100):
        b = next(x for x in bands if x["elo"] - 100 <= L < x["elo"] + 100)
        ok = b["t_match"] is not None
        T = temperature_at(tcurve, L)
        rows.append(dict(level=L, band=b["band"], temperature=round(T, 4), offered=ok))
        if ok:
            levels.append(dict(level=L, eloSelf=L, eloOppo=L, temperature=round(T, 4), topP=1.0))
    return dict(
        model=model,
        method="fastelo calibrate.fit step 1 (temperature schedule matched to Lichess rapid humans, smoothed across bands); rating input = the level's own Maia-2 bucket",
        human_fit=smooth,
        model_sha256=str(c["model_sha256"]),
        variant=str(c["variant"]),
        temperature_curve=tcurve,
        grid=[float(x) for x in c["grid"]],
        bands=[_clean(b) for b in bands],
        per_level=rows,
        levels=levels,
    )


def check_fastelo() -> dict:
    """fastelo plays with its published calibration; measure it on our held-out positions."""
    from dither_models import refcode

    lite = refcode.fastelo("lite")
    c = dict(np.load(WORK / "cache-fastelo.npz"))
    runner = Runner("fastelo", 1)
    cal = runner.calibration
    assert cal is not None
    bands = _bands(c)
    smooth = smooth_targets(bands)
    for b in bands:
        cond, T, mix = lite.settings(cal, b["elo"])
        b["conditioning"], b["temperature"] = cond, T
        b["policy_loss"] = b["scorer"].expected_loss(cond, T)
        b["raw_loss"] = b["scorer"].expected_loss(b["elo"], 1.0)
        b["cal_logp"], b["cal_top1"] = b["scorer"].likeness(cond, T)
        b["gap_se"] = (b["policy_loss"] - b["human"]) / b["human_se"]
    return dict(
        model="fastelo",
        method="published calibration (fastelo calibration.json), measured on our held-out positions",
        human_fit=smooth,
        model_sha256=str(c["model_sha256"]),
        variant=str(c["variant"]),
        bands=[_clean(b) for b in bands],
    )


def fit(model: str) -> dict:
    if model == "fastelo":
        out = check_fastelo()
        dest = RESULTS / "fastelo-check.json"
    elif model == "maia2-rapid":
        out = fit_maia2(model)
        dest = RESULTS / f"{model}.json"
    else:
        out = fit_maia3(model)
        dest = RESULTS / f"{model}.json"
    dest.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {dest.name}", flush=True)
    for b in out["bands"]:
        print(
            f"  {b['band']:<10} human {100 * b['human']:5.2f}% (se {100 * b['human_se']:.2f}) target {100 * b.get('target', float('nan')):5.2f}%  raw {100 * b.get('raw_loss', float('nan')):5.2f}%"
            f"  policy {100 * b.get('policy_loss', float('nan')):5.2f}%  T {b.get('temperature', b.get('t_match'))}  c {b.get('conditioning')}",
            flush=True,
        )
    if out.get("levels"):
        print(f"  levels {out['levels'][0]['level']}-{out['levels'][-1]['level']} ({len(out['levels'])})", flush=True)
    return out
