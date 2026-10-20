import { describe, expect, it } from 'vitest';
import { betterSide, classify, formatEval, gameAccuracy, judge, moveAccuracy, review, winPercent, type Eval } from './review';
import { forced, lineSan, sacrifice, sanIn, terminal } from './analyse';
import { bookPlies } from '../chess/openings';

const ev = (cp: number, best: string | null = null): Eval => ({ cp, mate: null, best, pv: [], depth: 14 });
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('win percent and accuracy (after lila)', () => {
  it('maps centipawns to winning chances', () => {
    expect(winPercent(ev(0))).toBeCloseTo(50, 6);
    expect(winPercent(ev(300))).toBeGreaterThan(75);
    expect(winPercent(ev(-300))).toBeCloseTo(100 - winPercent(ev(300)), 6);
    expect(winPercent({ cp: null, mate: 3 })).toBe(winPercent(ev(1000)));
    expect(winPercent({ cp: null, mate: null, result: '0-1' })).toBe(winPercent(ev(-1000)));
  });

  it('scores a move by the winning chances it gives away', () => {
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(60, 70)).toBe(100);
    expect(moveAccuracy(60, 55)).toBeGreaterThan(80);
    expect(moveAccuracy(80, 20)).toBeLessThan(10);
  });

  it('uses the Lichess thresholds for inaccuracies, mistakes and blunders', () => {
    expect(judge(50, 49, false)).toBe('excellent');
    expect(judge(50, 47, false)).toBe('good');
    expect(judge(50, 44, false)).toBe('inaccuracy');
    expect(judge(50, 39, false)).toBe('mistake');
    expect(judge(50, 34, false)).toBe('blunder');
    expect(judge(50, 10, true)).toBe('best');
  });

  it('classifies book, forced, brilliant and decided moves', () => {
    expect(classify(50, 49, false, { book: true })).toBe('book');
    // Theory the engine calls an error is judged as an error.
    expect(classify(50, 30, false, { book: true })).toBe('blunder');
    expect(classify(50, 50, true, { forced: true })).toBe('neutral');
    expect(classify(60, 61, true, { sacrifice: true })).toBe('brilliant');
    // The engine's own sacrifice counts even in a won game (a mating combination)...
    expect(classify(99, 100, true, { sacrifice: true })).toBe('brilliant');
    // ...a near-best one only while the game is open, and never one that leaves it worse than level.
    expect(classify(96, 95, false, { sacrifice: true })).toBe('excellent');
    expect(classify(40, 40, true, { sacrifice: true })).toBe('best');
    // A won game stays won: no credit, no blame, unless the move throws it away.
    expect(classify(99, 98, false)).toBe('neutral');
    expect(classify(99, 99, true)).toBe('best');
    expect(classify(99, 60, false)).toBe('blunder');
  });

  it('weights accuracy over the game per side', () => {
    const acc = gameAccuracy([50, 50, 50, 50], [
      { color: 'w', accuracy: 100 },
      { color: 'b', accuracy: 50 },
      { color: 'w', accuracy: 100 }
    ]);
    expect(acc.w).toBeCloseTo(100, 6);
    expect(acc.b).toBeCloseTo(50, 6);
  });

  it('reviews a game from its evaluations', () => {
    // White plays the best move, Black then gives away a piece's worth, White plays on.
    const evals = [ev(30, 'e2e4'), ev(30, 'e7e5'), ev(350, 'g1f3'), ev(340, 'a2a3')];
    const r = review(
      [
        { color: 'w', san: 'e4', uci: 'e2e4' },
        { color: 'b', san: 'Qh4', uci: 'd8h4' },
        { color: 'w', san: 'Nf3', uci: 'g1f3' }
      ],
      evals,
      { sanOf: (_ply, uci) => uci }
    );
    expect(r.moves.map((m) => m.judgement)).toEqual(['best', 'blunder', 'best']);
    expect(r.moves[1]!.cpLoss).toBe(320);
    expect(r.moves[1]!.bestSan).toBe('e7e5');
    expect(r.sides.b.counts.blunder).toBe(1);
    expect(r.sides.w.counts.best).toBe(2);
    expect(betterSide(r.sides, 'blunder')).toBe('w');
    expect(betterSide(r.sides, 'best')).toBe('w');
    expect(betterSide(r.sides, 'accuracy')).toBe('w');
    expect(betterSide(r.sides, 'mistake')).toBeNull();
    expect(betterSide(r.sides, 'book')).toBeNull();
    expect(r.sides.w.accuracy).toBeGreaterThan(r.sides.b.accuracy);
    expect(r.sides.w.acpl).toBe(0);
  });

  it('formats evaluations', () => {
    expect(formatEval(ev(134))).toBe('+1.3');
    expect(formatEval(ev(-30))).toBe('−0.3');
    expect(formatEval({ cp: null, mate: -2 })).toBe('#−2');
    expect(formatEval({ cp: null, mate: null, result: '1-0' })).toBe('1-0');
  });
});

describe('chess facts', () => {
  it('finds sacrifices', () => {
    // Greek gift: Bxh7+ gives the bishop for a pawn (Kxh7 and nothing takes back).
    const greek = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8';
    expect(sacrifice(greek, 'd3h7')).toBe(true);
    // A quiet developing move gives nothing away; a trade is not a sacrifice.
    expect(sacrifice(START, 'g1f3')).toBe(false);
    expect(sacrifice('rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3', 'f3e5')).toBe(false);
    // Putting the queen where a pawn takes it.
    expect(sacrifice('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'd1g4')).toBe(false);
    expect(sacrifice('rnbqkbnr/ppp2ppp/8/3pp3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'd1h5')).toBe(false);
    expect(sacrifice('rnbqkbnr/ppp2ppp/8/3pp3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'd1g4')).toBe(true);
  });

  it('finds forced moves and the book part of a game', () => {
    expect(forced('1r6/8/8/8/8/2k5/8/K7 w - - 0 1')).toBe(true);
    expect(forced(START)).toBe(false);
    const table = new Map([
      ['rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -', ['B00', "King's Pawn Game"] as const],
      ['rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -', ['C40', "King's Knight Opening"] as const]
    ]);
    const fens = [
      START,
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
      'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
    ];
    expect(bookPlies(table, fens)).toBe(3);
    expect(bookPlies(table, fens.slice(0, 1))).toBe(0);
  });
});

describe('positions', () => {
  it('recognises finished positions and writes moves as SAN', () => {
    // Fool's mate: White is mated.
    expect(terminal('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')?.result).toBe('0-1');
    expect(terminal('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')?.result).toBe('1/2-1/2');
    expect(terminal(START)).toBeNull();
    expect(sanIn(START, 'g1f3')).toBe('Nf3');
    expect(sanIn(START, 'e2e5')).toBeNull();
    expect(lineSan(START, ['e2e4', 'e7e5', 'g1f3', 'zzzz'])).toBe('e4 e5 Nf3');
  });
});
