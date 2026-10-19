/**
 * Chess piece meshes for the live 3D layer (stage3d.ts): turned pieces are lathed from a
 * profile, the knight's head is an extruded side profile on a turned base. Units: the board
 * square is 1, pieces stand on y = 0 and face +x.
 */

export type PieceKind = 'pawn' | 'rook' | 'bishop' | 'queen' | 'king' | 'knight';

export interface Mesh {
  /** xyz per vertex. */
  positions: Float32Array;
  /** xyz per vertex, unit length. */
  normals: Float32Array;
  indices: Uint32Array;
}

type P2 = readonly [number, number];

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];

  vertex(p: readonly number[], n: readonly number[]): number {
    this.pos.push(p[0]!, p[1]!, p[2]!);
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    this.nrm.push(n[0]! / l, n[1]! / l, n[2]! / l);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  mesh(): Mesh {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), indices: new Uint32Array(this.idx) };
  }
}

/** Points along an arc of a circle centred (cx, cy), radius r, from angle a0 to a1 (radians). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): P2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
}

/**
 * Turn a profile (radius, height), bottom to top, around the y axis. Normals come from the
 * profile's slope, smoothed at each point except where the profile turns sharply.
 */
function lathe(b: Builder, profile: readonly P2[], segments = 56, offset: readonly [number, number, number] = [0, 0, 0]): void {
  const n = profile.length;
  // 2D outward normal of each segment (dr, dy) -> (dy, -dr).
  const segN = profile.slice(0, -1).map((p, i) => {
    const q = profile[i + 1]!;
    const dr = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l] as const;
  });
  // A sharp corner gets two rings (one normal per side); a smooth point one averaged ring.
  const rings: { p: P2; n: readonly [number, number] }[] = [];
  for (let i = 0; i < n; i++) {
    const a = segN[i - 1];
    const c = segN[i];
    if (a && c && a[0] * c[0] + a[1] * c[1] < 0.8) {
      rings.push({ p: profile[i]!, n: a }, { p: profile[i]!, n: c });
    } else {
      const m = a && c ? [a[0] + c[0], a[1] + c[1]] : (a ?? c)!;
      const l = Math.hypot(m[0]!, m[1]!) || 1;
      rings.push({ p: profile[i]!, n: [m[0]! / l, m[1]! / l] });
    }
  }
  const start: number[] = [];
  for (const ring of rings) {
    start.push(b.pos.length / 3);
    for (let s = 0; s <= segments; s++) {
      const t = (s / segments) * Math.PI * 2;
      const c = Math.cos(t);
      const si = Math.sin(t);
      b.vertex([ring.p[0] * c + offset[0], ring.p[1] + offset[1], ring.p[0] * si + offset[2]], [ring.n[0] * c, ring.n[1], ring.n[0] * si]);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    // Two rings at the same point are a crease, not a band.
    if (rings[r]!.p === rings[r + 1]!.p) continue;
    for (let s = 0; s < segments; s++) {
      const a = start[r]! + s;
      const c = start[r + 1]! + s;
      b.tri(a, c, a + 1);
      b.tri(a + 1, c, c + 1);
    }
  }
}

/** An axis-aligned box centred at c with half sizes h, flat-shaded. */
function box(b: Builder, c: readonly number[], h: readonly number[]): void {
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
  ];
  for (const [n, u, v] of faces) {
    const corner = (su: number, sv: number) =>
      [0, 1, 2].map((k) => c[k]! + (n[k]! + u[k]! * su + v[k]! * sv) * h[k]!);
    const i = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map((p) => b.vertex(p, n));
    b.tri(i[0]!, i[1]!, i[2]!);
    b.tri(i[0]!, i[2]!, i[3]!);
  }
}

/** Ear-clipping triangulation of a simple counter-clockwise polygon. */
export function triangulate(poly: readonly P2[]): [number, number, number][] {
  const idx = poly.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!;
      const ib = idx[i]!;
      const ic = idx[(i + 1) % idx.length]!;
      const [a, b, c] = [poly[ia]!, poly[ib]!, poly[ic]!];
      if (cross(a, b, c) <= 1e-9) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(poly[j]!, a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

/** Extrude a counter-clockwise profile in the xy plane to z = ±depth. */
function extrude(b: Builder, poly: readonly P2[], depth: number): void {
  const tris = triangulate(poly);
  for (const side of [1, -1]) {
    const base = poly.map((p) => b.vertex([p[0], p[1], side * depth], [0, 0, side]));
    for (const [i, j, k] of tris) {
      if (side > 0) b.tri(base[i]!, base[j]!, base[k]!);
      else b.tri(base[i]!, base[k]!, base[j]!);
    }
  }
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const n = [q[1] - p[1], -(q[0] - p[0]), 0];
    const v = [
      b.vertex([p[0], p[1], depth], n),
      b.vertex([q[0], q[1], depth], n),
      b.vertex([q[0], q[1], -depth], n),
      b.vertex([p[0], p[1], -depth], n)
    ];
    b.tri(v[0]!, v[3]!, v[1]!);
    b.tri(v[1]!, v[3]!, v[2]!);
  }
}

/** The shared foot: a flat disc with a rounded plinth. */
const FOOT: P2[] = [
  [0, 0],
  [0.4, 0],
  [0.42, 0.02],
  [0.42, 0.07],
  [0.38, 0.1],
  [0.36, 0.13],
  [0.3, 0.16],
  [0.26, 0.2]
];

function profileOf(kind: Exclude<PieceKind, 'knight'>): P2[] {
  switch (kind) {
    case 'pawn':
      return [...FOOT, [0.2, 0.3], [0.15, 0.44], [0.13, 0.52], [0.22, 0.56], [0.22, 0.6], [0.12, 0.63], ...arc(0, 0.8, 0.19, -1.25, Math.PI / 2, 12)];
    case 'rook':
      return [...FOOT, [0.25, 0.3], [0.24, 0.62], [0.26, 0.72], [0.33, 0.8], [0.34, 0.98], [0.25, 0.98], [0.25, 0.9], [0, 0.9]];
    case 'bishop':
      return [
        ...FOOT,
        [0.18, 0.34],
        [0.13, 0.52],
        [0.24, 0.57],
        [0.24, 0.61],
        [0.14, 0.64],
        [0.19, 0.74],
        [0.2, 0.84],
        [0.15, 0.96],
        [0.06, 1.06],
        [0.05, 1.08],
        ...arc(0, 1.13, 0.055, -1.2, Math.PI / 2, 8)
      ];
    case 'queen':
      return [
        ...FOOT,
        [0.2, 0.36],
        [0.15, 0.6],
        [0.27, 0.66],
        [0.27, 0.7],
        [0.17, 0.74],
        [0.2, 0.9],
        [0.3, 1.04],
        [0.26, 1.06],
        [0.16, 1.08],
        [0.14, 1.12],
        ...arc(0, 1.19, 0.07, -1.2, Math.PI / 2, 8)
      ];
    case 'king':
      return [
        ...FOOT,
        [0.21, 0.36],
        [0.16, 0.62],
        [0.28, 0.68],
        [0.28, 0.72],
        [0.17, 0.76],
        [0.2, 0.92],
        [0.27, 1.06],
        [0.2, 1.12],
        [0.1, 1.15],
        [0, 1.16]
      ];
  }
}

/** The knight's head and neck, side view, facing +x (counter-clockwise). */
const KNIGHT_HEAD: P2[] = [
  [-0.26, 0.18],
  [0.26, 0.18],
  [0.24, 0.36],
  [0.14, 0.5],
  [0.26, 0.58],
  [0.4, 0.66],
  [0.45, 0.74],
  [0.42, 0.8],
  [0.3, 0.82],
  [0.18, 0.78],
  [0.12, 0.84],
  [0.1, 0.96],
  [0.04, 1.06],
  [-0.04, 1.14],
  [-0.08, 1.04],
  [-0.18, 0.98],
  [-0.27, 0.82],
  [-0.3, 0.6],
  [-0.29, 0.4]
];

export function pieceMesh(kind: PieceKind): Mesh {
  const b = new Builder();
  if (kind === 'knight') {
    lathe(b, FOOT);
    extrude(b, KNIGHT_HEAD, 0.15);
    return b.mesh();
  }
  lathe(b, profileOf(kind));
  if (kind === 'queen') {
    // A ring of small balls on the crown's rim.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      lathe(b, arc(0, 0, 0.045, -Math.PI / 2, Math.PI / 2, 6), 14, [0.29 * Math.cos(a), 1.06, 0.29 * Math.sin(a)]);
    }
  } else if (kind === 'king') {
    box(b, [0, 1.27, 0], [0.035, 0.12, 0.035]);
    box(b, [0, 1.3, 0], [0.1, 0.035, 0.035]);
  } else if (kind === 'rook') {
    // Battlements: four merlons on the rim.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      box(b, [0.29 * Math.cos(a), 1.03, 0.29 * Math.sin(a)], [0.06, 0.05, 0.06]);
    }
  }
  return b.mesh();
}

/** Which piece floats over each scene of the home screen. */
export const SCENE_PIECE: Record<string, PieceKind> = {
  hero: 'knight',
  'pawn-crown': 'pawn',
  coronet: 'queen',
  fork: 'knight',
  'rook-crown': 'rook',
  'board-rake': 'bishop',
  mitre: 'bishop',
  'kings-cross': 'king',
  'pawn-chain': 'pawn',
  outpost: 'knight',
  'toppled-king': 'king',
  'knight-profile': 'knight',
  'queen-tower': 'queen',
  'king-queen': 'king',
  citadel: 'rook'
};
