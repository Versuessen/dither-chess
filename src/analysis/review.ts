/**
 * Game review maths, after Lichess (lila: WinPercent, AccuracyPercent and the advice
 * thresholds). Evaluations are centipawns from White's point of view, or a mate distance.
 * Everything here is pure: the engine (engine.ts) supplies the evaluations.
 */

import type { StoredEval } from '../storage/types';

/**
 * Centipawns (cp) or moves to mate (mate, positive when White mates), White's point of view; the
 * engine's best move and line; `result` for a position where the game is over.
 */
export type Eval = StoredEval;

export type Judgement = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveReview {
  ply: number;
  color: 'w' | 'b';
  san: string;
  uci: string;
  /** Win chance of the mover before and after the move, 0..100. */
  winBefore: number;
  winAfter: number;
  /** 0..100. */
  accuracy: number;
  /** Centipawns lost by the move (mover's view), capped at 1000. */
  cpLoss: number;
  judgement: Judgement;
  /** The engine's preferred move in the position before (UCI), and its SAN. */
  best: string | null;
  bestSan: string | null;
}

export interface SideSummary {
  accuracy: number;
  acpl: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  best: number;
  moves: number;
}

const CP_CEILING = 1000;

/** Centipawns clamped, with mates as ±(ceiling). */
export function cpOf(e: Pick<Eval, 'cp' | 'mate' | 'result'>): number {
  if (e.result) return e.result === '1-0' ? CP_CEILING : e.result === '0-1' ? -CP_CEILING : 0;
  if (e.mate !== null) return e.mate > 0 ? CP_CEILING : e.mate < 0 ? -CP_CEILING : 0;
  return Math.max(-CP_CEILING, Math.min(CP_CEILING, e.cp ?? 0));
}

/** White's winning chances in percent (lila WinPercent: 50 + 50 * (2 / (1 + e^(-0.00368208 cp)) - 1)). */
export function winPercent(e: Pick<Eval, 'cp' | 'mate' | 'result'>): number {
  const cp = cpOf(e);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Accuracy of one move from the mover's win% before and after (lila AccuracyPercent). */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (winBefore - winAfter)) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

/** Lichess advice thresholds on the drop in winning chances (on a -1..1 scale: 0.1 / 0.2 / 0.3). */
export function judge(winBefore: number, winAfter: number, playedBest: boolean): Judgement {
  if (playedBest) return 'best';
  const drop = (winBefore - winAfter) / 50;
  if (drop >= 0.3) return 'blunder';
  if (drop >= 0.2) return 'mistake';
  if (drop >= 0.1) return 'inaccuracy';
  return 'good';
}

export const JUDGEMENT_GLYPH: Record<Judgement, string> = { best: '★', good: '', inaccuracy: '?!', mistake: '?', blunder: '??' };

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Game accuracy per side, as lila's AccuracyPercent.gameAccuracy: the mean of a
 * volatility-weighted mean and the harmonic mean of the move accuracies.
 */
export function gameAccuracy(whiteWins: number[], moves: { color: 'w' | 'b'; accuracy: number }[]): Record<'w' | 'b', number | null> {
  const n = whiteWins.length;
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < size - 2 && windows.length < n - 1; i++) windows.push(whiteWins.slice(0, size));
  for (let i = 0; i + size <= n && windows.length < n - 1; i++) windows.push(whiteWins.slice(i, i + size));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));
  const out: Record<'w' | 'b', number | null> = { w: null, b: null };
  for (const c of ['w', 'b'] as const) {
    const pairs = moves.map((m, i) => ({ m, w: weights[i] ?? 1 })).filter((p) => p.m.color === c);
    if (!pairs.length) continue;
    const wsum = pairs.reduce((a, p) => a + p.w, 0);
    const weighted = pairs.reduce((a, p) => a + p.m.accuracy * p.w, 0) / wsum;
    const harmonic = pairs.length / pairs.reduce((a, p) => a + 1 / Math.max(p.m.accuracy, 1), 0);
    out[c] = (weighted + harmonic) / 2;
  }
  return out;
}

/**
 * Review a game from the evaluation of every position: evals[0] is the start position,
 * evals[i] the position after move i.
 */
export function review(
  moves: readonly { color: 'w' | 'b'; san: string; uci: string }[],
  evals: readonly Eval[],
  sanOf: (ply: number, uci: string) => string | null
): { moves: MoveReview[]; sides: Record<'w' | 'b', SideSummary> } {
  const whiteWins = evals.map(winPercent);
  const out: MoveReview[] = moves.map((m, i) => {
    const before = evals[i]!;
    const after = evals[i + 1]!;
    const sign = m.color === 'w' ? 1 : -1;
    const winBefore = m.color === 'w' ? whiteWins[i]! : 100 - whiteWins[i]!;
    const winAfter = m.color === 'w' ? whiteWins[i + 1]! : 100 - whiteWins[i + 1]!;
    const cpLoss = Math.max(0, Math.min(CP_CEILING, sign * (cpOf(before) - cpOf(after))));
    const playedBest = before.best === m.uci;
    return {
      ply: i + 1,
      color: m.color,
      san: m.san,
      uci: m.uci,
      winBefore,
      winAfter,
      accuracy: playedBest ? 100 : moveAccuracy(winBefore, winAfter),
      cpLoss: playedBest ? 0 : cpLoss,
      judgement: judge(winBefore, winAfter, playedBest),
      best: before.best,
      bestSan: before.best ? sanOf(i, before.best) : null
    };
  });
  const acc = gameAccuracy(whiteWins, out);
  const side = (c: 'w' | 'b'): SideSummary => {
    const mine = out.filter((m) => m.color === c);
    return {
      accuracy: Math.round((acc[c] ?? 0) * 10) / 10,
      acpl: Math.round(mean(mine.map((m) => m.cpLoss))),
      inaccuracies: mine.filter((m) => m.judgement === 'inaccuracy').length,
      mistakes: mine.filter((m) => m.judgement === 'mistake').length,
      blunders: mine.filter((m) => m.judgement === 'blunder').length,
      best: mine.filter((m) => m.judgement === 'best').length,
      moves: mine.length
    };
  };
  return { moves: out, sides: { w: side('w'), b: side('b') } };
}

/** "+1.4", "−0.3", "#3", "#−2" for an evaluation bar or graph label. */
export function formatEval(e: Pick<Eval, 'cp' | 'mate' | 'result'>): string {
  if (e.result) return e.result === '1/2-1/2' ? '½-½' : e.result;
  if (e.mate !== null) return e.mate === 0 ? '#' : `#${e.mate < 0 ? '−' : ''}${Math.abs(e.mate)}`;
  const v = (e.cp ?? 0) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
}
