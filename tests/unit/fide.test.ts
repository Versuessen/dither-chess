import { describe, expect, it } from 'vitest';
import { RULES, expectedScore, gameIsRated, initialRating, kFactor, ratingDifference, roundAway } from '../../src/rating/fide';
import { periodOf, replay } from '../../src/rating/ledger';
import type { LedgerEntry, LedgerGame, RatingSettings } from '../../src/storage/types';

/*
 * The FIDE regulations contain no worked examples, so the cases below are computed by hand from
 * the tables (B02 8.1.1 / 8.1.2) and rules (R&B 6.1.4, 7.2, 7.3); the arithmetic is written out
 * next to each expectation.
 */

let seq = 0;
function game(at: string, opponentRating: number, score: 0 | 0.5 | 1, tz = 'UTC'): LedgerGame {
  seq += 1;
  return { seq, kind: 'game', gameId: `g${seq}`, at, timeZone: tz, opponentRating, score, pgn: '', snapshot: {} };
}
function settings(at: string, s: Partial<RatingSettings>): LedgerEntry {
  seq += 1;
  return { seq, kind: 'settings', at, timeZone: 'UTC', settings: { hypotheticalOpponent: 1800, floor1400: false, juniorBirthYear: null, ...s } };
}
const NOW = new Date('2027-06-15T12:00:00Z');

describe('FIDE tables', () => {
  it('PD (8.1.2) at the edges of its ranges, and the 400-point rule', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
    expect(expectedScore(1503, 1500)).toBe(0.5);
    expect(expectedScore(1504, 1500)).toBe(0.51);
    expect(expectedScore(1500, 1504)).toBe(0.49);
    expect(expectedScore(1736, 1500)).toBe(0.8); // D 236: 236-245
    expect(expectedScore(1500, 1736)).toBe(0.2);
    expect(expectedScore(1900, 1500)).toBe(0.92); // D 400: 392-411
    expect(expectedScore(2000, 1500)).toBe(0.92); // D 500 counts as 400 (7.3.1)
    expect(expectedScore(1000, 1500)).toBe(0.08);
  });

  it('PD of the two players always adds up to 1', () => {
    for (let a = 600; a <= 2600; a += 7) {
      for (let b = 600; b <= 2600; b += 97) expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 12);
    }
  });

  it('PD never falls as the own rating rises', () => {
    let last = 0;
    for (let a = 1000; a <= 2200; a++) {
      const pd = expectedScore(a, 1600);
      expect(pd).toBeGreaterThanOrEqual(last);
      last = pd;
    }
  });

  it('dp (8.1.1) is the published table, symmetric about p = 0.5', () => {
    expect(ratingDifference(0.5)).toBe(0);
    expect(ratingDifference(0.43)).toBe(-50);
    expect(ratingDifference(0.86)).toBe(309);
    expect(ratingDifference(0.99)).toBe(677);
    expect(ratingDifference(1)).toBe(800);
    expect(ratingDifference(0)).toBe(-800);
    expect(ratingDifference(0.428571)).toBe(-50); // rounded to 0.43
    for (let i = 0; i <= 100; i++) expect(ratingDifference(i / 100) + ratingDifference(1 - i / 100)).toBe(0);
  });

  it('rounds the rating change half away from zero (7.3.4)', () => {
    expect(roundAway(3.5)).toBe(4);
    expect(roundAway(-3.5)).toBe(-4);
    expect(roundAway(2.49)).toBe(2);
    expect(roundAway(35 * -0.1)).toBe(-4); // -3.5000000000000004 in floating point
    expect(roundAway(0.4)).toBe(0);
    expect(roundAway(-0.4) === 0).toBe(true);
  });

  it('chooses K by 7.3.3 and caps n × K at 700', () => {
    const base = { rating: 1500, gamesBefore: 0, reached2400: false, year: 2026, juniorBirthYear: null, games: 3 };
    expect(kFactor(base)).toBe(40);
    expect(kFactor({ ...base, gamesBefore: 29 })).toBe(40);
    expect(kFactor({ ...base, gamesBefore: 30 })).toBe(20);
    expect(kFactor({ ...base, gamesBefore: 30, reached2400: true, rating: 2350 })).toBe(10);
    expect(kFactor({ ...base, gamesBefore: 30, juniorBirthYear: 2008 })).toBe(40); // 2026 = year of 18th birthday
    expect(kFactor({ ...base, gamesBefore: 30, juniorBirthYear: 2007 })).toBe(20);
    expect(kFactor({ ...base, gamesBefore: 30, juniorBirthYear: 2008, rating: 2300 })).toBe(20);
    expect(kFactor({ ...base, games: 17 })).toBe(40); // 17 x 40 = 680
    expect(kFactor({ ...base, games: 18 })).toBe(38); // 18 x 40 = 720 > 700 -> 38
    expect(kFactor({ ...base, gamesBefore: 30, games: 36 })).toBe(19);
  });

  it('applies the 600-point rule only above 2600', () => {
    expect(gameIsRated(2700, 2000)).toBe(false);
    expect(gameIsRated(2650, 2100)).toBe(true);
    expect(gameIsRated(2200, 1500)).toBe(true);
    expect(gameIsRated(null, 2000)).toBe(true);
  });

  it('computes an initial rating with two hypothetical draws against 1800 (7.2.3-7.2.4)', () => {
    // Ra = (1200+1300+1400+1500+1600 + 2 x 1800) / 7 = 10600 / 7 = 1514.29
    // p = (1 + 0.5 + 0.5 + 0 + 0 + 1) / 7 = 3 / 7 = 0.4286 -> 0.43 -> dp = -50
    // Ru = round(1514.29 - 50) = 1464
    const r = initialRating(
      [
        { opponentRating: 1200, score: 1 },
        { opponentRating: 1300, score: 0.5 },
        { opponentRating: 1400, score: 0.5 },
        { opponentRating: 1500, score: 0 },
        { opponentRating: 1600, score: 0 }
      ],
      1800
    );
    expect(r.average).toBeCloseTo(1514.2857, 3);
    expect(r.dp).toBe(-50);
    expect(r.rating).toBe(1464);
    expect(r.capped).toBe(false);
  });

  it('caps an initial rating at 2200', () => {
    // Ra = (5 x 2300 + 3600) / 7 = 2157.1, p = 6/7 = 0.86 -> dp 309 -> 2466 -> 2200
    const r = initialRating(Array.from({ length: 5 }, () => ({ opponentRating: 2300, score: 1 })), 1800);
    expect(r.rating).toBe(2200);
    expect(r.capped).toBe(true);
  });
});

describe('rating periods', () => {
  it('assigns games to the local calendar month', () => {
    // 31 Oct 2026 23:30 UTC is already 1 November in Berlin (UTC+1 after 25 October).
    expect(periodOf('2026-10-31T23:30:00Z', 'Europe/Berlin')).toBe('2026-11');
    expect(periodOf('2026-10-31T23:30:00Z', 'UTC')).toBe('2026-10');
    expect(periodOf('2026-11-01T03:00:00Z', 'America/Los_Angeles')).toBe('2026-10');
    expect(periodOf('2026-11-01T03:00:00Z', 'Not/AZone')).toBe('2026-11');
  });

  it('shows UNRATED progress until five games, then publishes the initial rating at the period end', () => {
    const g = [
      game('2026-10-03T10:00:00Z', 1200, 1),
      game('2026-10-04T10:00:00Z', 1300, 0.5),
      game('2026-10-05T10:00:00Z', 1400, 0.5),
      game('2026-10-06T10:00:00Z', 1500, 0)
    ];
    const during = replay(g, new Date('2026-10-20T00:00:00Z'), 'UTC');
    expect(during.published).toBeNull();
    expect(during.unrated).toEqual({ counted: 4, needed: 5 });
    expect(during.live).toBeNull();

    const five = [...g, game('2026-10-07T10:00:00Z', 1600, 0)];
    const live = replay(five, new Date('2026-10-20T00:00:00Z'), 'UTC');
    expect(live.published).toBeNull(); // published only on the next list
    expect(live.live).toBe(1464); // provisional, as computed above
    expect(live.unrated).toEqual({ counted: 5, needed: 5 });

    const next = replay(five, new Date('2026-11-02T00:00:00Z'), 'UTC');
    expect(next.published).toBe(1464);
    expect(next.unrated).toBeNull();
    expect(next.gamesTotal).toBe(5);
    expect(next.periods[0]!.initial).toMatchObject({ rating: 1464, games: 5, hypothetical: 1800, dp: -50 });
  });

  it('rates a period with K = 40 for a new player', () => {
    // Rated 1464 after October. November: beat 1500, lost to 1600, drew 1300.
    //   vs 1500: D 36 (33-39), lower: PD 0.45, dR = 1 - 0.45 = 0.55
    //   vs 1600: D 136 (130-137), lower: PD 0.32, dR = -0.32
    //   vs 1300: D 164 (163-170), higher: PD 0.72, dR = 0.5 - 0.72 = -0.22
    //   sum = 0.01; K = 40 (5 games before); change = round(0.4) = 0 -> 1464
    // December: beat 1700 twice.
    //   vs 1700: D 236 (236-245), lower: PD 0.20, dR = 0.80 each -> sum 1.60, K 40 -> +64 -> 1528
    const entries = [
      game('2026-10-03T10:00:00Z', 1200, 1),
      game('2026-10-04T10:00:00Z', 1300, 0.5),
      game('2026-10-05T10:00:00Z', 1400, 0.5),
      game('2026-10-06T10:00:00Z', 1500, 0),
      game('2026-10-07T10:00:00Z', 1600, 0),
      game('2026-11-03T10:00:00Z', 1500, 1),
      game('2026-11-04T10:00:00Z', 1600, 0),
      game('2026-11-05T10:00:00Z', 1300, 0.5),
      game('2026-12-01T10:00:00Z', 1700, 1),
      game('2026-12-02T10:00:00Z', 1700, 1)
    ];
    const r = replay(entries, NOW, 'UTC');
    const nov = r.periods.find((p) => p.period === '2026-11')!;
    expect(nov.games.map((g) => g.pd)).toEqual([0.45, 0.32, 0.72]);
    expect(nov.sumDelta).toBeCloseTo(0.01, 10);
    expect(nov.k).toBe(40);
    expect(nov.change).toBe(0);
    const dec = r.periods.find((p) => p.period === '2026-12')!;
    expect(dec.ratingBefore).toBe(1464);
    expect(dec.change).toBe(64);
    expect(r.published).toBe(1528);
    expect(r.gamesTotal).toBe(10);
  });

  it('shows the live rating for the current period without publishing it', () => {
    const base = Array.from({ length: 5 }, (_, i) => game(`2026-10-0${i + 1}T10:00:00Z`, 1500, 0.5));
    // Ra = 1500*5+3600 / 7 = 1585.7, p = 0.5 -> 1586
    const live = [...base, game('2026-11-10T10:00:00Z', 1586, 1)];
    const r = replay(live, new Date('2026-11-20T00:00:00Z'), 'UTC');
    expect(r.published).toBe(1586);
    // vs 1586: D 0, PD 0.5, dR 0.5, K 40 -> +20
    expect(r.live).toBe(1606);
    expect(r.k).toBe(40);
    expect(r.periods.at(-1)!.live).toBe(true);
  });

  it('caps K so that n x K stays within 700, rounding the change away from zero', () => {
    // 5 games at 1500 (draws) -> 1586. Next month 20 games: K = floor(700/20) = 35.
    // 10 wins and 10 losses vs 1586: sum = 10 x 0.5 - 10 x 0.5 = 0 -> 0.
    // Then make it 11 wins / 9 losses: sum = 11 x 0.5 - 9 x 0.5 = 1.0 -> 35.
    const base = Array.from({ length: 5 }, (_, i) => game(`2026-10-0${i + 1}T10:00:00Z`, 1500, 0.5));
    const month = Array.from({ length: 20 }, (_, i) => game(`2026-11-${String(i + 1).padStart(2, '0')}T10:00:00Z`, 1586, i < 11 ? 1 : 0));
    const r = replay([...base, ...month], NOW, 'UTC');
    const nov = r.periods.find((p) => p.period === '2026-11')!;
    expect(nov.k).toBe(35);
    expect(nov.change).toBe(35);
    // Half-point case, rounded away from zero. December, rated 1621, 20 games so K = 35 again
    // (25 games before < 30 -> 40; 20 x 40 > 700 -> 35):
    //   10 draws vs 1611: D 10 (4-10), higher: PD 0.51, dR = -0.01 each -> -0.10
    //   10 draws vs 1621: D 0, PD 0.50, dR = 0
    //   35 x -0.10 = -3.5 -> -4
    const half = [
      ...Array.from({ length: 10 }, (_, i) => game(`2026-12-${String(i + 1).padStart(2, '0')}T10:00:00Z`, 1611, 0.5)),
      ...Array.from({ length: 10 }, (_, i) => game(`2026-12-${String(i + 11).padStart(2, '0')}T10:00:00Z`, 1621, 0.5))
    ];
    const r2 = replay([...base, ...month, ...half], NOW, 'UTC');
    const dec = r2.periods.find((p) => p.period === '2026-12')!;
    expect(dec.ratingBefore).toBe(1621);
    expect(dec.sumDelta).toBeCloseTo(-0.1, 10);
    expect(dec.k).toBe(35);
    expect(dec.change).toBe(-4);
    expect(r2.published).toBe(1617);
  });

  it('switches to K = 20 after 30 games', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => game(`2026-01-0${i + 1}T10:00:00Z`, 1500, 0.5)),
      ...Array.from({ length: 25 }, (_, i) => game(`2026-02-${String(i + 1).padStart(2, '0')}T10:00:00Z`, 1586, 0.5)),
      game('2026-03-05T10:00:00Z', 1586, 1)
    ];
    const r = replay(entries, NOW, 'UTC');
    expect(r.periods.find((p) => p.period === '2026-02')!.k).toBe(28); // 25 x 40 > 700 -> 28
    expect(r.periods.find((p) => p.period === '2026-03')!.k).toBe(20);
    expect(r.periods.find((p) => p.period === '2026-03')!.change).toBe(10);
  });

  it('disregards a zero first event (7.2.2)', () => {
    const entries = [
      game('2026-01-05T10:00:00Z', 1500, 0),
      game('2026-01-06T10:00:00Z', 1500, 0),
      ...Array.from({ length: 5 }, (_, i) => game(`2026-02-0${i + 1}T10:00:00Z`, 1500, 0.5))
    ];
    const r = replay(entries, NOW, 'UTC');
    expect(r.periods[0]!.notes.join(' ')).toContain('7.2.2');
    expect(r.periods[0]!.games.every((g) => !g.counted)).toBe(true);
    expect(r.periods[1]!.initial!.games).toBe(5);
    expect(r.published).toBe(1586);
  });

  it('pools unrated games over at most 26 months (6.1.4)', () => {
    const entries = [
      game('2024-01-05T10:00:00Z', 1500, 1),
      game('2024-01-06T10:00:00Z', 1500, 1),
      game('2026-03-05T10:00:00Z', 1500, 0.5),
      game('2026-03-06T10:00:00Z', 1500, 0.5),
      game('2026-03-07T10:00:00Z', 1500, 0.5)
    ];
    // March 2026 is 26 months after January 2024: those games have left the pool.
    const r = replay(entries, NOW, 'UTC');
    expect(r.published).toBeNull();
    expect(r.unrated).toEqual({ counted: 3, needed: 5 }); // the March 2026 games are still in the pool
    expect(r.periods.at(-2)!.pooled).toBe(3);
    // One month earlier they still count.
    const inside = [entries[0]!, entries[1]!, game('2026-02-05T10:00:00Z', 1500, 0.5), game('2026-02-06T10:00:00Z', 1500, 0.5), game('2026-02-07T10:00:00Z', 1500, 0.5)];
    expect(replay(inside, NOW, 'UTC').published).not.toBeNull();
  });

  it('carries the pool into the live period', () => {
    const entries = [game('2027-05-05T10:00:00Z', 1500, 1), game('2027-06-05T10:00:00Z', 1500, 0.5)];
    expect(replay(entries, NOW, 'UTC').unrated).toEqual({ counted: 2, needed: 5 });
  });

  it('uses the configured hypothetical opponents, from the period the setting changed', () => {
    const five = (month: string) => Array.from({ length: 5 }, (_, i) => game(`${month}-0${i + 1}T10:00:00Z`, 1200, 0.5));
    // 1800: Ra = (6000 + 3600)/7 = 1371.4, p 0.5 -> 1371; 1200: Ra = 1200 -> 1200
    expect(replay(five('2026-10'), NOW, 'UTC').published).toBe(1371);
    seq = 100;
    const changed = [settings('2026-09-01T00:00:00Z', { hypotheticalOpponent: 1200 }), ...five('2026-10')];
    expect(replay(changed, NOW, 'UTC').published).toBe(1200);
    // A change after the period closed does not rewrite it.
    const later = [...five('2026-10'), settings('2026-12-01T00:00:00Z', { hypotheticalOpponent: 1200 })];
    expect(replay(later, NOW, 'UTC').published).toBe(1371);
  });

  it('keeps or drops the 1400 floor by setting', () => {
    const five = Array.from({ length: 5 }, (_, i) => game(`2026-10-0${i + 1}T10:00:00Z`, 900, i === 0 ? 0.5 : 0));
    // Ra = (4500 + 3600)/7 = 1157.1, p = 1.5/7 = 0.214 -> 0.21 -> dp -230 -> 927
    expect(replay(five, NOW, 'UTC').published).toBe(927);
    const floored = [settings('2026-01-01T00:00:00Z', { floor1400: true }), ...five];
    const r = replay(floored, NOW, 'UTC');
    expect(r.published).toBeNull();
    expect(r.periods.find((p) => p.period === '2026-10')!.notes.join(' ')).toContain('1400');
  });
});

describe('replay properties', () => {
  function rng(seed: number) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  function randomLedger(seed: number, n: number): LedgerGame[] {
    const r = rng(seed);
    seq = 1000 * seed;
    const out: LedgerGame[] = [];
    let t = Date.parse('2025-01-01T00:00:00Z');
    for (let i = 0; i < n; i++) {
      t += Math.floor(r() * 4 * 86_400_000);
      const score = ([0, 0.5, 1] as const)[Math.floor(r() * 3)]!;
      out.push(game(new Date(t).toISOString(), 600 + Math.floor(r() * 17) * 100, score));
    }
    return out;
  }

  it('is deterministic and independent of the order rows are read in', () => {
    for (let s = 1; s <= 20; s++) {
      const l = randomLedger(s, 60);
      const a = replay(l, NOW, 'UTC');
      const shuffled = [...l].sort(() => (rng(s)() < 0.5 ? -1 : 1)).reverse();
      expect(replay(shuffled, NOW, 'UTC')).toEqual(a);
      expect(replay(l, NOW, 'UTC')).toEqual(a);
    }
  });

  it('never changes a period by more than K x games, and live equals published without new games', () => {
    for (let s = 1; s <= 30; s++) {
      const r = replay(randomLedger(s, 80), new Date('2031-01-01T00:00:00Z'), 'UTC');
      for (const p of r.periods) {
        if (p.k !== null) expect(Math.abs(p.change!)).toBeLessThanOrEqual(p.k * p.games.length);
        if (p.k !== null) expect(p.k * p.games.filter((g) => g.counted).length).toBeLessThanOrEqual(RULES.kTimesGamesMax);
      }
      expect(r.live).toBe(r.published);
    }
  });

  it('a better result never gives a lower rating at the end of its period', () => {
    // Later periods are not monotone in FIDE's system (a higher rating raises every later PD),
    // so the property is checked where the game is rated.
    for (let s = 1; s <= 40; s++) {
      const l = randomLedger(s, 40);
      const i = Math.floor(rng(s + 99)() * l.length);
      const worse = l.map((g, j) => (j === i ? { ...g, score: 0 as const } : g));
      const better = l.map((g, j) => (j === i ? { ...g, score: 1 as const } : g));
      const period = periodOf(l[i]!.at, 'UTC');
      const a = replay(worse, NOW, 'UTC').periods.find((p) => p.period === period)!;
      const b = replay(better, NOW, 'UTC').periods.find((p) => p.period === period)!;
      if (a.ratingBefore === b.ratingBefore && a.ratingAfter !== null && b.ratingAfter !== null) {
        expect(b.ratingAfter).toBeGreaterThanOrEqual(a.ratingAfter);
      }
    }
  });
});
