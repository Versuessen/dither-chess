import { describe, expect, it } from 'vitest';
import { formatEval, gameAccuracy, judge, moveAccuracy, review, winPercent, type Eval } from './review';
import { lineSan, sanIn, terminal } from './analyse';

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
    expect(judge(50, 47, false)).toBe('good');
    expect(judge(50, 44, false)).toBe('inaccuracy');
    expect(judge(50, 39, false)).toBe('mistake');
    expect(judge(50, 34, false)).toBe('blunder');
    expect(judge(50, 10, true)).toBe('best');
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
      (_ply, uci) => uci
    );
    expect(r.moves.map((m) => m.judgement)).toEqual(['best', 'blunder', 'best']);
    expect(r.moves[1]!.cpLoss).toBe(320);
    expect(r.moves[1]!.bestSan).toBe('e7e5');
    expect(r.sides.b.blunders).toBe(1);
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
