/**
 * The shapes of the Staunton-style pieces, shared by the offline renderer (tools/art/pieces.ts,
 * signed distance fields for the still images) and the live renderer (liveScene.ts, which turns
 * the same profiles into distance-field textures). Units: a pawn's base has radius 1. Profiles
 * are [radius, height] control polygons smoothed with Chaikin; a repeated point keeps a crease.
 */

export type P2 = [number, number];

/** Chaikin corner cutting; endpoints stay fixed. Repeating a control point keeps a corner sharp. */
export function chaikin(points: P2[], iterations: number): P2[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: P2[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[i + 1]!;
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

/** Shared foot: a rounded base disc with a bead and a cove, ending at the stem. */
function foot(r: number, stemTop: P2): P2[] {
  return [
    [0, 0],
    [r * 0.97, 0],
    [r, 0.03],
    [r, 0.12],
    [r * 0.96, 0.17],
    [r * 0.86, 0.2],
    [r * 0.86, 0.2],
    [r * 0.9, 0.27],
    [r * 0.84, 0.34],
    [r * 0.7, 0.38],
    [r * 0.7, 0.38],
    [r * 0.62, 0.46],
    [r * 0.48, 0.62],
    stemTop
  ];
}

function closeToAxis(points: P2[]): P2[] {
  const last = points[points.length - 1]!;
  return [...points, [0, last[1]]];
}

export function pawnProfile(): P2[] {
  return closeToAxis(
    chaikin([...foot(1, [0.4, 1.0]), [0.34, 1.38], [0.36, 1.45], [0.58, 1.5], [0.62, 1.56], [0.57, 1.63], [0.36, 1.66], [0.36, 1.66], [0.3, 1.74]], 3)
  );
}

export function rookProfile(): P2[] {
  return closeToAxis(
    chaikin(
      [
        ...foot(1.08, [0.62, 0.9]),
        [0.56, 1.5],
        [0.58, 1.8],
        [0.7, 1.86],
        [0.74, 1.92],
        [0.7, 1.98],
        [0.66, 2.02],
        [0.72, 2.12],
        [0.76, 2.2],
        [0.76, 2.62],
        [0.76, 2.62],
        [0.72, 2.66]
      ],
      3
    )
  );
}

export function bishopProfile(): P2[] {
  return closeToAxis(
    chaikin([...foot(1.02, [0.42, 1.0]), [0.33, 1.7], [0.36, 1.82], [0.62, 1.88], [0.66, 1.94], [0.6, 2.0], [0.38, 2.03], [0.38, 2.03], [0.42, 2.12]], 3)
  );
}

export function queenProfile(): P2[] {
  return closeToAxis(
    chaikin(
      [
        ...foot(1.15, [0.48, 1.05]),
        [0.36, 2.2],
        [0.36, 2.4],
        [0.66, 2.48],
        [0.7, 2.55],
        [0.62, 2.62],
        [0.42, 2.66],
        [0.42, 2.66],
        [0.44, 2.75],
        [0.58, 3.0],
        [0.72, 3.22],
        [0.74, 3.28],
        [0.6, 3.3],
        [0.6, 3.3],
        [0.5, 3.36]
      ],
      3
    )
  );
}

export function kingProfile(): P2[] {
  return closeToAxis(
    chaikin(
      [
        ...foot(1.18, [0.5, 1.08]),
        [0.38, 2.36],
        [0.38, 2.56],
        [0.68, 2.64],
        [0.72, 2.71],
        [0.64, 2.78],
        [0.44, 2.82],
        [0.44, 2.82],
        [0.46, 2.9],
        [0.62, 3.2],
        [0.7, 3.42],
        [0.7, 3.46],
        [0.56, 3.5],
        [0.56, 3.5],
        [0.46, 3.62],
        [0.2, 3.72],
        [0.2, 3.72],
        [0.14, 3.8]
      ],
      3
    )
  );
}

export function knightBaseProfile(): P2[] {
  return closeToAxis(chaikin([...foot(1.12, [0.78, 0.72]), [0.8, 0.82], [0.8, 0.82], [0.7, 0.9], [0.7, 1.05]], 3));
}

/** Knight head silhouette in the (z, y) plane, snout towards +z. */
export const KNIGHT_HEAD: P2[] = chaikin(
  [
    [-0.72, 1.0],
    [-0.8, 1.45],
    [-0.88, 1.9],
    [-0.84, 2.3],
    [-0.7, 2.66],
    [-0.5, 2.94],
    [-0.42, 3.1],
    [-0.36, 3.42],
    [-0.36, 3.42],
    [-0.18, 3.16],
    [-0.18, 3.16],
    [0.06, 3.14],
    [0.34, 3.0],
    [0.62, 2.78],
    [0.88, 2.5],
    [1.06, 2.3],
    [1.16, 2.12],
    [1.16, 2.12],
    [1.16, 1.96],
    [1.06, 1.86],
    [1.06, 1.86],
    [0.86, 1.86],
    [0.62, 1.92],
    [0.46, 1.98],
    [0.46, 1.98],
    [0.38, 1.82],
    [0.44, 1.58],
    [0.6, 1.36],
    [0.64, 1.0]
  ],
  2
);

/** Half thickness of the knight's head at (z, y): broad at neck and cheek, narrower at muzzle and crown. */
export function knightHalfThickness(z: number, y: number): number {
  // C1 ramps so the taper never creases the surface.
  const ramp = (v: number, k: number) => (v > 0 ? (v * v) / (v + k) : 0);
  const muzzle = 0.16 * ramp(z - 0.15, 0.35);
  const crown = 0.22 * ramp(y - 2.55, 0.25);
  const cheek = 0.06 * Math.exp(-((y - 2.35) ** 2) / 0.08 - (z - 0.1) ** 2 / 0.12);
  return 0.4 + cheek - muzzle - crown;
}

/** Edge rounding of the knight's head. */
export const KNIGHT_ROUND = 0.13;

/**
 * The 2D shapes the live renderer keeps as distance fields: the six lathe profiles (in
 * (radius, height)) and the knight's head (in (z, height)), in a fixed order.
 */
export const FIELD_SHAPES: { name: string; points: P2[]; lathe: boolean }[] = [
  { name: 'pawn', points: pawnProfile(), lathe: true },
  { name: 'rook', points: rookProfile(), lathe: true },
  { name: 'bishop', points: bishopProfile(), lathe: true },
  { name: 'queen', points: queenProfile(), lathe: true },
  { name: 'king', points: kingProfile(), lathe: true },
  { name: 'knight-base', points: knightBaseProfile(), lathe: true },
  { name: 'knight-head', points: KNIGHT_HEAD, lathe: false }
];

/**
 * Signed distance to a closed polygon, negative inside. For a lathe profile the closing edge
 * runs along the axis, inside the solid, so it is not a surface (`openClosingEdge`).
 */
export function polygonDistance(points: readonly P2[], u: number, v: number, openClosingEdge: boolean): number {
  const n = points.length;
  let best = Infinity;
  let inside = false;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % n]!;
    const ex = x1 - x0;
    const ey = y1 - y0;
    const l2 = ex * ex + ey * ey;
    const wx = u - x0;
    const wy = v - y0;
    const t = l2 > 0 ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / l2)) : 0;
    const dx = wx - ex * t;
    const dy = wy - ey * t;
    const d = dx * dx + dy * dy;
    if (d < best && !(openClosingEdge && i === n - 1)) best = d;
    if (y0 > v !== y1 > v) {
      const xc = x0 + ((v - y0) / (y1 - y0)) * ex;
      if (u < xc) inside = !inside;
    }
  }
  const d = Math.sqrt(best);
  return inside ? -d : d;
}
