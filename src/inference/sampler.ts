/**
 * Sampling from a model's move distribution, exactly as the reference code does:
 *  - temperature: p = softmax(logits / T) over the legal moves (fastelo CalibratedPolicy and
 *    maia3/uci.py sample_from_logits agree on this);
 *  - top-p (maia3 sample_from_logits): sort descending, keep entries whose cumulative mass is
 *    <= top_p, always keep the first, renormalise.
 * The random source is the game's seeded RNG, so a game replays exactly from its seed.
 */
import type { Rng } from '../lib/rng';
import { softmax } from './position';

export interface Sampled {
  /** Index into the legal-move list. */
  index: number;
  /** Probability of the chosen move in the distribution actually sampled from. */
  prob: number;
  /** Shannon entropy (nats) of that distribution. */
  entropy: number;
  /** The distribution itself, aligned with the legal-move list. */
  probs: Float64Array;
}

export function distribution(logits: ArrayLike<number>, temperature: number, topP: number): Float64Array {
  if (temperature <= 0) {
    // argmax, as maia3 does for temperature 0
    let best = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i]! > logits[best]!) best = i;
    const p = new Float64Array(logits.length);
    p[best] = 1;
    return p;
  }
  const p = softmax(logits, temperature);
  if (topP >= 1) return p;
  const order = Array.from(p.keys()).sort((a, b) => p[b]! - p[a]! || a - b);
  const keep = new Uint8Array(p.length);
  let cum = 0;
  order.forEach((i, rank) => {
    cum += p[i]!;
    if (cum <= topP || rank === 0) keep[i] = 1;
  });
  let total = 0;
  for (let i = 0; i < p.length; i++) if (keep[i]) total += p[i]!;
  for (let i = 0; i < p.length; i++) p[i] = keep[i] ? p[i]! / total : 0;
  return p;
}

export function entropy(p: ArrayLike<number>): number {
  let h = 0;
  for (let i = 0; i < p.length; i++) if (p[i]! > 0) h -= p[i]! * Math.log(p[i]!);
  return h;
}

export function sample(logits: ArrayLike<number>, temperature: number, topP: number, rng: Rng): Sampled {
  const probs = distribution(logits, temperature, topP);
  const u = rng.next();
  let acc = 0;
  let index = probs.length - 1;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i]!;
    if (u < acc) {
      index = i;
      break;
    }
  }
  // Guard against rounding leaving u beyond the last positive entry.
  while (probs[index] === 0 && index > 0) index--;
  return { index, prob: probs[index]!, entropy: entropy(probs), probs };
}
