import { describe, expect, it } from 'vitest';
import { buildFieldAtlas } from '../../src/dither/fields';
import { FIELD_SHAPES, polygonDistance } from '../../src/dither/pieceProfiles';
import { SCENE_SPECS, sceneSpec } from '../../src/dither/sceneSpecs';
import { ART } from '../../src/dither/art';
import { HOME_SUBJECT, PERSONAS } from '../../src/bots/personas';

describe('live scene staging', () => {
  it('has a scene for every still image and every opponent', () => {
    for (const id of Object.keys(ART.scenes)) expect(sceneSpec(id), id).toBeDefined();
    for (const id of [HOME_SUBJECT, ...PERSONAS.map((p) => p.subject)]) expect(sceneSpec(id), id).toBeDefined();
  });

  it('keeps each still image framing (same focal point)', () => {
    for (const s of SCENE_SPECS) expect(ART.scenes[s.id]?.focal, s.id).toEqual(s.focal);
  });

  it('fits in the live renderer (at most six pieces per scene)', () => {
    for (const s of SCENE_SPECS) expect(s.pieces.length, s.id).toBeLessThanOrEqual(6);
  });
});

describe('distance-field atlas', () => {
  const atlas = buildFieldAtlas();

  it('packs every shape into one texture within the WebGL 2 minimum size', () => {
    expect(atlas.items.map((i) => i.name)).toEqual(FIELD_SHAPES.map((s) => s.name));
    expect(atlas.width).toBeLessThanOrEqual(2048);
    expect(atlas.height).toBeLessThanOrEqual(2048);
    expect(atlas.data.length).toBe(atlas.width * atlas.height);
  });

  it('stores the signed distance at each texel centre', () => {
    for (const [k, item] of atlas.items.entries()) {
      const shape = FIELD_SHAPES[k]!;
      const [r0, t0, r1, t1] = item.rect;
      const [u0, v0, u1, v1] = item.domain;
      for (const [fx, fy] of [
        [0.25, 0.5],
        [0.5, 0.3],
        [0.8, 0.7]
      ] as const) {
        // Snap to a texel centre inside the item, then map it back to piece units.
        const x = Math.round((r0 + (r1 - r0) * fx) * atlas.width - 0.5);
        const y = Math.round((t0 + (t1 - t0) * fy) * atlas.height - 0.5);
        const tu = ((x + 0.5) / atlas.width - r0) / (r1 - r0);
        const tv = ((y + 0.5) / atlas.height - t0) / (t1 - t0);
        const expected = polygonDistance(shape.points, u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv, shape.lathe);
        expect(atlas.data[y * atlas.width + x], `${shape.name} ${fx},${fy}`).toBeCloseTo(expected, 4);
      }
    }
  });

  it('is negative inside a piece and positive outside', () => {
    const pawn = FIELD_SHAPES[0]!;
    expect(polygonDistance(pawn.points, 0.2, 0.5, true)).toBeLessThan(0);
    expect(polygonDistance(pawn.points, 1.5, 0.5, true)).toBeGreaterThan(0);
    // The closing edge along the axis is not a surface: a point on the axis is deep inside.
    expect(polygonDistance(pawn.points, 0, 0.8, true)).toBeLessThan(-0.3);
  });
});
