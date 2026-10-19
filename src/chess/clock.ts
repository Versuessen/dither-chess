/**
 * Two-sided chess clock with a Fischer increment, driven by timestamps so a throttled or
 * hidden tab never loses time accuracy. FIDE Laws 6.5: White's clock starts with the game.
 * The increment is added to the mover's clock after each completed move.
 */
import type { TimeControl } from './timeControl';
import { isUntimed } from './timeControl';
import type { Color } from './rules';

export type Now = () => number;

export interface ClockSnapshot {
  white: number;
  black: number;
  running: Color | null;
}

export class ChessClock {
  private remaining: Record<Color, number>;
  private running: Color | null = null;
  private since = 0;
  readonly untimed: boolean;

  constructor(
    readonly control: TimeControl,
    private readonly now: Now = () => performance.now()
  ) {
    this.untimed = isUntimed(control);
    this.remaining = { w: control.base * 1000, b: control.base * 1000 };
  }

  /** Milliseconds left for `color` right now. */
  timeLeft(color: Color): number {
    if (this.untimed) return Infinity;
    const r = this.remaining[color];
    return this.running === color ? Math.max(0, r - (this.now() - this.since)) : r;
  }

  get active(): Color | null {
    return this.running;
  }

  start(color: Color): void {
    if (this.untimed || this.running) return;
    this.running = color;
    this.since = this.now();
  }

  /**
   * The side to move completed a move: stop its clock, add the increment, start the other.
   * Returns the time the move took in milliseconds.
   */
  press(mover: Color): number {
    if (this.untimed) return 0;
    const t = this.now();
    let spent = 0;
    if (this.running === mover) {
      spent = t - this.since;
      this.remaining[mover] = Math.max(0, this.remaining[mover] - spent) + this.control.increment * 1000;
    }
    this.running = mover === 'w' ? 'b' : 'w';
    this.since = t;
    return spent;
  }

  stop(): void {
    if (this.untimed || !this.running) return;
    const t = this.now();
    this.remaining[this.running] = Math.max(0, this.remaining[this.running] - (t - this.since));
    this.running = null;
  }

  /** The side whose flag has fallen, if any. */
  flagged(): Color | null {
    if (this.untimed || !this.running) return null;
    return this.timeLeft(this.running) <= 0 ? this.running : null;
  }

  snapshot(): ClockSnapshot {
    return { white: this.timeLeft('w'), black: this.timeLeft('b'), running: this.running };
  }

  /** Restore remaining times (e.g. after a takeback). */
  set(white: number, black: number): void {
    this.remaining = { w: white, b: black };
    if (this.running) this.since = this.now();
  }
}

/** "14:52", "0:09.4" under ten seconds, "1:02:03" past an hour. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) {
    const tenths = Math.floor(clamped / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const total = Math.ceil(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** PGN %clk comment value, H:MM:SS (whole seconds, rounded down as Lichess does). */
export function pgnClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
