// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { THEME_KEY, ThemeController, nextTheme, resolveTheme } from '../../src/app/theme';

function fakeMql(matches: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const mql = {
    matches,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
    fire(next: boolean) {
      mql.matches = next;
      for (const l of listeners) l({ matches: next });
    }
  };
  return mql;
}

describe('resolveTheme', () => {
  it('follows the system when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('a manual choice wins over the system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('toggle flips', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
});

describe('ThemeController', () => {
  it('applies the system theme and tracks system changes', () => {
    localStorage.clear();
    const mql = fakeMql(true);
    const c = new ThemeController(document.documentElement, localStorage, () => mql as unknown as MediaQueryList);
    expect(document.documentElement.dataset.theme).toBe('dark');
    mql.fire(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(c.current).toBe('system');
  });

  it('remembers a manual toggle across instances', () => {
    localStorage.clear();
    const mql = fakeMql(false);
    const a = new ThemeController(document.documentElement, localStorage, () => mql as unknown as MediaQueryList);
    a.toggle();
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    const b = new ThemeController(document.documentElement, localStorage, () => mql as unknown as MediaQueryList);
    expect(b.theme).toBe('dark');
    mql.fire(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('survives storage that throws', () => {
    const throwing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      }
    } as unknown as Storage;
    const c = new ThemeController(document.documentElement, throwing, undefined);
    expect(c.theme).toBe('light');
    c.set('dark');
    expect(c.theme).toBe('dark');
  });
});
