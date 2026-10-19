/** Reactive wrapper around ThemeController for the Svelte screens. */
import { ThemeController, type Theme, type ThemeSetting } from './theme';
import { ui } from './ui.svelte';

class ThemeStore {
  setting = $state<ThemeSetting>('system');
  theme = $state<Theme>('light');
  private controller: ThemeController | null = null;

  init(): void {
    if (this.controller || typeof document === 'undefined') return;
    this.controller = new ThemeController(
      document.documentElement,
      (() => {
        try {
          return localStorage;
        } catch {
          return undefined;
        }
      })(),
      typeof matchMedia === 'undefined' ? undefined : (q) => matchMedia(q)
    );
    this.controller.subscribe((theme, setting) => {
      this.theme = theme;
      this.setting = setting;
      ui.theme = theme;
    });
  }

  set(setting: ThemeSetting): void {
    this.controller?.set(setting);
  }

  toggle(): void {
    this.controller?.toggle();
  }
}

export const themeStore = new ThemeStore();
