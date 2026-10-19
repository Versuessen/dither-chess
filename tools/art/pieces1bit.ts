/**
 * The optional 1-bit dithered piece set: each SDF piece is traced orthographically from the
 * side, shaded, then reduced to two inks with a 4x4 Bayer matrix. Output: 12 crisp SVGs in
 * public/pieces/dither/ built from horizontal pixel runs.
 *
 *   node tools/art/pieces1bit.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIECES, type PieceName } from './pieces.ts';
import { place, type SDF } from './sdf.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/pieces/dither');
const N = 48;
const WORLD = 4.78; // world units across the cell
const INK = '#111111';
const PAPER = '#f4f4ef';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
].map((r) => r.map((v) => (v + 0.5) / 16));

const LIGHT = (() => {
  const v = [-0.65, 0.55, 0.55];
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as [number, number, number];
})();

function trace(sdf: SDF, wx: number, wy: number): { hit: boolean; shade: number } {
  let z = 4;
  for (let i = 0; i < 160; i++) {
    const d = sdf(wx, wy, z);
    if (d < 0.0008) {
      const e = 0.002;
      const nx = sdf(wx + e, wy, z) - sdf(wx - e, wy, z);
      const ny = sdf(wx, wy + e, z) - sdf(wx, wy - e, z);
      const nz = sdf(wx, wy, z + e) - sdf(wx, wy, z - e);
      const l = Math.hypot(nx, ny, nz) || 1;
      const ndl = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / l);
      return { hit: true, shade: 0.18 + 0.82 * ndl };
    }
    z -= d * 0.9;
    if (z < -4) break;
  }
  return { hit: false, shade: 0 };
}

type Px = 0 | 1 | 2; // 0 transparent, 1 ink, 2 paper

function render(sdf: SDF, white: boolean): Px[][] {
  const cov: number[][] = [];
  const shade: number[][] = [];
  const S = 4;
  for (let y = 0; y < N; y++) {
    cov.push([]);
    shade.push([]);
    for (let x = 0; x < N; x++) {
      let c = 0;
      let s = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const wx = ((x + (sx + 0.5) / S) / N - 0.5) * WORLD;
          const wy = (1 - (y + (sy + 0.5) / S) / N) * WORLD - 0.1;
          const r = trace(sdf, wx, wy);
          if (r.hit) {
            c++;
            s += r.shade;
          }
        }
      }
      cov[y]!.push(c / (S * S));
      shade[y]!.push(c ? s / c : 0);
    }
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && cov[y]![x]! >= 0.45;
  const img: Px[][] = [];
  for (let y = 0; y < N; y++) {
    const row: Px[] = [];
    for (let x = 0; x < N; x++) {
      if (!inside(x, y)) {
        row.push(0);
        continue;
      }
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) {
        row.push(1);
        continue;
      }
      const t = BAYER[y % 4]![x % 4]!;
      const s = shade[y]![x]!;
      // White pieces: paper with dithered shadows. Black pieces: ink with dithered highlights.
      if (white) row.push(s < t * 0.62 ? 1 : 2);
      else row.push(s > 0.55 + t * 0.45 ? 2 : 1);
    }
    img.push(row);
  }
  return img;
}

function runs(img: Px[][], value: Px): string {
  let d = '';
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      if (img[y]![x] !== value) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < N && img[y]![x] === value) x++;
      d += `M${x0} ${y}h${x - x0}v1h${x0 - x}z`;
    }
  }
  return d;
}

function svg(img: Px[][]): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">` +
    `<path fill="${PAPER}" d="${runs(img, 2)}"/><path fill="${INK}" d="${runs(img, 1)}"/></svg>\n`
  );
}

const LETTER: Record<PieceName, string> = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };

mkdirSync(OUT, { recursive: true });
for (const name of Object.keys(PIECES) as PieceName[]) {
  let sdf = PIECES[name]();
  // Diagram convention: knights look to the left.
  if (name === 'knight') sdf = place(sdf, { yaw: -Math.PI / 2 });
  for (const white of [true, false]) {
    const file = `${white ? 'w' : 'b'}${LETTER[name]}.svg`;
    writeFileSync(join(OUT, file), svg(render(sdf, white)));
    console.log(file);
  }
}
