/**
 * The staging of every scene: camera, lights, the pieces and where they stand, the board and the
 * background. Shared by the offline renderer (tools/art, the still images) and the live
 * renderer (liveScene.ts), so a scene looks the same in both. Units follow tools/art/pieces.ts:
 * a pawn's base has radius 1; a board square is 1.15 unless set.
 */

export type Vec3 = [number, number, number];
export type PieceName = 'pawn' | 'rook' | 'bishop' | 'queen' | 'king' | 'knight';

export interface ScenePiece {
  piece: PieceName;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  scale?: number;
  /** Base reflectance in [0, 1]. */
  albedo: number;
  subject: boolean;
}

export interface BoardSpec {
  square: number;
  /** Half extent in squares from the centre (4 = a full 8x8 board). */
  extent: number;
  light: number;
  dark: number;
  cx: number;
  cz: number;
  subject: boolean;
}

export interface SceneSpec {
  id: string;
  camera: { pos: Vec3; target: Vec3; fov: number; roll?: number };
  key: { dir: Vec3; intensity: number; softness: number };
  rim: { dir: Vec3; intensity: number };
  ambient: number;
  pieces: ScenePiece[];
  board?: BoardSpec;
  /** Background when a ray hits nothing: vertical gradient top/bottom plus a radial glow. */
  void: { top: number; bottom: number; glow: number; glowAt: [number, number] };
  fog: number;
  exposure: number;
  gamma: number;
  /** Focal point in [0,1]^2 that the crop keeps on screen on narrow viewports. */
  focal: [number, number];
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const IVORY = 0.86;
export const EBONY = 0.2;

function base(id: string, over: Partial<SceneSpec> & Pick<SceneSpec, 'camera' | 'pieces'>): SceneSpec {
  return {
    id,
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

export const board = (over: Partial<BoardSpec> = {}): BoardSpec => ({
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
const ivory = (piece: PieceName, at: Omit<ScenePiece, 'piece' | 'albedo' | 'subject'> = {}): ScenePiece => ({ piece, ...at, albedo: IVORY, subject: true });

export const SCENE_SPECS: SceneSpec[] = [
  base('hero', {
    camera: { pos: [2.6, 2.9, 2.4], target: [0.15, 2.45, 0.35], fov: 42 },
    key: { dir: norm([-0.2, 0.8, 0.9]), intensity: 1.25, softness: 10 },
    rim: { dir: norm([0.8, 0.4, -0.7]), intensity: 0.7 },
    pieces: [ivory('knight')],
    focal: [0.48, 0.45]
  }),
  base('pawn-crown', {
    camera: { pos: [1.05, 3.05, 1.45], target: [0.05, 2.0, 0], fov: 40 },
    pieces: [ivory('pawn')],
    focal: [0.5, 0.42]
  }),
  base('coronet', {
    camera: { pos: [0.85, 4.05, 1.65], target: [0, 3.3, 0], fov: 42 },
    key: { dir: norm([0.7, 0.9, 0.3]), intensity: 1.2, softness: 8 },
    pieces: [ivory('queen')],
    focal: [0.5, 0.5]
  }),
  base('knight-profile', {
    camera: { pos: [3.1, 2.62, 0.75], target: [0, 2.48, 0.28], fov: 40 },
    key: { dir: norm([0.6, 0.85, 0.6]), intensity: 1.2, softness: 12 },
    rim: { dir: norm([-0.9, 0.3, -0.4]), intensity: 0.8 },
    pieces: [ivory('knight')],
    focal: [0.52, 0.45]
  }),
  base('rook-crown', {
    camera: { pos: [1.45, 1.05, 2.25], target: [0, 2.45, 0], fov: 52 },
    key: { dir: norm([-0.5, 1, 0.4]), intensity: 1.2, softness: 8 },
    pieces: [ivory('rook')],
    focal: [0.5, 0.35]
  }),
  base('mitre', {
    camera: { pos: [0.55, 3.0, 2.15], target: [0, 2.72, 0], fov: 38 },
    key: { dir: norm([-0.7, 0.7, 0.6]), intensity: 1.2, softness: 10 },
    pieces: [ivory('bishop')],
    focal: [0.5, 0.45]
  }),
  base('board-rake', {
    camera: { pos: [0.35, 0.95, 4.7], target: [-0.1, -0.2, -4], fov: 60 },
    key: { dir: norm([-0.8, 0.5, -0.4]), intensity: 1.3, softness: 14 },
    pieces: [{ piece: 'pawn', x: 0.95 * 0.5, z: 0.95 * 2.5, scale: 0.5, albedo: EBONY + 0.1, subject: true }],
    board: board({ subject: true, square: 0.95 }),
    fog: 0.035,
    void: { top: 0.06, bottom: 0.02, glow: 0.35, glowAt: [0.5, 0.18] },
    focal: [0.5, 0.6]
  }),
  base('kings-cross', {
    camera: { pos: [0.62, 4.3, 1.45], target: [0, 4.1, 0], fov: 36 },
    key: { dir: norm([-0.4, 0.6, 1]), intensity: 1.25, softness: 10 },
    rim: { dir: norm([0.7, 0.2, -0.8]), intensity: 0.8 },
    pieces: [ivory('king')],
    void: { top: 0.22, bottom: 0.05, glow: 0.3, glowAt: [0.3, 0.3] },
    focal: [0.5, 0.45]
  }),
  base('pawn-chain', {
    camera: { pos: [3.6, 2.2, 4.6], target: [-0.4, 1.0, -0.6], fov: 44 },
    key: { dir: norm([-0.9, 0.7, 0.4]), intensity: 1.2, softness: 9 },
    pieces: [0, 1, 2, 3, 4].map((i) => ivory('pawn', { x: (i - 1.5) * sq - sq / 2, z: (1.5 - i) * sq + sq / 2, scale: 0.5 })),
    board: board({ square: sq }),
    fog: 0.02,
    focal: [0.45, 0.5]
  }),
  base('outpost', {
    camera: { pos: [0, 1.55, 5.4], target: [0, 1.35, 0], fov: 40 },
    key: { dir: norm([0, 0.9, 0.5]), intensity: 1.2, softness: 8 },
    rim: { dir: norm([0, 0.4, -1]), intensity: 0.9 },
    pieces: [
      ivory('knight', { x: -1.15, yaw: Math.PI / 2, scale: 0.85 }),
      { piece: 'knight', x: 1.15, yaw: -Math.PI / 2, scale: 0.85, albedo: EBONY + 0.25, subject: true }
    ],
    board: board({ square: sq }),
    fog: 0.03,
    focal: [0.5, 0.5]
  }),
  base('toppled-king', {
    camera: { pos: [-0.6, 1.1, 3.9], target: [0.96, 0.5, 0.72], fov: 46 },
    key: { dir: norm([-0.3, 0.8, 0.8]), intensity: 1.2, softness: 10 },
    pieces: [ivory('king', { y: 0.665, roll: -Math.PI / 2, yaw: -0.64, scale: 0.55 })],
    board: board({ square: sq }),
    fog: 0.03,
    focal: [0.45, 0.5]
  }),
  base('queen-tower', {
    camera: { pos: [1.6, 0.35, 3.6], target: [0, 2.3, 0], fov: 50 },
    key: { dir: norm([-0.8, 0.6, 0.3]), intensity: 1.2, softness: 10 },
    rim: { dir: norm([0.8, 0.3, -0.6]), intensity: 0.9 },
    pieces: [ivory('queen')],
    focal: [0.5, 0.4]
  }),
  base('king-queen', {
    camera: { pos: [0.4, 2.1, 6.4], target: [0, 2.0, 0], fov: 40 },
    key: { dir: norm([0.2, 0.5, -1]), intensity: 0.5, softness: 6 },
    rim: { dir: norm([0.1, 0.25, -1]), intensity: 1.4 },
    ambient: 0.08,
    pieces: [ivory('king', { x: -0.85 }), ivory('queen', { x: 0.95, z: 0.4 })],
    void: { top: 0.12, bottom: 0.02, glow: 0.6, glowAt: [0.5, 0.42] },
    focal: [0.5, 0.45]
  }),
  base('citadel', {
    camera: { pos: [0.3, 0.25, 4.1], target: [0, 1.75, 0], fov: 46 },
    key: { dir: norm([-0.6, 0.7, 0.5]), intensity: 1.2, softness: 9 },
    rim: { dir: norm([0.9, 0.4, -0.5]), intensity: 0.8 },
    pieces: [ivory('rook')],
    board: board({ square: sq }),
    fog: 0.03,
    focal: [0.5, 0.4]
  }),
  base('fork', {
    camera: { pos: [2.6, 3.4, 4.2], target: [0, 0.9, 0], fov: 44 },
    key: { dir: norm([-0.5, 0.9, 0.3]), intensity: 1.2, softness: 9 },
    pieces: [
      ivory('knight', { scale: 0.6 }),
      { piece: 'king', x: -sq * 1, z: -sq * 2, scale: 0.6, albedo: EBONY + 0.2, subject: true },
      { piece: 'rook', x: sq * 1, z: -sq * 2, scale: 0.6, albedo: EBONY + 0.2, subject: true }
    ],
    board: board({ square: sq, cx: sq / 2, cz: sq / 2 }),
    fog: 0.02,
    focal: [0.5, 0.5]
  })
];

export function sceneSpec(id: string): SceneSpec | undefined {
  return SCENE_SPECS.find((s) => s.id === id);
}
