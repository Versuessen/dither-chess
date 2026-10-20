<script lang="ts">
  import { onMount } from 'svelte';
  import { platform, isCrossOriginIsolated } from '../app/platform';
  import { storage } from '../storage';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import { themeStore } from '../app/themeStore.svelte';
  import { ui, type MotionSetting } from '../app/ui.svelte';
  import type { ThemeSetting } from '../app/theme';
  import { settings, type PieceSet, type AppSettings } from '../app/settings.svelte';
  import { BOARD_PRESETS, DEFAULT_COLOURS, boardPalette, type BoardPreset } from '../app/colours';
  import ColourField from '../ui/ColourField.svelte';
  import { inference } from '../inference/client';
  import type { InitResult } from '../inference/protocol';
  import { MUSIC_TRACKS, type MusicTrack } from '../game/sounds';

  type Flag = 'coordinates' | 'instantBot' | 'premoves' | 'showDests' | 'autoQueen';
  const flags: { key: Flag; label: string; hint: string }[] = [
    { key: 'coordinates', label: 'Coordinates', hint: '' },
    { key: 'showDests', label: 'Legal moves', hint: '' },
    { key: 'premoves', label: 'Premoves', hint: 'Right-click cancels queued premoves.' },
    { key: 'autoQueen', label: 'Auto-queen', hint: '' },
    { key: 'instantBot', label: 'Instant bot', hint: '' }
  ];
  type MusicChoice = MusicTrack | 'off';
  const musicChoice = $derived<MusicChoice>(settings.value.music ? settings.value.musicTrack : 'off');
  const musicOptions: { value: MusicChoice; label: string }[] = [{ value: 'off', label: 'Off' }, ...MUSIC_TRACKS.map((t) => ({ value: t.id as MusicChoice, label: t.title }))];
  const setMusic = (v: MusicChoice) => set(v === 'off' ? { music: false } : { music: true, musicTrack: v });
  const onOff = [
    { value: true, label: 'On' },
    { value: false, label: 'Off' }
  ];
  const set = (patch: Partial<AppSettings>) => void settings.update(patch);
  const colours = $derived(settings.value.colours);
  const palette = $derived(boardPalette(colours));
  const setColour = (patch: Partial<typeof DEFAULT_COLOURS>) => void settings.updateColours(patch);
  /** The theme's own background colours, shown while no override is set. */
  const themeInk = (name: string) => {
    void ui.theme;
    if (typeof document === 'undefined') return '#000000';
    const root = document.documentElement;
    const inline = root.style.getPropertyValue(name);
    root.style.removeProperty(name);
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    if (inline) root.style.setProperty(name, inline);
    return /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
  };

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
        <p class="hint">T switches the theme anywhere.</p>
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
        
      </div>
    </div>
  </section>

  <section class="group" aria-labelledby="s-board">
    <h2 id="s-board" class="label">Board</h2>
    <div class="rows two">
      <div class="row">
        <Toggle
          legend="Board colours"
          value={colours.board}
          options={BOARD_PRESETS.map((p) => ({ value: p.value as BoardPreset, label: p.label }))}
          onchange={(v) => void settings.updateColours({ board: v })}
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
          {#if f.hint}<p class="hint">{f.hint}</p>{/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="group" aria-labelledby="s-sound">
    <h2 id="s-sound" class="label">Sound</h2>
    <div class="rows two">
      <div class="row">
        <Toggle legend="Sounds" value={settings.value.sounds} options={onOff} onchange={(v) => set({ sounds: v })} />
      </div>
      <div class="row">
        <Toggle legend="Music" value={musicChoice} options={musicOptions} onchange={setMusic} />
      </div>
    </div>
  </section>

  <section class="group" aria-labelledby="s-colours">
    <h2 id="s-colours" class="label">Colours</h2>
    <div class="preview" aria-hidden="true" style="--p-light:{palette.light};--p-dark:{palette.dark};--p-move:{palette.move};--p-premove:{palette.premove};--p-mark:{palette.mark};--p-arrow:{palette.arrow}">
      {#each Array.from({ length: 16 }, (_, i) => i) as i (i)}
        <span class:dark={((i >> 2) + (i & 3)) % 2 === 1} class:move={i === 9 || i === 5} class:premove={i === 14} class:mark={i === 3}></span>
      {/each}
      <svg viewBox="0 0 4 4"><polyline points="0.5,3.5 0.5,1.7 1.3,1.7" /><polygon points="1.5,1.7 1.18,1.48 1.18,1.92" /></svg>
    </div>
    <div class="rows two colours">
      {#if colours.board === 'custom'}
        <ColourField label="Light squares" value={colours.customLight} fallback={colours.customLight} onchange={(v) => v && setColour({ customLight: v })} />
        <ColourField label="Dark squares" value={colours.customDark} fallback={colours.customDark} onchange={(v) => v && setColour({ customDark: v })} />
      {/if}
      <ColourField label="Last move and selection" value={colours.move} fallback={colours.move} onchange={(v) => v && setColour({ move: v })} />
      <ColourField label="Premoves" value={colours.premove} fallback={colours.premove} onchange={(v) => v && setColour({ premove: v })} />
      <ColourField label="Marked squares (right-click)" value={colours.mark} fallback={colours.mark} onchange={(v) => v && setColour({ mark: v })} />
      <ColourField label="Arrows (right-drag)" value={colours.arrow} fallback={colours.move} resetLabel="Same as last move" onchange={(v) => setColour({ arrow: v })} />
      <ColourField label="Background shadow" value={colours.bgShadow} fallback={themeInk('--dither-shadow')} resetLabel="Theme colour" onchange={(v) => setColour({ bgShadow: v })} />
      <ColourField label="Background light" value={colours.bgLight} fallback={themeInk('--dither-light')} resetLabel="Theme colour" onchange={(v) => setColour({ bgLight: v })} />
    </div>
    <p class="hint">
      <button type="button" class="link" onclick={() => void settings.update({ colours: { ...DEFAULT_COLOURS } })}>Reset all colours</button>
    </p>
  </section>

  <section class="group" aria-labelledby="s-system">
    <h2 id="s-system" class="label">System</h2>
    {#if settings.value.devMode}
    <p class="hint">
      {desktop ? 'Desktop app' : 'Browser'} · data in {storage().kind === 'sqlite' ? 'SQLite' : storage().kind === 'indexeddb' ? 'IndexedDB' : 'memory only'} ·
      {isCrossOriginIsolated() ? 'cross-origin isolated' : 'not cross-origin isolated'}
      {#if engine}
        · inference on {engine.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}, {engine.threads} {engine.threads === 1 ? 'thread' : 'threads'}
      {/if}
    </p>
    {/if}
    {#if engine?.singleThreadReason && settings.value.devMode}
      <p class="hint" data-testid="single-thread-reason">One inference thread: {engine.singleThreadReason}</p>
    {/if}
    {#each notes as n (n)}<p class="hint">{n}</p>{/each}
    {#if sourceUrl}
      <p class="hint"><a href={sourceUrl} download>Source code of this version</a> · AGPL-3.0</p>
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
  .preview {
    position: relative;
    display: grid;
    grid-template-columns: repeat(4, 34px);
    grid-template-rows: repeat(4, 34px);
    margin-bottom: 22px;
    width: max-content;
  }
  .preview span {
    background: var(--p-light);
  }
  .preview span.dark {
    background: var(--p-dark);
  }
  .preview span.move {
    background-image: linear-gradient(color-mix(in srgb, var(--p-move) 55%, transparent) 0 0);
  }
  .preview span.premove {
    background-image: linear-gradient(color-mix(in srgb, var(--p-premove) 62%, transparent) 0 0);
  }
  .preview span.mark {
    background-image: linear-gradient(color-mix(in srgb, var(--p-mark) 78%, transparent) 0 0);
  }
  .preview svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.82;
  }
  .preview polyline {
    fill: none;
    stroke: var(--p-arrow);
    stroke-width: 0.2;
    stroke-linejoin: round;
  }
  .preview polygon {
    fill: var(--p-arrow);
  }
  .link {
    text-decoration: underline;
    text-underline-offset: 0.2em;
    color: var(--panel-ink);
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
