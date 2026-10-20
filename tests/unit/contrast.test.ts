import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_NORMAL, contrast, parseColor } from '../../src/design/contrast';

const css = readFileSync(fileURLToPath(new URL('../../src/design/tokens.css', import.meta.url)), 'utf8');

/** Extract the custom properties of the first block whose selector matches. */
function tokens(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block for ${selector}`);
  const start = css.indexOf('{', m.index) + 1;
  const end = css.indexOf('}', start);
  const out: Record<string, string> = {};
  for (const line of css.slice(start, end).split(';')) {
    const kv = /--([a-z0-9-]+)\s*:\s*(.+)/.exec(line.trim());
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

const themes = {
  light: tokens(/:root,\s*\n:root\[data-theme='light'\]/),
  dark: tokens(/:root\[data-theme='dark'\]\s*\{/)
};

describe('theme tokens meet WCAG AA', () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      const inks = ['dither-shadow', 'dither-light'].map((k) => parseColor(t[k]!));
      const allInks = [...inks, parseColor(t['dither-bleed']!)];
      if (t['dither-tint-amount'] === '1') allInks.push(parseColor(t['dither-tint']!));

      it('over-dither text passes 4.5:1 on every ink, including the top bleed and line tint', () => {
        for (const ink of allInks) {
          expect(contrast(parseColor(t['over-dither']!), ink)).toBeGreaterThanOrEqual(AA_NORMAL);
        }
      });

      it('muted over-dither text passes 4.5:1 on the inks it can sit on (bottom corners, no bleed)', () => {
        for (const ink of inks) {
          expect(contrast(parseColor(t['over-dither-muted']!), ink)).toBeGreaterThanOrEqual(AA_NORMAL);
        }
      });

      it('display list rows pass 3:1 (large text) on every ink, at rest and hovered', () => {
        for (const ink of allInks) {
          expect(contrast(parseColor(t['list-row']!), ink)).toBeGreaterThanOrEqual(AA_LARGE);
          expect(contrast(parseColor(t['list-row-hover']!), ink)).toBeGreaterThanOrEqual(AA_LARGE);
        }
      });

      it('panel text passes 4.5:1 on the panel', () => {
        const panel = parseColor(t['panel']!);
        expect(contrast(parseColor(t['panel-ink']!), panel)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrast(parseColor(t['panel-muted']!), panel)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrast(parseColor(t['button-ink']!), parseColor(t['button']!))).toBeGreaterThanOrEqual(AA_NORMAL);
      });

      it("display list rows pass 3:1 over every opponent's accent", () => {
        for (let i = 1; i <= 8; i++) {
          const accent = parseColor(t[`accent-${i}`]!);
          expect(contrast(parseColor(t['list-row']!), accent), `accent-${i}`).toBeGreaterThanOrEqual(AA_LARGE);
          expect(contrast(parseColor(t['over-dither']!), accent), `accent-${i}`).toBeGreaterThanOrEqual(AA_LARGE);
        }
      });

      it('game review marks pass 4.5:1 on the panel', () => {
        const panel = parseColor(t['panel']!);
        for (const k of ['review-brilliant', 'review-excellent', 'review-best', 'review-good', 'review-book', 'review-inaccuracy', 'review-mistake', 'review-blunder']) {
          expect(contrast(parseColor(t[k]!), panel), k).toBeGreaterThanOrEqual(AA_NORMAL);
        }
      });

      it('chrome text passes 4.5:1 on paper', () => {
        const paper = parseColor(t['paper']!);
        expect(contrast(parseColor(t['ink']!), paper)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrast(parseColor(t['ink-muted']!), paper)).toBeGreaterThanOrEqual(AA_NORMAL);
      });

      it('needs no text halo', () => {
        expect(t['text-halo']).toBe('none');
      });
    });
  }

  it('the prefers-color-scheme fallback repeats the dark theme exactly', () => {
    const fallback = tokens(/:root:not\(\[data-theme='light'\]\)\s*\{/);
    expect(fallback).toEqual(themes.dark);
  });
});

describe('contrast()', () => {
  it('matches known WCAG values', () => {
    expect(contrast(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(21, 5);
    expect(contrast(parseColor('#777'), parseColor('#fff'))).toBeCloseTo(4.48, 2);
  });
  it('composites translucent foregrounds', () => {
    expect(contrast(parseColor('rgba(0,0,0,0)'), parseColor('#fff'))).toBeCloseTo(1, 5);
  });
});
