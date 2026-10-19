import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../src/storage/memory';
import { humanScore, rating, ratingLabel } from '../../src/rating/rating.svelte';
import type { StoredGame } from '../../src/storage/types';

function finished(id: string, result: '1-0' | '0-1' | '1/2-1/2' | '*', rated = true, endedAt = '2026-10-05T10:00:00Z'): StoredGame {
  return {
    id,
    startedAt: endedAt,
    endedAt,
    persona: 'grinder',
    botName: 'Grinder',
    family: 'fastelo',
    pack: 'fastelo-7m',
    packSha256: 'x',
    botLevel: 1500,
    humanColor: 'w',
    timeControl: { base: 900, increment: 10 },
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [],
    outcome:
      result === '*'
        ? { result, termination: 'aborted', winner: null }
        : result === '1/2-1/2'
          ? { result, termination: 'agreement', winner: null }
          : { result, termination: 'checkmate', winner: result === '1-0' ? 'w' : 'b' },
    rated,
    takebacks: 0,
    seed: 1,
    pgn: ''
  } as StoredGame;
}

describe('rating store', () => {
  it('scores games from the human side', () => {
    expect(humanScore(finished('a', '1-0'))).toBe(1);
    expect(humanScore(finished('a', '0-1'))).toBe(0);
    expect(humanScore(finished('a', '1/2-1/2'))).toBe(0.5);
    expect(humanScore(finished('a', '*'))).toBeNull();
  });

  it('appends each rated game once and ignores casual and aborted games', async () => {
    const s = new MemoryStorage();
    await s.init();
    await rating.load(s);
    await rating.record(finished('g1', '1-0'));
    await rating.record(finished('g1', '1-0')); // the same game again (e.g. settled at start-up)
    await Promise.all([rating.record(finished('g2', '1/2-1/2')), rating.record(finished('g2', '1/2-1/2'))]);
    await rating.record(finished('g3', '1-0', false));
    await rating.record(finished('g4', '*'));
    const ledger = await s.listLedger();
    expect(ledger.map((e) => (e.kind === 'game' ? e.gameId : e.kind))).toEqual(['g1', 'g2']);
    expect(ledger[0]).toMatchObject({ kind: 'game', opponentRating: 1500, score: 1 });
    expect(ledger[1]!.kind === 'game' && ledger[1]!.snapshot).toMatchObject({ published: null });
  });

  it('records setting changes in the ledger and previews their effect', async () => {
    const s = new MemoryStorage();
    await s.init();
    await rating.load(s);
    const now = new Date();
    for (let i = 0; i < 5; i++) await rating.record(finished(`d${i}`, '1/2-1/2', true, new Date(now.getTime() - i * 1000).toISOString()));
    rating.refresh(now);
    // Five draws against 1500: Ra = (7500 + 3600) / 7 = 1585.7, p = 0.5 -> 1586 provisional.
    expect(rating.state!.live).toBe(1586);
    expect(ratingLabel(rating.state)).toBe('Unrated (5/5)');
    expect(ratingLabel(rating.state, 'live')).toBe('1586');
    // With 1500 hypothetical opponents: Ra = 1500 -> 1500.
    expect(rating.preview({ hypotheticalOpponent: 1500 }, now).live).toBe(1500);
    await rating.changeSettings({ hypotheticalOpponent: 1500 });
    await rating.changeSettings({ hypotheticalOpponent: 1500 }); // no change, nothing appended
    rating.refresh(now);
    expect(rating.state!.live).toBe(1500);
    expect((await s.listLedger()).filter((e) => e.kind === 'settings')).toHaveLength(1);
  });
});
