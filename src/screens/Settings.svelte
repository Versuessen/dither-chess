<script lang="ts" module>
  import 'chessground/assets/chessground.base.css';
  import 'chessground/assets/chessground.cburnett.css';
  import '../game/pieces-dither.css';
  import '../game/pieces-lichess.css';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { platform, isCrossOriginIsolated } from '../app/platform';
  import { storage } from '../storage';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import { themeStore } from '../app/themeStore.svelte';
  import { ui, type MotionSetting } from '../app/ui.svelte';
  import type { ThemeSetting } from '../app/theme';
  import { settings, PIECE_SETS, type AppSettings } from '../app/settings.svelte';
  import { BOARD_PRESETS, DEFAULT_COLOURS, boardPalette, type BoardPreset } from '../app/colours';
  import ColourField from '../ui/ColourField.svelte';
  import { inference } from '../inference/client';
  import type { InitResult } from '../inference/protocol';
  import { MUSIC_TRACKS, isMusicChoice } from '../game/sounds';

  type Flag = 'coordinates' | 'instantBot' | 'premoves' | 'showDests' | 'autoQueen';
  const flags: { key: Flag; label: string; hint: string }[] = [
    { key: 'coordinates', label: 'Coordinates', hint: '' },
    { key: 'showDests', label: 'Legal moves', hint: '' },
    { key: 'premoves', label: 'Premoves', hint: 'Right-click cancels queued premoves.' },
    { key: 'autoQueen', label: 'Auto-queen', hint: '' },
    { key: 'instantBot', label: 'Instant bot', hint: '' }
  ];
  const trackOptions = [{ id: 'mix', title: 'All, shuffled' }, ...MUSIC_TRACKS];
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

  /**
   * The preview: a 6x6 corner of a game in the chosen pieces and colours, with the last move,
   * a queued premove, a marked square and an arrow. Rows from the top, files from the left.
   */
  const PREVIEW: [number, number, string, 'white' | 'black'][] = [
    [0, 0, 'rook', 'black'],
    [0, 3, 'queen', 'black'],
    [0, 4, 'king', 'black'],
    [1, 0, 'pawn', 'black'],
    [1, 1, 'pawn', 'black'],
    [1, 4, 'bishop', 'black'],
    [1, 5, 'pawn', 'black'],
    [2, 2, 'knight', 'black'],
    [3, 4, 'knight', 'white'],
    [4, 0, 'pawn', 'white'],
    [4, 1, 'bishop', 'white'],
    [4, 2, 'pawn', 'white'],
    [4, 4, 'pawn', 'white'],
    [4, 5, 'pawn', 'white'],
    [5, 0, 'rook', 'white'],
    [5, 3, 'queen', 'white'],
    [5, 4, 'king', 'white']
  ];
  const LAST_MOVE = [1, 14];
  const PREMOVE = [22, 9];
  const MARK = 21;

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

<ScreenFrame title="Settings" current="settings" wide>
  <div class="settings">
    <div class="col">
      <section class="group" aria-labelledby="s-appearance">
        <h2 id="s-appearance" class="label">Appearance</h2>
        <div class="rows two">
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

      <section class="group" aria-labelledby="s-play">
        <h2 id="s-play" class="label">Play</h2>
        <div class="rows two">
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
            <Toggle legend="Music" value={settings.value.music} options={onOff} onchange={(v) => set({ music: v })} />
          </div>
          <div class="row">
            <label class="label field-label" for="music-track">Track</label>
            <select
              id="music-track"
              value={settings.value.musicTrack}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                if (isMusicChoice(v)) set({ musicTrack: v, music: true });
              }}
            >
              {#each trackOptions as t (t.id)}<option value={t.id}>{t.title}</option>{/each}
            </select>
          </div>
          <div class="row">
            <label class="label field-label" for="music-volume">Music volume</label>
            <div class="slider">
              <input
                id="music-volume"
                type="range"
                min="0"
                max="100"
                step="1"
                value={settings.value.musicVolume}
                disabled={!settings.value.music}
                oninput={(e) => set({ musicVolume: Number((e.currentTarget as HTMLInputElement).value) })}
              />
              <output for="music-volume">{settings.value.musicVolume}</output>
            </div>
          </div>
        </div>
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
    </div>

    <div class="col custom">
      <section class="group" aria-labelledby="s-board">
        <h2 id="s-board" class="label">Board</h2>
        <div
          class="preview"
          aria-hidden="true"
          style="--p-light:{palette.light};--p-dark:{palette.dark};--p-move:{palette.move};--p-premove:{palette.premove};--p-mark:{palette.mark};--p-arrow:{palette.arrow}"
        >
          {#each Array.from({ length: 36 }, (_, i) => i) as i (i)}
            <span
              class:dark={(Math.floor(i / 6) + (i % 6)) % 2 === 1}
              class:move={LAST_MOVE.includes(i)}
              class:premove={PREMOVE.includes(i)}
              class:mark={i === MARK}
            ></span>
          {/each}
          <div class="cg-wrap pieces-{settings.value.pieceSet} men">
            {#each PREVIEW as [r, c, name, colour] (`${r}${c}`)}
              <piece class="{name} {colour}" style="left:{(c / 6) * 100}%;top:{(r / 6) * 100}%"></piece>
            {/each}
          </div>
          <svg viewBox="0 0 6 6"><polyline points="1.5,4.5 3.2,2.8" /><polygon points="3.55,2.45 2.95,2.75 3.25,3.05" /></svg>
        </div>

        <fieldset class="sets">
          <legend class="label">Pieces</legend>
          <div class="set-grid">
            {#each PIECE_SETS as p (p.id)}
              <label class:on={settings.value.pieceSet === p.id}>
                <input type="radio" name="piece-set" checked={settings.value.pieceSet === p.id} onchange={() => set({ pieceSet: p.id })} />
                <span class="cg-wrap pieces-{p.id} icon" aria-hidden="true"><piece class="knight white"></piece></span>
                <span>{p.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <div class="row">
          <Toggle
            legend="Board colours"
            value={colours.board}
            options={BOARD_PRESETS.map((p) => ({ value: p.value as BoardPreset, label: p.label }))}
            onchange={(v) => void settings.updateColours({ board: v })}
          />
        </div>
      </section>

      <section class="group" aria-labelledby="s-colours">
        <h2 id="s-colours" class="label">Colours</h2>
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
    </div>
  </div>
</ScreenFrame>

<style>
  .settings {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: 0 48px;
  }
  .col.custom {
    padding-left: 48px;
    margin-left: -24px;
    border-left: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 45%, transparent);
  }
  h2 {
    margin: 0 0 18px;
    font-weight: 400;
  }
  .rows {
    display: grid;
    gap: 24px;
  }
  .rows.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .group + .group {
    margin-top: 30px;
    padding-top: 22px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
  }
  @media (max-width: 900px) {
    .settings {
      grid-template-columns: 1fr;
    }
    .col.custom {
      padding-left: 0;
      margin-left: 0;
      border-left: 0;
      margin-top: 30px;
      padding-top: 22px;
      border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
    }
  }
  @media (max-width: 340px) {
    .rows.two {
      grid-template-columns: 1fr;
    }
  }
  .field-label {
    display: block;
    margin-bottom: 8px;
  }
  select {
    width: 100%;
    max-width: 260px;
    padding: 5px 8px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--panel-ink);
    font: inherit;
    font-size: var(--ui-size-small);
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 260px;
  }
  .slider input {
    flex: 1;
    accent-color: var(--panel-ink);
  }
  .slider input:disabled {
    opacity: 0.4;
  }
  .slider output {
    min-width: 3ch;
    text-align: right;
    font-size: var(--ui-size-small);
  }
  .preview {
    position: relative;
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    grid-template-rows: repeat(6, 1fr);
    width: min(100%, 360px);
    aspect-ratio: 1;
    margin-bottom: 22px;
  }
  .preview > span {
    background: var(--p-light);
  }
  .preview > span.dark {
    background: var(--p-dark);
  }
  .preview > span.move {
    background-image: linear-gradient(color-mix(in srgb, var(--p-move) 55%, transparent) 0 0);
  }
  .preview > span.premove {
    background-image: linear-gradient(color-mix(in srgb, var(--p-premove) 62%, transparent) 0 0);
  }
  .preview > span.mark {
    background-image: linear-gradient(color-mix(in srgb, var(--p-mark) 78%, transparent) 0 0);
  }
  .men {
    position: absolute;
    inset: 0;
  }
  .men piece {
    width: calc(100% / 6);
    height: calc(100% / 6);
  }
  .preview svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.82;
    z-index: 3;
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
  .sets {
    border: 0;
    margin: 0 0 24px;
    padding: 0;
    min-width: 0;
  }
  .sets legend {
    padding: 0;
    margin-bottom: 8px;
  }
  .set-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
    gap: 6px;
  }
  .set-grid label {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 6px 4px 5px;
    border: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 45%, transparent);
    border-radius: var(--radius);
    cursor: pointer;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
  }
  .set-grid label:hover {
    color: var(--panel-ink);
  }
  .set-grid label.on {
    color: var(--panel-ink);
    border-color: var(--panel-ink);
    box-shadow: inset 0 0 0 1px var(--panel-ink);
  }
  .set-grid input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .set-grid label:focus-within {
    outline: 2px solid var(--panel-ink);
    outline-offset: 2px;
  }
  .icon {
    position: relative;
    width: 38px;
    height: 38px;
    background: var(--sq-classic-light, #ecebe5);
    border-radius: var(--radius);
  }
  .icon piece {
    width: 100%;
    height: 100%;
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
