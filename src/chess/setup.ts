/** What the bot profile panel hands to the game screen. */
import type { ModelFamily } from '../models/catalog';
import { DEFAULT_TIME_CONTROL, type TimeControl } from './timeControl';

export type ColourChoice = 'white' | 'black' | 'random';

export interface GameSetup {
  persona: string;
  family: ModelFamily;
  /** Bot rating on the Lichess rapid scale. */
  level: number;
  colour: ColourChoice;
  timeControl: TimeControl;
  /** Counts for the rating of the time control's speed. */
  rated: boolean;
}

export interface SetupPrefs {
  colour: ColourChoice;
  timeControl: TimeControl;
  rated: boolean;
  /** Rating last chosen for the custom opponent (the Play button), if any. */
  customLevel?: number;
}

const KEY = 'dither.setup';

export const DEFAULT_PREFS: SetupPrefs = {
  colour: 'random',
  timeControl: DEFAULT_TIME_CONTROL,
  rated: true
};

/** The last choices made in the panel, remembered on this device. */
export function loadPrefs(storage: Storage | undefined = globalThis.localStorage): SetupPrefs {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<SetupPrefs>;
    return {
      colour: v.colour === 'white' || v.colour === 'black' || v.colour === 'random' ? v.colour : DEFAULT_PREFS.colour,
      timeControl:
        v.timeControl && Number.isFinite(v.timeControl.base) && Number.isFinite(v.timeControl.increment)
          ? { base: v.timeControl.base, increment: v.timeControl.increment }
          : DEFAULT_PREFS.timeControl,
      rated: typeof v.rated === 'boolean' ? v.rated : DEFAULT_PREFS.rated,
      ...(Number.isFinite(v.customLevel) ? { customLevel: v.customLevel } : {})
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: SetupPrefs, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* not persisted in private mode */
  }
}
