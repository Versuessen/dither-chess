import { describe, expect, it } from 'vitest';
import { parseRoute, href } from '../../src/app/router.svelte';
import { PERSONAS } from '../../src/bots/personas';
import { ALL_LEVELS, MODELS, nearestLevel } from '../../src/models/catalog';
import { ART } from '../../src/dither/art';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../../src/chess/setup';

describe('router', () => {
  it('parses and builds every route', () => {
    for (const r of [
      { name: 'home' },
      { name: 'bot', persona: 'grinder' },
      { name: 'game' },
      { name: 'history' },
      { name: 'rating' },
      { name: 'models' },
      { name: 'settings' }
    ] as const) {
      expect(parseRoute(href(r))).toEqual(r);
    }
  });
  it('falls back to home', () => {
    expect(parseRoute('#/nowhere')).toEqual({ name: 'home' });
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/bot/')).toEqual({ name: 'home' });
  });
});

describe('roster', () => {
  it('has one persona per 100 points from 600 to 1900, and one at the top (2050)', () => {
    expect(PERSONAS.map((p) => p.level)).toEqual([...Array.from({ length: 14 }, (_, i) => 600 + 100 * i), 2050]);
  });
  it('gives every persona its own rendered image', () => {
    const subjects = PERSONAS.map((p) => p.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
    for (const s of subjects) expect(ART.scenes[s], s).toBeDefined();
    expect(ART.scenes.hero).toBeDefined();
    expect(ART.morph.frames).toBeGreaterThan(4);
  });
});

describe('model catalog', () => {
  it('offers levels from 600 to 2050 in steps of 50', () => {
    expect(ALL_LEVELS[0]).toBe(600);
    expect(ALL_LEVELS.at(-1)).toBe(2050);
    expect(ALL_LEVELS.length).toBe(30);
  });
  it('has one model, Maia-3 23M, with no level before its calibration is installed', () => {
    expect(MODELS.map((m) => m.pack)).toEqual(['maia3-23m']);
    expect(MODELS[0]!.defaultLevels).toEqual([]);
  });
  it('snaps to the nearest playable level', () => {
    expect(nearestLevel([1100, 1150, 1200], 700)).toBe(1100);
    expect(nearestLevel([600, 650], 640)).toBe(650);
    expect(nearestLevel([], 1000)).toBeNull();
  });
});

describe('setup preferences', () => {
  function memory(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      length: 0
    } as Storage;
  }
  it('round-trips and rejects garbage', () => {
    const s = memory();
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    savePrefs({ colour: 'black', timeControl: { base: 600, increment: 5 }, rated: false }, s);
    expect(loadPrefs(s)).toEqual({ colour: 'black', timeControl: { base: 600, increment: 5 }, rated: false });
    s.setItem('dither.setup', '{"family":"maia3","colour":"white","timeControl":{"base":180,"increment":2}}');
    expect(loadPrefs(s).rated).toBe(true); // prefs saved before the rated choice existed
    s.setItem('dither.setup', '{"family":"stockfish","colour":7}');
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });
});
