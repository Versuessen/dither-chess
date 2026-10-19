/**
 * Board and background colours: the board presets, the highlight colours (last move, premove,
 * right-click marks, arrows) and the player's own overrides from Settings.
 */

export type BoardPreset = 'classic' | 'duotone' | 'green' | 'custom';

export interface ColourSettings {
  board: BoardPreset;
  /** Used when `board` is 'custom'. */
  customLight: string;
  customDark: string;
  /** Last move and the selected piece. */
  move: string;
  premove: string;
  /** Right-click marks. */
  mark: string;
  /** Arrows; null follows the move colour. */
  arrow: string | null;
  /** The dithered background's shadow and light colours (--dither-shadow/--dither-light); null keeps the theme's. */
  bgShadow: string | null;
  bgLight: string | null;
}

/** What the board needs, resolved: any CSS colour, theme variables included. */
export interface BoardPalette {
  light: string;
  dark: string;
  move: string;
  premove: string;
  mark: string;
  arrow: string;
}

export const DEFAULT_COLOURS: ColourSettings = {
  board: 'classic',
  customLight: '#ecebe5',
  customDark: '#7a8c6e',
  // chess.com-like: a warm yellow for the move, red for premoves and marks.
  move: '#f6d23a',
  premove: '#e5391f',
  mark: '#e5391f',
  arrow: null,
  bgShadow: null,
  bgLight: null
};

export const BOARD_PRESETS: { value: BoardPreset; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'duotone', label: 'Duotone' },
  { value: 'green', label: 'Green' },
  { value: 'custom', label: 'Custom' }
];

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

export function sanitizeColours(v: unknown): ColourSettings {
  const s = { ...DEFAULT_COLOURS };
  if (!v || typeof v !== 'object') return s;
  const o = v as Partial<Record<keyof ColourSettings, unknown>>;
  if (BOARD_PRESETS.some((p) => p.value === o.board)) s.board = o.board as BoardPreset;
  for (const k of ['customLight', 'customDark', 'move', 'premove', 'mark'] as const) if (isHex(o[k])) s[k] = o[k];
  for (const k of ['arrow', 'bgShadow', 'bgLight'] as const) {
    if (o[k] === null || isHex(o[k])) s[k] = o[k] as string | null;
  }
  return s;
}

export function boardPalette(c: ColourSettings): BoardPalette {
  const [light, dark] =
    c.board === 'custom'
      ? [c.customLight, c.customDark]
      : c.board === 'green'
        ? ['#eeeed2', '#769656']
        : [`var(--sq-${c.board === 'duotone' ? 'duo' : 'classic'}-light)`, `var(--sq-${c.board === 'duotone' ? 'duo' : 'classic'}-dark)`];
  return { light, dark, move: c.move, premove: c.premove, mark: c.mark, arrow: c.arrow ?? c.move };
}
