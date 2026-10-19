/**
 * Time controls and their FIDE classification.
 *
 * FIDE Rapid & Blitz Rating Regulations (in force since 1 March 2024), 1.1.1: a rapid game
 * gives each player more than 10 and less than 60 minutes, either as a fixed time or as
 * "the time allotted + 60 times any increment". 1.1.2: blitz is more than 3 and no more than
 * 10 minutes on the same basis. Anything at 60 minutes or more is standard play.
 */

export interface TimeControl {
  /** Base time per player in seconds; 0 with increment 0 means untimed. */
  base: number;
  /** Increment per move in seconds. */
  increment: number;
}

export type TimeClass = 'untimed' | 'bullet' | 'blitz' | 'rapid' | 'standard';

export const UNTIMED: TimeControl = { base: 0, increment: 0 };

export function isUntimed(tc: TimeControl): boolean {
  return tc.base === 0 && tc.increment === 0;
}

/** Projected minutes per player: base + 60 moves of increment (R&B 1.1). */
export function projectedMinutes(tc: TimeControl): number {
  return (tc.base + 60 * tc.increment) / 60;
}

export function classify(tc: TimeControl): TimeClass {
  if (isUntimed(tc)) return 'untimed';
  const m = projectedMinutes(tc);
  if (m >= 60) return 'standard';
  if (m > 10) return 'rapid';
  if (m > 3) return 'blitz';
  return 'bullet';
}

/**
 * The rating pools: one rating per speed, as FIDE and Lichess keep them. Bullet below blitz,
 * classical for standard play and for untimed games (no clock, all the time in the world).
 */
export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical';
export const SPEEDS: readonly Speed[] = ['bullet', 'blitz', 'rapid', 'classical'];

export function speedOf(tc: TimeControl): Speed {
  const c = classify(tc);
  return c === 'untimed' || c === 'standard' ? 'classical' : c;
}

export const SPEED_LABEL: Record<Speed, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' };

export function formatTimeControl(tc: TimeControl): string {
  if (isUntimed(tc)) return 'Untimed';
  const base = tc.base % 60 === 0 ? String(tc.base / 60) : (tc.base / 60).toFixed(1).replace(/\.0$/, '');
  return `${base}+${tc.increment}`;
}

export function parseTimeControl(text: string): TimeControl | null {
  if (/^untimed$/i.test(text.trim()) || text.trim() === '-') return UNTIMED;
  const m = /^(\d+(?:\.\d+)?)\+(\d+)$/.exec(text.trim());
  if (!m) return null;
  return { base: Math.round(Number(m[1]) * 60), increment: Number(m[2]) };
}

/** PGN TimeControl tag (PGN standard 9.6.1): "base+inc" in seconds, or "-" for untimed. */
export function pgnTimeControl(tc: TimeControl): string {
  return isUntimed(tc) ? '-' : `${tc.base}+${tc.increment}`;
}

/** The clocks offered when starting a game. */
export const TIME_CONTROLS: readonly TimeControl[] = [
  { base: 60, increment: 1 },
  { base: 180, increment: 2 },
  { base: 300, increment: 3 },
  { base: 600, increment: 5 },
  { base: 900, increment: 10 },
  { base: 1800, increment: 0 },
  { base: 3600, increment: 30 },
  UNTIMED
];

export const DEFAULT_TIME_CONTROL: TimeControl = { base: 900, increment: 10 };
