/**
 * CPU sphere tracer. Produces three planes per scene:
 *   subject luminance (un-premultiplied), subject coverage, background luminance.
 * The WebGL layer composites them with separate parallax offsets.
 */
import type { Board, Scene, Vec3 } from './scenes.ts';
import { clamp } from './sdf.ts';

export interface Planes {
  width: number;
  height: number;
  subject: Float32Array;
  alpha: Float32Array;
  background: Float32Array;
}

const MAX_STEPS = 260;
const FAR = 60;

interface Hit {
  t: number;
  /** index into scene.objects, -2 for the board, -1 for a miss */
  id: number;
}

function filteredChecker(u: number, v: number, w: number): number {
  // Box-filtered checkerboard (Quilez); w is the filter width in squares.
  const fw = Math.max(w, 1e-4);
  const tri = (x: number) => {
    const h = x / 2 - Math.floor(x / 2 + 0.5);
    return Math.abs(h) * 2;
  };
  const iu = (tri(u + fw / 2) - tri(u - fw / 2)) / fw;
  const iv = (tri(v + fw / 2) - tri(v - fw / 2)) / fw;
  // iu, iv in [-1, 1]; product sign is the checker.
  return 0.5 - 0.5 * iu * iv;
}

export class Tracer {
  private readonly objects: Scene['objects'];
  private readonly board: Board | undefined;
  private readonly includeSubject: boolean;

  constructor(scene: Scene, includeSubject = true) {
    this.includeSubject = includeSubject;
    this.objects = scene.objects;
    this.board = scene.board && (includeSubject || !scene.board.subject) ? scene.board : undefined;
  }

  /** Scene distance; writes the closest object index to this.lastId. */
  lastId = -1;
  map(x: number, y: number, z: number): number {
    let d = FAR;
    let id = -1;
    if (this.includeSubject) {
      for (let i = 0; i < this.objects.length; i++) {
        const di = this.objects[i]!.sdf(x, y, z);
        if (di < d) {
          d = di;
          id = i;
        }
      }
    }
    const b = this.board;
    if (b) {
      let db = y;
      if (Number.isFinite(b.extent)) {
        const half = b.extent * b.square;
        const ex = Math.abs(x - b.cx) - half;
        const ez = Math.abs(z - b.cz) - half;
        const outside = Math.hypot(Math.max(ex, 0), Math.max(ez, 0));
        db = Math.max(y + 0.0, -y - 0.12);
        // a thin slab of the board's size
        db = Math.max(db, Math.min(Math.max(ex, ez), 0) + outside);
      }
      if (db < d) {
        d = db;
        id = -2;
      }
    }
    this.lastId = id;
    return d;
  }

  march(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Hit {
    let t = 0.02;
    for (let i = 0; i < MAX_STEPS; i++) {
      const d = this.map(ox + dx * t, oy + dy * t, oz + dz * t);
      if (d < 0.0004 * t + 0.0002) return { t, id: this.lastId };
      t += d * 0.82;
      if (t > FAR) break;
    }
    return { t: FAR, id: -1 };
  }

  normal(x: number, y: number, z: number): Vec3 {
    const e = 0.0015;
    const a = this.map(x + e, y - e, z - e);
    const b = this.map(x - e, y - e, z + e);
    const c = this.map(x - e, y + e, z - e);
    const d = this.map(x + e, y + e, z + e);
    const nx = a - b - c + d;
    const ny = -a - b + c + d;
    const nz = -a + b - c + d;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  softShadow(x: number, y: number, z: number, l: Vec3, k: number): number {
    let res = 1;
    let t = 0.03;
    for (let i = 0; i < 64 && t < 12; i++) {
      const h = this.map(x + l[0] * t, y + l[1] * t, z + l[2] * t);
      if (h < 0.0005) return 0;
      res = Math.min(res, (k * h) / t);
      t += clamp(h, 0.02, 0.4);
    }
    return clamp(res, 0, 1);
  }

  ao(x: number, y: number, z: number, n: Vec3): number {
    let occ = 0;
    let sca = 1;
    for (let i = 1; i <= 5; i++) {
      const h = 0.03 + 0.09 * i;
      const d = this.map(x + n[0] * h, y + n[1] * h, z + n[2] * h);
      occ += (h - d) * sca;
      sca *= 0.75;
    }
    return clamp(1 - 2.2 * occ, 0, 1);
  }
}

function voidValue(scene: Scene, u: number, v: number): number {
  const g = scene.void;
  const base = g.bottom + (g.top - g.bottom) * (1 - v);
  const dx = u - g.glowAt[0];
  const dy = (v - g.glowAt[1]) * (scene.height / scene.width);
  const glow = g.glow * Math.exp(-(dx * dx + dy * dy) / 0.06);
  return clamp(base + glow, 0, 1);
}

interface Camera {
  pos: Vec3;
  fwd: Vec3;
  right: Vec3;
  up: Vec3;
  tanHalf: number;
  aspect: number;
}

function camera(scene: Scene): Camera {
  const { pos, target, fov, roll = 0 } = scene.camera;
  let fx = target[0] - pos[0];
  let fy = target[1] - pos[1];
  let fz = target[2] - pos[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = fwd x worldUp
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up = right x fwd
  let ux = ry * fz - rz * fy;
  let uy = rz * fx - rx * fz;
  let uz = rx * fy - ry * fx;
  if (roll) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const nrx = rx * c + ux * s;
    const nry = ry * c + uy * s;
    const nrz = rz * c + uz * s;
    ux = ux * c - rx * s;
    uy = uy * c - ry * s;
    uz = uz * c - rz * s;
    rx = nrx;
    ry = nry;
    rz = nrz;
  }
  return {
    pos,
    fwd: [fx, fy, fz],
    right: [rx, ry, rz],
    up: [ux, uy, uz],
    tanHalf: Math.tan(((fov / 2) * Math.PI) / 180),
    aspect: scene.width / scene.height
  };
}

interface Sample {
  lum: number;
  subject: boolean;
}

function shade(tr: Tracer, scene: Scene, cam: Camera, px: number, py: number, pixelAngle: number): Sample {
  const u = px / scene.width;
  const v = py / scene.height;
  const sx = (2 * u - 1) * cam.tanHalf * cam.aspect;
  const sy = (1 - 2 * v) * cam.tanHalf;
  let dx = cam.fwd[0] + cam.right[0] * sx + cam.up[0] * sy;
  let dy = cam.fwd[1] + cam.right[1] * sx + cam.up[1] * sy;
  let dz = cam.fwd[2] + cam.right[2] * sx + cam.up[2] * sy;
  const dl = Math.hypot(dx, dy, dz);
  dx /= dl;
  dy /= dl;
  dz /= dl;
  const [ox, oy, oz] = cam.pos;
  const hit = tr.march(ox, oy, oz, dx, dy, dz);
  if (hit.id === -1) return { lum: voidValue(scene, u, v), subject: false };

  const x = ox + dx * hit.t;
  const y = oy + dy * hit.t;
  const z = oz + dz * hit.t;
  const n = tr.normal(x, y, z);
  let albedo: number;
  let isSubject: boolean;
  if (hit.id === -2) {
    const b = scene.board!;
    // filter width in squares: pixel footprint grows with distance and grazing angle
    const w = (hit.t * pixelAngle) / Math.max(Math.abs(dy), 0.02) / b.square;
    const c = filteredChecker((x - b.cx) / b.square, (z - b.cz) / b.square, w * 1.5);
    albedo = b.dark + (b.light - b.dark) * c;
    // board edge band
    if (Number.isFinite(b.extent) && y < -0.002) albedo = 0.1;
    isSubject = b.subject;
  } else {
    albedo = scene.objects[hit.id]!.albedo;
    isSubject = scene.objects[hit.id]!.subject;
  }

  const k = scene.key;
  const ndl = Math.max(0, n[0] * k.dir[0] + n[1] * k.dir[1] + n[2] * k.dir[2]);
  const sh = ndl > 0 ? tr.softShadow(x + n[0] * 0.002, y + n[1] * 0.002, z + n[2] * 0.002, k.dir, k.softness) : 0;
  const occ = tr.ao(x, y, z, n);
  const r = scene.rim;
  const ndr = Math.max(0, n[0] * r.dir[0] + n[1] * r.dir[1] + n[2] * r.dir[2]);
  const facing = Math.max(0, -(n[0] * dx + n[1] * dy + n[2] * dz));
  const rim = r.intensity * ndr * (1 - facing) ** 2;
  // Blinn-Phong highlight for polished wood.
  let hx = k.dir[0] - dx;
  let hy = k.dir[1] - dy;
  let hz = k.dir[2] - dz;
  const hl = Math.hypot(hx, hy, hz) || 1;
  hx /= hl;
  hy /= hl;
  hz /= hl;
  const spec = Math.max(0, n[0] * hx + n[1] * hy + n[2] * hz) ** 48 * 0.35 * sh;

  let lum = albedo * (scene.ambient * occ + k.intensity * ndl * sh) + spec + rim * occ;
  if (scene.fog > 0) {
    const f = Math.exp(-scene.fog * hit.t * hit.t * 0.1);
    lum = lum * f + voidValue(scene, u, v) * (1 - f) * 0.6;
  }
  lum = (lum * scene.exposure) / (1 + lum * scene.exposure * 0.35);
  lum = clamp(lum, 0, 1) ** scene.gamma;
  return { lum, subject: isSubject };
}

const JITTER: [number, number][] = [
  [-0.375, -0.125],
  [0.125, -0.375],
  [0.375, 0.125],
  [-0.125, 0.375]
];

export function renderScene(scene: Scene, rows?: [number, number]): Planes {
  const { width: w, height: h } = scene;
  const [r0, r1] = rows ?? [0, h];
  const cam = camera(scene);
  const pixelAngle = (2 * cam.tanHalf) / h;
  const full = new Tracer(scene, true);
  const bgOnly = new Tracer(scene, false);
  const n = w * (r1 - r0);
  const subject = new Float32Array(n);
  const alpha = new Float32Array(n);
  const background = new Float32Array(n);
  const plain = new Float32Array(n);

  // Pass 1: one sample per pixel.
  for (let y = r0; y < r1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y - r0) * w + x;
      const s = shade(full, scene, cam, x + 0.5, y + 0.5, pixelAngle);
      plain[i] = s.lum;
      alpha[i] = s.subject ? 1 : 0;
      subject[i] = s.subject ? s.lum : 0;
      const hasBgGeometry = scene.board !== undefined && !scene.board.subject;
      background[i] = hasBgGeometry
        ? s.subject
          ? shade(bgOnly, scene, cam, x + 0.5, y + 0.5, pixelAngle).lum
          : s.lum
        : voidValue(scene, (x + 0.5) / w, (y + 0.5) / h);
    }
  }

  // Pass 2: supersample silhouette edges and high-contrast pixels.
  const edge = (i: number, j: number) =>
    alpha[i] !== alpha[j] || Math.abs(plain[i]! - plain[j]!) > 0.18;
  for (let y = r0; y < r1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y - r0) * w + x;
      const needs =
        (x > 0 && edge(i, i - 1)) ||
        (x < w - 1 && edge(i, i + 1)) ||
        (y > r0 && edge(i, i - w)) ||
        (y < r1 - 1 && edge(i, i + w));
      if (!needs) continue;
      let lumSum = subject[i]!;
      let count = alpha[i]!;
      for (const [jx, jy] of JITTER) {
        const s = shade(full, scene, cam, x + 0.5 + jx, y + 0.5 + jy, pixelAngle);
        if (s.subject) {
          lumSum += s.lum;
          count += 1;
        }
      }
      alpha[i] = count / 5;
      subject[i] = count > 0 ? lumSum / count : 0;
    }
  }

  // Bleed subject luminance into transparent neighbours so bilinear filtering has no dark fringe.
  for (let y = r0; y < r1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y - r0) * w + x;
      if (alpha[i]! > 0) continue;
      let sum = 0;
      let c = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || xx >= w || yy < r0 || yy >= r1) continue;
          const j = (yy - r0) * w + xx;
          if (alpha[j]! > 0) {
            sum += subject[j]!;
            c++;
          }
        }
      }
      subject[i] = c > 0 ? sum / c : background[i]!;
    }
  }

  return { width: w, height: r1 - r0, subject, alpha, background };
}
