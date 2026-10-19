import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { soundForSan } from './sounds';

describe('sounds', () => {
  it('picks the sound for a move from its SAN', () => {
    expect(soundForSan('e4')).toBe('move');
    expect(soundForSan('Nxe5')).toBe('capture');
    expect(soundForSan('O-O')).toBe('castle');
    expect(soundForSan('O-O-O+')).toBe('check');
    expect(soundForSan('e8=Q')).toBe('promote');
    expect(soundForSan('exd8=Q+')).toBe('check');
    expect(soundForSan('Qh7#')).toBe('check');
  });

  it('ships every sound as a short mono WAV, and the music files', () => {
    for (const name of ['move', 'capture', 'castle', 'check', 'promote', 'low-time', 'illegal', 'start', 'end', 'select', 'confirm', 'back']) {
      const path = `public/sounds/${name}.wav`;
      expect(existsSync(path), path).toBe(true);
      const b = readFileSync(path);
      expect(b.toString('ascii', 0, 4)).toBe('RIFF');
      expect(b.readUInt16LE(22)).toBe(1); // mono
      expect(b.length).toBeLessThan(40_000);
    }
    for (const name of ['the-divine-elf', 'suspended']) expect(existsSync(`public/music/${name}.mp3`)).toBe(true);
  });
});
