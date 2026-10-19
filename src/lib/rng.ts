/**
 * Seedable pseudo-random numbers. sfc32 (Small Fast Counter, PractRand-clean) seeded through
 * splitmix32, so equal seeds give equal streams on every platform.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Snapshot of the internal state, to resume a stream exactly. */
  state(): [number, number, number, number];
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number | [number, number, number, number]): Rng {
  let a: number, b: number, c: number, d: number;
  if (Array.isArray(seed)) {
    [a, b, c, d] = seed;
  } else {
    const sm = splitmix32(seed);
    a = sm();
    b = sm();
    c = sm();
    d = sm();
  }
  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  // Fresh seeds are warmed up; a resumed state continues exactly where it stopped.
  if (!Array.isArray(seed)) for (let i = 0; i < 12; i++) nextU32();
  return {
    next: () => nextU32() / 4294967296,
    int: (n: number) => Math.floor((nextU32() / 4294967296) * n),
    state: () => [a, b, c, d]
  };
}

/** A seed from a string (FNV-1a), for stable per-game seeds. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
