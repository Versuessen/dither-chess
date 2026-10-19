/** App-wide visual state shared between the screens and the dither layer. */
import type { DitherMode } from '../dither/renderer';
import type { Theme } from './theme';
import { HOME_SUBJECT } from '../bots/personas';

function systemReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type MotionSetting = 'system' | 'reduce';
const MOTION_KEY = 'dither.motion';

function readMotion(): MotionSetting {
  try {
    return localStorage.getItem(MOTION_KEY) === 'reduce' ? 'reduce' : 'system';
  } catch {
    return 'system';
  }
}

class UiState {
  subject = $state(HOME_SUBJECT);
  mode = $state<DitherMode>('black');
  promotion = $state(false);
  systemReducedMotion = $state(systemReducedMotion());
  motionSetting = $state<MotionSetting>(typeof localStorage === 'undefined' ? 'system' : readMotion());
  reducedMotion = $derived(this.systemReducedMotion || this.motionSetting === 'reduce');
  theme = $state<Theme>('light');
  /** Pointer in [-1, 1]^2. */
  pointer = $state<[number, number]>([0, 0]);
  /** Roster scroll progress in [0, 1]. */
  scroll = $state(0);
  /** Preloader progress in [0, 1]; null once the app is ready. */
  loading = $state<number | null>(0);
  /** True when the dither layer could not start (no WebGL2). */
  ditherFailed = $state(false);

  constructor() {
    if (typeof matchMedia !== 'undefined') {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
        this.systemReducedMotion = e.matches;
      });
    }
  }

  setMotion(setting: MotionSetting): void {
    this.motionSetting = setting;
    try {
      localStorage.setItem(MOTION_KEY, setting);
    } catch {
      /* session only */
    }
  }
}

export const ui = new UiState();
