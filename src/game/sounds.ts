/**
 * Subtle game sounds, synthesised with Web Audio so there are no sample files to license or
 * cache: a wooden click for a move, a heavier double knock for a capture, a short tone for
 * check, a soft tick under ten seconds, and a two-note chord at the end of the game.
 */

export type SoundName = 'move' | 'capture' | 'check' | 'low-time' | 'end';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function click(ac: AudioContext, at: number, freq: number, gain: number, decay: number): void {
  const len = Math.floor(ac.sampleRate * decay);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  // Deterministic noise burst with an exponential envelope.
  let seed = 22222;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = ((seed / 0x7fffffff) * 2 - 1) * Math.exp((-6 * i) / len);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 3.5;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(band).connect(g).connect(ac.destination);
  src.start(at);
}

function tone(ac: AudioContext, at: number, freq: number, gain: number, dur: number): void {
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function play(name: SoundName): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  switch (name) {
    case 'move':
      click(ac, t, 1800, 0.55, 0.05);
      break;
    case 'capture':
      click(ac, t, 1100, 0.7, 0.07);
      click(ac, t + 0.045, 900, 0.5, 0.06);
      break;
    case 'check':
      click(ac, t, 1800, 0.5, 0.05);
      tone(ac, t + 0.02, 880, 0.06, 0.18);
      break;
    case 'low-time':
      click(ac, t, 3200, 0.25, 0.025);
      break;
    case 'end':
      tone(ac, t, 523.25, 0.07, 0.6);
      tone(ac, t + 0.09, 659.25, 0.06, 0.6);
      break;
  }
}

/** Which sound a move makes, from its SAN. */
export function soundForSan(san: string): SoundName {
  if (san.includes('#')) return 'check';
  if (san.includes('+')) return 'check';
  if (san.includes('x')) return 'capture';
  return 'move';
}
