import { describe, expect, it } from 'vitest';
import { SCENE_PIECE, pieceMesh, triangulate, type PieceKind } from './pieces3d';
import { ART } from './art';

describe('3D piece meshes', () => {
  it('builds every piece as a valid indexed mesh with unit normals', () => {
    for (const kind of ['pawn', 'rook', 'bishop', 'queen', 'king', 'knight'] as PieceKind[]) {
      const m = pieceMesh(kind);
      const n = m.positions.length / 3;
      expect(n, kind).toBeGreaterThan(100);
      expect(m.indices.length % 3).toBe(0);
      expect(Math.max(...m.indices)).toBeLessThan(n);
      for (let i = 0; i < n; i += 37) {
        expect(Math.hypot(m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!)).toBeCloseTo(1, 5);
      }
      // Stands on the board, about one to one and a half squares tall.
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < m.positions.length; i += 3) {
        lo = Math.min(lo, m.positions[i]!);
        hi = Math.max(hi, m.positions[i]!);
      }
      expect(lo).toBeCloseTo(0, 5);
      expect(hi).toBeGreaterThan(0.95);
      expect(hi).toBeLessThan(1.4);
    }
  });

  it('triangulates a concave outline completely', () => {
    const l = [
      [0, 0],
      [2, 0],
      [2, 2],
      [1, 1],
      [0, 2]
    ] as const;
    const tris = triangulate(l);
    expect(tris).toHaveLength(3);
    const area = tris.reduce((a, [i, j, k]) => {
      const [p, q, r] = [l[i]!, l[j]!, l[k]!];
      return a + ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
    }, 0);
    expect(area).toBeCloseTo(3, 9);
  });

  it('has a piece for every scene on the home screen', () => {
    for (const id of Object.keys(ART.scenes)) expect(SCENE_PIECE[id], id).toBeDefined();
  });
});
