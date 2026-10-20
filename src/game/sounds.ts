/**
 * Sounds: short CC0 samples (public/sounds, sources in NOTICE) played through Web Audio, and an
 * optional quiet music loop (public/music). Nothing loads until the first sound is wanted; the
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

/** The music: one track, chosen in Settings, looping without a break. */
export const MUSIC_TRACKS = [
  { id: 'the-divine-elf', title: 'The Divine Elf' },
  { id: 'suspended', title: 'Suspended' }
] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number]['id'];
export const DEFAULT_TRACK: MusicTrack = MUSIC_TRACKS[0].id;

const MUSIC_LEVEL = 0.22;
const FADE_S = 2.5;
/** Below this level a sample counts as silence (trimmed from the loop's ends). */
const SILENCE = 0.002;

/**
 * The part of a recording between its leading and trailing silence, in seconds, so the loop
 * runs on without a gap.
 */
export function audibleSpan(channels: readonly Float32Array[], sampleRate: number): [number, number] {
  const n = channels[0]?.length ?? 0;
  const loud = (i: number) => channels.some((c) => Math.abs(c[i]!) > SILENCE);
  let first = 0;
  while (first < n && !loud(first)) first++;
  let last = n - 1;
  while (last > first && !loud(last)) last--;
  if (first >= n) return [0, n / sampleRate];
  return [first / sampleRate, (last + 1) / sampleRate];
}

const spans = new WeakMap<AudioBuffer, [number, number]>();
function loopSpan(b: AudioBuffer): [number, number] {
  let s = spans.get(b);
  if (!s) {
    s = audibleSpan(Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)), b.sampleRate);
    spans.set(b, s);
  }
  return s;
}

class Music {
  private on = false;
  private track: MusicTrack = DEFAULT_TRACK;
  private bus: GainNode | null = null;
  private current: { src: AudioBufferSourceNode; gain: GainNode; track: MusicTrack } | null = null;

  get playing(): boolean {
    return this.on;
  }

  /** Start (or, after a gesture, resume) the music; with another track, cross-fade to it. */
  start(track: MusicTrack = this.track): void {
    const ac = audio();
    if (!ac) return;
    const changed = track !== this.track;
    this.track = track;
    if (this.on && !changed) return;
    if (!this.bus) {
      // A gentle low-pass keeps the music behind everything else.
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      this.bus = ac.createGain();
      this.bus.gain.value = 0;
      this.bus.connect(lp).connect(ac.destination);
    }
    if (!this.on) {
      this.on = true;
      this.bus.gain.cancelScheduledValues(ac.currentTime);
      this.bus.gain.setValueAtTime(this.bus.gain.value, ac.currentTime);
      this.bus.gain.linearRampToValueAtTime(MUSIC_LEVEL, ac.currentTime + FADE_S);
    }
    if (this.current?.track !== this.track) void this.play();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    const ac = ctx;
    const cur = this.current;
    this.current = null;
    if (!ac || !this.bus) return;
    this.bus.gain.cancelScheduledValues(ac.currentTime);
    this.bus.gain.setValueAtTime(this.bus.gain.value, ac.currentTime);
    this.bus.gain.linearRampToValueAtTime(0, ac.currentTime + 0.6);
    cur?.src.stop(ac.currentTime + 0.7);
  }

  private async play(): Promise<void> {
    const ac = audio();
    if (!ac || !this.on || !this.bus) return;
    const track = this.track;
    const b = await buffer(ac, `music/${track}.mp3`);
    if (!b || !this.on || this.track !== track || this.current?.track === track) return;
    // The old track fades out as the new one fades in.
    const old = this.current;
    const t0 = ac.currentTime + 0.05;
    if (old) {
      old.gain.gain.cancelScheduledValues(t0);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t0);
      old.gain.gain.linearRampToValueAtTime(0, t0 + FADE_S);
      old.src.stop(t0 + FADE_S + 0.1);
    }
    const [loopStart, loopEnd] = loopSpan(b);
    const src = ac.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.loopStart = loopStart;
    src.loopEnd = loopEnd;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + (old ? FADE_S : 0.4));
    src.connect(gain).connect(this.bus);
    src.start(t0, loopStart);
    this.current = { src, gain, track };
  }
}

export const music = new Music();
