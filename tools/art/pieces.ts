/**
 * Staunton-style chess pieces as signed distance fields. Units: a pawn base has radius 1.
 * Profiles are [radius, height] control polygons smoothed with Chaikin; repeated points
 * keep a crease.
 */
import {
  type SDF,
  chaikin,
  cylinder,
  ellipsoid,
  extrudeZY,
  lathe,
  mix,
  roundBox,
  smax,
  smin,
  sphere
} from './sdf.ts';

type P = [number, number];

/** Shared foot: a rounded base disc with a bead and a cove, ending at the stem. */
function foot(r: number, stemTop: P): P[] {
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

function closeToAxis(points: P[]): P[] {
  const last = points[points.length - 1]!;
  return [...points, [0, last[1]]];
}

export function pawnProfile(): P[] {
  return closeToAxis(
    chaikin(
      [
        ...foot(1, [0.4, 1.0]),
        [0.34, 1.38],
        [0.36, 1.45],
        [0.58, 1.5],
        [0.62, 1.56],
        [0.57, 1.63],
        [0.36, 1.66],
        [0.36, 1.66],
        [0.3, 1.74]
      ],
      3
    )
  );
}

export function pawn(): SDF {
  const body = lathe(pawnProfile());
  const head = sphere(0, 2.13, 0, 0.52);
  return (x, y, z) => smin(body(x, y, z), head(x, y, z), 0.06);
}

export function rook(): SDF {
  const body = lathe(
    closeToAxis(
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
    )
  );
  const hollow = cylinder(0, 0, 0.52, 2.38, 3.0);
  const slots: SDF[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const slot = roundBox(0, 2.62, 0, 1.0, 0.24, 0.11, 0.02);
    slots.push((x, y, z) => slot(c * x - s * z, y, s * x + c * z));
  }
  return (x, y, z) => {
    let d = body(x, y, z);
    d = smax(d, -hollow(x, y, z), 0.02);
    for (const sl of slots) d = smax(d, -sl(x, y, z), 0.02);
    return d;
  };
}

export function bishopProfile(): P[] {
  return closeToAxis(
    chaikin(
      [
        ...foot(1.02, [0.42, 1.0]),
        [0.33, 1.7],
        [0.36, 1.82],
        [0.62, 1.88],
        [0.66, 1.94],
        [0.6, 2.0],
        [0.38, 2.03],
        [0.38, 2.03],
        [0.42, 2.12]
      ],
      3
    )
  );
}

export function bishop(): SDF {
  const body = lathe(bishopProfile());
  const mitre = ellipsoid(0, 2.62, 0, 0.5, 0.62, 0.5);
  const tip = ellipsoid(0, 3.2, 0, 0.13, 0.17, 0.13);
  const point = sphere(0, 3.4, 0, 0.12);
  // The slit: a thin slab tilted 40 degrees, cut into the front of the mitre.
  const a = (40 * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const slab = roundBox(0, 0, 0.42, 0.045, 0.6, 0.42, 0.01);
  const slit: SDF = (x, y, z) => {
    const yy = y - 2.78;
    return slab(ca * x + sa * yy, -sa * x + ca * yy, z);
  };
  return (x, y, z) => {
    let d = smin(body(x, y, z), mitre(x, y, z), 0.08);
    // Sharpen the mitre toward its tip.
    d = smin(d, tip(x, y, z), 0.12);
    d = smax(d, -slit(x, y, z), 0.015);
    return Math.min(d, point(x, y, z));
  };
}

export function queenProfile(): P[] {
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

export function queen(): SDF {
  const body = lathe(queenProfile());
  const dome = ellipsoid(0, 3.36, 0, 0.5, 0.26, 0.5);
  const ball = sphere(0, 3.72, 0, 0.17);
  const notches: SDF[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    notches.push(sphere(Math.cos(a) * 0.76, 3.4, Math.sin(a) * 0.76, 0.2));
  }
  return (x, y, z) => {
    let d = smin(body(x, y, z), dome(x, y, z), 0.05);
    for (const n of notches) d = smax(d, -n(x, y, z), 0.03);
    return smin(d, ball(x, y, z), 0.05);
  };
}

export function king(): SDF {
  const body = lathe(
    closeToAxis(
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
    )
  );
  const upright = roundBox(0, 4.12, 0, 0.1, 0.36, 0.1, 0.03);
  const bar = roundBox(0, 4.18, 0, 0.3, 0.1, 0.1, 0.03);
  return (x, y, z) => {
    const cross = Math.min(upright(x, y, z), bar(x, y, z));
    return smin(body(x, y, z), cross, 0.04);
  };
}

/** Knight head silhouette in the (z, y) plane, snout towards +z. */
const KNIGHT_HEAD: P[] = chaikin(
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

export function knight(): SDF {
  const base = lathe(
    closeToAxis(chaikin([...foot(1.12, [0.78, 0.72]), [0.8, 0.82], [0.8, 0.82], [0.7, 0.9], [0.7, 1.05]], 3))
  );
  // C1 ramps so the taper never creases the surface.
  const ramp = (v: number, k: number) => (v > 0 ? (v * v) / (v + k) : 0);
  const head = extrudeZY(
    KNIGHT_HEAD,
    (z, y) => {
      // Broad at the neck and cheek, narrower at the muzzle and the top of the head.
      const muzzle = 0.16 * ramp(z - 0.15, 0.35);
      const crown = 0.22 * ramp(y - 2.55, 0.25);
      const cheek = 0.06 * Math.exp(-((y - 2.35) ** 2) / 0.08 - ((z - 0.1) ** 2) / 0.12);
      return 0.4 + cheek - muzzle - crown;
    },
    0.13
  );
  const eyes = [sphere(0.34, 2.72, 0.36, 0.085), sphere(-0.34, 2.72, 0.36, 0.085)];
  const nostrils = [sphere(0.15, 2.06, 1.13, 0.055), sphere(-0.15, 2.06, 1.13, 0.055)];
  const grooves: SDF[] = [];
  for (let i = 0; i < 6; i++) {
    const y = 1.55 + i * 0.26;
    const z = -0.86 + Math.abs(i - 2) * 0.03;
    grooves.push(ellipsoid(0, y, z, 0.5, 0.028, 0.06));
  }
  return (x, y, z) => {
    let d = smin(base(x, y, z), head(x, y, z), 0.1);
    if (d > 0.3) return d;
    for (const e of eyes) d = smax(d, -e(x, y, z), 0.025);
    for (const n of nostrils) d = smax(d, -n(x, y, z), 0.02);
    for (const g of grooves) d = smax(d, -g(x, y, z), 0.03);
    return d;
  };
}

/** Pawn-to-queen morph: blend the two fields, with the queen raised to keep the base shared. */
export function promotion(t: number): SDF {
  const p = pawn();
  const q = queen();
  const e = t * t * (3 - 2 * t);
  return (x, y, z) => mix(p(x, y, z), q(x, y, z), e);
}

export const PIECES = { pawn, rook, bishop, queen, king, knight } as const;
export type PieceName = keyof typeof PIECES;
