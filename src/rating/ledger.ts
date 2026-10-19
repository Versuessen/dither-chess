/**
 * Rating periods replayed from the append-only ledger. The state is never stored: every view of
 * the rating is `replay(ledger, now)`, so the same ledger always gives the same ratings.
 *
 * Periods before the current local month are closed ("published", 6.1); the current month is
 * the live rating: the published rating plus the change the period's games would bring if the
 * period ended now.
 */
import type { LedgerEntry, LedgerGame, RatingSettings } from '../storage/types';
import { DEFAULT_SETTINGS, RULES, expectedScore, gameIsRated, initialRating, kFactor, roundAway } from './fide';

export interface GameRow {
  seq: number;
  gameId: string;
  at: string;
  opponentRating: number;
  score: number;
  /** PD against this opponent from the rating at the start of the period; null while unrated. */
  pd: number | null;
  /** Whether the game entered the calculation, and why not if it did not. */
  counted: boolean;
  note?: string;
}

export interface InitialInfo {
  rating: number;
  average: number;
  p: number;
  dp: number;
  capped: boolean;
  games: number;
  hypothetical: number;
}

export interface PeriodRow {
  period: string;
  live: boolean;
  games: GameRow[];
  ratingBefore: number | null;
  k: number | null;
  sumDelta: number | null;
  change: number | null;
  ratingAfter: number | null;
  initial: InitialInfo | null;
  /** Games pooled towards an initial rating after this period (unrated only). */
  pooled: number | null;
  notes: string[];
}

export interface RatingReplay {
  periods: PeriodRow[];
  /** Rating on the current list (end of the last closed period), or null when unrated. */
  published: number | null;
  /** Rating if the current period ended now (provisional initial rating included), or null. */
  live: number | null;
  /** While unrated: games counting towards the initial rating, including this period's. */
  unrated: { counted: number; needed: number } | null;
  /** K-factor for the current period (with its games so far), when rated. */
  k: number | null;
  gamesTotal: number;
  reached2400: boolean;
  settings: RatingSettings;
  currentPeriod: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** 'YYYY-MM' of an instant in a time zone (the rating period). */
export function periodOf(at: string, timeZone: string): string {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit' });
    }
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(at));
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}

function monthIndex(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return y! * 12 + (m! - 1);
}

function settingsAt(entries: readonly LedgerEntry[], period: string): RatingSettings {
  let s: RatingSettings = { ...DEFAULT_SETTINGS };
  for (const e of entries) if (e.kind === 'settings' && periodOf(e.at, e.timeZone) <= period) s = { ...e.settings };
  return s;
}

/**
 * Replay the whole ledger. `now` and `timeZone` decide which period is current (live); all
 * earlier periods are closed.
 */
export function replay(entries: readonly LedgerEntry[], now: Date, timeZone: string): RatingReplay {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const games = sorted.filter((e): e is LedgerGame => e.kind === 'game');
  const currentPeriod = periodOf(now.toISOString(), timeZone);
  const byPeriod = new Map<string, LedgerGame[]>();
  for (const g of games) {
    const p = periodOf(g.at, g.timeZone);
    if (!byPeriod.has(p)) byPeriod.set(p, []);
    byPeriod.get(p)!.push(g);
  }
  if (!byPeriod.has(currentPeriod)) byPeriod.set(currentPeriod, []);
  const order = [...byPeriod.keys()].filter((p) => p <= currentPeriod).sort();

  let rating: number | null = null;
  let reached2400 = false;
  let gamesTotal = 0;
  let firstEventSeen = false;
  let pool: { period: string; game: LedgerGame }[] = [];
  const periods: PeriodRow[] = [];
  let liveRating: number | null = null;
  let liveK: number | null = null;
  let unrated: RatingReplay['unrated'] = null;

  for (const period of order) {
    const live = period === currentPeriod;
    const settings = settingsAt(sorted, period);
    const list = byPeriod.get(period)!;
    const row: PeriodRow = {
      period,
      live,
      games: [],
      ratingBefore: rating,
      k: null,
      sumDelta: null,
      change: null,
      ratingAfter: rating,
      initial: null,
      pooled: null,
      notes: []
    };

    if (rating === null) {
      // ---- unrated: pool games towards an initial rating (6.1.4, 7.2)
      // 7.2.2: a zero score in the first event is disregarded. While the first event is the
      // live period this is what would happen if the period ended now.
      let disregard = false;
      if (!firstEventSeen && list.length > 0) {
        if (!live) firstEventSeen = true;
        if (list.every((g) => g.score === 0)) {
          disregard = true;
          row.notes.push(live ? 'No points yet in your first month: it would be disregarded (7.2.2).' : 'First event scored zero: disregarded (7.2.2).');
        }
      }
      for (const g of list) {
        row.games.push({ seq: g.seq, gameId: g.gameId, at: g.at, opponentRating: g.opponentRating, score: g.score, pd: null, counted: !disregard, note: disregard ? 'zero first event' : undefined });
      }
      const candidate = disregard ? pool : [...pool, ...list.map((game) => ({ period, game }))];
      const window = candidate.filter((x) => monthIndex(period) - monthIndex(x.period) < RULES.poolMonths);
      if (window.length < candidate.length) row.notes.push(`Games older than ${RULES.poolMonths} months left the pool (6.1.4).`);
      row.pooled = window.length;
      if (window.length >= RULES.initialGames) {
        const init = initialRating(
          window.map((x) => x.game),
          settings.hypotheticalOpponent
        );
        row.initial = { ...init, games: window.length, hypothetical: settings.hypotheticalOpponent };
        if (settings.floor1400 && init.rating < RULES.floor) {
          row.notes.push(`Initial rating ${init.rating} is below the 1400 floor: not published (6.1.4).`);
          if (!live) pool = window;
          else unrated = { counted: window.length, needed: RULES.initialGames };
        } else if (live) {
          liveRating = init.rating;
          unrated = { counted: window.length, needed: RULES.initialGames };
          row.ratingAfter = init.rating;
        } else {
          rating = init.rating;
          gamesTotal += window.length;
          pool = [];
          row.ratingAfter = rating;
        }
      } else {
        if (!live) pool = window;
        else unrated = { counted: window.length, needed: RULES.initialGames };
      }
    } else {
      // ---- rated: 7.3.2 for the period's games, K from 7.3.3
      const before: number = rating;
      const counted = list.filter((g) => gameIsRated(before, g.opponentRating));
      const year = Number(period.slice(0, 4));
      const K = kFactor({ rating: before, gamesBefore: gamesTotal, reached2400, year, juniorBirthYear: settings.juniorBirthYear, games: counted.length });
      let sum = 0;
      for (const g of list) {
        const ok = gameIsRated(before, g.opponentRating);
        const pd = expectedScore(before, g.opponentRating);
        if (ok) sum += g.score - pd;
        row.games.push({ seq: g.seq, gameId: g.gameId, at: g.at, opponentRating: g.opponentRating, score: g.score, pd, counted: ok, note: ok ? undefined : '600-point rule' });
      }
      sum = Math.round(sum * 100) / 100;
      const change = counted.length ? roundAway(K * sum) : 0;
      row.k = K;
      row.sumDelta = sum;
      row.change = change;
      const after = before + change;
      row.ratingAfter = after;
      if (live) {
        liveRating = after;
        liveK = K;
      } else {
        gamesTotal += counted.length;
        if (after >= RULES.kHighFrom) reached2400 = true;
        if (settings.floor1400 && after < RULES.floor) {
          row.notes.push(`Rating ${after} fell below the 1400 floor: unrated from the next list (6.2.1).`);
          rating = null;
          pool = [];
          firstEventSeen = true;
        } else {
          rating = after;
        }
      }
    }
    periods.push(row);
  }

  const settings = settingsAt(sorted, currentPeriod);
  return {
    periods,
    published: rating,
    live: liveRating ?? rating,
    unrated: rating === null ? (unrated ?? { counted: 0, needed: RULES.initialGames }) : null,
    k: rating === null ? null : liveK,
    gamesTotal,
    reached2400,
    settings,
    currentPeriod
  };
}
