/**
 * Signed distance functions for the build-time art renderer. Everything works on plain
 * numbers (no vector objects) because the raymarcher calls these tens of millions of times.
 */

export type SDF = (x: number, y: number, z: number) => number;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

export function sphere(cx: number, cy: number, cz: number, r: number): SDF {
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
}

export function ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): SDF {
  // Bound-correct approximation (Quilez).
  return (x, y, z) => {
    const px = (x - cx) / rx;
    const py = (y - cy) / ry;
    const pz = (z - cz) / rz;
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / rx, py / ry, pz / rz);
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
}

/** Axis-aligned rounded box centred at c with half extents h. */
export function roundBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, r: number): SDF {
  return (x, y, z) => {
    const qx = Math.abs(x - cx) - hx + r;
    const qy = Math.abs(y - cy) - hy + r;
    const qz = Math.abs(z - cz) - hz + r;
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
}

/** Vertical capped cylinder around the y axis. */
export function cylinder(cx: number, cz: number, r: number, y0: number, y1: number): SDF {
  const cy = (y0 + y1) / 2;
  const hh = (y1 - y0) / 2;
  return (x, y, z) => {
    const dr = Math.hypot(x - cx, z - cz) - r;
    const dy = Math.abs(y - cy) - hh;
    return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
  };
}

export function plane(y0: number): SDF {
  return (_x, y) => y - y0;
}

/** Chaikin corner cutting; endpoints stay fixed. Repeating a control point keeps a corner sharp. */
export function chaikin(points: [number, number][], iterations: number): [number, number][] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: [number, number][] = [pts[0]!];
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

/**
 * Signed distance to a closed 2D polygon (array of [u, v]), negative inside.
 * Returned as a reusable closure with precomputed segments.
 */
export function polygon2D(points: [number, number][], openClosingEdge = false): (u: number, v: number) => number {
  const n = points.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const ex = new Float64Array(n);
  const ey = new Float64Array(n);
  const inv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % n]!;
    ax[i] = x0;
    ay[i] = y0;
    ex[i] = x1 - x0;
    ey[i] = y1 - y0;
    const l2 = ex[i]! * ex[i]! + ey[i]! * ey[i]!;
    inv[i] = l2 > 0 ? 1 / l2 : 0;
  }
  return (u, v) => {
    let best = Infinity;
    let inside = false;
    for (let i = 0; i < n; i++) {
      const wx = u - ax[i]!;
      const wy = v - ay[i]!;
      const t = clamp((wx * ex[i]! + wy * ey[i]!) * inv[i]!, 0, 1);
      const dx = wx - ex[i]! * t;
      const dy = wy - ey[i]! * t;
      const d = dx * dx + dy * dy;
      // A lathe's closing edge runs along the axis: inside the solid, not a surface.
      if (d < best && !(openClosingEdge && i === n - 1)) best = d;
      const y0 = ay[i]!;
      const y1 = y0 + ey[i]!;
      if (y0 > v !== y1 > v) {
        const xc = ax[i]! + ((v - y0) / (y1 - y0)) * ex[i]!;
        if (u < xc) inside = !inside;
      }
    }
    const d = Math.sqrt(best);
    return inside ? -d : d;
  };
}

/**
 * Solid of revolution around the y axis. `profile` runs from the axis at the bottom to the
 * axis at the top as [radius, height] pairs.
 */
export function lathe(profile: [number, number][]): SDF {
  const poly = polygon2D(profile, true);
  let rMax = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [r, y] of profile) {
    rMax = Math.max(rMax, r);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  const bound = cylinder(0, 0, rMax, yMin, yMax);
  return (x, y, z) => {
    const b = bound(x, y, z);
    if (b > 0.25) return b;
    return poly(Math.hypot(x, z), y);
  };
}

/**
 * Extrude a 2D polygon given in the (z, y) plane along x with a half thickness that may vary
 * with position, then round the edges.
 */
export function extrudeZY(
  points: [number, number][],
  halfThickness: (z: number, y: number) => number,
  round: number
): SDF {
  const poly = polygon2D(points);
  let zMin = Infinity;
  let zMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let tMax = 0;
  for (const [z, y] of points) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    tMax = Math.max(tMax, halfThickness(z, y));
  }
  const bound = roundBox(0, (yMin + yMax) / 2, (zMin + zMax) / 2, tMax + 0.05, (yMax - yMin) / 2, (zMax - zMin) / 2, 0);
  return (x, y, z) => {
    const b = bound(x, y, z);
    if (b > 0.2) return b;
    const d2 = poly(z, y) + round;
    const dx = Math.abs(x) - halfThickness(z, y) + round;
    return Math.min(Math.max(d2, dx), 0) + Math.hypot(Math.max(d2, 0), Math.max(dx, 0)) - round;
  };
}

/** Rotation (yaw about y, then pitch about x, then roll about z) + translation + uniform scale. */
export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  scale?: number;
}

export function place(sdf: SDF, p: Placement): SDF {
  const tx = p.x ?? 0;
  const ty = p.y ?? 0;
  const tz = p.z ?? 0;
  const s = p.scale ?? 1;
  const cy = Math.cos(p.yaw ?? 0);
  const sy = Math.sin(p.yaw ?? 0);
  const cp = Math.cos(p.pitch ?? 0);
  const sp = Math.sin(p.pitch ?? 0);
  const cr = Math.cos(p.roll ?? 0);
  const sr = Math.sin(p.roll ?? 0);
  // World = T * Ryaw * Rpitch * Rroll * S * local  ->  local = S^-1 * R^T * (world - T)
  // R = Ry * Rx * Rz
  const m00 = cy * cr + sy * sp * sr;
  const m01 = -cy * sr + sy * sp * cr;
  const m02 = sy * cp;
  const m10 = cp * sr;
  const m11 = cp * cr;
  const m12 = -sp;
  const m20 = -sy * cr + cy * sp * sr;
  const m21 = sy * sr + cy * sp * cr;
  const m22 = cy * cp;
  return (x, y, z) => {
    const wx = x - tx;
    const wy = y - ty;
    const wz = z - tz;
    // R^T * w
    const lx = (m00 * wx + m10 * wy + m20 * wz) / s;
    const ly = (m01 * wx + m11 * wy + m21 * wz) / s;
    const lz = (m02 * wx + m12 * wy + m22 * wz) / s;
    return sdf(lx, ly, lz) * s;
  };
}
