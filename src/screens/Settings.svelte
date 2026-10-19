<script lang="ts">
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import { themeStore } from '../app/themeStore.svelte';
  import { ui, type MotionSetting } from '../app/ui.svelte';
  import type { ThemeSetting } from '../app/theme';
</script>

<ScreenFrame title="Settings" current="settings">
  <section class="group" aria-labelledby="s-appearance">
    <h2 id="s-appearance" class="label">Appearance</h2>
    <div class="rows">
      <div class="row">
        <Toggle
          legend="Theme"
          value={themeStore.setting}
          options={[
            { value: 'system' as ThemeSetting, label: 'System' },
            { value: 'light' as ThemeSetting, label: 'Light' },
            { value: 'dark' as ThemeSetting, label: 'Dark' }
          ]}
          onchange={(v) => themeStore.set(v)}
        />
        <p class="hint">Now showing {themeStore.theme}. Press T anywhere to switch.</p>
      </div>
      <div class="row">
        <Toggle
          legend="Motion"
          value={ui.motionSetting}
          options={[
            { value: 'system' as MotionSetting, label: 'Follow system' },
            { value: 'reduce' as MotionSetting, label: 'Reduce' }
          ]}
          onchange={(v) => ui.setMotion(v)}
        />
        <p class="hint">
          {ui.systemReducedMotion
            ? 'Your system asks for reduced motion: the background stays still.'
            : ui.reducedMotion
              ? 'Reduced: the background stays still and images swap instantly.'
              : 'The background moves with the pointer and drifts in knight moves.'}
        </p>
      </div>
    </div>
  </section>
</ScreenFrame>

<style>
  h2 {
    margin: 0 0 18px;
    font-weight: 400;
  }
  .rows {
    display: grid;
    gap: 26px;
  }
  .hint {
    margin: 8px 0 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.04em;
    max-width: 60ch;
  }
</style>
