/** Pure motion maths for the dither layer: cover fit, knight-move drift, smoothing. */
import { createRng } from '../lib/rng';

export interface Size {
  width: number;
  height: number;
}

/**
 * Cover-fit a texture to the viewport, keeping `focal` (texture uv) as central as the crop
 * allows. Returns [scaleX, scaleY, offsetX, offsetY] mapping screen uv to texture uv.
 * `zoom` > 1 leaves a margin for parallax so offsets never expose the clamped edge.
 */
export function coverFit(tex: Size, view: Size, focal: [number, number], zoom = 1.06): [number, number, number, number] {
  const s = Math.max(view.width / tex.width, view.height / tex.height) * zoom;
  const ex = view.width / (tex.width * s);
  const ey = view.height / (tex.height * s);
  const ox = Math.min(Math.max(focal[0] - ex / 2, 0), 1 - ex);
  const oy = Math.min(Math.max(focal[1] - ey / 2, 0), 1 - ey);
  return [ex, ey, ox, oy];
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export const KNIGHT_MOVES: readonly [number, number][] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2]
];

export interface DriftOptions {
  /** Seconds between the starts of two moves. */
  period: number;
  /** Seconds a move takes (long leg then short leg). */
  duration: number;
  /** Positions stay within [-bound, bound] squares on both axes. */
  bound: number;
  seed: number;
}

export const DEFAULT_DRIFT: DriftOptions = { period: 6.5, duration: 1.2, bound: 2, seed: 64 };

/**
 * The layers drift across an invisible board in knight moves. A move walks the long leg of
 * the L first, then the short leg, each with an eased snap. Deterministic in time.
 */
export class KnightDrift {
  private readonly squares: [number, number][] = [[0, 0]];
  private readonly rng;

  constructor(private readonly opts: DriftOptions = DEFAULT_DRIFT) {
    this.rng = createRng(opts.seed);
  }

  /** Square reached after `n` completed moves. */
  square(n: number): [number, number] {
    while (this.squares.length <= n) {
      const [x, y] = this.squares[this.squares.length - 1]!;
      const legal = KNIGHT_MOVES.filter(
        ([dx, dy]) => Math.abs(x + dx) <= this.opts.bound && Math.abs(y + dy) <= this.opts.bound
      );
      const [dx, dy] = legal[this.rng.int(legal.length)]!;
      this.squares.push([x + dx, y + dy]);
    }
    return this.squares[n]!;
  }

  /** Offset in squares at time t (seconds). */
  at(t: number): [number, number] {
    const { period, duration } = this.opts;
    const n = Math.max(0, Math.floor(t / period));
    const local = t - n * period;
    const from = this.square(n);
    if (local >= duration) return this.square(n + 1);
    const to = this.square(n + 1);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const longIsX = Math.abs(dx) > Math.abs(dy);
    const split = 0.6;
    const u = local / duration;
    const first = easeInOutCubic(Math.min(u / split, 1));
    const second = easeInOutCubic(Math.max((u - split) / (1 - split), 0));
    return longIsX ? [from[0] + dx * first, from[1] + dy * second] : [from[0] + dx * second, from[1] + dy * first];
  }
}

/** Frame-rate independent exponential smoothing towards a target. */
export function approach(current: number, target: number, dt: number, halfLife: number): number {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(0.5, dt / halfLife);
}

/** Frame limiter: true when enough time has passed for the next frame at `fps`. */
export function shouldRender(now: number, last: number, fps = 60): boolean {
  // A small tolerance so a 60 Hz display does not drop every other frame from jitter.
  return now - last >= 1000 / fps - 1.5;
}
