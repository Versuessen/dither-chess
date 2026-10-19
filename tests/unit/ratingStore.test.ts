import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../src/storage/memory';
import { humanScore, rating, ratingLabel } from '../../src/rating/rating.svelte';
import type { StoredGame } from '../../src/storage/types';

function finished(
  id: string,
  result: '1-0' | '0-1' | '1/2-1/2' | '*',
  rated = true,
  endedAt = '2026-10-05T10:00:00Z',
  timeControl = { base: 900, increment: 10 }
): StoredGame {
  return {
    id,
    startedAt: endedAt,
    endedAt,
    persona: 'grinder',
    botName: 'Grinder',
    family: 'maia3',
    pack: 'maia3-23m',
    packSha256: 'x',
    botLevel: 1500,
    humanColor: 'w',
    timeControl,
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
    expect(ledger[0]).toMatchObject({ kind: 'game', opponentRating: 1500, score: 1, speed: 'rapid' });
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
    expect(rating.of('rapid')!.live).toBe(1586);
    expect(ratingLabel(rating.of('rapid'))).toBe('Unrated (5/5)');
    expect(ratingLabel(rating.of('rapid'), 'live')).toBe('1586');
    // With 1500 hypothetical opponents: Ra = 1500 -> 1500.
    expect(rating.preview('rapid', { hypotheticalOpponent: 1500 }, now).live).toBe(1500);
    await rating.changeSettings({ hypotheticalOpponent: 1500 });
    await rating.changeSettings({ hypotheticalOpponent: 1500 }); // no change, nothing appended
    rating.refresh(now);
    expect(rating.of('rapid')!.live).toBe(1500);
    expect((await s.listLedger()).filter((e) => e.kind === 'settings')).toHaveLength(1);
  });

  it('keeps one rating per speed', async () => {
    const s = new MemoryStorage();
    await s.init();
    await rating.load(s);
    const now = new Date();
    const at = (i: number) => new Date(now.getTime() - i * 1000).toISOString();
    for (let i = 0; i < 5; i++) await rating.record(finished(`b${i}`, '1-0', true, at(i), { base: 180, increment: 2 }));
    await rating.record(finished('r0', '1/2-1/2', true, at(9)));
    rating.refresh(now);
    expect(rating.of('blitz')!.unrated).toEqual({ counted: 5, needed: 5 });
    expect(rating.of('blitz')!.live).toBeGreaterThan(1586);
    expect(ratingLabel(rating.of('rapid'))).toBe('Unrated (1/5)');
    expect(ratingLabel(rating.of('bullet'))).toBe('Unrated (0/5)');
    expect((await s.listLedger()).filter((e) => e.kind === 'game' && e.speed === 'blitz')).toHaveLength(5);
  });

  it('takes games out of the rating and puts them back through the ledger', async () => {
    const s = new MemoryStorage();
    await s.init();
    await rating.load(s);
    const now = new Date();
    for (let i = 0; i < 5; i++) await rating.record(finished(`x${i}`, '1/2-1/2', true, new Date(now.getTime() - i * 1000).toISOString()));
    rating.refresh(now);
    expect(ratingLabel(rating.of('rapid'), 'live')).toBe('1586');
    await rating.setExcluded('x0', true);
    await rating.setExcluded('x0', true); // already out: nothing appended
    await rating.setExcluded('nope', true); // never rated: ignored
    rating.refresh(now);
    expect(rating.excluded.has('x0')).toBe(true);
    expect(ratingLabel(rating.of('rapid'))).toBe('Unrated (4/5)');
    await rating.setExcluded('x0', false);
    rating.refresh(now);
    expect(ratingLabel(rating.of('rapid'), 'live')).toBe('1586');
    const ledger = await s.listLedger();
    expect(ledger.filter((e) => e.kind === 'exclusion').map((e) => e.kind === 'exclusion' && e.excluded)).toEqual([true, false]);
    // Recording an excluded game again never adds it twice.
    await rating.record(finished('x0', '1/2-1/2'));
    expect((await s.listLedger()).filter((e) => e.kind === 'game')).toHaveLength(5);
  });
});
