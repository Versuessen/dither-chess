/**
 * Scene descriptions for the subject textures. Each persona has one scene; the hero and the
 * promotion morph have their own. Cameras are pinhole; units follow pieces.ts.
 */
import { type SDF, place, roundBox } from './sdf.ts';
import { bishop, king, knight, pawn, promotion, queen, rook } from './pieces.ts';

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
const ebony = 0.2;

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

const board = (over: Partial<Board> = {}): Board => ({
  square: 1.15,
  extent: 4,
  light: 0.72,
  dark: 0.16,
  cx: 0,
  cz: 0,
  subject: false,
  ...over
});

const sq = 1.15;

export const SCENES: Scene[] = [
  base('hero', {
    camera: { pos: [2.6, 2.9, 2.4], target: [0.15, 2.45, 0.35], fov: 42 },
    key: { dir: norm([-0.2, 0.8, 0.9]), intensity: 1.25, softness: 10 },
    rim: { dir: norm([0.8, 0.4, -0.7]), intensity: 0.7 },
    objects: [{ sdf: knight(), albedo: ivory, subject: true }],
    focal: [0.48, 0.45]
  }),
  base('pawn-crown', {
    camera: { pos: [1.05, 3.05, 1.45], target: [0.05, 2.0, 0], fov: 40 },
    objects: [{ sdf: pawn(), albedo: ivory, subject: true }],
    focal: [0.5, 0.42]
  }),
  base('coronet', {
    camera: { pos: [0.85, 4.05, 1.65], target: [0, 3.3, 0], fov: 42 },
    key: { dir: norm([0.7, 0.9, 0.3]), intensity: 1.2, softness: 8 },
    objects: [{ sdf: queen(), albedo: ivory, subject: true }],
    focal: [0.5, 0.5]
  }),
  base('knight-profile', {
    camera: { pos: [3.1, 2.62, 0.75], target: [0, 2.48, 0.28], fov: 40 },
    key: { dir: norm([0.6, 0.85, 0.6]), intensity: 1.2, softness: 12 },
    rim: { dir: norm([-0.9, 0.3, -0.4]), intensity: 0.8 },
    objects: [{ sdf: knight(), albedo: ivory, subject: true }],
    focal: [0.52, 0.45]
  }),
  base('rook-crown', {
    camera: { pos: [1.45, 1.05, 2.25], target: [0, 2.45, 0], fov: 52 },
    key: { dir: norm([-0.5, 1, 0.4]), intensity: 1.2, softness: 8 },
    objects: [{ sdf: rook(), albedo: ivory, subject: true }],
    focal: [0.5, 0.35]
  }),
  base('mitre', {
    camera: { pos: [0.55, 3.0, 2.15], target: [0, 2.72, 0], fov: 38 },
    key: { dir: norm([-0.7, 0.7, 0.6]), intensity: 1.2, softness: 10 },
    objects: [{ sdf: bishop(), albedo: ivory, subject: true }],
    focal: [0.5, 0.45]
  }),
  base('board-rake', {
    camera: { pos: [0.35, 0.95, 4.7], target: [-0.1, -0.2, -4], fov: 60 },
    key: { dir: norm([-0.8, 0.5, -0.4]), intensity: 1.3, softness: 14 },
    objects: [{ sdf: place(pawn(), { x: 0.95 * 0.5, z: 0.95 * 2.5, scale: 0.5 }), albedo: ebony + 0.1, subject: true }],
    board: board({ subject: true, square: 0.95 }),
    fog: 0.035,
    void: { top: 0.06, bottom: 0.02, glow: 0.35, glowAt: [0.5, 0.18] },
    focal: [0.5, 0.6]
  }),
  base('kings-cross', {
    camera: { pos: [0.62, 4.3, 1.45], target: [0, 4.1, 0], fov: 36 },
    key: { dir: norm([-0.4, 0.6, 1]), intensity: 1.25, softness: 10 },
    rim: { dir: norm([0.7, 0.2, -0.8]), intensity: 0.8 },
    objects: [{ sdf: king(), albedo: ivory, subject: true }],
    void: { top: 0.22, bottom: 0.05, glow: 0.3, glowAt: [0.3, 0.3] },
    focal: [0.5, 0.45]
  }),
  base('pawn-chain', {
    camera: { pos: [3.6, 2.2, 4.6], target: [-0.4, 1.0, -0.6], fov: 44 },
    key: { dir: norm([-0.9, 0.7, 0.4]), intensity: 1.2, softness: 9 },
    objects: [0, 1, 2, 3, 4].map((i) => ({
      sdf: place(pawn(), { x: (i - 1.5) * sq - sq / 2, z: (1.5 - i) * sq + sq / 2, scale: 0.5 }),
      albedo: ivory,
      subject: true
    })),
    board: board({ square: sq }),
    fog: 0.02,
    focal: [0.45, 0.5]
  }),
  base('outpost', {
    camera: { pos: [0, 1.55, 5.4], target: [0, 1.35, 0], fov: 40 },
    key: { dir: norm([0, 0.9, 0.5]), intensity: 1.2, softness: 8 },
    rim: { dir: norm([0, 0.4, -1]), intensity: 0.9 },
    objects: [
      { sdf: place(knight(), { x: -1.15, yaw: Math.PI / 2, scale: 0.85 }), albedo: ivory, subject: true },
      { sdf: place(knight(), { x: 1.15, yaw: -Math.PI / 2, scale: 0.85 }), albedo: ebony + 0.25, subject: true }
    ],
    board: board({ square: sq }),
    fog: 0.03,
    focal: [0.5, 0.5]
  }),
  base('toppled-king', {
    camera: { pos: [-0.6, 1.1, 3.9], target: [0.96, 0.5, 0.72], fov: 46 },
    key: { dir: norm([-0.3, 0.8, 0.8]), intensity: 1.2, softness: 10 },
    objects: [
      {
        sdf: place(king(), { y: 0.665, roll: -Math.PI / 2, yaw: -0.64, scale: 0.55 }),
        albedo: ivory,
        subject: true
      }
    ],
    board: board({ square: sq }),
    fog: 0.03,
    focal: [0.45, 0.5]
  }),
  base('queen-tower', {
    camera: { pos: [1.6, 0.35, 3.6], target: [0, 2.3, 0], fov: 50 },
    key: { dir: norm([-0.8, 0.6, 0.3]), intensity: 1.2, softness: 10 },
    rim: { dir: norm([0.8, 0.3, -0.6]), intensity: 0.9 },
    objects: [{ sdf: queen(), albedo: ivory, subject: true }],
    focal: [0.5, 0.4]
  }),
  base('king-queen', {
    camera: { pos: [0.4, 2.1, 6.4], target: [0, 2.0, 0], fov: 40 },
    key: { dir: norm([0.2, 0.5, -1]), intensity: 0.5, softness: 6 },
    rim: { dir: norm([0.1, 0.25, -1]), intensity: 1.4 },
    ambient: 0.08,
    objects: [
      { sdf: place(king(), { x: -0.85 }), albedo: ivory, subject: true },
      { sdf: place(queen(), { x: 0.95, z: 0.4 }), albedo: ivory, subject: true }
    ],
    void: { top: 0.12, bottom: 0.02, glow: 0.6, glowAt: [0.5, 0.42] },
    focal: [0.5, 0.45]
  }),
  base('citadel', {
    camera: { pos: [0.3, 0.25, 4.1], target: [0, 1.75, 0], fov: 46 },
    key: { dir: norm([-0.6, 0.7, 0.5]), intensity: 1.2, softness: 9 },
    rim: { dir: norm([0.9, 0.4, -0.5]), intensity: 0.8 },
    objects: [{ sdf: rook(), albedo: ivory, subject: true }],
    board: board({ square: sq }),
    fog: 0.03,
    focal: [0.5, 0.4]
  }),
  base('fork', {
    camera: { pos: [2.6, 3.4, 4.2], target: [0, 0.9, 0], fov: 44 },
    key: { dir: norm([-0.5, 0.9, 0.3]), intensity: 1.2, softness: 9 },
    objects: [
      { sdf: place(knight(), { scale: 0.6 }), albedo: ivory, subject: true },
      { sdf: place(king(), { x: -sq * 1, z: -sq * 2, scale: 0.6 }), albedo: ebony + 0.2, subject: true },
      { sdf: place(rook(), { x: sq * 1, z: -sq * 2, scale: 0.6 }), albedo: ebony + 0.2, subject: true }
    ],
    board: board({ square: sq, cx: sq / 2, cz: sq / 2 }),
    fog: 0.02,
    focal: [0.5, 0.5]
  })
];

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
