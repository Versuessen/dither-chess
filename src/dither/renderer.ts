/**
 * WebGL2 renderer for the dither layer. Owns the canvas, the textures and the frame loop;
 * reads its inks from the theme tokens. The opponents' scenes render live in 3D
 * (liveScene.ts) where the machine keeps up; otherwise, and with reduced motion, the
 * pre-rendered still images are shown. With reduced motion it renders one static frame per
 * state change: no parallax, no drift, frozen wave, instant swaps.
 */
import { VERTEX, fragmentSource, variantKey, type FragmentVariant } from './shaders';
import { KnightDrift, approach, coverFit, shouldRender, type Size } from './motion';
import { toVec3 } from '../design/contrast';
import { LiveScenes, type FieldAtlas } from './liveScene';
import { sceneSpec } from './sceneSpecs';

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
  /** The opponents' accent colours (--accent-1 ...), in token order. */
  accents: [number, number, number][];
}

/** How an image is screened: the default line screen, or one of the opponents' own. */
export type Screen = 'lines' | 'glyphs' | 'mosaic' | 'dotted';
const SCREEN_INDEX: Record<Screen, number> = { lines: 0, glyphs: 1, mosaic: 2, dotted: 3 };

/** True for CPU rasterisers (SwiftShader, llvmpipe and the like). */
function softwareRenderer(gl: WebGL2RenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

/** The glyph screen's ramp, from no ink to the densest character. */
const GLYPHS = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];

/** An opponent's look: its screen and accent (1-based index into Inks.accents, or null). */
export interface Look {
  screen: Screen;
  accent: number | null;
}

export const ACCENT_COUNT = 8;
const ACCENT_AMOUNT = 0.62;

export function readInks(el: Element = document.documentElement): Inks {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    shadow: toVec3(v('--dither-shadow')),
    light: toVec3(v('--dither-light')),
    bleed: toVec3(v('--dither-bleed')),
    tint: toVec3(v('--dither-tint')),
    tintAmount: Number(v('--dither-tint-amount')) || 0,
    grain: Number(v('--dither-grain')) || 0.08,
    accents: Array.from({ length: ACCENT_COUNT }, (_, i) => toVec3(v(`--accent-${i + 1}`) || '#000000'))
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
/**
 * Behind the game: a slower drift and wave, a stronger pointer parallax (the camera and the
 * screen pattern both move), at 30 fps.
 */
const CALM_MOTION = { drift: 0.7, parallax: 1.4, phase: 0.5, fps: 30 } as const;
/** The screen pattern's own movement, device px per unit of pointer, and its slow drift. */
const SCREEN_PARALLAX = 26;
const SCREEN_DRIFT = 9;
/** Live scenes render at most this often, and at this share of the canvas height (max rows). */
const SCENE_FPS = { live: 30, calm: 20 } as const;
const SCENE_SCALE = 0.42;
const SCENE_MAX_ROWS = 420;
/** Frame time (ms, smoothed) above which live scenes give way to the stills on this machine. */
const SLOW_FRAME_MS = 60;
/** How long the first image waits for the live scenes before showing the still. */
const FIELDS_WAIT_MS = 4000;

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
  | 'uCalm'
  | 'uAccent'
  | 'uAccentAmt'
  | 'uGlyphs'
  | 'uGlyphCount'
  | 'uScreenOffset'
  | 'uTime'
  | 'uCellSize';

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
  /** Called once per rendered frame (tests and the fps probe). */
  onFrame?: (now: number) => void;
  /** Screen and accent per subject id; subjects not listed use the plain line screen. */
  looks?: Record<string, Look>;
}

export class DitherRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<UniformName, WebGLUniformLocation | null>();
  private programs = new Map<string, { program: WebGLProgram; uniforms: Map<UniformName, WebGLUniformLocation | null> }>();
  private textures = new Map<string, Tex>();
  private loading = new Map<string, Promise<Tex>>();
  private morph: Tex | null = null;
  private blank: Tex | null = null;

  private current: Tex | null = null;
  private previous: Tex | null = null;
  private wantedSubject: string | null = null;
  private screenA = 0;
  private screenB = 0;
  private accentTarget: Look['accent'] = null;
  private accentNow: [number, number, number] = [0, 0, 0];
  private accentAmt = 0;
  private vao: WebGLVertexArrayObject | null = null;
  private glyphs: WebGLTexture | null = null;
  private dissolveStart = -Infinity;

  /** Live 3D scenes: two render targets, the current subject's and the previous one's. */
  private scenes: LiveScenes | null = null;
  private fieldsWait: Promise<void> | null = null;
  private sceneIds: [string | null, string | null] = [null, null];
  private sceneSlot = 0;
  private sceneLastRender = [0, 0];
  private slowFrames = 0;
  private verySlowFrames = 0;
  private frameMs = 16;
  private liveFailed = false;

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
    if (this.scenes && !this.scenes.ready && !this.liveFailed && !this.reducedMotion && sceneSpec(id)) {
      await this.requestFields();
      if (this.disposed || this.wantedSubject !== id) return;
    }
    if (this.liveOn() && sceneSpec(id)) {
      // Live: the scene renders into the other target; the old one keeps rendering while it dissolves.
      if (this.sceneIds[this.sceneSlot] === id) return;
      this.sceneSlot = 1 - this.sceneSlot;
      this.sceneIds[this.sceneSlot] = id;
      this.sceneLastRender[this.sceneSlot] = 0;
      this.previous = this.current ?? this.blank;
      this.current = null;
    } else {
      const tex = await this.load(id);
      if (this.disposed || this.wantedSubject !== id) return;
      if (this.current === tex) return;
      this.previous = this.current ?? this.blank;
      this.current = tex;
      this.sceneIds = [null, null];
    }
    const look = this.opts.looks?.[id];
    this.screenB = this.screenA;
    this.screenA = SCREEN_INDEX[look?.screen ?? 'lines'];
    this.accentTarget = look?.accent ?? null;
    if (this.accentTarget !== null && this.accentAmt < 0.01) this.accentNow = [...this.accentColour()];
    if (instant || this.reducedMotion) this.settleAccent();
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
    if (this.reducedMotion) this.modeValues = { ...this.modeTargets };
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
    this.settleAccent();
    this.invalidate();
  }

  private accentColour(): [number, number, number] {
    const a = this.accentTarget;
    return a === null ? this.accentNow : (this.inks.accents[a - 1] ?? this.accentNow);
  }

  /** Jump the accent to its target (no animation). */
  private settleAccent(): void {
    this.accentNow = [...this.accentColour()];
    this.accentAmt = this.accentTarget === null ? 0 : ACCENT_AMOUNT;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) {
      this.modeValues = { ...this.modeTargets };
      this.dissolveStart = -Infinity;
      this.morphMix = this.promotion ? 1 : 0;
      this.morphT = this.morphMix;
      this.settleAccent();
    }
    // Reduced motion shows the still images; without it the live scenes come back.
    const live = this.sceneIds.some(Boolean);
    if (this.wantedSubject && on && live) {
      this.sceneIds = [null, null];
      void this.setSubject(this.wantedSubject, true);
    } else if (this.wantedSubject && !on && !live && this.scenes && !this.liveFailed) {
      void this.setSubject(this.wantedSubject, true);
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
    if (this.glyphs) gl.deleteTexture(this.glyphs);
    this.scenes?.dispose();
    for (const e of this.programs.values()) gl.deleteProgram(e.program);
  }

  // ------------------------------------------------------------------ internals

  private init(): void {
    const gl = this.gl;
    this.programs.clear();
    this.program = null;
    this.use({ screenA: 0, screenB: null, morph: false, morphScreen: false });
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.sceneIds = [null, null];
    this.scenes = null;
    this.fieldsWait = null;
    // Live scenes are an extra: without them (or until their fields are ready) the stills show.
    // A software renderer cannot trace them in real time, so it gets the stills from the start.
    if (softwareRenderer(gl)) this.liveFailed = true;
    if (!this.liveFailed) {
      try {
        this.scenes = new LiveScenes(gl);
      } catch (err) {
        console.warn('Live scenes disabled:', err);
        this.liveFailed = true;
      }
    }
    this.makeGlyphs();
    if (typeof document !== 'undefined' && document.fonts) void document.fonts.ready.then(() => !this.disposed && this.makeGlyphs());
    this.blank = this.makeTexture(new Uint8Array([0, 0, 0]), { width: 1, height: 1 }, [0.5, 0.5]);
    void this.loadMorph();
  }

  /** Compile (once) and bind the fragment shader variant a frame needs. */
  private use(v: FragmentVariant): void {
    const gl = this.gl;
    const key = variantKey(v);
    let entry = this.programs.get(key);
    if (!entry) {
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
      const vs = compile(gl.VERTEX_SHADER, VERTEX);
      const fs = compile(gl.FRAGMENT_SHADER, fragmentSource(v));
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
        throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      entry = { program: p, uniforms: new Map() };
      this.programs.set(key, entry);
    }
    if (this.program !== entry.program) {
      this.program = entry.program;
      this.uniforms = entry.uniforms;
      gl.useProgram(entry.program);
    }
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
    const calmFps = this.mode === 'calm' ? CALM_MOTION.fps : 60;
    if (!shouldRender(now, this.lastFrame, calmFps)) return;
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.step(dt);
    this.draw(now);
    if (frameMs < 1000) this.watchSpeed(now, frameMs);
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
    // The accent follows the subject over about half a second.
    const target = this.accentColour();
    for (let i = 0; i < 3; i++) this.accentNow[i] = approach(this.accentNow[i]!, target[i]!, dt, 0.12);
    this.accentAmt = approach(this.accentAmt, this.accentTarget === null ? 0 : ACCENT_AMOUNT, dt, 0.12);
    // Full motion on the live home screen, a gentler version behind the game.
    const calm = this.mode === 'calm';
    const motion = live ? 1 : calm ? CALM_MOTION.parallax : 0;
    this.pointerSmooth[0] = approach(this.pointerSmooth[0], this.pointer[0] * motion, dt, 0.25);
    this.pointerSmooth[1] = approach(this.pointerSmooth[1], this.pointer[1] * motion, dt, 0.25);
    this.scrollSmooth = approach(this.scrollSmooth, this.scroll * (live ? 1 : 0), dt, 0.2);
    // Behind the game the wave moves slowly and the grain holds still.
    this.phase += dt * PHASE_SPEED * (calm ? CALM_MOTION.phase : 1);
    if (!calm) this.frame = (this.frame + 1) % 4096;
  }

  /** Live scenes are on: supported, fields ready, motion allowed, and the machine keeps up. */
  private liveOn(): boolean {
    if (!this.scenes || this.liveFailed || this.reducedMotion) return false;
    return this.scenes.ready;
  }

  /**
   * Start building the distance fields in a worker. Resolves once live scenes can render, or
   * cannot (no worker, an error, or FIELDS_WAIT_MS passed), so the first image never flashes a
   * still that the live scene then replaces.
   */
  private requestFields(): Promise<void> {
    if (this.fieldsWait) return this.fieldsWait;
    const scenes = this.scenes;
    if (!scenes || typeof Worker === 'undefined') return Promise.resolve();
    this.fieldsWait = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FIELDS_WAIT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      let w: Worker;
      try {
        w = new Worker(new URL('./fieldWorker.ts', import.meta.url), { type: 'module', name: 'dither-fields' });
      } catch {
        this.liveFailed = true;
        done();
        return;
      }
      w.onmessage = (e: MessageEvent<FieldAtlas>) => {
        w.terminate();
        if (!this.disposed && this.scenes === scenes) {
          scenes.setFields(e.data);
          // Arrived after the wait gave up: switch the still that is showing to its live scene.
          if (this.wantedSubject && !this.sceneIds.some(Boolean)) void this.setSubject(this.wantedSubject, true);
        }
        done();
      };
      w.onerror = () => {
        w.terminate();
        this.liveFailed = true;
        done();
      };
      w.postMessage(null);
    });
    return this.fieldsWait;
  }

  /** The glyph screen's characters, drawn once into a texture (again when the fonts load). */
  private makeGlyphs(): void {
    if (typeof document === 'undefined') return;
    // Cells 5:8, as the shader's glyph cells.
    const cw = 20;
    const ch = 32;
    const c = document.createElement('canvas');
    c.width = cw * GLYPHS.length;
    c.height = ch;
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `30px "Departure Mono", ui-monospace, monospace`;
    GLYPHS.forEach((chr, i) => g.fillText(chr, i * cw + cw / 2, ch / 2 + 1));
    const gl = this.gl;
    if (!this.glyphs) this.glyphs = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.glyphs);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.invalidate();
  }

  /**
   * Machines that cannot keep up get the stills: when the smoothed frame time stays above
   * SLOW_FRAME_MS for two seconds of live rendering (or three frames in a row take over 250 ms),
   * live scenes stop for this session.
   */
  private watchSpeed(now: number, frameMs: number): void {
    if (!this.sceneIds.some(Boolean)) return;
    this.frameMs += (Math.min(frameMs, 250) - this.frameMs) * 0.1;
    this.slowFrames = this.frameMs > SLOW_FRAME_MS ? this.slowFrames + frameMs : 0;
    // Three frames in a row that take a quarter of a second are reason enough (one alone may
    // be the page loading something); otherwise two slow seconds.
    this.verySlowFrames = frameMs > 250 ? this.verySlowFrames + 1 : 0;
    if (this.verySlowFrames >= 3 || (this.slowFrames > 2000 && now - this.startTime > 4000)) {
      console.info(`Live scenes off: frames take ${Math.round(this.frameMs)} ms here; showing the still images.`);
      this.liveFailed = true;
      this.sceneIds = [null, null];
      this.current = null;
      if (this.wantedSubject) void this.setSubject(this.wantedSubject, true);
    }
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
    const t = (now - this.startTime) / 1000;
    const dissolve = Math.min(1, Math.max(0, (now - this.dissolveStart) / DISSOLVE_MS));
    if (dissolve < 1) this.dirty = true;

    // Live scenes: render the current one (and the previous one while it dissolves) at their own pace.
    let cur = this.current ?? this.blank!;
    let prev = this.previous ?? this.blank!;
    if (this.scenes?.ready && this.sceneIds[this.sceneSlot] && !this.liveFailed) {
      const rows = Math.min(SCENE_MAX_ROWS, H * SCENE_SCALE);
      const fps = this.mode === 'calm' ? SCENE_FPS.calm : SCENE_FPS.live;
      const calm = this.mode === 'calm';
      for (const slot of [this.sceneSlot, 1 - this.sceneSlot]) {
        const id = this.sceneIds[slot];
        const spec = id ? sceneSpec(id) : undefined;
        if (!spec) continue;
        const isCurrent = slot === this.sceneSlot;
        if (!isCurrent && dissolve >= 1) continue;
        const tex = this.scenes.target(slot, rows);
        if (now - this.sceneLastRender[slot]! >= 1000 / fps - 1.5) {
          this.sceneLastRender[slot] = now;
          this.scenes.render(
            slot,
            spec,
            { time: t, pointer: this.pointerSmooth, parallax: calm ? CALM_MOTION.parallax : 1, turn: calm ? 0.6 : 1 },
            { program: this.program, vao: this.vao }
          );
          gl.viewport(0, 0, W, H);
        }
        const live = { tex, size: this.scenes.size(slot), focal: spec.focal };
        if (isCurrent) cur = live;
        else prev = live;
      }
    }
    const fitA = coverFit(cur.size, view, cur.focal);
    const fitB = coverFit(prev.size, view, prev.focal);
    const morphScreen = this.mode === 'calm' && !this.reducedMotion;
    this.use({
      screenA: this.screenA,
      screenB: dissolve < 1 ? this.screenB : null,
      morph: !!this.morph && this.morphMix > 0.001,
      morphScreen
    });

    const still = this.reducedMotion;
    const driftScale = this.mode === 'calm' ? CALM_MOTION.drift : 1;
    const [dx, dy] = still ? [0, 0] : (this.drift.at(t).map((v) => v * driftScale) as [number, number]);
    const px = still ? 0 : this.pointerSmooth[0];
    const py = still ? 0 : this.pointerSmooth[1];
    const sy = still ? 0 : (this.scrollSmooth - 0.5) * 0.02;
    // The screen pattern itself moves: with the pointer, and slowly on its own.
    const screenOffset: [number, number] = still
      ? [0, 0]
      : [
          (px * SCREEN_PARALLAX + Math.sin(t * 0.07) * SCREEN_DRIFT) * dpr * (this.mode === 'calm' ? 1 : 0.5),
          (py * SCREEN_PARALLAX + Math.cos(t * 0.05) * SCREEN_DRIFT) * dpr * (this.mode === 'calm' ? 1 : 0.5)
        ];

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
    gl.uniform1f(this.u('uPhase'), this.reducedMotion ? 0.8 : this.phase);
    gl.uniform1f(this.u('uFrame'), this.reducedMotion ? 0 : this.frame);
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
    gl.uniform3f(this.u('uAccent'), ...this.accentNow);
    gl.uniform1f(this.u('uAccentAmt'), this.accentAmt);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphs ?? this.blank!.tex);
    gl.uniform1i(this.u('uGlyphs'), 3);
    gl.uniform1f(this.u('uGlyphCount'), GLYPHS.length);
    gl.uniform2f(this.u('uScreenOffset'), ...screenOffset);
    gl.uniform1f(this.u('uTime'), still ? 0 : t);
    gl.uniform1f(this.u('uCellSize'), Math.max(W, H) / 3.2);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.opts.onFrame?.(now);
    if (this.reducedMotion && this.dirty) requestAnimationFrame(() => this.draw(performance.now()));
  }
}
