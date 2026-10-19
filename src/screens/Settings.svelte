<script lang="ts">
  import { onMount } from 'svelte';
  import { platform, isCrossOriginIsolated } from '../app/platform';
  import { storage } from '../storage';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import { themeStore } from '../app/themeStore.svelte';
  import { ui, type MotionSetting } from '../app/ui.svelte';
  import type { ThemeSetting } from '../app/theme';
  import { settings, type BoardColours, type PieceSet, type AppSettings } from '../app/settings.svelte';
  import { inference } from '../inference/client';
  import type { InitResult } from '../inference/protocol';

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

  const desktop = platform() === 'tauri';
  // The website carries the source of the exact build it runs (AGPL-3.0, see NOTICE).
  const sourceUrl = __DITHER_SOURCE__ ? `${import.meta.env.BASE_URL}${__DITHER_SOURCE__}` : null;
  let notes = $state<string[]>([]);
  let engine = $state<InitResult | null>(null);
  onMount(() => {
    if (desktop) void import('@tauri-apps/api/core').then(({ invoke }) => invoke<string[]>('platform_notes').then((n) => (notes = n)));
    inference.init().then((r) => (engine = r), () => undefined);
  });
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

  <section class="group" aria-labelledby="s-system">
    <h2 id="s-system" class="label">System</h2>
    <p class="hint">
      {desktop ? 'Desktop app' : 'Browser'} · data in {storage().kind === 'sqlite' ? 'SQLite' : storage().kind === 'indexeddb' ? 'IndexedDB' : 'memory only'} ·
      {isCrossOriginIsolated() ? 'cross-origin isolated' : 'not cross-origin isolated'}
      {#if engine}
        · inference on {engine.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}, {engine.threads} {engine.threads === 1 ? 'thread' : 'threads'}
      {/if}
    </p>
    {#if engine?.singleThreadReason}
      <p class="hint" data-testid="single-thread-reason">Multi-threaded inference failed on this device, so it runs on one thread: {engine.singleThreadReason}</p>
    {/if}
    {#each notes as n (n)}<p class="hint">{n}</p>{/each}
    {#if sourceUrl}
      <p class="hint">
        DITHER is free software under the GNU Affero General Public License 3.0.
        <a href={sourceUrl} download>Download the source code of this version</a> (licences of the models and libraries in NOTICE).
      </p>
    {/if}
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
  /* Links inside running text are underlined so they do not rely on colour alone. */
  .hint a {
    color: var(--panel-ink);
    text-decoration: underline;
    text-underline-offset: 0.2em;
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
