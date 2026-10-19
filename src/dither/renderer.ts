/**
 * WebGL2 renderer for the dither layer. Owns the canvas, the textures and the frame loop;
 * reads its inks from the theme tokens. With reduced motion it renders one static frame
 * per state change: no parallax, no drift, frozen wave, instant swaps.
 */
import { FRAGMENT, VERTEX } from './shaders';
import { KnightDrift, approach, coverFit, shouldRender, type Size } from './motion';
import { toVec3 } from '../design/contrast';

export type DitherMode = 'black' | 'reveal' | 'live' | 'calm';

export interface SceneInfo {
  width: number;
  height: number;
  focal: [number, number];
}

export interface ArtManifest {
  scenes: Record<string, SceneInfo>;
  morph: { frames: number; cols: number; frameWidth: number; frameHeight: number };
}

export interface Inks {
  shadow: [number, number, number];
  light: [number, number, number];
  bleed: [number, number, number];
  tint: [number, number, number];
  tintAmount: number;
  grain: number;
}

export function readInks(el: Element = document.documentElement): Inks {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    shadow: toVec3(v('--dither-shadow')),
    light: toVec3(v('--dither-light')),
    bleed: toVec3(v('--dither-bleed')),
    tint: toVec3(v('--dither-tint')),
    tintAmount: Number(v('--dither-tint-amount')) || 0,
    grain: Number(v('--dither-grain')) || 0.08
  };
}

/** Visual constants, in CSS px where they are lengths. */
const LINE_PERIOD = 3.4;
const RIPPLE_AMP = 0.55;
const PHASE_SPEED = 0.32;
const DISSOLVE_MS = 400;
const MAX_DPR = 2;
const SUBJECT_PARALLAX = 0.014;
const BG_PARALLAX = 0.005;
const GRAIN_PARALLAX = 3;
const DRIFT_STEP = 0.0042;

type UniformName =
  | 'uRes'
  | 'uPhase'
  | 'uFrame'
  | 'uSubjA'
  | 'uSubjB'
  | 'uFitA'
  | 'uFitB'
  | 'uDissolve'
  | 'uMorph'
  | 'uMorphGrid'
  | 'uMorphT'
  | 'uMorphMix'
  | 'uSubjOffset'
  | 'uBgOffset'
  | 'uGrainOffset'
  | 'uInkShadow'
  | 'uInkLight'
  | 'uInkBleed'
  | 'uInkTint'
  | 'uTintAmount'
  | 'uGrain'
  | 'uPeriod'
  | 'uRippleAmp'
  | 'uRippleWave'
  | 'uReveal'
  | 'uBlack'
  | 'uCalm';

interface Tex {
  tex: WebGLTexture;
  size: Size;
  focal: [number, number];
}

export interface RendererOptions {
  manifest: ArtManifest;
  artBase: string;
  reducedMotion: boolean;
  inks: Inks;
  /**
   * A still image (the profile portrait): no wave, parallax, drift or live grain, but
   * user-triggered transitions (dissolve, promotion) still animate.
   */
  still?: boolean;
  /** Called once per rendered frame (tests and the fps probe). */
  onFrame?: (now: number) => void;
}

export class DitherRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<UniformName, WebGLUniformLocation | null>();
  private textures = new Map<string, Tex>();
  private loading = new Map<string, Promise<Tex>>();
  private morph: Tex | null = null;
  private blank: Tex | null = null;

  private current: Tex | null = null;
  private previous: Tex | null = null;
  private wantedSubject: string | null = null;
  private dissolveStart = -Infinity;

  private mode: DitherMode = 'black';
  private modeValues = { black: 1, reveal: 0, calm: 0 };
  private modeTargets = { black: 1, reveal: 0, calm: 0 };
  private promotion = false;
  private morphT = 0;
  private morphMix = 0;

  private pointer: [number, number] = [0, 0];
  private pointerSmooth: [number, number] = [0, 0];
  private scroll = 0;
  private scrollSmooth = 0;
  private drift = new KnightDrift();
  private phase = 0;
  private frame = 0;
  private startTime = performance.now();
  private lastFrame = 0;
  private lastTick = 0;
  private raf = 0;
  private running = false;
  private dirty = true;
  private reducedMotion: boolean;
  private inks: Inks;
  private disposed = false;
  private readonly onVisibility = () => this.updateRunning();
  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.stop();
  };
  private readonly onRestored = () => {
    this.textures.clear();
    this.loading.clear();
    this.morph = null;
    this.blank = null;
    this.init();
    if (this.wantedSubject) void this.setSubject(this.wantedSubject, true);
    this.updateRunning();
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: RendererOptions
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power'
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.reducedMotion = opts.reducedMotion;
    this.inks = opts.inks;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.init();
    this.updateRunning();
  }

  // ------------------------------------------------------------------ public controls

  async setSubject(id: string, instant = false): Promise<void> {
    this.wantedSubject = id;
    const tex = await this.load(id);
    if (this.disposed || this.wantedSubject !== id) return;
    if (this.current === tex) return;
    this.previous = this.current ?? this.blank;
    this.current = tex;
    this.dissolveStart = instant || this.reducedMotion || !this.previous ? -Infinity : performance.now();
    this.invalidate();
  }

  /** Warm the texture cache without showing anything. */
  preload(ids: string[]): Promise<unknown> {
    return Promise.all(ids.map((id) => this.load(id).catch(() => undefined)));
  }

  setMode(mode: DitherMode): void {
    this.mode = mode;
    this.modeTargets = {
      black: mode === 'black' ? 1 : 0,
      reveal: mode === 'black' ? 0 : 1,
      calm: mode === 'calm' ? 1 : 0
    };
    // Still images (the portrait) appear at once; only the full-screen layer fades and reveals.
    if (this.reducedMotion || this.opts.still) this.modeValues = { ...this.modeTargets };
    this.invalidate();
  }

  setPromotion(on: boolean): void {
    this.promotion = on;
    if (this.reducedMotion) {
      this.morphMix = on ? 1 : 0;
      this.morphT = on ? 1 : 0;
    }
    this.invalidate();
  }

  /** Pointer position in [-1, 1]^2, centre = 0. */
  setPointer(x: number, y: number): void {
    this.pointer = [x, y];
    if (!this.reducedMotion) this.invalidate();
  }

  /** Scroll progress of the roster in [0, 1]. */
  setScroll(p: number): void {
    this.scroll = p;
    if (!this.reducedMotion) this.invalidate();
  }

  setInks(inks: Inks): void {
    this.inks = inks;
    this.invalidate();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) {
      this.modeValues = { ...this.modeTargets };
      this.dissolveStart = -Infinity;
      this.morphMix = this.promotion ? 1 : 0;
      this.morphT = this.morphMix;
    }
    this.invalidate();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.invalidate();
    }
  }

  get isAnimating(): boolean {
    return this.running;
  }

  destroy(): void {
    this.disposed = true;
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t.tex);
    if (this.morph) gl.deleteTexture(this.morph.tex);
    if (this.blank) gl.deleteTexture(this.blank.tex);
    if (this.program) gl.deleteProgram(this.program);
  }

  // ------------------------------------------------------------------ internals

  private init(): void {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    }
    this.program = p;
    gl.useProgram(p);
    this.uniforms.clear();
    gl.bindVertexArray(gl.createVertexArray());
    this.blank = this.makeTexture(new Uint8Array([0, 0, 0]), { width: 1, height: 1 }, [0.5, 0.5]);
    void this.loadMorph();
  }

  private u(name: UniformName): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program!, name));
    return this.uniforms.get(name)!;
  }

  private makeTexture(data: TexImageSource | Uint8Array, size: Size, focal: [number, number]): Tex {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (data instanceof Uint8Array) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, size.width, size.height, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, data);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, size, focal };
  }

  private async fetchBitmap(url: string): Promise<ImageBitmap> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return createImageBitmap(await res.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none'
    });
  }

  private load(id: string): Promise<Tex> {
    const have = this.textures.get(id);
    if (have) return Promise.resolve(have);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const info = this.opts.manifest.scenes[id];
    if (!info) return Promise.reject(new Error(`unknown subject ${id}`));
    const p = this.fetchBitmap(`${this.opts.artBase}${id}.png`).then((bmp) => {
      const t = this.makeTexture(bmp, { width: info.width, height: info.height }, info.focal);
      bmp.close();
      this.textures.set(id, t);
      this.loading.delete(id);
      return t;
    });
    this.loading.set(id, p);
    return p;
  }

  private async loadMorph(): Promise<void> {
    const m = this.opts.manifest.morph;
    const bmp = await this.fetchBitmap(`${this.opts.artBase}morph.png`);
    if (this.disposed) return;
    const rows = Math.ceil(m.frames / m.cols);
    this.morph = this.makeTexture(bmp, { width: m.cols * m.frameWidth, height: rows * m.frameHeight }, [0.5, 0.5]);
    bmp.close();
    this.invalidate();
  }

  private invalidate(): void {
    this.dirty = true;
    this.updateRunning();
  }

  /** Animate while visible and something moves; with reduced motion only draw on demand. */
  private updateRunning(): void {
    if (this.disposed) return;
    const visible = document.visibilityState !== 'hidden';
    if (!visible) {
      this.stop();
      return;
    }
    if (this.reducedMotion) {
      this.stop();
      if (this.dirty) {
        // One static frame per state change.
        requestAnimationFrame(() => this.draw(performance.now()));
      }
      return;
    }
    if (!this.running) {
      this.running = true;
      this.lastTick = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!shouldRender(now, this.lastFrame)) return;
    this.lastFrame = now;
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.step(dt);
    this.draw(now);
    // The calm game backdrop and the portrait are still images: stop once transitions settle.
    if ((this.mode === 'calm' || this.opts.still) && this.settled(now)) this.stop();
  };

  private step(dt: number): void {
    const calmTarget = this.modeTargets.calm;
    const live = this.mode === 'live';
    // Mode blends.
    this.modeValues.black = approach(this.modeValues.black, this.modeTargets.black, dt, 0.12);
    this.modeValues.reveal =
      this.modeTargets.reveal > this.modeValues.reveal
        ? Math.min(1, this.modeValues.reveal + dt / 0.9)
        : approach(this.modeValues.reveal, this.modeTargets.reveal, dt, 0.1);
    this.modeValues.calm = approach(this.modeValues.calm, calmTarget, dt, 0.18);
    // Promotion morph: the silhouette swaps in fast, then the pawn grows into a queen.
    const on = this.promotion ? 1 : 0;
    this.morphMix = approach(this.morphMix, on, dt, 0.08);
    this.morphT = this.promotion ? Math.min(1, this.morphT + dt / 0.75) : Math.max(0, this.morphT - dt / 0.35);
    // Motion only on the live home screen.
    const motion = live ? 1 : 0;
    this.pointerSmooth[0] = approach(this.pointerSmooth[0], this.pointer[0] * motion, dt, 0.25);
    this.pointerSmooth[1] = approach(this.pointerSmooth[1], this.pointer[1] * motion, dt, 0.25);
    this.scrollSmooth = approach(this.scrollSmooth, this.scroll * motion, dt, 0.2);
    if (this.mode !== 'calm' && !this.opts.still) {
      this.phase += dt * PHASE_SPEED;
      this.frame = (this.frame + 1) % 4096;
    }
  }

  /** Nothing left to animate on a still or calm image. */
  private settled(now: number): boolean {
    const dissolving = now - this.dissolveStart < DISSOLVE_MS;
    const target = this.promotion ? 1 : 0;
    const morphing = Math.abs(this.morphMix - target) > 0.002 || Math.abs(this.morphT - target) > 0.002;
    const blending =
      Math.abs(this.modeValues.black - this.modeTargets.black) > 0.002 ||
      Math.abs(this.modeValues.reveal - this.modeTargets.reveal) > 0.002 ||
      Math.abs(this.modeValues.calm - this.modeTargets.calm) > 0.002;
    return !dissolving && !morphing && !blending;
  }

  private draw(now: number): void {
    if (this.disposed || this.gl.isContextLost()) return;
    this.dirty = false;
    this.resize();
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const view = { width: W, height: H };
    const cur = this.current ?? this.blank!;
    const prev = this.previous ?? this.blank!;
    const fitA = coverFit(cur.size, view, cur.focal);
    const fitB = coverFit(prev.size, view, prev.focal);
    const dissolve = Math.min(1, Math.max(0, (now - this.dissolveStart) / DISSOLVE_MS));
    if (dissolve < 1) this.dirty = true;

    const still = this.reducedMotion || this.mode === 'calm' || this.opts.still === true;
    const t = (now - this.startTime) / 1000;
    const [dx, dy] = still ? [0, 0] : this.drift.at(t);
    const px = still ? 0 : this.pointerSmooth[0];
    const py = still ? 0 : this.pointerSmooth[1];
    const sy = still ? 0 : (this.scrollSmooth - 0.5) * 0.02;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(this.u('uSubjA'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(this.u('uSubjB'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, (this.morph ?? this.blank!).tex);
    gl.uniform1i(this.u('uMorph'), 2);

    const m = this.opts.manifest.morph;
    gl.uniform4f(this.u('uMorphGrid'), m.cols, Math.ceil(m.frames / m.cols), m.frames, m.frameWidth / m.frameHeight);
    gl.uniform1f(this.u('uMorphT'), this.morphT);
    gl.uniform1f(this.u('uMorphMix'), this.morph ? this.morphMix : 0);

    gl.uniform2f(this.u('uRes'), W, H);
    gl.uniform1f(this.u('uPhase'), this.reducedMotion || this.opts.still ? 0.8 : this.phase);
    gl.uniform1f(this.u('uFrame'), this.reducedMotion || this.opts.still ? 0 : this.frame);
    gl.uniform4f(this.u('uFitA'), ...fitA);
    gl.uniform4f(this.u('uFitB'), ...fitB);
    gl.uniform1f(this.u('uDissolve'), dissolve);
    gl.uniform2f(
      this.u('uSubjOffset'),
      -px * SUBJECT_PARALLAX + dx * DRIFT_STEP,
      -py * SUBJECT_PARALLAX + dy * DRIFT_STEP + sy
    );
    gl.uniform2f(
      this.u('uBgOffset'),
      -px * BG_PARALLAX + dx * DRIFT_STEP * 0.35,
      -py * BG_PARALLAX + dy * DRIFT_STEP * 0.35 + sy * 0.3
    );
    gl.uniform2f(this.u('uGrainOffset'), px * GRAIN_PARALLAX * dpr, py * GRAIN_PARALLAX * dpr);

    const inks = this.inks;
    gl.uniform3f(this.u('uInkShadow'), ...inks.shadow);
    gl.uniform3f(this.u('uInkLight'), ...inks.light);
    gl.uniform3f(this.u('uInkBleed'), ...inks.bleed);
    gl.uniform3f(this.u('uInkTint'), ...inks.tint);
    gl.uniform1f(this.u('uTintAmount'), inks.tintAmount);
    gl.uniform1f(this.u('uGrain'), inks.grain);

    gl.uniform1f(this.u('uPeriod'), LINE_PERIOD * dpr);
    gl.uniform1f(this.u('uRippleAmp'), RIPPLE_AMP * dpr);
    gl.uniform1f(this.u('uRippleWave'), W / 8);

    gl.uniform1f(this.u('uReveal'), this.modeValues.reveal);
    gl.uniform1f(this.u('uBlack'), this.modeValues.black);
    gl.uniform1f(this.u('uCalm'), this.modeValues.calm);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.opts.onFrame?.(now);
    if (this.reducedMotion && this.dirty) requestAnimationFrame(() => this.draw(performance.now()));
  }
}
