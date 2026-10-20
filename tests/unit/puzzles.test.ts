import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Chess } from 'chess.js';
import { PUZZLE_FILE, THEMES, hasTheme, parsePuzzles, themesOf, type Puzzle } from '../../src/puzzles/data';
import { DEFAULT_FILTERS, RECENT_MS, matching, pickPuzzle, sanitizeFilters } from '../../src/puzzles/filters';
import { PuzzleRun } from '../../src/puzzles/run';
import { introFor, mateIn } from '../../src/puzzles/intro';
import { ratingChange, sanitizeProgress } from '../../src/puzzles/progress.svelte';

const bits = (...ts: (typeof THEMES)[number][]) => ts.reduce((a, t) => a | (1 << THEMES.indexOf(t)), 0);

const all = parsePuzzles(gunzipSync(readFileSync(`public/${PUZZLE_FILE}`)).toString('utf8'));

describe('the shipped puzzle set', () => {
  it('has tens of thousands of puzzles across every difficulty and key piece', () => {
    expect(all.length).toBeGreaterThan(40_000);
    for (const [lo, hi] of [
      [0, 1250],
      [1250, 1650],
      [1650, 2050],
      [2050, 9999]
    ]) {
      const band = all.filter((p) => p.rating >= lo! && p.rating < hi!);
      expect(band.length, `${lo}-${hi}`).toBeGreaterThan(10_000);
      for (const piece of 'PNBRQK') expect(band.filter((p) => p.piece === piece).length, `${lo} ${piece}`).toBeGreaterThan(800);
    }
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  });

  it('has legal solutions whose first solver move is made by the key piece', () => {
    // Every 25th puzzle: replay the whole line.
    for (let i = 0; i < all.length; i += 25) {
      const p = all[i]!;
      const c = new Chess(p.fen);
      for (const [k, uci] of p.moves.entries()) {
        const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
        if (k === 1) expect(m.piece.toUpperCase(), p.id).toBe(p.piece);
      }
      if (hasTheme(p, 'mate')) expect(c.isCheckmate(), p.id).toBe(true);
    }
  });
});

const sample: Puzzle[] = [
  // Back-rank mate in one for White after Black's ...Qa2.
  { id: 'a1', fen: '6k1/5ppp/8/8/8/8/1q3PPP/3R2K1 b - - 0 1', moves: ['b2a2', 'd1d8'], rating: 900, themes: bits('mate', 'mateIn1', 'endgame', 'backRankMate', 'oneMove'), piece: 'R' },
  { id: 'a2', fen: '6k1/5ppp/8/8/8/8/1q3PPP/3R2K1 b - - 0 1', moves: ['b2a2', 'd1d8'], rating: 1500, themes: bits('crushing', 'middlegame', 'fork', 'short'), piece: 'N' },
  { id: 'a3', fen: '6k1/5ppp/8/8/8/8/1q3PPP/3R2K1 b - - 0 1', moves: ['b2a2', 'd1d8'], rating: 2200, themes: bits('advantage', 'endgame', 'pin'), piece: 'R' }
];

describe('choosing puzzles', () => {
  it('filters by difficulty, piece, phase and motif', () => {
    expect(matching(sample, { ...DEFAULT_FILTERS, difficulty: 'simple' }, 1500).map((p) => p.id)).toEqual(['a1']);
    expect(matching(sample, { ...DEFAULT_FILTERS, difficulty: 'extreme' }, 1500).map((p) => p.id)).toEqual(['a3']);
    expect(matching(sample, { ...DEFAULT_FILTERS, difficulty: 'any', piece: 'R' }, 1500).map((p) => p.id)).toEqual(['a1', 'a3']);
    expect(matching(sample, { ...DEFAULT_FILTERS, difficulty: 'any', phase: 'endgame' }, 1500).map((p) => p.id)).toEqual(['a1', 'a3']);
    expect(matching(sample, { ...DEFAULT_FILTERS, difficulty: 'any', motif: 'fork' }, 1500).map((p) => p.id)).toEqual(['a2']);
    expect(matching(sample, { ...DEFAULT_FILTERS, difficulty: 'any', motif: 'mate' }, 1500).map((p) => p.id)).toEqual(['a1']);
  });

  it('"your level" stays near the rating, and finds enough in the real set', () => {
    const pool = matching(all, DEFAULT_FILTERS, 1500);
    expect(pool.length).toBeGreaterThan(1000);
    expect(pool.every((p) => Math.abs(p.rating - 1500) <= 150)).toBe(true);
    const knightEndgames = matching(all, { difficulty: 'level', piece: 'N', phase: 'endgame', motif: 'any' }, 2400);
    expect(knightEndgames.length).toBeGreaterThanOrEqual(40);
  });

  it('avoids puzzles played recently, then falls back to the one played longest ago', () => {
    const now = 1e12;
    const played = new Map([
      ['a1', now - 1000],
      ['a2', now - RECENT_MS - 1]
    ]);
    for (let i = 0; i < 20; i++) expect(pickPuzzle(sample.slice(0, 2), played, now, Math.random)!.id).toBe('a2');
    const allRecent = new Map([
      ['a1', now - 5000],
      ['a2', now - 1000]
    ]);
    expect(pickPuzzle(sample.slice(0, 2), allRecent, now)!.id).toBe('a1');
    // Never the same puzzle twice in a row when there is another.
    expect(pickPuzzle(sample, new Map(), now, () => 0, 'a1')!.id).toBe('a2');
  });

  it('keeps only known filter values', () => {
    expect(sanitizeFilters({ difficulty: 'hard', piece: 'X', phase: 'endgame', motif: 'nope' })).toEqual({ ...DEFAULT_FILTERS, difficulty: 'hard', phase: 'endgame' });
  });
});

describe('solving', () => {
  it('plays the opponent move, accepts the solution and rejects other moves', () => {
    const run = new PuzzleRun(sample[1]!);
    expect(run.solver).toBe('w');
    expect(run.opponentMove()).toBe('Qa2');
    expect(run.expected).toBe('d1d8');
    expect(run.tryMove('g2g3')).toBe('wrong');
    expect(run.fen.split(' ')[0]).toBe('6k1/5ppp/8/8/8/8/q4PPP/3R2K1');
    expect(run.tryMove('d1d8')).toBe('solved');
    expect(run.done).toBe(true);
  });

  it('accepts any mate as the last move', () => {
    // White mates with either rook on the eighth rank; the listed move is Rd8#.
    const p: Puzzle = { id: 'm', fen: '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 b - - 0 1', moves: ['g8h8', 'd1d8'], rating: 1000, themes: bits('mate', 'mateIn1'), piece: 'R' };
    const run = new PuzzleRun(p);
    run.opponentMove();
    expect(run.tryMove('a1a8')).toBe('solved');
  });

  it('promotes as the solution expects', () => {
    const p: Puzzle = { id: 'u', fen: '8/P7/8/8/8/k7/8/2K5 b - - 0 1', moves: ['a3b3', 'a7a8n'], rating: 1000, themes: bits('promotion'), piece: 'P' };
    const run = new PuzzleRun(p);
    run.opponentMove();
    expect(run.promotionFor('a7', 'a8')).toBe('n');
    expect(run.promotionFor('c1', 'c2')).toBeUndefined();
  });
});

describe('introductions', () => {
  it('names the goal, not the motif', () => {
    expect(introFor(sample[0]!, 'w', 'Qb1')).toBe('Black just played Qb1. White can mate in one: find it.');
    const m3 = { themes: bits('mate', 'mateIn3'), moves: ['a', 'b', 'c', 'd', 'e', 'f'] };
    expect(introFor(m3, 'b', 'Nf3')).toBe('After Nf3, Black has mate in three. Can you find it?');
    expect(mateIn(m3)).toBe(3);
    const crushing = { themes: bits('crushing', 'middlegame', 'fork'), moves: ['a', 'b', 'c', 'd'] };
    const text = introFor(crushing, 'w', 'Bxe4');
    expect(text).toContain('White to move and win');
    expect(text).toContain('two moves');
    expect(text.toLowerCase()).not.toContain('fork');
    expect(introFor({ themes: bits('defensiveMove'), moves: ['a', 'b'] }, 'b', 'Qh5')).toContain("Black's best defence");
  });
});

describe('puzzle rating and progress', () => {
  it('moves the rating like Elo against the puzzle rating', () => {
    expect(ratingChange(1500, 1500, 'solved', 0)).toBe(20);
    expect(ratingChange(1500, 1500, 'failed', 30)).toBe(-10);
    expect(ratingChange(1500, 1900, 'solved', 30)).toBeGreaterThan(15);
    expect(ratingChange(1500, 1500, 'assisted', 0)).toBe(0);
  });

  it('reads stored progress defensively', () => {
    const p = sanitizeProgress({ rating: 'x', solved: 3, history: [{ id: 'a', at: 1, result: 'solved' }, { id: 2 }], filters: { motif: 'pin' } });
    expect(p.rating).toBe(1500);
    expect(p.solved).toBe(3);
    expect(p.history).toEqual([{ id: 'a', at: 1, result: 'solved' }]);
    expect(p.filters.motif).toBe('pin');
    expect(themesOf({ themes: bits('pin', 'endgame') })).toEqual(['endgame', 'pin']);
  });
});
