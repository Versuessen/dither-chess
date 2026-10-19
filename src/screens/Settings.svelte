<script lang="ts">
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import { themeStore } from '../app/themeStore.svelte';
  import { ui, type MotionSetting } from '../app/ui.svelte';
  import type { ThemeSetting } from '../app/theme';
  import { settings, type BoardColours, type PieceSet, type AppSettings } from '../app/settings.svelte';

  type Flag = 'coordinates' | 'sounds' | 'instantBot' | 'premoves' | 'showDests' | 'autoQueen';
  const flags: { key: Flag; label: string; hint: string }[] = [
    { key: 'coordinates', label: 'Coordinates', hint: 'Files and ranks on the board edge.' },
    { key: 'showDests', label: 'Legal moves', hint: 'Dots on the squares a picked-up piece can reach.' },
    { key: 'premoves', label: 'Premoves', hint: 'Queue a move while the bot is thinking.' },
    { key: 'autoQueen', label: 'Auto-queen', hint: 'Promote to a queen without asking.' },
    { key: 'sounds', label: 'Sounds', hint: 'Quiet clicks for moves, captures and checks.' },
    { key: 'instantBot', label: 'Instant bot', hint: 'The bot moves as soon as it has chosen, without a human-like pause.' }
  ];
  const onOff = [
    { value: true, label: 'On' },
    { value: false, label: 'Off' }
  ];
  const set = (patch: Partial<AppSettings>) => void settings.update(patch);
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

  <section class="group" aria-labelledby="s-board">
    <h2 id="s-board" class="label">Board</h2>
    <div class="rows two">
      <div class="row">
        <Toggle
          legend="Board colours"
          value={settings.value.boardColours}
          options={[
            { value: 'classic' as BoardColours, label: 'Classic' },
            { value: 'duotone' as BoardColours, label: 'Duotone' }
          ]}
          onchange={(v) => set({ boardColours: v })}
        />
      </div>
      <div class="row">
        <Toggle
          legend="Pieces"
          value={settings.value.pieceSet}
          options={[
            { value: 'cburnett' as PieceSet, label: 'Flat' },
            { value: 'dither' as PieceSet, label: '1-bit' }
          ]}
          onchange={(v) => set({ pieceSet: v })}
        />
      </div>
      {#each flags as f (f.key)}
        <div class="row">
          <Toggle legend={f.label} value={settings.value[f.key]} options={onOff} onchange={(v) => set({ [f.key]: v })} />
          <p class="hint">{f.hint}</p>
        </div>
      {/each}
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
  .rows.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .group + .group {
    margin-top: 34px;
    padding-top: 22px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
  }
  @media (max-width: 760px) {
    .rows.two {
      grid-template-columns: 1fr;
    }
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
