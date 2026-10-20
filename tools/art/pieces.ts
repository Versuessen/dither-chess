/**
 * Staunton-style chess pieces as signed distance fields, for the offline still images. The
 * profiles are shared with the live renderer (src/dither/pieceProfiles.ts); the cuts and added
 * parts here have their GLSL twins in src/dither/liveScene.ts. Units: a pawn base has radius 1.
 */
import {
  type SDF,
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
import {
  KNIGHT_HEAD,
  KNIGHT_ROUND,
  bishopProfile,
  kingProfile,
  knightBaseProfile,
  knightHalfThickness,
  pawnProfile,
  queenProfile,
  rookProfile
} from '../../src/dither/pieceProfiles.ts';

export function pawn(): SDF {
  const body = lathe(pawnProfile());
  const head = sphere(0, 2.13, 0, 0.52);
  return (x, y, z) => smin(body(x, y, z), head(x, y, z), 0.06);
}

export function rook(): SDF {
  const body = lathe(rookProfile());
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
  const body = lathe(kingProfile());
  const upright = roundBox(0, 4.12, 0, 0.1, 0.36, 0.1, 0.03);
  const bar = roundBox(0, 4.18, 0, 0.3, 0.1, 0.1, 0.03);
  return (x, y, z) => {
    const cross = Math.min(upright(x, y, z), bar(x, y, z));
    return smin(body(x, y, z), cross, 0.04);
  };
}

export function knight(): SDF {
  const base = lathe(knightBaseProfile());
  const head = extrudeZY(KNIGHT_HEAD, knightHalfThickness, KNIGHT_ROUND);
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
