/**
 * The live 3D piece for the home screen: one chess piece, lit and rendered into a texture in the
 * dither layer's own WebGL context, in the subject format the dither shader reads (R luminance,
 * G coverage). The dither shader screens it like any image, so it floats, tilts and turns in
 * the same lines, dots or pixels as the rest of the scene.
 */
import { pieceMesh, type Mesh, type PieceKind } from './pieces3d';

const VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * w;
}
`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uEye;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  // Key light from the upper left, a dim fill from the right, a rim from behind.
  vec3 key = normalize(vec3(-0.55, 0.8, 0.45));
  vec3 fill = normalize(vec3(0.8, 0.1, 0.3));
  // Strong contrast: the dither turns tone into line width, so the form must read in tone.
  float diff = pow(max(dot(n, key), 0.0), 1.35);
  float fil = max(dot(n, fill), 0.0) * 0.12;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.5;
  float spec = pow(max(dot(reflect(-key, n), v), 0.0), 24.0) * 0.4;
  float lum = 0.03 + 0.8 * diff + fil + rim + spec;
  outColor = vec4(clamp(lum, 0.0, 1.0), 1.0, 0.0, 1.0);
}
`;

type Mat4 = Float32Array;

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function translate(x: number, y: number, z: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function rotX(a: number): Mat4 {
  const m = translate(0, 0, 0);
  m[5] = Math.cos(a);
  m[6] = Math.sin(a);
  m[9] = -Math.sin(a);
  m[10] = Math.cos(a);
  return m;
}

function rotY(a: number): Mat4 {
  const m = translate(0, 0, 0);
  m[0] = Math.cos(a);
  m[2] = -Math.sin(a);
  m[8] = Math.sin(a);
  m[10] = Math.cos(a);
  return m;
}

function rotZ(a: number): Mat4 {
  const m = translate(0, 0, 0);
  m[0] = Math.cos(a);
  m[1] = Math.sin(a);
  m[4] = -Math.sin(a);
  m[5] = Math.cos(a);
  return m;
}

/** Where the piece is and how it is turned: yaw twists it, pitch and roll tilt it. */
export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
  /** Vertical float, in squares. */
  lift: number;
}

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  count: number;
}

/** Texture size: the piece's square viewport, in pixels. */
const SIZE = 640;

export class Stage3D {
  private program: WebGLProgram;
  private fbo: WebGLFramebuffer;
  private depth: WebGLRenderbuffer;
  readonly texture: WebGLTexture;
  private meshes = new Map<PieceKind, GpuMesh>();
  private uModel: WebGLUniformLocation | null;
  private uViewProj: WebGLUniformLocation | null;
  private uEye: WebGLUniformLocation | null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`3d shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`3d program: ${gl.getProgramInfoLog(p)}`);
    this.program = p;
    this.uModel = gl.getUniformLocation(p, 'uModel');
    this.uViewProj = gl.getUniformLocation(p, 'uViewProj');
    this.uEye = gl.getUniformLocation(p, 'uEye');

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, SIZE, SIZE);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private mesh(kind: PieceKind): GpuMesh {
    const have = this.meshes.get(kind);
    if (have) return have;
    const gl = this.gl;
    const m: Mesh = pieceMesh(kind);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = (data: Float32Array, loc: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    buf(m.positions, 0);
    buf(m.normals, 1);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const g = { vao, count: m.indices.length };
    this.meshes.set(kind, g);
    return g;
  }

  /** Render the piece into `texture`. Restores the default framebuffer and the caller's program. */
  render(kind: PieceKind, pose: Pose, restore: { program: WebGLProgram; vao: WebGLVertexArrayObject | null }): void {
    const gl = this.gl;
    const g = this.mesh(kind);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, SIZE, SIZE);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    // Centre the piece's height on the origin, then turn and tilt it.
    const height = kind === 'king' ? 1.34 : kind === 'queen' ? 1.26 : kind === 'bishop' ? 1.18 : kind === 'knight' ? 1.14 : 1.05;
    const model = mul(
      translate(0, pose.lift, 0),
      mul(rotZ(pose.roll), mul(rotX(pose.pitch), mul(rotY(pose.yaw), translate(0, -height / 2, 0))))
    );
    const eye: [number, number, number] = [0, 0.18, 4.4];
    const view = mul(rotX(Math.atan2(eye[1], eye[2])), translate(-eye[0], -eye[1], -eye[2]));
    const proj = perspective((24 * Math.PI) / 180, 1, 0.5, 20);
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniformMatrix4fv(this.uViewProj, false, mul(proj, view));
    gl.uniform3f(this.uEye, ...eye);
    gl.bindVertexArray(g.vao);
    gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(restore.program);
    gl.bindVertexArray(restore.vao);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteRenderbuffer(this.depth);
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    for (const m of this.meshes.values()) gl.deleteVertexArray(m.vao);
  }
}
