import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderScene } from '../../tools/art/raymarch';
import { testScene } from '../../tools/art/scenes';
import { decodePNG, encodePNG } from '../../tools/art/png';
import { lathe, polygon2D, sphere } from '../../tools/art/sdf';
import { chaikin } from '../../src/dither/pieceProfiles';
import { ART } from '../../src/dither/art';

describe('SDF primitives', () => {
  it('sphere distance is exact', () => {
    const s = sphere(0, 0, 0, 1);
    expect(s(2, 0, 0)).toBeCloseTo(1, 9);
    expect(s(0, 0, 0)).toBeCloseTo(-1, 9);
  });
  it('polygon sign follows inside/outside', () => {
    const sq = polygon2D([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ]);
    expect(sq(0.5, 0.5)).toBeCloseTo(-0.5, 9);
    expect(sq(2, 0.5)).toBeCloseTo(1, 9);
  });
  it('a lathe of a rectangle is a cylinder', () => {
    const cyl = lathe([
      [0, 0],
      [1, 0],
      [1, 2],
      [0, 2]
    ]);
    expect(cyl(0, 1, 0)).toBeLessThan(0);
    expect(cyl(1.5, 1, 0)).toBeCloseTo(0.5, 6);
    expect(cyl(0, 2.5, 1.06)).toBeGreaterThan(0);
  });
  it('chaikin keeps endpoints', () => {
    const p = chaikin(
      [
        [0, 0],
        [1, 1],
        [2, 0]
      ],
      3
    );
    expect(p[0]).toEqual([0, 0]);
    expect(p.at(-1)).toEqual([2, 0]);
  });
});

describe('renderer', () => {
  it('separates subject and background', () => {
    const planes = renderScene(testScene());
    const at = (x: number, y: number) => y * planes.width + x;
    const centre = at(planes.width >> 1, planes.height >> 1);
    expect(planes.alpha[centre]).toBe(1);
    expect(planes.subject[centre]).toBeGreaterThan(0.2);
    expect(planes.alpha[at(1, 1)]).toBe(0);
  });

  it('PNG encode/decode round-trips', () => {
    const w = 7;
    const h = 5;
    const px = new Uint8Array(w * h * 3).map((_, i) => (i * 37) & 0xff);
    const back = decodePNG(encodePNG(w, h, px, 2));
    expect(back.width).toBe(w);
    expect(back.height).toBe(h);
    expect([...back.pixels]).toEqual([...px]);
  });

  it('the committed textures match the manifest', () => {
    for (const [id, info] of Object.entries(ART.scenes)) {
      const buf = readFileSync(fileURLToPath(new URL(`../../public/art/${id}.png`, import.meta.url)));
      expect(buf.readUInt32BE(16), id).toBe(info.width);
      expect(buf.readUInt32BE(20), id).toBe(info.height);
      expect(buf[25], `${id} is RGB`).toBe(2);
    }
  });
});
