/**
 * Puzzle progress, kept in AppStorage's settings (and so in backups): a puzzle rating, counts,
 * the current streak, the chosen filters, and when each recent puzzle was played (so the pick can
 * avoid repeats).
 */
import { storage } from '../storage';
import { DEFAULT_FILTERS, sanitizeFilters, type Filters } from './filters';

export type PuzzleResult = 'solved' | 'failed' | 'assisted';

export interface PuzzleProgress {
  /** Elo-style puzzle rating, against the puzzles' Lichess ratings. */
  rating: number;
  solved: number;
  failed: number;
  streak: number;
  filters: Filters;
  /** Most recent last; capped at HISTORY_MAX. */
  history: { id: string; at: number; result: PuzzleResult }[];
}

const KEY = 'puzzles';
export const START_RATING = 1500;
const HISTORY_MAX = 4000;

export function emptyProgress(): PuzzleProgress {
  return { rating: START_RATING, solved: 0, failed: 0, streak: 0, filters: { ...DEFAULT_FILTERS }, history: [] };
}

export function sanitizeProgress(v: unknown): PuzzleProgress {
  const p = emptyProgress();
  if (!v || typeof v !== 'object') return p;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  p.rating = Math.round(Math.max(400, Math.min(3200, num(o.rating, START_RATING))));
  p.solved = Math.max(0, Math.floor(num(o.solved, 0)));
  p.failed = Math.max(0, Math.floor(num(o.failed, 0)));
  p.streak = Math.max(0, Math.floor(num(o.streak, 0)));
  p.filters = sanitizeFilters(o.filters);
  if (Array.isArray(o.history)) {
    p.history = o.history
      .filter(
        (h): h is PuzzleProgress['history'][number] =>
          !!h && typeof h.id === 'string' && typeof h.at === 'number' && (h.result === 'solved' || h.result === 'failed' || h.result === 'assisted')
      )
      .slice(-HISTORY_MAX);
  }
  return p;
}

/**
 * The rating change for one puzzle: Elo against the puzzle's rating, K 40 for the first 20
 * rated puzzles, then 20. Assisted attempts (hint or solution) do not count.
 */
export function ratingChange(rating: number, puzzleRating: number, result: PuzzleResult, played: number): number {
  if (result === 'assisted') return 0;
  const k = played < 20 ? 40 : 20;
  const expected = 1 / (1 + 10 ** ((puzzleRating - rating) / 400));
  return Math.round(k * ((result === 'solved' ? 1 : 0) - expected));
}

class PuzzleStore {
  value = $state<PuzzleProgress>(emptyProgress());

  async load(): Promise<void> {
    this.value = sanitizeProgress(await storage().getSetting(KEY));
  }

  private async save(): Promise<void> {
    await storage().setSetting(KEY, $state.snapshot(this.value));
  }

  /** When each puzzle was last played. */
  lastPlayed(): Map<string, number> {
    return new Map(this.value.history.map((h) => [h.id, h.at]));
  }

  async setFilters(f: Filters): Promise<void> {
    this.value = { ...this.value, filters: f };
    await this.save();
  }

  /** Record an attempt; returns the rating change. */
  async record(id: string, puzzleRating: number, result: PuzzleResult, now = Date.now()): Promise<number> {
    const v = this.value;
    const rated = v.solved + v.failed;
    const delta = ratingChange(v.rating, puzzleRating, result, rated);
    this.value = {
      ...v,
      rating: v.rating + delta,
      solved: v.solved + (result === 'solved' ? 1 : 0),
      failed: v.failed + (result === 'failed' ? 1 : 0),
      streak: result === 'solved' ? v.streak + 1 : 0,
      history: [...v.history, { id, at: now, result }].slice(-HISTORY_MAX)
    };
    await this.save();
    return delta;
  }
}

export const puzzles = new PuzzleStore();
