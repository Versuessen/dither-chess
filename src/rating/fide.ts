/**
 * The FIDE rating system as written in the FIDE Rating Regulations effective 1 March 2024
 * (handbook B02, "B022024") and the Rapid & Blitz Rating Regulations 2024 ("B02RBRegulations2024"),
 * applied to the player's rated rapid games against DITHER's bots. Section numbers below are the
 * Rapid & Blitz ones, with the standard ones in brackets where the text is the same.
 *
 * The opponents' ratings are the bots' levels on the Lichess rapid scale, so the result is a
 * rating computed by FIDE's method on that scale, not a FIDE rating.
 *
 * Documented deviations, all settings (RatingSettings):
 *  - the 1400 floor (6.1.4, 6.2.1) is off by default; with it on, a rating below 1400 is not
 *    published and a published rating that drops below it becomes unrated again;
 *  - the two hypothetical opponents of an initial rating (7.2.3) are rated 1800 by default but
 *    can be set;
 *  - a rating period is a local calendar month (6.1: a new list on the first day of each month);
 *  - an "event" (7.2.2, 7.3.3) is one rating period's games, since there are no tournaments.
 */

/** Table 8.1.2 [B02], used by 7.3.2: upper end of each rating-difference range → PD of the higher-rated player. */
const PD_TABLE: readonly (readonly [number, number])[] = [
  [3, 0.5], [10, 0.51], [17, 0.52], [25, 0.53], [32, 0.54], [39, 0.55], [46, 0.56], [53, 0.57], [61, 0.58],
  [68, 0.59], [76, 0.6], [83, 0.61], [91, 0.62], [98, 0.63], [106, 0.64], [113, 0.65], [121, 0.66], [129, 0.67],
  [137, 0.68], [145, 0.69], [153, 0.7], [162, 0.71], [170, 0.72], [179, 0.73], [188, 0.74], [197, 0.75], [206, 0.76],
  [215, 0.77], [225, 0.78], [235, 0.79], [245, 0.8], [256, 0.81], [267, 0.82], [278, 0.83], [290, 0.84], [302, 0.85],
  [315, 0.86], [328, 0.87], [344, 0.88], [357, 0.89], [374, 0.9], [391, 0.91], [411, 0.92], [432, 0.93], [456, 0.94],
  [484, 0.95], [517, 0.96], [559, 0.97], [619, 0.98], [735, 0.99]
];

/** Table 8.1.1 [B02], used by 7.2.4: fractional score p (hundredths) → rating difference dp. */
const DP_TABLE: readonly number[] = [
  -800, -677, -589, -538, -501, -470, -444, -422, -401, -383, -366, -351, -336, -322, -309, -296, -284, -273, -262,
  -251, -240, -230, -220, -211, -202, -193, -184, -175, -166, -158, -149, -141, -133, -125, -117, -110, -102, -95,
  -87, -80, -72, -65, -57, -50, -43, -36, -29, -21, -14, -7, 0, 7, 14, 21, 29, 36, 43, 50, 57, 65, 72, 80, 87, 95,
  102, 110, 117, 125, 133, 141, 149, 158, 166, 175, 184, 193, 202, 211, 220, 230, 240, 251, 262, 273, 284, 296, 309,
  322, 336, 351, 366, 383, 401, 422, 444, 470, 501, 538, 589, 677, 800
];

export const RULES = {
  /** 7.3.1: a difference of more than 400 points counts as 400. */
  maxDifference: 400,
  /** 7.3.1 (from 1 Dec 2024): not rated if the difference is 600 or more and either player is rated above 2600. */
  unratedGap: 600,
  unratedGapAbove: 2600,
  /** 6.1.4: an initial rating needs at least 5 games against rated opponents, pooled over at most 26 months. */
  initialGames: 5,
  poolMonths: 26,
  /** 7.2.4: maximum initial rating. */
  maxInitial: 2200,
  floor: 1400,
  /** 7.3.3 */
  kNew: 40,
  kNewUntilGames: 30,
  kStandard: 20,
  kHigh: 10,
  kHighFrom: 2400,
  kJuniorBelow: 2300,
  kTimesGamesMax: 700
} as const;

export const DEFAULT_SETTINGS = { hypotheticalOpponent: 1800, floor1400: false, juniorBirthYear: null } as const;

/** PD (7.3.2 a) for a player rated `own` against `opponent`, with the 400-point rule. */
export function expectedScore(own: number, opponent: number): number {
  const d = Math.min(Math.abs(own - opponent), RULES.maxDifference);
  let high = 1;
  for (const [upTo, pd] of PD_TABLE) {
    if (d <= upTo) {
      high = pd;
      break;
    }
  }
  if (d > 735) high = 1;
  return own >= opponent ? high : Math.round((1 - high) * 100) / 100;
}

/** dp for a fractional score (7.2.4), p rounded to the nearest hundredth. */
export function ratingDifference(p: number): number {
  const i = Math.round(Math.min(1, Math.max(0, p)) * 100);
  return DP_TABLE[i]!;
}

/** 7.3.4: to the nearest whole number, 0.5 away from zero. */
export function roundAway(x: number): number {
  const r = Math.round(Math.abs(x) * 1e9) / 1e9; // ignore floating-point dust
  return Math.sign(x) * Math.floor(r + 0.5);
}

export interface KInput {
  rating: number;
  /** Rated games completed before this period (including those that gave the initial rating). */
  gamesBefore: number;
  /** A published rating has reached 2400 at some point. */
  reached2400: boolean;
  /** Year of the rating period, and the player's birth year if they asked for the junior K. */
  year: number;
  juniorBirthYear: number | null;
  /** Rated games in this period. */
  games: number;
}

/** 7.3.3: the K-factor for a rating period, then the n × K ≤ 700 cap. */
export function kFactor(k: KInput): number {
  let K: number;
  if (k.gamesBefore < RULES.kNewUntilGames) K = RULES.kNew;
  else if (k.juniorBirthYear !== null && k.year <= k.juniorBirthYear + 18 && k.rating < RULES.kJuniorBelow) K = RULES.kNew;
  else if (k.reached2400) K = RULES.kHigh;
  else K = RULES.kStandard;
  if (k.games > 0 && k.games * K > RULES.kTimesGamesMax) K = Math.floor(RULES.kTimesGamesMax / k.games);
  return K;
}

/** 7.2.3–7.2.4: Ru = Ra + dp with two hypothetical draws against `hypothetical`, at most 2200. */
export function initialRating(games: readonly { opponentRating: number; score: number }[], hypothetical: number): {
  rating: number;
  average: number;
  p: number;
  dp: number;
  capped: boolean;
} {
  const n = games.length + 2;
  const average = (games.reduce((a, g) => a + g.opponentRating, 0) + 2 * hypothetical) / n;
  const p = (games.reduce((a, g) => a + g.score, 0) + 1) / n;
  const dp = ratingDifference(p);
  const raw = Math.round(average + dp);
  return { rating: Math.min(raw, RULES.maxInitial), average, p, dp, capped: raw > RULES.maxInitial };
}

/** Whether a game counts at all (7.3.1, 600-point rule). Unrated players' games always count. */
export function gameIsRated(own: number | null, opponent: number): boolean {
  if (own === null) return true;
  return !(Math.abs(own - opponent) >= RULES.unratedGap && (own > RULES.unratedGapAbove || opponent > RULES.unratedGapAbove));
}
