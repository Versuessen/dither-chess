/**
 * Sounds: short CC0 samples (public/sounds, sources in NOTICE) played through Web Audio, and an
 * optional quiet music bed (public/music). Nothing loads until the first sound is wanted; the
 * service worker caches the files for offline play.
 */

export type SoundName =
  | 'move'
  | 'capture'
  | 'castle'
  | 'check'
  | 'promote'
  | 'low-time'
  | 'illegal'
  | 'start'
  | 'end'
  | 'select'
  | 'confirm'
  | 'back';

const SOUNDS: readonly SoundName[] = ['move', 'capture', 'castle', 'check', 'promote', 'low-time', 'illegal', 'start', 'end', 'select', 'confirm', 'back'];
const MUSIC = ['the-divine-elf', 'suspended'] as const;

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function url(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function buffer(ac: AudioContext, path: string): Promise<AudioBuffer | null> {
  let p = buffers.get(path);
  if (!p) {
    p = fetch(url(path))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${path}: ${r.status}`))))
      .then((b) => ac.decodeAudioData(b))
      .catch(() => null);
    buffers.set(path, p);
  }
  return p;
}

/** Decode every effect ahead of time so the first move is not silent. */
export function preloadSounds(): void {
  const ac = audio();
  if (ac) for (const s of SOUNDS) void buffer(ac, `sounds/${s}.wav`);
}

export function play(name: SoundName, gain = 1): void {
  const ac = audio();
  if (!ac) return;
  void buffer(ac, `sounds/${name}.wav`).then((b) => {
    if (!b) return;
    const src = ac.createBufferSource();
    src.buffer = b;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ac.destination);
    src.start();
  });
}

/** Which sound a move makes, from its SAN. */
export function soundForSan(san: string): SoundName {
  if (san.includes('+') || san.includes('#')) return 'check';
  if (san.includes('=')) return 'promote';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  return 'move';
}

// ------------------------------------------------------------------ music

/** Quiet, warm and well apart: the tracks play in turn with silence between them. */
const MUSIC_LEVEL = 0.22;
const FADE_S = 2.5;
const GAP_S: [number, number] = [6, 16];

class Music {
  private on = false;
  private bus: GainNode | null = null;
  private current: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private turn = 0;

  get playing(): boolean {
    return this.on;
  }

  /** Start (or, after a gesture, resume) the music. */
  start(): void {
    const ac = audio();
    if (!ac || this.on) return;
    this.on = true;
    if (!this.bus) {
      // A gentle low-pass keeps the music behind everything else.
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      this.bus = ac.createGain();
      this.bus.connect(lp).connect(ac.destination);
    }
    this.bus.gain.cancelScheduledValues(ac.currentTime);
    this.bus.gain.setValueAtTime(this.bus.gain.value, ac.currentTime);
    this.bus.gain.linearRampToValueAtTime(MUSIC_LEVEL, ac.currentTime + FADE_S);
    if (!this.current) void this.next(0.5);
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ac = ctx;
    const src = this.current;
    this.current = null;
    if (!ac || !this.bus) return;
    this.bus.gain.cancelScheduledValues(ac.currentTime);
    this.bus.gain.setValueAtTime(this.bus.gain.value, ac.currentTime);
    this.bus.gain.linearRampToValueAtTime(0, ac.currentTime + 0.6);
    src?.stop(ac.currentTime + 0.7);
  }

  private async next(delay: number): Promise<void> {
    const ac = audio();
    if (!ac || !this.on || !this.bus) return;
    const name = MUSIC[this.turn++ % MUSIC.length]!;
    const b = await buffer(ac, `music/${name}.mp3`);
    if (!b || !this.on) return;
    const src = ac.createBufferSource();
    src.buffer = b;
    const g = ac.createGain();
    const t0 = ac.currentTime + delay;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + FADE_S);
    g.gain.setValueAtTime(1, t0 + b.duration - FADE_S);
    g.gain.linearRampToValueAtTime(0, t0 + b.duration);
    src.connect(g).connect(this.bus);
    src.start(t0);
    this.current = src;
    src.onended = () => {
      if (this.current !== src) return;
      this.current = null;
      const gap = GAP_S[0] + Math.random() * (GAP_S[1] - GAP_S[0]);
      this.timer = setTimeout(() => void this.next(0), gap * 1000);
    };
  }
}

export const music = new Music();
