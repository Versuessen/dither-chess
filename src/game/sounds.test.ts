import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MUSIC_TRACKS, audibleSpan, musicGain, soundForSan } from './sounds';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../app/settings.svelte';

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
    for (const t of MUSIC_TRACKS) expect(existsSync(`public/music/${t.id}.mp3`), t.id).toBe(true);
  });
});

describe('music', () => {
  it('loops only the audible part of a track, so there is no gap', () => {
    const rate = 1000;
    const left = new Float32Array(3000);
    const right = new Float32Array(3000);
    for (let i = 500; i < 2600; i++) left[i] = Math.sin(i / 7) * 0.4;
    right[2700] = 0.3;
    expect(audibleSpan([left, right], rate)).toEqual([0.5, 2.701]);
    // Silence throughout: play the whole buffer.
    expect(audibleSpan([new Float32Array(2000)], rate)).toEqual([0, 2]);
  });

  it('maps the volume slider to a gain that rises evenly to the ear', () => {
    expect(musicGain(0)).toBe(0);
    expect(musicGain(100)).toBeCloseTo(0.5, 9);
    expect(musicGain(50)).toBeCloseTo(0.125, 9);
    expect(musicGain(150)).toBe(musicGain(100));
    expect(sanitizeSettings({ musicVolume: 37.6 }).musicVolume).toBe(38);
    expect(sanitizeSettings({ musicVolume: -5 }).musicVolume).toBe(0);
    expect(sanitizeSettings({ musicVolume: Number.NaN }).musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
  });

  it('remembers the chosen track, and ignores unknown ones', () => {
    expect(sanitizeSettings({ music: true, musicTrack: 'suspended' }).musicTrack).toBe('suspended');
    expect(sanitizeSettings({ music: true, musicTrack: 'nope' as never }).musicTrack).toBe(DEFAULT_SETTINGS.musicTrack);
  });
});
