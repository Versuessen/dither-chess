/**
 * Theme: follows the system by default; a manual choice is remembered on this device.
 * The resolved theme is written to <html data-theme>, which selects the token block.
 */

export type ThemeSetting = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'dither.theme';

export function resolveTheme(setting: ThemeSetting, systemDark: boolean): Theme {
  if (setting === 'light' || setting === 'dark') return setting;
  return systemDark ? 'dark' : 'light';
}

/** The manual toggle cycles light <-> dark starting from what is on screen now. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

function readSetting(storage: Storage | undefined): ThemeSetting {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function writeSetting(storage: Storage | undefined, value: ThemeSetting): void {
  try {
    storage?.setItem(THEME_KEY, value);
  } catch {
    /* storage unavailable (private mode): the choice lasts for this session only */
  }
}

type Listener = (theme: Theme, setting: ThemeSetting) => void;

export class ThemeController {
  private setting: ThemeSetting;
  private systemDark: boolean;
  private listeners = new Set<Listener>();
  private mql: MediaQueryList | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly storage: Storage | undefined,
    matchMedia: ((q: string) => MediaQueryList) | undefined
  ) {
    this.setting = readSetting(storage);
    this.mql = matchMedia?.('(prefers-color-scheme: dark)');
    this.systemDark = this.mql?.matches ?? false;
    this.mql?.addEventListener('change', (e) => {
      this.systemDark = e.matches;
      this.apply();
    });
    this.apply();
  }

  get theme(): Theme {
    return resolveTheme(this.setting, this.systemDark);
  }

  get current(): ThemeSetting {
    return this.setting;
  }

  set(setting: ThemeSetting): void {
    this.setting = setting;
    writeSetting(this.storage, setting);
    this.apply();
  }

  toggle(): void {
    this.set(nextTheme(this.theme));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.theme, this.setting);
    return () => this.listeners.delete(fn);
  }

  private apply(): void {
    const theme = this.theme;
    this.root.dataset.theme = theme;
    for (const fn of this.listeners) fn(theme, this.setting);
  }
}
