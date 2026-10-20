/**
 * Scene descriptions for the subject textures. Each persona has one scene; the hero and the
 * promotion morph have their own. Cameras are pinhole; units follow pieces.ts.
 */
import { type SDF, place, roundBox } from './sdf.ts';
import { PIECES, promotion } from './pieces.ts';
import { SCENE_SPECS } from '../../src/dither/sceneSpecs.ts';

export type Vec3 = [number, number, number];

export interface SceneObject {
  sdf: SDF;
  /** Base reflectance in [0, 1]. */
  albedo: number;
  subject: boolean;
}

export interface Board {
  /** Square size. */
  square: number;
  /** Half extent in squares from the centre (4 = a full 8x8 board), Infinity for a plane. */
  extent: number;
  light: number;
  dark: number;
  /** Board centre on the plane y = 0. */
  cx: number;
  cz: number;
  subject: boolean;
}

export interface Scene {
  id: string;
  width: number;
  height: number;
  camera: { pos: Vec3; target: Vec3; fov: number; roll?: number };
  key: { dir: Vec3; intensity: number; softness: number };
  rim: { dir: Vec3; intensity: number };
  ambient: number;
  objects: SceneObject[];
  board?: Board;
  /** Background when a ray hits nothing: vertical gradient top/bottom plus a radial glow. */
  void: { top: number; bottom: number; glow: number; glowAt: [number, number] };
  fog: number;
  exposure: number;
  gamma: number;
  /** Focal point in [0,1]^2 that the crop keeps on screen on narrow viewports. */
  focal: [number, number];
}

const W = 1280;
const H = 800;

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

const ivory = 0.86;

function base(id: string, over: Partial<Scene> & Pick<Scene, 'camera' | 'objects'>): Scene {
  return {
    id,
    width: W,
    height: H,
    key: { dir: norm([-0.6, 0.9, 0.55]), intensity: 1.15, softness: 9 },
    rim: { dir: norm([0.5, 0.35, -1]), intensity: 0.55 },
    ambient: 0.14,
    void: { top: 0.18, bottom: 0.04, glow: 0.22, glowAt: [0.68, 0.32] },
    fog: 0,
    exposure: 1.1,
    gamma: 1 / 2.2,
    focal: [0.5, 0.5],
    ...over
  };
}

/** The persona scenes come from the shared staging (src/dither/sceneSpecs.ts), as the live renderer's do. */
export const SCENES: Scene[] = SCENE_SPECS.map((spec) => {
  const { pieces, ...rest } = spec;
  return {
    ...rest,
    width: W,
    height: H,
    objects: pieces.map((p) => ({ sdf: place(PIECES[p.piece](), p), albedo: p.albedo, subject: p.subject }))
  };
});

/** Pawn-to-queen morph frames, one front-lit silhouette per frame, packed into an atlas. */
export const MORPH_FRAMES = 12;
export const MORPH_COLS = 4;
export const MORPH_W = 320;
export const MORPH_H = 448;

export function morphScene(frame: number): Scene {
  const t = frame / (MORPH_FRAMES - 1);
  return base(`morph-${frame}`, {
    width: MORPH_W,
    height: MORPH_H,
    camera: { pos: [0, 2.0, 9.2], target: [0, 1.95, 0], fov: 30 },
    key: { dir: norm([-0.5, 0.7, 0.8]), intensity: 1.2, softness: 10 },
    objects: [{ sdf: promotion(t), albedo: ivory, subject: true }],
    void: { top: 0.1, bottom: 0.1, glow: 0, glowAt: [0.5, 0.5] },
    focal: [0.5, 0.5]
  });
}

/** A plinth used by tests to check the renderer on a trivially predictable scene. */
export function testScene(): Scene {
  return base('test', {
    width: 64,
    height: 40,
    camera: { pos: [0, 1, 6], target: [0, 1, 0], fov: 40 },
    objects: [{ sdf: roundBox(0, 1, 0, 1, 1, 1, 0.1), albedo: 0.8, subject: true }]
  });
}
