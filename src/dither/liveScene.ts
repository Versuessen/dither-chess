/**
 * Live scenes: the opponents' still images, rendered in real time. The same staging
 * (sceneSpecs.ts) and the same pieces (pieceProfiles.ts plus the cuts below, twins of
 * tools/art/pieces.ts) are sphere-traced on the GPU, with the offline tracer's lighting, into a
 * small texture in the subject format the dither shader reads (R subject luminance, G subject
 * coverage, B background luminance). The pieces turn slowly and the camera follows the
 * pointer, so the scene moves in depth instead of sliding as a flat picture.
 *
 * The piece profiles are 2D distance fields in one float texture (fieldWorker.ts), so a piece
 * costs a texture read or two per step instead of hundreds of segment tests.
 */
import type { SceneSpec, Vec3, PieceName } from './sceneSpecs';

export interface FieldAtlas {
  width: number;
  height: number;
  data: Float32Array;
  /** Per shape: texel-centre rectangle in the atlas (u0, v0, u1, v1) and its domain in piece units. */
  items: { name: string; rect: [number, number, number, number]; domain: [number, number, number, number] }[];
  margin: number;
}

const PIECE_INDEX: Record<PieceName, number> = { pawn: 0, rook: 1, bishop: 2, queen: 3, king: 4, knight: 5 };
const MAX_OBJECTS = 6;

const VERT = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform sampler2D uFields;
uniform vec4 uFieldRect[7];
uniform vec4 uFieldDom[7];
uniform float uMargin;

uniform int uObjCount;
uniform mat3 uObjRot[${MAX_OBJECTS}];   // world -> local rotation (R^T)
uniform vec3 uObjPos[${MAX_OBJECTS}];
uniform float uObjScale[${MAX_OBJECTS}];
uniform int uObjKind[${MAX_OBJECTS}];
uniform float uObjAlbedo[${MAX_OBJECTS}];
uniform float uObjSubject[${MAX_OBJECTS}];

uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalf;
uniform float uAspect;

uniform vec3 uKeyDir;
uniform vec2 uKey;        // intensity, softness
uniform vec3 uRimDir;
uniform float uRim;
uniform float uAmbient;
uniform vec3 uVoid;       // top, bottom, glow
uniform vec2 uGlowAt;
uniform vec3 uTone;       // fog, exposure, gamma

uniform float uBoardOn;
uniform vec4 uBoard;      // square, extent, light, dark
uniform vec3 uBoardC;     // cx, cz, subject

out vec4 outColor;

const float FAR = 60.0;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sphere(vec3 p, vec3 c, float r) { return length(p - c) - r; }
float ellipsoid(vec3 p, vec3 c, vec3 r) {
  vec3 q = p - c;
  float k0 = length(q / r);
  float k1 = length(q / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float roundBox(vec3 p, vec3 c, vec3 h, float r) {
  vec3 q = abs(p - c) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float cylinder(vec3 p, float r, float y0, float y1) {
  vec2 d = vec2(length(p.xz) - r, abs(p.y - 0.5 * (y0 + y1)) - 0.5 * (y1 - y0));
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// Distance to field shape i at q (radius or z, height); beyond the sampled margin, a lower bound.
float field(int i, vec2 q) {
  vec4 dom = uFieldDom[i];
  vec2 t = (q - dom.xy) / (dom.zw - dom.xy);
  vec2 tc = clamp(t, 0.0, 1.0);
  vec2 outside = (t - tc) * (dom.zw - dom.xy);
  if (outside.x != 0.0 || outside.y != 0.0) return length(outside) + uMargin;
  vec4 r = uFieldRect[i];
  return texture(uFields, mix(r.xy, r.zw, tc)).r;
}
float lathe(int i, vec3 p) { return field(i, vec2(length(p.xz), p.y)); }

float pawnSdf(vec3 p) { return smin(lathe(0, p), sphere(p, vec3(0.0, 2.13, 0.0), 0.52), 0.06); }

float rookSdf(vec3 p) {
  float d = lathe(1, p);
  d = smax(d, -cylinder(p, 0.52, 2.38, 3.0), 0.02);
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 0.78539816;
    float c = cos(a), s = sin(a);
    vec3 q = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    d = smax(d, -roundBox(q, vec3(0.0, 2.62, 0.0), vec3(1.0, 0.24, 0.11), 0.02), 0.02);
  }
  return d;
}

float bishopSdf(vec3 p) {
  float d = smin(lathe(2, p), ellipsoid(p, vec3(0.0, 2.62, 0.0), vec3(0.5, 0.62, 0.5)), 0.08);
  d = smin(d, ellipsoid(p, vec3(0.0, 3.2, 0.0), vec3(0.13, 0.17, 0.13)), 0.12);
  // The slit: a thin slab tilted 40 degrees, cut into the front of the mitre.
  float ca = 0.76604444, sa = 0.64278761;
  float yy = p.y - 2.78;
  vec3 q = vec3(ca * p.x + sa * yy, -sa * p.x + ca * yy, p.z);
  d = smax(d, -roundBox(q, vec3(0.0, 0.0, 0.42), vec3(0.045, 0.6, 0.42), 0.01), 0.015);
  return min(d, sphere(p, vec3(0.0, 3.4, 0.0), 0.12));
}

float queenSdf(vec3 p) {
  float d = smin(lathe(3, p), ellipsoid(p, vec3(0.0, 3.36, 0.0), vec3(0.5, 0.26, 0.5)), 0.05);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.78539816 + 0.39269908;
    d = smax(d, -sphere(p, vec3(cos(a) * 0.76, 3.4, sin(a) * 0.76), 0.2), 0.03);
  }
  return smin(d, sphere(p, vec3(0.0, 3.72, 0.0), 0.17), 0.05);
}

float kingSdf(vec3 p) {
  float cross = min(roundBox(p, vec3(0.0, 4.12, 0.0), vec3(0.1, 0.36, 0.1), 0.03), roundBox(p, vec3(0.0, 4.18, 0.0), vec3(0.3, 0.1, 0.1), 0.03));
  return smin(lathe(4, p), cross, 0.04);
}

float ramp(float v, float k) { return v > 0.0 ? v * v / (v + k) : 0.0; }
float knightHalf(float z, float y) {
  float muzzle = 0.16 * ramp(z - 0.15, 0.35);
  float crown = 0.22 * ramp(y - 2.55, 0.25);
  float cheek = 0.06 * exp(-((y - 2.35) * (y - 2.35)) / 0.08 - ((z - 0.1) * (z - 0.1)) / 0.12);
  return 0.4 + cheek - muzzle - crown;
}

float knightSdf(vec3 p) {
  const float R = 0.13;
  float d2 = field(6, vec2(p.z, p.y)) + R;
  float dx = abs(p.x) - knightHalf(p.z, p.y) + R;
  float head = min(max(d2, dx), 0.0) + length(max(vec2(d2, dx), 0.0)) - R;
  float d = smin(lathe(5, p), head, 0.1);
  if (d > 0.3) return d;
  d = smax(d, -sphere(p, vec3(0.34, 2.72, 0.36), 0.085), 0.025);
  d = smax(d, -sphere(p, vec3(-0.34, 2.72, 0.36), 0.085), 0.025);
  d = smax(d, -sphere(p, vec3(0.15, 2.06, 1.13), 0.055), 0.02);
  d = smax(d, -sphere(p, vec3(-0.15, 2.06, 1.13), 0.055), 0.02);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    d = smax(d, -ellipsoid(p, vec3(0.0, 1.55 + fi * 0.26, -0.86 + abs(fi - 2.0) * 0.03), vec3(0.5, 0.028, 0.06)), 0.03);
  }
  return d;
}

// Bounding cylinder per piece (radius, height), so far pieces cost one test.
const vec2 BOUND[6] = vec2[6](vec2(1.05, 2.7), vec2(1.12, 2.7), vec2(1.06, 3.56), vec2(1.2, 3.93), vec2(1.22, 4.58), vec2(1.2, 3.46));

float piece(int k, vec3 p) {
  vec2 b = BOUND[k];
  float bound = cylinder(p, b.x, -0.05, b.y);
  if (bound > 0.25) return bound;
  if (k == 0) return pawnSdf(p);
  if (k == 1) return rookSdf(p);
  if (k == 2) return bishopSdf(p);
  if (k == 3) return queenSdf(p);
  if (k == 4) return kingSdf(p);
  return knightSdf(p);
}

float boardSdf(vec3 p) {
  float half_ = uBoard.y * uBoard.x;
  float ex = abs(p.x - uBoardC.x) - half_;
  float ez = abs(p.z - uBoardC.y) - half_;
  float outside = length(max(vec2(ex, ez), 0.0));
  float db = max(p.y, -p.y - 0.12);
  return max(db, min(max(ex, ez), 0.0) + outside);
}

// x: distance, y: object index (-2 board, -1 none). Pieces only when withPieces.
vec2 map(vec3 p, bool withPieces) {
  vec2 res = vec2(FAR, -1.0);
  if (withPieces) {
    for (int i = 0; i < ${MAX_OBJECTS}; i++) {
      if (i >= uObjCount) break;
      vec3 q = uObjRot[i] * (p - uObjPos[i]) / uObjScale[i];
      float d = piece(uObjKind[i], q) * uObjScale[i];
      if (d < res.x) res = vec2(d, float(i));
    }
  }
  if (uBoardOn > 0.5) {
    float db = boardSdf(p);
    if (db < res.x) res = vec2(db, -2.0);
  }
  return res;
}

vec2 march(vec3 o, vec3 d, bool withPieces) {
  float t = 0.02;
  for (int i = 0; i < 128; i++) {
    vec2 h = map(o + d * t, withPieces);
    if (h.x < 0.0015 * t + 0.0005) return vec2(t, h.y);
    t += h.x * 0.85;
    if (t > FAR) break;
  }
  return vec2(FAR, -1.0);
}

vec3 normalAt(vec3 p) {
  const float e = 0.002;
  float a = map(p + vec3(e, -e, -e), true).x;
  float b = map(p + vec3(-e, -e, e), true).x;
  float c = map(p + vec3(-e, e, -e), true).x;
  float d = map(p + vec3(e, e, e), true).x;
  return normalize(vec3(a - b - c + d, -a - b + c + d, -a + b - c + d));
}

float softShadow(vec3 p, vec3 l, float k) {
  float res = 1.0;
  float t = 0.03;
  for (int i = 0; i < 40; i++) {
    float h = map(p + l * t, true).x;
    if (h < 0.0008) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h, 0.03, 0.45);
    if (t > 12.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ao(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.03 + 0.09 * float(i);
    occ += (h - map(p + n * h, true).x) * sca;
    sca *= 0.75;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

float voidValue(vec2 uv) {
  float base = uVoid.y + (uVoid.x - uVoid.y) * (1.0 - uv.y);
  vec2 dd = vec2(uv.x - uGlowAt.x, (uv.y - uGlowAt.y) / uAspect);
  return clamp(base + uVoid.z * exp(-dot(dd, dd) / 0.06), 0.0, 1.0);
}

float checker(vec2 q, float w) {
  float fw = max(w, 1e-4);
  vec2 a = q + fw * 0.5, b = q - fw * 0.5;
  vec2 ta = abs(a * 0.5 - floor(a * 0.5 + 0.5)) * 2.0;
  vec2 tb = abs(b * 0.5 - floor(b * 0.5 + 0.5)) * 2.0;
  vec2 i = (ta - tb) / fw;
  return 0.5 - 0.5 * i.x * i.y;
}

float tonemap(float lum) {
  lum = lum * uTone.y / (1.0 + lum * uTone.y * 0.35);
  return pow(clamp(lum, 0.0, 1.0), uTone.z);
}

// Shade a hit. id: object index or -2 for the board. shadows: pieces cast shadows.
float shade(vec3 o, vec3 d, vec2 hit, vec2 uv, bool shadows) {
  vec3 p = o + d * hit.x;
  vec3 n = normalAt(p);
  float albedo;
  if (hit.y < -1.5) {
    float pixelAngle = 2.0 * uTanHalf / uRes.y;
    float w = hit.x * pixelAngle / max(abs(d.y), 0.02) / uBoard.x;
    albedo = mix(uBoard.w, uBoard.z, checker((p.xz - uBoardC.xy) / uBoard.x, w * 1.5));
    if (p.y < -0.002) albedo = 0.1;
    if (!shadows) n = vec3(0.0, 1.0, 0.0);
  } else {
    albedo = uObjAlbedo[int(hit.y)];
  }
  float ndl = max(0.0, dot(n, uKeyDir));
  float sh = ndl > 0.0 && shadows ? softShadow(p + n * 0.003, uKeyDir, uKey.y) : (shadows ? 0.0 : ndl > 0.0 ? 1.0 : 0.0);
  float occ = shadows ? ao(p, n) : 1.0;
  float ndr = max(0.0, dot(n, uRimDir));
  float facing = max(0.0, -dot(n, d));
  float rim = uRim * ndr * (1.0 - facing) * (1.0 - facing);
  vec3 h = normalize(uKeyDir - d);
  float spec = pow(max(0.0, dot(n, h)), 48.0) * 0.35 * sh;
  float lum = albedo * (uAmbient * occ + uKey.x * ndl * sh) + spec + rim * occ;
  if (uTone.x > 0.0) {
    float f = exp(-uTone.x * hit.x * hit.x * 0.1);
    lum = lum * f + voidValue(uv) * (1.0 - f) * 0.6;
  }
  return tonemap(lum);
}

void main() {
  // Row 0 of the target is the top of the picture, as in the still images' textures.
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 s = vec2((2.0 * uv.x - 1.0) * uTanHalf * uAspect, (1.0 - 2.0 * uv.y) * uTanHalf);
  vec3 d = normalize(uCamFwd + uCamRight * s.x + uCamUp * s.y);
  vec3 o = uCamPos;
  vec2 hit = march(o, d, true);

  float lum;
  bool subject;
  if (hit.y < -0.5 && hit.y > -1.5) {
    lum = voidValue(uv);
    subject = false;
  } else {
    lum = shade(o, d, hit, uv, true);
    subject = hit.y < -1.5 ? uBoardC.z > 0.5 : uObjSubject[int(hit.y)] > 0.5;
  }

  // The background plane: what is behind the subject (the board without the pieces, or the void).
  float bg;
  bool boardBehind = uBoardOn > 0.5 && uBoardC.z < 0.5;
  if (!subject) bg = lum;
  else if (boardBehind) {
    vec2 b = march(o, d, false);
    bg = b.y < -1.5 ? shade(o, d, b, uv, false) : voidValue(uv);
  } else bg = voidValue(uv);

  // Subject luminance where there is no subject repeats the background, so filtering leaves no fringe.
  outColor = vec4(subject ? lum : bg, subject ? 1.0 : 0.0, bg, 1.0);
}
`;

/** Rotation matrix (yaw about y, then pitch about x, then roll about z), as tools/art/sdf.ts place(). */
function rotation(yaw: number, pitch: number, roll: number): number[] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Row-major R = Ry * Rx * Rz.
  return [
    cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
    cp * sr, cp * cr, -sp,
    -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp
  ];
}

/** Camera basis as tools/art/raymarch.ts builds it. */
function cameraBasis(pos: Vec3, target: Vec3, roll: number) {
  let f: Vec3 = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
  const fl = Math.hypot(...f);
  f = [f[0] / fl, f[1] / fl, f[2] / fl];
  let r: Vec3 = [-f[2], 0, f[0]];
  const rl = Math.hypot(...r) || 1;
  r = [r[0] / rl, 0, r[2] / rl];
  let u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const nr: Vec3 = [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s];
    u = [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s];
    r = nr;
  }
  return { f, r, u };
}

/** How the scene moves: pointer in [-1, 1]^2 (already smoothed), time in seconds, motion 0..1. */
export interface SceneMotion {
  time: number;
  pointer: [number, number];
  /** Scale of the camera's pointer orbit (stronger behind the game). */
  parallax: number;
  /** Scale of the pieces' own turning. */
  turn: number;
}

export class LiveScenes {
  private program: WebGLProgram;
  private fields: WebGLTexture | null = null;
  private atlas: FieldAtlas | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private targets: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }[] = [];
  /** Texture aspect, as the still images (1280 x 800). */
  static readonly ASPECT = 1.6;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`scene shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`scene program: ${gl.getProgramInfoLog(p)}`);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = p;
  }

  get ready(): boolean {
    return this.fields !== null;
  }

  /** Upload the distance fields (from fieldWorker.ts). */
  setFields(atlas: FieldAtlas): void {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // R16F is filterable in WebGL 2 without extensions; float data converts on upload.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, atlas.width, atlas.height, 0, gl.RED, gl.FLOAT, atlas.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fields = tex;
    this.atlas = atlas;
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  /** Render target `slot` (0 or 1), created or resized to `height` rows at the scenes' aspect. */
  target(slot: number, height: number): WebGLTexture {
    const gl = this.gl;
    const h = Math.max(64, Math.round(height));
    const w = Math.round(h * LiveScenes.ASPECT);
    let t = this.targets[slot];
    if (!t || t.h !== h) {
      if (t) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      }
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      t = { fbo, tex, w, h };
      this.targets[slot] = t;
    }
    return t.tex;
  }

  size(slot: number): { width: number; height: number } {
    const t = this.targets[slot];
    return { width: t?.w ?? 1, height: t?.h ?? 1 };
  }

  /**
   * Render `spec` into target `slot`. The texture is written top row first (as the still
   * images), so the dither shader samples both alike. Restores the caller's program and VAO.
   */
  render(slot: number, spec: SceneSpec, motion: SceneMotion, restore: { program: WebGLProgram | null; vao: WebGLVertexArrayObject | null }): void {
    const gl = this.gl;
    const t = this.targets[slot];
    const atlas = this.atlas;
    if (!t || !atlas || !this.fields) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.fields);
    gl.uniform1i(this.u('uFields'), 4);
    gl.uniform2f(this.u('uRes'), t.w, t.h);
    gl.uniform1f(this.u('uMargin'), atlas.margin);
    atlas.items.forEach((it, i) => {
      gl.uniform4f(this.u(`uFieldRect[${i}]`), ...it.rect);
      gl.uniform4f(this.u(`uFieldDom[${i}]`), ...it.domain);
    });

    // Camera: orbit the target a little with the pointer and a slow drift.
    const { pos, target, fov, roll = 0 } = spec.camera;
    const yaw = motion.pointer[0] * 0.12 * motion.parallax + Math.sin(motion.time * 0.13) * 0.035 * motion.turn;
    const pitch = motion.pointer[1] * 0.06 * motion.parallax;
    const rel: Vec3 = [pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]];
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    let p: Vec3 = [rel[0] * cyw + rel[2] * syw, rel[1], -rel[0] * syw + rel[2] * cyw];
    const dist = Math.hypot(...p);
    const el = Math.asin(Math.max(-0.99, Math.min(0.99, p[1] / dist))) + pitch;
    const flat = Math.hypot(p[0], p[2]) || 1e-6;
    p = [(p[0] / flat) * Math.cos(el) * dist, Math.sin(el) * dist, (p[2] / flat) * Math.cos(el) * dist];
    const camPos: Vec3 = [target[0] + p[0], target[1] + p[1], target[2] + p[2]];
    const cam = cameraBasis(camPos, target, roll);
    gl.uniform3f(this.u('uCamPos'), ...camPos);
    gl.uniform3f(this.u('uCamFwd'), ...cam.f);
    gl.uniform3f(this.u('uCamRight'), ...cam.r);
    gl.uniform3f(this.u('uCamUp'), ...cam.u);
    gl.uniform1f(this.u('uTanHalf'), Math.tan(((fov / 2) * Math.PI) / 180));
    gl.uniform1f(this.u('uAspect'), LiveScenes.ASPECT);

    gl.uniform3f(this.u('uKeyDir'), ...spec.key.dir);
    gl.uniform2f(this.u('uKey'), spec.key.intensity, spec.key.softness);
    gl.uniform3f(this.u('uRimDir'), ...spec.rim.dir);
    gl.uniform1f(this.u('uRim'), spec.rim.intensity);
    gl.uniform1f(this.u('uAmbient'), spec.ambient);
    gl.uniform3f(this.u('uVoid'), spec.void.top, spec.void.bottom, spec.void.glow);
    gl.uniform2f(this.u('uGlowAt'), ...spec.void.glowAt);
    gl.uniform3f(this.u('uTone'), spec.fog, spec.exposure, spec.gamma);
    const b = spec.board;
    gl.uniform1f(this.u('uBoardOn'), b ? 1 : 0);
    gl.uniform4f(this.u('uBoard'), b?.square ?? 1, b?.extent ?? 4, b?.light ?? 0, b?.dark ?? 0);
    gl.uniform3f(this.u('uBoardC'), b?.cx ?? 0, b?.cz ?? 0, b?.subject ? 1 : 0);

    // Pieces: subjects turn slowly on their own axes, each at its own pace.
    const n = Math.min(MAX_OBJECTS, spec.pieces.length);
    gl.uniform1i(this.u('uObjCount'), n);
    for (let i = 0; i < n; i++) {
      const pc = spec.pieces[i]!;
      const sway = pc.subject ? (Math.sin(motion.time * 0.29 + i * 1.7) * 0.26 + motion.pointer[0] * 0.18) * motion.turn : 0;
      const R = rotation((pc.yaw ?? 0) + sway, pc.pitch ?? 0, pc.roll ?? 0);
      // Upload R^T (world -> local); GLSL mat3 is column-major, so R row-major is R^T column-major.
      gl.uniformMatrix3fv(this.u(`uObjRot[${i}]`), false, R);
      gl.uniform3f(this.u(`uObjPos[${i}]`), pc.x ?? 0, pc.y ?? 0, pc.z ?? 0);
      gl.uniform1f(this.u(`uObjScale[${i}]`), pc.scale ?? 1);
      gl.uniform1i(this.u(`uObjKind[${i}]`), PIECE_INDEX[pc.piece]);
      gl.uniform1f(this.u(`uObjAlbedo[${i}]`), pc.albedo);
      gl.uniform1f(this.u(`uObjSubject[${i}]`), pc.subject ? 1 : 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(restore.program);
    gl.bindVertexArray(restore.vao);
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    if (this.fields) gl.deleteTexture(this.fields);
    gl.deleteProgram(this.program);
  }
}
