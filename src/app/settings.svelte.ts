/**
 * User settings kept in AppStorage (and so in backups). Theme and motion live in
 * localStorage instead because they must apply before the first paint.
 */
import { storage } from '../storage';
import { DEFAULT_COLOURS, sanitizeColours, type ColourSettings } from './colours';
import { DEFAULT_TRACK, MUSIC_TRACKS, type MusicTrack } from '../game/sounds';

export type PieceSet = 'cburnett' | 'dither';

export interface AppSettings {
  colours: ColourSettings;
  pieceSet: PieceSet;
  coordinates: boolean;
  sounds: boolean;
  /** Quiet music on the menus and in games: one track, looping. */
  music: boolean;
  musicTrack: MusicTrack;
  /** Bot moves as soon as inference finishes, with no human-like pause. */
  instantBot: boolean;
  premoves: boolean;
  showDests: boolean;
  /** Promote to a queen without asking. */
  autoQueen: boolean;
  /** Developer details (PGN headers, engine internals); toggled from the © on the home screen. */
  devMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  colours: DEFAULT_COLOURS,
  pieceSet: 'cburnett',
  coordinates: true,
  sounds: true,
  music: false,
  musicTrack: DEFAULT_TRACK,
  instantBot: false,
  premoves: true,
  showDests: true,
  autoQueen: false,
  devMode: false
};

const KEY = 'app';
const FLAGS = ['coordinates', 'sounds', 'music', 'instantBot', 'premoves', 'showDests', 'autoQueen', 'devMode'] as const;

function sanitize(v: (Partial<AppSettings> & { boardColours?: unknown }) | undefined): AppSettings {
  const s: AppSettings = { ...DEFAULT_SETTINGS, colours: { ...DEFAULT_COLOURS } };
  if (!v || typeof v !== 'object') return s;
  s.colours = sanitizeColours(v.colours);
  // Settings saved before colours were customisable had only a board preset.
  if (!v.colours && v.boardColours === 'duotone') s.colours.board = 'duotone';
  if (v.pieceSet === 'cburnett' || v.pieceSet === 'dither') s.pieceSet = v.pieceSet;
  if (MUSIC_TRACKS.some((t) => t.id === v.musicTrack)) s.musicTrack = v.musicTrack!;
  for (const k of FLAGS) {
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

  updateColours(patch: Partial<ColourSettings>): Promise<void> {
    return this.update({ colours: { ...this.value.colours, ...patch } });
  }
}

export const settings = new SettingsStore();
export { sanitize as sanitizeSettings };
