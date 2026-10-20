/**
 * The distance-field atlas for the live scenes: every 2D piece shape (pieceProfiles.ts) sampled
 * on a regular grid, packed side by side into one float texture. Built in fieldWorker.ts.
 */
import { FIELD_SHAPES, polygonDistance } from './pieceProfiles';
import type { FieldAtlas } from './liveScene';

/** Grid spacing in piece units (a pawn's base has radius 1). */
export const FIELD_STEP = 0.01;
/** Margin around each shape; beyond it the renderer bounds the distance analytically. */
const MARGIN = 0.25;

export function buildFieldAtlas(): FieldAtlas {
  const parts = FIELD_SHAPES.map((s) => {
    const us = s.points.map((p) => p[0]);
    const vs = s.points.map((p) => p[1]);
    const u0 = s.lathe ? 0 : Math.min(...us) - MARGIN;
    const u1 = Math.max(...us) + MARGIN;
    const v0 = Math.min(...vs) - MARGIN;
    const v1 = Math.max(...vs) + MARGIN;
    const w = Math.ceil((u1 - u0) / FIELD_STEP) + 1;
    const h = Math.ceil((v1 - v0) / FIELD_STEP) + 1;
    return { s, u0, v0, u1: u0 + (w - 1) * FIELD_STEP, v1: v0 + (h - 1) * FIELD_STEP, w, h };
  });
  const width = parts.reduce((a, p) => a + p.w, 0);
  const height = Math.max(...parts.map((p) => p.h));
  const data = new Float32Array(width * height).fill(MARGIN);
  const items: FieldAtlas['items'] = [];
  let x0 = 0;
  for (const p of parts) {
    for (let j = 0; j < p.h; j++) {
      const v = p.v0 + j * FIELD_STEP;
      for (let i = 0; i < p.w; i++) {
        data[j * width + x0 + i] = polygonDistance(p.s.points, p.u0 + i * FIELD_STEP, v, p.s.lathe);
      }
    }
    // Texel centres of the first and last samples, so linear filtering reproduces the grid.
    items.push({
      name: p.s.name,
      rect: [(x0 + 0.5) / width, 0.5 / height, (x0 + p.w - 0.5) / width, (p.h - 0.5) / height],
      domain: [p.u0, p.v0, p.u1, p.v1]
    });
    x0 += p.w;
  }
  return { width, height, data, items, margin: MARGIN };
}

