/**
 * Game review maths, after Lichess (lila: WinPercent, AccuracyPercent and the advice
 * thresholds), with the finer move classes players know from chess.com (brilliant, excellent,
 * good, book). Evaluations are centipawns from White's point of view, or a mate distance.
 * Everything here is pure: the engine (engine.ts) supplies the evaluations and analyse.ts the
 * chess facts (sacrifices, forced moves, book).
 */

import type { StoredEval } from '../storage/types';

/**
 * Centipawns (cp) or moves to mate (mate, positive when White mates), White's point of view; the
 * engine's best move and line; `result` for a position where the game is over.
 */
export type Eval = StoredEval;

/** Move classes, best first (the order of the review summary). */
export const JUDGEMENTS = ['brilliant', 'excellent', 'best', 'good', 'book', 'neutral', 'inaccuracy', 'mistake', 'blunder'] as const;
export type Judgement = (typeof JUDGEMENTS)[number];

/** For each class, whether more of it is better (true), worse (false), or neither (null). */
export const MORE_IS_BETTER: Record<Judgement, boolean | null> = {
  brilliant: true,
  excellent: true,
  best: true,
  good: true,
  book: null,
  neutral: null,
  inaccuracy: false,
  mistake: false,
  blunder: false
};

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
  /** Moves in each class. */
  counts: Record<Judgement, number>;
  moves: number;
}

/** What the engine cannot say about a move: supplied by analyse.ts from the positions. */
export interface MoveFacts {
  /** SAN of a UCI move in the position before move `ply` (0-based). */
  sanOf(ply: number, uci: string): string | null;
  /** The move at `ply` (0-based) gives up material (see analyse.ts sacrifice). */
  sacrifice?(ply: number): boolean;
  /** The move at `ply` (0-based) was the only legal move. */
  forced?(ply: number): boolean;
  /** The first `book` moves of the game are opening theory. */
  book?: number;
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

/** Win-chance drops (mover's view, percentage points): Lichess's advice thresholds, and finer
 * bands for the good moves. */
export const THRESHOLDS = { excellent: 2, good: 5, inaccuracy: 5, mistake: 10, blunder: 15 } as const;

/** A position whose result no longer depends on the move: mover's win chance this high or low. */
const DECIDED = 97;

/**
 * Classify a move from the mover's win chances before and after it. `playedBest`: it is the
 * engine's move. Sacrifices, forced moves and book moves are classified by `classify`.
 */
export function judge(winBefore: number, winAfter: number, playedBest: boolean): Judgement {
  if (playedBest) return 'best';
  const drop = winBefore - winAfter;
  if (drop >= THRESHOLDS.blunder) return 'blunder';
  if (drop >= THRESHOLDS.mistake) return 'mistake';
  if (drop >= THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (drop < THRESHOLDS.excellent) return 'excellent';
  return 'good';
}

/**
 * The full classification. The only legal move is neutral (book in the opening); opening theory
 * is book unless the engine calls it an error; a sound sacrifice (the engine's move, or nearly
 * it in an open game) that keeps the game at least level is brilliant; any other move in a game already decided either way is neutral
 * (unless it throws the result away); otherwise `judge`.
 */
export function classify(
  winBefore: number,
  winAfter: number,
  playedBest: boolean,
  facts: { book?: boolean; forced?: boolean; sacrifice?: boolean } = {}
): Judgement {
  if (facts.forced) return facts.book ? 'book' : 'neutral';
  const engine = judge(winBefore, winAfter, playedBest);
  const error = engine === 'inaccuracy' || engine === 'mistake' || engine === 'blunder';
  // Theory, unless the engine finds it a real error (the tables name a few traps too).
  if (facts.book && !error) return 'book';
  const drop = winBefore - winAfter;
  // A sacrifice is brilliant when it is the engine's own move, or close to it while the game
  // was still open, and the mover is not worse after it.
  if (facts.sacrifice && winAfter >= 50 && (playedBest || (drop < THRESHOLDS.excellent && winBefore < 95))) return 'brilliant';
  const decided = (winBefore >= DECIDED && winAfter >= DECIDED) || (winBefore <= 100 - DECIDED && winAfter <= 100 - DECIDED);
  if (decided && !playedBest) return 'neutral';
  return engine;
}

export const JUDGEMENT_GLYPH: Record<Judgement, string> = {
  brilliant: '!!',
  excellent: '!',
  best: '★',
  good: '✓',
  book: '≡',
  neutral: '·',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??'
};

export const JUDGEMENT_LABEL: Record<Judgement, string> = {
  brilliant: 'Brilliant',
  excellent: 'Excellent',
  best: 'Best',
  good: 'Good',
  book: 'Book',
  neutral: 'Neutral',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder'
};

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
  facts: MoveFacts
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
      judgement: classify(winBefore, winAfter, playedBest, {
        book: i < (facts.book ?? 0),
        forced: facts.forced?.(i) ?? false,
        sacrifice: facts.sacrifice?.(i) ?? false
      }),
      best: before.best,
      bestSan: before.best ? facts.sanOf(i, before.best) : null
    };
  });
  const acc = gameAccuracy(whiteWins, out);
  const side = (c: 'w' | 'b'): SideSummary => {
    const mine = out.filter((m) => m.color === c);
    const counts = Object.fromEntries(JUDGEMENTS.map((j) => [j, mine.filter((m) => m.judgement === j).length])) as Record<Judgement, number>;
    return {
      accuracy: Math.round((acc[c] ?? 0) * 10) / 10,
      acpl: Math.round(mean(mine.map((m) => m.cpLoss))),
      counts,
      moves: mine.length
    };
  };
  return { moves: out, sides: { w: side('w'), b: side('b') } };
}

/**
 * Which side did better on a summary line: 'w', 'b', or null for a tie or a class that is
 * neither good nor bad. `stat` is a move class or 'accuracy'.
 */
export function betterSide(sides: Record<'w' | 'b', SideSummary>, stat: Judgement | 'accuracy'): 'w' | 'b' | null {
  const higher = stat === 'accuracy' ? true : MORE_IS_BETTER[stat];
  if (higher === null) return null;
  const w = stat === 'accuracy' ? sides.w.accuracy : sides.w.counts[stat];
  const b = stat === 'accuracy' ? sides.b.accuracy : sides.b.counts[stat];
  if (w === b) return null;
  return (w > b) === higher ? 'w' : 'b';
}

/** "+1.4", "−0.3", "#3", "#−2" for an evaluation bar or graph label. */
export function formatEval(e: Pick<Eval, 'cp' | 'mate' | 'result'>): string {
  if (e.result) return e.result === '1/2-1/2' ? '½-½' : e.result;
  if (e.mate !== null) return e.mate === 0 ? '#' : `#${e.mate < 0 ? '−' : ''}${Math.abs(e.mate)}`;
  const v = (e.cp ?? 0) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
}
