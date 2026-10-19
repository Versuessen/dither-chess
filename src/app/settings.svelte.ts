/**
 * User settings kept in AppStorage (and so in backups). Theme and motion live in
 * localStorage instead because they must apply before the first paint.
 */
import { storage } from '../storage';

export type BoardColours = 'classic' | 'duotone';
export type PieceSet = 'cburnett' | 'dither';

export interface AppSettings {
  boardColours: BoardColours;
  pieceSet: PieceSet;
  coordinates: boolean;
  sounds: boolean;
  /** Bot moves as soon as inference finishes, with no human-like pause. */
  instantBot: boolean;
  premoves: boolean;
  showDests: boolean;
  /** Promote to a queen without asking. */
  autoQueen: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  boardColours: 'classic',
  pieceSet: 'cburnett',
  coordinates: true,
  sounds: true,
  instantBot: false,
  premoves: true,
  showDests: true,
  autoQueen: false
};

const KEY = 'app';

function sanitize(v: Partial<AppSettings> | undefined): AppSettings {
  const s = { ...DEFAULT_SETTINGS };
  if (!v || typeof v !== 'object') return s;
  if (v.boardColours === 'classic' || v.boardColours === 'duotone') s.boardColours = v.boardColours;
  if (v.pieceSet === 'cburnett' || v.pieceSet === 'dither') s.pieceSet = v.pieceSet;
  for (const k of ['coordinates', 'sounds', 'instantBot', 'premoves', 'showDests', 'autoQueen'] as const) {
    if (typeof v[k] === 'boolean') s[k] = v[k];
  }
  return s;
}

class SettingsStore {
  value = $state<AppSettings>({ ...DEFAULT_SETTINGS });

  async load(): Promise<void> {
    this.value = sanitize(await storage().getSetting<Partial<AppSettings>>(KEY));
  }

  async update(patch: Partial<AppSettings>): Promise<void> {
    this.value = { ...this.value, ...patch };
    await storage().setSetting(KEY, $state.snapshot(this.value));
  }
}

export const settings = new SettingsStore();
export { sanitize as sanitizeSettings };
